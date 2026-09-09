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

import { SectionPageLayout } from '@/components/layout'
import { useStatus } from '@/hooks/use-status'
import { getSelf } from '@/lib/api'

import { CheckinCalendarCard } from '@/features/profile/components/checkin-calendar-card'
import { AffiliateRewardsCard } from '@/features/wallet/components/affiliate-rewards-card'
import { TransferDialog } from '@/features/wallet/components/dialogs/transfer-dialog'
import { useAffiliate, useTopupInfo } from '@/features/wallet/hooks'
import type { UserWalletData } from '@/features/wallet/types'

import { TierStatusCard } from '@/features/invite/components/tier-status-card'

/**
 * Welfare page (formerly "Invite & Check-in").
 *
 * 改造#3：将原本位于钱包页的「推荐计划」卡片与个人资料页的「签到」
 * 卡片集中到侧边栏「福利」入口下，方便用户在手机上集中操作。
 *
 * 改造#8：桌面端双列 —— 左列：等级在上、邀请在下（同一 flex 列，间距固定
 * 如个人资料页，避免签到卡跨行把网格拉高后标题上方出现空隙）；右列：签到。
 * 移动端单列 M1'：等级 → 邀请 → 签到。
 *
 * 改造#9：福利等级卡组上移到邀请卡之前，作为福利页的主视觉入口。
 */
export function Invite() {
  const { t } = useTranslation()
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)

  const { status } = useStatus()
  const { topupInfo } = useTopupInfo()
  const {
    affiliateLink,
    loading: affiliateLoading,
    transferQuota,
    transferring,
  } = useAffiliate()

  const checkinEnabled = status?.checkin_enabled === true
  const turnstileEnabled = !!(
    status?.turnstile_check && status?.turnstile_site_key
  )
  const turnstileSiteKey = status?.turnstile_site_key || ''

  const fetchUser = useCallback(async () => {
    try {
      setUserLoading(true)
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
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

  const handleTransfer = useCallback(
    async (amount: number) => {
      const success = await transferQuota(amount)
      if (success) {
        await fetchUser()
      }
      return success
    },
    [transferQuota, fetchUser]
  )

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Welfare')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5 lg:grid lg:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)] lg:items-start'>
            {/* 左列 wrapper：等级 + 邀请（改造#9：等级卡上移）。桌面同列上下紧排
                （间距与个人资料页卡片一致）；若把等级/邀请拆成两个独立 grid item，
                右列签到卡(row-span)会把网格行拉高，导致卡片之间出现空隙。 */}
            <div className='flex min-w-0 flex-col gap-4 sm:gap-5'>
              <TierStatusCard user={user} />
              <AffiliateRewardsCard
                user={user}
                affiliateLink={affiliateLink}
                onTransfer={() => setTransferDialogOpen(true)}
                complianceConfirmed={
                  topupInfo?.payment_compliance_confirmed !== false
                }
                loading={userLoading || affiliateLoading}
              />
            </div>
            {checkinEnabled && (
              /* 签到卡：桌面端右列（与左列顶部对齐） */
              <div className='lg:col-start-2 lg:row-start-1'>
                <CheckinCalendarCard
                  checkinEnabled={checkinEnabled}
                  turnstileEnabled={turnstileEnabled}
                  turnstileSiteKey={turnstileSiteKey}
                />
              </div>
            )}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onConfirm={handleTransfer}
        availableQuota={user?.aff_quota ?? 0}
        transferring={transferring}
      />
    </>
  )
}
