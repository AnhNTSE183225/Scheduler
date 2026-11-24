import { createSignal } from 'solid-js';
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

function transitionTo(next: EntityStatus, reason: string) {
  const prev = status();
  if (prev !== next) {
    console.info(`[FSM] Entity push: ${prev} -> ${next} (Reason: ${reason})`);
    setStatus(next);
  }
}

export const notificationStore = {
  status,
  permission,
  installMode,
  canInstallPrompt: () => deferredPrompt() !== null,
  errorMsg,
  feedbackMsg,

  async init() {
    setInstallMode(detectInstallMode());
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

    if (typeof Notification === 'undefined' || !('PushManager' in window)) {
      transitionTo('paused', 'Push API unavailable in current browser context');
      return;
    }

    setPermission(Notification.permission);
    const reg = await registerServiceWorker();
    if (!reg) {
      transitionTo('error', 'Service Worker unavailable');
      return;
    }

    const existing = await reg.pushManager.getSubscription();
    if (existing && Notification.permission === 'granted') {
      transitionTo('active', 'Existing Web Push subscription detected');
    } else {
      transitionTo('idle', 'Ready for user opt-in');
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
    transitionTo('loading', 'Requesting Notification permission and VAPID subscription');
    setErrorMsg(null);
    setFeedbackMsg(null);

    try {
      if (typeof Notification === 'undefined' || !('PushManager' in window)) {
        throw new Error('This browser context does not support Web Push. On iOS, add to Home Screen first.');
      }

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        transitionTo('paused', `Permission ${perm}`);
        setErrorMsg('Notification permission was blocked.');
        return;
      }

      const reg = await registerServiceWorker();
      if (!reg) {
        throw new Error('Failed to register Service Worker.');
      }

      const { publicKey } = await fetchVapidPublicKey();
      const appServerKey = urlBase64ToUint8Array(publicKey);

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey.buffer as ArrayBuffer,
        });
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
