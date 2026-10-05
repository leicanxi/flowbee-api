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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  getAccountAvatarUrl,
  getUserAvatarFallback,
  getUserAvatarStyle,
  isAccountAvatarDisabled,
} from '@/lib/avatar'

/** 渲染头像所需的用户信息，`UserProfile` 与登录态 `AuthUser` 都能直接传入 */
export interface UserAvatarSource {
  username?: string
  display_name?: string
  email?: string | null
  github_id?: string | null
  setting?: string | Record<string, unknown> | null
}

interface UserAvatarProps {
  user: UserAvatarSource
  className?: string
  fallbackClassName?: string
}

/**
 * 改造#39：统一头像渲染。能从 QQ 邮箱 / GitHub 推导出头像就显示图片，
 * 否则由 Base UI 自动回退到「首字母 + 哈希底色」的默认头像
 * （它的 Fallback 在图片加载失败或未提供图片时才会渲染，所以下载失败、
 * 域名被墙都不会留白）。用户选择「默认头像」时直接跳过第三方头像。
 */
export function UserAvatar({
  user,
  className,
  fallbackClassName,
}: UserAvatarProps) {
  const name = user.username || user.display_name || ''
  const avatarUrl = isAccountAvatarDisabled(user.setting)
    ? null
    : getAccountAvatarUrl(user)

  return (
    <Avatar className={className}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
      <AvatarFallback
        className={fallbackClassName}
        style={getUserAvatarStyle(name)}
      >
        {getUserAvatarFallback(name)}
      </AvatarFallback>
    </Avatar>
  )
}
