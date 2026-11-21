import type { Transfer } from '@/types';

/**
 * The day of the following month by which the statement covering a transfer is expected. HDFC's
 * and Kotak's monthly statements arrive between the 3rd and the 9th; a few days' grace on top.
 * A statement later than that is surfaced by the late-statement banner, not hidden here forever.
 */
export const STATEMENT_DUE_DAY = 15;

/**
 * Whether a waiting transfer is still waiting on its bank statement rather than on a person.
 *
 * An anonymous NEFT or UPI alert names nobody, but the month's statement does, and reading it
 * settles most of them (`TransferStatementService`). Until that statement has had its chance, the
 * transfer is not work — showing it was most of Madal's To-do. Once a statement line has been
 * matched (its narration is on the note) or the statement is overdue, it is.
 */
export function awaitsStatement(transfer: Pick<Transfer, 'date' | 'note'>, today: string): boolean {
  if (transfer.note?.startsWith('Statement:')) return false;
  const [year, month] = transfer.date.split('-').map(Number);
  if (!year || !month) return false;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const due = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(STATEMENT_DUE_DAY).padStart(2, '0')}`;
  return today < due;
}
