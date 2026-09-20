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
import { useTranslation } from 'react-i18next'

import { formatCurrency } from '@/features/wallet/lib'

import type { SponsorshipGoal } from '../types'

/**
 * 本月筹集进度。
 *
 * 进度条最细也留 2% 的可见宽度：刚收到第一笔时按真实比例算出来不足 1%，
 * 会渲染成一条空槽，看起来像坏了或者像"根本没人支持"。
 * 收了钱就是收了钱，给它一个看得见的起点。
 */
export function GoalProgress(props: { goal: SponsorshipGoal }) {
  const { t } = useTranslation()
  const { goal } = props

  const ratio = goal.target_money > 0 ? goal.raised_money / goal.target_money : 0
  const percent = Math.max(0, Math.min(100, ratio * 100))
  const barWidth = goal.raised_money > 0 ? Math.max(percent, 2) : 0

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
        <span className='text-sm font-medium'>{goal.name}</span>
        <span className='text-muted-foreground text-sm tabular-nums'>
          {t('Raised {{raised}} of {{target}}', {
            raised: `¥${formatCurrency(goal.raised_money)}`,
            target: `¥${formatCurrency(goal.target_money)}`,
          })}
        </span>
      </div>

      <div
        className='bg-muted h-2 w-full overflow-hidden rounded-full'
        role='progressbar'
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label={goal.name}
      >
        <div
          className='bg-primary h-full rounded-full transition-[width] duration-500'
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <p className='text-muted-foreground text-sm'>
        {goal.achieved
          ? t('Goal reached this month, with {{count}} people supporting', {
              count: goal.supporter_count,
            })
          : t('{{count}} people supported this month', {
              count: goal.supporter_count,
            })}
      </p>
    </div>
  )
}
