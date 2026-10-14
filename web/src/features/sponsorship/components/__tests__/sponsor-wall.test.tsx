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
/*
 * 改造#40：公开页头像渲染的回归测试。
 *
 * 赞助墙的头像有三条路径，任何一条改错都会直接暴露在公开页上：
 *   1. 后端下发了 avatar（本站代理路径）→ 渲染图片，不是字母；
 *   2. 后端没下发（用户关掉了账号头像 / 没有可推导来源）→ 回退字母头像；
 *   3. 勾了匿名的条目 → 只出现爱心，就算字段被误填了 avatar 也不渲染图片。
 *
 * 第 3 条是这里最要紧的：匿名是「别人看不出你是谁」的承诺，一旦头像漏出来，
 * 名字藏得再好也没用。组件把匿名分支放在最前面 return，这条测试守住它。
 *
 * 用真实的中文语言包渲染，断言的就是线上会显示的那一套。
 */
import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

// Base UI 的 Avatar.Image 只在图片「真的加载成功」之后才渲染 <img>，而 jsdom 里
// 永远不会有加载成功这件事 —— 直接用真实现，第 1 条断言必然是 0 个 img。
// 这里只把 Image 换成「有 src 就直接渲染」的替身，Avatar / Fallback 仍用真的，
// 于是测到的是我们自己的分支选择：有没有把后端下发的路径交给 Image。
vi.mock('@/components/ui/avatar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/avatar')>()
  return {
    ...actual,
    AvatarImage: (props: { src?: string; alt?: string }) =>
      props.src ? <img src={props.src} alt={props.alt ?? ''} /> : null,
  }
})

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { SponsorWall } = await import('../sponsor-wall')
const zhResource = (await import('@/i18n/locales/zh.json')).default

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'zh',
  resources: { zh: { translation: zhResource.translation } },
})

const AVATAR = '/api/avatar/42.deadbeefdeadbeef'

function buildSponsor(options: { anonymous?: boolean; avatar?: string }) {
  return {
    name: '老雷',
    anonymous: options.anonymous ?? false,
    message: '支持一下',
    badges: [] as string[],
    last_time: 1700000000,
    ...(options.avatar === undefined ? {} : { avatar: options.avatar }),
  }
}

function renderWall(sponsor: ReturnType<typeof buildSponsor>) {
  return render(
    <I18nextProvider i18n={i18n}>
      <SponsorWall sponsors={[sponsor]} />
    </I18nextProvider>
  )
}

describe('赞助墙头像（改造#40）', () => {
  test('后端下发了代理路径时渲染头像图片', () => {
    const { container } = renderWall(buildSponsor({ avatar: AVATAR }))
    const images = [...container.querySelectorAll('img')]
    // 气泡会在行内重复、轨道再放两份，所以数量不是 1；关键是它们都指向同一个代理路径。
    expect(images.length).toBeGreaterThan(0)
    for (const image of images) {
      expect(image.getAttribute('src')).toBe(AVATAR)
    }
  })

  test('没有代理路径时回退字母头像，页面上不出现图片', () => {
    const { container } = renderWall(buildSponsor({}))
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(container.textContent).toContain('老')
  })

  test('匿名条目只显示爱心，字段被误填 avatar 也不渲染图片', () => {
    const { container } = renderWall(
      buildSponsor({ anonymous: true, avatar: AVATAR })
    )
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(container.textContent).toContain('匿名支持者')
  })
})
