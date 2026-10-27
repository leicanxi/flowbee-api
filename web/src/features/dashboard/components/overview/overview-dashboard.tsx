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
import {
  ArrowRight,
  ArrowUpRight,
  // Circle, // 引导步骤列表与旧请求卡片的动效一起停用，保留待后续 UI 参考
  Copy,
  CreditCard,
  KeyRound,
  Link2,
  Sparkles,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react'
// import { motion, useReducedMotion } from 'motion/react'
import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  CardStaggerContainer,
  CardStaggerItem,
} from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { createApiKey, fetchTokenKey, getApiKeys } from '@/features/keys/api'
import type {
  ApiKey,
  ApiKeyFormData,
  CreatedApiKey,
} from '@/features/keys/types'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { getUserModels } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
// import { MOTION_TRANSITION } from '@/lib/motion'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  useApiInfo,
  useDashboardContentVisibility,
} from '../../hooks/use-status-data'
import { AnnouncementsPanel } from './announcements-panel'
import { ApiInfoPanel } from './api-info-panel'
import { FAQPanel } from './faq-panel'
import { PerformanceHealthPanel } from './performance-health-panel'
import {
  StartAssetsBalanceCard,
  StartAssetsPointsCard,
  StartAssetsReceipt,
} from './start-assets'
import { SummaryCards } from './summary-cards'
import { UptimePanel } from './uptime-panel'

const SETUP_GUIDE_VISIBILITY_STORAGE_KEY =
  'dashboard_overview_setup_guide_expanded'

type DashboardActionPath =
  | '/keys'
  | '/wallet'
  | '/playground'
  | '/channels'
  | '/usage-logs'
  | '/pricing'

interface StartStep {
  title: string
  description: string
  to: DashboardActionPath
  icon: LucideIcon
  completed: boolean
}

interface RequestExample {
  endpoint: string
  model: string
  keyId?: number
  displayKey: string
  plainKey?: string
  ready: boolean
}

interface OverviewApiKeys {
  items: ApiKey[]
  issuedKey: CreatedApiKey | null
}

function getSavedSetupGuideExpanded(): boolean | null {
  if (typeof window === 'undefined') return null
  const saved = window.localStorage.getItem(SETUP_GUIDE_VISIBILITY_STORAGE_KEY)
  if (saved === 'expanded') return true
  if (saved === 'collapsed') return false
  return null
}

function saveSetupGuideExpanded(expanded: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    SETUP_GUIDE_VISIBILITY_STORAGE_KEY,
    expanded ? 'expanded' : 'collapsed'
  )
}

function getCurrentOrigin(): string {
  if (typeof window === 'undefined') return ''
  return window.location.origin
}

function normalizeEndpoint(sourceUrl?: string): string {
  const fallback = `${getCurrentOrigin()}/v1/chat/completions`
  const trimmed = sourceUrl?.trim()
  if (!trimmed) return fallback

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '')
  if (withoutTrailingSlash.endsWith('/v1/chat/completions')) {
    return withoutTrailingSlash
  }
  if (withoutTrailingSlash.endsWith('/v1')) {
    return `${withoutTrailingSlash}/chat/completions`
  }
  return `${withoutTrailingSlash}/v1/chat/completions`
}

function getPreferredKey(keys: ApiKey[]): ApiKey | null {
  return keys.find((item) => item.status === 1) ?? keys[0] ?? null
}

function formatDisplayKey(key?: string): string {
  if (!key) return 'sk-...'
  if (key.length <= 14) return key
  return `${key.slice(0, 7)}...${key.slice(-4)}`
}

// 默认密钥固定建在 auto 分组。group 传空串时后端会当成「就用用户自己的分组」
// （middleware/auth.go 里 token 分组为空就回落到用户分组），新人多半落在 default 分组，
// 等于一上来就被限死在一条路上；auto 是「免费优先＞3折站补＞其他」，开箱即用。
// cross_group_retry 只对 auto 分组生效，这里跟后台 DefaultUseAutoGroup 的口径保持一致。
function buildDefaultKeyPayload(name: string): ApiKeyFormData {
  return {
    name,
    remain_quota: 0,
    expired_time: -1,
    unlimited_quota: true,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    group: 'auto',
    auto_groups: [],
    cross_group_retry: true,
    // 与密钥表单的默认值一致：允许客户端查询用户剩余额度。
    allow_user_quota_query: true,
  }
}

