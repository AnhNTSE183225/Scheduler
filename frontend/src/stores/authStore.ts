import { createSignal } from 'solid-js';
import { fetchAuthConfig, fetchMe, postDevLogin, postLogout, type AuthConfig } from '@/api/auth';
import { getStoredToken, setStoredToken } from '@/api/client';
import { createCalendarSpace, joinCalendarSpace } from '@/api/schedule';
import type { CalendarSpace, EntityStatus, User } from '@/models/schedule';

const [status, setStatus] = createSignal<EntityStatus>('idle');
const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
const [user, setUser] = createSignal<User | null>(null);
const [calendars, setCalendars] = createSignal<CalendarSpace[]>([]);
const [activeCalendarId, setActiveCalendarId] = createSignal<string | null>(null);
const [isAdmin, setIsAdmin] = createSignal<boolean>(false);
const [authConfig, setAuthConfig] = createSignal<AuthConfig>({
  google_enabled: false,
  dev_login_enabled: true,
});

function transitionTo(next: EntityStatus, reason: string) {
  const prev = status();
  if (prev !== next) {
    console.info(`[FSM] Entity auth: ${prev} -> ${next} (Reason: ${reason})`);
    setStatus(next);
  }
}

export const authStore = {
  status,
  errorMsg,
  user,
  calendars,
  activeCalendarId,
  setActiveCalendarId,
  isAdmin,
  authConfig,

  async bootstrap() {
    transitionTo('loading', 'Checking auth config and stored session');
    setErrorMsg(null);

    try {
      const url = new URL(window.location.href);
      const tokenParam = url.searchParams.get('token');
      if (tokenParam) {
        setStoredToken(tokenParam);
        url.searchParams.delete('token');
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
    } catch {}

    try {
      const cfg = await fetchAuthConfig();
      setAuthConfig(cfg);
    } catch {}

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

  async loginDev(name: string, email?: string) {
    transitionTo('loading', 'Signing in via quick profile');
    setErrorMsg(null);
    try {
      const res = await postDevLogin(name, email);
      setStoredToken(res.data.token);
      setUser(res.data.user);
      setCalendars(res.data.calendars);
      if (res.data.calendars.length > 0) {
        setActiveCalendarId(res.data.calendars[0].id);
      }
      transitionTo('active', 'Quick profile signed in');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in failed');
      transitionTo('error', 'Quick sign-in failed');
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
