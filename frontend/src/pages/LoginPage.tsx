import { Show, createSignal } from 'solid-js';
import { CalendarDays, Loader2, Sparkles } from 'lucide-solid';
import { authStore } from '@/stores/authStore';

export function LoginPage() {
  const [name, setName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [localError, setLocalError] = createSignal('');

  const busy = () => authStore.status() === 'loading';
  const cfg = () => authStore.authConfig();

  const handleDevSubmit = async (e: Event) => {
    e.preventDefault();
    setLocalError('');
    if (!name().trim()) {
      setLocalError('Please enter your name.');
      return;
    }
    await authStore.loginDev(name().trim(), email().trim() || undefined);
  };

  return (
    <div class="min-h-[calc(100dvh-58px)] flex items-center justify-center p-4">
      <div class="glass-surface w-full max-w-md p-7 space-y-6">
        <div class="text-center space-y-2">
          <div class="mx-auto w-12 h-12 rounded-2xl bg-primary/15 border border-primary/30 text-primary flex items-center justify-center">
            <CalendarDays size={24} />
          </div>
          <h1 class="text-2xl font-bold font-display">PulsePlan Scheduler</h1>
          <p class="text-xs text-muted-foreground leading-relaxed">
            Create recurring events, share 1-tap RSVP links with friends, and get instant browser &amp; phone lock-screen push reminders.
          </p>
        </div>

        <Show when={cfg().google_enabled}>
          <a
            href={`/api/auth/google/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}
            class="w-full h-11 rounded-xl bg-white text-zinc-900 font-semibold text-sm flex items-center justify-center gap-2.5 hover:bg-zinc-100 transition-colors shadow-sm"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.68-.22-2.48H12v4.69h6.46a5.52 5.52 0 0 1-2.39 3.62v3.01h3.87c2.26-2.08 3.58-5.15 3.58-8.84Z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.94-2.91l-3.87-3.01c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A12 12 0 0 0 12 24Z" />
              <path fill="#FBBC05" d="M5.27 14.27A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.27V6.62H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.38l4-3.11Z" />
              <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.11C6.22 6.88 8.87 4.77 12 4.77Z" />
            </svg>
            Continue with Google
          </a>
        </Show>

        <Show when={cfg().google_enabled && cfg().dev_login_enabled}>
          <div class="relative flex items-center py-1">
            <div class="flex-grow border-t border-border" />
            <span class="px-3 text-[11px] uppercase tracking-wider text-muted-foreground">or quick local profile</span>
            <div class="flex-grow border-t border-border" />
          </div>
        </Show>

        <Show when={cfg().dev_login_enabled}>
          <form onSubmit={(e) => void handleDevSubmit(e)} class="space-y-3">
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Your Name
              </label>
              <input
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="Alex"
                class="w-full h-10 px-3 rounded-xl border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Email (optional)
              </label>
              <input
                type="email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                placeholder="alex@example.com"
                class="w-full h-10 px-3 rounded-xl border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>

            <Show when={localError() || authStore.errorMsg()}>
              <p class="text-xs text-destructive font-medium">{localError() || authStore.errorMsg()}</p>
            </Show>

            <button
              type="submit"
              disabled={busy()}
              class="w-full h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              <Show when={busy()} fallback={<Sparkles size={15} />}>
                <Loader2 size={15} class="animate-spin" />
              </Show>
              {busy() ? 'Signing in...' : 'Start Scheduling'}
            </button>
          </form>
        </Show>
      </div>
    </div>
  );
}
