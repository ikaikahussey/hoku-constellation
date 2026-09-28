import type { Db } from '@/lib/db/types'
import { getMoneyFlow, findBill } from '@/lib/db/queries/money'

/**
 * Bill landscape for a measure number + session: testimony → orgs → lobbying → officers → contributions.
 * Wrapper around lib/db/queries/money.getMoneyFlow that resolves the bill entity by measure number.
 */
export async function getBillLandscape(db: Db, billNumber: string, session: string) {
  const bill = await findBill(db, billNumber, session)
  if (!bill) {
    return { bill: billNumber, session, byPosition: { support: [], oppose: [], comment: [] }, lobbying: [], officers: [], contributions: [], sponsors: [], votes: [], entityId: null }
  }
  const flow = await getMoneyFlow(db, bill.id)
  return { ...flow, bill: billNumber, session, entityId: bill.id, bill_entity: flow.bill }
}
