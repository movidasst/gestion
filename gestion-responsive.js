/* Gestión SST · navegación presentacional. Todos los clics se delegan a los módulos originales. */
(() => {
  'use strict';
  const app = document.getElementById('appView');
  const original = app && app.querySelector('.module-nav');
  if (!app || !original || app.querySelector('.gestion-mobile-nav')) return;

  const entries = Array.from(original.querySelectorAll('button.module-tab[data-module]'));
  const known = new Map(entries.map(button => [button.dataset.module, button]));
  const primary = [
    ['members', 'Integrantes', 'fa-users'],
    ['consultas', 'Consultas', 'fa-magnifying-glass'],
    ['academy', 'Academia', 'fa-graduation-cap'],
    ['payments', 'Pagos', 'fa-receipt']
  ];
  const secondary = [
    ['evaluations', 'Evaluaciones', 'fa-file-circle-check'],
    ['feedbacks', 'Encuestas', 'fa-chart-column'],
    ['communications', 'Comunicaciones', 'fa-paper-plane']
  ];
  if ([...primary, ...secondary].some(([id]) => !known.has(id))) return;

  const nav = document.createElement('nav');
  nav.className = 'gestion-mobile-nav';
  nav.setAttribute('aria-label', 'Navegación de Gestión SST');
  const buttons = new Map();
  const menuButtons = new Map();

  function createButton(id, label, iconClass, extraClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = extraClass;
    button.dataset.navModule = id;
    button.setAttribute('aria-label', label);
    const icon = document.createElement('i');
    icon.className = 'fa-solid ' + iconClass;
    icon.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span');
    caption.className = 'gestion-nav-label';
    caption.textContent = label;
    button.append(icon, caption);
    return button;
  }

  const moreButton = createButton('more', 'Más', 'fa-ellipsis', 'gestion-dock-btn');
  const menu = document.createElement('div');
  menu.id = 'gestionMobileMore';
  menu.className = 'gestion-more-menu';
  menu.hidden = true;
  moreButton.setAttribute('aria-haspopup', 'true');
  moreButton.setAttribute('aria-controls', menu.id);
  moreButton.setAttribute('aria-expanded', 'false');

  function closeMenu(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    moreButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) moreButton.focus();
  }

  function navigate(id) {
    closeMenu();
    const sourceButton = known.get(id);
    if (!sourceButton) return;
    /* Ejecutar exclusivamente el controlador existente (Supabase, Moodle, pagos, etc.). */
    sourceButton.click();
    sync();
    if (window.matchMedia('(max-width:780px)').matches) {
      const topbar = app.querySelector('.topbar');
      const y = Math.max(0, (topbar ? topbar.getBoundingClientRect().bottom + window.scrollY : 0) - 70);
      if (window.scrollY > y + 160) window.scrollTo({top:y,behavior:'instant'});
    }
  }

  primary.forEach(([id, label, icon]) => {
    const button = createButton(id, label, icon, 'gestion-dock-btn');
    button.addEventListener('click', () => navigate(id));
    nav.appendChild(button);
    buttons.set(id, button);
  });

  secondary.forEach(([id, label, icon]) => {
    const button = createButton(id, label, icon, 'gestion-more-item');
    button.addEventListener('click', () => navigate(id));
    menu.appendChild(button);
    menuButtons.set(id, button);
  });
  const menuTitle = document.createElement('p');
  menuTitle.className = 'gestion-more-title';
  menuTitle.textContent = 'Otros módulos de gestión';
  menu.prepend(menuTitle);

  moreButton.addEventListener('click', () => {
    const opening = menu.hidden;
    menu.hidden = !opening;
    moreButton.setAttribute('aria-expanded', String(opening));
    if (opening) menuButtons.values().next().value?.focus();
  });
  nav.appendChild(moreButton);
  nav.appendChild(menu);
  app.appendChild(nav);

  const moduleKeys = new Set([...primary, ...secondary].map(([key]) => key));
  function selectedModule() {
    const active = entries.find(button => button.classList.contains('active'));
    return active && moduleKeys.has(active.dataset.module) ? active.dataset.module : 'members';
  }
  function countFor(id) {
    const badge = id === 'payments' ? document.getElementById('paymentsPendingBadge')
      : id === 'evaluations' ? document.getElementById('evaluationsPendingBadge') : null;
    if (!badge || badge.hidden) return '';
    const count = Number((badge.textContent || '').trim());
    return Number.isFinite(count) && count > 0 ? String(count > 99 ? '99+' : count) : '';
  }
  function setBadge(button, count, isMenu) {
    if (!button) return;
    let element = button.querySelector(isMenu ? '.gestion-more-count' : '.gestion-nav-badge');
    if (!count) { if (element) element.remove(); return; }
    if (!element) {
      element = document.createElement('span');
      element.className = isMenu ? 'gestion-more-count' : 'gestion-nav-badge';
      button.appendChild(element);
    }
    element.textContent = count;
  }
  function sync() {
    const current = selectedModule();
    buttons.forEach((button, id) => {
      const active = id === current;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    menuButtons.forEach((button, id) => {
      const active = id === current;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const moreActive = menuButtons.has(current);
    moreButton.classList.toggle('active', moreActive);
    if (moreActive) moreButton.setAttribute('aria-current', 'page');
    else moreButton.removeAttribute('aria-current');
    setBadge(buttons.get('payments'), countFor('payments'), false);
    setBadge(menuButtons.get('evaluations'), countFor('evaluations'), true);
  }

  /* Escuchar cambios de estado en la navegación original sin modificar sus eventos. */
  new MutationObserver(sync).observe(original, {
    subtree:true,attributes:true,attributeFilter:['class','hidden'],childList:true,characterData:true
  });
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !nav.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) closeMenu(true);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 780) closeMenu();
  }, {passive:true});
  sync();
  /* La navegación original se oculta únicamente después de crear el reemplazo funcional. */
  app.classList.add('gestion-ui-ready');
})();
