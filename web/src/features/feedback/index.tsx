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
// 改造#31：侧边栏「心愿与反馈」的中转页。
//
// 反馈中心（FeedLog）在另一个域上，读不到本站的会话，所以身份只能由本站签一张票带过去。
// 本页只做三件事：查邮箱 → 换跳转地址 → 立即跳走。
//
// 之所以不做成"后端 302 直链"：FeedLog 按邮箱认人，没绑邮箱的用户点进去只会撞上
// 对面的错误页。多这一层页面，才能把"为什么进不去、怎么才能进"讲成人话。
import { useNavigate } from '@tanstack/react-router'
import { Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { getSelf } from '@/lib/api'

import { getFeedbackSsoUrl } from './api'

type FeedbackStage = 'checking' | 'need-email' | 'error'

export function Feedback() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [stage, setStage] = useState<FeedbackStage>('checking')

  useEffect(() => {
    let cancelled = false

    const openFeedbackCenter = async () => {
      // 先查邮箱：FeedLog 的身份键就是邮箱，没邮箱连令牌都签不出来。
      // 用现成的 /api/user/self，不为"能不能进"再开一个接口。
      const self = await getSelf()
      if (cancelled) return

      const email =
        typeof self?.data?.email === 'string' ? self.data.email.trim() : ''
      if (email === '') {
        setStage('need-email')
        return
      }

      const res = await getFeedbackSsoUrl()
      if (cancelled) return

      const url = res?.data?.url
      if (!res?.success || url == null || url === '') {
        // 失败原因（未配置密钥之类）对用户没有行动价值，只留给排查用。
        // eslint-disable-next-line no-console
        console.error('Failed to open the feedback center:', res?.message)
        setStage('error')
        return
      }

      // 用 replace 而不是 href：令牌会短暂出现在地址栏与历史记录里，不该留下；
      // 顺带把本中转页从历史中顶掉，用户从反馈中心返回时直接回到原来那一页。
      window.location.replace(url)
    }

    openFeedbackCenter().catch((error: unknown) => {
      if (cancelled) return
      // eslint-disable-next-line no-console
      console.error('Failed to request the feedback sso url:', error)
      setStage('error')
    })

    return () => {
      cancelled = true
    }
  }, [])

  if (stage === 'checking') {
    return (
      <div className='flex min-h-[60vh] items-center justify-center px-4'>
        <LoadingState message={t('Opening the feedback center…')} />
      </div>
    )
  }

  if (stage === 'need-email') {
    return (
      <div className='flex min-h-[60vh] items-center justify-center px-4'>
        <ErrorState
          icon={Mail}
          title={t('Bind an email to use the feedback center')}
          description={t(
            'The feedback center identifies you by email. Add one in your profile first, then come back here.'
          )}
          action={
            <Button
              size='sm'
              onClick={() => {
                void navigate({ to: '/profile' })
              }}
            >
              {t('Go to profile')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className='flex min-h-[60vh] items-center justify-center px-4'>
      <ErrorState
        title={t('Could not open the feedback center')}
        description={t(
          'The feedback center is temporarily unavailable. Please try again later.'
        )}
        onRetry={() => window.location.reload()}
      />
    </div>
  )
}
