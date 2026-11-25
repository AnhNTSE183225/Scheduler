import { For, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js';
import {
  ArrowLeft,
  Check,
  Copy,
  Landmark,
  Loader2,
  Plus,
  Receipt,
  Trash2,
  Users,
  X,
} from 'lucide-solid';
import { Dialog } from '@/components/ui/Dialog';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { AvatarBadge } from './AvatarBadge';
import { fetchVietQrBanks, formatVnd, generateVietQrDataUrl, type VietQrBank } from '@/lib/vietqr';
import type { SplitBill } from '@/models/schedule';
import { authStore } from '@/stores/authStore';
import { billStore } from '@/stores/billStore';
import { scheduleStore } from '@/stores/scheduleStore';

interface DraftItem {
  id: string;
  name: string;
  amountStr: string;
  scope: 'all' | 'selected';
  memberIds: string[];
}

export function SplitBillModal(props: {
  open: boolean;
  initialBillId?: string | null;
  onClose: () => void;
  onOpenProfile: () => void;
}) {
  const user = () => authStore.user();
  const calendars = () => authStore.calendars();
  const hasBankInfo = () =>
    Boolean(user()?.bankBin?.trim() && user()?.bankAccountNumber?.trim());

  const [mode, setMode] = createSignal<'list' | 'create' | 'detail'>('list');
  const [selectedBillId, setSelectedBillId] = createSignal<string | null>(null);
  const [banks, setBanks] = createSignal<VietQrBank[]>([]);

  // Create form state
  const [calId, setCalId] = createSignal('');
  const [title, setTitle] = createSignal('');
  const [participantIds, setParticipantIds] = createSignal<string[]>([]);
  const [items, setItems] = createSignal<DraftItem[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [formError, setFormError] = createSignal('');

  // Detail state
  const [qrUrl, setQrUrl] = createSignal<string>('');
  const [qrError, setQrError] = createSignal<string>('');
  const [copiedAcc, setCopiedAcc] = createSignal(false);
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  onMount(() => {
    void fetchVietQrBanks().then(setBanks);
  });

  const resetCreateForm = (preferredCalId?: string) => {
    const cals = calendars();
    const firstGroup = cals.find((c) => !c.isPersonal) || cals[0];
    const cid = preferredCalId || firstGroup?.id || '';
    setCalId(cid);
    const members = scheduleStore.membersByCalendar()[cid] || [];
    setParticipantIds(members.map((m) => m.id));
    setTitle('');
    setItems([
      {
        id: `draft-${Date.now()}`,
        name: '',
        amountStr: '',
        scope: 'all',
        memberIds: [],
      },
    ]);
    setFormError('');
  };

  createEffect(() => {
    if (!props.open) return;
    void billStore.load();
    setConfirmDelete(false);
    if (props.initialBillId) {
      setSelectedBillId(props.initialBillId);
      setMode('detail');
    } else {
      setMode('list');
      setSelectedBillId(null);
    }
  });

  const activeBill = createMemo<SplitBill | undefined>(() =>
    billStore.bills().find((b) => b.id === selectedBillId()),
  );

  // Generate VietQR whenever viewing a bill detail where the user owes > 0
  createEffect(() => {
    const bill = activeBill();
    const u = user();
    if (mode() !== 'detail' || !bill || !u) {
      setQrUrl('');
      setQrError('');
      return;
    }

    const myShare = bill.shares.find((s) => s.userId === u.id);
    const amount = myShare && bill.creatorId !== u.id ? myShare.amountVnd : 0;
    if (amount <= 0) {
      setQrUrl('');
      setQrError('');
      return;
    }

    setQrUrl('');
    setQrError('');
    void generateVietQrDataUrl({
      bankBin: bill.bankBin,
      accountNumber: bill.bankAccountNumber,
      accountName: bill.creatorName,
      amountVnd: amount,
      memo: `${bill.title} - ${u.displayName}`,
    })
      .then(setQrUrl)
      .catch((err: unknown) => {
        setQrError(err instanceof Error ? err.message : 'Failed to generate VietQR');
      });
  });

  const calMembers = createMemo(() => scheduleStore.membersByCalendar()[calId()] || []);

  const previewTotals = createMemo(() => {
    const map = new Map<string, number>();
    for (const id of participantIds()) map.set(id, 0);
    let total = 0;

    for (const it of items()) {
      const amt = Math.round(Number(it.amountStr.replace(/[^\d]/g, '')) || 0);
      if (amt <= 0) continue;
      const targets = it.scope === 'all' ? participantIds() : it.memberIds;
      if (targets.length === 0) continue;
      const base = Math.floor(amt / targets.length);
      const rem = amt % targets.length;
      targets.forEach((uid, idx) => {
        map.set(uid, (map.get(uid) ?? 0) + base + (idx < rem ? 1 : 0));
      });
      total += amt;
    }
    return { total, byUser: map };
  });

  const bankNameForBin = (bin: string) => {
    const b = banks().find((x) => x.bin === bin);
    return b ? `${b.shortName} (${b.code})` : `BIN ${bin}`;
  };

  const calNameForId = (cid: string) => {
    const c = calendars().find((x) => x.id === cid);
    return c ? (c.isPersonal ? 'Personal' : c.name) : 'Group';
  };

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    if (!title().trim()) {
      setFormError('Give this split bill a title.');
      return;
    }
    if (participantIds().length === 0) {
      setFormError('Select at least one member to include in the split.');
      return;
    }

    const parsedItems = items()
      .map((it) => ({
        name: it.name.trim(),
        amountVnd: Math.round(Number(it.amountStr.replace(/[^\d]/g, '')) || 0),
        scope: it.scope,
        memberIds: it.scope === 'selected' ? it.memberIds : [],
      }))
      .filter((it) => it.name || it.amountVnd > 0);

    if (parsedItems.length === 0) {
      setFormError('Add at least one expense item.');
      return;
    }
    for (const it of parsedItems) {
      if (!it.name) return setFormError('Every expense item needs a name.');
      if (it.amountVnd <= 0) return setFormError(`Enter a positive VND amount for "${it.name}".`);
      if (it.scope === 'selected' && it.memberIds.length === 0) {
        return setFormError(`Select at least one person for "${it.name}".`);
      }
    }

    setSaving(true);
    setFormError('');
    try {
      const created = await billStore.create({
        calendarId: calId(),
        title: title().trim(),
        participantIds: participantIds(),
        items: parsedItems,
      });
      setSelectedBillId(created.id);
      setMode('detail');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create split bill');
    } finally {
      setSaving(false);
    }
  };

  const copyAccount = async (acc: string) => {
    await navigator.clipboard.writeText(acc);
    setCopiedAcc(true);
    setTimeout(() => setCopiedAcc(false), 2000);
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidthClass="max-w-2xl">
      <div class="px-6 py-4 border-b border-border shrink-0 bg-card/90 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <Show when={mode() !== 'list'}>
            <button
              type="button"
              onClick={() => {
                setMode('list');
                setConfirmDelete(false);
              }}
              class="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
              aria-label="Back"
            >
              <ArrowLeft size={16} />
            </button>
          </Show>
          <Receipt size={18} class="text-primary shrink-0" />
          <h3 class="text-lg font-bold truncate">
            {mode() === 'create'
              ? 'New Split Bill'
              : mode() === 'detail'
              ? activeBill()?.title || 'Split Bill'
              : 'Split Bills'}
          </h3>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          class="p-1.5 rounded-lg text-muted-foreground hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 space-y-5">
        {/* LIST VIEW */}
        <Show when={mode() === 'list'}>
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <p class="text-xs text-muted-foreground">
              Split group expenses evenly or per-person and pay via VietQR.
            </p>
            <Show
              when={hasBankInfo()}
              fallback={
                <button
                  type="button"
                  onClick={() => {
                    props.onClose();
                    props.onOpenProfile();
                  }}
                  class="h-9 px-3.5 rounded-lg border border-primary/40 bg-primary/10 text-primary text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-primary/20"
                >
                  <Landmark size={14} /> Set up Bank in Profile to Create
                </button>
              }
            >
              <button
                type="button"
                onClick={() => {
                  resetCreateForm();
                  setMode('create');
                }}
                class="h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90"
              >
                <Plus size={14} /> New Split Bill
              </button>
            </Show>
          </div>

          <Show when={billStore.loading()}>
            <div class="py-10 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={16} class="animate-spin text-primary" /> Loading bills...
            </div>
          </Show>

          <Show when={!billStore.loading() && billStore.bills().length === 0}>
            <div class="py-12 text-center space-y-2 border border-dashed border-border rounded-xl">
              <Receipt size={28} class="mx-auto text-muted-foreground/60" />
              <div class="text-sm font-semibold">No split bills yet</div>
              <p class="text-xs text-muted-foreground">
                Create a split bill to divide group expenses and share a VietQR code.
              </p>
            </div>
          </Show>

          <div class="space-y-2.5">
            <For each={billStore.bills()}>
              {(b) => {
                const isCreator = () => b.creatorId === user()?.id;
                const myShare = () => b.shares.find((s) => s.userId === user()?.id);
                const nonCreatorShares = () => b.shares.filter((s) => s.userId !== b.creatorId);
                const paidCount = () => nonCreatorShares().filter((s) => s.paid).length;

                return (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedBillId(b.id);
                      setConfirmDelete(false);
                      setMode('detail');
                    }}
                    class="w-full p-4 rounded-xl border border-border bg-card/60 hover:bg-accent/50 transition-colors text-left flex items-center justify-between gap-3"
                  >
                    <div class="min-w-0 space-y-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-bold truncate">{b.title}</span>
                        <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/25">
                          {calNameForId(b.calendarId)}
                        </span>
                      </div>
                      <div class="text-xs text-muted-foreground">
                        By {isCreator() ? 'you' : b.creatorName} · {b.items.length} item(s) · Total {formatVnd(b.totalVnd)}
                      </div>
                    </div>

                    <div class="text-right shrink-0">
                      <Show
                        when={isCreator()}
                        fallback={
                          <div>
                            <div class="text-xs text-muted-foreground">You owe</div>
                            <div class="text-sm font-bold text-primary font-mono">
                              {formatVnd(myShare()?.amountVnd ?? 0)}
                            </div>
                          </div>
                        }
                      >
                        <div class="text-xs font-semibold text-primary">
                          {paidCount()}/{nonCreatorShares().length} paid
                        </div>
                        <div class="text-[11px] text-muted-foreground">Creator</div>
                      </Show>
                    </div>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>

        {/* CREATE VIEW */}
        <Show when={mode() === 'create'}>
          <form onSubmit={(e) => void handleCreate(e)} class="space-y-5">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="flex flex-col gap-1.5">
                <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Calendar / Group
                </span>
                <CustomSelect
                  value={calId()}
                  onChange={(cid) => {
                    setCalId(cid);
                    const members = scheduleStore.membersByCalendar()[cid] || [];
                    setParticipantIds(members.map((m) => m.id));
                  }}
                  options={calendars().map((c) => ({
                    value: c.id,
                    label: c.isPersonal ? 'Personal' : c.name,
                    badge: c.isPersonal ? 'Personal' : 'Group',
                  }))}
                  ariaLabel="Select calendar"
                />
              </div>

              <div class="flex flex-col gap-1.5">
                <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Bill Title
                </span>
                <input
                  type="text"
                  maxLength={120}
                  value={title()}
                  onInput={(e) => setTitle(e.currentTarget.value)}
                  placeholder="e.g. Weekend BBQ"
                  class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Included members for ALL */}
            <div class="flex flex-col gap-2">
              <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Users size={12} class="text-primary" />
                Included in ALL ({participantIds().length}/{calMembers().length})
              </span>
              <div class="flex flex-wrap gap-2">
                <For each={calMembers()}>
                  {(m) => {
                    const active = () => participantIds().includes(m.id);
                    return (
                      <button
                        type="button"
                        onClick={() =>
                          setParticipantIds((prev) =>
                            prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id],
                          )
                        }
                        class={`px-2.5 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 border transition-colors ${
                          active()
                            ? 'border-primary/50 bg-primary/15 text-foreground'
                            : 'border-border bg-card/50 text-muted-foreground'
                        }`}
                      >
                        <AvatarBadge name={m.name} avatar={m.avatar} size={16} />
                        <span>{m.name}{m.id === user()?.id ? ' (you)' : ''}</span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>

            {/* Expense items */}
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Expenses (VND)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      {
                        id: `draft-${Date.now()}-${prev.length}`,
                        name: '',
                        amountStr: '',
                        scope: 'all',
                        memberIds: [],
                      },
                    ])
                  }
                  class="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Plus size={12} /> Add Expense
                </button>
              </div>

              <div class="space-y-2.5">
                <For each={items()}>
                  {(it, idx) => (
                    <div class="p-3 rounded-xl border border-border bg-card/50 space-y-2.5">
                      <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <input
                          type="text"
                          maxLength={120}
                          value={it.name}
                          onInput={(e) => {
                            const val = e.currentTarget.value;
                            setItems((prev) =>
                              prev.map((x, i) => (i === idx() ? { ...x, name: val } : x)),
                            );
                          }}
                          placeholder="Expense name (e.g. Food)"
                          class="flex-1 min-w-[140px] h-9 px-3 rounded-lg border border-border bg-card/80 text-xs text-foreground outline-none focus:border-primary"
                        />
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={12}
                          value={it.amountStr}
                          onInput={(e) => {
                            const val = e.currentTarget.value.replace(/[^\d]/g, '').slice(0, 12);
                            setItems((prev) =>
                              prev.map((x, i) => (i === idx() ? { ...x, amountStr: val } : x)),
                            );
                          }}
                          placeholder="Amount (VND)"
                          class="w-36 h-9 px-3 rounded-lg border border-border bg-card/80 text-xs font-mono text-right text-foreground outline-none focus:border-primary"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setItems((prev) =>
                              prev.map((x, i) =>
                                i === idx()
                                  ? { ...x, scope: x.scope === 'all' ? 'selected' : 'all' }
                                  : x,
                              ),
                            )
                          }
                          class={`h-9 px-2.5 rounded-lg border text-xs font-semibold shrink-0 ${
                            it.scope === 'all'
                              ? 'border-primary/40 bg-primary/15 text-primary'
                              : 'border-amber-500/40 bg-amber-500/15 text-amber-400'
                          }`}
                        >
                          {it.scope === 'all' ? 'ALL' : 'Specific'}
                        </button>
                        <Show when={items().length > 1}>
                          <button
                            type="button"
                            onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx()))}
                            class="h-9 w-9 rounded-lg border border-border hover:bg-destructive/15 hover:text-destructive grid place-items-center shrink-0"
                            aria-label="Remove item"
                          >
                            <Trash2 size={13} />
                          </button>
                        </Show>
                      </div>

                      <Show when={it.scope === 'selected'}>
                        <div class="flex flex-wrap gap-1.5 pt-1">
                          <For each={calMembers()}>
                            {(m) => {
                              const picked = () => it.memberIds.includes(m.id);
                              return (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setItems((prev) =>
                                      prev.map((x, i) =>
                                        i === idx()
                                          ? {
                                              ...x,
                                              memberIds: picked()
                                                ? x.memberIds.filter((id) => id !== m.id)
                                                : [...x.memberIds, m.id],
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                  class={`px-2 py-1 rounded-full text-[11px] font-medium border ${
                                    picked()
                                      ? 'border-amber-500/50 bg-amber-500/20 text-foreground'
                                      : 'border-border bg-card/40 text-muted-foreground'
                                  }`}
                                >
                                  @{m.name}
                                </button>
                              );
                            }}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>

            {/* Live summary */}
            <div class="p-4 rounded-xl border border-border bg-card/70 space-y-2">
              <div class="flex items-center justify-between text-xs font-semibold">
                <span class="text-muted-foreground">Total Bill</span>
                <span class="text-base font-bold font-mono text-foreground">
                  {formatVnd(previewTotals().total)}
                </span>
              </div>
              <div class="pt-2 border-t border-border/70 space-y-1">
                <For each={calMembers().filter((m) => previewTotals().byUser.has(m.id))}>
                  {(m) => (
                    <div class="flex items-center justify-between text-xs">
                      <span class="text-muted-foreground">
                        {m.name}{m.id === user()?.id ? ' (you)' : ''}
                      </span>
                      <span class="font-mono font-semibold">
                        {formatVnd(previewTotals().byUser.get(m.id) ?? 0)}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>

            <Show when={formError()}>
              <p class="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{formError()}</p>
            </Show>

            <div class="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMode('list')}
                class="h-9 px-4 rounded-lg border border-border text-xs font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving()}
                class="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {saving() ? 'Sending...' : 'Send Split Bill'}
              </button>
            </div>
          </form>
        </Show>

        {/* DETAIL / RECEIPT + VIETQR VIEW */}
        <Show when={mode() === 'detail' && activeBill()}>
          {(b) => {
            const bill = b();
            const isCreator = () => bill.creatorId === user()?.id;
            const myShare = () => bill.shares.find((s) => s.userId === user()?.id);
            const shareName = (uid: string) =>
              bill.shares.find((s) => s.userId === uid)?.displayName || 'Member';

            return (
              <div class="space-y-5">
                <div class="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
                  <span>
                    {calNameForId(bill.calendarId)} · Requested by{' '}
                    <strong class="text-foreground">
                      {isCreator() ? 'you' : bill.creatorName}
                    </strong>
                  </span>
                  <span>{new Date(bill.createdAt * 1000).toLocaleDateString()}</span>
                </div>

                {/* Receipt / Bill Breakdown */}
                <div class="p-4 rounded-xl border border-border bg-card/70 space-y-3">
                  <div class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Bill Breakdown
                  </div>

                  <div class="space-y-2">
                    <For each={bill.items}>
                      {(it) => (
                        <div class="flex items-start justify-between gap-3 text-xs">
                          <div class="min-w-0">
                            <span class="font-medium text-foreground">{it.name}</span>
                            <span class="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {it.scope === 'all'
                                ? 'ALL'
                                : it.memberIds.map((id) => `@${shareName(id)}`).join(', ')}
                            </span>
                          </div>
                          <span class="font-mono font-semibold shrink-0 text-right">
                            {formatVnd(it.amountVnd)}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>

                  <div class="pt-3 border-t border-border flex items-center justify-between">
                    <span class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Total
                    </span>
                    <span class="text-base font-bold font-mono">{formatVnd(bill.totalVnd)}</span>
                  </div>
                </div>

                {/* Participant's own share + VietQR */}
                <Show when={!isCreator() && myShare() && myShare()!.amountVnd > 0}>
                  <div class="p-4 rounded-xl border border-primary/35 bg-primary/5 space-y-4">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <div class="text-xs text-muted-foreground">Your Share</div>
                        <div class="text-xl font-bold font-mono text-primary">
                          {formatVnd(myShare()!.amountVnd)}
                        </div>
                      </div>
                      <div class="text-right text-xs">
                        <div class="font-semibold">{bankNameForBin(bill.bankBin)}</div>
                        <button
                          type="button"
                          onClick={() => void copyAccount(bill.bankAccountNumber)}
                          class="inline-flex items-center gap-1 font-mono text-primary hover:underline mt-0.5"
                        >
                          {bill.bankAccountNumber}
                          <Show when={copiedAcc()} fallback={<Copy size={11} />}>
                            <Check size={11} />
                          </Show>
                        </button>
                      </div>
                    </div>

                    <Show when={qrUrl()}>
                      <div class="flex flex-col items-center gap-2 bg-white p-3 rounded-xl w-fit mx-auto">
                        <img
                          src={qrUrl()}
                          alt="VietQR Payment Code"
                          class="w-52 h-52 object-contain"
                        />
                      </div>
                    </Show>
                    <Show when={qrError()}>
                      <p class="text-xs text-destructive">{qrError()}</p>
                    </Show>
                  </div>
                </Show>

                {/* Creator-Only Payment Tracker (hidden from other participants) */}
                <Show when={isCreator()}>
                  <div class="p-4 rounded-xl border border-border bg-card/60 space-y-3">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Payment Status (Only visible to you)
                      </span>
                    </div>

                    <div class="space-y-2">
                      <For each={bill.shares.filter((s) => s.userId !== bill.creatorId)}>
                        {(s) => (
                          <div class="flex items-center justify-between gap-3 py-1.5 border-b border-border/50 last:border-0">
                            <div class="min-w-0">
                              <div class="text-xs font-semibold truncate">{s.displayName}</div>
                              <div class="text-[11px] font-mono text-muted-foreground">
                                {formatVnd(s.amountVnd)}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={busyId() === s.userId}
                              onClick={async () => {
                                setBusyId(s.userId);
                                try {
                                  await billStore.togglePaid(bill.id, s.userId, !s.paid);
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              class={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                                s.paid
                                  ? 'border-primary/40 bg-primary/15 text-primary'
                                  : 'border-border bg-card/80 text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              <Check size={12} />
                              {s.paid ? 'Paid' : 'Mark Paid'}
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>

                  <div class="flex justify-end">
                    <Show
                      when={confirmDelete()}
                      fallback={
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(true)}
                          class="h-8 px-3 rounded-lg border border-destructive/30 text-destructive text-xs font-medium hover:bg-destructive/10 inline-flex items-center gap-1.5"
                        >
                          <Trash2 size={12} /> Delete Bill
                        </button>
                      }
                    >
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          class="h-8 px-3 rounded-lg border border-border text-xs"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await billStore.remove(bill.id);
                            setMode('list');
                          }}
                          class="h-8 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold"
                        >
                          Confirm Delete
                        </button>
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
            );
          }}
        </Show>
      </div>
    </Dialog>
  );
}
