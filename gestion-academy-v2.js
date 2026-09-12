(() => {
  'use strict';
  const q = (id) => document.getElementById(id);

  function patchAcademyApi() {
    try {
      if (typeof academyApi !== 'function' || academyApi.__evaluationV2) return;
      const original = academyApi;
      const routed = async function(action, payload = {}) {
        if (!['evaluation_submissions', 'grade_submission'].includes(action)) return original(action, payload);
        const { data, error } = await sb.functions.invoke('moodle-evaluation-v2', { body: { action, ...payload } });
        if (error) {
          let message = error.message || 'No se pudo ejecutar la evaluación.';
          try { const detail = await error.context?.json(); if (detail?.error) message = detail.error; } catch {}
          throw new Error(message);
        }
        if (!data?.ok) throw new Error(data?.error || 'Moodle rechazó la operación.');
        return data.data || data;
      };
      routed.__evaluationV2 = true;
      academyApi = routed;
    } catch (e) { console.warn('No se pudo activar Evaluación v2', e); }
  }

  function patchEvaluationFile() {
    try {
      if (typeof fetchEvaluationFile !== 'function' || fetchEvaluationFile.__evaluationV2) return;
      const routed = async function(row, fileIndex) {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) throw new Error('La sesión administrativa venció.');
        const response = await fetch(`${SUPABASE_URL}/functions/v1/moodle-evaluation-v2`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'evaluation_file', assignment_id: row.assignment.id, submission_id: row.submission_id, file_index: fileIndex })
        });
        if (!response.ok) {
          let message = `No se pudo abrir el archivo (${response.status}).`;
          try { const detail = await response.json(); if (detail?.error) message = detail.error; } catch {}
          throw new Error(message);
        }
        return response.blob();
      };
      routed.__evaluationV2 = true;
      fetchEvaluationFile = routed;
    } catch (e) { console.warn('No se pudo activar visor v2', e); }
  }

  function patchOpenEvaluation() {
    try {
      if (typeof openEvaluation !== 'function' || openEvaluation.__evaluationV2) return;
      const original = openEvaluation;
      const patched = async function(...args) {
        await original(...args);
        const row = state?.evaluations?.current;
        if (!row) return;
        const maximum = Number(row.assignment?.grade || 0);
        const grade = q('evaluationGrade');
        const save = q('evaluationSaveBtn');
        const warning = q('evaluationGradeWarning');
        if (maximum > 0) {
          grade.disabled = false;
          save.disabled = false;
          q('evaluationGradeMaximum').textContent = `/ ${maximum}`;
          if (maximum === 100) {
            warning.hidden = true;
          } else {
            warning.hidden = false;
            warning.textContent = `Escala Moodle: ${maximum} puntos. Gestión convertirá proporcionalmente tu valoración 100/80/50/0 (por ejemplo, 80 equivale a ${(maximum * .8).toFixed(2).replace(/\.00$/, '')} puntos).`;
          }
        } else {
          grade.disabled = true;
          save.disabled = true;
          warning.hidden = false;
          warning.textContent = 'Esta actividad usa una escala no numérica. Evalúala directamente en Moodle.';
        }
      };
      patched.__evaluationV2 = true;
      openEvaluation = patched;
    } catch (e) { console.warn('No se pudo extender el formulario de evaluación', e); }
  }

  async function saveEvaluationV2() {
    const row = state?.evaluations?.current;
    if (!row) return;
    const semantic = Number(q('evaluationGrade')?.value);
    if (![0, 50, 80, 100].includes(semantic) || q('evaluationGrade').value === '') return toast('Selecciona 100, 80, 50 o 0.', true);
    const maximum = Number(row.assignment?.grade || 0);
    if (!(maximum > 0)) return toast('Esta actividad utiliza una escala no numérica y debe evaluarse directamente en Moodle.', true);
    const actual = Math.round((semantic / 100) * maximum * 100000) / 100000;
    const feedback = q('evaluationFeedback')?.value.trim() || '';
    const explanation = maximum === 100 ? `${semantic} puntos` : `${semantic}% de la escala = ${actual} de ${maximum} puntos`;
    if (!confirm(`¿Guardar ${explanation} para ${row.student?.fullname || 'este estudiante'} en “${row.assignment?.name || 'la actividad'}”?`)) return;
    showLoading(true);
    try {
      const result = await academyApi('grade_submission', { assignment_id: row.assignment.id, submission_id: row.submission_id, grade: semantic, feedback });
      const stored = Number(result.grade ?? actual);
      toast(maximum === 100 ? `Calificación ${semantic} guardada correctamente en Moodle.` : `Valoración ${semantic} aplicada: Moodle recibió ${stored} de ${maximum} puntos.`);
      closeEvaluation();
      await loadEvaluations();
    } catch (error) {
      toast(error.message || 'No se pudo guardar la calificación.', true);
    } finally { showLoading(false); }
  }

  function replaceSaveButton() {
    const old = q('evaluationSaveBtn');
    if (!old || old.dataset.evaluationV2 === '1') return;
    const clone = old.cloneNode(true);
    clone.dataset.evaluationV2 = '1';
    old.replaceWith(clone);
    clone.addEventListener('click', saveEvaluationV2);
  }

  function improveLabels() {
    const note = q('evaluationCoverageLabel');
    if (note && !note.dataset.v2) {
      note.dataset.v2 = '1';
      const observer = new MutationObserver(() => {
        if (!note.textContent.includes('actividades tipo Assignment')) {
          const match = note.textContent.match(/^(\d[\d.,]*)\s+tareas?\s+en\s+(\d[\d.,]*)\s+cursos?/i);
          if (match) note.textContent = `${match[1]} actividades tipo Assignment en ${match[2]} cursos · pagos excluidos`;
        }
      });
      observer.observe(note, { childList: true, characterData: true, subtree: true });
    }
  }

  function init() {
    patchAcademyApi();
    patchEvaluationFile();
    patchOpenEvaluation();
    replaceSaveButton();
    improveLabels();
    if (state?.evaluations?.loaded) {
      state.evaluations.loaded = false;
      if (!q('evaluationsModule')?.hidden) loadEvaluations().catch((e) => toast(e.message, true));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
