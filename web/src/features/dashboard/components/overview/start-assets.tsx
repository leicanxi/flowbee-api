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
// 改造#44：概览「开始使用」左卡按「额度账本」原型稿重做。
//
// 结构：一行收据（过去 N 天站里替我承担了多少）→ 两栏账本（免费积分 / 当前余额）
// → 一行页脚入口。原来「免费积分」和「余额」各占半张卡、各自带一条状态行，
// 读起来是两份互不相干的报表；收据行把它们串成一句「省了多少」的话，两栏只
// 负责解释这句话怎么算出来的。
//
// 排版约束：整张卡是宽度自适应容器，两栏是否并排由容器宽度决定（见
// `start-assets-panes`），不看视口 —— 同一张卡在概览页可能被塞进半宽栅格。
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Gift, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getMySponsorship } from '@/features/sponsorship/api'
import { getGroupModels } from '@/lib/api'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { computeTimeRange } from '@/lib/time'
import type { AuthUser } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { getOverviewStats, getUserQuotaDates } from '../../api'
import { WelfarePointsLogsDialog } from './welfare-points-logs-dialog'

const RULE = 'border-foreground/10'

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

/** 大数字。手写体只用于数字本身，旁边的符号/单位仍是正文字体。 */
const FIGURE_CLASS_NAME =
  'kai-figure text-[42px] leading-[0.9] whitespace-nowrap text-foreground sm:text-[52px]'

/** 底部注解：名称 + 数值，横排成一行（「每天 0」这种）。 */
function Note(props: { label: string; value: string }) {
  return (
    <span className='text-muted-foreground inline-flex items-baseline gap-1 text-[11.5px] leading-[1.3] whitespace-nowrap'>
      {props.label}
      <b className='text-foreground font-semibold tabular-nums'>{props.value}</b>
    </span>
  )
}

function NoteLink(props: {
  label: string
  to?: '/wallet'
  onClick?: () => void
  className?: string
}) {
  const className = [
    'inline-flex items-center gap-0.5 text-[11.5px] text-muted-foreground/80 transition-colors hover:text-foreground',
    props.className ?? '',
  ].join(' ')
  if (props.onClick) {
    return (
      <button type='button' className={className} onClick={props.onClick}>
        {props.label}
        <ArrowUpRight className='size-[11px]' aria-hidden='true' />
      </button>
    )
  }
  return (
    <Link to={props.to ?? '/wallet'} className={className}>
      {props.label}
      <ArrowUpRight className='size-[11px]' aria-hidden='true' />
    </Link>
  )
}

/**
 * 一栏账本：标题 + 右上动作 → 数字（带图标与单位）→ 说明 → 底部横排注解。
 *
 * 注解从数字右侧挪回底部：数字右边留白属于收据行，账本自己只需要一条
 * 从左到右读完的注解行，两栏并排时底边对齐。
 */
