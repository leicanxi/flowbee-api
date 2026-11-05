/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { getSelf } from '@/lib/api'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'

/**
 * Shared query key for the fresh dashboard user snapshot. Actions that change
 * points or balance invalidate this key; every balance view then refetches at
 * once instead of each page needing its own refresh callback.
 */
export const AUTH_USER_QUERY_KEY = ['user', 'self'] as const

/**
 * Keeps the dashboard user snapshot (`auth.user`) fresh.
 *
 * Points are granted and spent from several places (check-in, lottery,
 * redemption, top-ups) and from relay calls that happen outside this tab, so
 * no single page can own the refresh. Every balance view reads this shared
 * query: it refetches on mount, on window focus and whenever an action
 * invalidates {@link AUTH_USER_QUERY_KEY}. Successful data is written back to
 * the auth store for the consumers that read role, permissions or tier from
 * there.
 */
export function useAuthUserSync(enabled = true) {
  const query = useQuery({
    queryKey: AUTH_USER_QUERY_KEY,
    queryFn: async () => {
      const response = await getSelf()
      if (!response.success || !response.data) {
        throw new Error('Failed to load user profile')
      }
      return response.data as AuthUser
    },
    enabled,
    staleTime: 0,
    // Points may be spent from another tab or client while this one is idle;
    // refetching when the user comes back is cheaper than polling.
    refetchOnWindowFocus: true,
    // A failed background sync must stay silent: the cached snapshot stays
    // usable and the next focus retries.
    meta: { errorToast: false },
  })

  useEffect(() => {
    if (query.data) {
      useAuthStore.getState().auth.setUser(query.data)
    }
  }, [query.data])

  return query
}
