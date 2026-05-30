export default function MetricCard({ icon: Icon, label, trend, value }) {
  return (
    <article className="metric-card">
      <div className="metric-card__icon">{Icon ? <Icon size={18} /> : null}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {trend ? <span>{trend}</span> : null}
      </div>
    </article>
  );
}
