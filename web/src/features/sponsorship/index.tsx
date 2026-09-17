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
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { PublicLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import { getMySponsorship, getSponsorshipInfo } from './api'
import { MySupport } from './components/my-support'
import { SponsorWall } from './components/sponsor-wall'
import { SupportSection } from './components/support-section'

export type SponsorshipPaymentResult = 'success' | 'fail' | 'pending'

/**
 * 支持页。
 *
 * 页面顺序是刻意的：上来先是人和他们留下的话，而不是付款表单。
 * 访客第一眼该看到的是"有这么多人在支持"，不是"请付钱"。
 * 支持入口在名单之后，用锚点跳到本页的付款区 —— 不新开页面，
 * 因为看完名单的人已经有付款意愿了，再跳走一次就多一次流失机会。
 *
 * 路由刻意放在 _authenticated 之外：名单要让未登录的访客也看得到，
 * 把它锁在登录后才可见，等于把奖状放进抽屉。
 */
export function Sponsors(props: { paymentResult?: SponsorshipPaymentResult }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const isAuthenticated = !!auth.user
  const toastedRef = useRef(false)

  const { data: infoResponse, isLoading } = useQuery({
    queryKey: ['sponsorship-info'],
    queryFn: getSponsorshipInfo,
  })

  const { data: selfResponse } = useQuery({
    queryKey: ['sponsorship-self'],
    queryFn: getMySponsorship,
    enabled: isAuthenticated,
  })

  // 支付回跳提示。提示过一次就把参数从地址栏清掉，
  // 否则用户刷新页面会再看到一遍"感谢支持"。
  useEffect(() => {
    const result = props.paymentResult
    if (!result || toastedRef.current) {
      return
    }
    toastedRef.current = true
    if (result === 'success') {
      toast.success(t('Thank you. Your support is on the wall now.'))
    } else if (result === 'fail') {
      toast.error(t('We could not confirm that payment. Please check your records.'))
    } else {
      toast.info(t('Payment is still being confirmed. Refresh in a moment.'))
    }
    navigate({ to: '/sponsors', search: {}, replace: true })
  }, [props.paymentResult, navigate, t])

  const info = infoResponse?.data

  if (isLoading) {
    return (
      <PublicLayout>
        <div className='text-muted-foreground flex min-h-[40vh] items-center justify-center text-sm'>
          {t('Loading...')}
        </div>
      </PublicLayout>
    )
  }

  if (!info?.enabled) {
    return (
      <PublicLayout>
        <div className='mx-auto max-w-2xl py-16 text-center'>
          <h1 className='text-2xl font-semibold tracking-tight'>
            {t('Support')}
          </h1>
          <p className='text-muted-foreground mt-3 text-sm'>
            {t('Support is not open right now.')}
          </p>
        </div>
      </PublicLayout>
    )
  }

  const userName = auth.user?.display_name || auth.user?.username || ''

  return (
    <PublicLayout>
      <div className='mx-auto max-w-4xl space-y-12 pb-16 md:space-y-14'>
        <header className='max-w-2xl'>
          <h1 className='text-3xl font-semibold tracking-tight text-balance md:text-4xl'>
            {t('Supported by people who wanted it to keep running')}
          </h1>
          <p className='text-muted-foreground mt-4 leading-relaxed'>
            {t('Free and subsidised calls are not something the site owner can carry alone — a few people quietly chip in. Every amount is thanked the same way, and nobody is ranked by how much they gave.')}
          </p>
        </header>

        <section aria-label={t('Supporters')}>
          <SponsorWall sponsors={info.sponsors} />
        </section>

        <div className='text-center'>
          <Button
            render={<a href='#support' />}
            className='h-11 rounded-full px-7 text-sm font-semibold'
          >
            {t('I want to support too')}
          </Button>
        </div>

        <section id='support' className='scroll-mt-24' aria-label={t('Support')}>
          <SupportSection info={info} isAuthenticated={isAuthenticated} />
        </section>

        <section aria-label={t('Your support')}>
          <MySupport
            stats={selfResponse?.data ?? null}
            userName={userName}
            isAuthenticated={isAuthenticated}
          />
        </section>
      </div>
    </PublicLayout>
  )
}
