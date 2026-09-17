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

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'

import type { UserSponsorshipStats } from '../types'
import { SupportBadge } from './support-badge'

function formatMonth(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
  }).format(new Date(timestamp * 1000))
}

/**
 * 用户自己的支持概况。
 *
 * 刻意不做成卡片：这里是页面的收尾，读者已经看完了几十个人和寄语，
 * 再来一个带边框、分栏、字段罗列的数据面板，会把前面那份"人味"冲掉。
 * 所以用一小段话承担信息，只用头像和称号胶囊做视觉锚点。
 *
 * 这里显示真实身份，即使公开名单上是匿名的 —— 匿名只对别人生效。
 */
export function MySupport(props: {
  stats: UserSponsorshipStats | null
  userName: string
  isAuthenticated: boolean
}) {
  const { t } = useTranslation()
  const { stats, userName, isAuthenticated } = props

  if (!isAuthenticated || !stats) {
    return null
  }

  if (!stats.supported) {
    return (
      <p className='text-muted-foreground text-sm'>
        {t('You are not on the wall yet. Pick an amount above whenever you feel like it.')}
      </p>
    )
  }

  const summary =
    stats.support_count > 1
      ? t(
          'You have been supporting us since {{first}}, {{count}} times in total. The most recent one was {{last}}.',
          {
            first: formatMonth(stats.first_time),
            count: stats.support_count,
            last: formatMonth(stats.last_time),
          }
        )
      : t('You supported us in {{date}}. Thank you.', {
          date: formatMonth(stats.first_time),
        })

  return (
    <div className='flex gap-4'>
      <Avatar className='size-11'>
        <AvatarFallback
          className='text-sm font-semibold text-white'
          style={getUserAvatarStyle(userName)}
        >
          {getUserAvatarFallback(userName)}
        </AvatarFallback>
      </Avatar>
      <div className='min-w-0 flex-1 space-y-2'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <span className='text-sm font-semibold'>{userName}</span>
          {stats.badges.map((badge) => (
            <SupportBadge key={badge} badge={badge} />
          ))}
          {stats.anonymous && (
            <span className='text-muted-foreground text-xs'>
              {t('(anonymous to others)')}
            </span>
          )}
        </div>
        <p className='text-sm leading-relaxed'>{summary}</p>
        {stats.message && (
          <p className='text-muted-foreground text-sm'>
            {t('On the wall you show: {{message}}', { message: stats.message })}
          </p>
        )}
      </div>
    </div>
  )
}
