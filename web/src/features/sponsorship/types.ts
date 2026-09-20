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

/** 称号 id，与后端 model 层常量一一对应。 */
export const SPONSOR_BADGE_EARLY = 'early_supporter'
export const SPONSOR_BADGE_CONTINUOUS = 'continuous_supporter'

export const SPONSOR_CUSTOM_TIER_ID = 'custom'

/**
 * 公开名单里的一条。
 *
 * 后端刻意不下发 userId 与金额：匿名条目带上 id 就不算匿名，
 * 而金额一旦可见，"同等感谢"就会变成一句空话。
 */
export interface SponsorEntry {
  name: string
  anonymous: boolean
  message: string
  badges: string[]
  last_time: number
}

export interface SponsorshipTierOption {
  id: string
  label: string
  icon_url: string
  money: number
  custom: boolean
}

/** 本月筹集进度。按自然月统计，月初归零。 */
export interface SponsorshipGoal {
  name: string
  target_money: number
  raised_money: number
  supporter_count: number
  support_count: number
  period_start: number
  achieved: boolean
}

export interface SponsorshipInfo {
  enabled: boolean
  title: string
  options: SponsorshipTierOption[]
  custom_min_money: number
  custom_max_money: number
  max_message_length: number
  default_message: string
  sponsors: SponsorEntry[]
  /** 未配置筹集目标时为 null。 */
  goal: SponsorshipGoal | null
}

export interface UserSponsorshipStats {
  supported: boolean
  support_count: number
  first_time: number
  last_time: number
  badges: string[]
  anonymous: boolean
  message: string
}

export interface SponsorshipPayRequest {
  tier_id: string
  money?: number
  payment_method: string
  anonymous: boolean
  message: string
}

export interface SponsorshipPayResponse {
  success?: boolean
  message?: string
  data?: Record<string, unknown>
  url?: string
}

/** 后台列表里的一条支持记录，含真实身份与金额，仅管理员可见。 */
export interface AdminSponsorshipOrder {
  id: number
  user_id: number
  username: string
  display_name: string
  money: number
  trade_no: string
  payment_method: string
  status: string
  anonymous: boolean
  message: string
  message_status: string
  create_time: number
  complete_time: number
}

/** 后台列表上方的汇总，只统计已付款的记录。 */
export interface SponsorshipAdminStats {
  support_count: number
  supporter_num: number
  total_money: number
}

export interface AdminSponsorshipPage {
  items: AdminSponsorshipOrder[]
  total: number
  page: number
  page_size: number
  stats: SponsorshipAdminStats
}
