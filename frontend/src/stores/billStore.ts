import { createSignal } from 'solid-js';
import { createBill, deleteBill, fetchBills, setBillPaid } from '@/api/bills';
import type { CreateBillPayload, SplitBill } from '@/models/schedule';

const [bills, setBills] = createSignal<SplitBill[]>([]);
const [loading, setLoading] = createSignal(false);
const [errorMsg, setErrorMsg] = createSignal<string | null>(null);

export const billStore = {
  bills,
  loading,
  errorMsg,

  async load() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchBills();
      setBills(res.data.bills);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load split bills');
    } finally {
      setLoading(false);
    }
  },

  async create(payload: CreateBillPayload): Promise<SplitBill> {
    const res = await createBill(payload);
    const created = res.data.bill;
    setBills((prev) => [created, ...prev]);
    return created;
  },

  async togglePaid(billId: string, userId: string, paid: boolean): Promise<SplitBill> {
    const res = await setBillPaid(billId, userId, paid);
    const updated = res.data.bill;
    setBills((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    return updated;
  },

  async remove(billId: string): Promise<void> {
    await deleteBill(billId);
    setBills((prev) => prev.filter((b) => b.id !== billId));
  },
};