/*
 * 引导步骤列表（左侧带序号的 1/2/3 列表）暂时停用，保留实现待后续 UI 参考。
 * 恢复时把下方 StartStepItem 与 lucide 的 Circle 一起解注释，并放回
 * <SetupStepCards /> 旁边（当时放在左侧栏标题下方）：
 *
 *   <ol className='bg-background/45 rounded-2xl border p-2 backdrop-blur'>
 *     {startSteps.map((step, index) => (
 *       <StartStepItem
 *         key={step.title}
 *         step={step}
 *         index={index}
 *         isLast={index === startSteps.length - 1}
 *       />
 *     ))}
 *   </ol>
 *
function StartStepItem(props: {
  step: StartStep
  index: number
  isLast: boolean
}) {
  const Icon = props.step.icon
  const StatusIcon = props.step.completed ? Check : Circle

  return (
    <li className='relative flex gap-3 pb-2.5 last:pb-0'>
      {!props.isLast && (
        <span
          className='bg-border absolute top-9 bottom-0 left-4 w-px'
          aria-hidden='true'
        />
      )}
      <span
        className={cn(
          'bg-background relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg border shadow-xs',
          props.step.completed && 'border-success/30 bg-success/10'
        )}
      >
        <StatusIcon
          className={props.step.completed ? 'text-success size-4' : 'size-4'}
          aria-hidden='true'
        />
      </span>

      <Link
        to={props.step.to}
        className='bg-background/70 hover:bg-muted/50 focus-visible:ring-ring flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left shadow-xs transition-colors outline-none focus-visible:ring-2'
      >
        <span className='flex min-w-0 items-start gap-2.5'>
          <span className='bg-muted mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg'>
            <Icon className='size-3.5' aria-hidden='true' />
          </span>
          <span className='flex min-w-0 flex-col gap-0.5'>
            <span className='flex items-center gap-2 text-sm font-medium'>
              <span className='text-muted-foreground font-mono text-xs tabular-nums'>
                {props.index + 1}.
              </span>
              <span className='truncate'>{props.step.title}</span>
            </span>
            <span className='text-muted-foreground line-clamp-1 text-xs'>
              {props.step.description}
            </span>
          </span>
        </span>
        <ArrowRight
          className='text-muted-foreground size-4 shrink-0'
          aria-hidden='true'
        />
      </Link>
    </li>
  )
}
*/

interface SetupStepCard {
  step: number
  title: string
  description: string
  icon: LucideIcon
  tone: IconBadgeTone
  /** 可选步骤：标题后面跟一枚极轻的「可选」。不写成徽标框，怕抢走标题注意力。 */
  optional?: boolean
}

const CONNECTION_INFO_STEP_CARD: SetupStepCard = {
  step: 1,
  title: 'Connection info',
  description: 'Key and endpoint, paste into your client',
  icon: Link2,
  tone: 'primary',
}

const CREDITS_STEP_CARD: SetupStepCard = {
  step: 2,
  title: 'Add credits',
  description:
    'More models with the Flowbee subsidy, from 30% of the official price',
  icon: CreditCard,
  tone: 'chart-4',
  optional: true,
}

const CONNECT_STEP_CARD: SetupStepCard = {
  step: 3,
  title: 'Connect your software',
  description: 'See setup guides for popular apps',
  icon: TerminalSquare,
  tone: 'info',
}

const CARD_SURFACE_CLASS_NAME =
  'bg-background/70 rounded-xl border px-3 py-2.5 shadow-xs'

const CARD_LINK_CLASS_NAME = cn(
  CARD_SURFACE_CLASS_NAME,
  'hover:bg-muted/60 flex items-center justify-between gap-3 transition-colors'
)

const PANEL_CLASS_NAME = 'bg-foreground/[0.035] rounded-xl p-3'

