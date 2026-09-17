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
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { ColumnDef, PaginationState } from '@tanstack/react-table'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/features/wallet/lib'

import { listSponsorshipOrders, updateSponsorshipMessageStatus } from '../api'
import type { AdminSponsorshipOrder, SponsorshipAdminStats } from '../types'

const QUERY_KEY = 'sponsorship-admin-orders'
const PAGE_SIZE = 20

function formatDate(timestamp: number): string {
  if (!timestamp) return '-'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1000))
}

/** 列表上方那行汇总。数字直接来自服务端，不在前端对当前页做统计。 */
function StatsLine(props: { stats: SponsorshipAdminStats | undefined }) {
  const { t } = useTranslation()
  const { stats } = props
  if (!stats) {
    return null
  }
  const items = [
    { label: t('Support records'), value: String(stats.support_count) },
    { label: t('Supporters'), value: String(stats.supporter_num) },
    { label: t('Total amount'), value: `¥${formatCurrency(stats.total_money)}` },
  ]
  return (
    <dl className='flex flex-wrap gap-x-8 gap-y-2'>
      {items.map((item) => (
        <div key={item.label}>
          <dt className='text-muted-foreground text-xs'>{item.label}</dt>
          <dd className='text-lg font-semibold tabular-nums'>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * 支持记录与寄语审核。
 *
 * 首期是「先展示后审核」：pending 的寄语在名单上已经可见，管理员在这里
 * 做的是事后下架。所以主要动作是「下架」——没有问题的记录本来就不需要
 * 操作，把它们逐条点一遍没有意义。
 *
 * 匿名只对公开名单生效，这里显示真实身份：审核必须知道是谁写的。
 */
export function SponsorshipModeration() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [usernameInput, setUsernameInput] = useState('')
  const [username, setUsername] = useState('')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [QUERY_KEY, page, username],
    queryFn: () => listSponsorshipOrders({ page, pageSize: PAGE_SIZE, username }),
    placeholderData: keepPreviousData,
  })

  const mutation = useMutation({
    mutationFn: (input: { id: number; status: string }) =>
      updateSponsorshipMessageStatus(input.id, input.status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [QUERY_KEY] })
      toast.success(t('Saved'))
    },
    onError: () => toast.error(t('Request failed')),
  })

  const columns: ColumnDef<AdminSponsorshipOrder>[] = [
    {
      accessorKey: 'complete_time',
      header: t('Time'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className='text-muted-foreground whitespace-nowrap'>
          {formatDate(row.original.complete_time || row.original.create_time)}
        </span>
      ),
    },
    {
      accessorKey: 'username',
      header: t('User'),
      enableSorting: false,
      cell: ({ row }) => {
        const order = row.original
        return (
          <div className='flex items-center gap-2 whitespace-nowrap'>
            <span className='font-medium'>
              {order.display_name || order.username}
            </span>
            {/* 带上用户 ID，方便和用户管理、日志里的记录对上号。 */}
            <span className='text-muted-foreground text-xs tabular-nums'>
              #{order.user_id}
            </span>
            {order.anonymous && (
              <Badge variant='secondary'>{t('Anonymous')}</Badge>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'money',
      header: t('Amount'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className='tabular-nums'>¥{formatCurrency(row.original.money)}</span>
      ),
    },
    {
      accessorKey: 'message',
      header: t('Message'),
      enableSorting: false,
      cell: ({ row }) => {
        const order = row.original
        if (!order.message) {
          return <span className='text-muted-foreground'>{t('(blank)')}</span>
        }
        return <span className='break-words'>{order.message}</span>
      },
    },
    {
      id: 'action',
      header: () => <div className='text-right'>{t('Action')}</div>,
      enableSorting: false,
      cell: ({ row }) => {
        const order = row.original
        const rejected = order.message_status === 'rejected'
        return (
          <div className='text-right whitespace-nowrap'>
            <Button
              type='button'
              variant={rejected ? 'outline' : 'ghost'}
              size='sm'
              disabled={mutation.isPending || (!rejected && !order.message)}
              onClick={() =>
                mutation.mutate({
                  id: order.id,
                  status: rejected ? 'approved' : 'rejected',
                })
              }
            >
              {rejected ? t('Restore') : t('Take down')}
            </Button>
          </div>
        )
      },
    },
  ]

  const pagination: PaginationState = { pageIndex: page - 1, pageSize: PAGE_SIZE }
  const { table } = useDataTable({
    data: (data?.data?.items ?? []) as unknown as Record<string, unknown>[],
    columns: columns as unknown as ColumnDef<Record<string, unknown>>[],
    pagination,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function' ? updater(pagination) : updater
      setPage(next.pageIndex + 1)
    },
    manualPagination: true,
    totalCount: data?.data?.total ?? 0,
    enableSorting: false,
    enableRowSelection: false,
  })

  return (
    <div className='space-y-4'>
      <StatsLine stats={data?.data?.stats} />

      <form
        className='flex items-center gap-2'
        onSubmit={(event) => {
          event.preventDefault()
          setPage(1)
          setUsername(usernameInput.trim())
        }}
      >
        <Input
          value={usernameInput}
          onChange={(event) => setUsernameInput(event.target.value)}
          placeholder={t('Search by username')}
          className='h-8 max-w-56'
          aria-label={t('Search by username')}
        />
        <Button type='submit' variant='outline' size='sm'>
          <Search className='h-4 w-4' />
          {t('Search')}
        </Button>
        {(username || usernameInput) && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => {
              setUsernameInput('')
              setUsername('')
              setPage(1)
            }}
          >
            {t('Reset')}
          </Button>
        )}
      </form>

      <DataTablePage
        table={table}
        columns={columns as unknown as ColumnDef<Record<string, unknown>>[]}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No support records yet.')}
        emptyDescription={t(
          'Records show up here right after someone completes a payment.'
        )}
        // 这个列表嵌在设置区块里，页脚吸底依赖的是设置页没有的 portal 容器，
        // 所以分页直接渲染在表格下方。
        paginationInFooter={false}
        toolbarProps={null}
        hideMobile
      />
    </div>
  )
}
