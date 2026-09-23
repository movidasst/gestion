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
      .incident-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:9px;padding:13px}
      .incident-card{border:1px solid #dce7eb;background:#f9fbfc;border-radius:15px;padding:12px;text-align:left;color:#17324a}
      .incident-card:hover{border-color:#007b85;background:#f1fbfa}.incident-card b{display:block;font-size:1.25rem;color:#00205b}.incident-card span{display:block;margin-top:4px;font-size:.69rem;font-weight:800;color:#647b8d}
      .incident-card.danger{border-color:#ffd3da;background:#fff7f8}.incident-card.warn{border-color:#ffe4a8;background:#fffbef}
      .incident-modal{position:fixed;z-index:180;inset:5vh max(8px,calc((100vw - 980px)/2));background:#fff;border-radius:24px;box-shadow:0 30px 90px rgba(0,32,91,.34);display:none;flex-direction:column;overflow:hidden}
      .incident-modal.show{display:flex}.incident-modal-head{padding:14px 16px;border-bottom:1px solid #dce7eb;display:flex;align-items:center;gap:10px}.incident-modal-head h3{margin:0;color:#00205b}.incident-modal-head button{margin-left:auto}
      .incident-modal-body{overflow:auto;padding:12px}.incident-row{border:1px solid #dce7eb;border-radius:15px;padding:12px;margin-bottom:8px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start}.incident-row h4{margin:0;color:#00205b}.incident-row p{margin:4px 0;color:#647b8d;font-size:.73rem;word-break:break-word}.incident-error{color:#a92c40!important;font-weight:700}.incident-guide{margin-top:10px;padding:10px;border:1px solid #e5edf0;border-radius:12px;background:#f8fbfc}.incident-guide strong{display:block;color:#00205b;margin-bottom:3px}.incident-guide p{margin:0 0 8px}.incident-guide p:last-child{margin-bottom:0}.incident-compare{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px}.incident-compare span{padding:5px 8px;border-radius:9px;background:#eef5f7;font-size:.68rem;font-weight:800;color:#28445b}
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
      <div class="incident-head"><h3><i class="fa-solid fa-triangle-exclamation" style="color:#ffb600;margin-right:7px"></i>Centro de incidencias y conciliación Moodle</h3><small id="incidentUpdated">Actualizando…</small><button id="reconcileHistoricalBtn" class="btn btn-primary" type="button"><i class="fa-solid fa-link"></i> Reconciliar históricos</button></div>
      <div class="incident-grid">
        <button class="incident-card" data-incident="NO_SOLICITADO"><b id="incNoSolicitado">—</b><span>Históricos por reconciliar</span></button>
        <button class="incident-card warn" data-incident="PENDIENTE"><b id="incPendiente">—</b><span>Pendientes / procesando</span></button>
        <button class="incident-card warn" data-incident="PENDIENTE_VERIFICACION"><b id="incVerificacion">—</b><span>Pendientes de verificación</span></button>
        <button class="incident-card warn" data-incident="NO_ENCONTRADO"><b id="incNoEncontrado">—</b><span>No encontrados en Moodle</span></button>
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
    q('reconcileHistoricalBtn').addEventListener('click', reconcileHistoricalMoodle);
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
      q('incNoEncontrado').textContent = nf(data.moodle_no_encontrado);
      q('incError').textContent = nf(data.moodle_error);
      q('incSinId').textContent = nf(data.moodle_sin_id);
      const historical = Number(data.moodle_no_solicitado || 0);
      const unresolved = Number(data.moodle_no_encontrado || 0) + Number(data.moodle_pendiente || 0) + Number(data.moodle_verificacion || 0) + Number(data.moodle_error || 0) + Number(data.moodle_sin_id || 0) + Number(data.correos_pendientes || 0) + Number(data.correos_fallidos || 0);
      if (q('statProcesses')) q('statProcesses').textContent = nf(unresolved);
      if (q('reconcileHistoricalBtn')) {
        q('reconcileHistoricalBtn').disabled = historical === 0;
        q('reconcileHistoricalBtn').title = historical ? `${nf(historical)} históricos pendientes de comparar con Moodle` : 'No hay históricos pendientes de reconciliar';
      }
      if (q('incidentUpdated')) q('incidentUpdated').textContent = `Moodle + correos · ${new Date(data.actualizado_at || Date.now()).toLocaleTimeString('es', {hour:'2-digit', minute:'2-digit'})}`;
    } catch (error) {
      console.warn('No se pudo actualizar Centro de incidencias', error);
      if (q('incidentUpdated')) q('incidentUpdated').textContent = 'No se pudo actualizar';
    }
  }

  function incidentLinkedMemberId(row) {
    const match = String(row?.moodle_pending_reason || '').match(/integrante\s+#(\d+)/i);
    return match ? Number(match[1]) : 0;
  }

  function incidentGuidance(row) {
    const status = String(row?.moodle_sync_status || '').toUpperCase();
    const reason = String(row?.moodle_pending_reason || row?.moodle_sync_error || '').trim();
    const candidateId = Number(row?.moodle_pending_user_id || 0);
    const linkedMemberId = incidentLinkedMemberId(row);
    const document = String(row?.documento || '').trim();
    const moodleUsername = String(row?.moodle_pending_username || '').trim();

    if (status === 'PENDIENTE' || status === 'PROCESANDO') {
      return {
        what: Number(row?.moodle_sync_attempts || 0) === 0
          ? 'La ficha quedó pendiente y nunca llegó a ejecutar la creación o vinculación con Moodle.'
          : 'La sincronización quedó pendiente o en proceso y necesita reintentarse.',
        how: 'Pulsa “Procesar ahora”. Gestión buscará primero si la persona ya existe en Moodle y, si no existe, seguirá el flujo normal de creación.',
        action: 'retry'
      };
    }

    if (status === 'PENDIENTE_VERIFICACION' && linkedMemberId) {
      return {
        what: `La cuenta Moodle #${candidateId || '—'} ya está vinculada a otra ficha (#${linkedMemberId}). El sistema bloqueó el vínculo para evitar dos integrantes usando la misma cuenta.`,
        how: 'Compara ambas fichas. Si son la misma persona, hay que fusionar el duplicado y conservar una sola ficha. Si son personas distintas, no se debe mover el ID Moodle.',
        action: 'compare',
        linkedMemberId
      };
    }

    if (status === 'PENDIENTE_VERIFICACION' && candidateId) {
      return {
        what: 'El correo coincide con una cuenta Moodle, pero el documento registrado en Gestión no coincide exactamente con el usuario/documento de Moodle.',
        how: 'Comprueba que el correo y la persona sean correctos. Si confirmas que es la misma persona, “Confirmar vínculo” asignará ese ID a la ficha en Supabase sin modificar la cuenta Moodle.',
        action: 'confirm'
      };
    }

    if (status === 'NO_ENCONTRADO') {
      return {
        what: 'La conciliación no encontró una cuenta Moodle por documento, usuario ni correo.',
        how: 'Revisa primero documento y correo. Si son correctos, la cuenta puede crearse mediante el flujo normal de sincronización.',
        action: 'none'
      };
    }

    if (status === 'ERROR') {
      return {
        what: reason || 'La sincronización devolvió un error técnico.',
        how: 'Abre la ficha y revisa el detalle técnico. Si el ID Moodle ya está usado por otra ficha, compara ambas antes de hacer cambios.',
        action: 'none'
      };
    }

    return {
      what: reason || 'El caso necesita revisión administrativa.',
      how: 'Abre la ficha, comprueba documento, correo y vínculo Moodle antes de modificarla.',
      action: 'none'
    };
  }

  async function processPendingIncident(id, button) {
    if (!confirm('Se ejecutará el flujo normal de Moodle para esta persona: primero buscará una cuenta existente y, si no existe, podrá crearla. ¿Continuar?')) return;
    button.disabled = true;
    try {
      await academyApi('retry_moodle_sync', { integrante_id: id });
      if (typeof toast === 'function') toast('Sincronización Moodle procesada.');
      await refreshIncidents();
      await openIncidentDetail('PENDIENTE');
      try { if (typeof loadMembers === 'function') await loadMembers(); } catch (e) { console.warn(e); }
    } catch (error) {
      if (typeof toast === 'function') toast(error.message || 'No fue posible procesar la sincronización.', true);
      button.disabled = false;
    }
  }

  async function confirmIncidentMoodleLink(row, button) {
    const candidateId = Number(row?.moodle_pending_user_id || 0);
    if (!candidateId) return;
    const currentDocument = String(row?.documento || '—');
    const moodleUsername = String(row?.moodle_pending_username || '—');
    const email = String(row?.correo || row?.moodle_pending_email || '—');
    const message = `Confirma que esta es la misma persona.\n\nGestión: documento ${currentDocument}\nMoodle: usuario/documento ${moodleUsername}\nCorreo coincidente: ${email}\n\nSe vinculará Moodle #${candidateId} en Supabase. NO se modificará la cuenta Moodle. ¿Continuar?`;
    if (!confirm(message)) return;

    button.disabled = true;
    try {
      await academyApi('confirm_moodle_link', {
        integrante_id: Number(row.id),
        moodle_user_id: candidateId
      });
      if (typeof toast === 'function') toast(`Moodle #${candidateId} vinculado correctamente.`);
      await refreshIncidents();
      await openIncidentDetail('PENDIENTE_VERIFICACION');
      try { if (typeof loadMembers === 'function') await loadMembers(); } catch (e) { console.warn(e); }
    } catch (error) {
      if (typeof toast === 'function') toast(error.message || 'No fue posible confirmar el vínculo.', true);
      button.disabled = false;
    }
  }

  async function openIncidentDetail(status) {
    if (typeof sb === 'undefined') return;
    const labels = {NO_SOLICITADO:'Históricos por reconciliar',PENDIENTE:'Pendientes / procesando',PENDIENTE_VERIFICACION:'Pendientes de verificación',NO_ENCONTRADO:'No encontrados en Moodle',ERROR:'Errores Moodle',SIN_ID:'Creado/existente sin ID'};
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
      q('incidentModalBody').innerHTML = rows.length ? rows.map((r) => {
        const guide = incidentGuidance(r);
        const linkedId = Number(guide.linkedMemberId || 0);
        const compare = r.moodle_pending_user_id ? `<div class="incident-compare"><span>Gestión: ${escapeHtml(r.documento || '—')}</span><span>Moodle: ${escapeHtml(r.moodle_pending_username || 'sin usuario visible')}</span><span>ID Moodle: #${escapeHtml(r.moodle_pending_user_id)}</span></div>` : '';
        const actions = [
          `<button class="btn btn-secondary" data-open-member="${Number(r.id)}"><i class="fa-solid fa-address-card"></i> Abrir ficha</button>`,
          guide.action === 'retry' ? `<button class="btn btn-warning" data-process-pending="${Number(r.id)}"><i class="fa-solid fa-rotate-right"></i> Procesar ahora</button>` : '',
          guide.action === 'confirm' ? `<button class="btn btn-primary" data-confirm-link="${Number(r.id)}"><i class="fa-solid fa-link"></i> Confirmar vínculo</button>` : '',
          linkedId ? `<button class="btn btn-secondary" data-open-linked="${linkedId}"><i class="fa-solid fa-code-compare"></i> Abrir ficha #${linkedId}</button>` : ''
        ].filter(Boolean).join('');
        return `
        <article class="incident-row">
          <div><h4>${escapeHtml(`${r.nombres || ''} ${r.apellidos || ''}`.trim() || `Integrante #${r.id}`)}</h4>
          <p>${escapeHtml(r.documento || 'Sin documento')} · ${escapeHtml(r.correo || 'Sin correo')} · ${escapeHtml(r.codigo_integrante || '')}</p>
          <p><b>${escapeHtml(r.moodle_sync_status || 'Sin estado')}</b>${r.moodle_pending_user_id ? ` · Moodle candidato #${escapeHtml(r.moodle_pending_user_id)}` : ''}</p>
          ${compare}
          <div class="incident-guide"><strong>¿Qué pasó?</strong><p>${escapeHtml(guide.what)}</p><strong>¿Cómo resolverlo?</strong><p>${escapeHtml(guide.how)}</p></div>
          ${r.moodle_sync_error ? `<details class="incident-technical"><summary>Ver detalle técnico</summary><code>${escapeHtml(r.moodle_sync_error)}</code></details>` : ''}
          </div>
          <div class="incident-actions">${actions}</div>
        </article>`;
      }).join('') : '<div class="empty"><i class="fa-solid fa-circle-check"></i>No hay incidencias en este estado.</div>';
      q('incidentModalBody').querySelectorAll('[data-open-member]').forEach((btn) => btn.addEventListener('click', () => {
        const id = Number(btn.dataset.openMember);
        closeIncidentDetail();
        try { if (typeof openMember === 'function') openMember(id); } catch (e) { console.warn(e); }
      }));
      q('incidentModalBody').querySelectorAll('[data-open-linked]').forEach((btn) => btn.addEventListener('click', () => {
        const id = Number(btn.dataset.openLinked);
        closeIncidentDetail();
        try { if (typeof openMember === 'function') openMember(id); } catch (e) { console.warn(e); }
      }));
      q('incidentModalBody').querySelectorAll('[data-process-pending]').forEach((btn) => btn.addEventListener('click', () => processPendingIncident(Number(btn.dataset.processPending), btn)));
      q('incidentModalBody').querySelectorAll('[data-confirm-link]').forEach((btn) => btn.addEventListener('click', () => {
        const row = rows.find((item) => Number(item.id) === Number(btn.dataset.confirmLink));
        if (row) confirmIncidentMoodleLink(row, btn);
      }));
    } catch (error) {
      q('incidentModalBody').innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(error.message || 'No se pudo consultar la incidencia.')}</div>`;
    }
  }

  async function reconcileHistoricalMoodle() {
    if (typeof academyApi !== 'function') {
      if (typeof toast === 'function') toast('No está disponible la conexión administrativa con Moodle.', true);
      return;
    }
    const initial = Number(incidentState?.moodle_no_solicitado || 0);
    if (!initial) {
      if (typeof toast === 'function') toast('No hay históricos pendientes de reconciliar.');
      return;
    }
    if (!confirm(`Se compararán ${nf(initial)} registros históricos con Moodle. La operación NO creará usuarios, NO cambiará contraseñas y NO modificará cuentas Moodle. Solo guardará en Supabase vínculos inequívocos. ¿Continuar?`)) return;

    const button = q('reconcileHistoricalBtn');
    const original = button?.innerHTML || '';
    let processed = 0;
    let linked = 0;
    let verification = 0;
    let notFound = 0;
    let conflicts = 0;
    let remaining = initial;
    let batches = 0;

    if (button) button.disabled = true;

    try {
      while (remaining > 0 && batches < 100) {
        batches += 1;
        if (button) button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Reconciliando · ${nf(processed)} procesados`;

        const result = await academyApi('reconcile_historical_moodle', { limit: 50 });
        const summary = result?.summary || {};
        const batchProcessed = Number(summary.processed || 0);

        processed += batchProcessed;
        linked += Number(summary.linked || 0);
        verification += Number(summary.verification || 0);
        notFound += Number(summary.not_found || 0);
        conflicts += Number(summary.conflicts || 0);
        remaining = Number(summary.remaining || 0);

        await refreshIncidents();
        if (batchProcessed === 0) break;
      }

      try { if (typeof loadMembers === 'function') await loadMembers(); } catch (e) { console.warn(e); }

      const message = `Reconciliación terminada: ${nf(linked)} vinculados, ${nf(verification)} para verificar y ${nf(notFound)} no encontrados. Moodle no fue modificado.`;
      if (typeof toast === 'function') toast(message);
      else alert(message);

      if (remaining > 0) {
        console.warn(`La conciliación se detuvo con ${remaining} históricos aún pendientes.`);
      }
      if (conflicts > 0) {
        console.info(`${conflicts} coincidencia(s) ya estaban vinculadas a otra ficha y quedaron para verificación manual.`);
      }
    } catch (error) {
      console.error('No se pudo completar la reconciliación histórica', error);
      if (typeof toast === 'function') toast(error.message || 'No se pudo completar la reconciliación histórica.', true);
      else alert(error.message || 'No se pudo completar la reconciliación histórica.');
    } finally {
      if (button) {
        button.innerHTML = original;
        button.disabled = false;
      }
      await refreshIncidents();
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
