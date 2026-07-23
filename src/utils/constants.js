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
  UserCog,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

export const NAV_ITEMS = [
  { group: 'Workspace', id: 'dashboard', label: 'My Workspace', icon: LayoutDashboard },
  { group: 'Workspace', id: 'action-center', label: 'Action Center', icon: BellRing },
  { group: 'Workspace', id: 'staff-hub', label: 'Staff Hub', icon: IdCard },
  { group: 'Workspace', id: 'my-role', label: 'My Role', icon: UserCog },
  { group: 'Operations', id: 'payroll', label: 'Payroll', icon: CircleDollarSign },
  { group: 'Operations', id: 'staff', label: 'Roster', icon: Users },
  { group: 'Operations', id: 'insights', label: 'Appointments', icon: CalendarDays },
  { group: 'Operations', id: 'booth-rent', label: 'Booth Rent', icon: ReceiptText },
  { group: 'Operations', id: 'operations', label: 'Operations', icon: ClipboardCheck },
  { group: 'Intelligence', id: 'performance', label: 'Performance', icon: BarChart3 },
  { group: 'Intelligence', id: 'customer-intelligence', label: 'Customer IQ', icon: MessageSquareText },
  { group: 'Intelligence', id: 'ai-consultant', label: 'AI Consultant', icon: Brain },
  { group: 'Admin', id: 'access', label: 'Access', icon: ShieldCheck },
  { group: 'Admin', id: 'system', label: 'System Tools', icon: SlidersHorizontal },
];

export const LOW_SALES_THRESHOLD = 500;
export const ADJUSTED_COMMISSION_RATE = 55;
export const FIXED_RATE_LOW_SALES_ADJUSTMENT = 5;
export const ENTRY_DEDUCTION = 5;
