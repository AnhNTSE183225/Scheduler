import { Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { ChevronDown, ChevronUp, Clock } from 'lucide-solid';

export function CustomTimePicker(props: {
  value: string;
  onChange: (val: string) => void;
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

  const parts = createMemo(() => {
    const [hStr, mStr] = (props.value || '19:00').split(':');
    return {
      h: parseInt(hStr || '19', 10),
      m: parseInt(mStr || '0', 10),
    };
  });

  const friendlyLabel = createMemo(() => {
    const { h, m } = parts();
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (${h12}:${String(m).padStart(2, '0')} ${period})`;
  });

  const setHour = (h: number) => {
    props.onChange(`${String(h).padStart(2, '0')}:${String(parts().m).padStart(2, '0')}`);
  };

  const setMin = (m: number) => {
    props.onChange(`${String(parts().h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };

  return (
    <div ref={rootRef} class={`relative inline-block w-full ${props.className || ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        class="w-full h-9 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-card/70 hover:bg-accent/50 text-foreground text-xs font-medium transition-all duration-200 outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        <span class="flex items-center gap-2 truncate">
          <Clock size={14} class="text-primary shrink-0" />
          <span class="truncate">{friendlyLabel()}</span>
        </span>
        <ChevronDown size={13} class="text-muted-foreground shrink-0 opacity-70" />
      </button>

      <Show when={open()}>
        <div class="absolute left-0 mt-1.5 z-50 w-52 p-4 rounded-2xl border border-border bg-popover/95 backdrop-blur-md shadow-2xl">
          <div class="flex items-center justify-between mb-3">
            <span class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Set Time</span>
            <span class="text-[11px] font-semibold text-primary">
              {parts().h % 12 || 12}:{String(parts().m).padStart(2, '0')} {parts().h >= 12 ? 'PM' : 'AM'}
            </span>
          </div>

          <div class="flex items-center justify-center gap-4 py-1">
            <div class="flex flex-col items-center">
              <span class="text-[10px] font-bold text-muted-foreground uppercase mb-1">Hour</span>
              <button
                type="button"
                onClick={() => setHour((parts().h + 1) % 24)}
                class="h-8 w-12 rounded-lg bg-card/70 hover:bg-accent border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <ChevronUp size={16} />
              </button>
              <div
                onWheel={(e) => {
                  e.preventDefault();
                  setHour(e.deltaY < 0 ? (parts().h + 1) % 24 : (parts().h + 23) % 24);
                }}
                class="my-1.5 w-12 h-11 flex items-center justify-center text-xl font-bold font-mono text-foreground bg-muted/40 rounded-lg border border-border select-none"
              >
                {String(parts().h).padStart(2, '0')}
              </div>
              <button
                type="button"
                onClick={() => setHour((parts().h + 23) % 24)}
                class="h-8 w-12 rounded-lg bg-card/70 hover:bg-accent border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <ChevronDown size={16} />
              </button>
            </div>

            <span class="text-xl font-bold text-muted-foreground pt-4 select-none">:</span>

            <div class="flex flex-col items-center">
              <span class="text-[10px] font-bold text-muted-foreground uppercase mb-1">Min</span>
              <button
                type="button"
                onClick={() => setMin((parts().m + 5) % 60)}
                class="h-8 w-12 rounded-lg bg-card/70 hover:bg-accent border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <ChevronUp size={16} />
              </button>
              <div
                onWheel={(e) => {
                  e.preventDefault();
                  setMin(e.deltaY < 0 ? (parts().m + 5) % 60 : (parts().m + 55) % 60);
                }}
                class="my-1.5 w-12 h-11 flex items-center justify-center text-xl font-bold font-mono text-foreground bg-muted/40 rounded-lg border border-border select-none"
              >
                {String(parts().m).padStart(2, '0')}
              </div>
              <button
                type="button"
                onClick={() => setMin((parts().m + 55) % 60)}
                class="h-8 w-12 rounded-lg bg-card/70 hover:bg-accent border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <ChevronDown size={16} />
              </button>
            </div>
          </div>

          <div class="mt-3 pt-2 border-t border-border/60 flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              class="px-3 py-1 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
