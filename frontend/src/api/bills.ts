import { apiFetch } from './client';
import type { CreateBillPayload, SplitBill, StateMachineDTO } from '@/models/schedule';

export function fetchBills(): Promise<StateMachineDTO<{ bills: SplitBill[] }>> {
  return apiFetch<StateMachineDTO<{ bills: SplitBill[] }>>('/bills');
}

export function fetchBill(billId: string): Promise<StateMachineDTO<{ bill: SplitBill }>> {
  return apiFetch<StateMachineDTO<{ bill: SplitBill }>>(`/bills/${encodeURIComponent(billId)}`);
}

export function createBill(payload: CreateBillPayload): Promise<StateMachineDTO<{ bill: SplitBill }>> {
  return apiFetch<StateMachineDTO<{ bill: SplitBill }>>('/bills', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function setBillPaid(
  billId: string,
  userId: string,
  paid: boolean,
): Promise<StateMachineDTO<{ bill: SplitBill }>> {
  return apiFetch<StateMachineDTO<{ bill: SplitBill }>>(`/bills/${encodeURIComponent(billId)}/paid`, {
    method: 'POST',
    body: JSON.stringify({ userId, paid }),
  });
}

export function deleteBill(billId: string): Promise<StateMachineDTO<{ deleted: boolean }>> {
  return apiFetch<StateMachineDTO<{ deleted: boolean }>>(`/bills/${encodeURIComponent(billId)}`, {
    method: 'DELETE',
  });
}
