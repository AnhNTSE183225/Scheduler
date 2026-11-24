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
const [members, setMembers] = createSignal<ServerMember[]>([]);
const [calendar, setCalendar] = createSignal<CalendarSpace | null>(null);
const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
const [liveToast, setLiveToast] = createSignal<string | null>(null);

let eventSource: EventSource | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let streamSeq = 0;

function teardownStream() {
  streamSeq += 1;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}

function transitionTo(next: EntityStatus, reason: string) {
  const prev = untrack(status);
  if (next === 'idle' || next === 'disconnected' || next === 'error') {
    teardownStream();
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

export const scheduleStore = {
  status,
  events,
  members,
  calendar,
  errorMsg,
  liveToast,
  clearToast: () => setLiveToast(null),

  async load(calendarId: string | null) {
    if (!calendarId) {
      setEvents([]);
      setMembers([]);
      setCalendar(null);
      transitionTo('idle', 'No calendar selected');
      return;
    }

    transitionTo('loading', `Fetching schedule for ${calendarId}`);
    setErrorMsg(null);
    try {
      const res = await fetchScheduleData(calendarId);
      setEvents(res.data.events || []);
      setMembers(res.data.members || []);
      setCalendar(res.data.calendar || null);
      transitionTo('active', `Loaded ${res.data.events.length} events`);
      void scheduleStore.connectStream(calendarId);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load schedule');
      transitionTo('error', 'Schedule load failed');
    }
  },

  async connectStream(calendarId: string) {
    teardownStream();
    if (!getStoredToken()) return;

    const mySeq = streamSeq;
    try {
      const ticketRes = await postStreamTicket(calendarId);
      if (mySeq !== streamSeq) return;

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
          // Silently refresh events on remote mutations
          void fetchScheduleData(calendarId).then((res) => {
            setEvents(res.data.events || []);
            setMembers(res.data.members || []);
          });
        } catch {}
      });
      es.onerror = () => {
        // Tickets are single-use; close and request a fresh ticket on transient drop
        es.close();
        if (eventSource === es) {
          eventSource = null;
        }
        if (mySeq === streamSeq && getStoredToken()) {
          reconnectTimer = setTimeout(() => {
            if (mySeq === streamSeq) {
              void scheduleStore.connectStream(calendarId);
            }
          }, 5000);
        }
      };
      eventSource = es;
    } catch {
      // Non-fatal: schedule data already loaded over HTTPS/REST
    }
  },

  disconnect() {
    setEvents([]);
    setMembers([]);
    setCalendar(null);
    transitionTo('disconnected', 'Disconnected from schedule');
  },

  async createEvent(calendarId: string, payload: Partial<ScheduleEvent>) {
    const res = await postScheduleEvent(calendarId, payload);
    await scheduleStore.load(calendarId);
    return res.data.event;
  },

  async updateEvent(calendarId: string, eventId: string, payload: Partial<ScheduleEvent>) {
    const res = await putScheduleEvent(calendarId, eventId, payload);
    await scheduleStore.load(calendarId);
    return res.data.event;
  },

  async deleteEvent(calendarId: string, eventId: string, occurrence?: string) {
    await removeScheduleEvent(calendarId, eventId, occurrence);
    await scheduleStore.load(calendarId);
  },

  async respondEvent(
    calendarId: string,
    eventId: string,
    key: string,
    rsvpStatus: RsvpStatus,
    scope: RsvpScope,
  ) {
    const res = await postRespondEvent(calendarId, eventId, key, rsvpStatus, scope);
    await scheduleStore.load(calendarId);
    return res.data.event;
  },
};
