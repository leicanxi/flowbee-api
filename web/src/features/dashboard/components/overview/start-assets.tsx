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
// 概览「开始使用」区域：左边一张深色收据卡，右边两张浅色明细卡。
//
// 深色卡表达的是「过去 30 天站里替我承担了多少」：一句收据标题、一个总额、
// 一条按来源切段的进度条，最后用三栏账本解释钱从哪来。右侧两张卡分别承接
// 余额与积分的明细行，把收据上的结论落到可以继续操作的地方（充值、明细、
// 查看免费模型）。
//
// 三栏在窄容器里竖排（容器查询而不是视口断点）：同一张卡在概览页被放在
// 不同宽度的栅格里，按视口断点会出现「桌面很宽、卡却只有 500px」仍强行
// 并排、把数字挤断的情况。
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Sparkles,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { getMySponsorship } from '@/features/sponsorship/api'
import { toIntlLocale } from '@/i18n/languages'
import { getGroupModels } from '@/lib/api'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { computeTimeRange } from '@/lib/time'
import type { AuthUser } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { getOverviewStats, getUserQuotaDates } from '../../api'
import { FreeModelUsageDialog } from './free-model-usage-dialog'
import { WelfarePointsLogsDialog } from './welfare-points-logs-dialog'

/**
 * 金额展示：固定 2 位小数。
 *
 * `formatQuota` 在数值小于 1 时会展开到 4 位小数（那是给流水明细用的精度），
 * 但在「过去 30 天替你承担了多少」这种概括句里，¥0.5985 只会让人读不下去。
 */
function formatMoney(value: number): string {
  return formatQuotaWithCurrency(value, {
    digitsLarge: 2,
    digitsSmall: 2,
    abbreviate: true,
  })
}

/**
 * 参考稿右上角的等高线纹理：纯装饰，右侧更密、向左淡出。
 *
 * 路径在模块加载时算一次，避免每次渲染重新生成 24 条折线。用
 * `vectorEffect='non-scaling-stroke'` 让卡片宽度变化时线宽保持 0.8px，
 * 不会被拉伸成带状。
 */
const CONTOUR_PATHS = Array.from({ length: 24 }, (_, line) => {
  const baseX = 250 + line * 16
  const amplitude = 6 + (line % 6) * 3.4
  const phase = line * 0.42
  const points: string[] = []

  for (let y = -20; y <= 540; y += 14) {
    const drift =
      Math.sin(y / 90 + phase) * amplitude +
      Math.sin(y / 34 + phase * 1.6) * amplitude * 0.35
    points.push(`${Math.round((baseX + drift) * 10) / 10},${y}`)
  }

  return `M${points.join(' L')}`
})

function ContourBackdrop() {
  return (
    <svg
      className='pointer-events-none absolute inset-0 h-full w-full [mask-image:linear-gradient(to_right,transparent,black_40%,black_92%,transparent)] text-white/15'
      viewBox='0 0 620 520'
      preserveAspectRatio='none'
      aria-hidden='true'
    >
      {CONTOUR_PATHS.map((path) => (
        <path
          key={path}
          d={path}
          fill='none'
          stroke='currentColor'
          strokeWidth='0.8'
          vectorEffect='non-scaling-stroke'
        />
      ))}
    </svg>
  )
}

/**
 * 概览卡共用的 30 天汇总查询。
 *
 * 深色卡与右侧两张明细卡都要这份数据；共用同一组 queryKey 让 TanStack
 * Query 只发一次请求、共享一份缓存，不会出现卡头写 ¥5.42、卡内写 ¥5.21
 * 的错位。
 */
function useOverviewStats() {
  return useQuery({
    queryKey: ['dashboard', 'overview', 'stats'],
    queryFn: async () => {
      const result = await getOverviewStats()
      return result.success ? result.data : undefined
    },
    staleTime: 5 * 60 * 1000,
  })
}