function Pane(props: {
  label: string
  actionLabel: string
  actionTo: '/invite' | '/wallet'
  icon?: typeof Gift
  figure: string
  figurePrefix?: string
  figureSuffix?: string
  notes: { label: string; value: string }[]
  noteLinkLabel: string
  noteLinkTo?: '/wallet'
  noteLinkOnClick?: () => void
  cap: React.ReactNode
  className?: string
}) {
  const Icon = props.icon
  return (
    <div
      className={[
        'flex min-w-0 flex-col',
        '@max-[559px]:mt-3.5 @max-[559px]:border-t @max-[559px]:border-solid',
        '@max-[559px]:pt-3.5 @max-[559px]:first:mt-0 @max-[559px]:first:border-t-0',
        '@max-[559px]:first:pt-0',
        props.className ?? '',
      ].join(' ')}
    >
      <div className='flex min-h-[24px] items-center justify-between gap-2.5'>
        <span className='text-foreground text-[13.5px] leading-none font-medium'>
          {props.label}
        </span>
        <Link
          to={props.actionTo}
          className='text-primary inline-flex shrink-0 items-center gap-0.5 text-[13px] font-medium transition-colors hover:underline hover:underline-offset-2'
        >
          <Plus className='size-3' aria-hidden='true' />
          {props.actionLabel}
        </Link>
      </div>

      <div className='mt-4 flex items-end gap-2'>
        {Icon ? (
          <span
            className='bg-foreground/[0.06] mb-1.5 flex size-8 shrink-0 items-center justify-center rounded-full'
            aria-hidden='true'
          >
            <Icon className='text-foreground size-4' strokeWidth={1.6} />
          </span>
        ) : null}
        <span className={FIGURE_CLASS_NAME}>
          {props.figurePrefix ? (
            <span className='mr-0.5 text-[0.52em]'>{props.figurePrefix}</span>
          ) : null}
          {props.figure}
        </span>
        {props.figureSuffix ? (
          <span className='text-muted-foreground mb-1 text-[12px] leading-none'>
            {props.figureSuffix}
          </span>
        ) : null}
      </div>

      <p className='text-muted-foreground mt-3.5 flex flex-wrap items-center gap-1.5 text-[12px] leading-[1.5]'>
        {props.cap}
      </p>

      {/* mt-auto + pt：两栏等高时注解行贴住底边，左右两栏的「明细」入口同一基线 */}
      <div className='mt-auto flex flex-wrap items-baseline gap-x-5 gap-y-1.5 pt-5'>
        {props.notes.map((note) => (
          <Note key={note.label} label={note.label} value={note.value} />
        ))}
        <NoteLink
          className='ml-auto'
          label={props.noteLinkLabel}
          to={props.noteLinkTo}
          onClick={props.noteLinkOnClick}
        />
      </div>
    </div>
  )
}

/**
 * 概览左卡共用的 30 天汇总查询。
 *
 * 收据句在卡片头部、折扣/赠送在卡片内部，两处都要这份数据；共用同一组
 * queryKey 让 TanStack Query 只发一次请求、共享一份缓存，不会出现头部写
 * ¥5.42、卡内写 ¥5.21 的错位。
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
  if (currency.quotaDisplayType === 'CUSTOM') return currency.customCurrencySymbol
  if (currency.quotaDisplayType === 'CNY') return '¥'
  return '$'
}

/** 条形图图例：色块 + 名称 + 金额。色块与左侧堆叠条的分段一一对应。 */
function Legend(props: { dotClassName: string; label: string; value: string }) {
  return (
    <span className='text-muted-foreground inline-flex items-center gap-1.5 text-[11.5px] leading-none whitespace-nowrap'>
      <span
        className={`size-[7px] shrink-0 rounded-[2px] ${props.dotClassName}`}
        aria-hidden='true'
      />
      {props.label}
      <b className='text-foreground text-[11.5px] leading-none font-semibold tabular-nums'>
        {props.value}
      </b>
    </span>
  )
}

/**
 * 卡片头部的主标题：一句「过去 N 天站里替你承担了多少」，下面接着总额与构成。
 *
 * 排版照概览页的编辑风来做：衬线标题句里只把品牌名加粗，金额自己占一行放大，
 * 构成用一条堆叠条 + 图例解释 —— 比原来塞在括号里的一串「（免费 … · 补贴 …）」
 * 更容易一眼看出钱从哪来、各占多少。
 */
