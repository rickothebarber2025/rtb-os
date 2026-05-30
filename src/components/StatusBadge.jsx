const toneMap = {
  danger: 'badge danger',
  default: 'badge',
  gold: 'badge gold',
  muted: 'badge muted',
  success: 'badge success',
  warning: 'badge warning',
};

export default function StatusBadge({ children, tone = 'default' }) {
  return <span className={toneMap[tone] || toneMap.default}>{children}</span>;
}
