import { For, Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

export interface SegmentOption<T extends string = string> {
  value: T;
  label: JSX.Element | string;
  icon?: JSX.Element;
}

export function SlidingSegmentedControl<T extends string>(props: {
  value: T;
  onChange: (val: T) => void;
  options: SegmentOption<T>[];
  className?: string;
  indicatorClassName?: string;
  buttonClassName?: string;
  ariaLabel?: string;
}) {
  let containerRef: HTMLDivElement | undefined;
  const [indicator, setIndicator] = createSignal({ left: 0, width: 0, ready: false });

  const update = () => {
    if (!containerRef) return;
    const active = containerRef.querySelector<HTMLButtonElement>(`button[data-value="${props.value}"]`);
    if (active) {
      setIndicator({
        left: active.offsetLeft,
        width: active.offsetWidth,
        ready: true,
      });
    }
  };

  createEffect(() => {
    void props.value;
    void props.options.length;
    requestAnimationFrame(update);
  });

  onMount(() => {
    update();
    window.addEventListener('resize', update);
    onCleanup(() => window.removeEventListener('resize', update));
  });

  return (
    <div
      ref={containerRef}
      class={`schedule-seg ${props.className || ''}`}
      role="tablist"
      aria-label={props.ariaLabel}
    >
      <div
        class={`schedule-seg-indicator ${props.indicatorClassName || ''}`}
        style={{
          transform: `translateX(${indicator().left}px)`,
          width: `${indicator().width}px`,
          opacity: indicator().ready ? 1 : 0,
        }}
      />
      <For each={props.options}>
        {(opt) => (
          <button
            type="button"
            role="tab"
            data-value={opt.value}
            aria-selected={props.value === opt.value}
            class={`relative z-10 flex items-center justify-center gap-1.5 ${props.buttonClassName || ''} ${
              props.value === opt.value ? 'is-active' : ''
            }`}
            onClick={() => props.onChange(opt.value)}
          >
            <Show when={opt.icon}>{opt.icon}</Show>
            <span>{opt.label}</span>
          </button>
        )}
      </For>
    </div>
  );
}
