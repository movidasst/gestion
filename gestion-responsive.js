/* Gestión SST · navegación móvil para cuatro módulos. Sin lógica administrativa duplicada. */
(() => {
  'use strict';
  const app = document.getElementById('appView');
  const original = app && app.querySelector('.module-nav');
  if (!app || !original || app.querySelector('.gestion-mobile-nav')) return;
  const modules = [
    ['members', 'Integrantes', 'fa-users'],
    ['consultas', 'Consultas', 'fa-magnifying-glass'],
    ['academy', 'Academia', 'fa-graduation-cap'],
    ['payments', 'Pagos', 'fa-receipt']
  ];
  const sources = new Map(Array.from(original.querySelectorAll('button.module-tab[data-module]')).map(btn => [btn.dataset.module,btn]));
  if (modules.some(([id]) => !sources.has(id))) return;
  const nav = document.createElement('nav');
  nav.className = 'gestion-mobile-nav';
  nav.setAttribute('aria-label', 'Módulos de Gestión SST');
  const buttons = new Map();
  modules.forEach(([id,label,iconName]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gestion-dock-btn';
    button.setAttribute('aria-label', label);
    button.dataset.navModule = id;
    const icon = document.createElement('i');
    icon.className = 'fa-solid ' + iconName;
    icon.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span');
    caption.className = 'gestion-nav-label';
    caption.textContent = label;
    button.append(icon, caption);
    button.addEventListener('click', () => {
      sources.get(id).click();
      sync();
      if (window.innerWidth <= 780 && window.scrollY > 150) window.scrollTo({top:0,behavior:'instant'});
    });
    nav.appendChild(button);
    buttons.set(id,button);
  });
  app.appendChild(nav);
  function sync() {
    const active = Array.from(sources.entries()).find(([,btn]) => btn.classList.contains('active'))?.[0] || 'members';
    buttons.forEach((button,id) => {
      const isActive = active === id;
      button.classList.toggle('active', isActive);
      if (isActive) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    });
    const source = document.getElementById('paymentsPendingBadge');
    let count = source && !source.hidden ? Number(source.textContent.trim()) : 0;
    if (!Number.isFinite(count) || count < 0) count = 0;
    const button = buttons.get('payments');
    let badge = button.querySelector('.gestion-nav-badge');
    if (count > 0) {
      if (!badge) {badge=document.createElement('span');badge.className='gestion-nav-badge';button.appendChild(badge)}
      badge.textContent = count > 99 ? '99+' : String(count);
    } else if (badge) badge.remove();
  }
  new MutationObserver(sync).observe(original,{subtree:true,attributes:true,attributeFilter:['class','hidden'],characterData:true,childList:true});
  sync();
  app.classList.add('gestion-ui-ready');
})();
