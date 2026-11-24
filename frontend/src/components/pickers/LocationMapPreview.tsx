import { Show, createMemo } from 'solid-js';
import { ExternalLink, MapPin } from 'lucide-solid';
import { googleMapsEmbedUrl, isGoogleMapsShortlink } from '@/lib/recurrence';

export function LocationMapPreview(props: { address: string; className?: string }) {
  const trimmed = createMemo(() => (props.address || '').trim());
  const isLink = createMemo(() => isGoogleMapsShortlink(trimmed()));

  return (
    <Show when={trimmed()}>
      <Show
        when={!isLink()}
        fallback={
          <div class={`p-4 rounded-xl border border-primary/25 bg-card/70 flex flex-col gap-3 shadow-md ${props.className || ''}`}>
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="flex items-center gap-2 min-w-0">
                <span class="h-8 w-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center shrink-0">
                  <MapPin size={16} />
                </span>
                <div class="min-w-0">
                  <div class="text-xs font-semibold text-foreground">Google Maps Location</div>
                  <div class="text-[11px] text-muted-foreground truncate max-w-xs">{trimmed()}</div>
                </div>
              </div>
              <a
                href={trimmed()}
                target="_blank"
                rel="noreferrer"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 shrink-0"
              >
                Open in Google Maps
                <ExternalLink size={12} />
              </a>
            </div>
          </div>
        }
      >
        <div class={`flex flex-col gap-2 ${props.className || ''}`}>
          <div class="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span class="flex items-center gap-1.5 truncate min-w-0">
              <MapPin size={13} class="text-primary shrink-0" />
              <span class="truncate">{trimmed()}</span>
            </span>
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(trimmed())}`}
              target="_blank"
              rel="noreferrer"
              class="text-primary hover:underline inline-flex items-center gap-1 text-[11px] shrink-0 font-medium ml-2"
            >
              View Full Map <ExternalLink size={11} />
            </a>
          </div>
          <iframe
            title="Event location map"
            src={googleMapsEmbedUrl(trimmed())}
            class="w-full h-44 rounded-xl border border-border bg-card"
            loading="lazy"
          />
        </div>
      </Show>
    </Show>
  );
}
