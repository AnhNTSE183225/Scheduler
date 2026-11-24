import { Show, onCleanup, onMount, type JSX } from 'solid-js';

export function Dialog(props: {
  open: boolean;
  onClose: () => void;
  maxWidthClass?: string;
  children: JSX.Element;
}) {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && props.open) {
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/65 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          class={`w-full ${props.maxWidthClass || 'max-w-xl'} max-h-[90dvh] rounded-2xl border border-border bg-popover/95 shadow-2xl overflow-hidden flex flex-col`}
        >
          {props.children}
        </div>
      </div>
    </Show>
  );
}
