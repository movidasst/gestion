(() => {
  'use strict';

  function patchAcademyPaymentApi() {
    try {
      if (typeof academyApi !== 'function' || academyApi.__paymentsV2) return;
      const previous = academyApi;
      const routed = async function(action, payload = {}) {
        if (!['payment_submissions', 'approve_payment'].includes(action)) return previous(action, payload);
        try {
          const current = state?.payments?.current;
          const body = { action, ...payload };
          if (current?.assignment?.id && !body.assignment_id) body.assignment_id = Number(current.assignment.id);
          const { data, error } = await sb.functions.invoke('moodle-payments-v2', { body });
          if (error) {
            let message = error.message || 'No se pudo ejecutar el proceso de pago.';
            try { const detail = await error.context?.json(); if (detail?.error) message = detail.error; } catch {}
            throw new Error(message);
          }
          if (!data?.ok) throw new Error(data?.error || 'Moodle rechazó la operación de pago.');
          return data.data || data;
        } catch (error) {
          // Las consultas pueden volver al motor anterior sin efectos secundarios.
          if (action === 'payment_submissions') {
            console.warn('Pagos v2 no disponible; usando lectura anterior.', error);
            return previous(action, payload);
          }
          throw error;
        }
      };
      routed.__paymentsV2 = true;
      academyApi = routed;
    } catch (e) { console.warn('No se pudo activar Pagos v2', e); }
  }

  function patchPaymentFile() {
    try {
      if (typeof fetchPaymentFile !== 'function' || fetchPaymentFile.__paymentsV2) return;
      const routed = async function(submissionId, fileIndex) {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) throw new Error('La sesión administrativa venció.');
        const row = (state?.payments?.rows || []).find(item => Number(item.submission_id) === Number(submissionId));
        const response = await fetch(`${SUPABASE_URL}/functions/v1/moodle-payments-v2`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'payment_file',
            submission_id: Number(submissionId),
            assignment_id: Number(row?.assignment?.id || 0) || undefined,
            file_index: Number(fileIndex)
          })
        });
        if (!response.ok) {
          let message = `No se pudo abrir el comprobante (${response.status}).`;
          try { const detail = await response.json(); if (detail?.error) message = detail.error; } catch {}
          throw new Error(message);
        }
        return response.blob();
      };
      routed.__paymentsV2 = true;
      fetchPaymentFile = routed;
    } catch (e) { console.warn('No se pudo activar el visor de Pagos v2', e); }
  }

  function updatePaymentCopy() {
    const module = document.getElementById('paymentsModule');
    if (!module) return;
    const heroP = module.querySelector('.hero p');
    if (heroP) heroP.textContent = 'Revisa comprobantes enviados en Moodle, registra observaciones o rechazos y aprueba el acceso con trazabilidad.';
    const label = document.getElementById('paymentCourseLabel');
    if (label && !label.dataset.aliasV2) {
      label.dataset.aliasV2 = '1';
      const observer = new MutationObserver(() => {
        const txt = label.textContent || '';
        if (txt.includes('cursos detectados automáticamente') && !txt.includes('alias')) label.textContent = txt + ' · reconoce variantes de comprobante de pago';
      });
      observer.observe(label, { childList: true, characterData: true, subtree: true });
    }
  }

  function init() {
    patchAcademyPaymentApi();
    patchPaymentFile();
    updatePaymentCopy();
    if (state?.payments?.loaded) {
      state.payments.loaded = false;
      if (!document.getElementById('paymentsModule')?.hidden) loadPayments().catch(e => toast(e.message, true));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
