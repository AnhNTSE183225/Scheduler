import { Show, createMemo, createSignal, onMount } from 'solid-js';
import { CalendarDays, Loader2, LogOut } from 'lucide-solid';
import { getStoredToken } from '@/api/client';
import { AvatarBadge } from '@/components/schedule/AvatarBadge';
import { MobileAppShell } from '@/components/mobile/MobileAppShell';
import { ProfileModal } from '@/components/schedule/ProfileModal';
import { SetupGate } from '@/components/schedule/SetupGate';
import { useIsMobile } from '@/lib/useIsMobile';
import { LoginPage } from '@/pages/LoginPage';
import { PublicEventPage } from '@/pages/PublicEventPage';
import { SchedulePage } from '@/pages/SchedulePage';
import { authStore } from '@/stores/authStore';
import { notificationStore } from '@/stores/notificationStore';
import { scheduleStore } from '@/stores/scheduleStore';

export function App() {
  const [pathname, setPathname] = createSignal(
    typeof window !== 'undefined' ? window.location.pathname : '/',
  );
  const [profileOpen, setProfileOpen] = createSignal(false);
  const isMobile = useIsMobile();

  onMount(() => {
    void authStore.bootstrap();
    void notificationStore.init();
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  const publicShareToken = createMemo(() => {
    const match = pathname().match(/^\/e\/([A-Za-z0-9_-]+)\/?$/);
    return match ? match[1] : null;
  });

  const goHome = () => {
    window.history.pushState(null, '', '/');
    setPathname('/');
  };

  const showMobileApp = () =>
    isMobile() &&
    Boolean(authStore.user()) &&
    notificationStore.initialized() &&
    notificationStore.installMode() === 'standalone' &&
    notificationStore.status() === 'active' &&
    !publicShareToken();

  return (
    <div class="app-shell">
      <div class="ambient-glow" />

      <Show when={!showMobileApp()}>
        <header class="app-header">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            goHome();
          }}
          class="brand-mark"
        >
          <span class="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 text-primary grid place-items-center">
            <CalendarDays size={18} />
          </span>
          <span class="logo-text">
            <span class="text-white">Pulse</span>
            <span class="text-primary">Plan</span>
          </span>
        </a>

        <Show when={authStore.user()}>
          {(u) => (
            <div class="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                title="Profile & account settings"
                class="flex items-center gap-2 px-2.5 py-1 rounded-full border border-border bg-card/60 hover:bg-accent transition-colors"
              >
                <AvatarBadge name={u().displayName} avatar={u().avatar} size={22} />
                <span class="text-xs font-medium max-w-[140px] truncate">{u().displayName}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  scheduleStore.disconnect();
                  void authStore.logout();
                }}
                title="Sign out"
                aria-label="Sign out"
                class="h-8 w-8 rounded-lg border border-border bg-card/60 hover:bg-accent grid place-items-center text-muted-foreground hover:text-foreground"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </Show>
      </header>
      </Show>

      <Show
        when={authStore.status() !== 'loading' || Boolean(authStore.user()) || !getStoredToken()}
        fallback={
          <div class="flex-1 flex items-center justify-center p-8 text-sm text-muted-foreground gap-2">
            <Loader2 size={18} class="animate-spin text-primary" /> Loading PulsePlan...
          </div>
        }
      >
        <Show when={authStore.user()} fallback={<LoginPage />}>
          <Show
            when={notificationStore.initialized()}
            fallback={
              <div class="flex-1 flex items-center justify-center p-8 text-sm text-muted-foreground gap-2">
                <Loader2 size={18} class="animate-spin text-primary" /> Checking app &amp; notification status...
              </div>
            }
          >
            <Show
              when={
                notificationStore.installMode() === 'standalone' &&
                notificationStore.status() === 'active'
              }
              fallback={<SetupGate />}
            >
              <Show
                when={!publicShareToken()}
                fallback={<PublicEventPage shareToken={publicShareToken()!} onBackHome={goHome} />}
              >
                <Show
                  when={!isMobile()}
                  fallback={<MobileAppShell />}
                >
                  <SchedulePage onOpenProfile={() => setProfileOpen(true)} />
                </Show>
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>

      <ProfileModal open={profileOpen()} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
