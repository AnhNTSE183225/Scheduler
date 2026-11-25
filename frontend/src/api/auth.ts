import { apiFetch } from './client';
import type { CalendarSpace, StateMachineDTO, User } from '@/models/schedule';

export interface MePayload {
  user: User;
  calendars: CalendarSpace[];
  isAdmin: boolean;
}

export interface AuthPayload {
  token: string;
  user: User;
  calendars: CalendarSpace[];
  isAdmin: boolean;
}

export function fetchMe(): Promise<StateMachineDTO<MePayload>> {
  return apiFetch<StateMachineDTO<MePayload>>('/me');
}

export function postRegister(
  displayName: string,
  username: string,
  password: string,
): Promise<StateMachineDTO<AuthPayload>> {
  return apiFetch<StateMachineDTO<AuthPayload>>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ displayName, username, password }),
  });
}

export function postLogin(
  username: string,
  password: string,
): Promise<StateMachineDTO<AuthPayload>> {
  return apiFetch<StateMachineDTO<AuthPayload>>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function postLogout(): Promise<StateMachineDTO<{ ok: boolean }>> {
  return apiFetch<StateMachineDTO<{ ok: boolean }>>('/auth/logout', {
    method: 'POST',
  });
}

export function updateProfile(displayName: string): Promise<StateMachineDTO<{ user: User }>> {
  return apiFetch<StateMachineDTO<{ user: User }>>('/me', {
    method: 'PUT',
    body: JSON.stringify({ displayName }),
  });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<StateMachineDTO<{ ok: boolean }>> {
  return apiFetch<StateMachineDTO<{ ok: boolean }>>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
