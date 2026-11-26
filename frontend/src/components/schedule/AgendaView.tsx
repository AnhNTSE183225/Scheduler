import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { addDays, format, isSameDay, isToday, startOfDay } from 'date-fns';
import { CalendarDays, Link2, MapPin, Repeat2 } from 'lucide-solid';
import { getCategoryMeta } from '@/components/pickers/CategoryMeta';
import { AvatarBadge } from './AvatarBadge';
import { getCalendarColor, getCalendarLabel } from '@/lib/calendarColors';
import { getResponse, isInvited } from '@/lib/recurrence';
import type { CalendarSpace, Occurrence, ScheduleEventLocation, ServerMember } from '@/models/schedule';

function LocationLabel(props: { location: ScheduleEventLocation | null }) {
  return (
    <Show when={props.location}>
      {(loc) => (
        <Show
          when={loc().kind === 'address'}
          fallback={
            <span class="inline-flex items-center gap-1 min-w-0">
              <Link2 size={12} class="shrink-0 text-primary" />
              <span class="truncate">{(loc().url || '').replace(/^https?:\/\//, '')}</span>
            </span>
          }
        >
          <span class="inline-flex items-center gap-1 min-w-0">
            <MapPin size={12} class="shrink-0 text-primary" />
            <span class="truncate">{loc().address}</span>
          </span>
        </Show>
      )}
    </Show>
  );
}

export function AgendaView(props: {
  occurrences: Occurrence[];
  userId: string;
  calendars: CalendarSpace[];
  membersByCalendar: Record<string, ServerMember[]>;
  onOpen: (o: Occurrence) => void;
}) {
  let listRef: HTMLDivElement | undefined;
  let didAutoScroll = false;
  const [now, setNow] = createSignal(new Date());

  onMount(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setNow(new Date());
    }, 60_000);
    const onVisibility = () => {
      if (!document.hidden) setNow(new Date());
    };
    document.addEventListener('visibilitychange', onVisibility);
    onCleanup(() => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  });

  const groups = createMemo(() => {
    const groupsMap = new Map<string, { day: Date; items: Occurrence[] }>();
    for (const o of props.occurrences) {
      let cur = startOfDay(o.start);
      while (cur < o.end) {
        const dateKey = format(cur, 'yyyy-MM-dd');
        let g = groupsMap.get(dateKey);
        if (!g) {
          g = { day: cur, items: [] };
          groupsMap.set(dateKey, g);
        }
        g.items.push(o);
        cur = addDays(cur, 1);
        if (cur >= o.end && !isSameDay(cur, o.end)) break;
      }
    }
    return Array.from(groupsMap.values()).sort((a, b) => a.day.getTime() - b.day.getTime());
  });

  const nextUpcomingTarget = createMemo(() => {
    const nowMs = now().getTime();
    let sawPast = false;
    for (const g of groups()) {
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
    const target = nextUpcomingTarget();
    if (!target || didAutoScroll) return;
    didAutoScroll = true;
    requestAnimationFrame(() => {
      const el = listRef?.querySelector('[data-next-upcoming="true"]');
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });

  return (
    <Show
      when={groups().length > 0}
      fallback={
        <div class="schedule-empty">
          <CalendarDays size={28} class="opacity-60" />
          <span>No events in the next 60 days. Click "+ New event" to create one!</span>
        </div>
      }
    >
      <div class="agenda-list" ref={listRef}>
        <For each={groups()}>
          {(g) => (
            <div class="agenda-day">
              <div class="agenda-date">
                <strong>{format(g.day, 'd')}</strong>
                <span>{isToday(g.day) ? 'Today' : format(g.day, 'EEE, MMM')}</span>
              </div>
              <div class="flex-1 flex flex-col gap-2 min-w-0">
                <For each={g.items}>
                  {(o) => {
                    const status = () => getResponse(o.event, o.key, props.userId);
                    const calMembers = () => props.membersByCalendar[o.event.calendarId] || [];
                    const organizer = () => calMembers().find((m) => m.id === o.event.organizerId);
                    const calTheme = () => getCalendarColor(o.event.calendarId, props.calendars);
                    const calLabel = () => getCalendarLabel(o.event.calendarId, props.calendars);
                    const isStartDay = () => isSameDay(o.start, g.day);
                    const isEndDay = () => isSameDay(o.end, g.day);
                    const CatIcon = getCategoryMeta(o.event.category, o.event.title, o.event.description).icon;
                    const invited = () => isInvited(o.event, props.userId, calMembers());
                    const isPast = () => o.end.getTime() <= now().getTime();
                    const isNextUpcoming = () =>
                      nextUpcomingTarget() === `${format(g.day, 'yyyy-MM-dd')}::${o.key}`;

                    return (
                      <button
                        type="button"
                        data-next-upcoming={isNextUpcoming() ? 'true' : undefined}
                        class={`agenda-item ${isPast() ? 'opacity-50 hover:opacity-80' : ''}`}
                        style={{ 'border-left': `3px solid ${calTheme().accent}` }}
                        onClick={() => props.onOpen(o)}
                      >
                        <span class="agenda-time font-mono">
                          <span>{isStartDay() ? format(o.start, 'HH:mm') : '00:00'}</span>
                          <br />
                          <span class="text-[11px] font-medium text-muted-foreground">
                            {isEndDay() ? format(o.end, 'HH:mm') : '24:00'}
                          </span>
                        </span>

                        <span class="flex-1 min-w-0 flex flex-col gap-1">
                          <span class="flex items-center gap-1.5 text-sm font-semibold truncate">
                            <CatIcon size={14} class="text-primary/85 shrink-0" />
                            <span class="truncate">{o.event.title}</span>
                            <Show when={!isStartDay()}>
                              <span class="text-[10px] font-normal px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                                cont.
                              </span>
                            </Show>
                            <Show when={o.event.recurrence}>
                              <Repeat2 size={13} class="text-muted-foreground shrink-0" />
                            </Show>
                          </span>

                          <span class="flex items-center gap-3 text-xs text-muted-foreground min-w-0 flex-wrap">
                            <span
                              class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0"
                              style={{
                                background: calTheme().bgTint,
                                border: `1px solid ${calTheme().borderTint}`,
                                color: calTheme().accent,
                              }}
                            >
                              <span
                                class="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ background: calTheme().accent }}
                              />
                              <span class="truncate max-w-[120px]">{calLabel()}</span>
                            </span>
                            <LocationLabel location={o.event.location} />
                            <Show when={organizer() || o.event.organizerName}>
                              <span class="shrink-0 flex items-center gap-1.5">
                                <AvatarBadge
                                  name={organizer()?.name || o.event.organizerName || 'Organizer'}
                                  avatar={organizer()?.avatar || o.event.organizerAvatar}
                                  size={16}
                                />
                                <span>by {organizer()?.name || o.event.organizerName}</span>
                              </span>
                            </Show>
                          </span>
                        </span>

                        <Show
                          when={!isPast()}
                          fallback={<span class="rsvp-pill opacity-80">Ended</span>}
                        >
                          <span class={`rsvp-pill ${status() ? `is-${status()}` : 'is-pending'}`}>
                            {invited()
                              ? status()
                                ? status()![0].toUpperCase() + status()!.slice(1)
                                : 'Respond'
                              : 'Open'}
                          </span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
