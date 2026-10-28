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
import { describe, expect, test } from 'vitest'

import { resolveSizeOptions } from '../lib/image-models'
import type { ImageModelCaps } from '../types'

function caps(rules: ImageModelCaps['rules']): ImageModelCaps {
  return { version: 1, rules }
}

describe('resolveSizeOptions', () => {
  test('renders size rules with a multiplication sign', () => {
    const table = caps([
      { model: 'gpt-image-2', size: ['1024x1024', '4096x4096'] },
    ])

    expect(resolveSizeOptions(table, 'gpt-image-2')).toEqual([
      { label: '1024×1024', value: '1024x1024', param: 'size' },
      { label: '4096×4096', value: '4096x4096', param: 'size' },
    ])
  })

  test('keeps aspect ratio rules on the aspect_ratio parameter', () => {
    const table = caps([
      {
        model: 'grok-imagine-image',
        aspect_ratio: ['16:9', '1:1'],
      },
    ])

    expect(resolveSizeOptions(table, 'grok-imagine-image')).toEqual([
      { label: '16:9', value: '16:9', param: 'aspect_ratio' },
      { label: '1:1', value: '1:1', param: 'aspect_ratio' },
    ])
  })

  test('applies prefix rules to model name variants', () => {
    const table = caps([
      { match: 'prefix', model: 'gpt-image-2.5', size: ['1254x1254'] },
    ])

    expect(resolveSizeOptions(table, 'gpt-image-2.5-flare')).toHaveLength(1)
  })

  // 与后端一致：exact 必须压过 prefix，否则 gpt-image-2 会被 2.5 的前缀规则吞掉。
  test('prefers exact matches over prefix matches', () => {
    const table = caps([
      { match: 'prefix', model: 'gpt-image-2', size: ['1024x1024'] },
      { match: 'exact', model: 'gpt-image-2', size: ['4096x4096'] },
    ])

    expect(resolveSizeOptions(table, 'gpt-image-2')).toEqual([
      { label: '4096×4096', value: '4096x4096', param: 'size' },
    ])
  })

  test('exposes nothing for models missing from the table', () => {
    const table = caps([{ model: 'gpt-image-2', size: ['1024x1024'] }])

    expect(resolveSizeOptions(table, 'some-new-model')).toEqual([])
  })

  test('exposes nothing when the capability table failed to load', () => {
    expect(resolveSizeOptions(null, 'gpt-image-2')).toEqual([])
  })

  test('exposes nothing for a rule that locks the resolution', () => {
    const table = caps([
      { model: 'grok-imagine-image-2.0', note: '上游忽略所有尺寸参数' },
    ])

    expect(resolveSizeOptions(table, 'grok-imagine-image-2.0')).toEqual([])
  })

  test('matches case-insensitively and ignores surrounding blanks', () => {
    const table = caps([{ model: 'GPT-Image-2', size: ['1024x1024'] }])

    expect(resolveSizeOptions(table, ' gpt-image-2 ')).toHaveLength(1)
  })
})
