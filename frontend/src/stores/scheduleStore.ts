import { createSignal, untrack } from 'solid-js';
import { API_BASE, getStoredToken } from '@/api/client';
import { postStreamTicket } from '@/api/notifications';
import {
  fetchScheduleData,
  postRespondEvent,
  postScheduleEvent,
  putScheduleEvent,
  removeScheduleEvent,
} from '@/api/schedule';
import type {
  CalendarSpace,
  EntityStatus,
  RsvpScope,
  RsvpStatus,
  ScheduleEvent,
  ServerMember,
  SseNotificationEvent,
} from '@/models/schedule';

const [status, setStatus] = createSignal<EntityStatus>('idle');
const [events, setEvents] = createSignal<ScheduleEvent[]>([]);
const [membersByCalendar, setMembersByCalendar] = createSignal<Record<string, ServerMember[]>>({});
const [loadedCalendars, setLoadedCalendars] = createSignal<CalendarSpace[]>([]);
const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
const [liveToast, setLiveToast] = createSignal<string | null>(null);

const eventSources = new Map<string, EventSource>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let streamEpoch = 0;

function teardownStreams() {
  streamEpoch += 1;
  for (const timer of reconnectTimers.values()) {
    clearTimeout(timer);
  }
  reconnectTimers.clear();
  for (const es of eventSources.values()) {
    es.close();
  }
  eventSources.clear();
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}

function transitionTo(next: EntityStatus, reason: string) {
  const prev = untrack(status);
  if (next === 'idle' || next === 'disconnected' || next === 'error') {
    teardownStreams();
  }
  if (prev !== next) {
    console.info(`[FSM] Entity schedule: ${prev} -> ${next} (Reason: ${reason})`);
    setStatus(next);
  }
}

function showToast(msg: string) {
  if (toastTimer) clearTimeout(toastTimer);
  setLiveToast(msg);
  toastTimer = setTimeout(() => setLiveToast(null), 5000);
}

async function refreshSingleCalendar(calendarId: string) {
  try {
    const res = await fetchScheduleData(calendarId);
    setEvents((prev) => [
      ...prev.filter((e) => e.calendarId !== calendarId),
      ...(res.data.events || []),
    ]);
    setMembersByCalendar((prev) => ({
      ...prev,
      [calendarId]: res.data.members || [],
    }));
  } catch {}
}

export const scheduleStore = {
  status,
  events,
  membersByCalendar,
  membersForCalendar: (calendarId: string): ServerMember[] =>
    membersByCalendar()[calendarId] || [],
  errorMsg,
  liveToast,
  clearToast: () => setLiveToast(null),

  async loadAll(calendars: CalendarSpace[]) {
    setLoadedCalendars(calendars);
    if (!calendars.length) {
      setEvents([]);
      setMembersByCalendar({});
      transitionTo('idle', 'No calendars available');
      return;
    }

    transitionTo('loading', `Fetching schedules for ${calendars.length} calendar(s)`);
    setErrorMsg(null);
    try {
      const results = await Promise.all(calendars.map((c) => fetchScheduleData(c.id)));
      const mergedEvents: ScheduleEvent[] = [];
      const nextMembers: Record<string, ServerMember[]> = {};
      results.forEach((res, idx) => {
        const calId = calendars[idx].id;
        mergedEvents.push(...(res.data.events || []));
        nextMembers[calId] = res.data.members || [];
      });
      setEvents(mergedEvents);
      setMembersByCalendar(nextMembers);
      transitionTo('active', `Loaded ${mergedEvents.length} events across ${calendars.length} calendar(s)`);
      scheduleStore.syncStreams(calendars.map((c) => c.id));
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load schedule');
      transitionTo('error', 'Schedule load failed');
    }
  },

  syncStreams(calendarIds: string[]) {
    teardownStreams();
    if (!getStoredToken()) return;
    const epoch = streamEpoch;

    for (const calId of calendarIds) {
      void scheduleStore.connectStream(calId, epoch);
    }
  },

  async connectStream(calendarId: string, epoch: number) {
    if (!getStoredToken() || epoch !== streamEpoch) return;

    try {
      const ticketRes = await postStreamTicket(calendarId);
      if (epoch !== streamEpoch) return;

      const es = new EventSource(
        `${API_BASE}/api/stream/${encodeURIComponent(calendarId)}?ticket=${encodeURIComponent(ticketRes.data.ticket)}`,
      );
      es.addEventListener('schedule', (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data) as SseNotificationEvent;
          if (msg.kind === 'connected') return;
          if (msg.kind === 'reminder' && msg.title) {
            showToast(`${msg.title}${msg.message ? ` — ${msg.message}` : ''}`);
          }
          void refreshSingleCalendar(calendarId);
        } catch {}
      });
      es.onerror = () => {
        es.close();
        if (eventSources.get(calendarId) === es) {
          eventSources.delete(calendarId);
        }
        if (epoch === streamEpoch && getStoredToken()) {
          const timer = setTimeout(() => {
            reconnectTimers.delete(calendarId);
            if (epoch === streamEpoch) {
              void scheduleStore.connectStream(calendarId, epoch);
            }
          }, 5000);
          reconnectTimers.set(calendarId, timer);
        }
      };
      eventSources.set(calendarId, es);
    } catch {
      // Non-fatal: schedule data already loaded over HTTPS/REST
    }
  },

  disconnect() {
    setEvents([]);
    setMembersByCalendar({});
    setLoadedCalendars([]);
    transitionTo('disconnected', 'Disconnected from schedule');
  },

  async createEvent(calendarId: string, payload: Partial<ScheduleEvent>) {
    const res = await postScheduleEvent(calendarId, payload);
    await scheduleStore.loadAll(untrack(loadedCalendars));
    return res.data.event;
  },

  async updateEvent(calendarId: string, eventId: string, payload: Partial<ScheduleEvent>) {
    const res = await putScheduleEvent(calendarId, eventId, payload);
    await scheduleStore.loadAll(untrack(loadedCalendars));
    return res.data.event;
  },

  async deleteEvent(calendarId: string, eventId: string, occurrence?: string) {
    await removeScheduleEvent(calendarId, eventId, occurrence);
    await scheduleStore.loadAll(untrack(loadedCalendars));
  },

  async respondEvent(
    calendarId: string,
    eventId: string,
    key: string,
    rsvpStatus: RsvpStatus,
    scope: RsvpScope,
  ) {
    const res = await postRespondEvent(calendarId, eventId, key, rsvpStatus, scope);
    await scheduleStore.loadAll(untrack(loadedCalendars));
    return res.data.event;
  },
};
