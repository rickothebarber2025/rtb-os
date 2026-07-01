import { cloneElement, isValidElement } from 'react';
import { useAuthProfile } from '../contexts/AuthProfileContext.jsx';
import {
  getModulePermission,
  hasModulePermission,
  MODULE_LABELS,
} from '../lib/permissions.js';

export function useModuleToolbar(module) {
  const { profile } = useAuthProfile();
  const permission = getModulePermission(profile, module);

  return {
    canAdmin: hasModulePermission(profile, module, 'admin'),
    canEdit: hasModulePermission(profile, module, 'edit'),
    canView: hasModulePermission(profile, module, 'view'),
    isViewOnly: permission === 'view',
    permission,
  };
}

export function GatedAction({
  children,
  hideWhenNone = true,
  module,
  require = 'edit',
  tooltip,
}) {
  const { profile } = useAuthProfile();
  const permission = getModulePermission(profile, module);
  const allowed = hasModulePermission(profile, module, require);

  if (allowed) return <>{children}</>;
  if (permission === 'none' && hideWhenNone) return null;
  if (!isValidElement(children)) return null;

  const reason =
    tooltip ||
    `${MODULE_LABELS[module]} ${require} access is required. Your current access is ${permission}.`;

  return cloneElement(children, {
    disabled: true,
    onClick: undefined,
    title: reason,
  });
}
