import { Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter as FilterIcon,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Users,
} from 'lucide-solid';
import { CustomSelect, type SelectOption } from '@/components/ui/CustomSelect';
import { SlidingSegmentedControl } from '@/components/ui/SlidingSegmentedControl';
import { AgendaView } from '@/components/schedule/AgendaView';
import { CalendarFilterDropdown } from '@/components/schedule/CalendarFilterDropdown';
import { MonthGrid } from '@/components/schedule/MonthGrid';
import { SplitBillModal } from '@/components/schedule/SplitBillModal';
import { WeekGrid } from '@/components/schedule/WeekGrid';
import { EventDetailsDialog } from '@/components/schedule/EventDetailsDialog';
import { EventEditorDialog } from '@/components/schedule/EventEditorDialog';
import { GroupModal } from '@/components/schedule/GroupModal';
import { PwaInstallBanner } from '@/components/schedule/PwaInstallBanner';
import { getCalendarLabel } from '@/lib/calendarColors';
import { expandEvents, getResponse, isInvited } from '@/lib/recurrence';
import type { Occurrence, RsvpScope, RsvpStatus, ScheduleEvent } from '@/models/schedule';
import { authStore } from '@/stores/authStore';
import { scheduleStore } from '@/stores/scheduleStore';

type View = 'agenda' | 'month' | 'week';
type Filter = 'all' | 'invited' | 'mine' | 'pending';

const FILTER_OPTIONS: SelectOption<Filter>[] = [
  { value: 'all', label: 'All group events', icon: <FilterIcon size={12} /> },
  { value: 'invited', label: 'Invited to me', icon: <Users size={12} /> },
  { value: 'pending', label: 'Needs my response', icon: <Clock size={12} /> },
  { value: 'mine', label: 'Organized by me', icon: <CalendarDays size={12} /> },
];

