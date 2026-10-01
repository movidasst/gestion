import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[c] ?? c));

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }
async function sha256(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function vars(job: Record<string, unknown>) {
  return {
    nombres: String(job.nombres ?? "").trim(),
    apellidos: String(job.apellidos ?? "").trim(),
    nombre_completo: `${job.nombres ?? ""} ${job.apellidos ?? ""}`.trim(),
    pais: String(job.pais_nombre ?? "").trim(),
    estado: String(job.estado_nombre ?? "").trim(),
    municipio: String(job.municipio ?? "").trim(),
    profesion: String(job.profesion ?? "").trim(),
    correo: String(job.correo ?? "").trim(),
  };
}
function interpolate(value: unknown, data: Record<string, string>, html = false) {
  return String(value ?? "").replace(/{{\s*([a-z_]+)\s*}}/gi, (_, key) => {
    const replacement = data[String(key).toLowerCase()] ?? "";
    return html ? esc(replacement) : replacement;
  });
}
function sanitizeAdminHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*(["']).*?\1/gi, "")
    .replace(/javascript:/gi, "");
}
function buildHtml(job: Record<string, unknown>) {
  const data = vars(job);
  const preheader = interpolate(job.preencabezado, data, true);
  const heading = interpolate(job.encabezado, data, true);
  const body = sanitizeAdminHtml(interpolate(job.cuerpo_html, data, true)).replace(/\r?\n/g, "<br>");
  const buttonText = interpolate(job.boton_texto, data, true);
  const rawUrl = interpolate(job.boton_url, data, false);
  const button = buttonText && /^https:\/\//i.test(rawUrl)
    ? `<div style="text-align:center;margin:28px 0"><a href="${esc(rawUrl)}" style="display:inline-block;background:#007b85;color:#fff;text-decoration:none;font-weight:800;padding:13px 22px;border-radius:12px">${buttonText}</a></div>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f2f7f8;font-family:Arial,sans-serif;color:#26465a">
  <div style="display:none;max-height:0;overflow:hidden">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f7f8;padding:24px 10px"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 36px rgba(0,32,91,.12)">
  <tr><td style="height:5px;background:linear-gradient(90deg,#ffcc00 0 33%,#164e9a 33% 66%,#cf2841 66%)"></td></tr>
  <tr><td style="padding:24px;text-align:center;border-bottom:1px solid #e5eef1">
    <img src="https://raw.githubusercontent.com/movidasst/gestion/main/assets/logo-movida-sst-plus.png" width="110" alt="La Movida SST Plus" style="display:block;margin:auto;max-width:110px">
    <div style="font-size:22px;font-weight:900;color:#00205b;margin-top:8px">La Movida SST Plus</div>
    <div style="font-size:12px;font-weight:800;color:#007b85;text-transform:uppercase;letter-spacing:.08em">De la Reacción a la Prevención</div>
  </td></tr>
  <tr><td style="padding:30px 34px"><h1 style="margin:0 0 20px;color:#00205b;font-size:26px;line-height:1.15">${heading}</h1>
  <div style="font-size:16px;line-height:1.7;color:#405f72">${body}</div>${button}</td></tr>
  <tr><td style="padding:22px 30px;background:#00205b;color:#dcebf0;text-align:center;font-size:12px;line-height:1.6">
    <strong style="color:#fff">La Movida SST Plus · Red Internacional</strong><br>
    <a href="https://www.movidasst.com" style="color:#ffca28">www.movidasst.com</a> · info@movidasst.com<br>
    Este mensaje fue enviado de forma individual a ${esc(data.correo)}.
  </td></tr></table></td></tr></table></body></html>`;
}
function plainText(html: string) {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
function delay(attempts: number, code: string) {
  if (code === "CAMPAIGN_QUOTA_RESERVED" || code === "MAIL_QUOTA_EXHAUSTED") return 1440;
  const ds = [5, 15, 60, 180, 360, 720, 1440];
  return ds[Math.min(Math.max(attempts - 1, 0), ds.length - 1)];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const emailSecret = Deno.env.get("MOODLE_EMAIL_SECRET")?.trim() ?? "";
  const scriptUrl = Deno.env.get("MOODLE_EMAIL_SCRIPT_URL")?.trim() ?? "";
  if (!url || !service || !emailSecret || !scriptUrl) return json({ error: "Email engine not configured" }, 500);
  const sb = createClient(url, service, { auth: { persistSession: false } });

  const { data: config, error: configError } = await sb.from("cola_correos_config")
    .select("cron_secret_sha256").eq("id", true).maybeSingle();
  if (configError || !config) return json({ error: "Queue config unavailable" }, 500);
  const received = req.headers.get("x-cron-secret") ?? "";
  if (!received || !safeEqual(await sha256(received), config.cron_secret_sha256)) return json({ error: "Unauthorized" }, 401);

  const { count: priorityCount, error: priorityError } = await sb.from("cola_correos_registro")
    .select("id", { count: "exact", head: true }).in("estado", ["pendiente", "procesando"]);
  if (priorityError) return json({ error: "Could not verify priority queue" }, 500);
  if ((priorityCount ?? 0) > 0) return json({ ok: true, skipped: "registration_emails_have_priority" });

  const { data: jobs, error: claimError } = await sb.rpc("reclamar_comunicaciones", { p_limite: 10 });
  if (claimError) return json({ error: claimError.message }, 500);
  const summary = { claimed: jobs?.length ?? 0, sent: 0, recovered: 0, reprogrammed: 0 };

  for (const job of jobs ?? []) {
    let resultCode = "";
    try {
      // Idempotencia persistente: si el proveedor ya confirmó este destinatario,
      // no se vuelve a enviar aunque el cierre de la cola hubiese fallado antes.
      const { data: confirmed, error: confirmedError } = await sb.from("comunicacion_entregas_confirmadas")
        .select("destinatario_id").eq("destinatario_id", job.id).maybeSingle();
      if (confirmedError) throw confirmedError;
      if (confirmed) {
        const { error: completeRecovered } = await sb.rpc("completar_comunicacion", { p_id: job.id });
        if (completeRecovered) throw completeRecovered;
        summary.recovered++;
        continue;
      }

      const { data: campaign, error: campaignError } = await sb.from("comunicacion_campanas").select("estado").eq("id", job.campana_id).single();
      if (campaignError) throw campaignError;
      if (!["enviando", "programada"].includes(campaign.estado)) {
        if (campaign.estado !== "cancelada") {
          const { error: releaseError } = await sb.from("comunicacion_destinatarios").update({estado_envio:"pendiente",bloqueado_at:null}).eq("id",job.id).eq("estado_envio","procesando");
          if (releaseError) throw releaseError;
        }
        continue;
      }
      const { data: exclusion, error: exclusionError } = await sb.from("comunicacion_exclusiones").select("correo").eq("correo", String(job.correo).trim().toLowerCase()).maybeSingle();
      if (exclusionError) throw exclusionError;
      if (exclusion) {
        const { error: excludeError } = await sb.from("comunicacion_destinatarios").update({estado_envio:"cancelado",bloqueado_at:null,ultimo_error:"Correo excluido antes del envío"}).eq("id",job.id).eq("estado_envio","procesando");
        if (excludeError) throw excludeError;
        continue;
      }
      const html = buildHtml(job);
      const data = vars(job);
      const subject = interpolate(job.asunto, data, false);
      const form = new URLSearchParams({
        action: "send_admin_campaign_email",
        secret: emailSecret,
        recipient: String(job.correo),
        subject,
        html_body: html,
        plain_body: plainText(html),
        campaign_id: String(job.campana_id),
        recipient_id: String(job.id),
      });
      const response = await fetch(scriptUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: form,
        redirect: "follow",
        signal: AbortSignal.timeout(25000),
      });
      const raw = await response.text();
      let result: Record<string, unknown>;
      try { result = JSON.parse(raw); } catch { throw new Error("Apps Script returned invalid JSON"); }
      resultCode = String(result.code ?? "");
      if (!response.ok || result.result !== "success") throw new Error(String(result.message ?? "Delivery not confirmed"));

      // Guardar confirmación ANTES de cerrar la cola. Si completar_comunicacion falla,
      // el siguiente intento encontrará este registro y cerrará sin reenviar.
      const { error: ledgerError } = await sb.from("comunicacion_entregas_confirmadas").upsert({
        destinatario_id: job.id,
        campana_id: job.campana_id,
        confirmado_at: new Date().toISOString(),
      }, { onConflict: "destinatario_id" });

      const { error: completeError } = await sb.rpc("completar_comunicacion", { p_id: job.id });
      if (!completeError) {
        if (ledgerError) console.error("Delivery sent and completed, but ledger write failed", ledgerError);
        summary.sent++;
        continue;
      }
      if (ledgerError) throw new Error(`Delivery sent but persistence failed: ${completeError.message}; ledger: ${ledgerError.message}`);
      throw new Error(`Delivery confirmed; queue completion pending: ${completeError.message}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const { error } = await sb.rpc("reprogramar_comunicacion", {
        p_id: job.id,
        p_error: `${resultCode ? `[${resultCode}] ` : ""}${message}`,
        p_demora_minutos: delay(Number(job.intentos ?? 1), resultCode),
      });
      if (error) console.error("Could not reprogram", error);
      summary.reprogrammed++;
    }
  }
  return json({ ok: true, ...summary });
});