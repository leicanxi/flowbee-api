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
  BadgeDollarSign,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  // Circle, // 引导步骤列表与旧请求卡片的动效一起停用，保留待后续 UI 参考
  Copy,
  CreditCard,
  FileText,
  Gift,
  Heart,
  KeyRound,
  ListChecks,
  RadioTower,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react'
// import { motion, useReducedMotion } from 'motion/react'
import { useMemo, useState, type ReactNode } from 'react'
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
// import { MOTION_TRANSITION } from '@/lib/motion'
import { ROLE } from '@/lib/roles'
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
import { SummaryCards } from './summary-cards'
import { UptimePanel } from './uptime-panel'

const SETUP_GUIDE_VISIBILITY_STORAGE_KEY =
  'dashboard_overview_setup_guide_expanded'

const SETUP_GUIDE_CODE_PATTERN = [
  'const request = await client.responses.create({',
  "  model: 'gpt-4.1-mini',",
  "  input: 'Start routing traffic',",
  '})',
  '',
  'if (request.output_text) {',
  '  console.log(request.output_text)',
  '}',
].join('\n')

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

interface QuickAction {
  title: string
  description: string
  to: DashboardActionPath
  icon: LucideIcon
  adminOnly?: boolean
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

function buildCurlCommand(args: {
  endpoint: string
  apiKey: string
  model: string
}): string {
  return [
    `curl ${args.endpoint} \\`,
    '  -H "Content-Type: application/json" \\',
    `  -H "Authorization: Bearer ${args.apiKey}" \\`,
    `  -d '{"model":"${args.model}","messages":[{"role":"user","content":"Say hello in one sentence."}]}'`,
  ].join('\n')
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
  }
}

