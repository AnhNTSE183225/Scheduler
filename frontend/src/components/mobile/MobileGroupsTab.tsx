import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Check, ChevronDown, X } from 'lucide-solid';
import { deleteCalendarMember } from '@/api/schedule';
import { AvatarBadge } from '@/components/schedule/AvatarBadge';
import { authStore } from '@/stores/authStore';
import { scheduleStore } from '@/stores/scheduleStore';

export function MobileGroupsTab() {
  const calendars = () => authStore.calendars();
  const groupCalendars = createMemo(() => calendars().filter((c) => !c.isPersonal));
  const [selectedId, setSelectedId] = createSignal('');
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [actionSheet, setActionSheet] = createSignal<'create' | 'join' | null>(null);
  const [nameInput, setNameInput] = createSignal('');
  const [codeInput, setCodeInput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal('');
  const [copiedCode, setCopiedCode] = createSignal(false);
  const [copiedLink, setCopiedLink] = createSignal(false);

  createEffect(() => {
    const groups = groupCalendars();
    if (!selectedId() || !groups.some((g) => g.id === selectedId())) {
      setSelectedId(groups[0]?.id || calendars()[0]?.id || '');
    }
  });

  const activeCal = createMemo(() => calendars().find((c) => c.id === selectedId()));
  const members = createMemo(() => scheduleStore.membersByCalendar()[selectedId()] || []);
  const isOwner = () => activeCal()?.ownerId === authStore.user()?.id;

  const copyCode = async () => {
    const code = activeCal()?.inviteCode;
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyInviteLink = async () => {
    const code = activeCal()?.inviteCode;
    if (!code) return;
    await navigator.clipboard.writeText(`${window.location.origin}/?join=${encodeURIComponent(code)}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    if (!nameInput().trim()) return setErr('Enter a group name.');
    setBusy(true);
    setErr('');
    try {
      const cal = await authStore.createGroup(nameInput().trim(), '');
      setSelectedId(cal.id);
      setActionSheet(null);
      setNameInput('');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create group');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (e: Event) => {
    e.preventDefault();
    if (!codeInput().trim()) return setErr('Enter an invite code.');
    setBusy(true);
    setErr('');
    try {
      const cal = await authStore.joinGroup(codeInput().trim());
      setSelectedId(cal.id);
      setActionSheet(null);
      setCodeInput('');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Invalid invite code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header: Group Management + Selector Pill */}
      <div class="px-6 pt-5 pb-2 flex items-center justify-between gap-2 shrink-0">
        <h1 class="text-[21.5px] leading-[26.5px] font-bold">Group Management</h1>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          class="h-10 px-4 rounded-full border border-border bg-card/60 flex items-center gap-2 text-sm font-medium"
        >
          <span class="truncate max-w-[120px]">
            {activeCal()?.isPersonal ? 'Personal' : activeCal()?.name || 'Groups'}
          </span>
          <ChevronDown size={13} class="text-muted-foreground" />
        </button>
      </div>

      {/* Scrollable Content */}
      <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-[18px] pt-2 pb-36">

      {/* Invite Code Card */}
      <Show when={activeCal() && !activeCal()!.isPersonal}>
        <div class="mt-[18px] rounded-[23.5px] border border-border bg-card/60 pt-4 px-[21.5px] pb-5">
          <div class="text-[14.5px] text-muted-foreground">Current Invite Code</div>
          <div class="mt-3 text-[18px] leading-6 font-mono font-bold tracking-wide break-all">
            {activeCal()!.inviteCode}
          </div>
          <div class="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => void copyCode()}
              class="flex-1 h-11 rounded-full bg-primary text-primary-foreground text-sm font-semibold grid place-items-center"
            >
              {copiedCode() ? 'Copied!' : 'Copy Code'}
            </button>
            <button
              type="button"
              onClick={() => void copyInviteLink()}
              class="flex-1 h-11 rounded-full border border-border bg-card/70 text-sm font-medium grid place-items-center"
            >
              {copiedLink() ? 'Copied!' : 'Share Link'}
            </button>
          </div>
        </div>
      </Show>

      {/* Members Card */}
      <div class="mt-[18px] rounded-[23.5px] border border-border bg-card/60 pt-4 px-[21.5px] pb-2">
        <div class="text-[14.5px] text-muted-foreground">Members ({members().length})</div>
        <div class="mt-2 divide-y divide-border/60">
          <For each={members()}>
            {(m) => {
              const memberIsOwner = m.id === activeCal()?.ownerId;
              return (
                <div class="flex items-center gap-3 py-3">
                  <AvatarBadge name={m.name} avatar={m.avatar} size={40} />
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-semibold truncate">{m.name}</div>
                    <div class="text-xs text-muted-foreground">
                      {memberIsOwner ? 'Group owner' : 'Member'}
                    </div>
                  </div>
                  <Show when={memberIsOwner}>
                    <span class="px-3 h-7 rounded-full bg-primary text-primary-foreground text-xs font-semibold grid place-items-center">
                      Owner
                    </span>
                  </Show>
                  <Show when={isOwner() && !memberIsOwner}>
                    <button
                      type="button"
                      aria-label={`Remove ${m.name}`}
                      onClick={async () => {
                        await deleteCalendarMember(selectedId(), m.id);
                        await scheduleStore.loadAll(calendars());
                      }}
                      class="w-10 h-10 grid place-items-center text-muted-foreground hover:text-destructive"
                    >
                      <X size={16} />
                    </button>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      {/* Create / Join Outline Pills */}
      <div class="mt-[18px] flex flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            setErr('');
            setActionSheet('create');
          }}
          class="h-[54px] rounded-full border border-border bg-card/50 text-[15px] font-medium grid place-items-center"
        >
          Create New Group
        </button>
        <button
          type="button"
          onClick={() => {
            setErr('');
            setActionSheet('join');
          }}
          class="h-[54px] rounded-full border border-border bg-card/50 text-[15px] font-medium grid place-items-center"
        >
          Join via Code
        </button>
      </div>
      </div>

      {/* Group Selector Sheet */}
      <Show when={pickerOpen()}>
        <div
          class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end mobile-backdrop-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false);
          }}
        >
          <div class="w-full rounded-t-[23.5px] bg-popover border-t border-border p-5 pb-[max(20px,env(safe-area-inset-bottom))] space-y-3 mobile-sheet-up">
            <div class="w-10 h-1 rounded-full bg-border mx-auto" />
            <div class="text-base font-bold">Select Group</div>
            <div class="space-y-1 max-h-64 overflow-y-auto">
              <For each={calendars()}>
                {(c) => (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(c.id);
                      setPickerOpen(false);
                    }}
                    class="w-full px-3 py-3 rounded-2xl flex items-center justify-between text-sm font-medium hover:bg-accent/60"
                  >
                    <span>{c.isPersonal ? 'Personal' : c.name}</span>
                    <Show when={selectedId() === c.id}>
                      <Check size={16} class="text-primary" />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      {/* Create / Join Action Bottom Sheet */}
      <Show when={actionSheet()}>
        <div
          class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end mobile-backdrop-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActionSheet(null);
          }}
        >
          <form
            onSubmit={(e) => void (actionSheet() === 'create' ? handleCreate(e) : handleJoin(e))}
            class="w-full rounded-t-[23.5px] bg-popover border-t border-border p-5 pb-[max(20px,env(safe-area-inset-bottom))] space-y-4 mobile-sheet-up"
          >
            <div class="w-10 h-1 rounded-full bg-border mx-auto" />
            <div class="text-base font-bold">
              {actionSheet() === 'create' ? 'Create New Group' : 'Join Group via Code'}
            </div>
            <input
              type="text"
              value={actionSheet() === 'create' ? nameInput() : codeInput()}
              onInput={(e) =>
                actionSheet() === 'create'
                  ? setNameInput(e.currentTarget.value)
                  : setCodeInput(e.currentTarget.value)
              }
              placeholder={actionSheet() === 'create' ? 'Group name (e.g. Haidilao)' : 'Invite code'}
              class="w-full h-11 px-4 rounded-2xl border border-border bg-card/80 text-sm outline-none focus:border-primary"
            />
            <Show when={err()}>
              <p class="text-xs text-destructive">{err()}</p>
            </Show>
            <button
              type="submit"
              disabled={busy()}
              class="w-full h-12 rounded-full bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
            >
              {busy() ? 'Working...' : actionSheet() === 'create' ? 'Create Group' : 'Join Group'}
            </button>
          </form>
        </div>
      </Show>
    </div>
  );
}
