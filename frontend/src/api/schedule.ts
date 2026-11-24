import { apiFetch } from './client';
import type {
  CalendarSpace,
  RsvpScope,
  RsvpStatus,
  ScheduleEvent,
  ServerMember,
  StateMachineDTO,
} from '@/models/schedule';

export interface SchedulePayload {
  events: ScheduleEvent[];
  members: ServerMember[];
  calendar: CalendarSpace | null;
}

export interface PublicEventPayload {
  event: ScheduleEvent;
  calendar_name: string;
  members: ServerMember[];
}

export function createCalendarSpace(name: string, description: string): Promise<StateMachineDTO<{ calendar: CalendarSpace }>> {
  return apiFetch('/calendars', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export function joinCalendarSpace(inviteCode: string): Promise<StateMachineDTO<{ calendar: CalendarSpace }>> {
  return apiFetch('/calendars/join', {
    method: 'POST',
    body: JSON.stringify({ inviteCode }),
  });
}

export function fetchScheduleData(calendarId: string): Promise<StateMachineDTO<SchedulePayload>> {
  return apiFetch(`/schedule/${encodeURIComponent(calendarId)}`);
}

export function postScheduleEvent(calendarId: string, payload: Partial<ScheduleEvent>): Promise<StateMachineDTO<{ event: ScheduleEvent }>> {
  return apiFetch(`/schedule/${encodeURIComponent(calendarId)}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function putScheduleEvent(calendarId: string, eventId: string, payload: Partial<ScheduleEvent>): Promise<StateMachineDTO<{ event: ScheduleEvent }>> {
  return apiFetch(`/schedule/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function removeScheduleEvent(calendarId: string, eventId: string, occurrence?: string): Promise<StateMachineDTO<{ deleted: boolean }>> {
  const qs = occurrence ? `?occurrence=${encodeURIComponent(occurrence)}` : '';
  return apiFetch(`/schedule/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}${qs}`, {
    method: 'DELETE',
  });
}

export function postRespondEvent(
  calendarId: string,
  eventId: string,
  key: string,
  status: RsvpStatus,
  scope: RsvpScope,
): Promise<StateMachineDTO<{ event: ScheduleEvent }>> {
  return apiFetch(`/schedule/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}/respond`, {
    method: 'POST',
    body: JSON.stringify({ key, status, scope }),
  });
}

export function fetchPublicEvent(shareToken: string): Promise<StateMachineDTO<PublicEventPayload>> {
  return apiFetch(`/public/events/${encodeURIComponent(shareToken)}`);
}

export function postPublicRespond(
  shareToken: string,
  name: string,
  key: string,
  status: RsvpStatus,
  scope: RsvpScope,
): Promise<StateMachineDTO<{ event: ScheduleEvent; responderId: string }>> {
  return apiFetch(`/public/events/${encodeURIComponent(shareToken)}/respond`, {
    method: 'POST',
    body: JSON.stringify({ name, key, status, scope }),
  });
}