// 排版与原来那版带序号的引导列表保持一致：图标在左侧跨两行，标题行带序号，
// 说明压到标题正下方一行；标题行右侧可以挂一个附加入口。
function StepCardBody(props: SetupStepCard & { action?: ReactNode }) {
  const { t } = useTranslation()
  const Icon = props.icon

  return (
    <span className='flex min-w-0 items-start gap-2.5'>
      <IconBadge tone={props.tone} size='sm' className='mt-0.5 rounded-lg'>
        <Icon />
      </IconBadge>
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='flex min-w-0 items-center gap-2'>
          <span className='text-muted-foreground font-mono text-xs tabular-nums'>
            {props.step}.
          </span>
          <span className='truncate text-sm font-medium'>{t(props.title)}</span>
          {props.optional ? (
            <span className='text-muted-foreground bg-muted/60 shrink-0 rounded px-1.5 py-px text-[10px] leading-4'>
              {t('Optional')}
            </span>
          ) : null}
          {props.action && (
            <span className='ml-auto shrink-0'>{props.action}</span>
          )}
        </span>
        <span className='text-muted-foreground line-clamp-1 text-xs'>
          {t(props.description)}
        </span>
      </span>
    </span>
  )
}

const CONNECTION_SLIDES = ['key', 'endpoint'] as const

// 「API 端点」一格给的是 base URL（…/v1），不是 …/v1/chat/completions：
// 客户端配置里那一栏要的正是 base URL，给全路径反而要用户自己往回删。
function toBaseEndpoint(endpoint: string): string {
  const suffix = '/chat/completions'
  const trimmed = endpoint.replace(/\/+$/, '')
  if (trimmed.endsWith(suffix)) {
    return trimmed.slice(0, -suffix.length)
  }
  return trimmed
}

// 改造#42：第 1 步从「只有密钥」变成「密钥 / 端点」两端轮播。端点填错是新人
// 最常见的失败，把它和密钥并排放，比让用户去文档里找要省一次来回。
function ConnectionInfoPanel(props: { example: RequestExample }) {
  const { t } = useTranslation()
  const { example } = props
  const [slideIndex, setSlideIndex] = useState(0)
  const [copying, setCopying] = useState(false)
  const { copyToClipboard } = useCopyToClipboard({ notify: false })

  const slide = CONNECTION_SLIDES[slideIndex]
  const endpointValue = toBaseEndpoint(example.endpoint)
  const keyValue = example.plainKey
    ? `sk-${example.plainKey}`
    : example.displayKey
  const currentValue = slide === 'key' ? keyValue : endpointValue
  const slideLabels: Record<(typeof CONNECTION_SLIDES)[number], string> = {
    key: t('API key'),
    endpoint: t('API endpoint'),
  }

  const copy = async () => {
    if (copying) {
      return
    }
    setCopying(true)
    try {
      let text = currentValue
      if (slide === 'key') {
        let plainKey = example.plainKey ?? ''
        let resolveError = ''
        if (!plainKey && example.keyId) {
          const result = await fetchTokenKey(example.keyId)
          plainKey = result.success ? (result.data?.key ?? '') : ''
          resolveError = result.message ?? ''
        }
        if (!plainKey) {
          toast.error(resolveError || t('Failed to copy to clipboard'))
          return
        }
        text = `sk-${plainKey}`
      }
      if (await copyToClipboard(text)) {
        toast.success(t('Copied to clipboard'))
      } else {
        toast.error(t('Failed to copy to clipboard'))
      }
    } catch (error) {
      handleServerError(error, t('Failed to copy to clipboard'))
    } finally {
      setCopying(false)
    }
  }

  const copyable = slide === 'endpoint' || example.ready

  return (
    <div className={cn(PANEL_CLASS_NAME, 'font-mono text-xs')}>
      <div className='mb-2 flex items-center gap-1.5'>
        <span
          className='bg-destructive size-2 rounded-full'
          aria-hidden='true'
        />
        <span className='bg-warning size-2 rounded-full' aria-hidden='true' />
        <span className='bg-success size-2 rounded-full' aria-hidden='true' />
        <span className='text-muted-foreground ml-0.5 font-sans text-[10.5px]'>
          {slideLabels[slide]}
        </span>
        <span
          className='ml-auto flex items-center gap-1'
          role='group'
          aria-label={t('Connection info')}
        >
          {CONNECTION_SLIDES.map((item, index) => (
            <button
              key={item}
              type='button'
              aria-label={slideLabels[item]}
              aria-current={index === slideIndex}
              className={cn(
                'h-[3px] rounded-full transition-all',
                index === slideIndex
                  ? 'bg-primary/70 w-5'
                  : 'bg-foreground/15 hover:bg-foreground/30 w-3.5'
              )}
              onClick={() => setSlideIndex(index)}
            />
          ))}
        </span>
      </div>
      <div className='flex items-center justify-between gap-2'>
        <code className='truncate' title={currentValue}>
          {currentValue}
        </code>
        {copyable ? (
          <Button
            variant='ghost'
            size='xs'
            disabled={copying}
            onClick={copy}
            aria-label={t('Copy')}
          >
            <Copy data-icon='inline-start' />
            {t('Copy')}
          </Button>
        ) : (
          <Button variant='outline' size='xs' render={<Link to='/keys' />}>
            {t('Create API Key')}
          </Button>
        )}
      </div>
    </div>
  )
}

