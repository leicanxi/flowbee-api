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
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'

// 两个胶囊都是站内跳转（TanStack Router 的 Link）。本文件只关心文案与落点，
// 不搭整套路由，所以把它换成普通 <a>。
vi.mock('@tanstack/react-router', async () => {
  const { createElement } = await import('react')
  return {
    Link: (props: { to?: string; className?: string; children?: ReactNode }) =>
      createElement(
        'a',
        { href: props.to, className: props.className },
        props.children
      ),
  }
})

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { WelfareLinks } = await import('../welfare-links')
const zhResource = (await import('@/i18n/locales/zh.json')).default

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'zh',
  resources: { zh: { translation: zhResource.translation } },
})

function userWith(points: number) {
  return { welfare_points_total: points } as never
}

function renderLinks(points: number) {
  return render(
    <I18nextProvider i18n={i18n}>
      <WelfareLinks user={userWith(points)} />
    </I18nextProvider>
  )
}

/** 去掉空白后比对，避免受 JSX 换行与模板插值空格影响。 */
function textOf(container: HTMLElement) {
  return (container.textContent ?? '').replaceAll(/\s+/g, '')
}

describe('钱包页入口胶囊', () => {
  test('显示福利积分余额，福利入口并列', () => {
    const { container } = renderLinks(42)
    const text = textOf(container)

    expect(text).toContain('福利积分')
    expect(text).toContain('42')
    expect(text).toContain('福利')
    expect(text).toContain('免费余额')
  })

  test('两个胶囊都落到福利页', () => {
    const { container } = renderLinks(42)
    const hrefs = [...container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href')
    )

    expect(hrefs).toEqual(['/invite', '/invite'])
  })
})
