(() => {
  'use strict';
  const q = (id) => document.getElementById(id);

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

  function init() {
    updateEvaluationCopy();
    improveAccessibility();
    addIncidentHints();
    improveExternalLinks();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
