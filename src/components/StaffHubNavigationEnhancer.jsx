import { useEffect } from 'react';

const NAV_ITEMS = [
  { label: 'Work', description: 'Clock in, checklists, shop status, tasks and daily operations.' },
  { label: 'Home', description: 'Your personal overview, priorities and what matters today.' },
  { label: 'Money', description: 'Earnings, commission, tips and pay details.' },
  { label: 'Growth', description: 'Performance, goals, reviews and progress.' },
  { label: 'Schedule', description: 'Appointments, availability and time-off requests.' },
  { label: 'Team', description: 'Updates, policies, spotlight, profile and team resources.' },
];

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

function enhanceStaffHub() {
  const desktopList = document.querySelector('.staff-hub-tabs');
  const stickyList = document.querySelector('.staff-hub-sticky-tabs');
  if (!desktopList && !stickyList) return;

  enhanceTabList(desktopList);
  enhanceTabList(stickyList);

  const panel = desktopList?.closest('.staff-hub-tabs-panel');
  if (panel && !panel.querySelector('.staff-hub-human-nav-heading')) {
    const heading = document.createElement('div');
    heading.className = 'staff-hub-human-nav-heading';
    heading.innerHTML = '<div><strong>Staff Hub</strong><span>Choose what you need to do.</span></div><small class="staff-hub-human-nav-context"></small>';
    panel.insertBefore(heading, desktopList);
  }

  const activeButton = desktopList?.querySelector('button.active') || stickyList?.querySelector('button.active');
  const context = panel?.querySelector('.staff-hub-human-nav-context');
  if (context && activeButton) {
    context.textContent = activeButton.dataset.navDescription || '';
  }
}

export default function StaffHubNavigationEnhancer() {
  useEffect(() => {
    enhanceStaffHub();
    const observer = new MutationObserver(() => enhanceStaffHub());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return null;
}
