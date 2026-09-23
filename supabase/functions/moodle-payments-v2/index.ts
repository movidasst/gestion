import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

type JsonObject = Record<string, unknown>;
type MoodleParameter = string | number | boolean;
type AdminClient = ReturnType<typeof createClient>;
type FileInfo = { filename:string; mimetype:string; filesize:number; fileurl:string };
type PayAssignment = { course_id:number; course_name:string; course_shortname:string; assignment_id:number; assignment_cmid:number; assignment_name:string; grade:number; markingworkflow:number };
type PaymentRow = { submission_id:number; moodle_user_id:number; attemptnumber:number; timecreated:number; timemodified:number; submission_status:string; gradingstatus:string; processed:boolean; course:JsonObject; assignment:JsonObject; student:JsonObject; member:JsonObject|null; files:FileInfo[] };

const ALLOWED_ORIGINS = new Set(["https://gestion.movidasst.com","https://movidasst.github.io"]);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const PAYMENT_ASSIGNMENT_NAME = "sube tu pago";

function secret(name:string){ const v=Deno.env.get(name)?.trim(); if(!v) throw new Error(`Falta configurar ${name}.`); return v; }
function adminKey(){
  const direct=[Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim(),Deno.env.get("SUPABASE_SECRET_KEY")?.trim()].find(Boolean); if(direct) return direct;
  const encoded=Deno.env.get("SUPABASE_SECRET_KEYS")?.trim(); if(encoded){ try{ const p=JSON.parse(encoded); if(typeof p==="string"&&p.trim()) return p.trim(); if(p&&typeof p==="object") for(const k of ["default","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEY","service_role","serviceRole","secret","key"]){ if(typeof p[k]==="string"&&p[k].trim()) return p[k].trim(); } }catch{return encoded;} }
  throw new Error("No se encontró la clave administrativa de Supabase.");
}
function cors(req:Request){ const o=req.headers.get("origin")?.trim()||""; return {"Access-Control-Allow-Origin":ALLOWED_ORIGINS.has(o)?o:"https://gestion.movidasst.com","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Max-Age":"86400","Vary":"Origin"}; }
function json(req:Request,body:JsonObject,status=200){ return new Response(JSON.stringify(body),{status,headers:{...cors(req),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}}); }
function obj(v:unknown):JsonObject{return v&&typeof v==="object"&&!Array.isArray(v)?v as JsonObject:{};}
function arr(v:unknown):JsonObject[]{return Array.isArray(v)?v.map(obj):[];}
function chunks<T>(items:T[],size:number){const out:T[][]=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out;}
function norm(v:unknown){return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function isPayment(v:unknown){return norm(v)===PAYMENT_ASSIGNMENT_NAME;}
function positive(v:unknown,label:string){const n=Number(v);if(!Number.isInteger(n)||n<=0)throw new Error(`${label} no es válido.`);return n;}
function nonNegative(v:unknown,label:string){const n=Number(v);if(!Number.isInteger(n)||n<0)throw new Error(`${label} no es válido.`);return n;}
function clean(e:unknown){return (e instanceof Error?e.message:String(e??"Error desconocido")).replace(/wstoken=[^&\s]+/gi,"wstoken=[OCULTO]").slice(0,1200);}

async function moodle(fn:string,params:Record<string,MoodleParameter>={},read=false):Promise<unknown>{
  const base=secret("MOODLE_BASE_URL").replace(/\/+$/,'');
  const token=read?(Deno.env.get("MOODLE_LECTURA_TOKEN")?.trim()||secret("MOODLE_TOKEN")):secret("MOODLE_TOKEN");
  const form=new URLSearchParams({wstoken:token,wsfunction:fn,moodlewsrestformat:"json"}); for(const[k,v]of Object.entries(params))form.set(k,String(v));
  const r=await fetch(`${base}/webservice/rest/server.php`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:form,signal:AbortSignal.timeout(30000)});
  const raw=await r.text();let p:unknown;try{p=raw?JSON.parse(raw):null;}catch{throw new Error(`Moodle devolvió una respuesta no válida (${r.status}).`);} if(!r.ok)throw new Error(`Moodle respondió HTTP ${r.status}.`);
  if(p&&typeof p==="object"&&!Array.isArray(p)){const x=p as JsonObject;if(x.exception||x.errorcode)throw new Error(`Moodle [${String(x.errorcode||x.exception)}]: ${String(x.message||"operación rechazada")}`);} return p;
}
async function auth(req:Request,admin:AdminClient){const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)throw new Error("Sesión requerida.");const{data,error}=await admin.auth.getUser(token);if(error||!data.user)throw new Error("La sesión no es válida.");const{data:ok,error:e}=await admin.from("estudio_admins").select("auth_user_id").eq("auth_user_id",data.user.id).eq("activo",true).eq("rol","admin").maybeSingle();if(e)throw new Error(e.message);if(!ok)throw new Error("No autorizado.");return data.user.id;}

