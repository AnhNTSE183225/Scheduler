import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { Check, ChevronDown } from 'lucide-solid';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  icon?: JSX.Element;
  badge?: string;
}

export function CustomSelect<T extends string>(props: {
  value: T;
  onChange: (val: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  const selected = createMemo(() => props.options.find((o) => o.value === props.value));

  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef && !rootRef.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    });
  });

  return (
    <div ref={rootRef} class={`relative inline-block ${props.className || ''}`}>
      <button
        type="button"
        aria-label={props.ariaLabel || props.placeholder || 'Select'}
        aria-expanded={open()}
        onClick={() => setOpen((o) => !o)}
        class={`w-full flex items-center justify-between gap-2 px-3 py-1.5 h-9 rounded-lg border border-border bg-card/70 hover:bg-accent/50 text-foreground text-xs font-medium transition-all duration-200 outline-none focus-visible:ring-1 focus-visible:ring-primary ${
          props.triggerClassName || ''
        }`}
      >
        <span class="flex items-center gap-2 truncate">
          <Show when={selected()?.icon}>
            <span class="shrink-0 text-muted-foreground">{selected()?.icon}</span>
          </Show>
          <span class="truncate">{selected()?.label || props.placeholder || 'Select...'}</span>
        </span>
        <ChevronDown size={14} class="text-muted-foreground shrink-0 opacity-70" />
      </button>

      <Show when={open()}>
        <div class="absolute left-0 mt-1.5 z-50 min-w-[190px] w-full max-h-64 overflow-y-auto p-1.5 rounded-xl border border-border bg-popover/95 backdrop-blur-md shadow-2xl">
          <For each={props.options}>
            {(opt) => {
              const isSelected = () => opt.value === props.value;
              return (
                <button
                  type="button"
                  onClick={() => {
                    props.onChange(opt.value);
                    setOpen(false);
                  }}
                  class={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors duration-150 text-left ${
                    isSelected()
                      ? 'bg-primary/15 text-primary font-semibold'
                      : 'text-foreground hover:bg-accent'
                  }`}
                >
                  <span class="flex items-center gap-2 truncate">
                    <Show when={opt.icon}>
                      <span class="shrink-0">{opt.icon}</span>
                    </Show>
                    <span class="truncate">{opt.label}</span>
                  </span>
                  <span class="flex items-center gap-1.5 shrink-0">
                    <Show when={opt.badge}>
                      <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {opt.badge}
                      </span>
                    </Show>
                    <Show when={isSelected()}>
                      <Check size={13} class="text-primary" />
                    </Show>
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
