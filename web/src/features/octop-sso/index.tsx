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
// Octop 单点登录中转页。
//
// 方向与反馈中心相反：那边的入口在本站、用户已经登录；这边是 Octop 的登录页把
// 浏览器整页送过来。本站会话已在（否则 _authenticated 会先弹登录页），所以本页
// 只做三件事：取 state → 换签名地址 → 立即跳走。
import { useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'

import { getOctopSsoUrl } from './api'

type OctopSsoStage = 'checking' | 'error'

export function OctopSso() {
  const { t } = useTranslation()
  const { state } = useSearch({ from: '/_authenticated/sso/octop' })
  const [stage, setStage] = useState<OctopSsoStage>('checking')

  useEffect(() => {
    let cancelled = false

    const openOctop = async () => {
      // state 由 Octop 生成，缺了就无法完成它的一次性校验，只能当失败处理。
      if (!state) {
        // eslint-disable-next-line no-console
        console.error('Octop SSO handoff is missing its state parameter.')
        setStage('error')
        return
      }

      const res = await getOctopSsoUrl(state)
      if (cancelled) return

      const url = res?.data?.url
      if (!res?.success || url == null || url === '') {
        // 失败原因（未配置密钥之类）对用户没有行动价值，只留给排查用。
        // eslint-disable-next-line no-console
        console.error('Failed to obtain the Octop sso url:', res?.message)
        setStage('error')
        return
      }

      // 用 replace 而不是 href：令牌会短暂出现在地址栏与历史记录里，不该留下；
      // 顺带把本中转页从历史中顶掉。
      window.location.replace(url)
    }

    openOctop().catch((error: unknown) => {
      if (cancelled) return
      // eslint-disable-next-line no-console
      console.error('Failed to request the Octop sso url:', error)
      setStage('error')
    })

    return () => {
      cancelled = true
    }
  }, [state])

  if (stage === 'checking') {
    return (
      <div className='flex min-h-[60vh] items-center justify-center px-4'>
        <LoadingState message={t('Signing you in with Octop…')} />
      </div>
    )
  }

  return (
    <div className='flex min-h-[60vh] items-center justify-center px-4'>
      <ErrorState
        title={t('Could not sign you in with Octop')}
        description={t(
          'Octop single sign-on is temporarily unavailable. Please try again later.'
        )}
        onRetry={() => window.location.reload()}
      />
    </div>
  )
}
