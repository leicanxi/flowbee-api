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
import { Link } from '@tanstack/react-router'
import { BarChart3 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getPerfMetricsSummary } from '@/features/performance-metrics/api'
import {
  getSuccessRateDotClass,
  getSuccessRateLevel,
  type SuccessRateLevel,
} from '@/features/performance-metrics/lib/format'
import { getGroupModels } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { getWelfareModelUsage, type WelfareModelUsageItem } from '../../api'

const PERF_FILTER_LIMIT = 50

// 稳定的空数组引用：查询还没回来时不能每次渲染都新建 []，否则依赖它的
// useMemo 会一直重算。
const EMPTY_USAGE: WelfareModelUsageItem[] = []
const EMPTY_FREE_MODELS: string[] = []

/** 成功率等级 → 弹窗里的两字状态。只保留用户能据此做选择的三档。 */
function statusLabelKey(level: SuccessRateLevel): string {
  if (level === 'excellent' || level === 'good') return 'Stable'
  if (level === 'warning') return 'Fluctuating'
  if (level === 'critical') return 'Unstable'
  return 'No data'
}

function StatusDot(props: { rate: number; className?: string }) {
  return (
    <span
      className={cn(
        'size-[6px] shrink-0 rounded-full',
        getSuccessRateDotClass(props.rate),
        props.className ?? ''
      )}
      aria-hidden='true'
    />
  )
}

function StatusLegend(props: { rate: number; label: string }) {
  return (
    <span className='inline-flex items-center gap-1.5'>
      <StatusDot rate={props.rate} className='size-[5px]' />
      {props.label}
    </span>
  )
}

/**
 * 一条模型消耗：模型名 + 状态，下面一条相对消耗条。
 *
 * 条形只表达「相对谁更多」，不显示任何数字：福利积分的实际消耗是
 * 请求次数 × 单次积分价，展示绝对值容易和多档定价、赠送积分对不上。
 */
function UsageRow(props: {
  item: WelfareModelUsageItem
  percent: number
  status: { rate: number; label: string } | null
  statusPending: boolean
}) {
  let statusNode: ReactNode = null
  if (props.statusPending) {
    statusNode = <Skeleton className='h-3 w-12 shrink-0' />
  } else if (props.status) {
    statusNode = (
      <span className='text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-[11px]'>
        <StatusDot rate={props.status.rate} />
        {props.status.label}
      </span>
    )
  }

  return (
    <li className='py-3.5'>
      <div className='flex items-center justify-between gap-3'>
        <span
          className='truncate font-mono text-[13px] font-medium'
          title={props.item.model_name}
        >
          {props.item.model_name}
        </span>
        {statusNode}
      </div>
      <div
        className={cn(
          'mt-2 flex h-[7px] w-full',
          props.percent > 0 && props.percent < 100 && 'gap-[3px]'
        )}
        aria-hidden='true'
      >
        <span
          data-usage-bar
          className='bg-primary h-full rounded-[2px] transition-[width] duration-300'
          style={{ width: `${props.percent}%` }}
        />
        {props.percent < 100 ? (
          <span className='bg-muted h-full flex-1 rounded-[2px]' />
        ) : null}
      </div>
    </li>
  )
}

function UsageSkeleton() {
  return (
    <div className='flex flex-col gap-4 py-2'>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className='flex flex-col gap-2'>
          <div className='flex items-center justify-between gap-3'>
            <Skeleton className='h-3.5 w-32' />
            <Skeleton className='h-3 w-12' />
          </div>
          <Skeleton className='h-[7px] w-full rounded-full' />
        </div>
      ))}
    </div>
  )
}

/**
 * 免费模型消耗弹窗。
 *
 * 入口在免费积分卡头部。数据分成两段：quota_data 里按模型聚合的次数换算成
 * 积分消耗（后端算好），再用性能接口给每个模型补一个近 24 小时状态。
 * 没有用过的免费模型不画空条，收进底部小圆点列表，避免一屏全是空进度条。
 */
