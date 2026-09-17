(() => {
  'use strict';
  const q = (id) => document.getElementById(id);
  let deleteModalMember = null;

  function updateEvaluationCopy() {
    const module = q('evaluationsModule');
    if (!module) return;
    const heroP = module.querySelector('.hero p');
    if (heroP) heroP.textContent = 'Revisa y califica desde un solo lugar las entregas de las actividades Assignment de Moodle, sin depender del nombre que tenga cada tarea.';
    const panelHead = module.querySelector('.panel .panel-head h3');
    if (panelHead && /Tareas de todos los cursos/i.test(panelHead.textContent || '')) panelHead.innerHTML = '<i class="fa-solid fa-file-circle-check" style="color:var(--teal);margin-right:7px"></i>Actividades evaluables de todos los cursos';
    const note = module.querySelector('.evaluation-note');
    if (note) note.textContent = 'Detección por tipo real de actividad Moodle (Assignment). Se excluyen automáticamente las actividades identificadas como comprobantes de pago.';
    const stats = module.querySelectorAll('.stat small');
    stats.forEach(el => { if (/Tareas detectadas/i.test(el.textContent || '')) el.textContent = 'Assignments detectadas'; });
    const search = q('evaluationSearch');
    if (search) search.placeholder = 'Estudiante, curso o actividad';
  }

  function improveAccessibility() {
    const toast = q('toast');
    if (toast) { toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); toast.setAttribute('aria-atomic', 'true'); }
    document.querySelectorAll('button[title]').forEach(btn => { if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', btn.getAttribute('title') || 'Acción'); });
    const loading = q('loading');
    if (loading) { loading.setAttribute('role', 'status'); loading.setAttribute('aria-live', 'polite'); }
  }

  function addIncidentHints() {
    const body = q('incidentModalBody');
    if (!body || body.dataset.hintsV2 === '1') return;
    body.dataset.hintsV2 = '1';
    const apply = () => {
      body.querySelectorAll('.incident-row').forEach(row => {
        const error = row.querySelector('.incident-error');
        if (!error || row.querySelector('.reconcile-hint')) return;
        const text = (error.textContent || '').toLowerCase();
        if (text.includes('duplicate key') || text.includes('moodle_user_id_unico')) {
          const hint = document.createElement('p');
          hint.className = 'reconcile-hint';
          hint.style.cssText = 'margin-top:8px;padding:8px 10px;border-radius:10px;background:#fff2cf;color:#7b5200;font-weight:800;font-size:.72rem';
          hint.textContent = 'Conflicto de identidad Moodle: requiere reconciliación manual. No conviene reintentar automáticamente hasta comprobar qué integrante posee ese ID.';
          error.insertAdjacentElement('afterend', hint);
        }
      });
    };
    new MutationObserver(apply).observe(body, { childList: true, subtree: true });
    apply();
  }

  function improveExternalLinks() {
    document.querySelectorAll('a[target="_blank"]').forEach(a => {
      const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
      rel.add('noopener'); rel.add('noreferrer');
      a.setAttribute('rel', [...rel].join(' '));
    });
  }

  function digits(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function addMemberDeleteStyles() {
    if (q('memberDeleteStyles')) return;
    const style = document.createElement('style');
    style.id = 'memberDeleteStyles';
    style.textContent = `
      .member-delete-modal{position:fixed;inset:0;z-index:420;display:grid;place-items:center;padding:22px;background:rgba(0,20,48,.66);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:.18s}
      .member-delete-modal.show{opacity:1;pointer-events:auto}
      .member-delete-card{width:min(100%,560px);max-height:min(760px,calc(100dvh - 34px));overflow:auto;background:#fff;border-radius:24px;box-shadow:0 30px 90px rgba(0,20,48,.34);border:1px solid #f1c9cf}
      .member-delete-head{padding:18px 20px;display:flex;align-items:flex-start;gap:13px;border-bottom:1px solid var(--line)}
      .member-delete-icon{width:45px;height:45px;border-radius:14px;display:grid;place-items:center;flex:0 0 auto;background:#ffeaee;color:var(--danger);font-size:1.05rem}
      .member-delete-head h3{margin:1px 0 3px;color:var(--navy);font-size:1.05rem}
      .member-delete-head p{margin:0;color:var(--muted);font-size:.75rem;line-height:1.4}
      .member-delete-close{margin-left:auto}
      .member-delete-body{padding:18px 20px}
      .member-delete-person{padding:13px 14px;border-radius:16px;background:#f6fafb;border:1px solid var(--line);margin-bottom:12px}
      .member-delete-person b{display:block;color:var(--navy);font-size:.95rem}
      .member-delete-person span{display:block;color:var(--muted);font-size:.73rem;margin-top:3px}
      .member-delete-warning{padding:13px 14px;border-radius:16px;background:#fff3f5;border:1px solid #ffd0d7;color:#8d2636;font-size:.76rem;line-height:1.5;margin-bottom:14px}
      .member-delete-warning strong{display:block;margin-bottom:4px}
      .member-delete-help{margin:7px 0 0;color:#7d5a60;font-size:.7rem;line-height:1.45}
      .member-delete-actions{padding:14px 20px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:8px;background:#fbfdfe}
      #deleteMemberBtn{margin-right:auto}
      @media(max-width:600px){.member-delete-modal{padding:10px}.member-delete-card{border-radius:20px}.member-delete-actions{flex-direction:column-reverse}.member-delete-actions .btn{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function updateMemberDeleteConfirmState() {
    const input = q('memberDeleteConfirm');
    const button = q('memberDeleteConfirmBtn');
    if (!input || !button || !deleteModalMember) return;
    button.disabled = !digits(input.value) || digits(input.value) !== digits(deleteModalMember.documento);
  }

  function closeMemberDeleteModal() {
    const modal = q('memberDeleteModal');
    if (!modal) return;
    modal.classList.remove('show');
    window.setTimeout(() => { modal.hidden = true; }, 180);
    deleteModalMember = null;
  }

  function openMemberDeleteModal() {
    const member = (typeof state !== 'undefined' && state.current) ? state.current : null;
    if (!member) {
      if (typeof toast === 'function') toast('Abre primero la ficha del integrante que deseas eliminar.', true);
      return;
    }

    deleteModalMember = {
      id: Number(member.id),
      nombre: `${member.nombres || ''} ${member.apellidos || ''}`.trim() || `Integrante #${member.id}`,
      documento: String(member.documento || ''),
      pais: String(member.pais_nombre || member.pais_iso2 || ''),
      moodleUserId: member.moodle_user_id == null ? null : Number(member.moodle_user_id),
    };

    q('memberDeleteName').textContent = deleteModalMember.nombre;
    q('memberDeleteMeta').textContent = `Documento: ${deleteModalMember.documento || '—'}${deleteModalMember.pais ? ` · ${deleteModalMember.pais}` : ''}`;
    q('memberDeleteExpected').textContent = deleteModalMember.documento || 'el documento mostrado';
    q('memberDeleteConfirm').value = '';
    q('memberDeleteReason').value = '';
    q('memberDeleteMoodleNote').hidden = !deleteModalMember.moodleUserId;
    q('memberDeleteConfirmBtn').disabled = true;

    const modal = q('memberDeleteModal');
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('show'));
    q('memberDeleteConfirm').focus();
  }

  async function deleteCurrentMember() {
    const member = deleteModalMember;
    if (!member) return;

    const confirmation = q('memberDeleteConfirm').value.trim();
    if (!digits(confirmation) || digits(confirmation) !== digits(member.documento)) {
      if (typeof toast === 'function') toast('El documento de confirmación no coincide.', true);
      return;
    }

    const reason = q('memberDeleteReason').value.trim();
    const button = q('memberDeleteConfirmBtn');
    button.disabled = true;
    if (typeof showLoading === 'function') showLoading(true);

    try {
      const { data, error } = await sb.rpc('admin_gestion_integrante_eliminar', {
        p_id: member.id,
        p_documento_confirmacion: confirmation,
        p_motivo: reason || null,
      });
      if (error) throw error;

      closeMemberDeleteModal();
      if (typeof closeDrawer === 'function') closeDrawer();
      if (typeof loadAll === 'function') await loadAll();

      const keptMoodle = Boolean(data?.moodle_conservado);
      if (typeof toast === 'function') {
        toast(keptMoodle
          ? 'Integrante eliminado de Supabase. Su cuenta de Moodle se conservó.'
          : 'Integrante eliminado definitivamente de Supabase.');
      }
    } catch (error) {
      console.error('No se pudo eliminar el integrante', error);
      if (typeof toast === 'function') toast(error?.message || 'No se pudo eliminar el integrante.', true);
      updateMemberDeleteConfirmState();
    } finally {
      if (typeof showLoading === 'function') showLoading(false);
    }
  }

  function addMemberDeleteUi() {
    const footer = q('drawerFooter');
    if (!footer) return;
    addMemberDeleteStyles();

    if (!q('deleteMemberBtn')) {
      const button = document.createElement('button');
      button.id = 'deleteMemberBtn';
      button.type = 'button';
      button.className = 'btn btn-danger';
      button.innerHTML = '<i class="fa-solid fa-user-xmark"></i> Eliminar integrante';
      button.addEventListener('click', openMemberDeleteModal);
      footer.prepend(button);
    }

    if (!q('memberDeleteModal')) {
      const modal = document.createElement('section');
      modal.id = 'memberDeleteModal';
      modal.className = 'member-delete-modal';
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'false');
      modal.innerHTML = `
        <div class="member-delete-card" role="dialog" aria-modal="true" aria-labelledby="memberDeleteTitle">
          <div class="member-delete-head">
            <div class="member-delete-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
            <div><h3 id="memberDeleteTitle">Eliminar integrante</h3><p>Esta acción elimina el registro de la base central de Supabase y no se puede deshacer.</p></div>
            <button id="memberDeleteClose" class="icon-btn member-delete-close" type="button" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="member-delete-body">
            <div class="member-delete-person"><b id="memberDeleteName">—</b><span id="memberDeleteMeta">—</span></div>
            <div class="member-delete-warning">
              <strong>¿Qué se eliminará?</strong>
              El integrante desaparecerá del Directorio y de la base de integrantes. También se limpiarán sus puntos, respuestas, colas, aliases y demás relaciones configuradas para borrarse con el integrante. Los históricos que deben conservarse quedarán sin referencia personal.
              <p id="memberDeleteMoodleNote" class="member-delete-help" hidden><b>Importante:</b> la cuenta y las matrículas de Moodle no se eliminan con esta acción.</p>
            </div>
            <div class="field"><label for="memberDeleteConfirm">Confirma escribiendo el documento: <b id="memberDeleteExpected"></b></label><input id="memberDeleteConfirm" class="control" autocomplete="off" inputmode="numeric" placeholder="Escribe el documento"></div>
            <div class="field" style="margin-top:12px"><label for="memberDeleteReason">Motivo de eliminación (opcional)</label><textarea id="memberDeleteReason" class="control" maxlength="500" placeholder="Duplicado, registro de prueba, solicitud del integrante..."></textarea></div>
          </div>
          <div class="member-delete-actions"><button id="memberDeleteCancel" class="btn btn-secondary" type="button">Cancelar</button><button id="memberDeleteConfirmBtn" class="btn btn-danger" type="button" disabled><i class="fa-solid fa-trash-can"></i> Eliminar definitivamente</button></div>
        </div>`;
      document.body.appendChild(modal);

      q('memberDeleteClose').addEventListener('click', closeMemberDeleteModal);
      q('memberDeleteCancel').addEventListener('click', closeMemberDeleteModal);
      q('memberDeleteConfirm').addEventListener('input', updateMemberDeleteConfirmState);
      q('memberDeleteConfirmBtn').addEventListener('click', deleteCurrentMember);
      modal.addEventListener('click', (event) => { if (event.target === modal) closeMemberDeleteModal(); });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.hidden) closeMemberDeleteModal();
      });
    }
  }

  function init() {
    updateEvaluationCopy();
    improveAccessibility();
    addIncidentHints();
    improveExternalLinks();
    addMemberDeleteUi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
