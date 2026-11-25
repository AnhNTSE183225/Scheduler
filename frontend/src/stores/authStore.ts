import { createSignal, untrack } from 'solid-js';
import { changePassword, fetchMe, postLogin, postLogout, postRegister, updateProfile } from '@/api/auth';
import { getStoredToken, setStoredToken } from '@/api/client';
import { createCalendarSpace, joinCalendarSpace } from '@/api/schedule';
import type { CalendarSpace, EntityStatus, User } from '@/models/schedule';

const [status, setStatus] = createSignal<EntityStatus>('idle');
const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
const [user, setUser] = createSignal<User | null>(null);
const [calendars, setCalendars] = createSignal<CalendarSpace[]>([]);
const [activeCalendarId, setActiveCalendarId] = createSignal<string | null>(null);
const [isAdmin, setIsAdmin] = createSignal<boolean>(false);

function transitionTo(next: EntityStatus, reason: string) {
  const prev = untrack(status);
  if (prev !== next) {
    console.info(`[FSM] Entity auth: ${prev} -> ${next} (Reason: ${reason})`);
    setStatus(next);
  }
}

export const authStore = {
  status,
  errorMsg,
  clearError: () => setErrorMsg(null),
  user,
  calendars,
  activeCalendarId,
  setActiveCalendarId,
  isAdmin,

  async bootstrap() {
    transitionTo('loading', 'Checking stored session');
    setErrorMsg(null);

    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setCalendars([]);
      setActiveCalendarId(null);
      transitionTo('disconnected', 'No stored token');
      return;
    }

    try {
      const res = await fetchMe();
      setUser(res.data.user);
      setCalendars(res.data.calendars);
      setIsAdmin(Boolean(res.data.isAdmin));
      if (!activeCalendarId() && res.data.calendars.length > 0) {
        setActiveCalendarId(res.data.calendars[0].id);
      }
      transitionTo('active', 'Session verified');
    } catch (err: unknown) {
      setUser(null);
      setCalendars([]);
      setActiveCalendarId(null);
      setStoredToken(null);
      setErrorMsg(err instanceof Error ? err.message : 'Session expired');
      transitionTo('disconnected', 'Token rejected');
    }
  },

  async register(displayName: string, username: string, password: string) {
    transitionTo('loading', 'Registering new account');
    setErrorMsg(null);
    try {
      const res = await postRegister(displayName, username, password);
      setStoredToken(res.data.token);
      setUser(res.data.user);
      setCalendars(res.data.calendars);
      setIsAdmin(Boolean(res.data.isAdmin));
      if (res.data.calendars.length > 0) {
        setActiveCalendarId(res.data.calendars[0].id);
      }
      transitionTo('active', 'Account registered');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Registration failed');
      transitionTo('error', 'Registration failed');
    }
  },

  async login(username: string, password: string) {
    transitionTo('loading', 'Signing in with username and password');
    setErrorMsg(null);
    try {
      const res = await postLogin(username, password);
      setStoredToken(res.data.token);
      setUser(res.data.user);
      setCalendars(res.data.calendars);
      setIsAdmin(Boolean(res.data.isAdmin));
      if (res.data.calendars.length > 0) {
        setActiveCalendarId(res.data.calendars[0].id);
      }
      transitionTo('active', 'Signed in');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in failed');
      transitionTo('error', 'Sign-in failed');
    }
  },

  async createGroup(name: string, description: string): Promise<CalendarSpace> {
    const res = await createCalendarSpace(name, description);
    const cal = res.data.calendar;
    setCalendars((prev) => [...prev, cal]);
    setActiveCalendarId(cal.id);
    return cal;
  },

  async joinGroup(inviteCode: string): Promise<CalendarSpace> {
    const res = await joinCalendarSpace(inviteCode);
    const cal = res.data.calendar;
    setCalendars((prev) => (prev.some((c) => c.id === cal.id) ? prev : [...prev, cal]));
    setActiveCalendarId(cal.id);
    return cal;
  },

  leaveGroup(calendarId: string) {
    const remaining = calendars().filter((c) => c.id !== calendarId);
    setCalendars(remaining);
    if (activeCalendarId() === calendarId) {
      setActiveCalendarId(remaining[0]?.id ?? null);
    }
  },

  async updateProfile(
    displayName: string,
    bankBin?: string | null,
    bankAccountNumber?: string | null,
  ): Promise<User> {
    const res = await updateProfile(displayName, bankBin, bankAccountNumber);
    setUser(res.data.user);
    return res.data.user;
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await changePassword(currentPassword, newPassword);
  },

  async logout() {
    try {
      await postLogout();
    } catch {}
    setStoredToken(null);
    setUser(null);
    setCalendars([]);
    setActiveCalendarId(null);
    setIsAdmin(false);
    transitionTo('disconnected', 'User logged out');
  },
};
