import { For, Show, createMemo } from 'solid-js';
import { addDays, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns';
import { getCategoryMeta } from '@/components/pickers/CategoryMeta';
import { WEEKDAY_SHORT, getResponse, isOccurrenceOnDay } from '@/lib/recurrence';
import type { Occurrence } from '@/models/schedule';

export function MonthGrid(props: {
  cursor: Date;
  occurrences: Occurrence[];
  userId: string;
  onOpen: (o: Occurrence) => void;
  onDay: (d: Date) => void;
}) {
  const days = createMemo(() => {
    const start = startOfWeek(startOfMonth(props.cursor));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  });

  return (
    <div class="month-grid">
      <For each={WEEKDAY_SHORT}>{(d) => <div class="month-head">{d}</div>}</For>
      <For each={days()}>
        {(d) => {
          const list = createMemo(() => props.occurrences.filter((o) => isOccurrenceOnDay(o, d)));
          return (
            <div
              class={`month-cell ${isSameMonth(d, props.cursor) ? '' : 'is-outside'}`}
              onClick={() => props.onDay(d)}
              title="Click to create event on this date"
            >
              <span class={`month-day ${isToday(d) ? 'is-today' : ''}`}>{format(d, 'd')}</span>
              <div class="flex flex-col gap-1 min-w-0">
                <For each={list().slice(0, 3)}>
                  {(o) => {
                    const CatIcon = getCategoryMeta(o.event.category, o.event.title, o.event.description).icon;
                    const isStartDay = () => isSameDay(o.start, d);
                    const isEndDay = () => isSameDay(o.end, d);
                    const timeText = () =>
                      isStartDay()
                        ? format(o.start, 'HH:mm')
                        : isEndDay()
                        ? `ends ${format(o.end, 'HH:mm')}`
                        : 'all day';
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
                        class={`month-chip ${!isStartDay() ? 'opacity-90' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onOpen(o);
                        }}
                        title={`${o.event.title} (${format(o.start, 'MMM d, HH:mm')} – ${format(o.end, 'MMM d, HH:mm')})`}
                      >
                        <span class={`rsvp-dot ${dotCls()}`} aria-hidden="true" />
                        <CatIcon size={11} class="shrink-0 text-primary/80" />
                        <span class="shrink-0 text-muted-foreground font-mono text-[10px] hidden sm:inline">{timeText()}</span>
                        <span class="truncate">{o.event.title}</span>
                      </button>
                    );
                  }}
                </For>
                <Show when={list().length > 3}>
                  <span class="month-more">+{list().length - 3} more</span>
                </Show>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}
