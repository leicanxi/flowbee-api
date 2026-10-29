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
import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Card } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty'

import type { SponsorshipPartner } from '../types'

/**
 * 固定留三个位置。
 *
 * 不足三个时补齐虚线空位，而不是让这一块缩短：这一块存在的意义之一是
 * 让潜在合作方看到「这里可以放项目」，只剩一个格子会被读成偶然。
 */
const MIN_SLOTS = 3

/**
 * 合作伙伴位。
 *
 * 和上面的支持者墙分开：墙只感谢、不排序、不展示金额；这里是商业展示位，
 * 按后台配置顺序排列。真实接广告后把这一块整块标注即可，不用碰气泡。
 *
 * 链接由后端过滤过 http(s)，这里直接用；rel 用 sponsored/nofollow，
 * 避免付费链接被当成自然推荐影响搜索。
 */
export function PartnerSlots(props: {
  partners: SponsorshipPartner[]
  contact: string
}) {
  const { t } = useTranslation()
  const { partners, contact } = props

  const emptyCount = Math.max(0, MIN_SLOTS - partners.length)
  let contactHref = ''
  if (contact) {
    contactHref = contact.includes('@') ? `mailto:${contact}` : contact
  }

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
        <h2 className='text-sm font-medium'>{t('Partners')}</h2>
        <span className='text-muted-foreground text-xs'>
          {t('Long-term partner projects and sites')}
        </span>
      </div>

      <div className='grid gap-3 sm:grid-cols-3'>
        {partners.map((partner) => (
          <a
            key={`${partner.name}-${partner.url}`}
            href={partner.url}
            target='_blank'
            rel='sponsored nofollow noopener'
            aria-label={t('Visit {{name}}', { name: partner.name })}
            className='group block rounded-xl focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none'
          >
            <Card
              size='sm'
              className='h-full gap-1.5 px-4 transition-colors group-hover:bg-muted/40'
            >
              <div className='flex items-start justify-between gap-2'>
                <span className='truncate text-sm font-medium'>
                  {partner.name}
                </span>
                <ArrowUpRight
                  className='text-muted-foreground size-3.5 shrink-0'
                  aria-hidden='true'
                />
              </div>
              {partner.note && (
                <p className='text-muted-foreground line-clamp-2 text-xs leading-5'>
                  {partner.note}
                </p>
              )}
            </Card>
          </a>
        ))}

        {Array.from({ length: emptyCount }, (_, index) => (
          <Empty
            key={`partner-slot-${index}`}
            className='min-h-20 gap-1 border border-dashed border-border/70 p-4'
          >
            <EmptyTitle>{t('This spot is open')}</EmptyTitle>
            <EmptyDescription className='text-xs'>
              {contactHref ? (
                <a href={contactHref}>{t('Put your project here')}</a>
              ) : (
                t('Put your project here')
              )}
            </EmptyDescription>
          </Empty>
        ))}
      </div>
    </div>
  )
}
