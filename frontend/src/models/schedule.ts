export type EntityStatus =
  | 'disconnected'
  | 'idle'
  | 'loading'
  | 'active'
  | 'paused'
  | 'error'
  | 'terminated';

export interface StateMachineDTO<T> {
  status: EntityStatus;
  reason?: string;
  data: T;
}

export type RsvpStatus = 'accepted' | 'tentative' | 'declined';
export type RsvpScope = 'occurrence' | 'series';
export type EventCategory = 'gaming' | 'food' | 'outdoor' | 'other';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  bankBin?: string | null;
  bankAccountNumber?: string | null;
}

export interface BillItem {
  id: string;
  name: string;
  amountVnd: number;
  scope: 'all' | 'selected';
  memberIds: string[];
}

export interface BillShare {
  userId: string;
  displayName: string;
  amountVnd: number;
  paid?: boolean;
}

export interface SplitBill {
  id: string;
  calendarId: string;
  creatorId: string;
  creatorName: string;
  title: string;
  bankBin: string;
  bankAccountNumber: string;
  participantIds: string[];
  items: BillItem[];
  shares: BillShare[];
  totalVnd: number;
  createdAt: number;
}

export interface CreateBillPayload {
  calendarId: string;
  title: string;
  participantIds: string[];
  items: Array<{
    name: string;
    amountVnd: number;
    scope: 'all' | 'selected';
    memberIds?: string[];
  }>;
}

export interface CalendarSpace {
  id: string;
  name: string;
  description: string;
  inviteCode: string;
  ownerId: string;
  isPersonal: boolean;
  createdAt: number;
}

export interface ServerMember {
  id: string;
  name: string;
  avatar: string | null;
}

export interface GroupMember {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  role: 'owner' | 'member' | string;
}

export interface ScheduleEventLocation {
  kind: 'address' | 'link';
  address?: string;
  url?: string;
}

export interface ScheduleEventLink {
  label: string;
  url: string;
}

export interface ScheduleEventRecurrence {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  weekdays?: number[];
  until?: string | null;
  count?: number | null;
}

export interface ScheduleEvent {
  id: string;
  calendarId: string;
  shareToken: string;
  title: string;
  description: string;
  category?: EventCategory;
  start: string;
  durationMinutes: number;
  recurrence: ScheduleEventRecurrence | null;
  location: ScheduleEventLocation | null;
  imageUrl?: string | null;
  links: ScheduleEventLink[];
  organizerId: string;
  organizerName?: string;
  organizerAvatar?: string | null;
  inviteEveryone: boolean;
  inviteeIds: string[];
  seriesResponses: Record<string, RsvpStatus>;
  occurrenceResponses: Record<string, Record<string, RsvpStatus>>;
  guestNames: Record<string, string>;
  cancelledOccurrences: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface Occurrence {
  event: ScheduleEvent;
  key: string; // yyyy-MM-dd
  start: Date;
  end: Date;
}

export interface SseNotificationEvent {
  kind:
    | 'connected'
    | 'event_created'
    | 'event_updated'
    | 'event_deleted'
    | 'rsvp_updated'
    | 'reminder'
    | 'member_joined'
    | 'member_removed';
  calendarId: string;
  eventId: string;
  title?: string;
  message?: string;
  timestamp?: number;
}

export function resolveEntityStatus<T>(dto: Partial<StateMachineDTO<T>> | null | undefined): EntityStatus {
  if (dto && dto.status) return dto.status;
  return 'idle';
}
