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
import { render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { AffiliateRewardsCard } from '../affiliate-rewards-card'

const i18n = createInstance()

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: false,
    nsSeparator: false,
    resources: { en, zh },
    interpolation: { escapeValue: false },
  })
})

function mockInviteRules(rules: Record<string, number>) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        enabled: true,
        group: '福利',
        daily: 0,
        permanent: 0,
        total: 0,
        daily_base_points: 0,
        new_user_points: 0,
        model_costs: {},
        consume_tiers: [],
        checkin_min_points: 0,
        checkin_max_points: 0,
        invitee_points: 0,
        inviter_points: 0,
        sponsor_points: 0,
        inviter_rebate_percent: 0,
        inviter_rebate_max_quota: 0,
        ...rules,
      },
    },
  })
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AffiliateRewardsCard user={null} affiliateLink='https://example.com/a/1' />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

it('describes the balance rebate with a per-order cap when configured', async () => {
  mockInviteRules({ inviter_rebate_percent: 5, inviter_rebate_max_quota: 1000000 })
  renderCard()

  const rules = await screen.findByText(/5% 的余额返利/)
  expect(rules).toBeVisible()
  expect(rules.textContent).toContain('单笔最高')
})

it('describes the balance rebate without a cap when the cap is zero', async () => {
  mockInviteRules({ inviter_rebate_percent: 5, inviter_rebate_max_quota: 0 })
  renderCard()

  const rules = await screen.findByText(/5% 的余额返利/)
  expect(rules).toBeVisible()
  expect(rules.textContent).not.toContain('单笔最高')
})

it('falls back to the points wording when the rebate is off', async () => {
  mockInviteRules({ inviter_points: 20, invitee_points: 5 })
  renderCard()

  const rules = await screen.findByText(/20 积分/)
  expect(rules).toBeVisible()
  expect(rules.textContent).toContain('5 积分')
  expect(rules.textContent).not.toContain('余额返利')
})
