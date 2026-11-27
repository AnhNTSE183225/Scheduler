import { Dynamic } from 'solid-js/web';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { format, isSameDay, parseISO } from 'date-fns';
import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  HelpCircle,
  Link2,
  Pencil,
  Repeat2,
  Trash2,
  Users,
  X,
} from 'lucide-solid';
import { Dialog } from '@/components/ui/Dialog';
import { SlidingSegmentedControl } from '@/components/ui/SlidingSegmentedControl';
import { getCategoryMeta } from '@/components/pickers/CategoryMeta';
import { LocationMapPreview } from '@/components/pickers/LocationMapPreview';
import { AvatarBadge } from './AvatarBadge';
import {
  canManageEvent,
  describeRecurrence,
  getResponse,
  safeHttpUrl,
  summarizeResponses,
} from '@/lib/recurrence';
import type { Occurrence, RsvpScope, RsvpStatus, ServerMember } from '@/models/schedule';

export function EventDetailsDialog(props: {
  occ: Occurrence | null;
  userId: string;
  isAdmin: boolean;
  members: ServerMember[];
  calendarName: string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: (wholeSeries: boolean) => Promise<void>;
  onRespond: (status: RsvpStatus, scope: RsvpScope) => Promise<void>;
}) {
  const [scope, setScope] = createSignal<RsvpScope>('occurrence');
  const [tab, setTab] = createSignal<RsvpStatus | 'pending'>('accepted');
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [copiedLink, setCopiedLink] = createSignal(false);
  const [rsvpMenuOpen, setRsvpMenuOpen] = createSignal(false);
  let rsvpMenuRef: HTMLDivElement | undefined;

  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rsvpMenuRef && !rsvpMenuRef.contains(e.target as Node)) setRsvpMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    onCleanup(() => document.removeEventListener('mousedown', onDocClick));
  });

  createEffect(() => {
    void props.occ?.key;
    setRsvpMenuOpen(false);
  });

  const ev = () => props.occ?.event;
  const isOwner = () => (ev() ? canManageEvent(ev()!, props.userId, props.isAdmin) : false);
  const myStatus = () => (ev() && props.occ ? getResponse(ev()!, props.occ.key, props.userId) : null);
  const groups = createMemo(() =>
    ev() && props.occ
      ? summarizeResponses(ev()!, props.occ.key, props.members)
      : { accepted: [], tentative: [], declined: [], pending: [] },
  );
  const organizer = () =>
    ev() ? props.members.find((m) => m.id === ev()!.organizerId) : undefined;

  const shareUrl = () => {
    const e = ev();
    if (!e) return '';
    return `${window.location.origin}/e/${e.shareToken}`;
  };

  const copyShareUrl = async () => {
    const url = shareUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleRespond = async (s: RsvpStatus) => {
    if (!ev()) return;
    setBusy(true);
    try {
      await props.onRespond(s, ev()!.recurrence ? scope() : 'series');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (whole: boolean) => {
    setBusy(true);
    try {
      await props.onDelete(whole);
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(props.occ)} onClose={props.onClose}>
      <Show when={props.occ}>
        {(occ) => {
          const event = () => occ().event;
          const catMeta = () => getCategoryMeta(event().category, event().title, event().description);

          return (
            <>
              <Show when={safeHttpUrl(event().imageUrl)}>
                {(imgSrc) => (
                  <div class="relative shrink-0">
                    <img src={imgSrc()} alt="" class="w-full h-36 object-cover" />
                  </div>
                )}
              </Show>

              <div class="px-6 py-4 border-b border-border shrink-0 bg-card/80 flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <Dynamic component={catMeta().icon} size={18} class="text-primary shrink-0" />
                    <h3 class="text-lg font-bold truncate">{event().title}</h3>
                    <span class="text-[11px] px-2.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                      {catMeta().label}
                    </span>
                  </div>
                  <div class="flex flex-col gap-1 text-xs text-muted-foreground mt-1.5">
                    <span class="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      <Clock size={14} class="text-primary shrink-0" />
                      {isSameDay(occ().start, occ().end)
                        ? `${format(occ().start, 'EEEE, MMM d, yyyy')} · ${format(occ().start, 'HH:mm')}–${format(occ().end, 'HH:mm')}`
                        : `${format(occ().start, 'EEE, MMM d, HH:mm')} → ${format(occ().end, 'EEE, MMM d, yyyy, HH:mm')}`}
                    </span>
                    <Show when={event().recurrence}>
                      <span class="flex items-center gap-1.5">
                        <Repeat2 size={13} class="text-primary shrink-0" />
                        {describeRecurrence(event().recurrence, parseISO(event().start))}
                      </span>
                    </Show>
                    <span class="flex items-center gap-1.5">
                      <AvatarBadge
                        name={organizer()?.name || event().organizerName || 'Organizer'}
                        avatar={organizer()?.avatar || event().organizerAvatar}
                        size={15}
                      />
                      <span>
                        Organized by {organizer()?.name || event().organizerName || 'Organizer'}
                        {event().organizerId === props.userId ? ' (you)' : ''}
                      </span>
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={props.onClose}
                  class="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                <Show when={event().description}>
                  <p class="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{event().description}</p>
                </Show>

                {/* Share Action */}
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void copyShareUrl()}
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/35 bg-primary/10 hover:bg-primary/20 text-xs font-semibold text-primary transition-colors"
                  >
                    <Show when={copiedLink()} fallback={<Copy size={13} />}>
                      <Check size={13} />
                    </Show>
                    {copiedLink() ? 'Invite Link Copied!' : 'Copy Shareable Invite Link'}
                  </button>
                </div>

                <Show when={event().location}>
                  {(loc) => (
                    <div class="detail-block">
                      <Show when={loc().kind === 'address' && loc().address}>
                        <LocationMapPreview address={loc().address!} />
                      </Show>
                      <Show when={loc().kind === 'link' ? safeHttpUrl(loc().url) : null}>
                        {(safeLocUrl) => (
                          <a
                            class="flex items-center gap-2 text-sm text-primary font-medium hover:underline"
                            href={safeLocUrl()}
                            target="_blank"
                            rel="noopener noreferrer"
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

                <Show when={event().links && event().links.length > 0}>
                  <div class="flex flex-wrap gap-2">
                    <For each={event().links}>
                      {(l) => (
                        <Show when={safeHttpUrl(l.url)}>
                          {(safeUrl) => (
                            <a href={safeUrl()} target="_blank" rel="noopener noreferrer" class="link-chip">
                              <Link2 size={12} />
                              {l.label || safeUrl()}
                            </a>
                          )}
                        </Show>
                      )}
                    </For>
                  </div>
                </Show>

                <div class="detail-block flex flex-col gap-3">
                  <Show when={event().recurrence}>
                    <div class="flex items-center justify-end">
                      <SlidingSegmentedControl<RsvpScope>
                        value={scope()}
                        onChange={setScope}
                        options={[
                          { value: 'occurrence', label: 'This event' },
                          { value: 'series', label: 'All in series' },
                        ]}
                        ariaLabel="Response scope"
                      />
                    </div>
                  </Show>

                  <Show
                    when={myStatus()}
                    fallback={
                      <>
                        <span class="text-xs font-semibold text-muted-foreground">
                          Respond to this event
                        </span>
                        <div class="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            disabled={busy()}
                            onClick={() => void handleRespond('accepted')}
                            class="rsvp-btn is-accepted"
                          >
                            <Check size={14} /> Accept
                          </button>
                          <button
                            type="button"
                            disabled={busy()}
                            onClick={() => void handleRespond('tentative')}
                            class="rsvp-btn is-tentative"
                          >
                            <HelpCircle size={14} /> Maybe
                          </button>
                          <button
                            type="button"
                            disabled={busy()}
                            onClick={() => void handleRespond('declined')}
                            class="rsvp-btn is-declined"
                          >
                            <X size={14} /> Decline
                          </button>
                        </div>
                      </>
                    }
                  >
                    {(st) => (
                      <div class="flex items-center justify-between gap-3 flex-wrap">
                        <div class="flex items-center gap-2 text-sm font-semibold">
                          <Show when={st() === 'accepted'}>
                            <span class="h-6 w-6 rounded-full bg-primary/15 text-primary grid place-items-center shrink-0">
                              <Check size={14} />
                            </span>
                            <span>You've accepted this event</span>
                          </Show>
                          <Show when={st() === 'tentative'}>
                            <span class="h-6 w-6 rounded-full bg-amber-500/15 text-amber-400 grid place-items-center shrink-0">
                              <HelpCircle size={14} />
                            </span>
                            <span>You've tentatively accepted this event</span>
                          </Show>
                          <Show when={st() === 'declined'}>
                            <span class="h-6 w-6 rounded-full bg-destructive/15 text-destructive grid place-items-center shrink-0">
                              <X size={14} />
                            </span>
                            <span>You've declined this event</span>
                          </Show>
                        </div>

                        <div class="relative" ref={rsvpMenuRef}>
                          <button
                            type="button"
                            disabled={busy()}
                            onClick={() => setRsvpMenuOpen((o) => !o)}
                            aria-haspopup="menu"
                            aria-expanded={rsvpMenuOpen()}
                            class="h-8 px-3 rounded-lg border border-border bg-card/70 hover:bg-accent text-xs font-medium inline-flex items-center gap-1.5"
                          >
                            <Pencil size={12} class="text-primary" />
                            Change
                            <ChevronDown
                              size={12}
                              class={`text-muted-foreground transition-transform ${rsvpMenuOpen() ? 'rotate-180' : ''}`}
                            />
                          </button>

                          <Show when={rsvpMenuOpen()}>
                            <div
                              role="menu"
                              class="absolute right-0 mt-1.5 z-50 w-44 rounded-xl border border-border bg-popover/95 backdrop-blur-xl shadow-2xl p-1.5 space-y-0.5"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                disabled={busy()}
                                onClick={() => {
                                  setRsvpMenuOpen(false);
                                  void handleRespond('accepted');
                                }}
                                class="w-full px-2.5 py-2 rounded-lg text-left text-xs font-medium flex items-center justify-between hover:bg-accent/70"
                              >
                                <span class="inline-flex items-center gap-2 text-primary">
                                  <Check size={13} /> Accept
                                </span>
                                <Show when={st() === 'accepted'}>
                                  <Check size={12} class="text-primary" />
                                </Show>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled={busy()}
                                onClick={() => {
                                  setRsvpMenuOpen(false);
                                  void handleRespond('tentative');
                                }}
                                class="w-full px-2.5 py-2 rounded-lg text-left text-xs font-medium flex items-center justify-between hover:bg-accent/70"
                              >
                                <span class="inline-flex items-center gap-2 text-amber-400">
                                  <HelpCircle size={13} /> Tentative
                                </span>
                                <Show when={st() === 'tentative'}>
                                  <Check size={12} class="text-amber-400" />
                                </Show>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled={busy()}
                                onClick={() => {
                                  setRsvpMenuOpen(false);
                                  void handleRespond('declined');
                                }}
                                class="w-full px-2.5 py-2 rounded-lg text-left text-xs font-medium flex items-center justify-between hover:bg-accent/70"
                              >
                                <span class="inline-flex items-center gap-2 text-destructive">
                                  <X size={13} /> Decline
                                </span>
                                <Show when={st() === 'declined'}>
                                  <Check size={12} class="text-destructive" />
                                </Show>
                              </button>
                            </div>
                          </Show>
                        </div>
                      </div>
                    )}
                  </Show>
                </div>

                <div class="flex flex-col gap-3">
                  <div class="flex items-center gap-1.5 text-xs font-semibold">
                    <Users size={14} class="text-primary" />
                    <span>
                      {event().inviteEveryone
                        ? `Everyone in ${props.calendarName} + link guests`
                        : `${
                            groups().accepted.length +
                            groups().tentative.length +
                            groups().declined.length +
                            groups().pending.length
                          } invited`}
                    </span>
                  </div>

                  <SlidingSegmentedControl<RsvpStatus | 'pending'>
                    value={tab()}
                    onChange={setTab}
                    options={[
                      { value: 'accepted', label: `Accepted · ${groups().accepted.length}` },
                      { value: 'tentative', label: `Maybe · ${groups().tentative.length}` },
                      { value: 'declined', label: `Declined · ${groups().declined.length}` },
                      { value: 'pending', label: `Pending · ${groups().pending.length}` },
                    ]}
                    className="w-full overflow-x-auto no-scrollbar"
                    buttonClassName="flex-1 py-1.5 text-[11px]"
                    ariaLabel="Responses"
                  />

                  <ul class="flex flex-col gap-2 min-h-[32px]">
                    <Show when={groups()[tab()].length === 0}>
                      <li class="text-xs text-muted-foreground py-1">Nobody here yet.</li>
                    </Show>
                    <For each={groups()[tab()]}>
                      {(m) => (
                        <li class="flex items-center gap-2.5 text-sm">
                          <AvatarBadge name={m.name} avatar={m.avatar} size={22} />
                          <span>{m.name}</span>
                          <Show when={m.id === event().organizerId}>
                            <span class="text-[11px] text-muted-foreground font-medium">Organizer</span>
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </div>

              <div class="px-6 py-3.5 border-t border-border shrink-0 bg-card/90 flex items-center justify-between gap-3 flex-wrap">
                <Show
                  when={isOwner()}
                  fallback={
                    <div class="flex justify-end w-full">
                      <button
                        type="button"
                        onClick={props.onClose}
                        class="px-3.5 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent"
                      >
                        Close
                      </button>
                    </div>
                  }
                >
                  <Show
                    when={!confirmDelete()}
                    fallback={
                      <div class="flex items-center gap-2 w-full justify-between flex-wrap">
                        <span class="text-xs font-semibold text-destructive">
                          Delete {event().recurrence ? 'which events?' : 'this event?'}
                        </span>
                        <div class="flex items-center gap-2">
                          <Show when={event().recurrence}>
                            <button
                              type="button"
                              disabled={busy()}
                              onClick={() => void handleRemove(false)}
                              class="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent"
                            >
                              Only this one
                            </button>
                          </Show>
                          <button
                            type="button"
                            disabled={busy()}
                            onClick={() => void handleRemove(true)}
                            class="px-3 py-1.5 rounded-lg bg-destructive text-white text-xs font-semibold hover:opacity-90"
                          >
                            {event().recurrence ? 'Whole series' : 'Confirm delete'}
                          </button>
                          <button
                            type="button"
                            disabled={busy()}
                            onClick={() => setConfirmDelete(false)}
                            class="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    }
                  >
                    <div class="flex items-center gap-2 w-full justify-between">
                      <button
                        type="button"
                        disabled={busy()}
                        onClick={() => setConfirmDelete(true)}
                        class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy()}
                          onClick={props.onEdit}
                          class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent"
                        >
                          <Pencil size={13} /> Edit{event().recurrence ? ' series' : ''}
                        </button>
                        <button
                          type="button"
                          onClick={props.onClose}
                          class="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  </Show>
                </Show>
              </div>
            </>
          );
        }}
      </Show>
    </Dialog>
  );
}
