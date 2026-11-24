import { apiFetch } from './client';
import type { CalendarSpace, StateMachineDTO, User } from '@/models/schedule';

export interface AuthConfig {
  google_enabled: boolean;
  dev_login_enabled: boolean;
}

export interface MePayload {
  user: User;
  calendars: CalendarSpace[];
  isAdmin: boolean;
}

export interface DevLoginPayload {
  token: string;
  user: User;
  calendars: CalendarSpace[];
}

export function fetchAuthConfig(): Promise<AuthConfig> {
  return apiFetch<AuthConfig>('/auth/config');
}

export function fetchMe(): Promise<StateMachineDTO<MePayload>> {
  return apiFetch<StateMachineDTO<MePayload>>('/me');
}

export function postDevLogin(name: string, email?: string): Promise<StateMachineDTO<DevLoginPayload>> {
  return apiFetch<StateMachineDTO<DevLoginPayload>>('/auth/dev-login', {
    method: 'POST',
    body: JSON.stringify({ name, email: email || undefined }),
  });
}

export function postLogout(): Promise<StateMachineDTO<{ ok: boolean }>> {
  return apiFetch<StateMachineDTO<{ ok: boolean }>>('/auth/logout', {
    method: 'POST',
  });
}
