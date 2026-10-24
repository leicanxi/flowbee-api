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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { getWelfarePointLogs, type WelfarePointLogItem } from '../../api'

const PAGE_SIZE = 20

// 流水条目上的「这笔为什么来/走」。未知来源原样显示，宁可露出英文内部名，
// 也不要吞掉一条真实账目。
const SOURCE_LABELS: Record<string, string> = {
  checkin: 'Check-in',
  invitee: 'Invitee reward',
  inviter: 'Inviter reward',
  consume_rebate: 'Consumption rebate',
  sponsor: 'Sponsorship',
  request: 'Model call',
}

function formatLogTime(seconds: number): string {
  if (!seconds) {
    return '-'
  }
  return new Date(seconds * 1000).toLocaleString()
}

function LogRow(props: { item: WelfarePointLogItem }) {
  const { t } = useTranslation()
  const { item } = props
  const positive = item.change >= 0
  const label = SOURCE_LABELS[item.source]

  return (
    <li className='flex items-start justify-between gap-3 py-2.5'>
      <div className='flex min-w-0 flex-col gap-0.5'>
        <span className='text-sm font-medium'>
          {label ? t(label) : item.source}
        </span>
        <span className='text-muted-foreground text-xs tabular-nums'>
          {formatLogTime(item.created_at)}
        </span>
      </div>
      <div className='flex shrink-0 flex-col items-end gap-0.5'>
        <span
          className={
            positive
              ? 'text-success font-mono text-sm font-semibold tabular-nums'
              : 'text-destructive font-mono text-sm font-semibold tabular-nums'
          }
        >
          {positive ? '+' : ''}
          {item.change}
        </span>
        <span className='text-muted-foreground font-mono text-[11px] tabular-nums'>
          {t('Daily')} {item.daily} · {t('Permanent')} {item.permanent}
        </span>
      </div>
    </li>
  )
}

/**
 * 积分明细弹窗。
 *
 * 积分是虚拟账本：用户看不到每一笔的来源就会怀疑扣费。流水表
 * （welfare_point_logs）本来就是 append-only 的审计账本，直接摊开给他看，
 * 不再另建「积分记录」视图。
 */
export function WelfarePointsLogsDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)

  const logsQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'welfare-point-logs', page],
    queryFn: async () => {
      const result = await getWelfarePointLogs({
        p: page,
        page_size: PAGE_SIZE,
      })
      return result.success ? result.data : undefined
    },
    enabled: props.open,
    staleTime: 60 * 1000,
  })

  const items = logsQuery.data?.items ?? []
  const total = logsQuery.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('Points history')}</DialogTitle>
          <DialogDescription>
            {t(
              'Every grant and charge is recorded here. Daily points reset each day; permanent points never expire.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='max-h-[22rem] overflow-y-auto'>
          {logsQuery.isPending ? (
            <p className='text-muted-foreground py-8 text-center text-sm'>
              {t('Loading...')}
            </p>
          ) : null}
          {!logsQuery.isPending && items.length === 0 ? (
            <p className='text-muted-foreground py-8 text-center text-sm'>
              {t('No records yet')}
            </p>
          ) : null}
          {items.length > 0 ? (
            <ul className='divide-border divide-y'>
              {items.map((item) => (
                <LogRow key={item.id} item={item} />
              ))}
            </ul>
          ) : null}
        </div>

        {total > PAGE_SIZE ? (
          <div className='flex items-center justify-between gap-2'>
            <span className='text-muted-foreground text-xs tabular-nums'>
              {t('Page {{page}} of {{count}}', {
                page,
                count: pageCount,
              })}
            </span>
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {t('Previous')}
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={page >= pageCount}
                onClick={() =>
                  setPage((current) => Math.min(pageCount, current + 1))
                }
              >
                {t('Next')}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
