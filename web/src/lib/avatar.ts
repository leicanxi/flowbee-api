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
import type { CSSProperties } from 'react'

export type UserAvatarStyle = Pick<CSSProperties, 'backgroundColor' | 'color'>

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

export function getUserAvatarStyle(name: string): UserAvatarStyle {
  const hash = hashString(name)
  const hue = hash % 360
  const saturation = 54 + (hash % 8)
  const lightness = 52 + ((hash >> 4) % 8)

  return {
    backgroundColor: `hsl(${hue} ${saturation}% ${lightness}%)`,
    color: 'white',
  }
}

export function getUserAvatarFallback(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

// ============================================================================
// 改造#39：第三方账号头像
// ============================================================================

const QQ_MAIL_PATTERN = /^(\d{5,11})@(?:qq\.com|foxmail\.com|vip\.qq\.com)$/i
const NUMERIC_ID_PATTERN = /^\d+$/

/** 可用于推导头像的账号信息 */
export interface AccountAvatarSource {
  email?: string | null
  github_id?: string | null
}

/**
 * 用第三方账号推导头像地址，拿不到时返回 null。
 *
 * QQ 邮箱的数字前缀（如 123456789@qq.com）就是本人的 QQ 号：邮箱只在注册和
 * 绑定邮箱时写入，两条路都强制验证码校验，而改资料接口不接受 email 字段，
 * 所以取到的头像一定是本人的，不存在张冠李戴。前缀是字母的自定义别名不匹配，
 * 会自然回退到其它来源。
 *
 * GitHub 官方头像是 `avatars.githubusercontent.com/u/<数字ID>`，用数字 ID 拼接
 * 而不是 `login`，因为 login 可以被用户改名。后端没有下发 API 返回的
 * `avatar_url`，但下发了 `github_id`，所以走拼接。
 */
export function getAccountAvatarUrl(
  source: AccountAvatarSource
): string | null {
  const qqMatch = QQ_MAIL_PATTERN.exec(source.email?.trim() ?? '')
  if (qqMatch) {
    return `https://q1.qlogo.cn/g?b=qq&nk=${qqMatch[1]}&s=160`
  }

  const githubId = source.github_id?.trim() ?? ''
  if (NUMERIC_ID_PATTERN.test(githubId)) {
    return `https://avatars.githubusercontent.com/u/${githubId}?s=160`
  }

  return null
}

/**
 * 用户是否在偏好设置里选择了「使用默认头像」。
 * 只认 `default` 一个值：老用户的 setting 里没有这个键，读出来是空，
 * 走「使用第三方头像」的默认行为，这样新功能对存量用户直接生效。
 */
export function isAccountAvatarDisabled(
  setting?: string | Record<string, unknown> | null
): boolean {
  if (!setting) return false

  let parsed: Record<string, unknown>
  if (typeof setting === 'string') {
    try {
      parsed = JSON.parse(setting) as Record<string, unknown>
    } catch {
      return false
    }
  } else {
    parsed = setting
  }

  return parsed.avatar_preference === 'default'
}
