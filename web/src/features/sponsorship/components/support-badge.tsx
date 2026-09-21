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
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { SPONSOR_BADGE_CONTINUOUS, SPONSOR_BADGE_EARLY } from '../types'

/**
 * 称号 id → 文案 key 与配色。
 *
 * 称号一律用白话短语 —— 站点的等级名已改为 Lv 编号（Lv1/Lv2…），
 * 与「早期支持者 / 持续支持者」这类白话称号在形式上天然分开，用户扫一眼
 * 就能分清哪个是等级、哪个是称号，不需要靠理解词义去区分。
 *
 * 两个称号给不同的颜色而不是同一个灰胶囊：它们在名单里是并排出现的，
 * 同色时会被读成一串无语义的长标签，分开配色才能一眼看出这是"两种身份"。
 */
const BADGE_STYLES: Record<string, { labelKey: string; className: string }> = {
  [SPONSOR_BADGE_EARLY]: {
    labelKey: 'Early supporter',
    className: 'bg-[#f5e9d2] text-[#8a6524] border-[#e8d6b2]',
  },
  [SPONSOR_BADGE_CONTINUOUS]: {
    labelKey: 'Ongoing supporter',
    className: 'bg-[#e3efe5] text-[#3d6748] border-[#cde1d2]',
  },
}

/**
 * 称号胶囊。未识别的 id 直接不渲染，避免后端加了新称号时前端出现空胶囊。
 *
 * onCream 用于气泡墙那种固定暖白底：那里的底色不随主题变，
 * 沿用主题 token 的话，深色模式下会出现深色描边压在米白底上；
 * 顺便切换到更紧凑的尺寸，否则标准尺寸的胶囊会把气泡顶宽。
 */
export function SupportBadge(props: { badge: string; onCream?: boolean }) {
  const { t } = useTranslation()
  const style = BADGE_STYLES[props.badge]
  if (!style) {
    return null
  }
  return (
    <span
      className={cn(
        'rounded-full border font-medium whitespace-nowrap',
        props.onCream
          ? cn('px-1.5 text-[10px] leading-4', style.className)
          : 'border-border/70 text-muted-foreground px-2 py-0.5 text-[11px]'
      )}
    >
      {t(style.labelKey)}
    </span>
  )
}
