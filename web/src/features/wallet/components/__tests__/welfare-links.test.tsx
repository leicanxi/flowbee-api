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

/*
 * 改造#33：钱包页标题下面那两个入口胶囊的回归测试。
 *
 * 守三件事：
 * 1. 档位胶囊必须说清「它由余额决定」—— 这一版最初写的是「免费模型调用等级 /
 *    Lv1」，而 Lv 会被读成累积型会员等级（充一次升一级、不会掉）；真实规则是
 *    余额随时决定档位，余额降了会掉档，且它是「每分钟多少次」的闸门；
 * 2. 余额低于最低档时显示「锁定」，不标成 1 档（后端此时返回 level = -1）；
 * 3. 不出现具体请求速率数字 —— 额度是防刷闸门，不当产品能力展示（改造#23 的
 *    结论，福利页 / 钱包页 / 概览页三个入口都要守）。
 *
 * 用真实的中文语言包渲染，断言的就是线上会显示的那几个字。
 */

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

/** 线上真实档位（福利组）：¥1 / ¥2 / ¥5。 */
const THRESHOLDS = [500000, 1000000, 2500000]
/** quota → 元 的换算单位，与后端 QuotaPerUnit 一致。 */
const YUAN = 500000

function userWith(quotaInYuan: number) {
  return { quota: quotaInYuan * YUAN, welfare_thresholds: THRESHOLDS } as never
}

function renderLinks(quotaInYuan: number) {
  return render(
    <I18nextProvider i18n={i18n}>
      <WelfareLinks user={userWith(quotaInYuan)} />
    </I18nextProvider>
  )
}

/** 去掉空白后比对，避免受 JSX 换行与模板插值空格影响。 */
function textOf(container: HTMLElement) {
  return (container.textContent ?? '').replaceAll(/\s+/g, '')
}

describe('钱包页入口胶囊', () => {
  test('已解锁：档位胶囊带「余额决定」，福利胶囊并列', () => {
    const { container } = renderLinks(1.2)
    const text = textOf(container)

    expect(text).toContain('免费模型调用速率')
    expect(text).toContain('1档')
    expect(text).toContain('(余额决定)')
    expect(text).toContain('福利')
    expect(text).toContain('(免费余额)')
    expect(text).not.toContain('锁定')
  })

  test('未解锁：显示锁定，不被标成 1 档', () => {
    const { container } = renderLinks(0.2)
    const text = textOf(container)

    expect(text).toContain('锁定')
    expect(text).not.toContain('1档')
  })

  test('两个胶囊都落到福利页', () => {
    const { container } = renderLinks(1.2)
    const hrefs = [...container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href')
    )

    expect(hrefs).toEqual(['/invite', '/invite'])
  })

  test('不展示任何具体请求速率', () => {
    for (const quota of [0.2, 1.2, 5]) {
      const { container } = renderLinks(quota)
      const text = textOf(container)

      expect(text).not.toMatch(/\d+次|\d+次\/分钟|请求\/分钟/)
    }
  })
})