/** 当前显示货币的符号（USD / CNY / 自定义）；TOKENS 模式下没有符号。 */
function useCurrencySymbol(): string {
  const currency = useSystemConfigStore((state) => state.config.currency)
  if (currency.quotaDisplayType === 'TOKENS') return ''
  if (currency.quotaDisplayType === 'CUSTOM') {
    return currency.customCurrencySymbol
  }
  if (currency.quotaDisplayType === 'CNY') return '¥'
  return '$'
}

/** 明细行：名称在左、数值在右，中间用点线把视线拉过去。 */
function LeaderRow(props: { label: string; value: string }) {
  return (
    <div className='flex items-baseline gap-2 text-[12px] leading-[1.7]'>
      <span className='text-muted-foreground'>{props.label}</span>
      <span
        className='border-border mb-[0.45em] flex-1 border-b border-dotted'
        aria-hidden='true'
      />
      <span className='font-medium tabular-nums'>{props.value}</span>
    </div>
  )
}

export interface StartAssetsGuideProps {
  guideExpanded: boolean
  setupComplete: boolean
  guideControlsId: string
  guideToggleRef: React.RefObject<HTMLButtonElement | null>
  onToggleGuide: () => void
}

/**
 * 深色收据卡：过去 30 天的总额、来源构成，以及三栏账本。
 *
 * 顶部一行同时承担参考稿的「周期 + 日期区间」和原来的「开始使用 + 快捷开始
 * 开关」：左边是卡片身份，右边是可折叠动作，日期区间夹在中间，窄屏先隐藏
 * 日期区间，保留开关。
 */
