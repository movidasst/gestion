(() => {
'use strict';
const URL='https://lfdmbkzghnwvsapxypvt.supabase.co';
const KEY='sb_publishable_bRnkA6PA8-v073nrw9zxiQ_8rVGiOn1';
const $=id=>document.getElementById(id);
const client=window.supabase?.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
const selected=new Set();
const selectedStates=new Set();
let availableStates=[];
let people=[],page=0,total=0,limit=50,searchSerial=0,searchTimer=null,templates=[],active=false,previewChecksum='',lastSendId=null,statusPollTimer=null,statusPollRunning=false;
const txt=v=>String(v==null?'':v);
const esc=s=>txt(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const make=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=txt(value);return e};
function banner(message,isError=false){
 const n=$('status');n.hidden=false;n.className='notice'+(isError?' error':'');n.textContent=message;
}
function quiet(){ $('status').hidden=true;}
function busy(button,yes,label){
 if(!button)return; if(yes){if(!button.disabled)button.dataset.previousText=button.textContent;button.disabled=true;button.textContent=label||'Procesando…'}
 else{button.disabled=false;button.textContent=button.dataset.previousText||button.textContent}
}
function call(name,args={},time=20000){
 const request=client.rpc(name,args);
 let timer;
 const timeout=new Promise((_,rej)=>timer=setTimeout(()=>rej(new Error('El servidor tardó demasiado y no se pudo confirmar el resultado.')),time));
 return Promise.race([request,timeout]).then(({data,error})=>{if(error)throw error;return data}).finally(()=>clearTimeout(timer));
}
function query(){
 return {
  p_busqueda:$('search').value.trim(),
  p_pais:selectedStates.size?'VE':$('country').value,
  p_estados:[...selectedStates].sort()
 };
}
function renderStateControl(){
 const unavailable=$('country').value!==''&&$('country').value!=='VE';
 const wrapper=$('stateFilterWrap');
 wrapper.classList.toggle('disabled',unavailable);
 const menu=$('statesDropdown');
 if(unavailable)menu.open=false;
 const names=[...selectedStates].sort((a,b)=>a.localeCompare(b,'es'));
 const summary=$('statesSummary');
 summary.textContent=unavailable?'Solo para Venezuela':names.length===0?'Todos los estados':names.length===1?names[0]:names.length+' estados seleccionados';
 summary.title=names.length?names.join(', '):'Sin filtro por estado';
 summary.setAttribute('aria-disabled',unavailable?'true':'false');
 summary.tabIndex=unavailable?-1:0;
 $('statesList').querySelectorAll('input[type="checkbox"]').forEach(input=>{
  input.checked=selectedStates.has(input.value);
  input.disabled=unavailable;
 });
 $('statesSelectAll').disabled=unavailable||availableStates.length===0;
 $('statesClear').disabled=unavailable||names.length===0;
}
function stateFiltersChanged(){
 page=0;
 renderStateControl();
 loadPeople();
}
function addStateControls(states){
 availableStates=[...new Set(states.filter(Boolean))];
 const list=$('statesList');
 list.replaceChildren();
 availableStates.forEach(name=>{
   const line=make('label','state-choice');
   const input=make('input','');
   input.type='checkbox';
   input.value=name;
   const caption=make('span','',name);
   input.addEventListener('change',()=>{
     if(input.checked){
       if($('country').value!=='VE')$('country').value='VE';
       selectedStates.add(input.value);
     }else selectedStates.delete(input.value);
     stateFiltersChanged();
   });
   line.append(input,caption);
   list.append(line);
 });
 if(!availableStates.length)list.append(make('p','hint','No hay estados disponibles.'));
 renderStateControl();
}
async function loadPeople(){
 const serial=++searchSerial;
 const args={...query(),p_offset:page*limit,p_limite:limit};
 $('listInfo').textContent='Consultando directorio…';$('searchBtn').disabled=true;
 try{
  const result=await call('admin_correos_buscar',args);
  if(serial!==searchSerial)return;
  people=result?.filas||[];total=Number(result?.total||0);
  renderPeople();
 }catch(e){
  if(serial!==searchSerial)return;
  people=[];total=0;renderPeople();banner('Error al buscar integrantes: '+e.message,true);
 }finally{if(serial===searchSerial)$('searchBtn').disabled=false}
}
function selectedChanged(){
 previewChecksum='';$('audiencePreview').textContent='Validación pendiente: revisa los correos antes de crear la campaña.';
 $('selectedCount').textContent=selected.size.toLocaleString('es');
 $('selectionLabel').textContent=selected.size.toLocaleString('es')+' persona(s) seleccionada(s)';
 $('previewAudience').disabled=selected.size===0;
 $('createCampaign').disabled=selected.size===0;
}
function renderPeople(){
 $('people').replaceChildren();
 people.forEach(p=>{
   const row=make('label','person'+(!p.elegible?' disabled':'')),input=make('input',''),copy=make('div','person-main'),meta=make('div','person-meta');
   input.type='checkbox';input.value=String(p.id);input.checked=selected.has(Number(p.id));input.disabled=!p.elegible;
   input.addEventListener('change',()=>{if(input.checked)selected.add(Number(p.id));else selected.delete(Number(p.id));selectedChanged()});
   copy.append(make('strong','',p.nombre||'Integrante'),make('small','',p.correo||'Correo no disponible'));
   meta.append(make('div','',p.pais_nombre||p.pais_iso2||''),make('span','pill',p.elegible?(p.estado||'Disponible'):'No elegible'));
   row.append(input,copy,meta);$('people').append(row);
 });
 if(!people.length)$('people').append(make('p','empty','No se encontraron integrantes con esos filtros.'));
 $('listInfo').textContent=total.toLocaleString('es')+' coincidencias · '+people.filter(x=>x.elegible).length+' seleccionables en esta página';
 $('pageText').textContent='Página '+(page+1)+' de '+Math.max(1,Math.ceil(total/limit));
 $('prev').disabled=page===0;$('next').disabled=(page+1)*limit>=total;
 selectedChanged();
}
function bodyToHtml(plain){
 const parts=txt(plain).trim().split(/\n\s*\n/);
 return parts.map(p=>'<p style="margin:0 0 14px">'+esc(p).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>')+'</p>').join('');
}
function renderPreview(){
 const h=esc($('heading').value.trim()||'Título del correo');
 let content=bodyToHtml($('bodyText').value.trim()||'Tu mensaje se mostrará aquí.');
 content=content.replace(/\{\{(?:nombre|nombres)\}\}/gi,'Profesional').replace(/\{\{pais\}\}/gi,'Tu país');
 const url=$('buttonUrl').value.trim(),buttonName=$('buttonText').value.trim();
 const button=/^https:\/\//i.test(url)&&buttonName?'<div style="padding:14px 0;text-align:center"><a href="'+esc(url)+'" style="padding:13px 20px;border-radius:11px;background:#007b85;text-decoration:none;color:#fff;font-weight:700">'+esc(buttonName)+'</a></div>':'';
 $('emailPreview').srcdoc='<!doctype html><html><meta charset="utf-8"><body style="font-family:Arial,sans-serif;background:#f1f6f8;margin:0;padding:22px 14px;color:#344e63"><div style="background:white;max-width:640px;margin:auto;border-radius:16px;overflow:hidden;box-shadow:0 10px 32px #00205b17"><header style="text-align:center;padding:22px;border-bottom:1px solid #e6eff1"><img alt="La Movida SST+" src="https://www.movidasst.com/logo-horizontal-movida-sst-plus.webp" width="205" style="max-width:90%;height:auto"></header><article style="padding:26px 22px"><h1 style="font-size:23px;color:#00205b">'+h+'</h1><div style="font-size:15px;line-height:1.65">'+content+'</div>'+button+'</article><footer style="background:#00205b;color:#fff;text-align:center;padding:20px;font-size:12px">La Movida de SST+ · De la Reacción a la Prevención<br><small style="color:#d3e5ee">Recibirás una opción para dejar de recibir comunicaciones.</small></footer></div></body></html>';
}
function compose(){
 const name=$('campaignName').value.trim(),asunto=$('subject').value.trim(),heading=$('heading').value.trim(),body=$('bodyText').value.trim(),bt=$('buttonText').value.trim(),url=$('buttonUrl').value.trim();
 if(!name||!asunto||!heading||!body)throw new Error('Completa nombre de campaña, asunto, título y mensaje.');
 if(url&&!/^https:\/\//i.test(url))throw new Error('El enlace del botón debe comenzar con https://');
 if(bt&&!url||url&&!bt)throw new Error('Completa tanto el texto como el enlace del botón.');
 if(asunto.length>180||body.length>12000)throw new Error('El asunto o el mensaje son demasiado largos.');
 const unfinished=/\[(?:NOMBRE DEL CURSO|FECHAS|HORARIO Y PAÍS|MODALIDAD|PRECIO|BENEFICIOS Y MATERIALES DEL CURSO)\]/i;
 if(unfinished.test(asunto+' '+heading+' '+body))throw new Error('Sustituye todos los datos entre corchetes de la plantilla del curso antes de enviar.');
 return {p_nombre:name,p_asunto:asunto,p_preencabezado:asunto,p_encabezado:heading,p_cuerpo_html:bodyToHtml(body),p_boton_texto:bt||null,p_boton_url:url||null};
}
async function validateAudience(){
 if(!selected.size)throw new Error('Selecciona al menos una persona.');
 const ids=[...selected].sort((a,b)=>a-b);
 const result=await call('admin_comunicacion_previsualizar',{p_filtros:{integrante_ids:ids}},25000);
 previewChecksum=ids.join(',');
 $('audiencePreview').textContent='Válidos: '+Number(result.correos_validos||0)+' · Registros elegidos: '+Number(result.total_coincidencias||0)+' · Excluidos: '+Number(result.excluidos||0)+' · Sin correo o inválidos: '+(Number(result.sin_correo||0)+Number(result.correo_invalido||0));
 if(!result.correos_validos)throw new Error('No hay direcciones válidas entre las personas seleccionadas.');
 return result;
}
async function refreshDashboard(){
 const quota=await call('admin_correos_cupo');
 $('used').textContent=Number(quota.usados||0).toLocaleString('es');
 $('remaining').textContent=Number(quota.disponibles||0).toLocaleString('es');
}
function applyTemplate(t){
 $('campaignName').value=t.nombre||'';$('subject').value=t.asunto||'';$('heading').value=t.encabezado||'';
 const div=document.createElement('div');div.innerHTML=t.cuerpo_html||'';div.querySelectorAll('strong,b').forEach(x=>x.replaceWith('**'+x.textContent+'**'));div.querySelectorAll('br').forEach(x=>x.replaceWith('\n'));
 div.querySelectorAll('p,div').forEach(x=>x.after('\n\n'));
 $('bodyText').value=(div.textContent||'').replace(/\n{3,}/g,'\n\n').trim();
 $('buttonText').value=t.boton_texto||'';$('buttonUrl').value=t.boton_url||'';renderPreview();
}
async function initialize(){
 const {data:{session}}=await client.auth.getSession();
 if(!session)throw new Error('Debes iniciar sesión.');
 const quota=await call('admin_correos_cupo');
 if(!quota||typeof quota.maximo!=='number')throw new Error('Acceso no autorizado');
 active=true;$('loginView').hidden=true;$('app').hidden=false;quiet();
 const [catalog,plantillas]=await Promise.all([call('admin_correos_catalogos'),call('admin_comunicacion_plantillas')]);
 const countries=$('country');
 (catalog.paises||[]).forEach(item=>{const [code,name]=item.split('|');const option=make('option','',name||code);option.value=code;countries.append(option)});
 addStateControls(catalog.estados||[]);
 templates=plantillas||[];templates.forEach((t,i)=>{const opt=make('option','',t.nombre);opt.value=String(i);$('templateSelect').append(opt)});
 selectedChanged();renderPreview();
 await Promise.all([loadPeople(),refreshDashboard()]);
 await restoreLastSend().catch(()=>{});
 startStatusWatch();
}
async function login(){
 $('loginError').hidden=true;
 const b=$('loginBtn');busy(b,true,'Verificando…');
 try{
  const {error}=await client.auth.signInWithPassword({email:$('adminEmail').value.trim(),password:$('adminPassword').value});
  if(error)throw error;$('adminPassword').value='';await initialize();
 }catch(e){
  $('loginError').textContent=e.message||'No se pudo iniciar sesión.';$('loginError').hidden=false;
 }finally{busy(b,false)}
}
function uniqueSendId(payload){
 const key="movidasst_correos_envio_solicitud";
 const signature=JSON.stringify(payload);
 try{
  const previous=JSON.parse(sessionStorage.getItem(key)||"null");
  if(previous&&previous.signature===signature&&Date.now()-previous.created<86400000&&previous.id)return previous.id;
  const id=crypto.randomUUID();
  sessionStorage.setItem(key,JSON.stringify({id,signature,created:Date.now()}));
  return id;
 }catch{
  if(!window.crypto?.randomUUID)throw new Error("Tu navegador no admite confirmación segura de envíos.");
  return window.crypto.randomUUID();
 }
}
async function immediateDispatch(campaignId){
 const {data:{session}}=await client.auth.getSession();
 if(!session?.access_token)throw new Error('Tu sesión administrativa venció.');
 const controller=new AbortController();
 const handle=setTimeout(()=>controller.abort(),32000);
 try{
  const response=await fetch(URL+'/functions/v1/enviar-correos-ahora',{
   method:'POST',
   headers:{Authorization:'Bearer '+session.access_token,apikey:KEY,'Content-Type':'application/json'},
   body:JSON.stringify({campana_id:campaignId}),
   signal:controller.signal
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||payload.error)throw new Error(payload.error||'El procesador no confirmó el envío ('+response.status+').');
  return payload;
 }finally{clearTimeout(handle)}
}
function displaySendState(state,extra=''){
 const total=Number(state?.total||0),sent=Number(state?.enviados||0),waiting=Number(state?.pendientes||0),failed=Number(state?.fallidos||0);
 const title=state?.estado==='cancelada'?'Envío cancelado':sent===total&&total>0?'Aceptado por el proveedor':state?.estado==='programada'&&sent===0?'Envío programado':sent>0?'Envío en curso':failed>0&&waiting===0?'Envío con errores':'Enviando progresivamente';
 $('sendReceiptTitle').textContent=title;
 let summary=sent+' de '+total+' aceptados por el proveedor ('+(total?Math.round(sent*100/total):0)+' %) · '+waiting+' pendientes'+(failed?' · '+failed+' con error(es)':'')+'.';
 if(sent===total&&total>0)summary+=' La aceptación no garantiza que esté en la bandeja de entrada.';
 else if(waiting>0)summary+=' Se están despachando en lotes de hasta 10 correos cada minuto, con un máximo de 400 intentos por 24 horas. La cifra se actualiza automáticamente.';
 if(extra)summary+=' '+extra;
 $('sendReceiptText').textContent=summary;
 $('sendReceipt').hidden=false;
 $('checkSendStatus').hidden=total===0||sent===total&&waiting===0;
 $('cancelActive').hidden=waiting===0;
 return {sent,total,waiting,failed};
}

async function restoreLastSend(){
 const latest=await call('admin_correos_ultimo_envio',{},13000);
 if(latest?.id&&latest?.resumen){
  lastSendId=latest.id;
  displaySendState(latest.resumen);
 }
}
function startStatusWatch(){
 if(statusPollTimer!==null)clearInterval(statusPollTimer);
 statusPollTimer=setInterval(async()=>{
  if(!active||document.hidden||!lastSendId||statusPollRunning)return;
  statusPollRunning=true;
  try{
   const summary=await refreshLastSendStatus();
   if(Number(summary?.pendientes||0)>0)await refreshDashboard();
  }catch{
   // No interrumpir al administrador ante una falla temporal de red.
   // El botón "Comprobar estado" sigue disponible.
  }finally{
   statusPollRunning=false;
  }
 },25000);
}
async function refreshLastSendStatus(){
 if(!lastSendId)throw new Error('No hay envío reciente que consultar.');
 const status=await call('admin_correos_estado',{p_campana:lastSendId});
 displaySendState(status);
 return status;
}
async function createCampaign(){
 const button=$('createCampaign');
 if(button.disabled)return;
 busy(button,true,'Validando destinatarios…');
 try{
  const data=compose();
  const validation=await validateAudience();
  const ids=[...selected].sort((a,b)=>a-b);
  let schedule=$('schedule').value||null;
  if(schedule){
   const dt=new Date(schedule);
   if(Number.isNaN(dt.getTime()))throw new Error('La fecha de programación no es válida.');
   if(dt.getTime()<Date.now()-60000)throw new Error('La programación debe estar en el futuro.');
   schedule=dt.toISOString();
  }
  // Un destinatario: un solo toque en Enviar. Varios: confirmar la selección masiva.
  if(Number(validation.correos_validos)>1){
   const question=schedule
    ?'¿Programar el envío a '+validation.correos_validos+' correos para '+new Date(schedule).toLocaleString('es-CL')+'?'
    :'¿Enviar ahora a '+validation.correos_validos+' correos? El primero se intentará de inmediato y los restantes avanzarán en lotes con el límite diario.';
   if(!window.confirm(question))return;
  }
  const payload={...data,p_filtros:{integrante_ids:ids},p_programada_at:schedule};
  const id=uniqueSendId(payload);
  busy(button,true,schedule?'Programando…':'Enviando ahora…');
  const created=await call('admin_correos_enviar',{...payload,p_solicitud_id:id},45000);
  if(!created?.ok||!created.id)throw new Error('El servidor no confirmó la solicitud.');
  lastSendId=created.id;
  $('sendReceipt').hidden=false;
  $('sendReceiptTitle').textContent=schedule?'Envío programado':'Enviando al proveedor…';
  $('sendReceiptText').textContent=schedule
   ?'Programado para '+new Date(schedule).toLocaleString('es-CL')+'. Destinatarios: '+created.destinatarios+'.'
   :'Solicitud creada para '+created.destinatarios+' destinatario(s). Comprobando el envío real…';
  $('cancelActive').hidden=false;
  $('checkSendStatus').hidden=false;
  selected.clear();renderPeople();
  try{sessionStorage.removeItem('movidasst_correos_envio_solicitud')}catch{}
  if(schedule){
   banner('Envío programado correctamente.');
  }else{
   let direct=null,extra='';
   try{
    direct=await immediateDispatch(created.id);
    if(direct.skipped==='registration_emails_have_priority')extra='Los mensajes de registro tienen prioridad.';
    if(direct.skipped==='envio_no_activo')extra='La solicitud ya no está activa.';
    if(Number(direct.reprogrammed||0)>0)extra='El proveedor no confirmó uno de los intentos. Se reintentará sin duplicar entregas confirmadas.';
   }catch(error){
    extra='No pudimos confirmar el procesamiento inmediato: '+(error.message||'error')+'. La solicitud no se duplicará.';
   }
   try{
    const result=await refreshLastSendStatus();
    displaySendState(result,extra);
    if(Number(result.enviados||0)>0)banner('El proveedor aceptó '+result.enviados+' correo(s).');
    else if(Number(result.pendientes||0)>0)banner('Aún no hay confirmación del proveedor. Puedes pulsar «Comprobar estado».',true);
    else banner('El envío requiere revisión. '+extra,true);
   }catch(error){
    $('sendReceiptTitle').textContent='Estado no disponible';
    $('sendReceiptText').textContent='El envío fue registrado, pero no pudimos consultar su resultado: '+error.message+'. No vuelvas a crearlo; usa «Comprobar estado».';
    banner('El envío se registró, pero todavía no es posible confirmar su resultado.',true);
   }
  }
  refreshDashboard().catch(()=>{});
  $('sendReceipt').scrollIntoView({behavior:'smooth',block:'center'});
 }catch(e){
  banner('No se pudo completar la solicitud: '+(e.message||'error desconocido')+'. Si hubo un corte de conexión, reintenta sin cambiar los datos para evitar duplicados.',true);
 }finally{busy(button,false);button.disabled=selected.size===0}
}
async function cancelCurrent(){
 if(!lastSendId)return;
 if(!window.confirm('¿Cancelar los mensajes de este envío que aún no se hayan enviado? Los correos ya enviados no pueden recuperarse.'))return;
 const button=$('cancelActive');busy(button,true,'Cancelando pendientes…');
 try{
  const result=await call('admin_comunicacion_campana_accion',{p_id:lastSendId,p_accion:'cancelar'});
  if(result?.estado!=='cancelada')throw new Error('La cancelación no pudo confirmarse.');
  $('checkSendStatus').hidden=true;
  $('sendReceiptTitle').textContent='Se cancelaron los mensajes pendientes';
  $('sendReceiptText').textContent='Los mensajes que ya salieron no pueden recuperarse. Los pendientes de este envío quedaron cancelados.';
  $('cancelActive').hidden=true;
  banner('Cancelados los envíos pendientes.');
 }catch(e){banner('No se pudo cancelar: '+e.message,true)}
 finally{busy(button,false)}
}
async function sendTest(){
 const button=$('testEmail');
 let data;try{data=compose()}catch(e){return banner(e.message,true)}
 if(!window.confirm('¿Enviar un correo de prueba a la dirección de tu cuenta administradora? Se añadirá a la cola y consumirá un intento del cupo.'))return;
 busy(button,true,'Programando prueba…');
 try{
  const r=await call('admin_correos_prueba',{p_asunto:data.p_asunto,p_preencabezado:data.p_preencabezado,p_encabezado:data.p_encabezado,p_cuerpo_html:data.p_cuerpo_html,p_boton_texto:data.p_boton_texto,p_boton_url:data.p_boton_url});
  banner('Prueba encolada para '+r.correo+'. Se enviará cuando el procesador tenga cuota libre.');
  await refreshDashboard();
 }catch(e){banner('No se pudo programar la prueba: '+e.message,true)}
 finally{busy(button,false)}
}
async function saveTemplate(){
 const button=$('saveTemplate');busy(button,true,'Guardando…');
 try{
  const data=compose();
  await call('admin_comunicacion_plantilla_guardar',{p_id:null,p_nombre:data.p_nombre,p_asunto:data.p_asunto,p_preencabezado:data.p_preencabezado,p_encabezado:data.p_encabezado,p_cuerpo_html:data.p_cuerpo_html,p_boton_texto:data.p_boton_texto,p_boton_url:data.p_boton_url});
  const list=await call('admin_comunicacion_plantillas');templates=list||[];const emptyOption=make('option','','Mensaje nuevo');emptyOption.value='';$('templateSelect').replaceChildren(emptyOption);
  templates.forEach((t,i)=>{const opt=make('option','',t.nombre);opt.value=String(i);$('templateSelect').append(opt)});
  banner('Plantilla guardada correctamente.');
 }catch(e){banner('Error al guardar la plantilla: '+e.message,true)}
 finally{busy(button,false)}
}
function events(){
 $('loginForm').addEventListener('submit',e=>{e.preventDefault();login()});
 $('logout').addEventListener('click',async()=>{await client.auth.signOut();location.reload()});
 $('searchBtn').addEventListener('click',()=>{page=0;loadPeople()});
 $('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=0;loadPeople()},400)});
 $('country').addEventListener('change',()=>{
   selectedStates.clear();
   $('statesDropdown').open=false;
   stateFiltersChanged();
 });
 $('statesSelectAll').addEventListener('click',()=>{
   if($('country').value!== 'VE')$('country').value='VE';
   selectedStates.clear();
   availableStates.forEach(state=>selectedStates.add(state));
   stateFiltersChanged();
 });
 $('statesClear').addEventListener('click',()=>{
   selectedStates.clear();
   stateFiltersChanged();
 });
 $('statesDropdown').addEventListener('toggle',()=>{
   renderStateControl();
 });
 $('prev').addEventListener('click',()=>{if(page>0){page--;loadPeople()}});
 $('next').addEventListener('click',()=>{if((page+1)*limit<total){page++;loadPeople()}});
 $('clearSelection').addEventListener('click',()=>{selected.clear();renderPeople();banner('Selección vaciada.')});
 $('selectAllResults').addEventListener('click',async()=>{
  const b=$('selectAllResults');busy(b,true,'Seleccionando…');
  try{const ids=await call('admin_correos_ids',query(),28000);(ids||[]).forEach(id=>selected.add(Number(id)));renderPeople();banner('Se agregaron todos los integrantes elegibles que coinciden con el filtro. Total seleccionado: '+selected.size+'.')}
  catch(e){banner('No se pudo seleccionar el conjunto: '+e.message,true)}
  finally{busy(b,false)}
 });
 $('previewAudience').addEventListener('click',async()=>{const b=$('previewAudience');busy(b,true,'Validando…');try{await validateAudience()}catch(e){banner(e.message,true)}finally{busy(b,false)}});
 ['subject','heading','bodyText','buttonText','buttonUrl'].forEach(id=>$(id).addEventListener('input',renderPreview));
 $('templateSelect').addEventListener('change',()=>{const i=Number($('templateSelect').value);if($('templateSelect').value!=='')applyTemplate(templates[i])});
 $('saveTemplate').addEventListener('click',saveTemplate);
 $('testEmail').addEventListener('click',sendTest);
 $('createCampaign').addEventListener('click',createCampaign);
 $('cancelActive').addEventListener('click',cancelCurrent);
 $('checkSendStatus').addEventListener('click',async()=>{
  const button=$('checkSendStatus');busy(button,true,'Comprobando…');
  try{
   const state=await refreshLastSendStatus();
   if(Number(state.enviados||0)>0)banner('Confirmado por el proveedor: '+state.enviados+' correo(s).');
   else banner('El proveedor aún no confirma el envío. Pendientes: '+Number(state.pendientes||0)+'.');
  }catch(e){banner('No se pudo comprobar: '+e.message,true)}
  finally{busy(button,false)}
 });
}
document.addEventListener('DOMContentLoaded',async()=>{
 if(!client){$('loginError').textContent='No se pudo cargar el módulo de autenticación. Verifica tu conexión.';$('loginError').hidden=false;return}
 events();
 try{
  const {data:{session}}=await client.auth.getSession();
  if(session)await initialize();
 }catch(e){$('loginError').textContent='No se pudo cargar el panel: '+e.message;$('loginError').hidden=false;$('loginView').hidden=false;$('app').hidden=true}
});
})();