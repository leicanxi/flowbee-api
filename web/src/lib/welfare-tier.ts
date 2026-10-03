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
import type { TFunction } from 'i18next'

/**
 * 改造#33：「免费模型调用速率」的档位解析只留一份实现。
 *
 * 福利页摘要条、钱包页标题下的档位胶囊、概览页第 2 步的提示，回答的是同一个
 * 问题：「我在第几档、离下一档还差多少、解锁了没有」。原来只有福利页写了一份，
 * 三处各写一遍的话，最迟在第二个实现上就会漏掉「余额低于最低档」这条边界 ——
 * 后端 setting.GetBalanceTierLevels 在这时返回的 level 是 -1，而按 0 起步的
 * 写法会把未解锁的用户标成第一档，再告诉他「距下一档还差 X」，那个 X 并非
 * 他真正该补的缺口（改造#23 修的就是这个）。
 *
 * 术语用「档」而不是「Lv」：这一版曾短暂改成「免费模型调用等级 / Lv1」，
 * 但 Lv 会被读成累积型会员等级（充一次升一级、不会掉），而真实规则是余额随时
 * 决定档位、余额降了会掉档，且它是「每分钟多少次」的闸门而不是累计额度。
 */

/** 公开的档位上限。第 4/5 档是「未开放」展示位，余额再高也不会命中。 */
export const OPEN_WELFARE_TIER_COUNT = 3

/**
 * 档位显示名。走 i18n 而不是写死常量：七个语言包里只有中文用「1 档」，
 * 英文是 "Tier 1"。levelIndex 是 0 起步的下标，展示时 +1。
 */
export function welfareTierLabel(t: TFunction, levelIndex: number): string {
  return t('Tier {{number}}', { number: levelIndex + 1 })
}

export interface WelfareTier {
  /** 档位下标。-1 表示余额未达最低档（未解锁），必须原样保留而不是归零。 */
  level: number
  locked: boolean
  isTopTier: boolean
  /** 下一档下标；undefined 表示没有下一档。 */
  nextLevelIndex?: number
  /** 进度目标余额：未解锁时是第一档，已解锁时是下一档，顶档是当前档。 */
  progressTargetQuota: number
  progressPercent: number
}

/**
 * thresholds 传后端下发的 welfare_thresholds（已升序）；未配置时兜底为 [0]，
 * 保证入门档恒存在。
 */
export function resolveWelfareTier(
  quota: number,
  thresholds: number[]
): WelfareTier {
  const tiers = thresholds.length > 0 ? thresholds : [0]

  let level = -1
  for (let i = 0; i < tiers.length; i++) {
    if (quota >= tiers[i]) level = i
  }
  // 截断到开放档位（第 4/5 档永不自动命中）；-1 表示未解锁，必须保留。
  level = Math.min(level, OPEN_WELFARE_TIER_COUNT - 1)

  const openTierCount = Math.min(tiers.length, OPEN_WELFARE_TIER_COUNT)
  const nextLevelIndex = level + 1 < openTierCount ? level + 1 : undefined
  const locked = level < 0
  const progressLevelIndex = locked ? 0 : nextLevelIndex
  const progressTargetQuota =
    progressLevelIndex === undefined ? tiers[level] : tiers[progressLevelIndex]
  const progressPercent =
    progressTargetQuota > 0
      ? Math.min(Math.max((quota / progressTargetQuota) * 100, 0), 100)
      : 100

  return {
    level,
    locked,
    isTopTier: level >= 0 && nextLevelIndex === undefined,
    nextLevelIndex,
    progressTargetQuota,
    progressPercent,
  }
}
