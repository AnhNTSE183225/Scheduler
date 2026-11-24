import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { addMinutes, format, parseISO } from 'date-fns';
import {
  ArrowLeft,
  Check,
  Clock,
  ExternalLink,
  HelpCircle,
  Link2,
  Loader2,
  Repeat2,
  Users,
  X,
} from 'lucide-solid';
import { fetchPublicEvent, postPublicRespond, type PublicEventPayload } from '@/api/schedule';
import { getCategoryMeta } from '@/components/pickers/CategoryMeta';
import { LocationMapPreview } from '@/components/pickers/LocationMapPreview';
import { AvatarBadge } from '@/components/schedule/AvatarBadge';
import { PwaInstallBanner } from '@/components/schedule/PwaInstallBanner';
import { SlidingSegmentedControl } from '@/components/ui/SlidingSegmentedControl';
import {
  describeRecurrence,
  occurrenceKey,
  safeHttpUrl,
  summarizeResponses,
} from '@/lib/recurrence';
import type { EntityStatus, RsvpScope, RsvpStatus } from '@/models/schedule';
import { authStore } from '@/stores/authStore';

export function PublicEventPage(props: { shareToken: string; onBackHome: () => void }) {
  const [status, setStatus] = createSignal<EntityStatus>('loading');
  const [payload, setPayload] = createSignal<PublicEventPayload | null>(null);
  const [errorMsg, setErrorMsg] = createSignal('');
  const [guestName, setGuestName] = createSignal('');
  const [myResponderId, setMyResponderId] = createSignal('');
  const [scope, setScope] = createSignal<RsvpScope>('occurrence');
  const [tab, setTab] = createSignal<RsvpStatus | 'pending'>('accepted');
  const [rsvpBusy, setRsvpBusy] = createSignal(false);
  const [rsvpFeedback, setRsvpFeedback] = createSignal('');

  const guestStorageKey = () => `pulseplan_guest_${props.shareToken}`;

  onMount(async () => {
    setStatus('loading');
    try {
      const res = await fetchPublicEvent(props.shareToken);
      setPayload(res.data);
      const u = authStore.user();
      if (u) {
        setGuestName(u.displayName);
        setMyResponderId(u.id);
      } else {
        const storedGuestId = localStorage.getItem(guestStorageKey());
        if (storedGuestId) {
          setMyResponderId(storedGuestId);
          const storedName = res.data.event.guestNames?.[storedGuestId];
          if (storedName) setGuestName(storedName);
        }
      }
      setStatus('active');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Event link not found');
      setStatus('error');
    }
  });

  const occStart = createMemo(() => {
    const ev = payload()?.event;
    if (!ev) return new Date();
    return parseISO(ev.start);
  });

  const occEnd = createMemo(() => {
    const ev = payload()?.event;
    if (!ev) return new Date();
    return addMinutes(occStart(), ev.durationMinutes);
  });

  const occKeyStr = createMemo(() => occurrenceKey(occStart()));

  const groups = createMemo(() => {
    const p = payload();
    if (!p) return { accepted: [], tentative: [], declined: [], pending: [] };
    return summarizeResponses(p.event, occKeyStr(), p.members);
  });

  const handleRsvp = async (rsvp: RsvpStatus) => {
    const p = payload();
    if (!p) return;
    const u = authStore.user();
    if (!u && !guestName().trim()) {
      setRsvpFeedback('Please enter your name before RSVPing.');
      return;
    }

    setRsvpBusy(true);
    setRsvpFeedback('');
    try {
      const existingGuestId = !u && myResponderId().startsWith('guest:') ? myResponderId() : undefined;
      const res = await postPublicRespond(
        props.shareToken,
        guestName().trim() || u?.displayName || 'Guest',
        occKeyStr(),
        rsvp,
        p.event.recurrence ? scope() : 'series',
        existingGuestId,
      );
      setPayload({ ...p, event: res.data.event });
      setMyResponderId(res.data.responderId);
      if (!u && res.data.responderId.startsWith('guest:')) {
        localStorage.setItem(guestStorageKey(), res.data.responderId);
      }
      setRsvpFeedback(`Saved your response: ${rsvp}!`);
    } catch (err: unknown) {
      setRsvpFeedback(err instanceof Error ? err.message : 'Failed to save RSVP');
    } finally {
      setRsvpBusy(false);
    }
  };

  return (
    <main class="room-main max-w-2xl">
      <div class="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={props.onBackHome}
          class="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Open Scheduler
        </button>
      </div>

      <PwaInstallBanner publicShareToken={props.shareToken} />

      <Show when={status() === 'loading'}>
        <div class="glass-surface p-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={18} class="animate-spin text-primary" /> Loading invite...
        </div>
      </Show>

      <Show when={status() === 'error'}>
        <div class="glass-surface p-8 text-center space-y-2">
          <h2 class="text-lg font-bold text-destructive">Invite Unavailable</h2>
          <p class="text-xs text-muted-foreground">{errorMsg()}</p>
        </div>
      </Show>

      <Show when={status() === 'active' && payload()}>
        {(p) => {
          const ev = () => p().event;
          const catMeta = () => getCategoryMeta(ev().category, ev().title, ev().description);
          const CatIcon = catMeta().icon;
          const myStatus = () => {
            const rid = myResponderId();
            if (!rid) return null;
            return (
              ev().occurrenceResponses?.[occKeyStr()]?.[rid] ??
              ev().seriesResponses?.[rid] ??
              null
            );
          };

          return (
            <article class="glass-surface overflow-hidden">
              <Show when={safeHttpUrl(ev().imageUrl)}>
                {(imgSrc) => <img src={imgSrc()} alt="" class="w-full h-44 object-cover" />}
              </Show>

              <div class="p-6 space-y-5">
                <div class="space-y-2">
                  <div class="flex items-center gap-2 flex-wrap">
                    <CatIcon size={20} class="text-primary shrink-0" />
                    <h1 class="text-2xl font-bold font-display">{ev().title}</h1>
                    <span class="text-[11px] px-2.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                      {p().calendar_name}
                    </span>
                  </div>
                  <div class="flex flex-col gap-1 text-xs text-muted-foreground">
                    <span class="flex items-center gap-1.5 font-medium text-foreground">
                      <Clock size={13} class="text-primary" />
                      {format(occStart(), 'EEEE, MMM d, yyyy')} · {format(occStart(), 'HH:mm')}–{format(occEnd(), 'HH:mm')}
                    </span>
                    <Show when={ev().recurrence}>
                      <span class="flex items-center gap-1.5">
                        <Repeat2 size={13} class="text-primary" />
                        {describeRecurrence(ev().recurrence, parseISO(ev().start))}
                      </span>
                    </Show>
                    <span class="flex items-center gap-1.5">
                      <AvatarBadge name={ev().organizerName || 'Organizer'} avatar={ev().organizerAvatar} size={16} />
                      <span>Organized by {ev().organizerName || 'Organizer'}</span>
                    </span>
                  </div>
                </div>

                <Show when={ev().description}>
                  <p class="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{ev().description}</p>
                </Show>

                <Show when={ev().location}>
                  {(loc) => (
                    <div class="detail-block">
                      <Show when={loc().kind === 'address' && loc().address}>
                        <LocationMapPreview address={loc().address!} />
                      </Show>
                      <Show when={loc().kind === 'link' ? safeHttpUrl(loc().url) : null}>
                        {(safeLocUrl) => (
                          <a
                            href={safeLocUrl()}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="flex items-center gap-2 text-sm text-primary font-medium hover:underline"
                          >
                            <Link2 size={15} />
                            <span class="truncate">{safeLocUrl()}</span>
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </Show>
                    </div>
                  )}
                </Show>

                {/* Instant 1-tap Guest RSVP */}
                <div class="detail-block space-y-3">
                  <div class="flex items-center justify-between gap-2 flex-wrap">
                    <span class="text-xs font-semibold">RSVP to this invite</span>
                    <Show when={ev().recurrence}>
                      <SlidingSegmentedControl<RsvpScope>
                        value={scope()}
                        onChange={setScope}
                        options={[
                          { value: 'occurrence', label: 'This event' },
                          { value: 'series', label: 'All in series' },
                        ]}
                      />
                    </Show>
                  </div>

                  <Show when={!authStore.user()}>
                    <input
                      type="text"
                      value={guestName()}
                      onInput={(e) => setGuestName(e.currentTarget.value)}
                      placeholder="Your name (e.g. Minh)"
                      class="w-full h-9 px-3 rounded-lg border border-border bg-card/80 text-xs text-foreground outline-none focus:border-primary"
                    />
                  </Show>

                  <div class="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={rsvpBusy()}
                      onClick={() => void handleRsvp('accepted')}
                      class={`rsvp-btn is-accepted ${myStatus() === 'accepted' ? 'is-active' : ''}`}
                    >
                      <Check size={14} /> Going
                    </button>
                    <button
                      type="button"
                      disabled={rsvpBusy()}
                      onClick={() => void handleRsvp('tentative')}
                      class={`rsvp-btn is-tentative ${myStatus() === 'tentative' ? 'is-active' : ''}`}
                    >
                      <HelpCircle size={14} /> Maybe
                    </button>
                    <button
                      type="button"
                      disabled={rsvpBusy()}
                      onClick={() => void handleRsvp('declined')}
                      class={`rsvp-btn is-declined ${myStatus() === 'declined' ? 'is-active' : ''}`}
                    >
                      <X size={14} /> Can't go
                    </button>
                  </div>

                  <Show when={rsvpFeedback()}>
                    <p class="text-xs text-primary font-medium">{rsvpFeedback()}</p>
                  </Show>
                </div>

                {/* Guest List */}
                <div class="space-y-3">
                  <div class="flex items-center gap-1.5 text-xs font-semibold">
                    <Users size={14} class="text-primary" />
                    <span>Guests</span>
                  </div>
                  <SlidingSegmentedControl<RsvpStatus | 'pending'>
                    value={tab()}
                    onChange={setTab}
                    options={[
                      { value: 'accepted', label: `Going · ${groups().accepted.length}` },
                      { value: 'tentative', label: `Maybe · ${groups().tentative.length}` },
                      { value: 'declined', label: `Declined · ${groups().declined.length}` },
                      { value: 'pending', label: `Pending · ${groups().pending.length}` },
                    ]}
                    className="w-full overflow-x-auto no-scrollbar"
                    buttonClassName="flex-1 py-1.5 text-[11px]"
                  />
                  <ul class="flex flex-col gap-2">
                    <Show when={groups()[tab()].length === 0}>
                      <li class="text-xs text-muted-foreground">Nobody here yet.</li>
                    </Show>
                    <For each={groups()[tab()]}>
                      {(m) => (
                        <li class="flex items-center gap-2 text-sm">
                          <AvatarBadge name={m.name} avatar={m.avatar} size={20} />
                          <span>{m.name}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </div>
            </article>
          );
        }}
      </Show>
    </main>
  );
}
