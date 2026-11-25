import { For, Show, createMemo, onMount } from 'solid-js';
import { addDays, format, isSameDay, isToday, startOfWeek } from 'date-fns';
import { getCategoryMeta } from '@/components/pickers/CategoryMeta';
import { AvatarBadge } from './AvatarBadge';
import { getCalendarColor } from '@/lib/calendarColors';
import { getResponse, isOccurrenceOnDay } from '@/lib/recurrence';
import type { CalendarSpace, Occurrence, ServerMember } from '@/models/schedule';

const HOUR_PX = 44;

interface DaySlice {
  occurrence: Occurrence;
  sliceStartHour: number;
  sliceEndHour: number;
}

export function WeekGrid(props: {
  cursor: Date;
  occurrences: Occurrence[];
  userId: string;
  calendars: CalendarSpace[];
  membersByCalendar: Record<string, ServerMember[]>;
  onOpen: (o: Occurrence) => void;
}) {
  let scrollRef: HTMLDivElement | undefined;
  const days = createMemo(() => {
    const start = startOfWeek(props.cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  });

  onMount(() => {
    if (scrollRef) {
      scrollRef.scrollTop = HOUR_PX * 8;
    }
  });

  return (
    <div class="week-wrap">
      <div class="week-scroll" ref={scrollRef}>
        <div class="week-head sticky top-0 z-10 backdrop-blur-md">
          <span />
          <For each={days()}>
            {(d) => (
              <span class={isToday(d) ? 'is-today' : ''}>
                {format(d, 'EEE d')}
              </span>
            )}
          </For>
        </div>

        <div class="week-grid" style={{ height: `${HOUR_PX * 24}px` }}>
          <div class="week-hours">
            <For each={Array.from({ length: 24 }, (_, h) => h)}>
              {(h) => (
                <span style={{ top: `${h * HOUR_PX}px` }}>
                  {String(h).padStart(2, '0')}:00
                </span>
              )}
            </For>
          </div>

          <For each={days()}>
            {(d) => {
              const lanes = createMemo(() => {
                const list = props.occurrences.filter((o) => isOccurrenceOnDay(o, d));
                const slices: DaySlice[] = list
                  .map((o) => {
                    const isStartDay = isSameDay(o.start, d);
                    const isEndDay = isSameDay(o.end, d);
                    const sliceStartHour = isStartDay ? o.start.getHours() + o.start.getMinutes() / 60 : 0;
                    const sliceEndHour = isEndDay ? o.end.getHours() + o.end.getMinutes() / 60 : 24;
                    return { occurrence: o, sliceStartHour, sliceEndHour };
                  })
                  .sort(
                    (a, b) =>
                      a.sliceStartHour - b.sliceStartHour ||
                      b.sliceEndHour - b.sliceStartHour - (a.sliceEndHour - a.sliceStartHour),
                  );

                const out: DaySlice[][] = [];
                for (const s of slices) {
                  const lane = out.find((l) => l[l.length - 1].sliceEndHour <= s.sliceStartHour);
                  if (lane) lane.push(s);
                  else out.push([s]);
                }
                return out;
              });

              return (
                <div class="week-col">
                  <For each={lanes()}>
                    {(lane, li) => (
                      <For each={lane}>
                        {(s) => {
                          const o = s.occurrence;
                          const top = s.sliceStartHour * HOUR_PX;
                          const durationHours = Math.max(0.35, s.sliceEndHour - s.sliceStartHour);
                          const height = Math.max(24, durationHours * HOUR_PX - 2);
                          const CatIcon = getCategoryMeta(o.event.category, o.event.title, o.event.description).icon;
                          const calMembers = () => props.membersByCalendar[o.event.calendarId] || [];
                          const organizer = () => calMembers().find((m) => m.id === o.event.organizerId);
                          const calTheme = () => getCalendarColor(o.event.calendarId, props.calendars);
                          const isStartDay = isSameDay(o.start, d);
                          const isEndDay = isSameDay(o.end, d);
                          const timeDisplay =
                            isStartDay && isEndDay
                              ? `${format(o.start, 'HH:mm')}–${format(o.end, 'HH:mm')}`
                              : isStartDay
                              ? `${format(o.start, 'HH:mm')} → 24:00`
                              : isEndDay
                              ? `00:00–${format(o.end, 'HH:mm')}`
                              : 'All day';
                          const st = () => getResponse(o.event, o.key, props.userId);
                          const dotCls = () =>
                            st() === 'accepted'
                              ? 'is-accepted'
                              : st() === 'declined'
                              ? 'is-declined'
                              : st() === 'tentative'
                              ? 'is-tentative'
                              : 'is-pending';

                          return (
                            <button
                              type="button"
                              class={`week-event ${!isStartDay ? 'opacity-90' : ''}`}
                              onClick={() => props.onOpen(o)}
                              style={{
                                top: `${top}px`,
                                height: `${height}px`,
                                left: `${(li() / lanes().length) * 100}%`,
                                width: `${100 / lanes().length}%`,
                                'border-left': `3px solid ${calTheme().accent}`,
                                background: calTheme().bgTint,
                              }}
                              title={`${o.event.title} (${format(o.start, 'MMM d, HH:mm')} – ${format(o.end, 'MMM d, HH:mm')})`}
                            >
                              <span class="flex items-center gap-1 font-semibold truncate">
                                <span class={`rsvp-dot ${dotCls()}`} aria-hidden="true" />
                                <CatIcon size={12} class="shrink-0 text-primary/80" />
                                <span class="truncate">{o.event.title}</span>
                              </span>
                              <div class="flex items-center justify-between gap-1 text-[11px] min-w-0">
                                <span class="font-mono font-semibold text-foreground/90 shrink-0">{timeDisplay}</span>
                                <Show when={organizer()}>
                                  {(org) => (
                                    <span class="flex items-center gap-1 min-w-0 shrink truncate">
                                      <AvatarBadge name={org().name} avatar={org().avatar} size={12} />
                                      <span class="truncate">{org().name}</span>
                                    </span>
                                  )}
                                </Show>
                              </div>
                            </button>
                          );
                        }}
                      </For>
                    )}
                  </For>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
