export default function EmptyState({ action, icon: Icon, message, title }) {
  return (
    <div className="empty-state">
      {Icon ? <Icon size={30} /> : null}
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}
