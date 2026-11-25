import { Show } from 'solid-js';
import { Bell, CheckCircle2, Download, Lock, Share, Smartphone } from 'lucide-solid';
import { notificationStore } from '@/stores/notificationStore';

export function SetupGate() {
  const mode = () => notificationStore.installMode();
  const pushStatus = () => notificationStore.status();
  const isInstalled = () => mode() === 'standalone';
  const isPushActive = () => pushStatus() === 'active';
  const isSecure = typeof window === 'undefined' ? true : window.isSecureContext;

  return (
    <main class="flex-1 flex items-center justify-center p-4 sm:p-6">
      <div class="w-full max-w-md glass-surface p-6 space-y-5">
        <div class="flex items-start gap-3">
          <span class="h-10 w-10 rounded-xl bg-primary/15 border border-primary/30 text-primary grid place-items-center shrink-0">
            <Lock size={19} />
          </span>
          <div>
            <h1 class="text-lg font-bold font-display">App Setup Required</h1>
            <p class="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              PulsePlan requires installing the app and enabling push notifications so you never miss event reminders or updates.
            </p>
          </div>
        </div>

        <Show when={!isSecure}>
          <div class="text-xs text-destructive bg-destructive/10 border border-destructive/25 px-3 py-2.5 rounded-xl">
            Open PulsePlan over <strong>HTTPS</strong> to install the app and enable push notifications.
          </div>
        </Show>

        {/* Step 1: Install App */}
        <div
          class={`p-4 rounded-xl border transition-colors space-y-3 ${
            isInstalled()
              ? 'border-primary/35 bg-primary/5'
              : 'border-border bg-card/60'
          }`}
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-sm font-semibold">
              <Show
                when={isInstalled()}
                fallback={
                  <span class="h-6 w-6 rounded-full bg-muted text-muted-foreground text-xs font-bold grid place-items-center">
                    1
                  </span>
                }
              >
                <CheckCircle2 size={20} class="text-primary shrink-0" />
              </Show>
              <span>Install PulsePlan App</span>
            </div>
            <span class={`text-[11px] font-semibold ${isInstalled() ? 'text-primary' : 'text-muted-foreground'}`}>
              {isInstalled() ? 'Installed' : 'Required'}
            </span>
          </div>

          <Show when={!isInstalled()}>
            <p class="text-xs text-muted-foreground leading-relaxed">
              <Show when={mode() === 'ios-in-app'}>
                In-app browser detected: tap <strong>••• → Open in Safari</strong>, then tap{' '}
                <Share size={12} class="inline mx-0.5 text-primary" /> <strong>Share → Add to Home Screen</strong> and launch PulsePlan from your Home Screen.
              </Show>
              <Show when={mode() === 'ios-safari'}>
                Tap <Share size={12} class="inline mx-0.5 text-primary" /> <strong>Share → Add to Home Screen</strong>, then open the installed PulsePlan icon from your Home Screen.
              </Show>
              <Show when={mode() === 'android-or-desktop' || mode() === 'unsupported'}>
                {notificationStore.canInstallPrompt()
                  ? 'Install PulsePlan to your device and open the installed app to continue.'
                  : 'Open your browser menu (⋮) → Install app / Add to Home screen, then launch the installed PulsePlan app.'}
              </Show>
            </p>

            <Show when={notificationStore.canInstallPrompt()}>
              <button
                type="button"
                onClick={() => void notificationStore.promptInstall()}
                class="w-full h-10 rounded-xl bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90"
              >
                <Download size={15} />
                Install PulsePlan App
              </button>
            </Show>

            <Show when={!notificationStore.canInstallPrompt() && (mode() === 'android-or-desktop' || mode() === 'unsupported')}>
              <div class="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/40 px-3 py-2 rounded-lg">
                <Smartphone size={14} class="text-primary shrink-0" />
                <span>If already installed, close this browser tab and open the PulsePlan app icon.</span>
              </div>
            </Show>
          </Show>
        </div>

        {/* Step 2: Allow Notifications */}
        <div
          class={`p-4 rounded-xl border transition-colors space-y-3 ${
            isPushActive()
              ? 'border-primary/35 bg-primary/5'
              : !isInstalled()
              ? 'border-border/60 bg-card/30 opacity-60'
              : 'border-border bg-card/60'
          }`}
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-sm font-semibold">
              <Show
                when={isPushActive()}
                fallback={
                  <span class="h-6 w-6 rounded-full bg-muted text-muted-foreground text-xs font-bold grid place-items-center">
                    2
                  </span>
                }
              >
                <CheckCircle2 size={20} class="text-primary shrink-0" />
              </Show>
              <span>Allow Push Notifications</span>
            </div>
            <span class={`text-[11px] font-semibold ${isPushActive() ? 'text-primary' : 'text-muted-foreground'}`}>
              {isPushActive() ? 'Enabled' : isInstalled() ? 'Required' : 'Locked'}
            </span>
          </div>

          <Show when={!isPushActive()}>
            <p class="text-xs text-muted-foreground leading-relaxed">
              {isInstalled()
                ? 'Allow notifications so you receive event invites, reschedules, cancellations, and 15-minute reminders.'
                : 'Complete Step 1 (open the installed app) before enabling push notifications.'}
            </p>

            <Show when={notificationStore.errorMsg()}>
              <p class="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                {notificationStore.errorMsg()}
              </p>
            </Show>

            <button
              type="button"
              disabled={!isInstalled() || pushStatus() === 'loading'}
              onClick={() => void notificationStore.enablePush()}
              class="w-full h-10 rounded-xl bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50"
            >
              <Bell size={15} />
              {pushStatus() === 'loading' ? 'Enabling Notifications...' : 'Allow Push Notifications'}
            </button>
          </Show>
        </div>
      </div>
    </main>
  );
}
