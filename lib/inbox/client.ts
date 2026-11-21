import type { InboxItem, InboxListResponse, InboxOwner, InboxStatus, InboxView, MadalDecision, Transfer, TransferStatus } from '@/types';
import type { TransferCandidates, TransferDecision, TransferDecisionResult } from '@/lib/services/TransferService';
import type { RecordRequest, RecordResult } from '@/lib/services/InboxService';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

export const inboxApi = {
  list: (params: { view: InboxView; owner?: InboxOwner; before?: string; limit?: number }) => {
    const search = new URLSearchParams({ view: params.view });
    if (params.owner) search.set('owner', params.owner);
    if (params.before) search.set('before', params.before);
    if (params.limit) search.set('limit', String(params.limit));
    return request<InboxListResponse>(`/api/inbox?${search.toString()}`);
  },

  setStatus: (id: string, status: InboxStatus) =>
    request<InboxItem>(`/api/inbox/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),

  /** Move one alert into Selavu by hand — as an expense, as income, or set aside. */
  record: (id: string, body: RecordRequest) =>
    request<RecordResult>(`/api/inbox/${id}/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};

export const transfersApi = {
  list: (status?: TransferStatus) =>
    request<Transfer[]>(`/api/transfers${status ? `?status=${status}` : ''}`),

  confirm: (id: string, decision: TransferDecision) =>
    request<TransferDecisionResult>(`/api/transfers/${id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision),
    }),

  candidates: (id: string, accountId?: string) =>
    request<TransferCandidates>(`/api/transfers/${id}/candidates${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''}`),
};

/** What Madal decided on its own (migration 039), and taking it back. */
export const madalApi = {
  decisions: (itemIds: readonly string[]) =>
    request<{ decisions: MadalDecision[] }>(`/api/madal/decisions?items=${encodeURIComponent(itemIds.join(','))}`).then((r) => r.decisions),

  undo: (id: string) =>
    request<{ decision: MadalDecision }>(`/api/madal/decisions/${id}/undo`, { method: 'POST' }).then((r) => r.decision),
};