async function courses(){const r=obj(await moodle("core_course_get_courses_by_field",{field:"",value:""},true));return arr(r.courses).map(c=>({id:Number(c.id||0),fullname:String(c.fullname||c.displayname||"Curso sin nombre"),shortname:String(c.shortname||""),visible:c.visible!==0&&c.visible!==false})).filter(c=>c.id>1);}
async function paymentAssignments(){
  const cs=await courses();const responses=await Promise.all(chunks(cs,50).map(batch=>{const p:Record<string,MoodleParameter>={includenotenrolledcourses:1};batch.forEach((c,i)=>p[`courseids[${i}]`]=c.id);return moodle("mod_assign_get_assignments",p,true);}));
  const assignments:PayAssignment[]=[];const warnings:JsonObject[]=[];
  for(const raw of responses){const r=obj(raw);warnings.push(...arr(r.warnings));for(const c of arr(r.courses))for(const a of arr(c.assignments)){if(!isPayment(a.name))continue;const id=Number(a.id||0);if(!id)continue;assignments.push({course_id:Number(c.id||a.course||0),course_name:String(c.fullname||"Curso sin nombre"),course_shortname:String(c.shortname||""),assignment_id:id,assignment_cmid:Number(a.cmid||0),assignment_name:String(a.name||"Comprobante de pago"),grade:Number(a.grade||0),markingworkflow:Number(a.markingworkflow||0)});}}
  assignments.sort((a,b)=>a.course_name.localeCompare(b.course_name,"es"));const withPayment=new Set(assignments.map(a=>a.course_id));return {assignments,warnings,courses:cs,coursesWithoutPayment:cs.filter(c=>!withPayment.has(c.id))};
}
function files(s:JsonObject):FileInfo[]{const out:FileInfo[]=[];for(const plugin of arr(s.plugins))for(const area of arr(plugin.fileareas))for(const f of arr(area.files)){const fileurl=String(f.fileurl||"").trim(),filename=String(f.filename||"").trim();if(!fileurl||!filename||f.isdir===true||Number(f.isdir||0)===1)continue;out.push({filename,mimetype:String(f.mimetype||"application/octet-stream"),filesize:Math.max(0,Number(f.filesize||0)),fileurl});}return out;}
async function users(ids:number[]){const out:JsonObject[]=[];for(const batch of chunks([...new Set(ids)],100)){const p:Record<string,MoodleParameter>={field:"id"};batch.forEach((id,i)=>p[`values[${i}]`]=id);out.push(...arr(await moodle("core_user_get_users_by_field",p,true)));}return out;}
async function snapshot(admin:AdminClient){
  const ctx=await paymentAssignments(); if(!ctx.assignments.length)return{...ctx,rows:[] as PaymentRow[]};
  const responses=await Promise.all(chunks(ctx.assignments,50).map(batch=>{const p:Record<string,MoodleParameter>={status:"",since:0,before:0};batch.forEach((a,i)=>p[`assignmentids[${i}]`]=a.assignment_id);return moodle("mod_assign_get_submissions",p,true);}));
  const by=new Map<number,JsonObject[]>();for(const raw of responses){const r=obj(raw);ctx.warnings.push(...arr(r.warnings));for(const a of arr(r.assignments))by.set(Number(a.assignmentid||0),arr(a.submissions));}
  const rawRows=ctx.assignments.flatMap(a=>(by.get(a.assignment_id)||[]).map(s=>({a,s}))).filter(x=>files(x.s).length>0);const ids=[...new Set(rawRows.map(x=>Number(x.s.userid||0)).filter(Boolean))];
  let members:JsonObject[]=[];if(ids.length){const{data,error}=await admin.from("integrantes").select("id,nombres,apellidos,documento,cedula,correo,moodle_user_id").in("moodle_user_id",ids);if(error)throw new Error(error.message);members=data||[];}const mm=new Map(members.map(m=>[Number(m.moodle_user_id||0),m]));
  let us:JsonObject[]=[];try{us=await users(ids.filter(id=>!mm.has(id)));}catch(e){ctx.warnings.push({warningcode:"moodle_user_lookup_failed",message:clean(e)});}const um=new Map(us.map(u=>[Number(u.id||0),u]));
  const rows:PaymentRow[]=rawRows.map(({a,s})=>{const uid=Number(s.userid||0);const m=mm.get(uid)||null,u=um.get(uid)||null;const mn=`${String(m?.nombres||"")} ${String(m?.apellidos||"")}`.trim();const un=String(u?.fullname||"").trim()||`${String(u?.firstname||"")} ${String(u?.lastname||"")}`.trim();const gs=String(s.gradingstatus||"notgraded").toLowerCase();return{submission_id:Number(s.id||0),moodle_user_id:uid,attemptnumber:Number(s.attemptnumber||0),timecreated:Number(s.timecreated||0),timemodified:Number(s.timemodified||0),submission_status:String(s.status||""),gradingstatus:gs,processed:gs==="graded",course:{id:a.course_id,fullname:a.course_name,shortname:a.course_shortname},assignment:{id:a.assignment_id,cmid:a.assignment_cmid,name:a.assignment_name,grade:a.grade},student:{fullname:mn||un||`Usuario Moodle #${uid}`,email:String(m?.correo||u?.email||"").trim(),idnumber:String(m?.documento||m?.cedula||u?.idnumber||"").trim()},member:m?{id:Number(m.id||0),documento:String(m.documento||m.cedula||"")}:null,files:files(s)};}).sort((a,b)=>b.timemodified-a.timemodified);
  return{...ctx,rows};
}
function publicRow(r:PaymentRow):JsonObject{return{...r,files:r.files.map((f,index)=>({index,filename:f.filename,mimetype:f.mimetype,filesize:f.filesize}))};}
async function target(admin:AdminClient,submissionId:number,assignmentId?:number){const snap=await snapshot(admin);const row=snap.rows.find(r=>r.submission_id===submissionId&&(!assignmentId||Number(r.assignment.id)===assignmentId));if(!row)throw new Error("El comprobante ya no está disponible en Moodle.");const aid=Number(row.assignment.id);const response=obj(await moodle("mod_assign_get_submissions",{"assignmentids[0]":aid,status:"",since:0,before:0},true));const remote=arr(response.assignments).find(x=>Number(x.assignmentid||0)===aid);const submission=arr(remote?.submissions).find(s=>Number(s.id||0)===submissionId);if(!submission)throw new Error("La entrega ya no está disponible en Moodle.");const assignment=snap.assignments.find(a=>a.assignment_id===aid)!;return{row,assignment,submission,fileList:files(submission)};}
async function download(f:FileInfo){if(f.filesize>MAX_FILE_BYTES)throw new Error("El archivo supera 15 MB.");const base=new URL(secret("MOODLE_BASE_URL").replace(/\/+$/,''));const url=new URL(f.fileurl);if(url.origin!==base.origin||!url.pathname.includes("/webservice/pluginfile.php/"))throw new Error("El archivo no pertenece al Moodle autorizado.");url.searchParams.set("token",secret("MOODLE_TOKEN"));const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`No se pudo descargar el comprobante (${r.status}).`);const data=await r.arrayBuffer();if(data.byteLength>MAX_FILE_BYTES)throw new Error("El archivo descargado supera 15 MB.");const type=(r.headers.get("content-type")||f.mimetype||"application/octet-stream").split(";")[0].trim();return{data,type:type.startsWith("image/")||type==="application/pdf"?type:"application/octet-stream"};}
async function audit(admin:AdminClient,v:JsonObject){const{error}=await admin.from("moodle_admin_auditoria").insert(v);if(error)console.error("audit",error.message);}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});if(req.method!=="POST")return json(req,{ok:false,error:"Método no permitido."},405);const o=req.headers.get("origin")?.trim()||"";if(o&&!ALLOWED_ORIGINS.has(o))return json(req,{ok:false,error:"Origen no autorizado."},403);
  const admin=createClient(secret("SUPABASE_URL"),adminKey(),{auth:{persistSession:false,autoRefreshToken:false}});let adminUserId="";
  try{
    adminUserId=await auth(req,admin);const body=await req.json().catch(()=>({})) as JsonObject;const action=String(body.action||"").trim();
    if(action==="payment_submissions"){
      const s=await snapshot(admin);const pending=s.rows.filter(r=>!r.processed).length;const cs=[...new Map(s.assignments.map(a=>[a.course_id,{id:a.course_id,fullname:a.course_name,shortname:a.course_shortname}])).values()];
      return json(req,{ok:true,summary:{total:s.rows.length,pending,processed:s.rows.length-pending,payment_courses:cs.length},courses:cs,assignments:s.assignments.map(a=>({course_id:a.course_id,assignment_id:a.assignment_id,assignment_cmid:a.assignment_cmid,assignment_name:a.assignment_name,grade:a.grade})),courses_without_payment:s.coursesWithoutPayment,warnings:s.warnings,payments:s.rows.map(publicRow)});
    }
    if(action==="payment_file"){
      const sid=positive(body.submission_id,"La entrega"),fi=nonNegative(body.file_index,"El archivo"),aid=body.assignment_id?positive(body.assignment_id,"La actividad"):undefined;const t=await target(admin,sid,aid),f=t.fileList[fi];if(!f)throw new Error("El archivo solicitado no existe.");const d=await download(f);return new Response(d.data,{status:200,headers:{...cors(req),"Content-Type":d.type,"Content-Length":String(d.data.byteLength),"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
    }
    if(action==="approve_payment"){
      const sid=positive(body.submission_id,"La entrega"),aid=body.assignment_id?positive(body.assignment_id,"La actividad"):undefined;const t=await target(admin,sid,aid);const max=Number(t.assignment.grade||0);if(!Number.isFinite(max)||max<=0)throw new Error("La tarea de pago usa una escala no numérica; corrígela en Moodle antes de aprobar.");const uid=positive(t.submission.userid,"El usuario Moodle");if(String(t.submission.gradingstatus||"").toLowerCase()==="graded"){await admin.from("academia_pago_revisiones").delete().eq("submission_id",sid);return json(req,{ok:true,already_processed:true,grade:max,maximum_grade:max});}
      const params:Record<string,MoodleParameter>={assignmentid:t.assignment.assignment_id,userid:uid,grade:max,attemptnumber:Number(t.submission.attemptnumber||0),addattempt:0,workflowstate:t.assignment.markingworkflow===1?"released":"",applytoall:0};
      try{await moodle("mod_assign_save_grade",params,false);await admin.from("academia_pago_revisiones").delete().eq("submission_id",sid);const memberId=Number((t.row.member as JsonObject|null)?.id||0)||null;await audit(admin,{admin_user_id:adminUserId,accion:"APROBAR_PAGO",integrante_id:memberId,moodle_user_id:uid,moodle_course_id:t.assignment.course_id,detalle:{assignment_id:t.assignment.assignment_id,assignment_name:t.assignment.assignment_name,submission_id:sid,grade:max,maximum_grade:max,payment_engine:"v2"},resultado:"OK",error:null});return json(req,{ok:true,graded:true,grade:max,maximum_grade:max});}
      catch(e){const msg=clean(e);await audit(admin,{admin_user_id:adminUserId,accion:"APROBAR_PAGO",integrante_id:Number((t.row.member as JsonObject|null)?.id||0)||null,moodle_user_id:uid,moodle_course_id:t.assignment.course_id,detalle:{assignment_id:t.assignment.assignment_id,submission_id:sid,payment_engine:"v2"},resultado:"ERROR",error:msg});throw new Error(msg);}
    }
    return json(req,{ok:false,error:"Acción no reconocida."},400);
  }catch(e){const msg=clean(e);return json(req,{ok:false,error:msg},/No autorizado|Sesión/.test(msg)?403:500);}
});