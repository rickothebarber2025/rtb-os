import { createPortal } from 'react-dom';
import AdminChecklistDashboard from './AdminChecklistDashboard';

export default function AdminChecklistDashboardMount({ businessUnitId, target }) {
  if (!target) return null;
  return createPortal(<AdminChecklistDashboard businessUnitId={businessUnitId} />, target);
}
