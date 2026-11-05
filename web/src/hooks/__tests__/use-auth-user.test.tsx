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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSelf } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { AUTH_USER_QUERY_KEY, useAuthUserSync } from '../use-auth-user'

vi.mock('@/lib/api', () => ({
  getSelf: vi.fn(),
}))

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
  }
}

function selfPayload(welfarePointsTotal: number) {
  return {
    success: true,
    data: {
      id: 7,
      username: 'alice',
      role: 1,
      welfare_points_total: welfarePointsTotal,
    },
  }
}

describe('useAuthUserSync', () => {
  beforeEach(() => {
    useAuthStore.getState().auth.setUser(null)
  })

  afterEach(() => {
    vi.mocked(getSelf).mockReset()
  })

  it('writes the fetched self payload into the auth store on mount', async () => {
    vi.mocked(getSelf).mockResolvedValue(selfPayload(741))

    const { result } = renderHook(() => useAuthUserSync(), {
      wrapper: wrapperWith(makeClient()),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(useAuthStore.getState().auth.user?.welfare_points_total).toBe(741)
  })

  it('refreshes the auth store when the shared key is invalidated', async () => {
    vi.mocked(getSelf)
      .mockResolvedValueOnce(selfPayload(720))
      .mockResolvedValueOnce(selfPayload(1441))

    const client = makeClient()
    renderHook(() => useAuthUserSync(), {
      wrapper: wrapperWith(client),
    })

    await waitFor(() =>
      expect(useAuthStore.getState().auth.user?.welfare_points_total).toBe(720)
    )

    await act(async () => {
      await client.invalidateQueries({ queryKey: AUTH_USER_QUERY_KEY })
    })

    await waitFor(() =>
      expect(useAuthStore.getState().auth.user?.welfare_points_total).toBe(1441)
    )
  })
})
