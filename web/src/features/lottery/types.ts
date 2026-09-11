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

/**
 * 福利页活动：抽奖（改造#12）
 *
 * 目录约定：福利页的每个独立活动各自建一个 feature 目录，
 * 即 web/src/features/<activity>/{types.ts, api.ts, components/}。
 * 不要再往 features/invite 或 features/profile 里塞新活动，
 * 那两个目录已经承载了「福利等级 / 邀请 / 签到」，继续堆会让职责互相污染。
 */

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  /** 服务端错误分类，前端据此决定是引导分享还是直接置灰 */
  code?: LotteryErrorCode
  data?: T
}

export type LotteryErrorCode =
  | 'draw_failed'
  | 'share_required'
  | 'exhausted'
  | 'ended'
  | 'not_started'

/**
 * 奖池档位，用于奖池预览。
 *
 * 刻意不含份数：份数是库存状态，暴露出去用户就能推算「还剩几份」并挑时间刷。
 * 需要「限量」的感知时用文案表达，不交出精确库存。
 */
export interface LotteryPrize {
  id: string
  name: string
  /** 额度 */
  quota: number
  /** 折算的 token 数（仅展示用，不参与计费） */
  token_hint: number
  /** 折算的人民币金额 */
  amount: number
}

/** 我的单次抽奖记录 */
export interface LotteryRecord {
  /** 第几次抽奖（1 起） */
  seq: number
  prize_id: string
  prize_name: string
  quota_awarded: number
  token_hint: number
  amount: number
  created_at: number
}

export type LotteryStatus = 'running' | 'not_started' | 'ended'

export interface LotteryStatusData {
  enabled: boolean
  title: string
  status: LotteryStatus
  start_time: number
  end_time: number
  max_draws_per_user: number
  /** 无需分享即可抽取的次数 */
  free_draws: number
  /** 本轮活动是否已完成分享动作 */
  shared: boolean
  draws_used: number
  draws_left: number
  /**
   * token 折算用的综合单价（元 / 百万 token），用于文案标注口径。
   * 服务端按 deepseek-flash 价 + 分组补贴倍率 + 高缓存假设推出来，仅展示用。
   */
  anchor_price: number
  /** 分享按钮复制到剪贴板的文案，由后台配置 */
  share_text: string
  prizes: LotteryPrize[]
  records: LotteryRecord[]
}

export interface LotteryDrawResult {
  won: boolean
  seq: number
  prize_id: string
  prize_name: string
  quota_awarded: number
  token_hint: number
  amount: number
  max_draws_per_user: number
  free_draws: number
  shared: boolean
  draws_used: number
  draws_left: number
}
