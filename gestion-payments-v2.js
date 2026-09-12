(() => {
  'use strict';
  const q = (id) => document.getElementById(id);
  const reviewMap = new Map();

  async function loadReviews() {
    try {
      const ids = (state?.payments?.rows || []).map(r => Number(r.submission_id)).filter(Boolean);
      reviewMap.clear();
      if (!ids.length) return;
      const { data, error } = await sb.rpc('admin_pago_revisiones', { p_submission_ids: ids });
      if (error) throw error;
      (data || []).forEach(r => reviewMap.set(Number(r.submission_id), r));
    } catch (e) {
      console.warn('No se pudieron cargar revisiones de pago', e);
    }
  }

  function ensureFilters() {
    const select = q('paymentStatusFilter');
    if (!select || select.dataset.reviewV2 === '1') return;
    select.dataset.reviewV2 = '1';
    select.insertAdjacentHTML('beforeend', '<option value="observed">Observados</option><option value="rejected">Rechazados</option>');
  }

  function badge(review) {
    if (!review) return '';
    const rejected = review.estado === 'rechazado';
    return `<span class="badge ${rejected ? 'danger' : 'warn'}"><i class="fa-solid ${rejected ? 'fa-circle-xmark' : 'fa-triangle-exclamation'}"></i> ${rejected ? 'Rechazado' : 'Observado'}</span><div class="person-sub" title="${safe(review.motivo || '')}">${safe(review.motivo || '')}</div>`;
  }

  function applyReviewsToTable() {
    ensureFilters();
    const filter = q('paymentStatusFilter')?.value || 'pending';
    let visible = 0;
    q('paymentsBody')?.querySelectorAll('tr').forEach(tr => {
      const button = tr.querySelector('[data-payment-view]');
      const submissionId = Number(button?.dataset.paymentView || 0);
      const row = (state?.payments?.rows || []).find(r => Number(r.submission_id) === submissionId);
      const review = reviewMap.get(submissionId);
      const processed = Boolean(row?.processed);
      let show = true;
      if (filter === 'pending') show = !processed && !review;
      if (filter === 'processed') show = processed;
      if (filter === 'observed') show = !processed && review?.estado === 'observado';
      if (filter === 'rejected') show = !processed && review?.estado === 'rechazado';
      if (filter === 'all') show = true;
      tr.hidden = !show;
      if (show) visible++;
      if (review && !processed) {
        const cells = tr.querySelectorAll('td');
        if (cells.length >= 2) cells[cells.length - 2].innerHTML = badge(review);
      }
    });
    if (q('paymentsEmpty')) q('paymentsEmpty').hidden = visible > 0;
    const rows = state?.payments?.rows || [];
    const newPending = rows.filter(r => !r.processed && !reviewMap.has(Number(r.submission_id))).length;
    const observed = rows.filter(r => !r.processed && reviewMap.get(Number(r.submission_id))?.estado === 'observado').length;
    const rejected = rows.filter(r => !r.processed && reviewMap.get(Number(r.submission_id))?.estado === 'rechazado').length;
    if (q('paymentsPending')) q('paymentsPending').textContent = Number(newPending).toLocaleString('es');
    const badgeEl = q('paymentsPendingBadge');
    if (badgeEl) { badgeEl.textContent = Number(newPending + observed).toLocaleString('es'); badgeEl.hidden = !(newPending + observed); }
    const notice = q('paymentCoverageNotice');
    if (notice && (observed || rejected)) {
      const base = notice.textContent || '';
      const suffix = ` · Revisión administrativa: ${observed} observado${observed === 1 ? '' : 's'}, ${rejected} rechazado${rejected === 1 ? '' : 's'}.`;
      if (!base.includes('Revisión administrativa:')) notice.textContent = base + suffix;
    }
  }

  function patchRenderPayments() {
    try {
      if (typeof renderPayments !== 'function' || renderPayments.__reviewV2) return;
      const original = renderPayments;
      const patched = function(...args) {
        original(...args);
        applyReviewsToTable();
      };
      patched.__reviewV2 = true;
      renderPayments = patched;
    } catch (e) { console.warn('No se pudo ampliar renderPayments', e); }
  }

  function patchLoadPayments() {
    try {
      if (typeof loadPayments !== 'function' || loadPayments.__reviewV2) return;
      const original = loadPayments;
      const patched = async function(...args) {
        const result = await original(...args);
        await loadReviews();
        renderPayments();
        return result;
      };
      patched.__reviewV2 = true;
      loadPayments = patched;
    } catch (e) { console.warn('No se pudo ampliar loadPayments', e); }
  }

  function reviewCard(row) {
    const current = reviewMap.get(Number(row.submission_id));
    let card = q('paymentReviewCard');
    if (!card) {
      card = document.createElement('div');
      card.id = 'paymentReviewCard';
      card.className = 'evidence-card';
      const approval = q('paymentApproveBtn')?.closest('.evidence-approval');
      if (approval) approval.parentElement.insertBefore(card, approval);
    }
    const processed = Boolean(row.processed);
    card.innerHTML = `<h4>Revisión administrativa</h4>
      ${current && !processed ? `<p><b>${current.estado === 'rechazado' ? 'Rechazado' : 'Observado'}:</b> ${safe(current.motivo || '')}</p>` : '<p>Registra una observación cuando el comprobante necesite aclaración, o recházalo cuando no corresponda aprobarlo.</p>'}
      ${processed ? '<p>Esta entrega ya fue calificada en Moodle.</p>' : '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px"><button id="paymentObserveBtnV2" class="btn btn-warning" type="button"><i class="fa-solid fa-comment-dots"></i> Observar</button><button id="paymentRejectBtnV2" class="btn btn-danger" type="button"><i class="fa-solid fa-circle-xmark"></i> Rechazar</button></div>'}`;
    q('paymentObserveBtnV2')?.addEventListener('click', () => saveReview(row, 'observado'));
    q('paymentRejectBtnV2')?.addEventListener('click', () => saveReview(row, 'rechazado'));
  }

  function patchOpenPayment() {
    try {
      if (typeof openPaymentEvidence !== 'function' || openPaymentEvidence.__reviewV2) return;
      const original = openPaymentEvidence;
      const patched = async function(...args) {
        await original(...args);
        const row = state?.payments?.current;
        if (row) reviewCard(row);
      };
      patched.__reviewV2 = true;
      openPaymentEvidence = patched;
    } catch (e) { console.warn('No se pudo ampliar el modal de pago', e); }
  }

  async function saveReview(row, estado) {
    const verb = estado === 'rechazado' ? 'rechazar' : 'marcar como observado';
    const reason = prompt(`Motivo para ${verb} este comprobante:`)?.trim() || '';
    if (!reason) return;
    if (reason.length < 3) return toast('Indica un motivo más descriptivo.', true);
    if (!confirm(`¿Confirmas ${verb} el comprobante de ${row.student?.fullname || 'este estudiante'}? Esto no modificará Moodle.`)) return;
    showLoading(true);
    try {
      const { error } = await sb.rpc('admin_pago_revision_guardar', {
        p_submission_id: Number(row.submission_id),
        p_assignment_id: Number(row.assignment?.id || 0) || null,
        p_moodle_user_id: Number(row.moodle_user_id || 0) || null,
        p_moodle_course_id: Number(row.course?.id || 0) || null,
        p_estado: estado,
        p_motivo: reason
      });
      if (error) throw error;
      toast(estado === 'rechazado' ? 'Comprobante rechazado y registrado. Moodle no fue modificado.' : 'Comprobante observado y registrado. Moodle no fue modificado.');
      closePaymentEvidence();
      await loadReviews();
      renderPayments();
    } catch (e) { toast(e.message || 'No se pudo guardar la revisión.', true); }
    finally { showLoading(false); }
  }

  function bindFilter() {
    ensureFilters();
    const select = q('paymentStatusFilter');
    if (!select || select.dataset.reviewBound === '1') return;
    select.dataset.reviewBound = '1';
    select.addEventListener('change', () => setTimeout(applyReviewsToTable, 0));
  }

  async function init() {
    patchRenderPayments();
    patchLoadPayments();
    patchOpenPayment();
    bindFilter();
    if (state?.payments?.loaded) {
      await loadReviews();
      renderPayments();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void init(), { once: true });
  else void init();
})();
