import { Show, createSignal } from 'solid-js';

export function AvatarBadge(props: {
  name: string;
  avatar?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = createSignal(false);
  const px = () => props.size ?? 20;
  const initial = () => (props.name || '?').trim()[0]?.toUpperCase() || '?';

  return (
    <Show
      when={props.avatar && !failed()}
      fallback={
        <span
          class="rounded-full bg-primary/20 text-primary font-bold inline-flex items-center justify-center shrink-0 text-[10px] uppercase border border-primary/30"
          style={{ width: `${px()}px`, height: `${px()}px` }}
        >
          {initial()}
        </span>
      }
    >
      <img
        src={props.avatar!}
        alt={props.name}
        onError={() => setFailed(true)}
        class="rounded-full object-cover shrink-0 border border-white/10 inline-block"
        style={{ width: `${px()}px`, height: `${px()}px` }}
      />
    </Show>
  );
}
