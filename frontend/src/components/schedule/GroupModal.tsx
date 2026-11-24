import { For, Show, createEffect, createSignal, on } from 'solid-js';
import { Check, Copy, LogOut, Trash2, Users, X } from 'lucide-solid';
import { deleteCalendarMember, fetchCalendarMembers } from '@/api/schedule';
import { AvatarBadge } from '@/components/schedule/AvatarBadge';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { Dialog } from '@/components/ui/Dialog';
import { SlidingSegmentedControl } from '@/components/ui/SlidingSegmentedControl';
import type { GroupMember } from '@/models/schedule';
import { authStore } from '@/stores/authStore';
import { scheduleStore } from '@/stores/scheduleStore';

export function GroupModal(props: {
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = createSignal<'create' | 'join'>('create');
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [inviteCode, setInviteCode] = createSignal('');
  const [members, setMembers] = createSignal<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [copiedCode, setCopiedCode] = createSignal(false);

  const [selectedGroupId, setSelectedGroupId] = createSignal('');

  const groupCalendars = () => authStore.calendars().filter((c) => !c.isPersonal);
  const activeCal = () => {
    const groups = groupCalendars();
    return groups.find((c) => c.id === selectedGroupId()) || groups[0];
  };
  const currentUserId = () => authStore.user()?.id ?? '';

  const loadMembers = async (calId: string) => {
    setMembersLoading(true);
    try {
      const res = await fetchCalendarMembers(calId);
      setMembers(res.data.members || []);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  };

  createEffect(
    on(
      () => [props.open, activeCal()?.id, activeCal()?.isPersonal] as const,
      ([open, calId, isPersonal]) => {
        if (open && calId && isPersonal === false) {
          void loadMembers(calId);
        } else if (!open) {
          setMembers([]);
        }
      },
    ),
  );

  const handleRemoveMember = async (member: GroupMember) => {
    const cal = activeCal();
    if (!cal) return;
    setError('');
    setBusy(true);
    try {
      await deleteCalendarMember(cal.id, member.id);
      if (member.id === currentUserId()) {
        authStore.leaveGroup(cal.id);
        props.onClose();
      } else {
        setMembers((prev) => prev.filter((m) => m.id !== member.id));
        await scheduleStore.loadAll(authStore.calendars());
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update members');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode() === 'create') {
        if (!name().trim()) throw new Error('Enter a group name.');
        await authStore.createGroup(name().trim(), description().trim());
        setName('');
        setDescription('');
      } else {
        if (!inviteCode().trim()) throw new Error('Enter an invite code.');
        await authStore.joinGroup(inviteCode().trim());
        setInviteCode('');
      }
      props.onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const copyCurrentCode = async () => {
    const code = activeCal()?.inviteCode;
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidthClass="max-w-md">
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Users size={18} class="text-primary" />
          <h3 class="text-base font-bold">Shared Calendar Groups</h3>
        </div>
        <button type="button" onClick={props.onClose} class="p-1 rounded-md text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>

      <div class="p-6 space-y-5 overflow-y-auto">
        <Show when={groupCalendars().length > 1}>
          <div class="space-y-1.5">
            <div class="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Manage Group
            </div>
            <CustomSelect
              value={activeCal()?.id || ''}
              onChange={setSelectedGroupId}
              options={groupCalendars().map((g) => ({ value: g.id, label: g.name }))}
              ariaLabel="Select group to manage"
            />
          </div>
        </Show>

        <Show when={activeCal() && !activeCal()!.isPersonal ? activeCal() : undefined}>
          {(cal) => (
            <>
              <div class="detail-block flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Current Group Invite Code
                  </div>
                  <div class="text-sm font-mono font-semibold text-foreground mt-0.5 truncate">{cal().inviteCode}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyCurrentCode()}
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-accent text-xs font-medium shrink-0"
                >
                  <Show when={copiedCode()} fallback={<Copy size={12} />}>
                    <Check size={12} class="text-primary" />
                  </Show>
                  {copiedCode() ? 'Copied' : 'Copy Code'}
                </button>
              </div>

              <div class="detail-block space-y-2.5">
                <div class="flex items-center justify-between">
                  <div class="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Members ({members().length})
                  </div>
                  <Show when={membersLoading()}>
                    <span class="text-[11px] text-muted-foreground">Loading...</span>
                  </Show>
                </div>
                <div class="space-y-2 max-h-40 overflow-y-auto pr-1">
                  <For each={members()}>
                    {(m) => {
                      const isOwnerRow = () => m.role === 'owner' || m.id === cal().ownerId;
                      const isSelf = () => m.id === currentUserId();
                      const canManage = () =>
                        !isOwnerRow() && (cal().ownerId === currentUserId() || isSelf());

                      return (
                        <div class="flex items-center justify-between gap-2 text-xs">
                          <div class="flex items-center gap-2 min-w-0">
                            <AvatarBadge name={m.name} avatar={m.avatar} size={22} />
                            <div class="min-w-0">
                              <div class="font-medium text-foreground truncate">
                                {m.name}
                                {isSelf() ? ' (you)' : ''}
                              </div>
                              <div class="text-[11px] text-muted-foreground truncate">@{m.username}</div>
                            </div>
                          </div>
                          <div class="flex items-center gap-1.5 shrink-0">
                            <Show when={isOwnerRow()}>
                              <span class="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 font-semibold">
                                Owner
                              </span>
                            </Show>
                            <Show when={canManage()}>
                              <button
                                type="button"
                                disabled={busy()}
                                onClick={() => void handleRemoveMember(m)}
                                class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-destructive/15 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                                title={isSelf() ? 'Leave group' : 'Remove member'}
                              >
                                <Show when={isSelf()} fallback={<Trash2 size={11} />}>
                                  <LogOut size={11} />
                                </Show>
                                {isSelf() ? 'Leave' : 'Remove'}
                              </button>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </>
          )}
        </Show>

        <SlidingSegmentedControl
          value={mode()}
          onChange={(v) => {
            setMode(v);
            setError('');
          }}
          options={[
            { value: 'create', label: 'Create New Group' },
            { value: 'join', label: 'Join via Code' },
          ]}
          className="w-full"
          buttonClassName="flex-1 py-1.5 text-xs font-medium"
        />

        <form onSubmit={(e) => void handleSubmit(e)} class="space-y-4">
          <Show
            when={mode() === 'create'}
            fallback={
              <div class="space-y-1.5">
                <label class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Invite Code
                </label>
                <input
                  type="text"
                  value={inviteCode()}
                  onInput={(e) => setInviteCode(e.currentTarget.value)}
                  placeholder="e.g. grp-a1b2c3d4"
                  class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
                />
              </div>
            }
          >
            <div class="space-y-1.5">
              <label class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Group Name
              </label>
              <input
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="Weekend Crew, Family, Study Group..."
                class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Description (optional)
              </label>
              <input
                type="text"
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                placeholder="Shared hangouts & reminders"
                class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>
          </Show>

          <Show when={error()}>
            <p class="text-xs text-destructive font-medium">{error()}</p>
          </Show>

          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={props.onClose}
              class="px-3.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy()}
              class="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-60"
            >
              {busy() ? 'Working...' : mode() === 'create' ? 'Create Group' : 'Join Group'}
            </button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
