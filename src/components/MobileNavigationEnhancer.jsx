import { useEffect } from 'react';

const DASHBOARD_GROUPS = [
  { id: 'overview', label: 'Overview' },
  { id: 'actions', label: 'Actions' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'team', label: 'Team' },
  { id: 'finance', label: 'Finance' },
];

function readSection() {
  if (typeof window === 'undefined') return null;
  return new URL(window.location.href).searchParams.get('section');
}

function writeSection(section) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('section', section);
  window.history.replaceState(window.history.state, '', url);
}

function scrollToNavigation(node) {
  if (!node || typeof window === 'undefined' || window.matchMedia('(min-width: 901px)').matches) return;
  window.requestAnimationFrame(() => {
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function setRovingTabState(buttons, activeId) {
  buttons.forEach((button) => {
    const selected = button.dataset.tabId === activeId;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.classList.toggle('active', selected);
  });
}

function attachArrowNavigation(container, buttons, selectTab) {
  const onKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const currentIndex = buttons.indexOf(document.activeElement);
    if (currentIndex < 0) return;

    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = buttons.length - 1;

    const next = buttons[nextIndex];
    next.focus();
    selectTab(next.dataset.tabId, false);
  };

  container.addEventListener('keydown', onKeyDown);
  return () => container.removeEventListener('keydown', onKeyDown);
}

function enhanceDashboard() {
  const page = document.querySelector('.dashboard-page');
  const originalNav = page?.querySelector('.dashboard-mobile-tabs');
  if (!page || !originalNav || originalNav.dataset.enhanced === 'true') return null;

  // DashboardPage owns its tab state in React when this marker is present.
  // Never attach duplicate listeners to a React-managed tab bar.
  if (originalNav.dataset.managed === 'react') return null;

  originalNav.dataset.enhanced = 'true';
  originalNav.setAttribute('role', 'tablist');
  originalNav.setAttribute('aria-label', 'Dashboard sections');

  const groupedSections = Array.from(page.querySelectorAll('[data-mobile-group]'));
  groupedSections.forEach((section) => {
    const heading = section.querySelector('h2')?.textContent?.trim().toLowerCase();
    const eyebrow = section.querySelector('.section-header span')?.textContent?.trim().toLowerCase();

    if (heading === 'leaderboard' || heading === 'commission profile' || eyebrow === 'performance' || eyebrow === 'roster') {
      section.dataset.mobileGroup = 'team';
    } else if (heading === 'recent runs' || eyebrow === 'payroll' || eyebrow === 'booth rent') {
      section.dataset.mobileGroup = 'finance';
    }
  });

  const availableIds = DASHBOARD_GROUPS
    .map((group) => group.id)
    .filter((id) => groupedSections.some((section) => section.dataset.mobileGroup === id));

  if (!availableIds.length) return null;

  originalNav.replaceChildren();
  const buttons = availableIds.map((id) => {
    const group = DASHBOARD_GROUPS.find((item) => item.id === id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dashboard-mobile-tabs__item';
    button.dataset.tabId = id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `dashboard-panel-${id}`);
    button.textContent = group?.label || id;

    if (id === 'actions') {
      const badgeText = page.querySelector('.priority-board__stat strong')?.textContent?.trim();
      if (badgeText && badgeText !== '0') {
        const badge = document.createElement('span');
        badge.className = 'mobile-nav-count';
        badge.textContent = badgeText;
        button.appendChild(badge);
      }
    }

    originalNav.appendChild(button);
    return button;
  });

  const firstPanelByGroup = new Set();
  groupedSections.forEach((section, index) => {
    const group = section.dataset.mobileGroup;
    section.setAttribute('role', 'tabpanel');
    if (!firstPanelByGroup.has(group)) {
      section.id = `dashboard-panel-${group}`;
      firstPanelByGroup.add(group);
    } else {
      section.id ||= `dashboard-panel-${group}-${index}`;
    }
  });

  const requestedSection = readSection();
  const activeId = availableIds.includes(requestedSection) ? requestedSection : availableIds[0];

  const selectTab = (id, shouldScroll = true) => {
    if (!availableIds.includes(id)) return;
    groupedSections.forEach((section) => {
      section.classList.toggle('is-active-mobile-tab', section.dataset.mobileGroup === id);
    });
    setRovingTabState(buttons, id);
    writeSection(id);
    if (shouldScroll) scrollToNavigation(originalNav);
  };

  const listeners = buttons.map((button) => {
    const onClick = () => selectTab(button.dataset.tabId);
    button.addEventListener('click', onClick);
    return () => button.removeEventListener('click', onClick);
  });

  const detachKeys = attachArrowNavigation(originalNav, buttons, selectTab);
  selectTab(activeId, false);

  return () => {
    listeners.forEach((detach) => detach());
    detachKeys();
  };
}

export default function MobileNavigationEnhancer() {
  useEffect(() => {
    let cleanup = null;
    let scheduled = false;

    const applyEnhancement = () => {
      scheduled = false;
      cleanup?.();
      cleanup = enhanceDashboard();
    };

    const scheduleEnhancement = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(applyEnhancement);
    };

    scheduleEnhancement();
    const observer = new MutationObserver(scheduleEnhancement);
    const root = document.getElementById('root');
    if (root) observer.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      cleanup?.();
    };
  }, []);

  return null;
}
