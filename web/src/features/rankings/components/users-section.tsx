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
import { User, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatTokens } from '../lib/format'
import type { UserRanking } from '../types'

type UsersSectionProps = {
  rows: UserRanking[]
}

/**
 * 公开排行榜的「个人 token 用量」板块（改造#41）。
 *
 * 两点刻意的设计：
 * - 展示名由服务端打码后才下发，本组件拿不到真实用户名，即使以后误把
 *   `requireAuth` 关掉也不会泄露身份；
 * - 只展示 token 消耗量，不展示消费金额（金额能直接推出花了多少钱），
 *   也不展示占比。
 */
export function UsersSection(props: UsersSectionProps) {
  const { t } = useTranslation()

  return (
    <section className='bg-card overflow-hidden rounded-lg border'>
      <header className='flex items-start justify-between gap-4 px-5 py-4'>
        <div className='min-w-0 flex-1'>
          <h2 className='text-foreground inline-flex items-center gap-2 text-base font-semibold'>
            <Users className='text-primary size-4' />
            {t('Top Users')}
          </h2>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t('Most active users by token usage')}
          </p>
        </div>
      </header>

      {props.rows.length === 0 ? (
        <div className='text-muted-foreground/80 border-t px-5 py-8 text-center text-sm'>
          {t('No data available')}
        </div>
      ) : (
        <ul className='border-t px-5 py-2'>
          {props.rows.map((row) => (
            <UserRow key={row.rank} row={row} />
          ))}
        </ul>
      )}
    </section>
  )
}

function UserRow(props: { row: UserRanking }) {
  const { t } = useTranslation()
  return (
    <li className='flex items-center gap-3 py-2.5'>
      <span className='text-muted-foreground/80 w-6 shrink-0 text-right font-mono text-xs tabular-nums'>
        {props.row.rank}.
      </span>
      <span className='bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full'>
        <User className='size-3.5' />
      </span>
      <span className='text-foreground min-w-0 flex-1 truncate font-mono text-sm font-medium'>
        {props.row.display_name}
      </span>
      <div className='text-foreground shrink-0 text-right font-mono text-sm font-semibold tabular-nums'>
        {formatTokens(props.row.total_tokens)}{' '}
        <span className='text-muted-foreground/80 font-normal'>
          {t('tokens')}
        </span>
      </div>
    </li>
  )
}
