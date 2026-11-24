import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { ChevronDown, Clock, Minus, Plus } from 'lucide-solid';

const DURATION_PRESETS = [
  { label: '30m', value: 30 },
  { label: '45m', value: 45 },
  { label: '1h', value: 60 },
  { label: '1.5h', value: 90 },
  { label: '2h', value: 120 },
  { label: '3h', value: 180 },
];

export function formatDurationText(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h} hr${h > 1 ? 's' : ''}`;
  return `${m} mins`;
}

export function CustomDurationPicker(props: {
  value: number;
  onChange: (val: number) => void;
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

  return (
    <div ref={rootRef} class={`relative inline-block w-full ${props.className || ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        class="w-full h-9 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-card/70 hover:bg-accent/50 text-foreground text-xs font-medium transition-all duration-200 outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        <span class="flex items-center gap-2 truncate">
          <Clock size={14} class="text-primary shrink-0" />
          <span class="truncate">{formatDurationText(props.value)}</span>
        </span>
        <ChevronDown size={13} class="text-muted-foreground shrink-0 opacity-70" />
      </button>

      <Show when={open()}>
        <div class="absolute left-0 mt-1.5 z-50 w-56 p-3 rounded-2xl border border-border bg-popover/95 backdrop-blur-md shadow-2xl">
          <div class="flex items-center justify-between gap-2 mb-3">
            <span class="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">Length</span>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => props.onChange(Math.max(15, props.value - 15))}
                class="h-7 w-7 rounded-md bg-muted/60 hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground"
                title="-15m"
              >
                <Minus size={12} />
              </button>
              <span class="text-xs font-bold text-foreground px-2 py-0.5 bg-card rounded-md border border-border">
                {formatDurationText(props.value)}
              </span>
              <button
                type="button"
                onClick={() => props.onChange(Math.min(720, props.value + 15))}
                class="h-7 w-7 rounded-md bg-muted/60 hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground"
                title="+15m"
              >
                <Plus size={12} />
              </button>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-1.5">
            <For each={DURATION_PRESETS}>
              {(p) => (
                <button
                  type="button"
                  onClick={() => {
                    props.onChange(p.value);
                    setOpen(false);
                  }}
                  class={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    props.value === p.value
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'bg-muted/40 hover:bg-accent text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
