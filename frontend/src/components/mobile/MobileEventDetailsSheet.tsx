import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { format, isSameDay } from 'date-fns';
import { Calendar, Check, ChevronDown, ExternalLink, HelpCircle, Link2, Trash2, X } from 'lucide-solid';
import { getCategoryMeta } from '@/components/pickers/CategoryMeta';
import { LocationMapPreview } from '@/components/pickers/LocationMapPreview';
import { AvatarBadge } from '@/components/schedule/AvatarBadge';
import { canManageEvent, getResponse, safeHttpUrl, summarizeResponses } from '@/lib/recurrence';
import type { Occurrence, RsvpScope, RsvpStatus, ServerMember } from '@/models/schedule';

export function MobileEventDetailsSheet(props: {
  occ: Occurrence | null;
  userId: string;
  isAdmin: boolean;
  members: ServerMember[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: (scope: RsvpScope) => Promise<void>;
  onRespond: (status: RsvpStatus, scope: RsvpScope) => Promise<void>;
}) {
  const [busy, setBusy] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [attendeeTab, setAttendeeTab] = createSignal<RsvpStatus | 'pending'>('accepted');
  let menuRef: HTMLDivElement | undefined;

  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    onCleanup(() => document.removeEventListener('mousedown', onDoc));
  });

  createEffect(() => {
    void props.occ?.key;
    setMenuOpen(false);
    setConfirmDelete(false);
    setAttendeeTab('accepted');
  });

  const ev = () => props.occ?.event;
  const isOwner = () => (ev() ? canManageEvent(ev()!, props.userId, props.isAdmin) : false);
  const myStatus = () => (ev() && props.occ ? getResponse(ev()!, props.occ.key, props.userId) : null);
  const groups = createMemo(() =>
    ev() && props.occ
      ? summarizeResponses(ev()!, props.occ.key, props.members)
      : { accepted: [], tentative: [], declined: [], pending: [] },
  );

  const handleRespond = async (s: RsvpStatus) => {
    if (!ev()) return;
    setBusy(true);
    try {
      await props.onRespond(s, ev()!.recurrence ? 'occurrence' : 'series');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show when={props.occ && ev()}>
      {(occ) => {
        const event = ev()!;
        const cat = getCategoryMeta(event.category, event.title, event.description);
        const allAttendees = () => [
          ...groups().accepted,
          ...groups().tentative,
          ...groups().pending,
          ...groups().declined,
        ];

        return (
          <div
            class="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-end mobile-backdrop-in"
            onClick={(e) => {
              if (e.target === e.currentTarget) props.onClose();
            }}
          >
            <div class="w-full max-h-[92dvh] rounded-t-[23.5px] bg-popover border-t border-border flex flex-col overflow-hidden mobile-sheet-up">
              {/* Drag Handle */}
              <div class="flex justify-center pt-2.5 shrink-0">
                <div class="w-10 h-[5px] rounded-full bg-border" />
              </div>

              {/* Title + Category Tag + Circular Close */}
              <div class="flex items-start justify-between px-6 pt-4 pb-2 gap-3 shrink-0">
                <div class="min-w-0">
                  <h2 class="text-[26px] leading-[32px] font-bold">{event.title}</h2>
                  <div class="mt-2 inline-flex items-center h-[30px] px-3 rounded-full border border-border text-xs font-medium text-muted-foreground">
                    {cat.label}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={props.onClose}
                  aria-label="Close"
                  class="w-11 h-11 rounded-full border border-border grid place-items-center shrink-0"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Scrollable Cards */}
              <div class="flex-1 overflow-y-auto px-[18px] py-3 space-y-4">
                {/* Date Card */}
                <div class="rounded-[23.5px] border border-border bg-card/60 px-5 py-4 flex gap-3 items-start">
                  <Calendar size={18} class="text-primary mt-0.5 shrink-0" />
                  <div class="text-sm leading-snug font-medium">
                    {isSameDay(props.occ!.start, props.occ!.end)
                      ? `${format(props.occ!.start, 'EEE, MMM d, yyyy')} · ${format(props.occ!.start, 'HH:mm')}–${format(props.occ!.end, 'HH:mm')}`
                      : `${format(props.occ!.start, 'EEE, MMM d, HH:mm')} → ${format(props.occ!.end, 'EEE, MMM d, HH:mm')}`}
                  </div>
                </div>

                {/* Location Card */}
                <Show when={event.location}>
                  {(loc) => (
                    <div class="rounded-[23.5px] border border-border bg-card/60 px-5 pt-4 pb-5">
                      <div class="text-xs text-muted-foreground">Location</div>
                      <Show when={loc().kind === 'address' && loc().address}>
                        <div class="mt-2 text-lg font-semibold leading-snug">{loc().address}</div>
                        <div class="mt-3 rounded-2xl overflow-hidden">
                          <LocationMapPreview address={loc().address!} />
                        </div>
                      </Show>
                      <Show when={loc().kind === 'link' ? safeHttpUrl(loc().url) : null}>
                        {(safeUrl) => (
                          <a
                            href={safeUrl()}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="mt-2 flex items-center gap-2 text-sm text-primary font-medium underline"
                          >
                            <Link2 size={14} /> <span class="truncate">{safeUrl()}</span>
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </Show>
                    </div>
                  )}
                </Show>

                {/* RSVP Card (Outlook-style) */}
                <div class="rounded-[23.5px] border border-border bg-card/60 px-5 py-4">
                  <Show
                    when={myStatus()}
                    fallback={
                      <div class="space-y-3">
                        <div class="text-xs font-semibold text-muted-foreground">
                          Respond to this event
                        </div>
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
                      </div>
                    }
                  >
                    {(st) => (
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2.5 text-sm font-semibold min-w-0">
                          <Show when={st() === 'accepted'}>
                            <span class="w-5 h-5 rounded-full bg-primary text-primary-foreground grid place-items-center shrink-0">
                              <Check size={12} />
                            </span>
                            <span class="truncate">You've accepted this event</span>
                          </Show>
                          <Show when={st() === 'tentative'}>
                            <span class="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 grid place-items-center shrink-0">
                              <HelpCircle size={12} />
                            </span>
                            <span class="truncate">You've tentatively accepted</span>
                          </Show>
                          <Show when={st() === 'declined'}>
                            <span class="w-5 h-5 rounded-full bg-destructive/20 text-destructive grid place-items-center shrink-0">
                              <X size={12} />
                            </span>
                            <span class="truncate">You've declined this event</span>
                          </Show>
                        </div>

                        <div class="relative shrink-0" ref={menuRef}>
                          <button
                            type="button"
                            onClick={() => setMenuOpen((o) => !o)}
                            class="h-9 px-3.5 rounded-full border border-border text-xs font-medium inline-flex items-center gap-1"
                          >
                            Change <ChevronDown size={12} />
                          </button>
                          <Show when={menuOpen()}>
                            <div class="absolute right-0 bottom-11 z-50 w-40 rounded-2xl border border-border bg-popover shadow-2xl p-1.5 space-y-0.5 mobile-pop-in">
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpen(false);
                                  void handleRespond('accepted');
                                }}
                                class="w-full px-3 py-2 rounded-xl text-left text-xs font-medium text-primary hover:bg-accent"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpen(false);
                                  void handleRespond('tentative');
                                }}
                                class="w-full px-3 py-2 rounded-xl text-left text-xs font-medium text-amber-400 hover:bg-accent"
                              >
                                Maybe
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpen(false);
                                  void handleRespond('declined');
                                }}
                                class="w-full px-3 py-2 rounded-xl text-left text-xs font-medium text-destructive hover:bg-accent"
                              >
                                Decline
                              </button>
                            </div>
                          </Show>
                        </div>
                      </div>
                    )}
                  </Show>
                </div>

                {/* Attendees Card (Interactive tabs + named list) */}
                <div class="rounded-[23.5px] border border-border bg-card/60 px-5 pt-4 pb-5">
                  <div class="text-xs text-muted-foreground">Attendees</div>
                  <div class="mt-3 flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setAttendeeTab('accepted')}
                      class={`h-8 px-3.5 rounded-full text-xs font-semibold flex items-center transition-colors ${
                        attendeeTab() === 'accepted'
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-border text-muted-foreground'
                      }`}
                    >
                      {groups().accepted.length} Accepted
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttendeeTab('tentative')}
                      class={`h-8 px-3.5 rounded-full text-xs font-semibold flex items-center transition-colors ${
                        attendeeTab() === 'tentative'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                          : 'border border-border text-muted-foreground'
                      }`}
                    >
                      {groups().tentative.length} Maybe
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttendeeTab('declined')}
                      class={`h-8 px-3.5 rounded-full text-xs font-semibold flex items-center transition-colors ${
                        attendeeTab() === 'declined'
                          ? 'bg-destructive/20 text-destructive border border-destructive/40'
                          : 'border border-border text-muted-foreground'
                      }`}
                    >
                      {groups().declined.length} Declined
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttendeeTab('pending')}
                      class={`h-8 px-3.5 rounded-full text-xs font-semibold flex items-center transition-colors ${
                        attendeeTab() === 'pending'
                          ? 'bg-accent text-foreground border border-border'
                          : 'border border-border text-muted-foreground'
                      }`}
                    >
                      {groups().pending.length} Pending
                    </button>
                  </div>

                  <div class="mt-3.5 space-y-2">
                    <Show
                      when={groups()[attendeeTab()].length > 0}
                      fallback={
                        <div class="text-xs text-muted-foreground py-1">
                          No one in this list yet.
                        </div>
                      }
                    >
                      <For each={groups()[attendeeTab()]}>
                        {(m) => (
                          <div class="flex items-center gap-2.5 py-1">
                            <AvatarBadge name={m.name} avatar={m.avatar} size={28} />
                            <span class="text-sm font-medium truncate">
                              {m.name}
                              {m.id === props.userId ? ' (you)' : ''}
                            </span>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </div>
              </div>

              {/* Sticky Bottom Edit Pill + Delete Icon Button */}
              <Show when={isOwner()}>
                <div class="sticky bottom-0 px-3 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] border-t border-border/60 bg-popover flex gap-2.5 shrink-0">
                  <Show
                    when={!confirmDelete()}
                    fallback={
                      <div class="flex-1 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          class="flex-1 h-[54px] rounded-full border border-border text-sm font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void props.onDelete('series')}
                          class="flex-1 h-[54px] rounded-full bg-destructive text-destructive-foreground text-sm font-semibold"
                        >
                          Delete Event
                        </button>
                      </div>
                    }
                  >
                    <button
                      type="button"
                      onClick={props.onEdit}
                      class="flex-1 h-[54px] rounded-full border border-border bg-card/70 text-sm font-semibold grid place-items-center"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      aria-label="Delete event"
                      class="w-[54px] h-[54px] rounded-full bg-destructive/15 text-destructive border border-destructive/30 grid place-items-center shrink-0"
                    >
                      <Trash2 size={18} />
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
