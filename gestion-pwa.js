/* Opción instalar Centro de Gestión · sin acoplarse a lógica admin. */
(() => {
  'use strict';
  let deferredPrompt = null;
  let help = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const buttons = [];

  function refresh() {
    buttons.forEach(btn => { btn.hidden = standalone(); });
  }
  function dismissHelp() {
    if (help) { help.remove(); help = null; }
  }
  function showHelp() {
    dismissHelp();
    const apple = /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
      (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const android = /Android/i.test(navigator.userAgent);
    const guide = apple
      ? 'En Safari, toca Compartir y elige «Añadir a pantalla de inicio».'
      : android
        ? 'En Chrome, abre el menú de tres puntos (⋮) y selecciona «Instalar aplicación» o «Añadir a pantalla principal».'
        : 'En Chrome o Edge, utiliza «Instalar aplicación» en la barra de direcciones o en el menú del navegador.';
    help = document.createElement('aside');
    help.className = 'gestion-pwa-help';
    help.setAttribute('role', 'dialog');
    help.setAttribute('aria-label', 'Cómo instalar Gestión');
    const title = document.createElement('h3');
    title.textContent = 'Instalar Gestión';
    const copy = document.createElement('p');
    copy.textContent = guide;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'gestion-pwa-help-close';
    close.setAttribute('aria-label', 'Cerrar instrucciones');
    close.textContent = '×';
    close.addEventListener('click', dismissHelp);
    help.append(title, copy, close);
    document.body.append(help);
    close.focus();
  }
  async function install() {
    if (standalone()) return;
    if (!deferredPrompt) { showHelp(); return; }
    const event = deferredPrompt;
    deferredPrompt = null;
    try { await event.prompt(); await event.userChoice; }
    catch (_) { showHelp(); }
  }
  function makeButton(className, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gestion-pwa-install ' + className;
    btn.setAttribute('aria-label', 'Instalar Centro de Gestión como aplicación');
    btn.title = 'Instalar Gestión como aplicación';
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-download';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'gestion-pwa-label';
    text.textContent = label;
    btn.append(icon, text);
    btn.addEventListener('click', install);
    buttons.push(btn);
    return btn;
  }
  function init() {
    const form = document.getElementById('loginForm');
    const actions = document.querySelector('#appView .topbar-actions');
    if (form) form.insertAdjacentElement('afterend', makeButton('gestion-pwa-login', 'Instalar Gestión como app'));
    if (actions) actions.insertBefore(makeButton('gestion-pwa-header', 'Instalar app'), actions.firstChild);
    refresh();
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/sw.js', {scope: '/'}).catch(() => {});
    }
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    refresh();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; dismissHelp(); refresh(); });
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', refresh);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
