-- Fix infinite recursion in staff_role RLS policy
-- The old policy queried staff_role to check if a user could read staff_role,
-- which triggered the policy recursively. Since other tables' policies do
-- `SELECT user_id FROM staff_role` as a staff check, this broke those too.
--
-- Fix: let each authenticated user read their own staff_role row. That's
-- sufficient for the IN (SELECT user_id FROM staff_role) check used elsewhere.

DROP POLICY IF EXISTS "Staff can read staff roles" ON staff_role;

CREATE POLICY "Users can read own staff role" ON staff_role
  FOR SELECT USING (auth.uid() = user_id);