export function FreeModelUsageDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: string
}) {
  const { t } = useTranslation()
  const [sortBy, setSortBy] = useState<'usage' | 'availability'>('usage')

  const usageQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'welfare-model-usage', props.group],
    queryFn: async () => {
      const result = await getWelfareModelUsage()
      return result.success ? result.data : undefined
    },
    enabled: props.open && Boolean(props.group),
    staleTime: 5 * 60 * 1000,
  })

  // 与免费积分卡共用同一个 queryKey，打开弹窗不会重复拉模型列表。
  const freeModelsQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'free-models', props.group],
    queryFn: async () => {
      const result = await getGroupModels(props.group)
      return result.success ? (result.data ?? []) : []
    },
    enabled: props.open && Boolean(props.group),
    staleTime: 5 * 60 * 1000,
  })

  const usage = usageQuery.data?.models ?? EMPTY_USAGE
  const dataAvailable = usageQuery.data?.data_available ?? true
  const freeModels = freeModelsQuery.data ?? EMPTY_FREE_MODELS

  const modelNames = useMemo(() => {
    const names = new Set<string>()
    for (const item of usage) {
      if (item.model_name) names.add(item.model_name)
    }
    for (const name of freeModels) {
      if (name) names.add(name)
    }
    return [...names].sort()
  }, [freeModels, usage])

  // 性能接口最多接受 50 个 recent_model；免费模型超过这个数时退化成
  // 「全站摘要」，不能把请求参数截断成一堆缺状态的模型。
  const perfModels =
    modelNames.length > 0 && modelNames.length <= PERF_FILTER_LIMIT
      ? modelNames
      : undefined

  const perfQuery = useQuery({
    queryKey: ['perf-metrics-summary', 24, perfModels ?? 'all'],
    queryFn: async () =>
      requireServerSuccess(await getPerfMetricsSummary(24, perfModels)),
    enabled: props.open && modelNames.length > 0,
    staleTime: 60 * 1000,
    retry: false,
  })

  const perfByModel = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of perfQuery.data?.data?.models ?? []) {
      map.set(item.model_name, item.success_rate)
    }
    return map
  }, [perfQuery.data])

  const statusFor = (modelName: string) => {
    if (perfQuery.isError) return null
    const rate = perfByModel.get(modelName) ?? Number.NaN
    return { rate, label: t(statusLabelKey(getSuccessRateLevel(rate))) }
  }
  const statusPending =
    perfQuery.isPending && modelNames.length > 0 && !perfQuery.isError

  // 积分功能关闭时后端会返回 0；这时退回请求次数，至少让“谁用得多”仍然可读。
  const rows = useMemo(() => {
    const usePoints = usage.some((item) => item.points_spent > 0)
    const weightOf = (item: WelfareModelUsageItem) =>
      usePoints ? item.points_spent : item.request_count
    // 可用性排序：稳定 → 波动 → 异常 → 暂无数据；同一档里仍然按消耗从高到低。
    const availabilityRank = (modelName: string) => {
      const level = getSuccessRateLevel(
        perfByModel.get(modelName) ?? Number.NaN
      )
      if (level === 'excellent' || level === 'good') return 0
      if (level === 'warning') return 1
      if (level === 'critical') return 2
      return 3
    }
    const sorted = [...usage].sort((a, b) => {
      if (sortBy === 'availability') {
        const rank =
          availabilityRank(a.model_name) - availabilityRank(b.model_name)
        if (rank !== 0) return rank
      }
      return (
        weightOf(b) - weightOf(a) || a.model_name.localeCompare(b.model_name)
      )
    })
    const maxWeight = sorted.reduce(
      (max, item) => Math.max(max, weightOf(item)),
      0
    )
    return sorted.map((item) => {
      const weight = weightOf(item)
      // 非零用量至少给 4%：消耗最小的模型也要能看见，不能全挤成 0 宽。
      const percent =
        maxWeight > 0 && weight > 0
          ? Math.max(4, Math.round((weight / maxWeight) * 100))
          : 0
      return { item, percent }
    })
  }, [perfByModel, sortBy, usage])

  const usedNames = useMemo(
    () => new Set(usage.map((item) => item.model_name)),
    [usage]
  )
  const unusedModels = freeModels.filter((name) => !usedNames.has(name))

  const showEmpty =
    !usageQuery.isPending &&
    !usageQuery.isError &&
    usage.length === 0 &&
    freeModels.length === 0

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('Free model usage')}</DialogTitle>
          <DialogDescription>
            {t(
              'Points consumed by each free call and the status of free-group models.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='flex items-center justify-between gap-3'>
          <span className='text-muted-foreground text-[11px]'>
            {t('Sort by')}
          </span>
          <ToggleGroup
            value={[sortBy]}
            onValueChange={(value) => {
              const next = value.find((item) => item !== sortBy)
              if (next === 'usage' || next === 'availability') {
                setSortBy(next)
              }
            }}
            aria-label={t('Sort by')}
            variant='outline'
            size='sm'
          >
            <ToggleGroupItem value='usage'>{t('Consumption')}</ToggleGroupItem>
            <ToggleGroupItem value='availability'>
              {t('Availability')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className='max-h-[22rem] overflow-y-auto pr-1'>
          {usageQuery.isPending ? <UsageSkeleton /> : null}

          {!usageQuery.isPending && usageQuery.isError ? (
            <div className='flex flex-col items-center gap-3 py-8 text-center'>
              <p className='text-muted-foreground text-sm'>
                {t('Failed to load')}
              </p>
              <Button
                variant='outline'
                size='sm'
                onClick={() => void usageQuery.refetch()}
              >
                {t('Retry')}
              </Button>
            </div>
          ) : null}

          {showEmpty ? (
            <EmptyState
              icon={BarChart3}
              className='min-h-[12rem]'
              title={t('No free models available')}
              description={t(
                'Free models will appear here once the site enables them.'
              )}
            />
          ) : null}

          {!usageQuery.isPending && !usageQuery.isError && !showEmpty ? (
            <>
              {!dataAvailable ? (
                <p className='text-muted-foreground border-border mb-2 rounded-lg border border-dashed px-3 py-2 text-[11.5px] leading-[1.5]'>
                  {t('Usage statistics are unavailable.')}
                </p>
              ) : null}

              {rows.length > 0 ? (
                <ul className='divide-border divide-y'>
                  {rows.map((row) => (
                    <UsageRow
                      key={row.item.model_name}
                      item={row.item}
                      percent={row.percent}
                      status={statusFor(row.item.model_name)}
                      statusPending={statusPending}
                    />
                  ))}
                </ul>
              ) : null}
              {rows.length === 0 && dataAvailable ? (
                <p className='text-muted-foreground py-4 text-sm'>
                  {t('No usage yet')}
                </p>
              ) : null}

              {unusedModels.length > 0 ? (
                <div
                  className={
                    rows.length > 0
                      ? 'border-border mt-3 border-t pt-3'
                      : 'mt-3'
                  }
                >
                  <p className='text-muted-foreground mb-2 text-[11px] font-medium'>
                    {dataAvailable ? t('Not used yet') : t('Free models')}
                  </p>
                  <ul className='flex flex-wrap gap-1.5'>
                    {unusedModels.map((name) => {
                      const status = statusFor(name)
                      return (
                        <li
                          key={name}
                          title={status?.label}
                          className='bg-muted/70 text-muted-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]'
                        >
                          {status ? <StatusDot rate={status.rate} /> : null}
                          <span className='font-mono'>{name}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className='border-border border-t pt-3'>
          <div className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]'>
            <StatusLegend rate={100} label={t('Stable')} />
            <StatusLegend rate={80} label={t('Fluctuating')} />
            <StatusLegend rate={50} label={t('Unstable')} />
            <span className='ml-auto'>
              {t('Status reflects the success rate over the last 24 hours.')}
            </span>
          </div>
          <p className='text-muted-foreground mt-2 text-[11.5px] leading-[1.5]'>
            <Trans
              t={t}
              i18nKey='Pick a model based on its status, or <link>report a model issue</link>.'
              components={{
                link: (
                  <Link
                    to='/feedback'
                    className='text-foreground underline decoration-dotted underline-offset-2'
                  />
                ),
              }}
            />
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
