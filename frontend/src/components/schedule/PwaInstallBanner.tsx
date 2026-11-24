import { Show } from 'solid-js';
import { Bell, BellOff, Download, Send, Share, Smartphone } from 'lucide-solid';
import { notificationStore } from '@/stores/notificationStore';

export function PwaInstallBanner(props: { publicShareToken?: string }) {
  const mode = () => notificationStore.installMode();
  const status = () => notificationStore.status();

  return (
    <div class="glass-surface px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <span class="h-9 w-9 rounded-xl bg-primary/15 border border-primary/25 text-primary flex items-center justify-center shrink-0">
          <Show when={mode() === 'ios-safari' || mode() === 'ios-in-app'} fallback={<Bell size={17} />}>
            <Smartphone size={17} />
          </Show>
        </span>
        <div class="min-w-0">
          <div class="text-xs font-semibold text-foreground flex items-center gap-2 flex-wrap">
            <span>Push Reminders</span>
            <Show when={status() === 'active'}>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 font-semibold">
                Active on this device
              </span>
            </Show>
          </div>
          <p class="text-[11px] text-muted-foreground mt-0.5">
            <Show when={mode() === 'ios-in-app'}>
              iPhone in-app browser detected: tap <strong>••• → Open in Safari</strong>, then Add to Home Screen for lock-screen reminders.
            </Show>
            <Show when={mode() === 'ios-safari'}>
              On iPhone, tap <Share size={11} class="inline mx-0.5 text-primary" /> <strong>Share → Add to Home Screen</strong> and open the app icon to receive push reminders.
            </Show>
            <Show when={mode() === 'android-or-desktop' || mode() === 'standalone'}>
              Get 15-minute &amp; start-time lock-screen alerts even when the browser is closed.
            </Show>
          </p>
          <Show when={notificationStore.errorMsg()}>
            <p class="text-[11px] text-destructive mt-1">{notificationStore.errorMsg()}</p>
          </Show>
          <Show when={notificationStore.feedbackMsg()}>
            <p class="text-[11px] text-primary mt-1">{notificationStore.feedbackMsg()}</p>
          </Show>
        </div>
      </div>

      <div class="flex items-center gap-2 flex-wrap shrink-0">
        <Show when={notificationStore.canInstallPrompt()}>
          <button
            type="button"
            onClick={() => void notificationStore.promptInstall()}
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card/70 hover:bg-accent text-xs font-medium text-foreground transition-colors"
          >
            <Download size={13} class="text-primary" />
            Install App
          </button>
        </Show>

        <Show
          when={status() === 'active'}
          fallback={
            <Show when={mode() !== 'ios-in-app' && mode() !== 'ios-safari'}>
              <button
                type="button"
                disabled={status() === 'loading'}
                onClick={() => void notificationStore.enablePush(props.publicShareToken)}
                class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
              >
                <Bell size={13} />
                {status() === 'loading' ? 'Enabling...' : 'Enable Push Reminders'}
              </button>
            </Show>
          }
        >
          <Show when={!props.publicShareToken}>
            <button
              type="button"
              onClick={() => void notificationStore.sendTest()}
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card/70 hover:bg-accent text-xs font-medium text-foreground"
            >
              <Send size={12} class="text-primary" />
              Test Push
            </button>
          </Show>
          <button
            type="button"
            onClick={() => void notificationStore.disablePush()}
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card/70 hover:bg-destructive/15 text-xs font-medium text-muted-foreground hover:text-destructive"
          >
            <BellOff size={12} />
            Disable
          </button>
        </Show>
      </div>
    </div>
  );
}
