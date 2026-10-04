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
/*
 * 改造#35：模型详情页「按分组定价」里，倍率为 0 的分组（如福利分组 x0）
 * 曾被 `props.groupRatio[group] || 1` 回退成 1x，与模型广场列表的 0 元报价
 * 自相矛盾。这里用真实组件渲染，守住「0 倍率原样显示」。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/features/performance-metrics/api', () => ({
  getPerfMetrics: () => Promise.resolve({ data: { groups: [] } }),
}))

// `@/lib/lobe-icon` 会拉起 emoji-mart 的 JSON 数据集，node ESM 下缺少
// `with { type: 'json' }` 导入属性而直接报错；本用例不关心图标。
vi.mock('@/lib/lobe-icon', () => ({ getLobeIcon: () => null }))

// 性能页会拉起 @visactor/vchart（在该 tab，本用例不渲染），
// 而它在 vitest 下无法解析内部子路径，直接 mock 掉整个组件。
vi.mock('@/features/pricing/components/model-details-performance', () => ({
  ModelDetailsPerformance: () => null,
}))

const { ModelDetailsContent } = await import('../model-details')
const { QUOTA_TYPE_VALUES } = await import('../../constants')

/** 福利分组倍率为 0（线上 options 表 GroupRatio["福利"] = 0）。 */
const GROUP_RATIO = { default: 1, 福利: 0 }

const MODEL = {
  id: 1,
  model_name: 'welfare-test-model',
  quota_type: QUOTA_TYPE_VALUES.TOKEN,
  model_ratio: 1,
  completion_ratio: 1,
  enable_groups: ['default', '福利'],
  group_ratio: GROUP_RATIO,
}

function renderDetails() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ModelDetailsContent
        model={MODEL}
        groupRatio={GROUP_RATIO}
        usableGroup={{
          default: { desc: '', ratio: 1 },
          福利: { desc: '', ratio: 0 },
        }}
        endpointMap={{}}
        autoGroups={[]}
        priceRate={1}
        usdExchangeRate={1}
        tokenUnit='M'
      />
    </QueryClientProvider>
  )
}

describe('模型详情页分组倍率', () => {
  test('倍率为 0 的分组（福利）显示 0x，不回退成 1x', () => {
    const { container } = renderDetails()

    const welfareRow = [...container.querySelectorAll('tr')].find((row) =>
      row.textContent?.includes('福利')
    )
    if (!welfareRow) throw new Error('未找到福利分组所在行')

    const cells = [...welfareRow.querySelectorAll('td')].map(
      (cell) => cell.textContent?.trim() ?? ''
    )
    expect(cells).toContain('0x')
    expect(cells).not.toContain('1x')
  })
})
