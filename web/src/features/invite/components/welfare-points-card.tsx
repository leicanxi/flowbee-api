import { Gauge } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { IconBadge } from '@/components/ui/icon-badge'
import type { UserWalletData } from '@/features/wallet/types'

/**
 * Welfare points summary. Replaces the old balance-tier card: the welfare
 * group is no longer gated by wallet balance, it is gated by points.
 */
export function WelfarePointsCard({
  user,
  enabled,
}: {
  user: UserWalletData | null
  enabled: boolean
}) {
  const { t } = useTranslation()
  if (!enabled) return null

  const daily = user?.welfare_points_daily ?? 0
  const permanent = user?.welfare_points_permanent ?? 0
  const total = user?.welfare_points_total ?? daily + permanent

  return (
    <div className='bg-muted/30 rounded-xl border p-3.5 sm:p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <IconBadge tone='chart-1' size='sm'>
          <Gauge />
        </IconBadge>
        <span className='text-sm font-semibold'>{t('Welfare points')}</span>
        <Badge variant='secondary' className='h-5 px-2 text-[10px]'>
          {total.toLocaleString()} {t('points')}
        </Badge>
      </div>

      <div className='mt-3 grid grid-cols-2 gap-3 text-xs'>
        <div>
          <div className='text-muted-foreground text-[10px] font-medium tracking-wider uppercase'>
            {t('Daily points')}
          </div>
          <div className='mt-0.5 text-lg font-semibold tabular-nums'>
            {daily.toLocaleString()}
          </div>
          <div className='text-muted-foreground mt-0.5 text-[11px]'>
            {t('Reset daily at 00:00 (UTC+8)')}
          </div>
        </div>
        <div>
          <div className='text-muted-foreground text-[10px] font-medium tracking-wider uppercase'>
            {t('Permanent points')}
          </div>
          <div className='mt-0.5 text-lg font-semibold tabular-nums'>
            {permanent.toLocaleString()}
          </div>
          <div className='text-muted-foreground mt-0.5 text-[11px]'>
            {t('From invites, spend rebates and sponsorship')}
          </div>
        </div>
      </div>

      <p className='text-muted-foreground mt-3 border-t border-dashed pt-2.5 text-xs leading-relaxed'>
        {t(
          'Each successful call in the welfare group consumes points. Different models cost different amounts; the cheapest is not always free.'
        )}
      </p>
      <p className='text-muted-foreground mt-1 text-xs leading-relaxed'>
        {t(
          'Earn points from the daily base grant, the new-user gift, check-in, invites, yesterday wallet spend and sponsorship.'
        )}
      </p>
    </div>
  )
}