function SetupGuideBackdrop(props: { compact?: boolean }) {
  return (
    <>
      <div
        className={cn(
          'pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_48%_120%_at_78%_0%,color-mix(in_oklch,var(--overview-accent-1)_14%,transparent)_0%,transparent_62%),linear-gradient(112deg,color-mix(in_oklch,var(--card)_94%,var(--overview-accent-2)_6%)_0%,color-mix(in_oklch,var(--card)_94%,var(--overview-accent-3)_6%)_48%,color-mix(in_oklch,var(--background)_90%,var(--overview-accent-1)_10%)_100%)] dark:opacity-60',
          props.compact
            ? '[mask-image:linear-gradient(90deg,black_0%,black_48%,transparent_74%)] opacity-55'
            : 'opacity-85'
        )}
        aria-hidden='true'
      />
      <div
        className={cn(
          'text-foreground/5 dark:text-foreground/8 pointer-events-none absolute inset-y-0 right-0 hidden overflow-hidden font-mono sm:block',
          props.compact ? 'w-1/2 opacity-45' : 'w-[58%] opacity-75'
        )}
        aria-hidden='true'
      >
        <pre
          className={cn(
            'absolute right-3 [mask-image:linear-gradient(90deg,transparent_0%,black_30%,black_82%,transparent_100%)] text-right tracking-[0.38em] whitespace-pre',
            props.compact
              ? '-top-6 text-[9px] leading-4'
              : 'top-1 text-[11px] leading-5'
          )}
        >
          {SETUP_GUIDE_CODE_PATTERN}
        </pre>
      </div>
      <div
        className='from-background/35 to-background/70 dark:from-background/20 dark:to-background/80 pointer-events-none absolute inset-0 bg-linear-to-b via-transparent'
        aria-hidden='true'
      />
    </>
  )
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

type RequestPreviewShortcut =
  | {
      kind: 'internal'
      to: '/invite' | '/pricing'
      label: string
      icon: LucideIcon
    }
  | {
      kind: 'external'
      href: string
      label: string
      icon: LucideIcon
    }

interface SetupStepCard {
  step: number
  title: string
  description: string
  icon: LucideIcon
  tone: IconBadgeTone
}

const REQUEST_SHORTCUTS: RequestPreviewShortcut[] = [
  {
    kind: 'internal',
    to: '/invite',
    label: 'Welfare',
    icon: Gift,
  },
  {
    kind: 'external',
    href: 'https://docs.flowbee.top',
    label: 'Usage guide',
    icon: BookOpen,
  },
  {
    kind: 'external',
    href: 'https://post.flowbee.top',
    label: 'Wishlist & Feedback',
    icon: Heart,
  },
  {
    kind: 'internal',
    to: '/pricing',
    label: 'Model Pricing',
    icon: BadgeDollarSign,
  },
]

const API_KEY_STEP_CARD: SetupStepCard = {
  step: 1,
  title: 'Your API Key',
  description: 'This is the credential your app uses to call the API',
  icon: KeyRound,
  tone: 'primary',
}

const CREDITS_STEP_CARD: SetupStepCard = {
  step: 2,
  title: 'Add credits',
  description:
    'Adding credits raises your free request rate and keeps bots out',
  icon: CreditCard,
  tone: 'chart-4',
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

// 终端面板沿用上游原来的结构：一行圆点 + 内容。复制按钮跟第一行内容同排，
// 这样圆点行的高度只由圆点决定，内容不会被按钮顶下去。
function TerminalPanel(props: {
  className?: string
  action?: ReactNode
  align?: 'start' | 'center'
  children: ReactNode
}) {
  return (
    <div className={cn(PANEL_CLASS_NAME, 'font-mono text-xs', props.className)}>
      <div className='mb-2 flex items-center gap-1.5'>
        <span
          className='bg-destructive size-2 rounded-full'
          aria-hidden='true'
        />
        <span className='bg-warning size-2 rounded-full' aria-hidden='true' />
        <span className='bg-success size-2 rounded-full' aria-hidden='true' />
      </div>
      <div
        className={cn(
          'flex justify-between gap-2',
          props.align === 'center' ? 'items-center' : 'items-start'
        )}
      >
        <div className='flex min-w-0 flex-1 flex-col gap-1 overflow-hidden'>
          {props.children}
        </div>
        {props.action}
      </div>
    </div>
  )
}

// Resource links sit outside the request card so the card itself only carries
// the three onboarding steps: key, credits, request.
function RequestShortcutLinks() {
  const { t } = useTranslation()

  return (
    <div className='grid gap-2'>
      {REQUEST_SHORTCUTS.map((shortcut) => {
        const Icon = shortcut.icon
        const content = (
          <>
            <span className='flex min-w-0 items-center gap-2'>
              <Icon
                className='text-muted-foreground size-4 shrink-0'
                aria-hidden='true'
              />
              <span className='truncate text-sm font-medium'>
                {t(shortcut.label)}
              </span>
            </span>
            {shortcut.kind === 'internal' ? (
              <ArrowRight
                className='text-muted-foreground size-4 shrink-0'
                aria-hidden='true'
              />
            ) : (
              <ArrowUpRight
                className='text-muted-foreground size-4 shrink-0'
                aria-hidden='true'
              />
            )}
          </>
        )
        return shortcut.kind === 'internal' ? (
          <Link
            key={shortcut.label}
            to={shortcut.to}
            className={CARD_LINK_CLASS_NAME}
          >
            {content}
          </Link>
        ) : (
          <a
            key={shortcut.label}
            href={shortcut.href}
            target='_blank'
            rel='noreferrer'
            className={CARD_LINK_CLASS_NAME}
          >
            {content}
          </a>
        )
      })}
    </div>
  )
}

// The key panel and the curl panel sit in different columns, so the copy logic
// they share lives here instead of being duplicated in both.
function useExampleCopy(example: RequestExample) {
  const { t } = useTranslation()
  const [copyingTarget, setCopyingTarget] = useState<'curl' | 'key' | null>(
    null
  )
  const { copyToClipboard } = useCopyToClipboard({ notify: false })

  const copy = async (target: 'curl' | 'key') => {
    if (copyingTarget) return

    setCopyingTarget(target)
    try {
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

      const text =
        target === 'curl'
          ? buildCurlCommand({
              endpoint: example.endpoint,
              apiKey: `sk-${plainKey}`,
              model: example.model,
            })
          : `sk-${plainKey}`
      if (await copyToClipboard(text)) {
        toast.success(t('Copied to clipboard'))
      } else {
        toast.error(t('Failed to copy to clipboard'))
      }
    } finally {
      setCopyingTarget(null)
    }
  }

  return { copyingTarget, copy }
}

function SetupStepCards(props: { example: RequestExample }) {
  const { t } = useTranslation()
  const { example } = props
  const { copyingTarget, copy } = useExampleCopy(example)
  // Plaintext is only known right after we create the key for the user; otherwise
  // the panel shows the masked value and copying resolves the real key on demand.
  const keyValue = example.plainKey
    ? `sk-${example.plainKey}`
    : example.displayKey

  // 纵向拉满并用 justify-between 分配间距：卡片行数不变，多出来的高度进到间隙里，
  // 于是 blur 底部自然贴在整行底部（也就是右栏底部），以后加减步骤都不用改这里。
  return (
    <ol className='bg-background/45 flex flex-col justify-between gap-2 rounded-2xl border p-2 backdrop-blur'>
      {/* 改造#18：三步套回原来那个列表底色，密钥内容并进第 1 步卡片里 */}
      <li className={cn(CARD_SURFACE_CLASS_NAME, 'flex flex-col gap-2.5')}>
        <StepCardBody
          {...API_KEY_STEP_CARD}
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
        <TerminalPanel
          align='center'
          action={
            example.ready ? (
              <Button
                variant='ghost'
                size='xs'
                disabled={copyingTarget !== null}
                onClick={() => copy('key')}
                aria-label={t('Copy API key')}
              >
                <Copy data-icon='inline-start' />
                {t('Copy')}
              </Button>
            ) : (
              <Button variant='outline' size='xs' render={<Link to='/keys' />}>
                {t('Create API Key')}
              </Button>
            )
          }
        >
          <code className='truncate' title={keyValue}>
            {keyValue}
          </code>
        </TerminalPanel>
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

// 右侧栏：可复制的 curl 示例（手机端隐藏）+ 功能入口
function RequestExampleRail(props: { example: RequestExample }) {
  const { t } = useTranslation()
  const { example } = props
  const { copyingTarget, copy } = useExampleCopy(example)
  const previewLines = buildCurlCommand({
    endpoint: example.endpoint,
    apiKey: example.displayKey,
    model: example.model,
  }).split('\n')

  return (
    <div className='flex flex-col gap-2'>
      <TerminalPanel
        className='hidden lg:block'
        action={
          example.ready ? (
            <Button
              variant='ghost'
              size='xs'
              disabled={copyingTarget !== null}
              onClick={() => copy('curl')}
              aria-label={t('Copy ready-to-run curl')}
            >
              <Copy data-icon='inline-start' />
              {t('Copy')}
            </Button>
          ) : null
        }
      >
        <div className='flex flex-col gap-1 overflow-hidden'>
          {previewLines.map((line) => (
            <code
              key={line}
              className='text-muted-foreground truncate'
              title={line}
            >
              {line}
            </code>
          ))}
        </div>
      </TerminalPanel>
    </div>
  )
}

function QuickActionItem(props: { action: QuickAction }) {
  const Icon = props.action.icon

  return (
    <Button
      variant='outline'
      className='h-auto justify-start rounded-xl px-3 py-3 text-left'
      render={<Link to={props.action.to} />}
    >
      <span className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg'>
        <Icon className='size-4' aria-hidden='true' />
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='truncate text-sm font-medium'>
          {props.action.title}
        </span>
        <span className='text-muted-foreground line-clamp-2 text-xs leading-relaxed'>
          {props.action.description}
        </span>
      </span>
    </Button>
  )
}

function CompactQuickAction(props: { action: QuickAction }) {
  const Icon = props.action.icon

  return (
    <Button
      variant='outline'
      size='sm'
      className='bg-background/70 h-8 min-w-24 gap-1.5 px-2.5'
      render={<Link to={props.action.to} />}
    >
      <Icon data-icon='inline-start' />
      <span>{props.action.title}</span>
    </Button>
  )
}

export function OverviewDashboard() {
  const { t } = useTranslation()
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
      const result = await getUserModels()
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

  const quickActions = useMemo<QuickAction[]>(
    () => [
      {
        title: t('API Keys'),
        description: t('Create a key for your app or service'),
        to: '/keys',
        icon: KeyRound,
      },
      {
        title: t('Channels'),
        description: t('Configure upstream providers and routing.'),
        to: '/channels',
        icon: RadioTower,
        adminOnly: true,
      },
      {
        title: t('Usage Logs'),
        description: t('Inspect requests, errors, and billing details'),
        to: '/usage-logs',
        icon: FileText,
      },
      {
        title: t('Pricing'),
        description: t('Review model rates before scaling traffic'),
        to: '/pricing',
        icon: BookOpen,
      },
    ],
    [t]
  )

  const visibleQuickActions = useMemo(
    () => quickActions.filter((action) => !action.adminOnly || isAdmin),
    [isAdmin, quickActions]
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
  }

  return (
    <div className='flex flex-col gap-4'>
      {setupGuideExpanded ? (
        <CardStaggerContainer className='grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]'>
          <CardStaggerItem className='bg-card h-full overflow-hidden rounded-2xl border shadow-xs'>
            <div className='relative h-full overflow-hidden p-4 sm:p-5'>
              <SetupGuideBackdrop />
              <div className='relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]'>
                {/* 标题独占一行，右侧的 curl 卡片不能高过它 */}
                <div className='flex flex-wrap items-start justify-between gap-3 lg:col-span-2'>
                  <div className='flex max-w-2xl flex-col gap-1'>
                    <div className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wider uppercase'>
                      <ListChecks className='size-3.5' aria-hidden='true' />
                      {t('Get started')}
                    </div>
                    <h3 className='text-xl font-semibold tracking-tight sm:text-2xl'>
                      {t('Welcome to the free Flowbee API')}
                    </h3>
                    <p className='text-muted-foreground max-w-xl text-sm leading-relaxed'>
                      {t(
                        'The site owner is paying out of pocket for now; ads will cover the costs once we grow — please recommend us!'
                      )}
                    </p>
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={handleSetupGuideToggle}
                    >
                      <ChevronUp data-icon='inline-start' />
                      {t('Hide setup guide')}
                    </Button>
                    <Button size='sm' render={<Link to='/keys' />}>
                      <KeyRound data-icon='inline-start' />
                      {t('Create API Key')}
                    </Button>
                  </div>
                </div>

                <SetupStepCards example={requestExample} />

                {/* 右栏起头比左侧第一张卡片高（只收掉一部分行间距，仍在标题下面），
                    底部不写死：justify-between 让最后一个功能块的底边落在整行底部，
                    也就是左侧 blur 的底边，以后增减功能入口都不用改这里 */}
                <div className='flex flex-col gap-2 lg:-mt-4 lg:justify-between'>
                  <RequestExampleRail example={requestExample} />
                  <RequestShortcutLinks />
                </div>
              </div>
            </div>
          </CardStaggerItem>

          <CardStaggerItem className='bg-card h-full rounded-2xl border p-4 shadow-xs sm:p-5'>
            <div className='flex h-full flex-col gap-4'>
              <div className='flex flex-col gap-1'>
                <div className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  {t('Recommended actions')}
                </div>
                <h3 className='text-lg font-semibold tracking-tight'>
                  {t('Keep the platform ready')}
                </h3>
              </div>
              <div className='grid gap-2'>
                {visibleQuickActions.map((action) => (
                  <QuickActionItem key={action.title} action={action} />
                ))}
              </div>
            </div>
          </CardStaggerItem>
        </CardStaggerContainer>
      ) : (
        <CardStaggerContainer>
          <CardStaggerItem className='bg-card overflow-hidden rounded-2xl border shadow-xs'>
            <div className='relative overflow-hidden px-4 py-3 sm:px-5'>
              <SetupGuideBackdrop compact />
              <div className='relative flex flex-wrap items-center justify-between gap-3'>
                <div className='flex min-w-0 items-center gap-3'>
                  <span className='bg-background/70 flex size-9 shrink-0 items-center justify-center rounded-xl border shadow-xs'>
                    <Check className='text-success size-4' aria-hidden='true' />
                  </span>
                  <div className='min-w-0'>
                    <div className='flex items-center gap-2'>
                      <h3 className='truncate text-sm font-semibold'>
                        {setupComplete
                          ? t('Setup guide complete')
                          : t('Setup guide')}
                      </h3>
                      <span className='text-muted-foreground bg-background/60 rounded-md border px-2 py-0.5 text-xs'>
                        {t('Setup progress: {{completed}}/{{total}}', {
                          completed: completedStepCount,
                          total: startSteps.length,
                        })}
                      </span>
                    </div>
                    <p className='text-muted-foreground line-clamp-1 text-xs'>
                      {setupComplete
                        ? t(
                            'Your setup guide is collapsed so usage stays in focus.'
                          )
                        : t('Setup guide is collapsed. Expand it anytime.')}
                    </p>
                  </div>
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                  {visibleQuickActions.map((action) => (
                    <CompactQuickAction key={action.title} action={action} />
                  ))}
                  <Button
                    variant='outline'
                    size='sm'
                    className='bg-background/70 h-8 min-w-28'
                    onClick={handleSetupGuideToggle}
                  >
                    <ChevronDown data-icon='inline-start' />
                    {t('Show setup guide')}
                  </Button>
                </div>
              </div>
            </div>
          </CardStaggerItem>
        </CardStaggerContainer>
      )}

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
