import { Show, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import { EventEditorDialog } from '@/components/schedule/EventEditorDialog';
import { SlidingSegmentedControl } from '@/components/ui/SlidingSegmentedControl';
import { MobileEventDetailsSheet } from './MobileEventDetailsSheet';
import { MobileGroupsTab } from './MobileGroupsTab';
import { MobileProfileTab } from './MobileProfileTab';
import { MobileScheduleTab } from './MobileScheduleTab';
import { MobileSplitBillsTab } from './MobileSplitBillsTab';
import type { Occurrence, ScheduleEvent } from '@/models/schedule';
import { authStore } from '@/stores/authStore';
import { scheduleStore } from '@/stores/scheduleStore';

type MobileTab = 'schedule' | 'bills' | 'groups' | 'profile';
const TAB_ORDER: MobileTab[] = ['schedule', 'bills', 'groups', 'profile'];

export function MobileAppShell() {
  const initialBill =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('bill')
      : null;

  const [tab, setTab] = createSignal<MobileTab>(initialBill ? 'bills' : 'schedule');
  const [slideDir, setSlideDir] = createSignal<'left' | 'right' | null>(null);
  const [billDeepLink, setBillDeepLink] = createSignal<string | null>(initialBill);
  const [selectedOcc, setSelectedOcc] = createSignal<Occurrence | null>(null);
  const [editing, setEditing] = createSignal<{ event?: ScheduleEvent; date?: Date } | null>(null);

  const switchTab = (next: MobileTab) => {
    const prevIdx = TAB_ORDER.indexOf(tab());
    const nextIdx = TAB_ORDER.indexOf(next);
    if (prevIdx !== nextIdx) {
      setSlideDir(nextIdx > prevIdx ? 'right' : 'left');
      setTab(next);
    }
  };

  const tabSlideClass = () =>
    slideDir() === 'right'
      ? 'flex-1 min-h-0 flex flex-col overflow-hidden schedule-slide-from-right'
      : slideDir() === 'left'
      ? 'flex-1 min-h-0 flex flex-col overflow-hidden schedule-slide-from-left'
      : 'flex-1 min-h-0 flex flex-col overflow-hidden';

  createEffect(
    on(
      () => authStore.calendars(),
      (cals) => {
        void scheduleStore.loadAll(cals);
      },
    ),
  );

  // Strictly block iOS/mobile root-viewport rubber-band scrolling outside internal scroll containers.
  onMount(() => {
    const preventGlobalTouchScroll = (e: TouchEvent) => {
      if (e.touches.length > 1) return;
      let el = e.target as HTMLElement | null;
      while (el && el !== document.body && el !== document.documentElement) {
        const style = window.getComputedStyle(el);
        const canScrollY =
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight;
        const canScrollX =
          (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
          el.scrollWidth > el.clientWidth;
        if (canScrollY || canScrollX) return;
        el = el.parentElement;
      }
      e.preventDefault();
    };
    document.addEventListener('touchmove', preventGlobalTouchScroll, { passive: false });
    onCleanup(() => document.removeEventListener('touchmove', preventGlobalTouchScroll));
  });

  return (
    <div class="mobile-shell fixed inset-0 overflow-hidden flex flex-col bg-background text-foreground">
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Show when={tab() === 'schedule'}>
          <div class={tabSlideClass()}>
            <MobileScheduleTab
              onOpenEvent={(o) => setSelectedOcc(o)}
              onCreateEvent={(date) => setEditing({ date })}
              onGoProfile={() => switchTab('profile')}
            />
          </div>
        </Show>

        <Show when={tab() === 'bills'}>
          <div class={tabSlideClass()}>
            <MobileSplitBillsTab
              initialBillId={billDeepLink()}
              onClearInitialBill={() => setBillDeepLink(null)}
              onGoProfile={() => switchTab('profile')}
            />
          </div>
        </Show>

        <Show when={tab() === 'groups'}>
          <div class={tabSlideClass()}>
            <MobileGroupsTab />
          </div>
        </Show>

        <Show when={tab() === 'profile'}>
          <div class={tabSlideClass()}>
            <MobileProfileTab />
          </div>
        </Show>
      </div>

      {/* Floating Capsule Bottom Tab Bar */}
      <nav
        aria-label="Mobile navigation"
        class="fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(18px,env(safe-area-inset-bottom))] pointer-events-none"
      >
        <SlidingSegmentedControl
          value={tab()}
          onChange={switchTab}
          ariaLabel="Mobile navigation"
          className="mobile-view-pill pointer-events-auto w-full !flex !p-1.5 !rounded-full !border-border !bg-popover/95 backdrop-blur-xl shadow-2xl !gap-0"
          indicatorClassName="!top-1.5 !bottom-1.5 !rounded-full !bg-primary !shadow-sm"
          buttonClassName="flex-1 h-11 !rounded-full !px-2 !text-[13.5px] !font-medium"
          options={[
            { value: 'schedule', label: 'Schedule' },
            { value: 'bills', label: 'Split Bills' },
            { value: 'groups', label: 'Groups' },
            { value: 'profile', label: 'Profile' },
          ]}
        />
      </nav>

      {/* Mobile Event Details Bottom Sheet */}
      <MobileEventDetailsSheet
        occ={selectedOcc()}
        userId={authStore.user()?.id || ''}
        isAdmin={authStore.isAdmin()}
        members={
          selectedOcc()
            ? scheduleStore.membersByCalendar()[selectedOcc()!.event.calendarId] || []
            : []
        }
        onClose={() => setSelectedOcc(null)}
        onEdit={() => {
          const cur = selectedOcc();
          setSelectedOcc(null);
          if (cur) setEditing({ event: cur.event });
        }}
        onDelete={async (scope) => {
          const cur = selectedOcc();
          if (!cur) return;
          await scheduleStore.deleteEvent(
            cur.event.calendarId,
            cur.event.id,
            scope === 'occurrence' ? cur.key : undefined,
          );
          setSelectedOcc(null);
        }}
        onRespond={async (rsvpStatus, scope) => {
          const cur = selectedOcc();
          if (!cur) return;
          const updated = await scheduleStore.respondEvent(
            cur.event.calendarId,
            cur.event.id,
            cur.key,
            rsvpStatus,
            scope,
          );
          setSelectedOcc({ ...cur, event: updated });
        }}
      />

      {/* Event Editor (full-screen on mobile via Dialog) */}
      <EventEditorDialog
        open={Boolean(editing())}
        userId={authStore.user()?.id || ''}
        calendars={authStore.calendars()}
        membersByCalendar={scheduleStore.membersByCalendar()}
        defaultCalendarId={authStore.activeCalendarId() || authStore.calendars()[0]?.id}
        initial={editing()?.event}
        date={editing()?.date}
        onClose={() => setEditing(null)}
        onSave={async (calendarId, data) => {
          const ed = editing();
          if (ed?.event) {
            await scheduleStore.updateEvent(ed.event.calendarId, ed.event.id, data);
          } else {
            await scheduleStore.createEvent(calendarId, data);
          }
          setEditing(null);
        }}
      />
    </div>
  );
}