export function StartAssetsReceipt(
  props: { user: AuthUser | null } & StartAssetsGuideProps
) {
  const { t, i18n } = useTranslation()
  const overviewQuery = useOverviewStats()
  const currencySymbol = useCurrencySymbol()

  const sponsorshipQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'sponsorship'],
    queryFn: async () => {
      const result = await getMySponsorship()
      return result.data
    },
    staleTime: 5 * 60 * 1000,
  })

  const days = overviewQuery.data?.days ?? 30
  const welfareValue = overviewQuery.data?.welfare_value ?? 0
  const subsidyValue = overviewQuery.data?.subsidy_value ?? 0
  // 两者都是「站里替我付掉的钱」，相加才是真正省下的数。
  const savedTotal = welfareValue + subsidyValue
  const welfareShare = savedTotal > 0 ? (welfareValue / savedTotal) * 100 : 0
  const welfarePercent = Math.round(welfareShare)
  const subsidyPercent = savedTotal > 0 ? 100 - welfarePercent : 0

  const daily = props.user?.welfare_points_daily ?? 0
  const permanent = props.user?.welfare_points_permanent ?? 0
  const pointsTotal = props.user?.welfare_points_total ?? daily + permanent

  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const periodLabel = useMemo(() => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - Math.max(days - 1, 0))
    const formatter = new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
    })
    return `${formatter.format(start)} – ${formatter.format(end)}`
  }, [days, locale])

  return (
    <div className='@container relative flex h-full flex-col overflow-hidden px-5 py-5 sm:px-7 sm:py-6'>
      <ContourBackdrop />

      <div className='relative flex items-center justify-between gap-3'>
        <div className='flex items-center gap-2 text-[10px] font-medium tracking-[0.16em] text-[#f8f4ee]/60 uppercase'>
          <ListChecks className='size-3.5' aria-hidden='true' />
          {t('Get started')}
        </div>
        <div className='flex items-center gap-3'>
          <span className='hidden text-[11px] text-[#f8f4ee]/55 tabular-nums sm:inline'>
            {periodLabel}
          </span>
          <Button
            variant='outline'
            size='sm'
            ref={props.guideToggleRef}
            aria-expanded={props.guideExpanded}
            aria-controls={
              props.guideExpanded ? props.guideControlsId : undefined
            }
            className='h-6 shrink-0 rounded-full border-white/20 bg-white/10 px-2.5 text-[11.5px] font-medium text-[#f8f4ee] hover:bg-white/15'
            onClick={props.onToggleGuide}
          >
            {props.setupComplete ? (
              <Check
                data-icon='inline-start'
                className='text-success'
                aria-hidden='true'
              />
            ) : (
              <Sparkles data-icon='inline-start' aria-hidden='true' />
            )}
            {props.guideExpanded ? t('Hide guide') : t('Quick start')}
            {props.guideExpanded ? (
              <ChevronUp aria-hidden='true' />
            ) : (
              <ChevronDown aria-hidden='true' />
            )}
          </Button>
        </div>
      </div>

      <h3 className='relative mt-3.5 font-serif text-[19px] leading-[1.35] text-balance text-[#f8f4ee] sm:text-[22px]'>
        {t('In the past {{days}} days,', { days })}{' '}
        <b className='font-semibold'>Flowbee</b> {t('saved for you')}
      </h3>

      <div className='relative mt-5 flex items-start gap-1.5'>
        {currencySymbol ? (
          <span className='mt-0.5 font-serif text-[18px] leading-none text-[#f8f4ee]/85 sm:mt-1 sm:text-[24px]'>
            {currencySymbol}
          </span>
        ) : null}
        <p className='font-serif text-[50px] leading-[0.82] font-normal tracking-[-0.03em] whitespace-nowrap text-[#f8f4ee] tabular-nums sm:text-[66px]'>
          {formatQuotaWithCurrency(savedTotal, {
            showSymbol: false,
            compact: false,
            digitsLarge: 2,
            digitsSmall: 2,
          })}
        </p>
      </div>

      <div className='relative mt-7'>
        <div className='flex items-baseline justify-between gap-4 text-[11.5px] text-[#f8f4ee]/60'>
          <span>
            {t('Free allowance')}{' '}
            <b className='font-semibold text-[#f8f4ee]/90 tabular-nums'>
              {welfarePercent}%
            </b>
          </span>
          <span>
            {t('Model subsidy')}{' '}
            <b className='font-semibold text-[#f8f4ee]/90 tabular-nums'>
              {subsidyPercent}%
            </b>
          </span>
        </div>

        <div
          className='mt-2.5 flex h-[9px] w-full gap-[3px] overflow-hidden rounded-[3px] bg-white/10'
          aria-hidden='true'
        >
          {savedTotal > 0 ? (
            <>
              <span
                className='h-full rounded-[2px] bg-[#f3ede4]'
                style={{ width: `${welfareShare}%` }}
              />
              <span className='bg-primary h-full flex-1 rounded-[2px]' />
            </>
          ) : null}
        </div>

        {/* 参考稿的刻度尺：在进度条下方压一排短刻线，弱化“这只是个条”，
         *  读起来更像一张账单。 */}
        <div
          className='relative mt-1.5 h-[7px] w-full text-white/25'
          aria-hidden='true'
        >
          <span className='absolute inset-x-0 top-0 h-px bg-current opacity-40' />
          <span className='absolute inset-x-0 top-0 h-[3px] bg-[repeating-linear-gradient(90deg,currentColor_0_1px,transparent_1px_7px)] opacity-60' />
          <span className='absolute inset-x-0 top-0 h-[6px] bg-[repeating-linear-gradient(90deg,currentColor_0_1px,transparent_1px_35px)] opacity-80' />
        </div>
      </div>

      {/* 三栏在手机上仍保持一行：横排时每栏只剩一个金额，竖排反而把一张
       *  收据拆成三块。窄屏用更小的字号和间距，不切换列数。 */}
      <dl className='relative mt-6 grid grid-cols-3 border-t border-white/10 pt-4'>
        <div className='pr-2 sm:pr-5'>
          <dt className='flex items-center gap-1.5 text-[10px] text-[#f8f4ee]/55 sm:text-[11.5px]'>
            <span
              className='size-[7px] shrink-0 rounded-[2px] bg-[#f3ede4]'
              aria-hidden='true'
            />
            {t('Free allowance')}
          </dt>
          <dd className='mt-2 font-serif text-[18px] leading-none text-[#f8f4ee] tabular-nums sm:text-[24px]'>
            {formatMoney(welfareValue)}
          </dd>
        </div>

        <div className='border-l border-white/10 pl-3 sm:pl-5'>
          <dt className='flex items-center gap-1.5 text-[10px] text-[#f8f4ee]/55 sm:text-[11.5px]'>
            <span
              className='bg-primary size-[7px] shrink-0 rounded-[2px]'
              aria-hidden='true'
            />
            {t('Model subsidy')}
          </dt>
          <dd className='mt-2 font-serif text-[18px] leading-none text-[#f8f4ee] tabular-nums sm:text-[24px]'>
            {formatMoney(subsidyValue)}
          </dd>
        </div>

        <div className='border-l border-white/10 pl-3 sm:pl-5'>
          <dt className='flex items-center gap-1.5 text-[10px] text-[#f8f4ee]/55 sm:text-[11.5px]'>
            <span
              className='size-[7px] shrink-0 rounded-[1px] border border-[#f8f4ee]/50'
              aria-hidden='true'
            />
            {t('Free points')}
          </dt>
          <dd className='mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1'>
            <span className='font-serif text-[18px] leading-none text-[#f8f4ee] tabular-nums sm:text-[24px]'>
              {formatNumber(pointsTotal)}
            </span>
            <span className='text-[10px] text-[#f8f4ee]/55 sm:text-[11.5px]'>
              {t('points')}
            </span>
            <Link
              to='/invite'
              className='ml-0.5 text-[10px] text-[#f8f4ee]/75 underline decoration-[#f8f4ee]/40 underline-offset-4 transition-colors hover:text-[#f8f4ee] sm:text-[11.5px]'
            >
              {t('Earn')}
            </Link>
          </dd>
        </div>
      </dl>

      <div className='relative mt-auto flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-white/10 pt-4 text-[12px] @max-[559px]:mt-5'>
        <Link
          to='/pricing'
          search={
            overviewQuery.data?.welfare_group
              ? { group: overviewQuery.data.welfare_group }
              : undefined
          }
          className='inline-flex items-center gap-0.5 font-medium text-[#f8f4ee] transition-colors hover:underline hover:underline-offset-4'
        >
          {t('View model status')}
          <ArrowUpRight className='size-3' aria-hidden='true' />
        </Link>
        <Link
          to='/feedback'
          className='text-[#f8f4ee]/60 transition-colors hover:text-[#f8f4ee]'
        >
          {t('Report model issue / request a model')}
        </Link>
        <Link
          to='/sponsors'
          className='ml-auto text-[#f8f4ee]/60 transition-colors hover:text-[#f8f4ee] max-[559px]:ml-0'
        >
          <Trans
            t={t}
            i18nKey='Sponsor us · <bold>{{times}}</bold> times this month · <bold>{{supporters}}</bold> people supported'
            values={{
              times: sponsorshipQuery.data?.monthly_support_count ?? 0,
              supporters: sponsorshipQuery.data?.monthly_supporter_count ?? 0,
            }}
            components={{
              bold: <b className='font-semibold text-[#f8f4ee] tabular-nums' />,
            }}
          />
        </Link>
      </div>
    </div>
  )
}

