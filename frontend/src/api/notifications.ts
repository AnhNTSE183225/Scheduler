import { apiFetch } from './client';
import type { StateMachineDTO } from '@/models/schedule';

export function fetchVapidPublicKey(): Promise<{ publicKey: string }> {
  return apiFetch<{ publicKey: string }>('/push/vapid-key');
}

export function postPushSubscribe(subscription: PushSubscriptionJSON): Promise<StateMachineDTO<{ subscriptionId: string }>> {
  return apiFetch('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      userAgent: navigator.userAgent,
    }),
  });
}

export function postPublicPushSubscribe(
  shareToken: string,
  subscription: PushSubscriptionJSON,
): Promise<StateMachineDTO<{ subscriptionId: string }>> {
  return apiFetch(`/public/events/${encodeURIComponent(shareToken)}/push-subscribe`, {
    method: 'POST',
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      userAgent: navigator.userAgent,
    }),
  });
}

export function postPushUnsubscribe(endpoint: string): Promise<StateMachineDTO<{ ok: boolean }>> {
  return apiFetch('/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  });
}

export function postTestPush(): Promise<StateMachineDTO<{ subscriptions: number; delivered: number }>> {
  return apiFetch('/push/test', {
    method: 'POST',
  });
}

export function postStreamTicket(
  calendarId: string,
): Promise<StateMachineDTO<{ ticket: string; expiresInSeconds: number }>> {
  return apiFetch(`/stream/${encodeURIComponent(calendarId)}/ticket`, {
    method: 'POST',
  });
}
