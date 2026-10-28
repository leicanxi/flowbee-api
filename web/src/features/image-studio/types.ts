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
export type ImageGenerationRequest = {
  model: string
  prompt: string
  n?: number
  size?: string
  aspect_ratio?: string
}

export type GeneratedImage = {
  b64_json: string
  revised_prompt?: string
}

export type GenerationRecord = {
  id: string
  prompt: string
  model: string
  images: GeneratedImage[]
  durationMs: number
  createdAt: number
  error?: string
}

export type SizeOption = {
  label: string
  value: string
  param: 'size' | 'aspect_ratio'
}

/** 一个模型允许客户端指定的出图参数，由服务端能力表下发。 */
export type ImageModelCapsParams = {
  size?: string[]
  aspect_ratio?: string[]
}

/**
 * 能力表的一条规则。服务端按 exact > prefix > suffix > contains 的顺序匹配，
 * 前端必须用同一套优先级，否则同一个模型在两边的选项会对不上。
 */
export type ImageModelCapsRule = ImageModelCapsParams & {
  match?: 'exact' | 'prefix' | 'suffix' | 'contains'
  model: string
  note?: string
}

export type ImageModelCaps = {
  version: number
  rules: ImageModelCapsRule[]
}

export type ImagePrompt = {
  id: string
  title: string
  prompt: string
  cover_url: string
  category: string
  tags?: string[]
  source_name: string
  source_url: string
}

export type ImagePromptCategory = {
  name: string
  count: number
}

export type ImagePromptPage = {
  items: ImagePrompt[]
  total: number
  page: number
  page_size: number
  categories: ImagePromptCategory[]
}
