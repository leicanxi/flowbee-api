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
import { Image as ImageIcon, Link2, Share2 } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuota } from '@/lib/format'

import type { UserWalletData } from '../types'

// 改造#8：原生分享面板文案（品牌化固定中文文案，不分语言）
const INVITE_SHARE_TEXT =
  '白嫖时刻来了！用我的邀请码注册，你和我都能白拿额度免费使用模型，不嫖白不嫖！链接：'

interface AffiliateRewardsCardProps {
  user: UserWalletData | null
  affiliateLink: string
  onTransfer: () => void
  complianceConfirmed?: boolean
  loading?: boolean
}

export function AffiliateRewardsCard({
  user,
  affiliateLink,
  onTransfer,
  complianceConfirmed = true,
  loading,
}: AffiliateRewardsCardProps) {
  const { t } = useTranslation()

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(affiliateLink)
      toast.success(t('Copied'))
    } catch {
      toast.error(t('Copy failed'))
    }
  }, [affiliateLink, t])

  // 改造#8：优先调起手机原生分享面板；不支持（个别桌面浏览器）时降级为复制链接
  const handleNativeShare = useCallback(async () => {
    const message = `${INVITE_SHARE_TEXT}${affiliateLink}`
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: t('Referral Program'), text: message })
      } catch (error) {
        if ((error as DOMException | undefined)?.name !== 'AbortError') {
          toast.error(t('Share failed'))
        }
      }
      return
    }
    await copyLink()
  }, [affiliateLink, copyLink, t])

  const handlePosterComingSoon = useCallback(() => {
    toast.info(t('Share poster is coming soon'))
  }, [t])

  if (loading) {
    return (
      <Card data-card-hover='false' className='bg-muted/20 py-0'>
        <CardContent className='grid gap-4 p-3 sm:p-4'>
          <div className='flex items-center gap-2.5'>
            <Skeleton className='size-8 rounded-lg' />
            <div>
              <Skeleton className='h-5 w-32' />
              <Skeleton className='mt-2 h-4 w-48' />
            </div>
          </div>
          <Skeleton className='h-10 rounded-lg' />
          <Skeleton className='h-9 rounded-lg' />
        </CardContent>
      </Card>
    )
  }

  const hasRewards = (user?.aff_quota ?? 0) > 0

  return (
    <Card data-card-hover='false' className='bg-muted/20 py-0'>
      <CardContent className='grid gap-3 p-3 sm:gap-4 sm:p-4'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <IconBadge tone='chart-3'>
            <Share2 />
          </IconBadge>
          <div className='min-w-0'>
            <h3 className='truncate text-sm font-semibold'>
              {t('Referral Program')}
            </h3>
            {/* 改造#2：去掉 line-clamp-1，手机端完整展示推荐规则文案 */}
            <p className='text-muted-foreground text-xs'>
              {t(
                'Earn rewards when users join through your referral link. Transfer accumulated rewards to your balance anytime.'
              )}
            </p>
          </div>
        </div>

        <div className='grid grid-cols-3 gap-1.5 text-center'>
          {[
            [t('Pending'), formatQuota(user?.aff_quota ?? 0)],
            [t('Total Earned'), formatQuota(user?.aff_history_quota ?? 0)],
            [t('Invites'), String(user?.aff_count ?? 0)],
          ].map(([label, value]) => (
            <div key={label}>
              <div className='text-muted-foreground truncate text-[10px] font-medium tracking-wider uppercase'>
                {label}
              </div>
              <div className='mt-0.5 truncate text-sm font-semibold tabular-nums'>
                {value}
              </div>
            </div>
          ))}
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <Input
            value={affiliateLink}
            readOnly
            className='border-muted bg-background/70 h-9 min-w-0 flex-1 font-mono text-xs'
          />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={t('Invite now')}
                  variant='outline'
                  className='shrink-0'
                  size='lg'
                />
              }
            >
              <Share2 className='size-4' />
              {t('Invite now')}
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-44'>
              {/* 改造#8：分享到 = 调起手机原生分享面板 */}
              <DropdownMenuItem
                className='gap-2'
                onSelect={handleNativeShare}
              >
                <Share2 className='size-4' />
                {t('Share to')}
              </DropdownMenuItem>
              <DropdownMenuItem className='gap-2' onSelect={copyLink}>
                <Link2 className='size-4' />
                {t('Copy link')}
              </DropdownMenuItem>
              {/* 改造#8：分享海报先占位，海报设计后续补 */}
              <DropdownMenuItem
                className='gap-2'
                onSelect={handlePosterComingSoon}
              >
                <ImageIcon className='size-4' />
                {t('Share poster')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {hasRewards && (
            <Button
              onClick={onTransfer}
              disabled={!complianceConfirmed}
              className='h-9 shrink-0 px-3'
              size='sm'
            >
              {t('Transfer to Balance')}
            </Button>
          )}
        </div>
        {!complianceConfirmed ? (
          <p className='text-muted-foreground text-xs'>
            {t(
              'Referral reward transfer is disabled until the administrator confirms compliance terms.'
            )}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
