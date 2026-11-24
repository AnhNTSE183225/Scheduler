import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { CalendarDays, Check, ChevronDown } from 'lucide-solid';
import { getCalendarColor } from '@/lib/calendarColors';
import type { CalendarSpace } from '@/models/schedule';

export function CalendarFilterDropdown(props: {
  calendars: CalendarSpace[];
  hiddenIds: string[];
  onToggle: (calendarId: string) => void;
  onShowAll: () => void;
  className?: string;
}) {
  const [open, setOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef && !rootRef.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    onCleanup(() => document.removeEventListener('mousedown', onDocClick));
  });

  const totalCount = () => props.calendars.length;
  const visibleCount = () =>
    props.calendars.filter((c) => !props.hiddenIds.includes(c.id)).length;

  return (
    <div ref={rootRef} class={`relative inline-block ${props.className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open()}
        class="h-9 w-full px-3 rounded-lg border border-border bg-card/70 hover:bg-accent text-xs font-medium inline-flex items-center justify-between gap-2 transition-colors"
      >
        <span class="inline-flex items-center gap-2 min-w-0">
          <CalendarDays size={13} class="text-primary shrink-0" />
          <span class="truncate">
            Calendars
            <Show when={totalCount() > 1}>
              <span class="text-muted-foreground ml-1">
                ({visibleCount()}/{totalCount()})
              </span>
            </Show>
          </span>
        </span>
        <ChevronDown
          size={13}
          class={`text-muted-foreground shrink-0 transition-transform duration-200 ${open() ? 'rotate-180' : ''}`}
        />
      </button>

      <Show when={open()}>
        <div
          role="menu"
          class="absolute left-0 mt-1.5 z-50 w-64 rounded-xl border border-border bg-popover/95 backdrop-blur-xl shadow-2xl overflow-hidden"
        >
          <div class="px-3 py-2 border-b border-border/70 flex items-center justify-between">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Calendars
            </span>
            <Show when={visibleCount() < totalCount()}>
              <button
                type="button"
                onClick={props.onShowAll}
                class="text-[11px] font-medium text-primary hover:underline"
              >
                Show all
              </button>
            </Show>
          </div>

          <div class="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
            <For each={props.calendars}>
              {(c) => {
                const isOn = () => !props.hiddenIds.includes(c.id);
                const theme = () => getCalendarColor(c.id, props.calendars);
                return (
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={isOn()}
                    onClick={() => props.onToggle(c.id)}
                    class="w-full px-2.5 py-2 rounded-lg text-left text-xs flex items-center justify-between gap-2.5 hover:bg-accent/60 transition-colors"
                  >
                    <span class="flex items-center gap-2.5 min-w-0">
                      <span
                        class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors"
                        style={{
                          'border-color': theme().accent,
                          background: isOn() ? theme().accent : 'transparent',
                        }}
                      >
                        <Show when={isOn()}>
                          <Check size={10} strokeWidth={3} class="text-black" />
                        </Show>
                      </span>
                      <span
                        class={`truncate ${isOn() ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
                      >
                        {c.isPersonal ? 'Personal' : c.name}
                      </span>
                    </span>
                    <span class="text-[10px] text-muted-foreground shrink-0">
                      {c.isPersonal ? 'Personal' : 'Group'}
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