export function SchedulePage(props: { onOpenProfile?: () => void }) {
  const initialBill =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('bill')
      : null;
  const [view, setView] = createSignal<View>('agenda');
  const [filter, setFilter] = createSignal<Filter>('all');
  const [cursor, setCursor] = createSignal(startOfDay(new Date()));
  const [selected, setSelected] = createSignal<{ id: string; key: string } | null>(null);
  const [editing, setEditing] = createSignal<{ event?: ScheduleEvent; date?: Date } | null>(null);
  const [groupModalOpen, setGroupModalOpen] = createSignal(false);
  const [billsOpen, setBillsOpen] = createSignal(Boolean(initialBill));
  const [initialBillId, setInitialBillId] = createSignal<string | null>(initialBill);
  const [slideDir, setSlideDir] = createSignal<'right' | 'left'>('right');
  const [refreshing, setRefreshing] = createSignal(false);
  const [hiddenCalendarIds, setHiddenCalendarIds] = createSignal<string[]>([]);

  createEffect(
    on(
      () => authStore.calendars(),
      (cals) => {
        void scheduleStore.loadAll(cals);
      },
    ),
  );

  const userId = () => authStore.user()?.id || '';
  const visibleCalendarIds = createMemo(() => {
    const hidden = new Set(hiddenCalendarIds());
    return authStore
      .calendars()
      .map((c) => c.id)
      .filter((id) => !hidden.has(id));
  });

  const toggleCalendarVisibility = (calId: string) => {
    setHiddenCalendarIds((prev) =>
      prev.includes(calId) ? prev.filter((id) => id !== calId) : [...prev, calId],
    );
  };

  const range = createMemo(() => {
    const c = cursor();
    const v = view();
    if (v === 'month') return { from: startOfWeek(startOfMonth(c)), to: addDays(endOfWeek(endOfMonth(c)), 1) };
    if (v === 'week') return { from: startOfWeek(c), to: addDays(endOfWeek(c), 1) };
    return { from: startOfDay(c), to: addDays(startOfDay(c), 60) };
  });

  const occurrences = createMemo(() => {
    const r = range();
    const f = filter();
    const uid = userId();
    const visible = new Set(visibleCalendarIds());
    const memMap = scheduleStore.membersByCalendar();
    return expandEvents(scheduleStore.events(), r.from, r.to)
      .filter((o) => visible.has(o.event.calendarId))
      .filter((o) => {
        const mems = memMap[o.event.calendarId] || [];
        if (f === 'mine') return o.event.organizerId === uid;
        if (f === 'invited') return isInvited(o.event, uid, mems);
        if (f === 'pending') return isInvited(o.event, uid, mems) && !getResponse(o.event, o.key, uid);
        return true;
      });
  });

  const selectedOcc = createMemo<Occurrence | null>(() => {
    const sel = selected();
    if (!sel) return null;
    const ev = scheduleStore.events().find((e) => e.id === sel.id);
    if (!ev) return null;
    const d = parseISO(sel.key);
    return expandEvents([ev], d, addDays(d, 1))[0] ?? null;
  });

  const title = createMemo(() => {
    const v = view();
    const c = cursor();
    if (v === 'month') return format(c, 'MMMM yyyy');
    if (v === 'week') {
      const s = startOfWeek(c);
      const e = endOfWeek(c);
      return isSameMonth(s, e)
        ? `${format(s, 'MMM d')} – ${format(e, 'd, yyyy')}`
        : `${format(s, 'MMM d')} – ${format(e, 'MMM d, yyyy')}`;
    }
    return `Upcoming · from ${format(c, 'MMM d')}`;
  });

  const step = (dir: 1 | -1) => {
    setSlideDir(dir > 0 ? 'right' : 'left');
    setCursor((c) =>
      view() === 'month' ? addMonths(c, dir) : view() === 'week' ? addWeeks(c, dir) : addDays(c, 30 * dir),
    );
  };

  const goToday = () => {
    const today = startOfDay(new Date());
    setSlideDir(today >= cursor() ? 'right' : 'left');
    setCursor(today);
  };

  const handleViewChange = (nextView: View) => {
    if (nextView === view()) return;
    const order: Record<View, number> = { agenda: 0, month: 1, week: 2 };
    setSlideDir(order[nextView] >= order[view()] ? 'right' : 'left');
    setView(nextView);
  };

  const handleRefresh = async () => {
    const cals = authStore.calendars();
    if (!cals.length || refreshing()) return;
    setRefreshing(true);
    try {
      await scheduleStore.loadAll(cals);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <main class="room-main">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div class="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
            Shared Schedule &amp; Reminders
          </div>
          <h1 class="text-xl sm:text-2xl font-bold font-display">
            {authStore.calendars().length > 1 ? 'All Schedules' : 'My Schedule'}
            <span class="text-primary">.</span>
          </h1>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setInitialBillId(null);
              setBillsOpen(true);
            }}
            class="h-9 px-3 rounded-lg border border-border bg-card/70 hover:bg-accent text-xs font-medium inline-flex items-center gap-1.5"
          >
            <Receipt size={13} class="text-primary" />
            Split Bills
          </button>
          <button
            type="button"
            onClick={() => setGroupModalOpen(true)}
            class="h-9 px-3 rounded-lg border border-border bg-card/70 hover:bg-accent text-xs font-medium inline-flex items-center gap-1.5"
          >
            <Users size={13} class="text-primary" />
            Groups / Invite
          </button>
        </div>
      </div>

      <PwaInstallBanner />

      <section class="schedule-panel glass-surface" aria-label="Schedule">
        <div class="schedule-toolbar">
          <div class="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              aria-label="Previous"
              onClick={() => step(-1)}
              class="h-8 w-8 rounded-lg hover:bg-accent grid place-items-center text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => step(1)}
              class="h-8 w-8 rounded-lg hover:bg-accent grid place-items-center text-muted-foreground hover:text-foreground"
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              onClick={goToday}
              class="h-8 px-2.5 rounded-lg hover:bg-accent text-xs font-medium"
            >
              Today
            </button>
            <h2 class="schedule-title truncate">{title()}</h2>
            <Show when={scheduleStore.status() === 'loading' || refreshing()}>
              <Loader2 size={14} class="animate-spin text-muted-foreground ml-1" />
            </Show>
          </div>

          <div class="flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-2 w-full sm:w-auto">
            <div class="flex items-center gap-2 w-full sm:contents">
              <CalendarFilterDropdown
                calendars={authStore.calendars()}
                hiddenIds={hiddenCalendarIds()}
                onToggle={toggleCalendarVisibility}
                onShowAll={() => setHiddenCalendarIds([])}
                className="flex-1 min-w-0 sm:flex-none sm:order-1"
              />

              <CustomSelect
                value={filter()}
                onChange={setFilter}
                options={FILTER_OPTIONS}
                ariaLabel="Filter events"
                className="flex-1 min-w-0 sm:w-44 sm:flex-none sm:order-2"
              />
            </div>

            <SlidingSegmentedControl<View>
              value={view()}
              onChange={handleViewChange}
              options={[
                { value: 'agenda', label: 'Agenda' },
                { value: 'month', label: 'Month' },
                { value: 'week', label: 'Week' },
              ]}
              className="w-full sm:w-auto sm:order-3"
              buttonClassName="flex-1 sm:flex-initial py-1.5 text-xs"
              ariaLabel="Calendar view"
            />

            <div class="flex items-center gap-2 w-full sm:contents">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                title="Refresh schedule"
                aria-label="Refresh schedule"
                class="h-9 w-9 shrink-0 rounded-lg border border-border bg-card/70 hover:bg-accent grid place-items-center sm:order-4"
              >
                <RefreshCw size={13} class={refreshing() ? 'animate-spin' : ''} />
              </button>

              <button
                type="button"
                onClick={() => setEditing({ date: cursor() })}
                class="h-9 px-3.5 flex-1 justify-center sm:flex-initial shrink-0 rounded-lg bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90 sm:order-5"
              >
                <Plus size={14} /> New event
              </button>
            </div>
          </div>
        </div>

        <Show when={scheduleStore.errorMsg()}>
          <div class="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg mb-3 flex items-center justify-between">
            <span>{scheduleStore.errorMsg()}</span>
            <button type="button" onClick={() => void handleRefresh()} class="underline font-medium">
              Retry
            </button>
          </div>
        </Show>

        <div class="schedule-body">
          <Show when={view() === 'agenda'}>
            <div class={`${slideDir() === 'right' ? 'schedule-slide-from-right' : 'schedule-slide-from-left'} flex-1 min-h-0 flex flex-col`}>
              <AgendaView
                occurrences={occurrences()}
                userId={userId()}
                calendars={authStore.calendars()}
                membersByCalendar={scheduleStore.membersByCalendar()}
                onOpen={(o) => setSelected({ id: o.event.id, key: o.key })}
              />
            </div>
          </Show>
          <Show when={view() === 'month'}>
            <div class={`${slideDir() === 'right' ? 'schedule-slide-from-right' : 'schedule-slide-from-left'} flex-1 min-h-0 flex flex-col`}>
              <MonthGrid
                cursor={cursor()}
                occurrences={occurrences()}
                userId={userId()}
                calendars={authStore.calendars()}
                onOpen={(o) => setSelected({ id: o.event.id, key: o.key })}
                onDay={(d) => setEditing({ date: d })}
              />
            </div>
          </Show>
          <Show when={view() === 'week'}>
            <div class={`${slideDir() === 'right' ? 'schedule-slide-from-right' : 'schedule-slide-from-left'} flex-1 min-h-0 flex flex-col`}>
              <WeekGrid
                cursor={cursor()}
                occurrences={occurrences()}
                userId={userId()}
                calendars={authStore.calendars()}
                membersByCalendar={scheduleStore.membersByCalendar()}
                onOpen={(o) => setSelected({ id: o.event.id, key: o.key })}
              />
            </div>
          </Show>
        </div>
      </section>

      <EventDetailsDialog
        occ={selectedOcc()}
        userId={userId()}
        isAdmin={authStore.isAdmin()}
        members={selectedOcc() ? scheduleStore.membersForCalendar(selectedOcc()!.event.calendarId) : []}
        calendarName={
          selectedOcc()
            ? getCalendarLabel(selectedOcc()!.event.calendarId, authStore.calendars())
            : 'Schedule'
        }
        onClose={() => setSelected(null)}
        onEdit={() => {
          const occ = selectedOcc();
          if (occ) setEditing({ event: occ.event });
          setSelected(null);
        }}
        onDelete={async (whole) => {
          const occ = selectedOcc();
          if (!occ) return;
          await scheduleStore.deleteEvent(occ.event.calendarId, occ.event.id, whole ? undefined : occ.key);
          setSelected(null);
        }}
        onRespond={async (rsvpStatus: RsvpStatus, scope: RsvpScope) => {
          const occ = selectedOcc();
          if (!occ) return;
          await scheduleStore.respondEvent(occ.event.calendarId, occ.event.id, occ.key, rsvpStatus, scope);
        }}
      />

      <EventEditorDialog
        open={Boolean(editing())}
        userId={userId()}
        calendars={authStore.calendars()}
        membersByCalendar={scheduleStore.membersByCalendar()}
        defaultCalendarId={visibleCalendarIds()[0] || authStore.calendars()[0]?.id}
        initial={editing()?.event}
        date={editing()?.date}
        onClose={() => setEditing(null)}
        onSave={async (calendarId, data) => {
          const init = editing()?.event;
          if (init) {
            await scheduleStore.updateEvent(init.calendarId, init.id, data);
          } else {
            await scheduleStore.createEvent(calendarId, data);
          }
          setEditing(null);
        }}
      />

      <GroupModal open={groupModalOpen()} onClose={() => setGroupModalOpen(false)} />

      <SplitBillModal
        open={billsOpen()}
        initialBillId={initialBillId()}
        onClose={() => {
          setBillsOpen(false);
          setInitialBillId(null);
        }}
        onOpenProfile={() => props.onOpenProfile?.()}
      />

      <Show when={scheduleStore.liveToast()}>
        {(toast) => (
          <div class="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl border border-primary/40 bg-popover/95 shadow-2xl text-xs font-medium flex items-center gap-3 max-w-[calc(100vw-24px)]">
            <span class="w-2 h-2 rounded-full bg-primary shrink-0" />
            <span>{toast()}</span>
            <button
              type="button"
              onClick={() => scheduleStore.clearToast()}
              class="text-muted-foreground hover:text-foreground ml-1"
            >
              ✕
            </button>
          </div>
        )}
      </Show>
    </main>
  );
}
