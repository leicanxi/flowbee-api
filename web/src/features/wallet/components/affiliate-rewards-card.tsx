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
import { BadgeCheck, ListChecks, Share2, UserPlus, Users } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { WelfarePointsLogsDialog } from '@/features/dashboard/components/overview/welfare-points-logs-dialog'
import { getWelfarePoints } from '@/features/dashboard/api'
import { formatNumber } from '@/lib/format'

import type { UserWalletData } from '../types'

// 改造#8：原生分享面板文案（品牌化固定中文文案，不分语言）
const INVITE_SHARE_TEXT =
  '白嫖时刻来了！用我的邀请码注册，你和我都能白拿额度免费使用模型，不嫖白不嫖！链接：'

interface AffiliateRewardsCardProps {
  user: UserWalletData | null
  affiliateLink: string
  loading?: boolean
}

/**
 * 邀请好友卡片：标题 + 邀请统计 + 邀请链接 + 规则说明。
 *
 * 规则说明把「奖励在好友首次充值到账后发放」融进好处句里陈述到账节奏，
 * 不提防刷规则；末句明确好友的充值赠送照常保留，消除「邀请是不是亏了好友」
 * 的顾虑（改造#8 的原生分享入口保留）。
 */
export function AffiliateRewardsCard(props: AffiliateRewardsCardProps) {
  const { t } = useTranslation()
  const [logsOpen, setLogsOpen] = useState(false)

  // 规则说明需要展示双方的积分面额，取积分配置里的发放口径。
  const rulesQuery = useQuery({
    queryKey: ['welfare-points', 'invite-rules'],
    queryFn: async () => {
      const result = await getWelfarePoints()
      return result.success ? result.data : undefined
    },
    staleTime: 5 * 60 * 1000,
  })

  const inviterPoints = rulesQuery.data?.inviter_points ?? 0
  const inviteePoints = rulesQuery.data?.invitee_points ?? 0
  const hasAmounts = inviterPoints > 0 || inviteePoints > 0

  // 改造#8：优先调起手机原生分享面板；不支持（个别桌面浏览器）时降级为复制链接
  const handleNativeShare = useCallback(async () => {
    const message = `${INVITE_SHARE_TEXT}${props.affiliateLink}`
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: t('Invite friends'), text: message })
      } catch (error) {
        if ((error as DOMException | undefined)?.name !== 'AbortError') {
          toast.error(t('Share failed'))
        }
      }
      return
    }
    try {
      await navigator.clipboard.writeText(props.affiliateLink)
      toast.success(t('Copied'))
    } catch {
      toast.error(t('Copy failed'))
    }
  }, [props.affiliateLink, t])

  if (props.loading) {
    return (
      <Card data-card-hover='false' className='bg-muted/20 py-0'>
        <CardContent className='grid gap-4 p-3 sm:p-4'>
          <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2'>
            <div className='flex items-center gap-2'>
              <Skeleton className='size-5 rounded-full' />
              <Skeleton className='h-5 w-24' />
            </div>
            <div className='flex items-center gap-4'>
              <Skeleton className='h-4 w-20' />
              <Skeleton className='h-4 w-20' />
            </div>
          </div>
          <Skeleton className='h-11 rounded-xl' />
          <Skeleton className='h-4 w-3/4' />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-card-hover='false' className='bg-muted/20 py-0'>
      <CardContent className='grid gap-3 p-3 sm:gap-4 sm:p-4'>
        <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2'>
          <div className='flex items-center gap-2'>
            <UserPlus
              className='text-chart-3 size-5 shrink-0'
              strokeWidth={1.7}
              aria-hidden='true'
            />
            <h3 className='text-base font-semibold'>{t('Invite friends')}</h3>
          </div>
          <div className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'>
            <span className='flex items-center gap-1.5'>
              <Users className='size-3.5' aria-hidden='true' />
              {t('Invited')}
              <span className='text-foreground text-sm font-semibold tabular-nums'>
                {formatNumber(props.user?.aff_count ?? 0)}
              </span>
            </span>
            <span className='flex items-center gap-1.5'>
              <BadgeCheck className='size-3.5' aria-hidden='true' />
              {t('Rewarded')}
              <span className='text-foreground text-sm font-semibold tabular-nums'>
                {formatNumber(props.user?.aff_issued_count ?? 0)}
              </span>
            </span>
            <button
              type='button'
              onClick={() => setLogsOpen(true)}
              className='hover:text-foreground flex items-center gap-1.5 transition-colors'
            >
              <ListChecks className='size-3.5' aria-hidden='true' />
              {t('My records')}
            </button>
          </div>
        </div>

        <div className='flex items-center gap-2'>
          <div className='border-input bg-background flex h-11 min-w-0 flex-1 items-center rounded-xl border px-3.5'>
            <span className='truncate font-mono text-sm'>
              {props.affiliateLink}
            </span>
          </div>
          <CopyButton
            value={props.affiliateLink}
            variant='outline'
            className='size-11 shrink-0 rounded-full'
            iconClassName='size-4'
            tooltip={t('Copy link')}
            aria-label={t('Copy link')}
          />
          <Button
            variant='outline'
            size='icon'
            className='size-11 shrink-0 rounded-full'
            aria-label={t('Share to')}
            onClick={handleNativeShare}
          >
            <Share2 className='size-4' />
          </Button>
        </div>

        <p className='text-muted-foreground text-xs leading-relaxed'>
          {hasAmounts
            ? t(
                'After your friend signs up via your link and their first top-up is credited, you earn {{inviter}} bonus points and your friend earns {{invitee}}, credited automatically; your friend keeps all top-up bonuses.',
                { inviter: inviterPoints, invitee: inviteePoints }
              )
            : t(
                "Invite rewards are credited automatically after your friend's first top-up; your friend keeps all top-up bonuses."
              )}
        </p>
      </CardContent>

      <WelfarePointsLogsDialog open={logsOpen} onOpenChange={setLogsOpen} />
    </Card>
  )
}
