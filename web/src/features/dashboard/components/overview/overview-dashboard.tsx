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
import {
  CreditCard,
  KeyRound,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react'
// import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CardStaggerContainer,
  CardStaggerItem,
} from '@/components/page-transition'
import { createApiKey, getApiKeys } from '@/features/keys/api'
import type {
  ApiKey,
  ApiKeyFormData,
  CreatedApiKey,
} from '@/features/keys/types'
import { getSelf, getUserModels } from '@/lib/api'
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
import { QuickStartNav, type RequestExample } from './quick-start-nav'
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

  // 余额/积分卡读的是登录态里的用户快照；免费模型在站外扣分后这份快照不会
  // 自己更新，卡片会一直停在登录那一刻的数字，和积分明细对不上。与钱包页
  // 同一个做法：每次进概览都拉一次最新 self 数据回写登录态。
  useEffect(() => {
    let cancelled = false
    getSelf()
      .then((response) => {
        if (cancelled) return
        if (response.success && response.data) {
          useAuthStore.getState().auth.setUser(response.data)
        }
      })
      .catch(() => {
        // 拉不到就继续用当前快照，下次进页再试。
      })
    return () => {
      cancelled = true
    }
  }, [])

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
              资产，余额排在后面；桌面端两卡上下位置保持一致。 */}
          <CardStaggerItem>
            <StartAssetsPointsCard user={user} />
          </CardStaggerItem>

          <CardStaggerItem className='flex-1'>
            <StartAssetsBalanceCard user={user} />
          </CardStaggerItem>

          {/* 快速开始从积分/余额的位置展开：覆盖层不改页面高度，收起后两张
              卡还在原位。内部三个页签由 QuickStartNav 自己切换。 */}
          {setupGuideExpanded && (
            <CardStaggerItem className='bg-card absolute inset-0 z-10 flex flex-col overflow-y-auto rounded-2xl border p-4 shadow-lg sm:p-5'>
              <div id={setupGuideId} className='flex flex-1 flex-col gap-3'>
                <QuickStartNav example={requestExample} />
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