export function StartAssetsReceipt() {
  const { t } = useTranslation()
  const overviewQuery = useOverviewStats()
  const currencySymbol = useCurrencySymbol()

  const days = overviewQuery.data?.days ?? 30
  const welfareValue = overviewQuery.data?.welfare_value ?? 0
  const subsidyValue = overviewQuery.data?.subsidy_value ?? 0
  // 两者都是「站里替我付掉的钱」，相加才是真正省下的数。
  const savedTotal = welfareValue + subsidyValue
  // 堆叠条按两者占比切段；总额为 0 时整条留空，不画一段假数据。
  const welfareShare = savedTotal > 0 ? (welfareValue / savedTotal) * 100 : 0

  return (
    <div className='mt-0.5 flex flex-col gap-2.5'>
      <h3 className='font-serif text-[17px] leading-[1.35] text-balance text-foreground sm:text-[19px]'>
        {t('In the past {{days}} days,', { days })}{' '}
        <b className='font-semibold'>Flowbee</b> {t('saved for you')}
      </h3>

      <div className='flex flex-wrap items-end gap-x-5 gap-y-2.5'>
        {/* 比账本里的积分/余额小一档：这里是概述句的落点，不该和下面的明细数字抢视线 */}
        <p className='font-serif text-[34px] leading-[0.85] font-medium tracking-[-0.02em] whitespace-nowrap text-foreground tabular-nums sm:text-[40px]'>
          {currencySymbol ? (
            <span className='mr-0.5 text-[0.5em] font-normal'>
              {currencySymbol}
            </span>
          ) : null}
          {formatQuotaWithCurrency(savedTotal, {
            showSymbol: false,
            compact: false,
            digitsLarge: 2,
            digitsSmall: 2,
          })}
        </p>

        {/* 固定宽度而不是 flex-1：铺满会把条形拉到卡片另一头，标题句、金额、
         *  条形就散成三段；收窄后三者贴在一起读成一个整体。 */}
        <div className='w-[190px] shrink-0 pb-[5px] sm:w-[220px]'>
          <div
            className='bg-foreground/10 flex h-[6px] w-full overflow-hidden rounded-full'
            aria-hidden='true'
          >
            <span
              className='bg-primary h-full'
              style={{ width: `${welfareShare}%` }}
            />
            {/* 两段之间留一道卡片底色的细缝，深浅橙不相连 */}
            <span className='bg-primary/35 h-full flex-1 border-l-2 border-solid border-card' />
          </div>
          <div className='mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1.5'>
            <Legend
              dotClassName='bg-primary'
              label={t('Free allowance')}
              value={formatMoney(welfareValue)}
            />
            <Legend
              dotClassName='bg-primary/35'
              label={t('Model subsidy')}
              value={formatMoney(subsidyValue)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function StartAssets(props: {
  user: AuthUser | null
  models: string[]
}) {
  const { t } = useTranslation()
  const [logsOpen, setLogsOpen] = useState(false)
  // 大数字把货币符号单独拆出来，好让它也走手写体；符号本身仍从当前显示
  // 配置里取（USD / CNY / 自定义），不在前端写死。
  const currencySymbol = useCurrencySymbol()

  const overviewQuery = useOverviewStats()

  const welfareGroup = overviewQuery.data?.welfare_group ?? ''
  const giftQuota = overviewQuery.data?.gift_quota ?? 0
  const subsidyDiscount = overviewQuery.data?.subsidy_discount ?? 0
  const totalModelCount = overviewQuery.data?.total_model_count ?? 0

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

  // 这个数 = 福利分组下「启用」的模型数（abilities 口径：渠道愿意在该分组
  // 服务这个模型）。它不看渠道是否被停用、key 是否失效，所以文案不承诺
  // 「可用」——只说「可用于」，真实状态点页脚入口去看。
  const freeModelsQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'free-models', welfareGroup],
    queryFn: async () => {
      const result = await getGroupModels(welfareGroup)
      return result.success ? (result.data ?? []) : []
    },
    enabled: Boolean(welfareGroup),
    staleTime: 5 * 60 * 1000,
  })

  const sponsorshipQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'sponsorship'],
    queryFn: async () => {
      const result = await getMySponsorship()
      return result.data
    },
    staleTime: 5 * 60 * 1000,
  })

  const daily = props.user?.welfare_points_daily ?? 0
  const permanent = props.user?.welfare_points_permanent ?? 0
  const pointsTotal = props.user?.welfare_points_total ?? daily + permanent
  const balance = props.user?.quota ?? 0
  const supportCount = sponsorshipQuery.data?.support_count ?? 0
  const freeModelCount = freeModelsQuery.data?.length ?? 0

  // 收据行的总额 = 免费分组折算价值 + 补贴差额。两者都是「站里替我付掉的钱」，
  // 相加才是用户真正省下的数，拆开只是告诉他钱从哪儿来。
  // 补贴折扣：0.3 → 3 折。后端已经把「没有可用补贴分组」表示成 0。
  const discountText =
    subsidyDiscount > 0 ? Math.round(subsidyDiscount * 100) / 10 : 0

  return (
    <div className='@container flex h-full min-w-0 flex-col'>
      {/* flex-1 + content-center：左卡被右卡撑高时，两栏账本在剩余空间里垂直
       *  居中，页脚贴住底边 —— 否则内容全挤在上半截、卡片底部空一大截。 */}
      <div className='start-assets-panes flex-1 content-center'>
        <Pane
          label={t('Free points')}
          actionLabel={t('Earn')}
          actionTo='/invite'
          icon={Gift}
          figure={pointsTotal.toLocaleString()}
          figureSuffix={t('points')}
          notes={[
            { label: t('Daily'), value: daily.toLocaleString() },
            { label: t('Long-term'), value: permanent.toLocaleString() },
          ]}
          noteLinkLabel={t('Points history')}
          noteLinkOnClick={() => setLogsOpen(true)}
          cap={
            <>
              <span
                className={
                  freeModelCount > 0
                    ? 'bg-success size-[5px] shrink-0 rounded-full'
                    : 'bg-foreground/25 size-[5px] shrink-0 rounded-full'
                }
                aria-hidden='true'
              />
              <span className='min-w-0'>
                {t('Usable on {{count}} free models', {
                  count: freeModelCount,
                })}
                <span className='text-muted-foreground/60'>
                  {t(', growing steadily')}
                </span>
              </span>
              <Link
                to='/pricing'
                search={welfareGroup ? { group: welfareGroup } : undefined}
                className='text-muted-foreground/70 hover:text-foreground ml-0.5 underline decoration-dotted underline-offset-2 transition-colors'
              >
                {t('See list')}
              </Link>
            </>
          }
          className='@min-[560px]:pr-6'
        />

        <Pane
          label={t('Current balance')}
          actionLabel={t('Top up')}
          actionTo='/wallet'
          figure={formatQuotaWithCurrency(balance, {
            showSymbol: false,
            compact: false,
            digitsLarge: 2,
            digitsSmall: 2,
          })}
          figurePrefix={currencySymbol}
          notes={[
            { label: t('Gift'), value: formatMoney(giftQuota) },
            { label: t('Last 24h'), value: formatMoney(last24hUsage) },
          ]}
          noteLinkLabel={t('Wallet history')}
          noteLinkTo='/wallet'
          cap={
            <span className='min-w-0'>
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
            </span>
          }
          className='@min-[560px]:border-l @min-[560px]:border-solid @min-[560px]:pl-6'
        />
      </div>

      {/* 页脚：三个入口。模型状态在左侧强调色里，是这一屏最常用的动作。 */}
      <div
        className={`mt-5 flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-solid ${RULE} pt-3.5 text-[13px] max-[559px]:mt-4`}
      >
        <Link
          to='/pricing'
          search={welfareGroup ? { group: welfareGroup } : undefined}
          className='text-primary inline-flex items-center gap-0.5 font-medium transition-colors hover:underline hover:underline-offset-2'
        >
          {t('View model status')}
          <ArrowUpRight className='size-3' aria-hidden='true' />
        </Link>
        <Link
          to='/feedback'
          className='text-muted-foreground hover:text-foreground transition-colors'
        >
          {t('Report model issue / request a model')}
        </Link>
        <Link
          to='/sponsors'
          className='text-muted-foreground hover:text-foreground ml-auto transition-colors max-[559px]:ml-0'
        >
          {t('Sponsor us')}
          {' · '}
          <b className='text-foreground font-semibold tabular-nums'>
            {supportCount}
          </b>{' '}
          {t('times')}
        </Link>
      </div>

      <WelfarePointsLogsDialog open={logsOpen} onOpenChange={setLogsOpen} />
    </div>
  )
}
