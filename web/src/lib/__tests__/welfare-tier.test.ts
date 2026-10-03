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
 * 改造#33：等级解析的边界测试。
 *
 * 重点只有一个：余额低于最低档时必须停在 -1（未解锁），而不是被当成第一档。
 * 后端 setting.GetBalanceTierLevels 对这种情况返回 -1，且 middleware 会直接
 * 429；一旦在这里把 -1 归成 0，用户就会被告知「距 Lv2 还差 X」—— 一个他其实
 * 还没资格谈的缺口。改造#23 修的就是这个，此处把它锁在纯函数上，因为现在
 * 福利页、钱包页、概览页三个入口共用这一份实现。
 */
import { describe, expect, test } from 'vitest'

import { OPEN_WELFARE_TIER_COUNT, resolveWelfareTier } from '../welfare-tier'

/** 线上福利组阈值（options 表 ModelRequestRateLimitBalanceTier["福利"]）：¥1 / ¥2 / ¥5。 */
const THRESHOLDS = [500000, 1000000, 2500000]

describe('resolveWelfareTier', () => {
  test('余额低于最低档 = 未解锁，缺口指向第一档而不是当前档', () => {
    const tier = resolveWelfareTier(100000, THRESHOLDS)

    expect(tier.level).toBe(-1)
    expect(tier.locked).toBe(true)
    expect(tier.isTopTier).toBe(false)
    expect(tier.nextLevelIndex).toBe(0)
    expect(tier.progressTargetQuota).toBe(500000)
    expect(tier.progressPercent).toBe(20)
  })

  test('刚过第一档：档位是 Lv1，缺口指向 Lv2', () => {
    const tier = resolveWelfareTier(600000, THRESHOLDS)

    expect(tier.level).toBe(0)
    expect(tier.locked).toBe(false)
    expect(tier.nextLevelIndex).toBe(1)
    expect(tier.progressTargetQuota).toBe(1000000)
    expect(tier.progressPercent).toBe(60)
  })

  test('中间档与顶档', () => {
    const middle = resolveWelfareTier(1000000, THRESHOLDS)
    expect(middle.level).toBe(1)
    expect(middle.nextLevelIndex).toBe(2)
    expect(middle.isTopTier).toBe(false)

    const top = resolveWelfareTier(2500000, THRESHOLDS)
    expect(top.level).toBe(2)
    expect(top.nextLevelIndex).toBeUndefined()
    expect(top.isTopTier).toBe(true)
    expect(top.progressTargetQuota).toBe(2500000)
    expect(top.progressPercent).toBe(100)
  })

  test('余额再高也停在开放的最高档', () => {
    const tier = resolveWelfareTier(99999999, THRESHOLDS)

    expect(tier.level).toBe(OPEN_WELFARE_TIER_COUNT - 1)
    expect(tier.isTopTier).toBe(true)
  })

  test('后端未配置阈值时兜底为单一入门档', () => {
    const tier = resolveWelfareTier(0, [])

    expect(tier.level).toBe(0)
    expect(tier.locked).toBe(false)
    expect(tier.nextLevelIndex).toBeUndefined()
    expect(tier.isTopTier).toBe(true)
    expect(tier.progressPercent).toBe(100)
  })
})
