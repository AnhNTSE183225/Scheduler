import { createSignal, untrack } from 'solid-js';
import {
  fetchVapidPublicKey,
  postPublicPushSubscribe,
  postPushSubscribe,
  postPushUnsubscribe,
  postTestPush,
} from '@/api/notifications';
import {
  detectInstallMode,
  registerServiceWorker,
  urlBase64ToUint8Array,
  withTimeout,
  type BeforeInstallPromptEvent,
  type PlatformInstallMode,
} from '@/lib/pwa';
import type { EntityStatus } from '@/models/schedule';

const [status, setStatus] = createSignal<EntityStatus>('idle');
const [permission, setPermission] = createSignal<NotificationPermission>(
  typeof Notification !== 'undefined' ? Notification.permission : 'default',
);
const [installMode, setInstallMode] = createSignal<PlatformInstallMode>(detectInstallMode());
const [deferredPrompt, setDeferredPrompt] = createSignal<BeforeInstallPromptEvent | null>(null);
const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
const [feedbackMsg, setFeedbackMsg] = createSignal<string | null>(null);
const [initialized, setInitialized] = createSignal(false);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    setDeferredPrompt(e as BeforeInstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => {
    setDeferredPrompt(null);
    setInstallMode('standalone');
  });
}

function keysMatch(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  const viewA = new Uint8Array(a);
  for (let i = 0; i < b.byteLength; i++) {
    if (viewA[i] !== b[i]) return false;
  }
  return true;
}

function transitionTo(next: EntityStatus, reason: string) {
  const prev = untrack(status);
  if (prev !== next) {
    console.info(`[FSM] Entity push: ${prev} -> ${next} (Reason: ${reason})`);
    setStatus(next);
  }
}

export const notificationStore = {
  status,
  permission,
  installMode,
  initialized,
  canInstallPrompt: () => deferredPrompt() !== null,
  errorMsg,
  feedbackMsg,

  async init() {
    setInstallMode(detectInstallMode());

    if (typeof Notification === 'undefined' || !('PushManager' in window)) {
      transitionTo('paused', 'Push API unavailable in current browser context');
      setInitialized(true);
      return;
    }

    setPermission(Notification.permission);
    try {
      const reg = await registerServiceWorker();
      if (!reg) {
        transitionTo('idle', 'Service Worker not yet active; ready for opt-in');
        return;
      }

      const existing = await withTimeout(
        reg.pushManager.getSubscription(),
        4000,
        'Timed out checking existing push subscription',
      );
      if (existing && Notification.permission === 'granted') {
        transitionTo('active', 'Existing Web Push subscription detected');
      } else {
        transitionTo('idle', 'Ready for user opt-in');
      }
    } catch {
      transitionTo('idle', 'Ready for user opt-in');
    } finally {
      setInitialized(true);
    }
  },

  async promptInstall() {
    const prompt = deferredPrompt();
    if (!prompt) return;
    await prompt.prompt();
    const res = await prompt.userChoice;
    if (res.outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  },

  async enablePush(publicShareToken?: string) {
    if (status() === 'loading') return;

    transitionTo('loading', 'Requesting Notification permission and VAPID subscription');
    setErrorMsg(null);
    setFeedbackMsg(null);

    try {
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        throw new Error('Push notifications require HTTPS or localhost.');
      }
      if (typeof Notification === 'undefined' || !('PushManager' in window)) {
        throw new Error('This browser context does not support Web Push. On iOS, add to Home Screen first.');
      }

      if (Notification.permission === 'denied') {
        transitionTo('paused', 'Permission previously denied');
        setErrorMsg('Notifications are blocked for this site. Re-enable them in your browser site settings.');
        return;
      }

      let perm: NotificationPermission = Notification.permission;
      if (perm !== 'granted') {
        perm = await Notification.requestPermission();
        setPermission(perm);
        if (perm !== 'granted') {
          transitionTo('paused', `Permission ${perm}`);
          setErrorMsg(
            perm === 'denied'
              ? 'Notification permission was blocked.'
              : 'Notification permission prompt was dismissed.',
          );
          return;
        }
      }

      const reg = await registerServiceWorker();
      if (!reg) {
        throw new Error('Service Worker failed to activate. Reload the page and try again.');
      }

      const { publicKey } = await fetchVapidPublicKey();
      const appServerKey = urlBase64ToUint8Array(publicKey);

      let sub = await withTimeout(
        reg.pushManager.getSubscription(),
        5000,
        'Timed out reading browser push subscription.',
      );
      if (sub && !keysMatch(sub.options?.applicationServerKey, appServerKey)) {
        await sub.unsubscribe().catch(() => false);
        sub = null;
      }
      if (!sub) {
        sub = await withTimeout(
          reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: appServerKey as BufferSource,
          }),
          10000,
          'Push service timed out while registering this browser.',
        );
      }

      const json = sub.toJSON();
      if (publicShareToken) {
        await postPublicPushSubscribe(publicShareToken, json);
      } else {
        await postPushSubscribe(json);
      }

      transitionTo('active', 'Web Push subscription saved');
      setFeedbackMsg('Push reminders enabled on this device!');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not enable push');
      transitionTo('error', 'Push subscription failed');
    }
  },

  async disablePush() {
    transitionTo('loading', 'Unsubscribing Web Push');
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await postPushUnsubscribe(sub.endpoint);
        await sub.unsubscribe();
      }
      setFeedbackMsg('Push reminders disabled on this device.');
      transitionTo('idle', 'Unsubscribed');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to unsubscribe');
      transitionTo('error', 'Unsubscribe failed');
    }
  },

  async sendTest() {
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await postTestPush();
      setFeedbackMsg(
        res.data.delivered > 0
          ? `Test notification sent (${res.data.delivered} device)!`
          : 'Subscribed locally, but push endpoint did not accept delivery.',
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Test push failed');
    }
  },
};
