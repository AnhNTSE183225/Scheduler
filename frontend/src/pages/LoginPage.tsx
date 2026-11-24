import { Show, createSignal } from 'solid-js';
import { CalendarDays, Loader2, LogIn, UserPlus } from 'lucide-solid';
import { PwaInstallBanner } from '@/components/schedule/PwaInstallBanner';
import { SlidingSegmentedControl } from '@/components/ui/SlidingSegmentedControl';
import { authStore } from '@/stores/authStore';

type AuthMode = 'login' | 'register';

export function LoginPage() {
  const [mode, setMode] = createSignal<AuthMode>('login');
  const [displayName, setDisplayName] = createSignal('');
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [localError, setLocalError] = createSignal('');

  const busy = () => authStore.status() === 'loading';

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setLocalError('');
    authStore.clearError();
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setLocalError('');
    authStore.clearError();

    const u = username().trim();
    const p = password();

    if (mode() === 'register') {
      const dn = displayName().trim().replace(/\s+/g, ' ');
      setDisplayName(dn);
      setUsername(u);
      if (!dn || dn.length > 80) {
        setLocalError('Display name must be 1–80 characters.');
        return;
      }
      if (u.length < 3 || u.length > 32 || !/^[a-zA-Z0-9._-]+$/.test(u)) {
        setLocalError('Username must be 3–32 characters (letters, numbers, ., _, -).');
        return;
      }
      if (p.length < 8 || p.length > 128) {
        setLocalError('Password must be 8–128 characters.');
        return;
      }
      await authStore.register(dn, u, p);
    } else {
      setUsername(u);
      if (!u || !p) {
        setLocalError('Please enter your username and password.');
        return;
      }
      if (u.length < 3 || u.length > 32 || !/^[a-zA-Z0-9._-]+$/.test(u)) {
        setLocalError('Username must be 3–32 characters (letters, numbers, ., _, -).');
        return;
      }
      await authStore.login(u, p);
    }
  };

  return (
    <div class="min-h-[calc(100dvh-58px)] flex flex-col items-center justify-center gap-4 p-4">
      <div class="w-full max-w-md">
        <PwaInstallBanner installOnly />
      </div>
      <div class="glass-surface w-full max-w-md p-7 space-y-6">
        <div class="text-center space-y-2">
          <div class="mx-auto w-12 h-12 rounded-2xl bg-primary/15 border border-primary/30 text-primary flex items-center justify-center">
            <CalendarDays size={24} />
          </div>
          <h1 class="text-2xl font-bold font-display">PulsePlan Scheduler</h1>
          <p class="text-xs text-muted-foreground leading-relaxed">
            Create recurring events, share 1-tap RSVP links with friends, and get instant browser &amp; phone push reminders.
          </p>
        </div>

        <SlidingSegmentedControl<AuthMode>
          value={mode()}
          onChange={switchMode}
          options={[
            { value: 'login', label: 'Sign In' },
            { value: 'register', label: 'Register' },
          ]}
          className="w-full"
          buttonClassName="flex-1 py-1.5 text-xs font-semibold"
          ariaLabel="Authentication mode"
        />

        <form onSubmit={(e) => void handleSubmit(e)} class="space-y-3.5">
          <Show when={mode() === 'register'}>
            <div class="space-y-1">
              <label class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Display Name
              </label>
              <input
                type="text"
                autocomplete="name"
                value={displayName()}
                onInput={(e) => setDisplayName(e.currentTarget.value)}
                placeholder="Alex Nguyen"
                class="w-full h-10 px-3 rounded-xl border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>
          </Show>

          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Username
            </label>
            <input
              type="text"
              autocomplete="username"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              placeholder="alex_ng"
              class="w-full h-10 px-3 rounded-xl border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>

          <div class="space-y-1">
            <label class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Password
            </label>
            <input
              type="password"
              autocomplete={mode() === 'register' ? 'new-password' : 'current-password'}
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              placeholder={mode() === 'register' ? 'At least 8 characters' : 'Enter your password'}
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
            <Show
              when={busy()}
              fallback={mode() === 'register' ? <UserPlus size={15} /> : <LogIn size={15} />}
            >
              <Loader2 size={15} class="animate-spin" />
            </Show>
            {busy()
              ? mode() === 'register'
                ? 'Creating account...'
                : 'Signing in...'
              : mode() === 'register'
              ? 'Create Account'
              : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
