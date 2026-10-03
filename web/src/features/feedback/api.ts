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

export interface FeedbackSsoResponse {
  success: boolean
  message?: string
  data?: { url?: string }
}

/**
 * 取得带签名的反馈中心跳转地址（改造#31）。
 *
 * 服务端只返回地址、不直接 302：前端要先替用户把"没绑邮箱"这类受阻原因讲清楚，
 * 让人一头撞进对方的错误页是最差的体验。
 */
export async function getFeedbackSsoUrl(): Promise<FeedbackSsoResponse> {
  const res = await api.get('/api/user/feedback_sso', {
    skipErrorHandler: true,
  })
  return res.data
}
