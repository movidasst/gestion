(() => {
  'use strict';

  const q = (id) => document.getElementById(id);
  const nf = (n) => Number(n || 0).toLocaleString('es');
  let drawerDirty = false;
  let incidentState = null;

  function injectStyles() {
    if (q('gestionHardeningStyles')) return;
    const style = document.createElement('style');
    style.id = 'gestionHardeningStyles';
    style.textContent = `
      .incident-panel{margin:0 0 18px;background:#fff;border:1px solid #dce7eb;border-radius:20px;box-shadow:0 8px 28px rgba(0,32,91,.06);overflow:hidden}
      .incident-head{padding:14px 16px;border-bottom:1px solid #dce7eb;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .incident-head h3{margin:0;color:#00205b;font-size:1rem}.incident-head small{color:#647b8d;margin-left:auto}
      .incident-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;padding:13px}
      .incident-card{border:1px solid #dce7eb;background:#f9fbfc;border-radius:15px;padding:12px;text-align:left;color:#17324a}
      .incident-card:hover{border-color:#007b85;background:#f1fbfa}.incident-card b{display:block;font-size:1.25rem;color:#00205b}.incident-card span{display:block;margin-top:4px;font-size:.69rem;font-weight:800;color:#647b8d}
      .incident-card.danger{border-color:#ffd3da;background:#fff7f8}.incident-card.warn{border-color:#ffe4a8;background:#fffbef}
      .incident-modal{position:fixed;z-index:180;inset:5vh max(8px,calc((100vw - 980px)/2));background:#fff;border-radius:24px;box-shadow:0 30px 90px rgba(0,32,91,.34);display:none;flex-direction:column;overflow:hidden}
      .incident-modal.show{display:flex}.incident-modal-head{padding:14px 16px;border-bottom:1px solid #dce7eb;display:flex;align-items:center;gap:10px}.incident-modal-head h3{margin:0;color:#00205b}.incident-modal-head button{margin-left:auto}
      .incident-modal-body{overflow:auto;padding:12px}.incident-row{border:1px solid #dce7eb;border-radius:15px;padding:12px;margin-bottom:8px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start}.incident-row h4{margin:0;color:#00205b}.incident-row p{margin:4px 0;color:#647b8d;font-size:.73rem;word-break:break-word}.incident-error{color:#a92c40!important;font-weight:700}
      .hardening-help{margin-top:6px;color:#647b8d;font-size:.7rem;line-height:1.4}
      @media(max-width:900px){.incident-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:640px){
        .incident-grid{grid-template-columns:1fr 1fr;padding:10px}.incident-modal{inset:2vh 6px}
        #membersModule .table-wrap{overflow:visible}#membersModule .data-table{min-width:0;display:block}#membersModule .data-table thead{display:none}#membersModule .data-table tbody{display:grid;gap:10px;padding:10px;background:#f5f9fa}
        #membersModule .data-table tbody tr{display:block;background:#fff;border:1px solid #dce7eb;border-radius:17px;overflow:hidden;box-shadow:0 5px 16px rgba(0,32,91,.05)}
        #membersModule .data-table tbody td{display:grid;grid-template-columns:92px minmax(0,1fr);gap:8px;align-items:center;padding:9px 11px;border-bottom:1px solid #edf2f4;min-height:42px}
        #membersModule .data-table tbody td:first-child{display:block;padding:12px}#membersModule .data-table tbody td:last-child{border-bottom:0}
        #membersModule .data-table tbody td:not(:first-child)::before{content:attr(data-label);font-size:.62rem;text-transform:uppercase;letter-spacing:.04em;color:#718798;font-weight:900}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureIncidentUI() {
    if (!q('membersModule') || q('gestionIncidentPanel')) return;
    const panel = document.createElement('section');
    panel.id = 'gestionIncidentPanel';
    panel.className = 'incident-panel';
    panel.innerHTML = `
      <div class="incident-head"><h3><i class="fa-solid fa-triangle-exclamation" style="color:#ffb600;margin-right:7px"></i>Centro de incidencias</h3><small id="incidentUpdated">Actualizando…</small></div>
      <div class="incident-grid">
        <button class="incident-card" data-incident="NO_SOLICITADO"><b id="incNoSolicitado">—</b><span>Sin Moodle · histórico</span></button>
        <button class="incident-card warn" data-incident="PENDIENTE"><b id="incPendiente">—</b><span>Pendientes / procesando</span></button>
        <button class="incident-card warn" data-incident="PENDIENTE_VERIFICACION"><b id="incVerificacion">—</b><span>Pendientes de verificación</span></button>
        <button class="incident-card danger" data-incident="ERROR"><b id="incError">—</b><span>Errores Moodle</span></button>
        <button class="incident-card danger" data-incident="SIN_ID"><b id="incSinId">—</b><span>Creado/existente sin ID</span></button>
      </div>`;
    const stats = q('membersModule').querySelector('.stats');
    if (stats) stats.insertAdjacentElement('afterend', panel);
    panel.querySelectorAll('[data-incident]').forEach((btn) => btn.addEventListener('click', () => openIncidentDetail(btn.dataset.incident)));

    const modal = document.createElement('section');
    modal.id = 'gestionIncidentModal';
    modal.className = 'incident-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `<div class="incident-modal-head"><div><h3 id="incidentModalTitle">Incidencias</h3><div class="person-sub" id="incidentModalSubtitle">—</div></div><button id="incidentModalClose" class="btn btn-secondary"><i class="fa-solid fa-xmark"></i> Cerrar</button></div><div id="incidentModalBody" class="incident-modal-body"></div>`;
    document.body.appendChild(modal);
    q('incidentModalClose').addEventListener('click', closeIncidentDetail);
  }

  async function refreshIncidents() {
    ensureIncidentUI();
    if (typeof sb === 'undefined' || !q('gestionIncidentPanel')) return;
    try {
      const { data, error } = await sb.rpc('admin_gestion_incidencias_resumen');
      if (error) throw error;
      incidentState = data || {};
      q('incNoSolicitado').textContent = nf(data.moodle_no_solicitado);
      q('incPendiente').textContent = nf(data.moodle_pendiente);
      q('incVerificacion').textContent = nf(data.moodle_verificacion);
      q('incError').textContent = nf(data.moodle_error);
      q('incSinId').textContent = nf(data.moodle_sin_id);
      const unresolved = Number(data.moodle_no_solicitado || 0) + Number(data.moodle_pendiente || 0) + Number(data.moodle_verificacion || 0) + Number(data.moodle_error || 0) + Number(data.moodle_sin_id || 0) + Number(data.correos_pendientes || 0) + Number(data.correos_fallidos || 0);
      if (q('statProcesses')) q('statProcesses').textContent = nf(unresolved);
      if (q('incidentUpdated')) q('incidentUpdated').textContent = `Moodle + correos · ${new Date(data.actualizado_at || Date.now()).toLocaleTimeString('es', {hour:'2-digit', minute:'2-digit'})}`;
    } catch (error) {
      console.warn('No se pudo actualizar Centro de incidencias', error);
      if (q('incidentUpdated')) q('incidentUpdated').textContent = 'No se pudo actualizar';
    }
  }

  async function openIncidentDetail(status) {
    if (typeof sb === 'undefined') return;
    const labels = {NO_SOLICITADO:'Sin Moodle · histórico',PENDIENTE:'Pendientes / procesando',PENDIENTE_VERIFICACION:'Pendientes de verificación',ERROR:'Errores Moodle',SIN_ID:'Creado/existente sin ID'};
    q('incidentModalTitle').textContent = labels[status] || 'Incidencias Moodle';
    q('incidentModalSubtitle').textContent = 'Máximo 500 registros por consulta';
    q('incidentModalBody').innerHTML = '<div class="empty"><div class="spinner"></div></div>';
    q('gestionIncidentModal').classList.add('show');
    q('gestionIncidentModal').setAttribute('aria-hidden', 'false');
    try {
      const { data, error } = await sb.rpc('admin_gestion_incidencias_detalle', { p_estado: status, p_limit: 500 });
      if (error) throw error;
      const rows = data || [];
      q('incidentModalSubtitle').textContent = `${nf(rows.length)} registro${rows.length === 1 ? '' : 's'} mostrado${rows.length === 1 ? '' : 's'}`;
      q('incidentModalBody').innerHTML = rows.length ? rows.map((r) => `
        <article class="incident-row">
          <div><h4>${escapeHtml(`${r.nombres || ''} ${r.apellidos || ''}`.trim() || `Integrante #${r.id}`)}</h4>
          <p>${escapeHtml(r.documento || 'Sin documento')} · ${escapeHtml(r.correo || 'Sin correo')} · ${escapeHtml(r.codigo_integrante || '')}</p>
          <p><b>${escapeHtml(r.moodle_sync_status || 'Sin estado')}</b>${r.moodle_pending_user_id ? ` · Moodle pendiente #${escapeHtml(r.moodle_pending_user_id)}` : ''}</p>
          ${r.moodle_sync_error ? `<p class="incident-error">${escapeHtml(r.moodle_sync_error)}</p>` : ''}
          ${r.moodle_pending_reason ? `<p>${escapeHtml(r.moodle_pending_reason)}</p>` : ''}</div>
          <button class="btn btn-secondary" data-open-member="${Number(r.id)}"><i class="fa-solid fa-address-card"></i> Abrir ficha</button>
        </article>`).join('') : '<div class="empty"><i class="fa-solid fa-circle-check"></i>No hay incidencias en este estado.</div>';
      q('incidentModalBody').querySelectorAll('[data-open-member]').forEach((btn) => btn.addEventListener('click', () => {
        const id = Number(btn.dataset.openMember);
        closeIncidentDetail();
        try { if (typeof openMember === 'function') openMember(id); } catch (e) { console.warn(e); }
      }));
    } catch (error) {
      q('incidentModalBody').innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(error.message || 'No se pudo consultar la incidencia.')}</div>`;
    }
  }

  function closeIncidentDetail() {
    const modal = q('gestionIncidentModal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadMembersCsv(rows, filename) {
    const cols = ['id','nombres','apellidos','documento','pais_iso2','pais_nombre','estado','municipio','correo','telefono_e164','whatsapp_username','edad','genero','grado','carrera','laboral','moodle_sync_status','correo_estado'];
    const csv = '\ufeff' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  }

  function replaceExportButton() {
    const old = q('exportBtn');
    if (!old || old.dataset.hardened === '1') return;
    const clone = old.cloneNode(true);
    clone.dataset.hardened = '1';
    old.replaceWith(clone);
    clone.addEventListener('click', () => {
      try {
        if (typeof state === 'undefined' || !state.members?.length) return typeof toast === 'function' ? toast('No hay datos visibles para exportar.', true) : alert('No hay datos visibles para exportar.');
        downloadMembersCsv(state.members, `integrantes_pagina_${Number(state.page || 0) + 1}.csv`);
      } catch (e) { console.error(e); }
    });

    const allBtn = document.createElement('button');
    allBtn.id = 'exportFilteredBtn';
    allBtn.className = 'btn btn-secondary';
    allBtn.innerHTML = '<i class="fa-solid fa-file-export"></i><span>Exportar filtrados</span>';
    clone.insertAdjacentElement('afterend', allBtn);
    allBtn.addEventListener('click', exportFilteredMembers);
  }

  async function exportFilteredMembers() {
    if (typeof sb === 'undefined') return;
    const btn = q('exportFilteredBtn');
    const original = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Preparando…</span>'; }
    try {
      const base = {
        p_busqueda: q('searchInput')?.value.trim() || '',
        p_pais: q('countryFilter')?.value || '',
        p_estado: q('stateFilter')?.value || '',
        p_genero: q('genderFilter')?.value || '',
        p_laboral: q('workFilter')?.value || '',
        p_incompletos: Boolean(q('incompleteFilter')?.checked),
        p_limit: 100
      };
      const rows = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const { data, error } = await sb.rpc('admin_gestion_integrantes', { ...base, p_offset: offset });
        if (error) throw error;
        const chunk = data || [];
        if (!chunk.length) break;
        rows.push(...chunk);
        total = Number(chunk[0]?.total_count || rows.length);
        offset += chunk.length;
        if (chunk.length < 100) break;
      }
      if (!rows.length) throw new Error('No hay resultados para exportar.');
      downloadMembersCsv(rows, `integrantes_filtrados_${new Date().toISOString().slice(0,10)}.csv`);
      if (typeof toast === 'function') toast(`${nf(rows.length)} integrantes exportados de forma segura.`);
    } catch (error) {
      if (typeof toast === 'function') toast(error.message || 'No se pudo exportar.', true); else alert(error.message || 'No se pudo exportar.');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
  }

  function installDirtyGuard() {
    const drawer = q('memberDrawer');
    if (!drawer || drawer.dataset.dirtyGuard === '1') return;
    drawer.dataset.dirtyGuard = '1';
    drawer.addEventListener('input', (e) => { if (e.target.matches('input,select,textarea')) drawerDirty = true; }, true);
    drawer.addEventListener('change', (e) => { if (e.target.matches('input,select,textarea')) drawerDirty = true; }, true);
    new MutationObserver(() => { if (drawer.classList.contains('show')) setTimeout(() => { drawerDirty = false; }, 120); }).observe(drawer, { attributes:true, attributeFilter:['class'] });

    const guard = (e) => {
      if (!drawer.classList.contains('show') || !drawerDirty) return;
      if (!confirm('Tienes cambios sin guardar. ¿Deseas descartarlos y cerrar la ficha?')) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      } else drawerDirty = false;
    };
    q('drawerClose')?.addEventListener('click', guard, true);
    q('drawerCancel')?.addEventListener('click', guard, true);
    q('backdrop')?.addEventListener('click', guard, true);
    window.addEventListener('beforeunload', (e) => { if (drawer.classList.contains('show') && drawerDirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  function alignCompanyLimits() {
    const seats = q('companyCourseSeats');
    if (!seats || seats.dataset.limitAligned === '1') return;
    seats.dataset.limitAligned = '1';
    seats.max = '500';
    seats.insertAdjacentHTML('afterend', '<div class="hardening-help">Máximo operativo actual: 500 participantes por curso-empresa. Este límite coincide con importación e informes para evitar contratos que Gestión no pueda procesar completos.</div>');
    q('companyCourseSaveBtn')?.addEventListener('click', (e) => {
      const value = Number(seats.value || 0);
      if (value > 500) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (typeof toast === 'function') toast('El máximo operativo actual es 500 cupos por curso-empresa.', true); else alert('El máximo operativo actual es 500 cupos por curso-empresa.');
      }
    }, true);
  }

  function labelMemberRows() {
    const body = q('membersBody');
    if (!body) return;
    const labels = ['','Documento','País / ubicación','Contacto','Profesión / situación','Moodle','Correo','Acción'];
    body.querySelectorAll('tr').forEach((tr) => tr.querySelectorAll('td').forEach((td, i) => td.dataset.label = labels[i] || 'Dato'));
  }

  function installMemberRowObserver() {
    const body = q('membersBody');
    if (!body || body.dataset.mobileObserver === '1') return;
    body.dataset.mobileObserver = '1';
    new MutationObserver(labelMemberRows).observe(body, { childList:true, subtree:true });
    labelMemberRows();
  }

  function patchSummaryFunction() {
    try {
      if (typeof renderSummary === 'function' && !renderSummary.__hardened) {
        const original = renderSummary;
        const patched = function(d) { original(d); setTimeout(refreshIncidents, 0); };
        patched.__hardened = true;
        renderSummary = patched;
      }
    } catch (e) { console.warn('No se pudo extender renderSummary', e); }
  }

  function bindRefresh() {
    q('refreshBtn')?.addEventListener('click', () => setTimeout(refreshIncidents, 700));
  }

  function init() {
    injectStyles();
    ensureIncidentUI();
    replaceExportButton();
    installDirtyGuard();
    alignCompanyLimits();
    installMemberRowObserver();
    patchSummaryFunction();
    bindRefresh();
    setTimeout(refreshIncidents, 700);
    setTimeout(refreshIncidents, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