/**
 * 余额卡：金额 + 两条流水口径 + 补贴说明，底部是钱包入口与充值按钮。
 *
 * 不再和积分共用一张卡：参考稿用右侧两张浅色卡承接“结论之后的下一件事”，
 * 余额要的是充值，积分要的是明细，混在一张卡里会让两个主动作互相抢。
 */
export function StartAssetsBalanceCard(props: { user: AuthUser | null }) {
  const { t } = useTranslation()
  const currencySymbol = useCurrencySymbol()
  const overviewQuery = useOverviewStats()

  const giftQuota = overviewQuery.data?.gift_quota ?? 0
  const subsidyDiscount = overviewQuery.data?.subsidy_discount ?? 0
  const totalModelCount = overviewQuery.data?.total_model_count ?? 0
  const balance = props.user?.quota ?? 0

  // 「近 24 小时」用量：直接复用上方「用量概览」卡片的同一个接口与同一个
  // queryKey（hour 粒度、1 天窗口）。共用 queryKey 的好处是两边读同一份缓存，
  // 不会出现「上面 0.8、下面 0.6」这种同一指标两个数的尴尬。
  const lastDayRange = useMemo(() => computeTimeRange(1), [])
  const usageTrendQuery = useQuery({
    queryKey: [
      'dashboard',
      'overview',
      'summary-sparklines',
      lastDayRange.start_timestamp,
      lastDayRange.end_timestamp,
    ],
    queryFn: async () =>
      getUserQuotaDates({
        start_timestamp: lastDayRange.start_timestamp,
        end_timestamp: lastDayRange.end_timestamp,
        default_time: 'hour',
      }),
    staleTime: 60 * 1000,
  })
  const last24hUsage = (usageTrendQuery.data?.data ?? []).reduce(
    (total, item) => total + (Number(item.quota) || 0),
    0
  )

  // 补贴折扣：0.3 → 3 折。后端已经把「没有可用补贴分组」表示成 0。
  const discountText =
    subsidyDiscount > 0 ? Math.round(subsidyDiscount * 100) / 10 : 0

  return (
    <div className='bg-card flex h-full flex-col rounded-2xl border p-5 shadow-xs'>
      <span className='text-[13.5px] leading-none font-medium'>
        {t('Current balance')}
      </span>

      <div className='mt-4 flex items-baseline gap-1'>
        {currencySymbol ? (
          <span className='text-muted-foreground font-serif text-[20px] leading-none'>
            {currencySymbol}
          </span>
        ) : null}
        <span className='font-serif text-[40px] leading-none tracking-[-0.02em] tabular-nums'>
          {formatQuotaWithCurrency(balance, {
            showSymbol: false,
            compact: false,
            digitsLarge: 2,
            digitsSmall: 2,
          })}
        </span>
      </div>

      <div className='mt-4 flex flex-col gap-1'>
        <LeaderRow label={t('Gift')} value={formatMoney(giftQuota)} />
        <LeaderRow label={t('Last 24h')} value={formatMoney(last24hUsage)} />
      </div>

      {discountText > 0 || totalModelCount > 0 ? (
        <p className='text-muted-foreground mt-3 text-[11.5px] leading-[1.5]'>
          {discountText > 0
            ? t('Subsidies down to {{discount}}% of list price', {
                discount: discountText,
              })
            : null}
          {totalModelCount > 0 ? (
            <span className='text-muted-foreground/70'>
              {discountText > 0
                ? t(' · {{count}} models available', {
                    count: totalModelCount,
                  })
                : t('{{count}} models available', {
                    count: totalModelCount,
                  })}
            </span>
          ) : null}
        </p>
      ) : null}

      <div className='mt-auto flex items-center justify-between gap-3 pt-5'>
        <Link
          to='/wallet'
          className='text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-[11.5px] transition-colors'
        >
          {t('Wallet history')}
          <ArrowUpRight className='size-[11px]' aria-hidden='true' />
        </Link>
        <Button
          size='sm'
          className='rounded-full px-4'
          render={<Link to='/wallet' />}
        >
          {t('Top up')}
        </Button>
      </div>
    </div>
  )
}

