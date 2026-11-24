import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { ChevronDown, Clock } from 'lucide-solid';

function parseTimeParts(value: string): { h: number; m: number } {
  const [hStr, mStr] = (value || '19:00').split(':');
  const h = Number.parseInt(hStr || '19', 10);
  const m = Number.parseInt(mStr || '0', 10);
  return {
    h: Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 19,
    m: Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0,
  };
}

export function CustomTimePicker(props: {
  value: string;
  onChange: (val: string) => void;
  className?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const [hourDraft, setHourDraft] = createSignal('19');
  const [minDraft, setMinDraft] = createSignal('00');
  let rootRef: HTMLDivElement | undefined;
  let minInputRef: HTMLInputElement | undefined;

  const parts = createMemo(() => parseTimeParts(props.value));
  const formatted24 = createMemo(
    () => `${String(parts().h).padStart(2, '0')}:${String(parts().m).padStart(2, '0')}`,
  );

  createEffect(() => {
    const p = parts();
    setHourDraft(String(p.h).padStart(2, '0'));
    setMinDraft(String(p.m).padStart(2, '0'));
  });

  const commitDraft = (hRaw = hourDraft(), mRaw = minDraft()) => {
    const hNum = Number.parseInt(hRaw || '0', 10);
    const mNum = Number.parseInt(mRaw || '0', 10);
    const h = Number.isFinite(hNum) ? Math.min(23, Math.max(0, hNum)) : parts().h;
    const m = Number.isFinite(mNum) ? Math.min(59, Math.max(0, mNum)) : parts().m;
    const hPad = String(h).padStart(2, '0');
    const mPad = String(m).padStart(2, '0');
    setHourDraft(hPad);
    setMinDraft(mPad);
    props.onChange(`${hPad}:${mPad}`);
  };

  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef && !rootRef.contains(e.target as Node)) {
        if (open()) commitDraft();
        setOpen(false);
      }
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
          <span class="truncate font-mono">{formatted24()}</span>
        </span>
        <ChevronDown size={13} class="text-muted-foreground shrink-0 opacity-70" />
      </button>

      <Show when={open()}>
        <div class="absolute left-0 mt-1.5 z-50 w-52 p-4 rounded-2xl border border-border bg-popover/95 backdrop-blur-md shadow-2xl">
          <div class="flex items-center justify-between mb-3">
            <span class="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Set Time (24h)</span>
            <span class="text-[11px] font-semibold font-mono text-primary">{formatted24()}</span>
          </div>

          <div class="flex items-center justify-center gap-3 py-1">
            <div class="flex flex-col items-center">
              <label class="text-[10px] font-bold text-muted-foreground uppercase mb-1.5">Hour</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                aria-label="Hour (00 to 23)"
                value={hourDraft()}
                onFocus={(e) => e.currentTarget.select()}
                onInput={(e) => {
                  const digits = e.currentTarget.value.replace(/\D/g, '').slice(0, 2);
                  setHourDraft(digits);
                  if (digits.length === 2) {
                    commitDraft(digits, minDraft());
                    minInputRef?.focus();
                    minInputRef?.select();
                  }
                }}
                onBlur={() => commitDraft()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitDraft();
                    setOpen(false);
                  }
                }}
                class="w-14 h-11 text-center text-xl font-bold font-mono text-foreground bg-muted/40 rounded-lg border border-border outline-none focus:border-primary"
              />
            </div>

            <span class="text-xl font-bold text-muted-foreground pt-5 select-none">:</span>

            <div class="flex flex-col items-center">
              <label class="text-[10px] font-bold text-muted-foreground uppercase mb-1.5">Min</label>
              <input
                ref={minInputRef}
                type="text"
                inputMode="numeric"
                maxLength={2}
                aria-label="Minute (00 to 59)"
                value={minDraft()}
                onFocus={(e) => e.currentTarget.select()}
                onInput={(e) => {
                  const digits = e.currentTarget.value.replace(/\D/g, '').slice(0, 2);
                  setMinDraft(digits);
                  if (digits.length === 2) {
                    commitDraft(hourDraft(), digits);
                  }
                }}
                onBlur={() => commitDraft()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitDraft();
                    setOpen(false);
                  }
                }}
                class="w-14 h-11 text-center text-xl font-bold font-mono text-foreground bg-muted/40 rounded-lg border border-border outline-none focus:border-primary"
              />
            </div>
          </div>

          <div class="mt-3 pt-2 border-t border-border/60 flex justify-end">
            <button
              type="button"
              onClick={() => {
                commitDraft();
                setOpen(false);
              }}
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
