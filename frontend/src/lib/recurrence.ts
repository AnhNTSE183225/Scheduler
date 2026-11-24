import {
  addDays,
  addMinutes,
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
  format,
  isAfter,
  isBefore,
  parseISO,
  startOfDay,
} from 'date-fns';
import type {
  Occurrence,
  RsvpStatus,
  ScheduleEvent,
  ScheduleEventRecurrence,
  ServerMember,
} from '@/models/schedule';

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const occurrenceKey = (d: Date) => format(d, 'yyyy-MM-dd');

export function isOccurrenceOnDay(o: Occurrence, d: Date): boolean {
  const dayStart = startOfDay(d);
  const dayEnd = addDays(dayStart, 1);
  return o.start < dayEnd && o.end > dayStart;
}

export function canManageEvent(event: ScheduleEvent, userId: string, isAdmin = false): boolean {
  return event.organizerId === userId || isAdmin;
}

export function expandEvent(event: ScheduleEvent, from: Date, to: Date): Occurrence[] {
  const first = parseISO(event.start);
  if (isNaN(first.getTime())) return [];
  const make = (start: Date): Occurrence => ({
    event,
    key: occurrenceKey(start),
    start,
    end: addMinutes(start, event.durationMinutes),
  });
  const r = event.recurrence;
  if (!r) {
    const occ = make(first);
    return isBefore(first, to) &&
      isAfter(occ.end, from) &&
      !(event.cancelledOccurrences || []).includes(occurrenceKey(first))
      ? [occ]
      : [];
  }
  const interval = Math.max(1, r.interval || 1);
  const until = r.until ? addDays(startOfDay(parseISO(r.until)), 1) : null;
  const weekdays = r.freq === 'weekly' && r.weekdays?.length ? r.weekdays : [first.getDay()];
  const out: Occurrence[] = [];
  let produced = 0;
  const time = { h: first.getHours(), m: first.getMinutes() };
  for (let i = 0; i < 3660; i++) {
    const day = addDays(startOfDay(first), i);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.m);
    if (!isBefore(start, to)) break;
    if (until && !isBefore(start, until)) break;
    let matches = false;
    if (r.freq === 'daily') matches = i % interval === 0;
    else if (r.freq === 'weekly')
      matches = weekdays.includes(day.getDay()) && differenceInCalendarWeeks(day, first) % interval === 0;
    else matches = day.getDate() === first.getDate() && differenceInCalendarMonths(day, first) % interval === 0;
    if (!matches) continue;
    produced++;
    if (r.count && produced > r.count) break;
    if ((event.cancelledOccurrences || []).includes(occurrenceKey(start))) continue;
    const occ = make(start);
    if (isAfter(occ.end, from)) out.push(occ);
  }
  return out;
}

export function expandEvents(events: ScheduleEvent[], from: Date, to: Date): Occurrence[] {
  return events.flatMap((e) => expandEvent(e, from, to)).sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function getInviteeIds(event: ScheduleEvent, members: ServerMember[]): string[] {
  const baseIds = event.inviteEveryone ? members.map((m) => m.id) : event.inviteeIds || [];
  const guestIds = Object.keys(event.guestNames || {});
  return Array.from(new Set([event.organizerId, ...baseIds, ...guestIds]));
}

export function isInvited(event: ScheduleEvent, userId: string, members: ServerMember[]): boolean {
  if (!userId) return false;
  return getInviteeIds(event, members).includes(userId);
}

export function getResponse(event: ScheduleEvent, key: string, userId: string): RsvpStatus | null {
  if (!userId) return null;
  return event.occurrenceResponses?.[key]?.[userId] ?? event.seriesResponses?.[userId] ?? null;
}

export function summarizeResponses(event: ScheduleEvent, key: string, members: ServerMember[]) {
  const groups: Record<RsvpStatus | 'pending', ServerMember[]> = {
    accepted: [],
    tentative: [],
    declined: [],
    pending: [],
  };

  for (const id of getInviteeIds(event, members)) {
    const member =
      members.find((m) => m.id === id) ?? {
        id,
        name: event.guestNames?.[id] || (id === event.organizerId ? event.organizerName || 'Organizer' : 'Invited Guest'),
        avatar: id === event.organizerId ? event.organizerAvatar ?? null : null,
      };
    groups[getResponse(event, key, id) ?? 'pending'].push(member);
  }
  return groups;
}

export function describeRecurrence(r: ScheduleEventRecurrence | null, start: Date): string {
  if (!r) return 'Does not repeat';
  const every = r.interval > 1 ? `Every ${r.interval} ` : 'Every ';
  let base = '';
  if (r.freq === 'daily') base = r.interval > 1 ? `${every}days` : 'Daily';
  else if (r.freq === 'weekly') {
    const days = (r.weekdays?.length ? r.weekdays : [start.getDay()])
      .slice()
      .sort()
      .map((d) => WEEKDAY_SHORT[d])
      .join(', ');
    base = `${r.interval > 1 ? `${every}weeks` : 'Weekly'} on ${days}`;
  } else base = `${r.interval > 1 ? `${every}months` : 'Monthly'} on day ${start.getDate()}`;
  if (r.until) base += ` · until ${format(parseISO(r.until), 'MMM d, yyyy')}`;
  else if (r.count) base += ` · ${r.count} times`;
  return base;
}

export function isGoogleMapsShortlink(val: string): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  return (
    /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps)/i.test(trimmed) ||
    /^https?:\/\/waze\.com/i.test(trimmed)
  );
}

export function googleMapsEmbedUrl(q: string): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&t=&z=14&ie=UTF8&iwloc=&output=embed`;
}

export function buildGoogleCalendarUrl(event: ScheduleEvent, occStart: Date, occEnd: Date): string {
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const loc =
    event.location?.kind === 'address'
      ? event.location.address || ''
      : event.location?.kind === 'link'
      ? event.location.url || ''
      : '';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${fmt(occStart)}/${fmt(occEnd)}`,
    details: event.description || '',
    location: loc,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