function SetupStepCards(props: { example: RequestExample }) {
  const { t } = useTranslation()
  const { example } = props

  // 纵向拉满并用 justify-between 分配间距：卡片行数不变，多出来的高度进到间隙里，
  // 于是列表底部自然贴在整列底部，以后加减步骤都不用改这里。
  return (
    <ol className='bg-background/45 flex flex-1 flex-col justify-between gap-2 rounded-2xl border p-2 backdrop-blur'>
      {/* 改造#18：三步套回原来那个列表底色，连接信息并进第 1 步卡片里 */}
      <li className={cn(CARD_SURFACE_CLASS_NAME, 'flex flex-col gap-2.5')}>
        <StepCardBody
          {...CONNECTION_INFO_STEP_CARD}
          action={
            <Link
              to='/keys'
              className='text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-medium transition-colors'
            >
              {t('Or create one manually')}
              <ArrowRight className='size-3' aria-hidden='true' />
            </Link>
          }
        />
        <ConnectionInfoPanel example={example} />
      </li>

      <li>
        <Link to='/wallet' className={CARD_LINK_CLASS_NAME}>
          <StepCardBody {...CREDITS_STEP_CARD} />
          <ArrowRight
            className='text-muted-foreground size-4 shrink-0'
            aria-hidden='true'
          />
        </Link>
      </li>

      <li>
        <a
          // 改造#20：接入步骤直接跳到接入文档的具体页面，不再落到文档站首页
          href='https://docs.flowbee.top/flowbee/access.html'
          target='_blank'
          rel='noreferrer'
          className={CARD_LINK_CLASS_NAME}
        >
          <StepCardBody {...CONNECT_STEP_CARD} />
          <ArrowUpRight
            className='text-muted-foreground size-4 shrink-0'
            aria-hidden='true'
          />
        </a>
      </li>
    </ol>
  )
}

