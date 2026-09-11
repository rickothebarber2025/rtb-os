import {
  BarChart3,
  BellRing,
  Brain,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  IdCard,
  LayoutDashboard,
  MessageSquareText,
  Plug,
  UserCog,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundSearch,
  Users,
  WalletCards,
} from 'lucide-react';

export const NAV_ITEMS = [
  { group: 'Command', id: 'dashboard', label: 'Command Center', icon: LayoutDashboard },
  { group: 'Command', id: 'action-center', label: 'Action Center', icon: BellRing },
  { group: 'Messages', id: 'staff-hub', label: 'Staff Messages', icon: IdCard },
  { group: 'Profile', id: 'my-role', label: 'My Role', icon: UserCog },
  { group: 'Team & Pay', id: 'payroll', label: 'Payroll', icon: CircleDollarSign },
  { group: 'Team & Pay', id: 'staff', label: 'Staff', icon: Users },
  { group: 'Team & Pay', id: 'talent-pipeline', label: 'Talent Pipeline', icon: UserRoundSearch },
  { group: 'Operations', id: 'operations', label: 'Daily Operations', icon: ClipboardCheck },
  { group: 'Team & Pay', id: 'performance', label: 'Performance', icon: BarChart3 },
  { group: 'Operations', id: 'marketing-calendar', label: 'Marketing Calendar', icon: CalendarDays },
  { group: 'Team & Pay', id: 'finance', label: 'Financial Buddy', icon: WalletCards },
  { group: 'Appointments', id: 'customer-intelligence', label: 'Client Signals', icon: MessageSquareText },
  { group: 'Operations', id: 'ai-consultant', label: 'AI Consultant', icon: Brain },
  { group: 'Administration', id: 'ada-control', label: 'A.R.V.I.S. Control', icon: ShieldCheck },
  { group: 'Administration', id: 'access', label: 'Access', icon: ShieldCheck },
  { group: 'Administration', id: 'integrations', label: 'Connections', icon: Plug },
  { group: 'Administration', id: 'system', label: 'System Tools', icon: SlidersHorizontal },
];

export const LOW_SALES_THRESHOLD = 500;
export const ADJUSTED_COMMISSION_RATE = 55;
export const FIXED_RATE_LOW_SALES_ADJUSTMENT = 5;
export const ENTRY_DEDUCTION = 5;
