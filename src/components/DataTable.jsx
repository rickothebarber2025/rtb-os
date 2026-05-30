export default function DataTable({ children, className = '' }) {
  return <div className={`table-wrap ${className}`}>{children}</div>;
}
