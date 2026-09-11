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
import { api } from '@/lib/api'

import type {
  ApiResponse,
  LotteryDrawResult,
  LotteryStatusData,
} from './types'

/**
 * 获取抽奖活动状态与我的抽奖记录（改造#12）
 *
 * 活动开关与起止时间以服务端为准。前端的活动结束标记只是展示状态，
 * 真正的拦截在服务端 —— 否则用户直接调接口就能绕过时间限制。
 */
export async function getLotteryStatus(): Promise<
  ApiResponse<LotteryStatusData>
> {
  const res = await api.get('/api/user/lottery')
  return res.data
}

/**
 * 执行一次抽奖
 *
 * 中奖与否都会消耗一次机会（服务端用唯一索引保证次数上限）。
 * 免费次数用完后，服务端会返回 code='share_required'，前端据此弹出分享引导 ——
 * 这一步不能只在前端判断，否则直接调接口就能跳过分享。
 */
export async function drawLottery(
  turnstileToken?: string
): Promise<ApiResponse<LotteryDrawResult>> {
  const url = turnstileToken
    ? `/api/user/lottery/draw?turnstile=${encodeURIComponent(turnstileToken)}`
    : '/api/user/lottery/draw'
  const res = await api.post(url)
  return res.data
}

/**
 * 记录一次分享动作，解锁剩余的抽奖机会
 *
 * 服务端按 (user_id, round_key) 幂等处理：重复点击不会攒出多次机会。
 */
export async function shareLottery(): Promise<ApiResponse<LotteryStateSlice>> {
  const res = await api.post('/api/user/lottery/share')
  return res.data
}

/** 抽奖 / 分享接口共同返回的次数状态 */
export interface LotteryStateSlice {
  max_draws_per_user: number
  free_draws: number
  shared: boolean
  draws_used: number
  draws_left: number
}
