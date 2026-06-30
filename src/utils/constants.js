  import {
  BarChart3,
  BellRing,
  Brain,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  LayoutDashboard,
  MessageSquareText,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'action-center', label: 'Action Center', icon: BellRing },
  { id: 'payroll', label: 'Payroll', icon: CircleDollarSign },
  { id: 'staff', label: 'Roster', icon: Users },
  { id: 'performance', label: 'Performance', icon: BarChart3 },
  { id: 'insights', label: 'Appointment Insights', icon: CalendarDays },
  { id: 'customer-intelligence', label: 'Customer IQ', icon: MessageSquareText },
  { id: 'ai-consultant', label: 'AI Consultant', icon: Brain },
  { id: 'booth-rent', label: 'Booth Rent', icon: ReceiptText },
  { id: 'operations', label: 'Operations', icon: ClipboardCheck },
  { id: 'system', label: 'System Tools', icon: SlidersHorizontal },
  { id: 'access', label: 'Access', icon: ShieldCheck },
];

export const LOW_SALES_THRESHOLD = 500;
export const ADJUSTED_COMMISSION_RATE = 55;
export const ENTRY_DEDUCTION = 5;
