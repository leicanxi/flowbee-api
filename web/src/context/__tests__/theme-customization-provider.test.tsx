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
 * 改造#32：主题默认圆角的回归测试。
 *
 * 默认圆角从「Auto（= 不写属性、跟随预设）」改成明确档位 xl(= 1rem) 之后，
 * provider 里写 `data-theme-radius` 的判断必须按**字面量 'default'** 比较，
 * 而不是拿 DEFAULT_THEME_CUSTOMIZATION.radius 去比 —— 否则用户在默认档位时
 * 属性会被移除，`[data-theme-radius='xl']` 永不生效，静默回落到 anthropic
 * 预设的 0.625rem，而且没有任何报错。
 *
 * 本文件锁住的就是这条：**新访客（无 cookie）打开页面时，body 上必须真的
 * 出现 data-theme-radius="xl"**。谁要是把判断改回常量比较，这里会红。
 */
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  ThemeCustomizationProvider,
  useThemeCustomization,
} from '@/context/theme-customization-provider'
import { DEFAULT_THEME_CUSTOMIZATION } from '@/lib/theme-customization'

type ThemeContext = ReturnType<typeof useThemeCustomization>

let ctx: ThemeContext

function Capture() {
  ctx = useThemeCustomization()
  return null
}

function renderProvider() {
  return render(
    <ThemeCustomizationProvider>
      <Capture />
    </ThemeCustomizationProvider>
  )
}

function resetCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`
  }
}

beforeEach(() => {
  resetCookies()
  document.body.removeAttribute('data-theme-preset')
  document.body.removeAttribute('data-theme-radius')
  document.body.removeAttribute('data-theme-font')
})

afterEach(() => {
  resetCookies()
})

describe('默认主题圆角（改造#32）', () => {
  test('新访客（无 cookie）默认是 xl，且属性真的写到了 body 上', () => {
    renderProvider()

    expect(DEFAULT_THEME_CUSTOMIZATION.radius).toBe('xl')
    expect(ctx.customization.radius).toBe('xl')
    expect(document.body.getAttribute('data-theme-radius')).toBe('xl')
  })

  test('新访客的 preset / font 默认不变', () => {
    renderProvider()

    expect(document.body.getAttribute('data-theme-preset')).toBe('anthropic')
    expect(document.body.getAttribute('data-theme-font')).toBe('sans')
  })

  test('显式选 default（Auto）时移除属性，回落到预设圆角', async () => {
    renderProvider()
    await act(async () => {
      ctx.setRadius('default')
    })

    expect(ctx.customization.radius).toBe('default')
    expect(document.body.hasAttribute('data-theme-radius')).toBe(false)
  })

  test('cookie 为 default 时同样不写属性', () => {
    document.cookie = 'theme_radius=default; Path=/'
    renderProvider()

    expect(ctx.customization.radius).toBe('default')
    expect(document.body.hasAttribute('data-theme-radius')).toBe(false)
  })

  test('选具体档位写属性，选回默认值时属性重新出现', async () => {
    renderProvider()

    await act(async () => {
      ctx.setRadius('sm')
    })
    expect(document.body.getAttribute('data-theme-radius')).toBe('sm')

    await act(async () => {
      ctx.setRadius('xl')
    })
    expect(ctx.customization.radius).toBe('xl')
    expect(document.body.getAttribute('data-theme-radius')).toBe('xl')
  })

  test('reset 回到默认 xl（不是 default），并清掉 radius cookie', async () => {
    renderProvider()

    await act(async () => {
      ctx.setRadius('none')
    })
    expect(document.body.getAttribute('data-theme-radius')).toBe('none')

    await act(async () => {
      ctx.resetCustomization()
    })
    expect(ctx.customization.radius).toBe('xl')
    expect(document.body.getAttribute('data-theme-radius')).toBe('xl')
    expect(document.cookie).not.toContain('theme_radius')
  })
})
