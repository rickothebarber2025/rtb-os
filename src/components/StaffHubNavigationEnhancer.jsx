import { useEffect } from 'react';

const NAV_ITEMS = [
  { label: 'Work', description: 'Clock in, checklists, shop status, tasks and daily operations.' },
  { label: 'Home', description: 'Your personal overview, priorities and what matters today.' },
  { label: 'Money', description: 'Earnings, commission, tips and pay details.' },
  { label: 'Growth', description: 'Performance, goals, reviews and progress.' },
  { label: 'Schedule', description: 'Appointments, availability and time-off requests.' },
  { label: 'Team', description: 'Updates, policies, spotlight, profile and team resources.' },
];

let currentProfile = null;

function rolePayload(profile) {
  const permissions = profile?.permissions && typeof profile.permissions === 'object' ? profile.permissions : {};
  return {
    template: String(permissions.role_template || '').trim(),
    title: String(profile?.role_title || permissions.role_title || profile?.role || 'Staff').trim(),
  };
}

function setButtonLabel(button, item) {
  if (!button || !item) return;
  button.dataset.humanNav = 'true';
  button.dataset.navLabel = item.label;
  button.dataset.navDescription = item.description;
  button.setAttribute('aria-label', `${item.label}. ${item.description}`);
  button.title = item.description;

  const span = button.querySelector(':scope > span');
  if (span) {
    if (span.textContent !== item.label) span.textContent = item.label;
    return;
  }

  const textNode = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode && textNode.textContent.trim() !== item.label) textNode.textContent = ` ${item.label}`;
}

function enhanceTabList(list) {
  if (!list) return;
  const buttons = [...list.querySelectorAll(':scope > button')];
  buttons.forEach((button, index) => setButtonLabel(button, NAV_ITEMS[index]));
}

function applyRoleContext() {
  if (!currentProfile) return;
  const role = rolePayload(currentProfile);
  if (!role.title) return;

  document.querySelectorAll('.staff-hub-account-card > strong, .staff-hub-pro-profile > div:first-child > span').forEach((node) => {
    if (node.textContent !== role.title) node.textContent = role.title;
  });

  const heroEyebrow = document.querySelector('.staff-hub-brand-lockup .eyebrow');
  if (heroEyebrow && role.template && role.template !== 'staff_portal') {
    const label = `${role.title} workspace`;
    if (heroEyebrow.textContent !== label) heroEyebrow.textContent = label;
  }

  const context = document.querySelector('.staff-hub-human-nav-context');
  const activeButton = document.querySelector('.staff-hub-tabs button.active, .staff-hub-sticky-tabs button.active');
  if (context) {
    const actionCopy = activeButton?.dataset.navDescription || 'Choose what you need to do.';
    const copy = `${role.title} · ${actionCopy}`;
    if (context.textContent !== copy) context.textContent = copy;
  }
}

function enhanceStaffHub() {
  const page = document.querySelector('.staff-hub-page');
  if (!page) return;

  const desktopList = page.querySelector('.staff-hub-tabs');
  const stickyList = page.querySelector('.staff-hub-sticky-tabs');
  enhanceTabList(desktopList);
  enhanceTabList(stickyList);

  const panel = desktopList?.closest('.staff-hub-tabs-panel');
  if (panel && !panel.querySelector('.staff-hub-human-nav-heading')) {
    const heading = document.createElement('div');
    heading.className = 'staff-hub-human-nav-heading';
    heading.innerHTML = '<div><strong>Staff Hub</strong><span>Choose what you need to do.</span></div><small class="staff-hub-human-nav-context"></small>';
    panel.insertBefore(heading, desktopList);
  }

  applyRoleContext();
}

export default function StaffHubNavigationEnhancer() {
  useEffect(() => {
    let scheduled = false;

    const scheduleEnhance = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        enhanceStaffHub();
      });
    };

    function onProfile(event) {
      if (event?.detail?.profile) currentProfile = event.detail.profile;
      scheduleEnhance();
    }

    window.addEventListener('rtb:auth-session-ready', onProfile);
    scheduleEnhance();

    // Only watch React mounting/unmounting nodes. Do not observe class/attribute
    // mutations; that previously caused repeated enhancer work during tab changes.
    const observer = new MutationObserver(scheduleEnhance);
    const root = document.getElementById('root');
    if (root) observer.observe(root, { childList: true, subtree: true });

    return () => {
      window.removeEventListener('rtb:auth-session-ready', onProfile);
      observer.disconnect();
    };
  }, []);

  return null;
}
