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
import type { ImageModelCaps, ImageModelCapsRule, SizeOption } from '../types'

const IMAGE_MODEL_PREFIXES = [
  'dall-e',
  'gpt-image',
  'grok-imagine',
  'flux',
  'imagen-',
]

/**
 * Image models are not tagged by the backend, so names are matched here.
 * Video and chat models such as grok-video-1.5 or gemini-3.7-flash must not
 * slip through, hence the explicit prefix/marker checks below.
 */
export function isImageModel(modelName: string): boolean {
  const name = modelName.toLowerCase()
  if (IMAGE_MODEL_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return true
  }
  return (
    name.includes('banana') ||
    name.includes('image-preview') ||
    name.endsWith('-image') ||
    /-image-/.test(name)
  )
}

/**
 * 必须与服务端 setting/image_model_caps.go 的优先级一致：
 * exact > prefix > suffix > contains，同级别取表中靠前的一条。
 */
const MATCH_RANK: Record<string, number> = {
  exact: 0,
  prefix: 1,
  suffix: 2,
  contains: 3,
}

function matchesRule(rule: ImageModelCapsRule, name: string): number | null {
  const match = (rule.match ?? 'exact').toLowerCase()
  const rank = MATCH_RANK[match]
  const target = rule.model?.trim().toLowerCase()
  if (rank === undefined || !target) {
    return null
  }
  let hit = false
  if (match === 'prefix') {
    hit = name.startsWith(target)
  } else if (match === 'suffix') {
    hit = name.endsWith(target)
  } else if (match === 'contains') {
    hit = name.includes(target)
  } else {
    hit = name === target
  }
  return hit ? rank : null
}

/** `1024x1024` → `1024×1024`，比例串原样显示。 */
function formatLabel(value: string): string {
  return value.replace(/x/i, '×')
}

/**
 * 按服务端下发的能力表算出一个模型可选的分辨率。
 *
 * 没有命中任何规则时返回空数组，前端据此不显示选择器——这既覆盖"模型名里
 * 已经编码了档位"，也覆盖"上游新出的模型还没进表"两种情况。给一组猜测的
 * 选项比不给更糟：用户以为选了生效，实际上游直接忽略。
 */
export function resolveSizeOptions(
  caps: ImageModelCaps | null,
  modelName: string
): SizeOption[] {
  const name = modelName.trim().toLowerCase()
  if (!caps || !name) {
    return []
  }

  let bestRank = Number.POSITIVE_INFINITY
  let best: ImageModelCapsRule | null = null
  for (const rule of caps.rules) {
    const rank = matchesRule(rule, name)
    if (rank === null || rank >= bestRank) {
      continue
    }
    bestRank = rank
    best = rule
  }
  if (!best) {
    return []
  }

  if (best.size?.length) {
    return best.size.map((value) => ({
      label: formatLabel(value),
      value,
      param: 'size',
    }))
  }
  if (best.aspect_ratio?.length) {
    return best.aspect_ratio.map((value) => ({
      label: value,
      value,
      param: 'aspect_ratio',
    }))
  }
  return []
}

export function pickDefaultModel(models: string[]): string {
  return models.find((model) => model.includes('banana')) ?? models[0] ?? ''
}
