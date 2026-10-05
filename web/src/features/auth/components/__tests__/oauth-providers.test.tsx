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
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SystemStatus } from '@/features/auth/types'

import { OAuthProviders } from '../oauth-providers'

// 改造#38：自定义 OAuth 按钮必须渲染后端下发的 icon。
// 把图标替换成可断言的文本标记，避免在测试里引入真实图标库。
vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: (name?: string) => (name ? `ICON:${name}` : null),
}))

vi.mock('@/features/auth/hooks/use-oauth-login', () => ({
  useOAuthLogin: () => ({
    isLoading: false,
    githubButtonText: '',
    githubButtonDisabled: false,
    handleGitHubLogin: vi.fn(),
    handleDiscordLogin: vi.fn(),
    handleOIDCLogin: vi.fn(),
    handleLinuxDOLogin: vi.fn(),
    handleTelegramLogin: vi.fn(),
    handleCustomOAuthLogin: vi.fn(),
    isTelegramDialogOpen: false,
    isTelegramPending: false,
    handleTelegramAuthorization: vi.fn(),
    setIsTelegramDialogOpen: vi.fn(),
  }),
}))

function buildStatus(icon: string): SystemStatus {
  return {
    custom_oauth_providers: [
      {
        id: 1,
        name: 'Google',
        slug: 'google',
        icon,
        client_id: 'client',
        authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        scopes: 'openid profile email',
      },
    ],
  }
}

describe('OAuthProviders 自定义 OAuth 图标', () => {
  it('provider 配置了 icon 时渲染出图标', () => {
    render(<OAuthProviders status={buildStatus('Google')} />)
    expect(screen.getByText(/ICON:Google/)).toBeTruthy()
  })

  it('provider 未配置 icon 时不渲染图标且不报错', () => {
    render(<OAuthProviders status={buildStatus('')} />)
    expect(screen.queryByText(/^ICON:/)).toBeNull()
  })
})
