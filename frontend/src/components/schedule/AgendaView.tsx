import { For, Show, createMemo } from 'solid-js';
import { addDays, format, isSameDay, isToday, startOfDay } from 'date-fns';
import { CalendarDays, Link2, MapPin, Repeat2 } from 'lucide-solid';
import { getCategoryMeta } from '@/components/pickers/CategoryMeta';
import { AvatarBadge } from './AvatarBadge';
import { getResponse, isInvited } from '@/lib/recurrence';
import type { Occurrence, ScheduleEventLocation, ServerMember } from '@/models/schedule';

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
  members: ServerMember[];
  onOpen: (o: Occurrence) => void;
}) {
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
      <div class="agenda-list">
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
                    const organizer = () => props.members.find((m) => m.id === o.event.organizerId);
                    const isStartDay = () => isSameDay(o.start, g.day);
                    const isEndDay = () => isSameDay(o.end, g.day);
                    const CatIcon = getCategoryMeta(o.event.category, o.event.title, o.event.description).icon;
                    const invited = () => isInvited(o.event, props.userId, props.members);

                    return (
                      <button type="button" class="agenda-item" onClick={() => props.onOpen(o)}>
                        <span class="agenda-time font-mono">
                          {isStartDay() ? format(o.start, 'HH:mm') : '00:00'}
                          <br />
                          <span class="text-muted-foreground">{isEndDay() ? format(o.end, 'HH:mm') : '24:00'}</span>
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

                        <span class={`rsvp-pill ${status() ? `is-${status()}` : 'is-pending'}`}>
                          {invited()
                            ? status()
                              ? status()![0].toUpperCase() + status()!.slice(1)
                              : 'Respond'
                            : 'Open'}
                        </span>
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
