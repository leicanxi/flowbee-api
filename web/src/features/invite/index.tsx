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
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { WelfarePointsCard } from '@/features/invite/components/welfare-points-card'
import { WelfarePromoSection } from '@/features/invite/components/promo-section'
import { LotteryDrawCard } from '@/features/lottery/components/lottery-draw-card'
import { CheckinCalendarCard } from '@/features/profile/components/checkin-calendar-card'
import { AffiliateRewardsCard } from '@/features/wallet/components/affiliate-rewards-card'
import { useAffiliate } from '@/features/wallet/hooks'
import type { UserWalletData } from '@/features/wallet/types'
import { useStatus } from '@/hooks/use-status'
import { getSelf } from '@/lib/api'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'

/**
 * Welfare page (formerly "Invite & Check-in").
 *
 * 改造#3：将原本位于钱包页的「推荐计划」卡片与个人资料页的「签到」
 * 卡片集中到侧边栏「福利」入口下，方便用户在手机上集中操作。
 *
 * 桌面端双列：左列是福利积分摘要与邀请，右列是抽奖与签到。
 * 移动端单列：福利积分摘要 → 邀请 → 签到。
 *
 * 余额分档已移除：福利组改由积分准入，调用速率仍由后台的
 * ModelRequestRateLimitGroup 控制。
 *
 * 右列新增「生日抽奖」卡（位于签到卡之上），受服务端活动开关控制。
 * 抽奖是限时活动，关闭后整张卡自动消失，不影响常驻布局。
 */
export function Invite() {
  const { t } = useTranslation()
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [userLoading, setUserLoading] = useState(true)

  const { status } = useStatus()
  const { affiliateLink, loading: affiliateLoading } = useAffiliate()

  const checkinEnabled = status?.checkin_enabled === true
  const welfarePointsEnabled = status?.welfare_points_enabled === true
  // 运营推广区开关:内容整段由后台配置(HTML/MD),关闭或未配置时整块消失。
  const welfarePromoEnabled = status?.welfare_promo_enabled === true
  // 推广区没有自己的卡片壳,收起入口放在标题行;状态记住到 localStorage。
  const [promoCollapsed, setPromoCollapsed] = useState(() => {
    try {
      return localStorage.getItem('welfare_promo_collapsed') === '1'
    } catch {
      return false
    }
  })

  const togglePromoCollapsed = () => {
    setPromoCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('welfare_promo_collapsed', next ? '1' : '0')
      } catch {
        /* Storage may be disabled. */
      }
      return next
    })
  }
  // 改造#12：抽奖活动开关。活动起止时间也由服务端下发，
  // 但前端只做展示，真正的拦截在服务端 —— 否则直接调接口就能绕过时间限制。
  const lotteryEnabled = status?.lottery_enabled === true
  const altchaEnabled = status?.altcha_check === true
  const turnstileEnabled =
    altchaEnabled || !!(status?.turnstile_check && status?.turnstile_site_key)
  const turnstileSiteKey = status?.turnstile_site_key || ''

  const fetchUser = useCallback(async () => {
    try {
      setUserLoading(true)
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
        // 改造#33：同钱包页。签到、转入奖励都会改变余额，也就改变了免费
        // 模型调用速率所在的档位，所以这里同样要把最新数据回写登录态，
        // 否则概览页那行档位提示会停在进入福利页之前的档位。
        useAuthStore
          .getState()
          .auth.setUser(response.data as unknown as AuthUser)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch user data:', error)
    } finally {
      setUserLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Welfare')}</SectionPageLayout.Title>
      {welfarePromoEnabled && (
        <SectionPageLayout.Actions>
          <Button
            variant='ghost'
            size='icon-sm'
            className='text-muted-foreground'
            aria-label={promoCollapsed ? t('Expand') : t('Collapse')}
            title={promoCollapsed ? t('Expand') : t('Collapse')}
            onClick={togglePromoCollapsed}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                promoCollapsed ? '' : 'rotate-180'
              }`}
            />
          </Button>
        </SectionPageLayout.Actions>
      )}
        <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5'>
          {/* 运营推广区(后台可配置,最上方整条,无卡片壳) */}
          <WelfarePromoSection
            enabled={welfarePromoEnabled}
            collapsed={promoCollapsed}
          />
          <div className='flex w-full flex-col gap-4 sm:gap-5 lg:grid lg:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)] lg:items-start'>
            {/* 左列 wrapper：档位摘要条 + 邀请（改造#9：摘要条上移）。桌面同列上下紧排
                （间距与个人资料页卡片一致）；若把摘要条/邀请拆成两个独立 grid item，
                右列签到卡(row-span)会把网格行拉高，导致卡片之间出现空隙。 */}
            <div className='flex min-w-0 flex-col gap-4 sm:gap-5'>
              <WelfarePointsCard user={user} enabled={welfarePointsEnabled} />
              <AffiliateRewardsCard
                user={user}
                affiliateLink={affiliateLink}
                loading={userLoading || affiliateLoading}
              />
            </div>
            {(lotteryEnabled || checkinEnabled) && (
              /* 右列：抽奖卡在上、签到卡在下（与左列顶部对齐） */
              <div className='flex min-w-0 flex-col gap-4 sm:gap-5 lg:col-start-2 lg:row-start-1'>
                <LotteryDrawCard
                  lotteryEnabled={lotteryEnabled}
                  turnstileEnabled={turnstileEnabled}
                  turnstileSiteKey={turnstileSiteKey}
                />
                {checkinEnabled && (
                  <CheckinCalendarCard
                    checkinEnabled={checkinEnabled}
                    altchaEnabled={altchaEnabled}
                    turnstileEnabled={turnstileEnabled}
                    turnstileSiteKey={turnstileSiteKey}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