export function OverviewDashboard() {
  const { t } = useTranslation()
  const setupGuideId = useId()
  const setupGuideToggleRef = useRef<HTMLButtonElement>(null)
  const user = useAuthStore((state) => state.auth.user)
  const { items: apiInfoItems } = useApiInfo()
  const {
    apiInfo: showApiInfoPanel,
    announcements: showAnnouncementsPanel,
    faq: showFAQPanel,
    uptimeKuma: showUptimePanel,
  } = useDashboardContentVisibility()
  const [manualSetupGuideExpanded, setManualSetupGuideExpanded] = useState<
    boolean | null
  >(() => getSavedSetupGuideExpanded())

  const requestCount = Number(user?.request_count ?? 0)
  const remainQuota = Number(user?.quota ?? 0)
  const usedQuota = Number(user?.used_quota ?? 0)
  const isAdmin = Boolean(user?.role && user.role >= ROLE.ADMIN)

  const apiKeysQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'api-keys'],
    // 新用户（一个密钥都没有）首次进入总览时，直接替他建一个默认密钥，并把明文一并带回来，
    // 这样「创建密钥」不再是一道用户必须自己迈过去的坎。
    // 建键放在 queryFn 里是为了借用 react-query 的请求去重：StrictMode 双挂载、并发挂载都只会建一次；
    // 同时关掉 retry，避免失败重发时重复建键。
    queryFn: async (): Promise<OverviewApiKeys> => {
      const result = await getApiKeys({ p: 1, size: 10 })
      if (!result.success) return { items: [], issuedKey: null }

      const items = result.data?.items ?? []
      if (items.length > 0) return { items, issuedKey: null }

      const created = await createApiKey(
        buildDefaultKeyPayload(t('Default API Key'))
      )
      if (!created.success || !created.data?.key) {
        return { items, issuedKey: null }
      }

      const refreshed = await getApiKeys({ p: 1, size: 10 })
      return {
        items: refreshed.success ? (refreshed.data?.items ?? items) : items,
        issuedKey: created.data,
      }
    },
    retry: false,
    staleTime: 60 * 1000,
  })

  const modelsQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'user-models'],
    queryFn: async () => {
      const result = requireServerSuccess(await getUserModels())
      return result.success ? (result.data ?? []) : []
    },
    staleTime: 5 * 60 * 1000,
  })

  const preferredKey = useMemo(
    () => getPreferredKey(apiKeysQuery.data?.items ?? []),
    [apiKeysQuery.data]
  )

  const startSteps = useMemo<StartStep[]>(
    () => [
      {
        title: t('Create API Key'),
        description: t('Create a key for your app or service'),
        to: '/keys',
        icon: KeyRound,
        completed: Boolean(preferredKey),
      },
      {
        title: t('Add credits'),
        description: t('Keep enough balance before production traffic'),
        to: '/wallet',
        icon: CreditCard,
        completed: remainQuota > 0 || usedQuota > 0,
      },
      {
        title: t('Send a request'),
        description: t('Verify routing with Playground or your client'),
        to: '/playground',
        icon: TerminalSquare,
        completed: requestCount > 0,
      },
    ],
    [preferredKey, remainQuota, requestCount, t, usedQuota]
  )

  const requestExample = useMemo<RequestExample>(() => {
    const endpoint = normalizeEndpoint(apiInfoItems[0]?.url)
    const model = modelsQuery.data?.[0] ?? 'gpt-4o-mini'
    const issuedKey = apiKeysQuery.data?.issuedKey ?? null

    // 刚自动创建的密钥，明文只在这个响应里出现过一次，直接原样展示，用户不必再去密钥页解一次。
    if (issuedKey) {
      return {
        endpoint,
        model,
        keyId: issuedKey.id,
        displayKey: `sk-${issuedKey.key}`,
        plainKey: issuedKey.key,
        ready: true,
      }
    }

    return {
      endpoint,
      model,
      keyId: preferredKey?.id,
      displayKey: preferredKey
        ? formatDisplayKey(`sk-${preferredKey.key}`)
        : 'sk-...',
      ready: Boolean(preferredKey?.id && model),
    }
  }, [apiInfoItems, apiKeysQuery.data, modelsQuery.data, preferredKey])

  const completedStepCount = startSteps.filter((step) => step.completed).length
  const setupComplete = completedStepCount === startSteps.length
  const setupStatusReady = apiKeysQuery.isFetched && Boolean(user)
  const setupGuideExpanded =
    manualSetupGuideExpanded ?? (setupStatusReady && !setupComplete)
  const showLeftContentPanels =
    isAdmin || showApiInfoPanel || showAnnouncementsPanel || showFAQPanel
  const showContentPanels = showLeftContentPanels || showUptimePanel

  const handleSetupGuideToggle = () => {
    const nextExpanded = !setupGuideExpanded
    setManualSetupGuideExpanded(nextExpanded)
    saveSetupGuideExpanded(nextExpanded)
    if (!nextExpanded && setupComplete) {
      setupGuideToggleRef.current?.focus()
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      {/* 概览头部：左边深色收据卡，右边余额、积分与快速开始三张浅色卡。
          收据卡把「过去 30 天省下多少」讲成一句话；右侧两张明细卡分别承接
          充值、积分流水两个主动作，快速开始折叠时不占位。 */}
      <CardStaggerContainer className='grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]'>
        <CardStaggerItem className='overflow-hidden rounded-3xl border border-white/10 bg-[#262320] text-[#f8f4ee] shadow-xs dark:bg-[#1b1917]'>
          <StartAssetsReceipt
            user={user}
            guideExpanded={setupGuideExpanded}
            setupComplete={setupComplete}
            guideControlsId={setupGuideId}
            guideToggleRef={setupGuideToggleRef}
            onToggleGuide={handleSetupGuideToggle}
          />
        </CardStaggerItem>

        <div className='relative flex min-w-0 flex-col gap-4'>
          {/* 手机上先看到「开始使用 → 免费积分 → 余额」：积分是这个站点的主
              资产，余额排在后面；桌面端两卡上下位置保持一致，快速开始仍然
              以覆盖层占住这两张卡的位置。 */}
          <CardStaggerItem>
            <StartAssetsPointsCard user={user} />
          </CardStaggerItem>

          <CardStaggerItem className='flex-1'>
            <StartAssetsBalanceCard user={user} />
          </CardStaggerItem>

          {/* 快速开始展开时覆盖在余额/积分两张卡之上，而不是插进列里把它们
              挤下去：页面高度保持不变，收起后原来的卡还在原位。
              `inset-0` 让覆盖层正好占住两张卡的范围；内容超出时在卡内滚动。 */}
          {setupGuideExpanded && (
            <CardStaggerItem className='bg-card absolute inset-0 z-10 flex flex-col overflow-y-auto rounded-2xl border p-4 shadow-lg sm:p-5'>
              <div id={setupGuideId} className='flex flex-1 flex-col gap-3'>
                <div className='flex items-center justify-between gap-2'>
                  <div className='flex items-center gap-2 text-sm font-semibold'>
                    <Sparkles
                      className='text-primary size-4'
                      aria-hidden='true'
                    />
                    {t('Quick start')}
                  </div>
                  <div className='flex items-center gap-2'>
                    <span className='bg-muted h-1 w-16 overflow-hidden rounded-full'>
                      <span
                        className='bg-primary block h-full rounded-full transition-all'
                        style={{
                          width: `${(completedStepCount / startSteps.length) * 100}%`,
                        }}
                      />
                    </span>
                    <span className='text-muted-foreground font-mono text-[11px] tabular-nums'>
                      {completedStepCount}/{startSteps.length}
                    </span>
                  </div>
                </div>
                <SetupStepCards example={requestExample} />
              </div>
            </CardStaggerItem>
          )}
        </div>
      </CardStaggerContainer>

      <SummaryCards />

      {showContentPanels && (
        <CardStaggerContainer
          className={cn(
            'grid grid-cols-1 gap-4',
            showLeftContentPanels &&
              showUptimePanel &&
              'xl:grid-cols-[minmax(0,1fr)_22rem]'
          )}
        >
          {showLeftContentPanels && (
            <div
              className={cn(
                'grid min-w-0 grid-cols-1 gap-4',
                (showApiInfoPanel || showAnnouncementsPanel || showFAQPanel) &&
                  'lg:grid-cols-2'
              )}
            >
              {isAdmin && (
                <CardStaggerItem className='lg:col-span-2'>
                  <PerformanceHealthPanel />
                </CardStaggerItem>
              )}
              {showApiInfoPanel && (
                <CardStaggerItem>
                  <ApiInfoPanel />
                </CardStaggerItem>
              )}
              {showAnnouncementsPanel && (
                <CardStaggerItem>
                  <AnnouncementsPanel />
                </CardStaggerItem>
              )}
              {showFAQPanel && (
                <CardStaggerItem>
                  <FAQPanel />
                </CardStaggerItem>
              )}
            </div>
          )}
          {showUptimePanel && (
            <CardStaggerItem>
              <UptimePanel />
            </CardStaggerItem>
          )}
        </CardStaggerContainer>
      )}
    </div>
  )
}
