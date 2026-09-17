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
  AdminSponsorshipPage,
  SponsorshipInfo,
  SponsorshipPayRequest,
  SponsorshipPayResponse,
  UserSponsorshipStats,
} from './types'

interface SponsorshipInfoResponse {
  success?: boolean
  message?: string
  data?: SponsorshipInfo
}

interface SponsorshipSelfResponse {
  success?: boolean
  message?: string
  data?: UserSponsorshipStats
}

/**
 * 读取支持页所需的全部公开数据（选项配置 + 支持者名单）。
 * 不需要登录：访客也要能看到名单，独立首页也是同源直连这个接口。
 */
export async function getSponsorshipInfo(): Promise<SponsorshipInfoResponse> {
  const res = await api.get('/api/sponsors')
  return res.data
}

/** 读取当前用户自己的支持概况（含真实身份，与公开名单无关）。 */
export async function getMySponsorship(): Promise<SponsorshipSelfResponse> {
  const res = await api.get('/api/sponsorship/self')
  return res.data
}

/** 创建支持订单，拿到网关地址与表单参数后由调用方跳转支付。 */
export async function requestSponsorshipPayment(
  request: SponsorshipPayRequest
): Promise<SponsorshipPayResponse> {
  const res = await api.post('/api/sponsorship/epay/pay', request)
  return res.data
}

// ---- 后台（仅管理员）----

interface AdminSponsorshipListResponse {
  success?: boolean
  message?: string
  data?: AdminSponsorshipPage
}

/** 后台分页拉取支持记录，用于审核寄语；username 为空时不按用户过滤。 */
export async function listSponsorshipOrders(options: {
  page?: number
  pageSize?: number
  username?: string
}): Promise<AdminSponsorshipListResponse> {
  const res = await api.get('/api/sponsorship/admin/orders', {
    params: {
      page: options.page ?? 1,
      page_size: options.pageSize ?? 20,
      username: options.username ?? '',
    },
  })
  return res.data
}

/** 处理一条寄语：approved 通过，rejected 下架。 */
export async function updateSponsorshipMessageStatus(
  id: number,
  status: string
): Promise<{ success?: boolean; message?: string }> {
  const res = await api.put(`/api/sponsorship/admin/orders/${id}/message`, {
    status,
  })
  return res.data
}
