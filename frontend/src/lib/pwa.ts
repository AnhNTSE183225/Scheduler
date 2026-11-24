export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type PlatformInstallMode =
  | 'standalone'
  | 'ios-in-app'
  | 'ios-safari'
  | 'android-or-desktop'
  | 'unsupported';

export function detectInstallMode(): PlatformInstallMode {
  if (typeof window === 'undefined') return 'unsupported';

  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  if (isStandalone) return 'standalone';

  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos) {
    const isInApp = /FBAN|FBAV|Instagram|Line|Zalo|MicroMessenger/i.test(ua);
    if (isInApp) return 'ios-in-app';
    return 'ios-safari';
  }

  return 'android-or-desktop';
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      (val) => {
        window.clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (!existing) {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    }
    return await withTimeout(
      navigator.serviceWorker.ready,
      8000,
      'Service Worker did not activate in time. Reload the page and try again.',
    );
  } catch (err) {
    console.warn('[PWA] ServiceWorker registration failed:', err);
    return null;
  }
}
