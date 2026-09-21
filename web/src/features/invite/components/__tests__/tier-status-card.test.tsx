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
 * 改造#24：福利页档位摘要条的文案与状态回归测试。
 *
 * 用**真实的中文语言包**渲染，断言的就是线上会显示的那几行字。这样以后
 * 任何人改动档位名、摘要条文案或 429 文案时，跑一次 vitest 就能知道有没有
 * 把「不显示具体速率」「最高档不引导充值」这些决定改回去。
 *
 * 改造#27：摘要条下方的 Lv1–Lv5 轮播大卡已整块删除，本文件同时守住
 * 「删掉的内容不会再回来」——否则只删一次、下次重构又加回来是很容易发生的。
 */
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { TierStatusCard } = await import('../tier-status-card')
const { useSystemConfigStore, DEFAULT_CURRENCY_CONFIG } =
  await import('@/stores/system-config-store')
const zhResource = (await import('@/i18n/locales/zh.json')).default

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'zh',
  resources: { zh: { translation: zhResource.translation } },
})

/** 线上真实档位（options 表 ModelRequestRateLimitBalanceTier["福利"]）：¥1 / ¥2 / ¥5。 */
const THRESHOLDS = [500000, 1000000, 2500000]
/** quota → 元 的换算单位，与后端 QuotaPerUnit 一致。 */
const YUAN = 500000

function renderCard(quotaInYuan: number | null) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TierStatusCard
        user={
          (quotaInYuan === null
            ? null
            : {
                quota: quotaInYuan * YUAN,
                welfare_thresholds: THRESHOLDS,
              }) as never
        }
      />
    </I18nextProvider>
  )
}

/** 去掉空白后比对，避免受 JSX 换行与模板插值空格影响。 */
function textOf(container: HTMLElement) {
  return (container.textContent ?? '').replaceAll(/\s+/g, '')
}

describe('福利页档位摘要条', () => {
  beforeEach(() => {
    const config = useSystemConfigStore.getState().config
    useSystemConfigStore.setState({
      config: {
        ...config,
        currency: {
          ...DEFAULT_CURRENCY_CONFIG,
          quotaDisplayType: 'CNY',
          usdExchangeRate: 1,
        },
      },
    })
  })

  // 改造#27：升级提示里的金额是「距下一档的差额」，不是目标余额 —— 原来接的
  // 词条写的是「余额达到 {{amount}} 可升级至 {{tier}}」，等于把这笔差额说成
  // 了目标余额。这里锁死「距 LvX 还差 ¥Y」的说法，避免退回旧口径。
  test('中间档展示当前档位、缺口差额与下一档名', () => {
    const { container } = renderCard(1.2)
    const text = textOf(container)

    expect(text).toContain('免费模型调用速率')
    expect(text).toContain('Lv1')
    expect(text).not.toContain('锁定')
    expect(text).toMatch(/距Lv2还差¥0\.8(?:000)?/)
    expect(text).not.toContain('可升级至')
    expect(text).toContain('福利分组的免费模型已解锁')
  })

  test('余额低于最低档时档位显示「锁定」，不再被标成第一档', () => {
    const { container } = renderCard(0.2)
    const text = textOf(container)

    expect(text).toContain('锁定')
    expect(text).toMatch(/余额需达到¥1(?:\.00)?才能使用福利分组的免费模型/)
    expect(text).toMatch(/距Lv1还差¥0\.8(?:000)?/)
    // 改 #23 之前这里会标成第一档的当前等级（-1 起步的回归防线）。
    expect(text).not.toContain('当前等级')
  })

  test('最高档只陈述事实，不再出现「继续充值不会提升速率」', () => {
    const { container } = renderCard(5)
    const text = textOf(container)

    expect(text).toContain('Lv3')
    expect(text).toContain('已达最高档位：免费模型的调用速率已是上限。')
    expect(text).toContain('已达最高公开档位')
    expect(text).not.toContain('继续充值')
  })

  // 改造#27：整块删除的 Lv1–Lv5 轮播大卡（含四个权益图标）不得再出现。
  // 「福利等级」标题与旧的免费额度说明段是改造#26 删掉的，一并守在这里。
  test('已删除的轮播大卡与历史标题都不会出现', () => {
    for (const quota of [0.2, 1.2, 5]) {
      const { container } = renderCard(quota)
      const text = textOf(container)

      for (const gone of [
        '当前等级',
        '下一步解锁',
        '基础公益调用',
        '站长补贴',
        '腾讯公益',
        '更多权益开放中',
        '福利等级',
        '为避免人机刷号',
        '门槛极低',
      ]) {
        expect(text).not.toContain(gone)
      }
    }
  })

  test('不展示任何具体请求速率（防刷闸门不当权益展示）', () => {
    for (const quota of [0.2, 1.2, 5]) {
      const { container } = renderCard(quota)
      const text = textOf(container)

      expect(text).not.toMatch(/请求\/分钟|次\/分钟|每分钟/)
      expect(text).not.toMatch(/\d+次/)
    }
  })

  test('user 为空时兜底渲染，不抛错', () => {
    const { container } = renderCard(null)

    expect(textOf(container)).toContain('免费模型调用速率')
  })
})
