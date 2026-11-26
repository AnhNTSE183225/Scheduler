import { For, Index, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Landmark,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-solid';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { AvatarBadge } from '@/components/schedule/AvatarBadge';
import {
  buildVietQrDeeplink,
  fetchVietQrBankApps,
  fetchVietQrBanks,
  formatVnd,
  generateVietQrDataUrl,
  type VietQrApp,
  type VietQrBank,
} from '@/lib/vietqr';
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

export function MobileSplitBillsTab(props: {
  initialBillId?: string | null;
  onClearInitialBill?: () => void;
  onGoProfile: () => void;
}) {
  const user = () => authStore.user();
  const calendars = () => authStore.calendars();
  const hasBankInfo = () =>
    Boolean(user()?.bankBin?.trim() && user()?.bankAccountNumber?.trim());

  const [filterCalId, setFilterCalId] = createSignal<string>('all');
  const [groupSheetOpen, setGroupSheetOpen] = createSignal(false);
  const [selectedBillId, setSelectedBillId] = createSignal<string | null>(props.initialBillId ?? null);
  const [creating, setCreating] = createSignal(false);

  const [banks, setBanks] = createSignal<VietQrBank[]>([]);
  const [bankApps, setBankApps] = createSignal<VietQrApp[]>([]);
  const [selectedAppId, setSelectedAppId] = createSignal(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('pulseplan_preferred_bank_app') || ''
      : '',
  );

  // Create form state
  const [calId, setCalId] = createSignal('');
  const [title, setTitle] = createSignal('');
  const [participantIds, setParticipantIds] = createSignal<string[]>([]);
  const [items, setItems] = createSignal<DraftItem[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [formError, setFormError] = createSignal('');

  // Payment sheet state
  const [qrUrl, setQrUrl] = createSignal('');
  const [qrError, setQrError] = createSignal('');
  const [copiedAcc, setCopiedAcc] = createSignal(false);
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  onMount(() => {
    void billStore.load();
    void fetchVietQrBanks().then(setBanks);
    void fetchVietQrBankApps().then((apps) => {
      setBankApps(apps);
      if (!selectedAppId() && apps.length > 0) {
        const userCode = banks()
          .find((b) => b.bin === user()?.bankBin)
          ?.code?.toLowerCase();
        const matched = userCode ? apps.find((a) => a.appId.toLowerCase() === userCode) : undefined;
        setSelectedAppId(matched?.appId || apps[0].appId);
      }
    });
  });

  createEffect(() => {
    if (props.initialBillId) {
      setSelectedBillId(props.initialBillId);
      props.onClearInitialBill?.();
    }
  });

  const filteredBills = createMemo(() => {
    const f = filterCalId();
    return f === 'all' ? billStore.bills() : billStore.bills().filter((b) => b.calendarId === f);
  });

  // Total owed across unpaid non-creator bills
  const totalOwedSummary = createMemo(() => {
    const uid = user()?.id;
    if (!uid) return { total: 0, firstUnpaidBill: undefined as SplitBill | undefined };
    let total = 0;
    let firstUnpaidBill: SplitBill | undefined;
    for (const b of filteredBills()) {
      if (b.creatorId === uid) continue;
      const my = b.shares.find((s) => s.userId === uid);
      if (my && my.amountVnd > 0) {
        total += my.amountVnd;
        if (!firstUnpaidBill) firstUnpaidBill = b;
      }
    }
    return { total, firstUnpaidBill };
  });

  const activeBill = createMemo(() =>
    billStore.bills().find((b) => b.id === selectedBillId()),
  );

  createEffect(() => {
    const bill = activeBill();
    const u = user();
    if (!bill || !u) {
      setQrUrl('');
      setQrError('');
      return;
    }
    const my = bill.shares.find((s) => s.userId === u.id);
    const amt = my && bill.creatorId !== u.id ? my.amountVnd : 0;
    if (amt <= 0) {
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
      amountVnd: amt,
      memo: `${bill.title} - ${u.displayName}`,
    })
      .then(setQrUrl)
      .catch((err: unknown) => {
        setQrError(err instanceof Error ? err.message : 'Failed to generate VietQR');
      });
  });

  const bankNameForBin = (bin: string) => {
    const b = banks().find((x) => x.bin === bin);
    return b ? `${b.shortName} (${b.code})` : `BIN ${bin}`;
  };

  const bankCodeForBin = (bin: string) => {
    const b = banks().find((x) => x.bin === bin);
    return b?.code || bin;
  };

  const calNameForId = (cid: string) => {
    const c = calendars().find((x) => x.id === cid);
    return c ? (c.isPersonal ? 'Personal' : c.name) : 'Group';
  };

  const parseSignedVnd = (raw: string) => {
    const trimmed = raw.trim();
    const isNeg = trimmed.startsWith('-');
    const digits = trimmed.replace(/[^\d]/g, '').slice(0, 12);
    const num = Math.round(Number(digits) || 0);
    return isNeg && num > 0 ? -num : num;
  };

  const calMembers = createMemo(() => scheduleStore.membersByCalendar()[calId()] || []);

  const previewTotals = createMemo(() => {
    const map = new Map<string, number>();
    for (const id of participantIds()) map.set(id, 0);
    let total = 0;

    for (const it of items()) {
      const amt = parseSignedVnd(it.amountStr);
      if (amt === 0) continue;
      const targets = it.scope === 'all' ? participantIds() : it.memberIds;
      if (targets.length === 0) continue;
      const base = Math.trunc(amt / targets.length);
      const rem = amt % targets.length;
      const step = rem >= 0 ? 1 : -1;
      const absRem = Math.abs(rem);
      targets.forEach((uid, idx) => {
        map.set(uid, (map.get(uid) ?? 0) + base + (idx < absRem ? step : 0));
      });
      total += amt;
    }
    return { total, byUser: map };
  });

  const openCreatePage = () => {
    const cals = calendars();
    const firstGroup =
      (filterCalId() !== 'all' ? cals.find((c) => c.id === filterCalId()) : undefined) ||
      cals.find((c) => !c.isPersonal) ||
      cals[0];
    const cid = firstGroup?.id || '';
    setCalId(cid);
    const members = scheduleStore.membersByCalendar()[cid] || [];
    setParticipantIds(members.map((m) => m.id));
    setTitle('');
    setItems([{ id: `draft-${Date.now()}`, name: '', amountStr: '', scope: 'all', memberIds: [] }]);
    setFormError('');
    setCreating(true);
  };

  const handleCreate = async (e?: Event) => {
    e?.preventDefault();
    if (!title().trim()) return setFormError('Give this split bill a title.');
    if (participantIds().length === 0) return setFormError('Select at least one member.');

    const parsedItems = items()
      .map((it) => ({
        name: it.name.trim(),
        amountVnd: parseSignedVnd(it.amountStr),
        scope: it.scope,
        memberIds: it.scope === 'selected' ? it.memberIds : [],
      }))
      .filter((it) => it.name || it.amountVnd !== 0);

    if (parsedItems.length === 0) return setFormError('Add at least one expense item.');
    for (const it of parsedItems) {
      if (!it.name) return setFormError('Every expense item needs a name.');
      if (it.amountVnd === 0) return setFormError(`Enter a non-zero VND amount for "${it.name}".`);
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
      setCreating(false);
      setSelectedBillId(created.id);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create split bill');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header: Title + Group Pill */}
      <div class="px-6 pt-5 pb-2 flex items-center justify-between gap-3 shrink-0">
        <h1 class="text-[21.5px] leading-[26.5px] font-bold">Split Bills</h1>
        <button
          type="button"
          onClick={() => setGroupSheetOpen(true)}
          class="h-9 px-4 rounded-full border border-border bg-card/60 flex items-center gap-1.5 text-sm font-medium"
        >
          <span class="truncate max-w-[140px]">
            {filterCalId() === 'all' ? 'All Groups' : calNameForId(filterCalId())}
          </span>
          <ChevronDown size={13} class="text-muted-foreground" />
        </button>
      </div>

      {/* Content */}
      <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-[18px] pt-3 pb-44 flex flex-col gap-[18px]">
        {/* Hero Balance Card */}
        <div class="rounded-[23.5px] border border-border bg-card/60 pt-4 px-[21.5px] pb-5">
          <div class="text-[14.5px] text-muted-foreground">You owe</div>
          <div class="mt-4 text-[30.5px] leading-[36px] font-bold font-mono">
            {formatVnd(totalOwedSummary().total)}
          </div>
          <div class="mt-2 text-xs text-muted-foreground">
            {totalOwedSummary().total > 0
              ? 'Tap below to open your bill and pay via VietQR.'
              : 'All caught up on group bills.'}
          </div>
          <Show when={totalOwedSummary().firstUnpaidBill}>
            {(b) => (
              <button
                type="button"
                onClick={() => setSelectedBillId(b().id)}
                class="mt-5 w-full h-[54px] rounded-full bg-primary text-primary-foreground text-[15px] font-semibold grid place-items-center"
              >
                Pay with VietQR
              </button>
            )}
          </Show>
        </div>

        {/* Active Group Bills */}
        <div class="px-3 pt-1 text-[14.5px] font-medium text-muted-foreground">
          Active Group Bills ({filteredBills().length})
        </div>

        <Show when={billStore.loading()}>
          <div class="py-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={16} class="animate-spin text-primary" /> Loading bills...
          </div>
        </Show>

        <Show when={!billStore.loading() && filteredBills().length === 0}>
          <div class="rounded-[23.5px] border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
            No split bills yet. Tap <strong>+ New Split Bill</strong> below.
          </div>
        </Show>

        <For each={filteredBills()}>
          {(b) => {
            const isCreator = () => b.creatorId === user()?.id;
            const my = () => b.shares.find((s) => s.userId === user()?.id);
            const nonCreators = () => b.shares.filter((s) => s.userId !== b.creatorId);
            const paidCount = () => nonCreators().filter((s) => s.paid).length;
            return (
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setSelectedBillId(b.id);
                }}
                class="w-full text-left rounded-[23.5px] border border-border bg-card/60 pt-4 px-[21.5px] pb-5 flex items-center gap-4"
              >
                <div class="flex-1 min-w-0">
                  <div class="text-[20px] leading-[25px] font-bold truncate">{b.title}</div>
                  <div class="mt-1.5 text-xs text-muted-foreground truncate">
                    {calNameForId(b.calendarId)} · {isCreator() ? 'Created by you' : `By ${b.creatorName}`}
                  </div>
                  <div class="mt-0.5 text-xs text-muted-foreground">
                    {isCreator()
                      ? `${paidCount()}/${nonCreators().length} paid`
                      : `${b.items.length} item(s)`}
                  </div>
                </div>
                <div class="text-[15px] font-bold font-mono text-primary shrink-0">
                  {formatVnd(isCreator() ? b.totalVnd : my()?.amountVnd ?? 0)}
                </div>
                <ChevronRight size={18} class="text-muted-foreground shrink-0" />
              </button>
            );
          }}
        </For>
      </div>

      {/* Docked "+ New Split Bill" pill above floating capsule bar */}
      <div class="fixed inset-x-0 bottom-[84px] z-20 px-4">
        <Show
          when={hasBankInfo()}
          fallback={
            <button
              type="button"
              onClick={props.onGoProfile}
              class="w-full h-[54px] rounded-full border border-primary/40 bg-popover/95 backdrop-blur-xl text-primary text-[15px] font-semibold inline-flex items-center justify-center gap-2 shadow-xl"
            >
              <Landmark size={16} /> Set up Bank in Profile to Create
            </button>
          }
        >
          <button
            type="button"
            onClick={openCreatePage}
            class="w-full h-[54px] rounded-full bg-primary text-primary-foreground text-[15px] font-semibold inline-flex items-center justify-center gap-2 shadow-xl"
          >
            <Plus size={18} /> New Split Bill
          </button>
        </Show>
      </div>

      {/* Group Filter Bottom Sheet */}
      <Show when={groupSheetOpen()}>
        <div
          class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end mobile-backdrop-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setGroupSheetOpen(false);
          }}
        >
          <div class="w-full rounded-t-[23.5px] bg-popover border-t border-border p-5 pb-[max(20px,env(safe-area-inset-bottom))] space-y-3 mobile-sheet-up">
            <div class="w-10 h-1 rounded-full bg-border mx-auto" />
            <div class="text-base font-bold">Filter by Group</div>
            <div class="space-y-1 max-h-64 overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  setFilterCalId('all');
                  setGroupSheetOpen(false);
                }}
                class="w-full px-3 py-3 rounded-2xl flex items-center justify-between text-sm font-medium hover:bg-accent/60"
              >
                <span>All Groups</span>
                <Show when={filterCalId() === 'all'}>
                  <Check size={16} class="text-primary" />
                </Show>
              </button>
              <For each={calendars()}>
                {(c) => (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterCalId(c.id);
                      setGroupSheetOpen(false);
                    }}
                    class="w-full px-3 py-3 rounded-2xl flex items-center justify-between text-sm font-medium hover:bg-accent/60"
                  >
                    <span>{c.isPersonal ? 'Personal' : c.name}</span>
                    <Show when={filterCalId() === c.id}>
                      <Check size={16} class="text-primary" />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      {/* Bill Payment / Detail Bottom Sheet */}
      <Show when={activeBill()}>
        {(b) => {
          const bill = b();
          const isCreator = () => bill.creatorId === user()?.id;
          const my = () => bill.shares.find((s) => s.userId === user()?.id);
          const shareName = (uid: string) =>
            bill.shares.find((s) => s.userId === uid)?.displayName || 'Member';
          const uid = user()?.id || '';
          const myItems = bill.items
            .map((it) => {
              const targets = it.scope === 'all' ? bill.participantIds : it.memberIds;
              const idx = targets.indexOf(uid);
              if (idx === -1 || targets.length === 0) return null;
              const base = Math.trunc(it.amountVnd / targets.length);
              const rem = it.amountVnd % targets.length;
              const step = rem >= 0 ? 1 : -1;
              const shareAmt = base + (idx < Math.abs(rem) ? step : 0);
              return { id: it.id, name: it.name, full: it.amountVnd, n: targets.length, amt: shareAmt };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);

          return (
            <div
              class="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-end mobile-backdrop-in"
              onClick={(e) => {
                if (e.target === e.currentTarget) setSelectedBillId(null);
              }}
            >
              <div class="w-full max-h-[90dvh] rounded-t-[23.5px] bg-popover border-t border-border flex flex-col overflow-hidden mobile-sheet-up">
                <div class="pt-2.5 flex justify-center shrink-0">
                  <div class="w-10 h-1 rounded-full bg-border" />
                </div>
                <div class="px-6 pt-3 pb-3 flex items-start justify-between gap-3 shrink-0">
                  <div class="min-w-0">
                    <h2 class="text-2xl font-bold truncate">{bill.title}</h2>
                    <div class="text-xs text-muted-foreground mt-0.5">
                      {calNameForId(bill.calendarId)} · {isCreator() ? 'Created by you' : `By ${bill.creatorName}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedBillId(null)}
                    aria-label="Close"
                    class="w-10 h-10 rounded-full border border-border grid place-items-center shrink-0"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-[18px] pb-[max(24px,env(safe-area-inset-bottom))] space-y-4">
                  {/* Recipient View: Flattened Amount + Open Banking App + Breakdown + QR */}
                  <Show when={!isCreator() && my()}>
                    {(m) => (
                      <>
                        <Show when={m().amountVnd > 0}>
                          <div class="rounded-[23.5px] border border-primary/35 bg-primary/5 p-5 space-y-4">
                            <div class="flex items-center justify-between gap-2">
                              <div>
                                <div class="text-xs text-muted-foreground">You owe</div>
                                <div class="text-3xl font-bold font-mono text-primary">
                                  {formatVnd(m().amountVnd)}
                                </div>
                              </div>
                              <div class="text-right text-xs">
                                <div class="font-semibold">{bankNameForBin(bill.bankBin)}</div>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await navigator.clipboard.writeText(bill.bankAccountNumber);
                                    setCopiedAcc(true);
                                    setTimeout(() => setCopiedAcc(false), 2000);
                                  }}
                                  class="inline-flex items-center gap-1 font-mono text-primary mt-0.5"
                                >
                                  {bill.bankAccountNumber}
                                  <Show when={copiedAcc()} fallback={<Copy size={11} />}>
                                    <Check size={11} />
                                  </Show>
                                </button>
                              </div>
                            </div>

                            <Show when={bankApps().length > 0}>
                              <CustomSelect
                                value={selectedAppId()}
                                onChange={(appId) => {
                                  setSelectedAppId(appId);
                                  try {
                                    localStorage.setItem('pulseplan_preferred_bank_app', appId);
                                  } catch {}
                                }}
                                options={bankApps().map((a) => ({
                                  value: a.appId,
                                  label: a.appName,
                                  badge: a.autofill ? 'Auto-fill' : 'App only',
                                }))}
                                placeholder="Choose your banking app..."
                                searchable
                                searchPlaceholder="Search banking app..."
                                ariaLabel="Choose your banking app"
                                className="w-full"
                              />
                            </Show>

                            <div class="flex gap-2">
                              <Show when={selectedAppId()}>
                                <a
                                  href={buildVietQrDeeplink({
                                    appId: selectedAppId(),
                                    accountNumber: bill.bankAccountNumber,
                                    bankCode: bankCodeForBin(bill.bankBin),
                                    amountVnd: m().amountVnd,
                                    memo: `${bill.title} - ${user()?.displayName || ''}`,
                                    accountName: bill.creatorName,
                                  })}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="flex-1 h-12 rounded-full bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-2"
                                >
                                  <ExternalLink size={15} /> Open Banking App
                                </a>
                              </Show>
                              <Show when={qrUrl()}>
                                <a
                                  href={qrUrl()}
                                  download={`vietqr-${bill.id}.png`}
                                  class="h-12 px-4 rounded-full border border-border bg-card/80 text-xs font-semibold inline-flex items-center gap-1.5"
                                >
                                  <Download size={14} /> Save QR
                                </a>
                              </Show>
                            </div>

                            <Show
                              when={(() => {
                                const app = bankApps().find((a) => a.appId === selectedAppId());
                                return app && !app.autofill ? app : null;
                              })()}
                            >
                              {(app) => (
                                <p class="text-[11px] text-amber-400/90 leading-relaxed">
                                  {app().appName} only opens the app via link. Use <strong>Save QR</strong> and import from Photos/Gallery.
                                </p>
                              )}
                            </Show>

                            <Show when={qrUrl()}>
                              <div class="bg-white p-3 rounded-2xl w-fit mx-auto">
                                <img src={qrUrl()} alt="VietQR" class="w-44 h-44 object-contain" />
                              </div>
                            </Show>
                            <Show when={qrError()}>
                              <p class="text-xs text-destructive">{qrError()}</p>
                            </Show>
                          </div>
                        </Show>

                        {/* Recipient's own breakdown */}
                        <div class="rounded-[23.5px] border border-border bg-card/60 p-5 space-y-3">
                          <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Your Breakdown
                          </div>
                          <For each={myItems}>
                            {(it) => (
                              <div class="flex items-start justify-between gap-3 text-sm">
                                <div class="min-w-0">
                                  <span class={it.amt < 0 ? 'text-rose-400 font-medium' : 'font-medium'}>
                                    {it.name}
                                  </span>
                                  <Show when={it.n > 1}>
                                    <span class="ml-2 text-[11px] text-muted-foreground">
                                      (1/{it.n})
                                    </span>
                                  </Show>
                                </div>
                                <span class={`font-mono font-semibold shrink-0 ${it.amt < 0 ? 'text-rose-400' : ''}`}>
                                  {formatVnd(it.amt)}
                                </span>
                              </div>
                            )}
                          </For>
                          <div class="pt-3 border-t border-border flex items-center justify-between">
                            <span class="text-xs font-bold uppercase text-muted-foreground">Your Total</span>
                            <span class={`text-lg font-bold font-mono ${m().amountVnd < 0 ? 'text-rose-400' : 'text-primary'}`}>
                              {formatVnd(m().amountVnd)}
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </Show>

                  {/* Creator View: Full Breakdown + Creator-Only Payment Status */}
                  <Show when={isCreator()}>
                    <div class="rounded-[23.5px] border border-border bg-card/60 p-5 space-y-3">
                      <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Bill Breakdown
                      </div>
                      <For each={bill.items}>
                        {(it) => (
                          <div class="flex items-start justify-between gap-3 text-sm">
                            <div class="min-w-0">
                              <span class={it.amountVnd < 0 ? 'text-rose-400 font-medium' : 'font-medium'}>
                                {it.name}
                              </span>
                              <span class="ml-2 text-[11px] text-muted-foreground">
                                {it.scope === 'all'
                                  ? 'ALL'
                                  : it.memberIds.map((id) => `@${shareName(id)}`).join(', ')}
                              </span>
                            </div>
                            <span class={`font-mono font-semibold shrink-0 ${it.amountVnd < 0 ? 'text-rose-400' : ''}`}>
                              {formatVnd(it.amountVnd)}
                            </span>
                          </div>
                        )}
                      </For>
                      <div class="pt-3 border-t border-border flex items-center justify-between">
                        <span class="text-xs font-bold uppercase text-muted-foreground">Total</span>
                        <span class="text-lg font-bold font-mono">{formatVnd(bill.totalVnd)}</span>
                      </div>
                    </div>

                    <div class="rounded-[23.5px] border border-border bg-card/60 p-5 space-y-3">
                      <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Payment Status (Only visible to you)
                      </div>
                      <For each={bill.shares.filter((s) => s.userId !== bill.creatorId)}>
                        {(s) => (
                          <div class="flex items-center justify-between gap-3 py-1.5 border-b border-border/50 last:border-0">
                            <div class="min-w-0">
                              <div class="text-sm font-semibold truncate">{s.displayName}</div>
                              <div class="text-xs font-mono text-muted-foreground">{formatVnd(s.amountVnd)}</div>
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
                              class={`h-9 px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 border ${
                                s.paid
                                  ? 'border-primary/40 bg-primary/15 text-primary'
                                  : 'border-border bg-card/80 text-muted-foreground'
                              }`}
                            >
                              <Check size={12} /> {s.paid ? 'Paid' : 'Mark Paid'}
                            </button>
                          </div>
                        )}
                      </For>
                    </div>

                    <div class="flex justify-end">
                      <Show
                        when={confirmDelete()}
                        fallback={
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(true)}
                            class="h-10 px-4 rounded-full border border-destructive/30 text-destructive text-xs font-semibold inline-flex items-center gap-1.5"
                          >
                            <Trash2 size={13} /> Delete Bill
                          </button>
                        }
                      >
                        <div class="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            class="h-10 px-4 rounded-full border border-border text-xs"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await billStore.remove(bill.id);
                              setSelectedBillId(null);
                            }}
                            class="h-10 px-4 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold"
                          >
                            Confirm Delete
                          </button>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          );
        }}
      </Show>

      {/* Full-Screen Create Split Bill Page (Single Back button, sticky bottom CTA) */}
      <Show when={creating()}>
        <div class="fixed inset-0 z-50 bg-background flex flex-col mobile-page-in">
          <div class="px-4 py-3 border-b border-border flex items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setCreating(false)}
              class="h-10 w-10 rounded-full border border-border grid place-items-center"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <h2 class="text-base font-bold">New Split Bill</h2>
            <span class="w-10" />
          </div>

          <form
            id="mobile-create-bill-form"
            onSubmit={(e) => void handleCreate(e)}
            class="flex-1 overflow-y-auto px-[18px] py-5 space-y-5"
          >
            <div class="space-y-1.5">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                }))}
                className="w-full"
              />
            </div>

            <div class="space-y-1.5">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Bill Title
              </span>
              <input
                type="text"
                maxLength={120}
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
                placeholder="e.g. Weekend BBQ"
                class="w-full h-11 px-4 rounded-2xl border border-border bg-card/70 text-sm outline-none focus:border-primary"
              />
            </div>

            <div class="space-y-2">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                        class={`px-3 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 border ${
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

            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Expenses (VND)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      { id: `draft-${Date.now()}-${prev.length}`, name: '', amountStr: '', scope: 'all', memberIds: [] },
                    ])
                  }
                  class="text-xs font-semibold text-primary inline-flex items-center gap-1"
                >
                  <Plus size={13} /> Add Expense
                </button>
              </div>

              <Index each={items()}>
                {(it, idx) => (
                  <div class="p-3.5 rounded-[20px] border border-border bg-card/60 space-y-2.5">
                    <input
                      type="text"
                      maxLength={120}
                      value={it().name}
                      onInput={(e) => {
                        const val = e.currentTarget.value;
                        setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, name: val } : x)));
                      }}
                      placeholder="Expense name (e.g. Food)"
                      class="w-full h-10 px-3 rounded-xl border border-border bg-card/80 text-sm outline-none focus:border-primary"
                    />
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setItems((prev) =>
                            prev.map((x, i) => {
                              if (i !== idx) return x;
                              const isNeg = x.amountStr.startsWith('-');
                              const digits = x.amountStr.replace(/[^\d]/g, '');
                              return { ...x, amountStr: isNeg ? digits : `-${digits}` };
                            }),
                          )
                        }
                        class={`h-10 w-10 rounded-xl border text-sm font-bold shrink-0 grid place-items-center ${
                          it().amountStr.startsWith('-')
                            ? 'border-rose-500/40 bg-rose-500/15 text-rose-400'
                            : 'border-border bg-card/80 text-muted-foreground'
                        }`}
                      >
                        {it().amountStr.startsWith('-') ? '−' : '+'}
                      </button>
                      <input
                        type="text"
                        inputMode="text"
                        maxLength={13}
                        value={it().amountStr}
                        onInput={(e) => {
                          const raw = e.currentTarget.value;
                          const isNeg = raw.trim().startsWith('-');
                          const digits = raw.replace(/[^\d]/g, '').slice(0, 12);
                          const val = isNeg ? `-${digits}` : digits;
                          setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, amountStr: val } : x)));
                        }}
                        placeholder="Amount (VND)"
                        class={`flex-1 h-10 px-3 rounded-xl border bg-card/80 text-sm font-mono text-right outline-none focus:border-primary ${
                          it().amountStr.startsWith('-') ? 'border-rose-500/40 text-rose-400' : 'border-border'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setItems((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, scope: x.scope === 'all' ? 'selected' : 'all' } : x,
                            ),
                          )
                        }
                        class={`h-10 px-3 rounded-xl border text-xs font-semibold shrink-0 ${
                          it().scope === 'all'
                            ? 'border-primary/40 bg-primary/15 text-primary'
                            : 'border-amber-500/40 bg-amber-500/15 text-amber-400'
                        }`}
                      >
                        {it().scope === 'all' ? 'ALL' : 'Specific'}
                      </button>
                      <Show when={items().length > 1}>
                        <button
                          type="button"
                          onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                          class="h-10 w-10 rounded-xl border border-border text-destructive grid place-items-center shrink-0"
                        >
                          <Trash2 size={14} />
                        </button>
                      </Show>
                    </div>

                    <Show when={it().scope === 'selected'}>
                      <div class="flex flex-wrap gap-1.5">
                        <For each={calMembers()}>
                          {(m) => {
                            const picked = () => it().memberIds.includes(m.id);
                            return (
                              <button
                                type="button"
                                onClick={() =>
                                  setItems((prev) =>
                                    prev.map((x, i) =>
                                      i === idx
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
                                class={`px-2.5 py-1 rounded-full text-xs border ${
                                  picked()
                                    ? 'border-amber-500/50 bg-amber-500/20 text-foreground'
                                    : 'border-border text-muted-foreground'
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
              </Index>
            </div>

            <div class="p-4 rounded-[20px] border border-border bg-card/70 space-y-2">
              <div class="flex justify-between text-sm font-bold">
                <span class="text-muted-foreground">Total Bill</span>
                <span class="font-mono">{formatVnd(previewTotals().total)}</span>
              </div>
              <div class="pt-2 border-t border-border/60 space-y-1">
                <For each={calMembers().filter((m) => previewTotals().byUser.has(m.id))}>
                  {(m) => (
                    <div class="flex justify-between text-xs">
                      <span class="text-muted-foreground">{m.name}</span>
                      <span class="font-mono font-semibold">
                        {formatVnd(previewTotals().byUser.get(m.id) ?? 0)}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>

            <Show when={formError()}>
              <p class="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-xl">{formError()}</p>
            </Show>
          </form>

          <div class="px-[18px] pt-3 pb-[max(16px,env(safe-area-inset-bottom))] border-t border-border bg-background shrink-0">
            <button
              type="submit"
              form="mobile-create-bill-form"
              disabled={saving()}
              class="w-full h-[54px] rounded-full bg-primary text-primary-foreground text-[15px] font-semibold disabled:opacity-50"
            >
              {saving() ? 'Sending...' : 'Send Split Bill'}
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
