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

  const accountRole = document.querySelector('.staff-hub-account-card > strong');
  if (accountRole && accountRole.textContent !== role.title) accountRole.textContent = role.title;

  const proRole = document.querySelector('.staff-hub-pro-profile > div:first-child > span');
  if (proRole && proRole.textContent !== role.title) proRole.textContent = role.title;

  const heroEyebrow = document.querySelector('.staff-hub-brand-lockup .eyebrow');
  if (heroEyebrow && role.template && role.template !== 'staff_portal') {
    heroEyebrow.textContent = `${role.title} workspace`;
  }

  const context = document.querySelector('.staff-hub-human-nav-context');
  const activeButton = document.querySelector('.staff-hub-tabs button.active, .staff-hub-sticky-tabs button.active');
  if (context) {
    const actionCopy = activeButton?.dataset.navDescription || 'Choose what you need to do.';
    context.textContent = `${role.title} · ${actionCopy}`;
  }
}

function enhanceStaffHub() {
  const desktopList = document.querySelector('.staff-hub-tabs');
  const stickyList = document.querySelector('.staff-hub-sticky-tabs');
  if (!desktopList && !stickyList) {
    applyRoleContext();
    return;
  }

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
    function onProfile(event) {
      if (event?.detail?.profile) currentProfile = event.detail.profile;
      enhanceStaffHub();
    }

    window.addEventListener('rtb:auth-session-ready', onProfile);
    enhanceStaffHub();

    const observer = new MutationObserver(() => enhanceStaffHub());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    return () => {
      window.removeEventListener('rtb:auth-session-ready', onProfile);
      observer.disconnect();
    };
  }, []);

  return null;
}
