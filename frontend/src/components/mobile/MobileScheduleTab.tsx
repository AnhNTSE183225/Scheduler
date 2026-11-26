import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-solid';
import { AvatarBadge } from '@/components/schedule/AvatarBadge';
import { getCategoryMeta } from '@/components/pickers/CategoryMeta';
import { SlidingSegmentedControl } from '@/components/ui/SlidingSegmentedControl';
import { getCalendarColor, getCalendarLabel } from '@/lib/calendarColors';
import { expandEvents, getResponse, isInvited, isOccurrenceOnDay } from '@/lib/recurrence';
import type { Occurrence, ScheduleEvent } from '@/models/schedule';
import { authStore } from '@/stores/authStore';
import { scheduleStore } from '@/stores/scheduleStore';

type MobileView = 'agenda' | 'month' | '3day';
const VIEW_ORDER: MobileView[] = ['agenda', 'month', '3day'];

const HOUR_PX = 48;

export function MobileScheduleTab(props: {
  onOpenEvent: (o: Occurrence) => void;
  onCreateEvent: (date?: Date) => void;
  onGoProfile: () => void;
}) {
  const user = () => authStore.user();
  const calendars = () => authStore.calendars();
  const [cursor, setCursor] = createSignal(startOfDay(new Date()));
  const [view, setView] = createSignal<MobileView>('agenda');
  const [viewSlideDir, setViewSlideDir] = createSignal<'left' | 'right' | null>(null);
  const [hiddenIds, setHiddenIds] = createSignal<string[]>([]);
  const [calSheetOpen, setCalSheetOpen] = createSignal(false);
  const [now, setNow] = createSignal(new Date());

  const switchView = (next: MobileView) => {
    const prevIdx = VIEW_ORDER.indexOf(view());
    const nextIdx = VIEW_ORDER.indexOf(next);
    if (prevIdx !== nextIdx) {
      setViewSlideDir(nextIdx > prevIdx ? 'right' : 'left');
      setView(next);
    }
  };

  const viewSlideClass = () =>
    viewSlideDir() === 'right'
      ? 'schedule-slide-from-right'
      : viewSlideDir() === 'left'
      ? 'schedule-slide-from-left'
      : '';

  let agendaRef: HTMLDivElement | undefined;
  let didAutoScroll = false;

  onMount(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setNow(new Date());
    }, 60_000);
    const onVis = () => {
      if (!document.hidden) setNow(new Date());
    };
    document.addEventListener('visibilitychange', onVis);
    onCleanup(() => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    });
  });

  const visibleEvents = createMemo(() => {
    const hidden = hiddenIds();
    return scheduleStore.events().filter((e) => !hidden.includes(e.calendarId));
  });

  const weekDays = createMemo(() => {
    const start = startOfWeek(cursor());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  });

  const rangeStart = createMemo(() => {
    if (view() === 'month') return startOfWeek(startOfMonth(cursor()));
    if (view() === '3day') return startOfDay(cursor());
    return startOfDay(cursor());
  });

  const rangeEnd = createMemo(() => {
    if (view() === 'month') return addDays(endOfWeek(endOfMonth(cursor())), 1);
    if (view() === '3day') return addDays(startOfDay(cursor()), 3);
    return addDays(startOfDay(cursor()), 60);
  });

  const occurrences = createMemo(() =>
    expandEvents(visibleEvents(), rangeStart(), rangeEnd()),
  );

  // For dot indicators on the 7-day strip & Month grid
  const stripOccurrences = createMemo(() => {
    const start = weekDays()[0];
    const end = addDays(start, 7);
    return expandEvents(visibleEvents(), start, end);
  });

  const agendaGroups = createMemo(() => {
    const map = new Map<string, { day: Date; items: Occurrence[] }>();
    for (const o of occurrences()) {
      let cur = startOfDay(o.start);
      while (cur < o.end) {
        const key = format(cur, 'yyyy-MM-dd');
        let g = map.get(key);
        if (!g) {
          g = { day: cur, items: [] };
          map.set(key, g);
        }
        g.items.push(o);
        cur = addDays(cur, 1);
        if (cur >= o.end && !isSameDay(cur, o.end)) break;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.day.getTime() - b.day.getTime());
  });

  const nextUpcomingKey = createMemo(() => {
    const nowMs = now().getTime();
    let sawPast = false;
    for (const g of agendaGroups()) {
      for (const o of g.items) {
        if (o.end.getTime() <= nowMs) {
          sawPast = true;
        } else {
          return sawPast ? `${format(g.day, 'yyyy-MM-dd')}::${o.key}` : null;
        }
      }
    }
    return null;
  });

  createEffect(() => {
    const target = nextUpcomingKey();
    if (!target || didAutoScroll || view() !== 'agenda') return;
    didAutoScroll = true;
    requestAnimationFrame(() => {
      const el = agendaRef?.querySelector('[data-next-upcoming="true"]');
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });

  const activeGroupLabel = () => {
    const cals = calendars();
    const visible = cals.filter((c) => !hiddenIds().includes(c.id));
    if (visible.length === 1) return visible[0].isPersonal ? 'Personal' : visible[0].name;
    if (visible.length === cals.length) {
      return cals.length > 1 ? 'All Calendars' : cals[0]?.isPersonal ? 'Personal' : cals[0]?.name || 'Schedule';
    }
    return `Calendars (${visible.length}/${cals.length})`;
  };

  const monthDays = createMemo(() => {
    const start = startOfWeek(startOfMonth(cursor()));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  });

  const selectedDayItems = createMemo(() =>
    occurrences().filter((o) => isOccurrenceOnDay(o, cursor())),
  );

  const threeDays = createMemo(() => [cursor(), addDays(cursor(), 1), addDays(cursor(), 2)]);

  const formatCardTime = (o: Occurrence, day: Date) => {
    const isStart = isSameDay(o.start, day);
    const isEnd = isSameDay(o.end, day);
    if (!isSameDay(o.start, o.end)) {
      const daysCount = Math.max(2, Math.round((o.end.getTime() - o.start.getTime()) / 86_400_000) + 1);
      return `${daysCount} days`;
    }
    return `${isStart ? format(o.start, 'HH:mm') : '00:00'} - ${isEnd ? format(o.end, 'HH:mm') : '24:00'}`;
  };

  return (
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Top Bar: Group Pill + Avatar Circle */}
      <div class="flex items-center justify-between px-[18px] pt-3 pb-2 shrink-0">
        <button
          type="button"
          onClick={() => setCalSheetOpen(true)}
          class="flex items-center gap-2 h-11 px-4 rounded-full border border-border bg-card/60 text-sm font-medium text-foreground"
        >
          <span class="truncate max-w-[190px]">{activeGroupLabel()}</span>
          <ChevronDown size={14} class="text-muted-foreground shrink-0" />
        </button>

        <button
          type="button"
          onClick={props.onGoProfile}
          aria-label="Profile"
          class="w-11 h-11 rounded-full grid place-items-center"
        >
          <AvatarBadge name={user()?.displayName || 'U'} avatar={user()?.avatar} size={42} />
        </button>
      </div>

      {/* 7-Day Strip */}
      <div class="flex justify-between px-[18px] pt-2 shrink-0">
        <For each={weekDays()}>
          {(d) => {
            const isSelected = () => isSameDay(d, cursor());
            const hasEvents = () => stripOccurrences().some((o) => isOccurrenceOnDay(o, d));
            return (
              <button
                type="button"
                onClick={() => setCursor(startOfDay(d))}
                class="flex flex-col items-center gap-1.5 w-11"
              >
                <span
                  class={`text-[13px] ${
                    isSelected() ? 'text-foreground font-semibold' : 'text-muted-foreground'
                  }`}
                >
                  {format(d, 'EEE')}
                </span>
                <span
                  class={`w-10 h-10 rounded-full grid place-items-center text-[15px] font-medium transition-colors ${
                    isSelected()
                      ? 'bg-primary text-primary-foreground font-bold'
                      : isToday(d)
                      ? 'border border-primary/50 text-primary'
                      : 'text-foreground'
                  }`}
                >
                  {format(d, 'd')}
                </span>
                <span
                  class={`w-1.5 h-1.5 rounded-full ${
                    hasEvents()
                      ? isSelected()
                        ? 'bg-primary'
                        : 'bg-muted-foreground/60'
                      : 'bg-transparent'
                  }`}
                />
              </button>
            );
          }}
        </For>
      </div>

      {/* Segmented Pill: Agenda | Month | 3-Day */}
      <SlidingSegmentedControl
        value={view()}
        onChange={switchView}
        ariaLabel="Schedule view"
        className="mobile-view-pill shrink-0 mx-[18px] mt-4 !flex !p-1 !rounded-full !border-border !bg-card/40 !gap-0"
        indicatorClassName="!top-1 !bottom-1 !rounded-full !bg-primary !shadow-sm"
        buttonClassName="flex-1 h-10 !rounded-full !text-sm !font-medium"
        options={[
          { value: 'agenda', label: 'Agenda' },
          { value: 'month', label: 'Month' },
          { value: '3day', label: '3-Day' },
        ]}
      />

      {/* BODY */}
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden px-[18px]" ref={agendaRef}>
        {/* AGENDA VIEW */}
        <Show when={view() === 'agenda'}>
          <div class={`flex-1 min-h-0 overflow-y-auto overscroll-contain pb-40 ${viewSlideClass()}`}>
          <Show
            when={agendaGroups().length > 0}
            fallback={
              <div class="mt-8 p-8 rounded-[23.5px] border border-dashed border-border text-center text-sm text-muted-foreground">
                No upcoming events. Tap <strong>+</strong> to create one.
              </div>
            }
          >
            <For each={agendaGroups()}>
              {(g) => (
                <div>
                  <p class="mt-6 px-3 text-[13.5px] font-medium text-muted-foreground">
                    {isToday(g.day) ? `Today, ${format(g.day, 'EEE MMM d')}` : format(g.day, 'EEE, MMM d')}
                  </p>
                  <div class="mt-2.5 space-y-3">
                    <For each={g.items}>
                      {(o) => {
                        const isPast = () => o.end.getTime() <= now().getTime();
                        const st = () => getResponse(o.event, o.key, user()?.id || '');
                        const calTheme = () => getCalendarColor(o.event.calendarId, calendars());
                        const calLabel = () => getCalendarLabel(o.event.calendarId, calendars());
                        const calMembers = () => scheduleStore.membersByCalendar()[o.event.calendarId] || [];
                        const invited = () => isInvited(o.event, user()?.id || '', calMembers());
                        const isNext = () =>
                          nextUpcomingKey() === `${format(g.day, 'yyyy-MM-dd')}::${o.key}`;
                        const badgeText = () => {
                          if (isPast()) return 'Ended';
                          if (!invited()) return 'Open';
                          if (st() === 'accepted') return 'Going';
                          if (st() === 'tentative') return 'Maybe';
                          if (st() === 'declined') return 'Declined';
                          return 'Respond';
                        };

                        return (
                          <button
                            type="button"
                            data-next-upcoming={isNext() ? 'true' : undefined}
                            onClick={() => props.onOpenEvent(o)}
                            class={`w-full text-left rounded-[23.5px] border border-border bg-card/60 px-5 pt-4 pb-5 transition-opacity ${
                              isPast() ? 'opacity-50' : ''
                            }`}
                          >
                            <div class="flex justify-between items-center gap-2">
                              <span class="text-[14px] font-mono font-semibold text-muted-foreground">
                                {formatCardTime(o, g.day)}
                              </span>
                              <span
                                class={`h-7 px-3 rounded-full text-[13px] font-semibold grid place-items-center ${
                                  !isPast() && st() === 'accepted'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'border border-border text-muted-foreground'
                                }`}
                              >
                                {badgeText()}
                              </span>
                            </div>

                            <p class="mt-3 text-[23px] leading-[29px] font-semibold text-foreground truncate">
                              {o.event.title}
                            </p>

                            <div class="mt-3 flex flex-wrap gap-2">
                              <span
                                class="h-7 px-3 rounded-full text-xs font-medium inline-flex items-center gap-1.5 border"
                                style={{
                                  'border-color': calTheme().borderTint,
                                  background: calTheme().bgTint,
                                  color: calTheme().accent,
                                }}
                              >
                                <span
                                  class="w-1.5 h-1.5 rounded-full"
                                  style={{ background: calTheme().accent }}
                                />
                                {calLabel()}
                              </span>
                              <Show when={o.event.location}>
                                {(loc) => (
                                  <span class="h-7 px-3 rounded-full border border-border text-xs text-muted-foreground inline-flex items-center max-w-[200px] truncate">
                                    {loc().kind === 'address' ? loc().address : 'Online link'}
                                  </span>
                                )}
                              </Show>
                            </div>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </Show>
          </div>
        </Show>

        {/* MONTH VIEW: Static dot grid + scrollable selected day's agenda underneath */}
        <Show when={view() === 'month'}>
          <div class={`flex-1 min-h-0 flex flex-col overflow-hidden ${viewSlideClass()}`}>
          <div class="mt-5 shrink-0 rounded-[23.5px] border border-border bg-card/50 p-4">
            <div class="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                class="w-9 h-9 rounded-full border border-border grid place-items-center"
              >
                <ChevronLeft size={16} />
              </button>
              <span class="text-sm font-bold">{format(cursor(), 'MMMM yyyy')}</span>
              <button
                type="button"
                onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                class="w-9 h-9 rounded-full border border-border grid place-items-center"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div class="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground mb-1">
              <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
            </div>

            <div class="grid grid-cols-7 gap-1">
              <For each={monthDays()}>
                {(d) => {
                  const dayEvents = createMemo(() =>
                    occurrences().filter((o) => isOccurrenceOnDay(o, d)),
                  );
                  const isSel = () => isSameDay(d, cursor());
                  return (
                    <button
                      type="button"
                      onClick={() => setCursor(startOfDay(d))}
                      class={`py-1.5 rounded-xl flex flex-col items-center gap-1 ${
                        isSel()
                          ? 'bg-primary text-primary-foreground font-bold'
                          : isSameMonth(d, cursor())
                          ? 'text-foreground'
                          : 'text-muted-foreground/40'
                      }`}
                    >
                      <span class="text-xs">{format(d, 'd')}</span>
                      <div class="flex gap-0.5 h-1.5">
                        <For each={dayEvents().slice(0, 3)}>
                          {(o) => (
                            <span
                              class="w-1.5 h-1.5 rounded-full"
                              style={{
                                background: isSel()
                                  ? 'currentColor'
                                  : getCalendarColor(o.event.calendarId, calendars()).accent,
                              }}
                            />
                          )}
                        </For>
                      </div>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-40">
          <p class="mt-5 px-3 text-[13.5px] font-medium text-muted-foreground">
            {format(cursor(), 'EEE, MMM d')}
          </p>
          <Show
            when={selectedDayItems().length > 0}
            fallback={
              <div class="mt-2.5 p-6 rounded-[23.5px] border border-dashed border-border text-center text-xs text-muted-foreground">
                No events on this day.
              </div>
            }
          >
            <div class="mt-2.5 space-y-2.5">
              <For each={selectedDayItems()}>
                {(o) => (
                  <button
                    type="button"
                    onClick={() => props.onOpenEvent(o)}
                    class="w-full text-left rounded-[23.5px] border border-border bg-card/60 px-5 py-4 flex items-center justify-between gap-3"
                  >
                    <div class="min-w-0">
                      <div class="text-xs font-mono text-muted-foreground">
                        {format(o.start, 'HH:mm')} - {format(o.end, 'HH:mm')}
                      </div>
                      <div class="text-base font-semibold truncate mt-0.5">{o.event.title}</div>
                    </div>
                    <span
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: getCalendarColor(o.event.calendarId, calendars()).accent }}
                    />
                  </button>
                )}
              </For>
            </div>
          </Show>
          </div>
          </div>
        </Show>

        {/* 3-DAY VIEW: Rolling 3 columns */}
        <Show when={view() === '3day'}>
          <div class={`mt-5 mb-28 flex-1 min-h-0 rounded-[23.5px] border border-border bg-card/50 overflow-hidden flex flex-col ${viewSlideClass()}`}>
            <div class="grid grid-cols-[44px_repeat(3,1fr)] border-b border-border py-2.5 text-center text-xs font-semibold shrink-0">
              <span />
              <For each={threeDays()}>
                {(d) => (
                  <span class={isToday(d) ? 'text-primary font-bold' : 'text-muted-foreground'}>
                    {format(d, 'EEE d')}
                  </span>
                )}
              </For>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              <div class="grid grid-cols-[44px_repeat(3,1fr)] relative" style={{ height: `${HOUR_PX * 24}px` }}>
                <div class="relative border-r border-border/60 text-[10px] font-mono text-muted-foreground">
                  <For each={Array.from({ length: 24 }, (_, h) => h)}>
                    {(h) => (
                      <span class="absolute right-1.5 -translate-y-1/2" style={{ top: `${h * HOUR_PX}px` }}>
                        {String(h).padStart(2, '0')}
                      </span>
                    )}
                  </For>
                </div>
                <For each={threeDays()}>
                  {(d) => {
                    const dayOccs = createMemo(() =>
                      occurrences().filter((o) => isOccurrenceOnDay(o, d)),
                    );
                    return (
                      <div class="relative border-r border-border/40 last:border-r-0">
                        <For each={dayOccs()}>
                          {(o) => {
                            const sH = isSameDay(o.start, d) ? o.start.getHours() + o.start.getMinutes() / 60 : 0;
                            const eH = isSameDay(o.end, d) ? o.end.getHours() + o.end.getMinutes() / 60 : 24;
                            const top = sH * HOUR_PX;
                            const height = Math.max(28, (eH - sH) * HOUR_PX - 2);
                            const theme = getCalendarColor(o.event.calendarId, calendars());
                            return (
                              <button
                                type="button"
                                onClick={() => props.onOpenEvent(o)}
                                class="absolute inset-x-1 rounded-xl px-2 py-1 text-left overflow-hidden border"
                                style={{
                                  top: `${top}px`,
                                  height: `${height}px`,
                                  background: theme.bgTint,
                                  'border-color': theme.borderTint,
                                  'border-left': `3px solid ${theme.accent}`,
                                }}
                              >
                                <div class="text-[11px] font-semibold truncate text-foreground">
                                  {o.event.title}
                                </div>
                                <div class="text-[10px] font-mono text-muted-foreground">
                                  {format(o.start, 'HH:mm')}
                                </div>
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </Show>
      </div>

      {/* Floating Action Button (+) docked above capsule bar */}
      <button
        type="button"
        onClick={() => props.onCreateEvent(cursor())}
        aria-label="New event"
        class="fixed right-4 bottom-24 z-20 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-2xl grid place-items-center active:scale-95 transition-transform"
      >
        <Plus size={24} />
      </button>

      {/* Calendar Filter Bottom Sheet */}
      <Show when={calSheetOpen()}>
        <div
          class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end mobile-backdrop-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCalSheetOpen(false);
          }}
        >
          <div class="w-full rounded-t-[23.5px] bg-popover border-t border-border p-5 pb-[max(20px,env(safe-area-inset-bottom))] space-y-4 mobile-sheet-up">
            <div class="w-10 h-1 rounded-full bg-border mx-auto" />
            <div class="flex items-center justify-between">
              <span class="text-base font-bold">Calendars</span>
              <Show when={hiddenIds().length > 0}>
                <button
                  type="button"
                  onClick={() => setHiddenIds([])}
                  class="text-xs font-semibold text-primary"
                >
                  Show all
                </button>
              </Show>
            </div>
            <div class="max-h-72 overflow-y-auto space-y-1.5">
              <For each={calendars()}>
                {(c) => {
                  const isOn = () => !hiddenIds().includes(c.id);
                  const theme = () => getCalendarColor(c.id, calendars());
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        setHiddenIds((prev) =>
                          prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                        )
                      }
                      class="w-full px-3 py-3 rounded-2xl flex items-center justify-between gap-3 hover:bg-accent/60"
                    >
                      <span class="flex items-center gap-3 min-w-0">
                        <span
                          class="w-5 h-5 rounded-full grid place-items-center shrink-0"
                          style={{
                            'background-color': isOn() ? theme().accent : 'transparent',
                            border: `2px solid ${theme().accent}`,
                          }}
                        >
                          <Show when={isOn()}>
                            <Check size={12} class="text-white" strokeWidth={3} />
                          </Show>
                        </span>
                        <span class="text-sm font-medium truncate">
                          {c.isPersonal ? 'Personal' : c.name}
                        </span>
                      </span>
                      <span class="text-xs text-muted-foreground">
                        {c.isPersonal ? 'Personal' : 'Group'}
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
