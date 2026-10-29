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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FreeModelUsageDialog } from '../free-model-usage-dialog'

const mocks = vi.hoisted(() => ({
  getWelfareModelUsage: vi.fn(),
  getGroupModels: vi.fn(),
  getPerfMetricsSummary: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: (props: { to: string; children?: ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
}))

vi.mock('@/features/dashboard/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/dashboard/api')>()),
  getWelfareModelUsage: mocks.getWelfareModelUsage,
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getGroupModels: mocks.getGroupModels,
}))

vi.mock('@/features/performance-metrics/api', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/features/performance-metrics/api')
  >()),
  getPerfMetricsSummary: mocks.getPerfMetricsSummary,
}))

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <FreeModelUsageDialog open onOpenChange={() => undefined} group='福利' />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mocks.getGroupModels.mockResolvedValue({
    success: true,
    data: ['model-a', 'model-b', 'model-unused'],
  })
  mocks.getPerfMetricsSummary.mockResolvedValue({
    success: true,
    data: {
      summary: null,
      models: [
        {
          model_name: 'model-a',
          success_rate: 99,
          avg_latency_ms: 100,
          avg_tps: 10,
        },
        {
          model_name: 'model-b',
          success_rate: 75,
          avg_latency_ms: 100,
          avg_tps: 10,
        },
      ],
    },
  })
})

describe('FreeModelUsageDialog', () => {
  it('sizes bars by points spent relative to the largest model and shows status pills', async () => {
    mocks.getWelfareModelUsage.mockResolvedValue({
      success: true,
      data: {
        group: '福利',
        data_available: true,
        models: [
          {
            model_name: 'model-a',
            request_count: 4,
            points_spent: 8,
            last_used_at: 1,
          },
          {
            model_name: 'model-b',
            request_count: 2,
            points_spent: 4,
            last_used_at: 2,
          },
        ],
      },
    })

    renderDialog()

    const rowA = (await screen.findByText('model-a')).closest('li')
    const rowB = (await screen.findByText('model-b')).closest('li')
    expect(rowA).not.toBeNull()
    expect(rowB).not.toBeNull()

    const bars = document.querySelectorAll('[data-usage-bar]')
    expect(bars).toHaveLength(2)
    expect(bars[0]).toHaveStyle({ width: '100%' })
    expect(bars[1]).toHaveStyle({ width: '50%' })

    expect(within(rowA as HTMLElement).getByText('Stable')).toBeInTheDocument()
    expect(
      within(rowB as HTMLElement).getByText('Fluctuating')
    ).toBeInTheDocument()

    // 未使用的免费模型不画空条，单独列出。
    expect(screen.getByText('Not used yet')).toBeInTheDocument()
    expect(screen.getByText('model-unused')).toBeInTheDocument()

    // 条形只表达相对大小，绝不在行里露出具体积分数。
    expect(screen.queryByText('8')).not.toBeInTheDocument()
    expect(screen.queryByText('4')).not.toBeInTheDocument()
  })

  it('reorders rows from consumption to availability when the sort toggle changes', async () => {
    mocks.getWelfareModelUsage.mockResolvedValue({
      success: true,
      data: {
        group: '福利',
        data_available: true,
        models: [
          {
            model_name: 'model-a',
            request_count: 1,
            points_spent: 1,
            last_used_at: 1,
          },
          {
            model_name: 'model-b',
            request_count: 10,
            points_spent: 10,
            last_used_at: 2,
          },
        ],
      },
    })
    mocks.getPerfMetricsSummary.mockResolvedValue({
      success: true,
      data: {
        summary: null,
        models: [
          {
            model_name: 'model-a',
            success_rate: 99,
            avg_latency_ms: 100,
            avg_tps: 10,
          },
          {
            model_name: 'model-b',
            success_rate: 40,
            avg_latency_ms: 100,
            avg_tps: 10,
          },
        ],
      },
    })

    renderDialog()

    const listRows = () => [...document.querySelectorAll('ul.divide-y > li')]
    await screen.findByText('model-a')
    await waitFor(() => {
      const rowB = screen.getByText('model-b').closest('li')
      expect(
        within(rowB as HTMLElement).getByText('Unstable')
      ).toBeInTheDocument()
    })
    expect(listRows()[0].textContent).toContain('model-b')

    await userEvent.click(screen.getByRole('button', { name: 'Availability' }))

    await waitFor(() => {
      expect(listRows()[0].textContent).toContain('model-a')
    })
    expect(listRows()[1].textContent).toContain('model-b')
  })

  it('shows an empty state when the site has no free models', async () => {
    mocks.getGroupModels.mockResolvedValue({ success: true, data: [] })
    mocks.getWelfareModelUsage.mockResolvedValue({
      success: true,
      data: { group: '福利', data_available: true, models: [] },
    })

    renderDialog()

    expect(
      await screen.findByText('No free models available')
    ).toBeInTheDocument()
  })
})
