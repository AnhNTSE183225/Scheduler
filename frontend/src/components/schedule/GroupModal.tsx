import { Show, createSignal } from 'solid-js';
import { Check, Copy, Users, X } from 'lucide-solid';
import { Dialog } from '@/components/ui/Dialog';
import { SlidingSegmentedControl } from '@/components/ui/SlidingSegmentedControl';
import { authStore } from '@/stores/authStore';

export function GroupModal(props: {
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = createSignal<'create' | 'join'>('create');
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [inviteCode, setInviteCode] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [copiedCode, setCopiedCode] = createSignal(false);

  const activeCal = () => authStore.calendars().find((c) => c.id === authStore.activeCalendarId());

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
        <Show when={activeCal() && !activeCal()!.isPersonal ? activeCal() : undefined}>
          {(cal) => (
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
