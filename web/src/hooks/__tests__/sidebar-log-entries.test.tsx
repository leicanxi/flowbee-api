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
 * 侧边栏「绘图日志 / 任务日志」拆项回归测试。
 *
 * 历史 bug：这两项共用同一条侧边栏记录 —— url 指向 /usage-logs/task，
 * configUrls 同时登记 drawing 与 task，而可见性判断是 configUrls.some(enabled)，
 * 于是：①只开启「绘图日志」，侧边栏出现的却是「任务日志」，点进去也是任务页；
 * ②两个都开启时只显示一条记录。修复后两项各自登记各自的 url 与模块。
 *
 * 这里跑的是真实的侧边栏数据 + 真实的可见性过滤组合，断言用的是线上中文语言包，
 * 保证以后再有人把它们合并回一条记录会立刻测试失败。
 */
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'

const adminState: { value: string | null } = { value: null }

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({
    status: { SidebarModulesAdmin: adminState.value },
    loading: false,
    error: null,
  }),
}))

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { useSidebarData } = await import('@/hooks/use-sidebar-data')
const { useSidebarConfig } = await import('@/hooks/use-sidebar-config')
const zhResource = (await import('@/i18n/locales/zh.json')).default

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'zh',
  resources: { zh: { translation: zhResource.translation } },
})

function wrapper({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}

type ConsoleConfig = {
  detail?: boolean
  token?: boolean
  log?: boolean
  midjourney?: boolean
  task?: boolean
}

/** 用给定的 site 级配置跑一遍「侧边栏数据 → 可见性过滤」，返回常规组里留下的 [title, url]。 */
function visibleConsoleEntries(consoleConfig: ConsoleConfig) {
  adminState.value = JSON.stringify({
    chat: { enabled: true, playground: true, chat: true },
    console: { enabled: true, ...consoleConfig },
    personal: { enabled: true, topup: true, personal: true },
    admin: {
      enabled: true,
      channel: true,
      models: true,
      user: true,
      setting: true,
      redemption: true,
      subscription: true,
    },
  })

  const { result } = renderHook(
    () => {
      const { navGroups } = useSidebarData()
      return useSidebarConfig(navGroups)
    },
    { wrapper }
  )

  const group = result.current.find((candidate) => candidate.id === 'general')
  if (!group) throw new Error('常规组没有被渲染出来')

  return group.items.map((item): [string, string] => [
    item.title,
    'url' in item ? String(item.url) : '',
  ])
}

function logEntries(entries: [string, string][]) {
  return entries.filter(([, url]) => url.startsWith('/usage-logs/'))
}

describe('侧边栏日志入口', () => {
  test('绘图日志与任务日志是两条各自独立的记录', () => {
    const drawing = visibleConsoleEntries({
      log: true,
      midjourney: true,
      task: true,
    }).find(([, url]) => url === '/usage-logs/drawing')
    const task = visibleConsoleEntries({
      log: true,
      midjourney: true,
      task: true,
    }).find(([, url]) => url === '/usage-logs/task')

    expect(drawing?.[0]).toBe('绘图日志')
    expect(task?.[0]).toBe('任务日志')
  })

  test('只开启绘图日志时，侧边栏只出现绘图日志且指向绘图页', () => {
    const entries = logEntries(
      visibleConsoleEntries({ log: false, midjourney: true, task: false })
    )

    expect(entries).toEqual([['绘图日志', '/usage-logs/drawing']])
  })

  test('只开启任务日志时，侧边栏只出现任务日志', () => {
    const entries = logEntries(
      visibleConsoleEntries({ log: false, midjourney: false, task: true })
    )

    expect(entries).toEqual([['任务日志', '/usage-logs/task']])
  })

  test('两个都开启时，两个入口都显示', () => {
    const entries = logEntries(
      visibleConsoleEntries({ log: true, midjourney: true, task: true })
    )

    expect(entries).toEqual([
      ['使用日志', '/usage-logs/common'],
      ['绘图日志', '/usage-logs/drawing'],
      ['任务日志', '/usage-logs/task'],
    ])
  })
})
