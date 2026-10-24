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
  FlowQuotaDataItem,
  QuotaDataItem,
  UptimeGroupResult,
} from './types'

// ============================================================================
// Dashboard APIs
// ============================================================================

// ----------------------------------------------------------------------------
// Quota & Usage Data
// ----------------------------------------------------------------------------

// Get user quota data within a time range
// Admin users get all users' data by default.
export async function getUserQuotaDates(
  params: {
    start_timestamp: number
    end_timestamp: number
    default_time?: string
    username?: string
  },
  isAdmin = false
) {
  const endpoint = isAdmin ? '/api/data' : '/api/data/self'
  const res = await api.get<{ success: boolean; data: QuotaDataItem[] }>(
    endpoint,
    { params }
  )
  return res.data
}

// ----------------------------------------------------------------------------
// System Monitoring
// ----------------------------------------------------------------------------

export async function getUserQuotaDataByUsers(params: {
  start_timestamp: number
  end_timestamp: number
}) {
  const res = await api.get<{ success: boolean; data: QuotaDataItem[] }>(
    '/api/data/users',
    { params }
  )
  return res.data
}

export async function getFlowQuotaDates(
  params: {
    start_timestamp: number
    end_timestamp: number
    default_time?: string
    username?: string
  },
  isAdmin = false
) {
  const endpoint = isAdmin ? '/api/data/flow' : '/api/data/flow/self'
  const res = await api.get<{
    success: boolean
    data?: FlowQuotaDataItem[]
    message?: string
  }>(endpoint, { params })
  return res.data
}

// Get uptime monitoring status for all services
export async function getUptimeStatus() {
  const res = await api.get<{ success: boolean; data: UptimeGroupResult[] }>(
    '/api/uptime/status'
  )
  return res.data
}

// ----------------------------------------------------------------------------
// Overview start card
// ----------------------------------------------------------------------------

/**
 * 概览「开始使用」卡片用的两个金额口径（近 30 天）。
 *
 * 后端读的是 master 预聚合的每日表，不是现扫日志：福利分组的分组倍率为 0，
 * logs.quota 恒等于 0，真实价值必须解析 logs.other 才能还原，那个代价不能
 * 摊到每次打开概览上。数值单位是 quota，展示一律走 formatQuota。
 */
export interface OverviewStats {
  days: number
  welfare_value: number
  subsidy_value: number
  welfare_group: string
  /** 累计被管理员手动加上的额度（quota 单位）。没有独立字段，靠审计日志还原。 */
  gift_quota: number
  /** 补贴分组里最低的分组倍率，0.3 = 3 折；0 表示没有可用的补贴分组。 */
  subsidy_discount: number
  /** 全站可用模型总数（去重）。用来给「最高补贴至 X 折」补一句「N 个可用」。 */
  total_model_count: number
}

export async function getOverviewStats() {
  const res = await api.get<{
    success: boolean
    data?: OverviewStats
    message?: string
  }>('/api/user/overview_stats')
  return res.data
}

/** 积分流水的一条。daily / permanent 是这笔之后的两个桶余额。 */
export interface WelfarePointLogItem {
  id: number
  change: number
  daily: number
  permanent: number
  source: string
  source_ref: string
  created_at: number
}

export async function getWelfarePointLogs(params: {
  p: number
  page_size?: number
}) {
  const res = await api.get<{
    success: boolean
    message?: string
    data?: {
      page: number
      page_size: number
      total: number
      items: WelfarePointLogItem[]
    }
  }>('/api/user/welfare_points/logs', { params })
  return res.data
}
