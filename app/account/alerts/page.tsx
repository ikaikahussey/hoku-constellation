import { redirect } from 'next/navigation'

/** Alert emails link here; alert management lives with watchlists in the workspace. */
export default function AccountAlerts() {
  redirect('/workspace/watchlists')
}