/**
 * 免费积分卡：总额、每天/长期两个桶、可用模型说明。
 *
 * 外框用虚线，和余额卡的实线区分：积分是“还在长”的资产，不是可以立刻花掉
 * 的余额。数据口径全部沿用原卡：welfare 分组下启用的模型数，不等于“渠道
 * 当前健康”，所以文案只承诺“可用于”，真实状态交给模型广场。
 */
export function StartAssetsPointsCard(props: { user: AuthUser | null }) {
  const { t } = useTranslation()
  const [logsOpen, setLogsOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const overviewQuery = useOverviewStats()

  const welfareGroup = overviewQuery.data?.welfare_group ?? ''
  const daily = props.user?.welfare_points_daily ?? 0
  const permanent = props.user?.welfare_points_permanent ?? 0
  const pointsTotal = props.user?.welfare_points_total ?? daily + permanent

  const freeModelsQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'free-models', welfareGroup],
    queryFn: async () => {
      const result = await getGroupModels(welfareGroup)
      return result.success ? (result.data ?? []) : []
    },
    enabled: Boolean(welfareGroup),
    staleTime: 5 * 60 * 1000,
  })
  const freeModelCount = freeModelsQuery.data?.length ?? 0

  return (
    <div className='bg-card flex h-full flex-col rounded-2xl border border-dashed p-5 shadow-xs'>
      <div className='flex items-center justify-between gap-3'>
        <span className='text-[13.5px] leading-none font-medium'>
          {t('Free points')}
        </span>
        <div className='flex items-center gap-3'>
          {welfareGroup ? (
            <button
              type='button'
              className='text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-0.5 text-[11.5px] transition-colors'
              onClick={() => setUsageOpen(true)}
            >
              {t('Model usage')}
              <ArrowUpRight className='size-[11px]' aria-hidden='true' />
            </button>
          ) : null}
          <button
            type='button'
            className='text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-0.5 text-[11.5px] transition-colors'
            onClick={() => setLogsOpen(true)}
          >
            {t('Points history')}
            <ArrowUpRight className='size-[11px]' aria-hidden='true' />
          </button>
        </div>
      </div>

      <div className='mt-4 flex flex-wrap items-end gap-x-3 gap-y-2'>
        <span className='font-serif text-[34px] leading-none tracking-[-0.02em] tabular-nums'>
          {formatNumber(pointsTotal)}
        </span>
        <span className='text-muted-foreground mb-0.5 text-[11.5px]'>
          {t('points')}
        </span>
        <span className='ml-auto flex flex-wrap gap-1.5'>
          <span className='bg-muted text-muted-foreground rounded-lg px-2 py-1 text-[11px] leading-none tabular-nums'>
            {t('Daily')} {formatNumber(daily)}
          </span>
          <span className='bg-muted text-muted-foreground rounded-lg px-2 py-1 text-[11px] leading-none tabular-nums'>
            {t('Long-term')} {formatNumber(permanent)}
          </span>
        </span>
      </div>

      <div className='mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-3'>
        <span className='text-muted-foreground flex min-w-0 items-center gap-1.5 text-[11.5px] leading-[1.4]'>
          <span
            className={
              freeModelCount > 0
                ? 'bg-success size-[5px] shrink-0 rounded-full'
                : 'bg-foreground/25 size-[5px] shrink-0 rounded-full'
            }
            aria-hidden='true'
          />
          <span className='min-w-0'>
            {t('Usable on {{count}} free models', { count: freeModelCount })}
            <span className='text-muted-foreground/60'>
              {t(', growing steadily')}
            </span>
          </span>
        </span>
        <Link
          to='/pricing'
          search={welfareGroup ? { group: welfareGroup } : undefined}
          className='text-muted-foreground hover:text-foreground ml-auto inline-flex shrink-0 items-center gap-0.5 text-[11.5px] transition-colors'
        >
          {t('See list')}
          <ArrowRight className='size-[11px]' aria-hidden='true' />
        </Link>
      </div>

      <WelfarePointsLogsDialog open={logsOpen} onOpenChange={setLogsOpen} />
      <FreeModelUsageDialog
        open={usageOpen}
        onOpenChange={setUsageOpen}
        group={welfareGroup}
      />
    </div>
  )
}
