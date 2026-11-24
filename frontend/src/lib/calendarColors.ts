import type { CalendarSpace } from '@/models/schedule';

export interface CalendarColorTheme {
  accent: string;
  bgTint: string;
  borderTint: string;
}

const PALETTE: CalendarColorTheme[] = [
  {
    accent: '#10b981', // Emerald (Personal default)
    bgTint: 'rgba(16, 185, 129, 0.14)',
    borderTint: 'rgba(16, 185, 129, 0.35)',
  },
  {
    accent: '#38bdf8', // Sky
    bgTint: 'rgba(56, 189, 248, 0.14)',
    borderTint: 'rgba(56, 189, 248, 0.35)',
  },
  {
    accent: '#a78bfa', // Violet
    bgTint: 'rgba(167, 139, 250, 0.14)',
    borderTint: 'rgba(167, 139, 250, 0.35)',
  },
  {
    accent: '#f59e0b', // Amber
    bgTint: 'rgba(245, 158, 11, 0.14)',
    borderTint: 'rgba(245, 158, 11, 0.35)',
  },
  {
    accent: '#fb7185', // Rose
    bgTint: 'rgba(251, 113, 133, 0.14)',
    borderTint: 'rgba(251, 113, 133, 0.35)',
  },
  {
    accent: '#2dd4bf', // Teal
    bgTint: 'rgba(45, 212, 191, 0.14)',
    borderTint: 'rgba(45, 212, 191, 0.35)',
  },
  {
    accent: '#818cf8', // Indigo
    bgTint: 'rgba(129, 140, 248, 0.14)',
    borderTint: 'rgba(129, 140, 248, 0.35)',
  },
  {
    accent: '#fb923c', // Orange
    bgTint: 'rgba(251, 146, 60, 0.14)',
    borderTint: 'rgba(251, 146, 60, 0.35)',
  },
];

export function getCalendarColor(calendarId: string, calendars: CalendarSpace[]): CalendarColorTheme {
  const idx = calendars.findIndex((c) => c.id === calendarId);
  if (idx >= 0) {
    return PALETTE[idx % PALETTE.length];
  }
  let hash = 0;
  for (let i = 0; i < calendarId.length; i++) {
    hash = (hash * 31 + calendarId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function getCalendarLabel(calendarId: string, calendars: CalendarSpace[]): string {
  const cal = calendars.find((c) => c.id === calendarId);
  if (!cal) return 'Calendar';
  return cal.isPersonal ? 'Personal' : cal.name;
}
