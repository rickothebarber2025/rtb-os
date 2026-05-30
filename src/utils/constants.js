import {
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  LayoutDashboard,
  ReceiptText,
  Users,
} from 'lucide-react';

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'payroll', label: 'Payroll', icon: CircleDollarSign },
  { id: 'staff', label: 'Staff', icon: Users },
  { id: 'performance', label: 'Performance', icon: BarChart3 },
  { id: 'insights', label: 'Booksy Insights', icon: CalendarDays },
  { id: 'booth-rent', label: 'Booth Rent', icon: ReceiptText },
];

export const LOW_SALES_THRESHOLD = 500;
export const ADJUSTED_COMMISSION_RATE = 55;
export const ENTRY_DEDUCTION = 5;
