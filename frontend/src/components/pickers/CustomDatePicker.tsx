import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  addDays,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-solid';

export function CustomDatePicker(props: {
  value: string;
  onChange: (val: string) => void;
  className?: string;
}) {
  const parsed = createMemo(() => {
    try {
      const d = parseISO(props.value);
      return isValid(d) ? d : new Date();
    } catch {
      return new Date();
    }
  });

  const [viewDate, setViewDate] = createSignal(parsed());
  const [open, setOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef && !rootRef.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    onCleanup(() => document.removeEventListener('mousedown', onDocClick));
  });

  const days = createMemo(() => {
    const start = startOfWeek(startOfMonth(viewDate()));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  });

  const weekShort = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const handleSelect = (day: Date) => {
    props.onChange(format(day, 'yyyy-MM-dd'));
    setOpen(false);
  };

  return (
    <div ref={rootRef} class={`relative inline-block w-full ${props.className || ''}`}>
      <button
        type="button"
        onClick={() => {
          if (!open()) setViewDate(parsed());
          setOpen((o) => !o);
        }}
        class="w-full h-9 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-card/70 hover:bg-accent/50 text-foreground text-xs font-medium transition-all duration-200 outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        <span class="flex items-center gap-2 truncate">
          <CalendarIcon size={14} class="text-primary shrink-0" />
          <span class="truncate">{format(parsed(), 'EEE, MMM d, yyyy')}</span>
        </span>
        <ChevronDown size={13} class="text-muted-foreground shrink-0 opacity-70" />
      </button>

      <Show when={open()}>
        <div class="absolute left-0 mt-1.5 z-50 w-72 max-w-[calc(100vw-3rem)] p-3 rounded-2xl border border-border bg-popover/95 backdrop-blur-md shadow-2xl">
          <div class="flex items-center justify-between gap-1 mb-2">
            <span class="font-semibold text-xs text-foreground pl-1">
              {format(viewDate(), 'MMMM yyyy')}
            </span>
            <div class="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewDate((d) => subMonths(d, 1));
                }}
                class="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-accent"
                title="Previous month"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewDate((d) => addMonths(d, 1));
                }}
                class="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-accent"
                title="Next month"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div class="grid grid-cols-7 gap-1 text-center mb-1">
            <For each={weekShort}>
              {(w) => <span class="text-[10px] font-semibold text-muted-foreground py-0.5">{w}</span>}
            </For>
          </div>

          <div class="grid grid-cols-7 gap-1 text-center">
            <For each={days()}>
              {(d) => {
                const inMonth = () => isSameMonth(d, viewDate());
                const selected = () => isSameDay(d, parsed());
                const today = () => isToday(d);
                return (
                  <button
                    type="button"
                    onClick={() => handleSelect(d)}
                    class={`h-7 w-7 mx-auto rounded-md text-xs font-medium flex items-center justify-center transition-all duration-150 ${
                      selected()
                        ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                        : inMonth()
                        ? 'text-foreground hover:bg-accent'
                        : 'text-muted-foreground/35 hover:bg-accent/40'
                    } ${today() && !selected() ? 'ring-1 ring-primary/60 font-semibold' : ''}`}
                  >
                    {format(d, 'd')}
                  </button>
                );
              }}
            </For>
          </div>

          <div class="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px]">
            <button type="button" onClick={() => handleSelect(new Date())} class="text-primary hover:underline font-medium">
              Today
            </button>
            <button
              type="button"
              onClick={() => handleSelect(addDays(new Date(), 1))}
              class="text-muted-foreground hover:text-foreground hover:underline"
            >
              Tomorrow
            </button>
            <button
              type="button"
              onClick={() => handleSelect(addDays(new Date(), 7))}
              class="text-muted-foreground hover:text-foreground hover:underline"
            >
              +1 Week
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
