import { Show, createEffect, createSignal, on } from 'solid-js';
import { EventEditorDialog } from '@/components/schedule/EventEditorDialog';
import { MobileEventDetailsSheet } from './MobileEventDetailsSheet';
import { MobileGroupsTab } from './MobileGroupsTab';
import { MobileProfileTab } from './MobileProfileTab';
import { MobileScheduleTab } from './MobileScheduleTab';
import { MobileSplitBillsTab } from './MobileSplitBillsTab';
import type { Occurrence, ScheduleEvent } from '@/models/schedule';
import { authStore } from '@/stores/authStore';
import { scheduleStore } from '@/stores/scheduleStore';

type MobileTab = 'schedule' | 'bills' | 'groups' | 'profile';

export function MobileAppShell() {
  const initialBill =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('bill')
      : null;

  const [tab, setTab] = createSignal<MobileTab>(initialBill ? 'bills' : 'schedule');
  const [billDeepLink, setBillDeepLink] = createSignal<string | null>(initialBill);
  const [selectedOcc, setSelectedOcc] = createSignal<Occurrence | null>(null);
  const [editing, setEditing] = createSignal<{ event?: ScheduleEvent; date?: Date } | null>(null);

  createEffect(
    on(
      () => authStore.calendars(),
      (cals) => {
        void scheduleStore.loadAll(cals);
      },
    ),
  );

  return (
    <div class="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <div class="flex-1 flex flex-col">
        <Show when={tab() === 'schedule'}>
          <MobileScheduleTab
            onOpenEvent={(o) => setSelectedOcc(o)}
            onCreateEvent={(date) => setEditing({ date })}
            onGoProfile={() => setTab('profile')}
          />
        </Show>

        <Show when={tab() === 'bills'}>
          <MobileSplitBillsTab
            initialBillId={billDeepLink()}
            onClearInitialBill={() => setBillDeepLink(null)}
            onGoProfile={() => setTab('profile')}
          />
        </Show>

        <Show when={tab() === 'groups'}>
          <MobileGroupsTab />
        </Show>

        <Show when={tab() === 'profile'}>
          <MobileProfileTab />
        </Show>
      </div>

      {/* Floating Capsule Bottom Tab Bar */}
      <nav
        aria-label="Mobile navigation"
        class="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(18px,env(safe-area-inset-bottom))] pointer-events-none"
      >
        <div class="pointer-events-auto flex p-1.5 rounded-full border border-border bg-popover/95 backdrop-blur-xl shadow-2xl text-[13.5px] font-medium">
          <button
            type="button"
            onClick={() => setTab('schedule')}
            class={`flex-1 h-11 rounded-full grid place-items-center ${
              tab() === 'schedule'
                ? 'bg-primary text-primary-foreground font-semibold'
                : 'text-muted-foreground'
            }`}
          >
            Schedule
          </button>
          <button
            type="button"
            onClick={() => setTab('bills')}
            class={`flex-1 h-11 rounded-full grid place-items-center ${
              tab() === 'bills'
                ? 'bg-primary text-primary-foreground font-semibold'
                : 'text-muted-foreground'
            }`}
          >
            Split Bills
          </button>
          <button
            type="button"
            onClick={() => setTab('groups')}
            class={`flex-1 h-11 rounded-full grid place-items-center ${
              tab() === 'groups'
                ? 'bg-primary text-primary-foreground font-semibold'
                : 'text-muted-foreground'
            }`}
          >
            Groups
          </button>
          <button
            type="button"
            onClick={() => setTab('profile')}
            class={`flex-1 h-11 rounded-full grid place-items-center ${
              tab() === 'profile'
                ? 'bg-primary text-primary-foreground font-semibold'
                : 'text-muted-foreground'
            }`}
          >
            Profile
          </button>
        </div>
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
