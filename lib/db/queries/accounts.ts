import type { Db, UserAccountRow } from '../types'

export async function getUserAccount(db: Db, userId: string): Promise<UserAccountRow | null> {
  return db.one<UserAccountRow>(`select * from user_account where user_id = $1`, [userId])
}

/** Ensure a user_account row exists for a Neon Auth user (first sign-in). */
export async function ensureUserAccount(db: Db, userId: string): Promise<UserAccountRow> {
  const row = await db.one<UserAccountRow>(
    `insert into user_account(user_id) values ($1) on conflict (user_id) do update set user_id = excluded.user_id returning *`, [userId])
  return row!
}

export async function getUserAccountByStripeCustomer(db: Db, customerId: string): Promise<UserAccountRow | null> {
  return db.one<UserAccountRow>(`select * from user_account where stripe_customer_id = $1`, [customerId])
}

export interface AccountSubscriptionUpdate {
  subscription_tier?: UserAccountRow['subscription_tier']
  subscription_status?: string
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  trial_ends_at?: string | null
}

export async function updateUserAccountByUserId(db: Db, userId: string, patch: AccountSubscriptionUpdate): Promise<UserAccountRow | null> {
  return db.one<UserAccountRow>(
    `insert into user_account(user_id, subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at)
     values ($1, coalesce($2, 'free'), coalesce($3, 'inactive'), $4, $5, $6)
     on conflict (user_id) do update set
       subscription_tier = coalesce($2, user_account.subscription_tier),
       subscription_status = coalesce($3, user_account.subscription_status),
       stripe_customer_id = coalesce($4, user_account.stripe_customer_id),
       stripe_subscription_id = coalesce($5, user_account.stripe_subscription_id),
       trial_ends_at = case when $7::boolean then $6 else user_account.trial_ends_at end
     returning *`,
    [userId, patch.subscription_tier ?? null, patch.subscription_status ?? null, patch.stripe_customer_id ?? null,
      patch.stripe_subscription_id ?? null, patch.trial_ends_at ?? null, 'trial_ends_at' in patch])
}

export async function updateUserAccountByStripeCustomer(db: Db, customerId: string, patch: AccountSubscriptionUpdate): Promise<UserAccountRow | null> {
  return db.one<UserAccountRow>(
    `update user_account set
       subscription_tier = coalesce($2, subscription_tier),
       subscription_status = coalesce($3, subscription_status),
       stripe_subscription_id = coalesce($4, stripe_subscription_id),
       trial_ends_at = case when $6::boolean then $5 else trial_ends_at end
     where stripe_customer_id = $1 returning *`,
    [customerId, patch.subscription_tier ?? null, patch.subscription_status ?? null, patch.stripe_subscription_id ?? null,
      patch.trial_ends_at ?? null, 'trial_ends_at' in patch])
}

export async function setWatchList(db: Db, userId: string, entityIds: string[]): Promise<void> {
  await db.query(`update user_account set watch_entity_ids = $2::uuid[] where user_id = $1`, [userId, entityIds])
}
