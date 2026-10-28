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
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'

import type {
  GeneratedImage,
  ImageGenerationRequest,
  ImageModelCaps,
  ImagePromptPage,
} from './types'

export type GroupOption = {
  label: string
  value: string
  ratio?: number
  desc?: string
}

const IMAGE_ENDPOINT = '/pg/images/generations'
const IMAGE_EDITS_ENDPOINT = '/pg/images/edits'
const PROMPT_PAGE_SIZE = 24

export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get('/api/user/self/groups')
  const { data } = res
  if (!data.success || !data.data) {
    return []
  }
  const groups = data.data as Record<string, { desc: string; ratio: number }>
  return Object.entries(groups).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}

export async function getGroupModels(group: string): Promise<string[]> {
  const res = await api.get('/api/user/models', { params: { group } })
  const { data } = res
  if (!data.success || !Array.isArray(data.data)) {
    return []
  }
  return data.data as string[]
}

/**
 * 拉取生图模型能力表。
 *
 * 上游中转站会随时改模型清单和参数口径，这张表由服务端下发、运维热更新，前端
 * 不再硬编码"哪个模型支持哪些尺寸"。拿不到时返回 null，调用方按"没有可选
 * 分辨率"处理——宁可少给一个下拉框，也不要给一组上游根本不认的选项。
 */
export async function getImageModelCaps(): Promise<ImageModelCaps | null> {
  try {
    const res = await api.get('/api/image-model-caps')
    const body = res.data as { success?: boolean; data?: ImageModelCaps }
    if (!body?.success || !body.data || !Array.isArray(body.data.rules)) {
      return null
    }
    return body.data
  } catch {
    return null
  }
}

export async function generateImages(
  payload: ImageGenerationRequest
): Promise<GeneratedImage[]> {
  try {
    const res = await api.post(IMAGE_ENDPOINT, payload, {
      skipErrorHandler: true,
    } as Record<string, unknown>)
    return readGeneratedImages(res.data)
  } catch (error) {
    throw new Error(getServerErrorMessage(error))
  }
}

/**
 * 带参考图时走改图接口：上游要求 multipart 的 image 字段，多张就重复同一字段。
 * 参考图不会以链接形式出现，浏览器也不需要知道上游地址。
 */
export async function generateImageEdits(
  files: File[],
  payload: ImageGenerationRequest
): Promise<GeneratedImage[]> {
  const form = new FormData()
  form.append('model', payload.model)
  form.append('prompt', payload.prompt)
  if (payload.n) {
    form.append('n', String(payload.n))
  }
  if (payload.size) {
    form.append('size', payload.size)
  }
  if (payload.aspect_ratio) {
    form.append('aspect_ratio', payload.aspect_ratio)
  }
  for (const file of files) {
    form.append('image', file, file.name)
  }

  try {
    const res = await api.post(IMAGE_EDITS_ENDPOINT, form, {
      skipErrorHandler: true,
    } as Record<string, unknown>)
    return readGeneratedImages(res.data)
  } catch (error) {
    throw new Error(getServerErrorMessage(error))
  }
}

function readGeneratedImages(data: unknown): GeneratedImage[] {
  const images = ((data as { data?: GeneratedImage[] })?.data ??
    []) as GeneratedImage[]
  return images.filter((image) => Boolean(image.b64_json))
}

export async function getImagePrompts(params: {
  category?: string
  search?: string
  page: number
}): Promise<ImagePromptPage> {
  const res = await api.get('/api/prompts', {
    params: {
      category: params.category || undefined,
      search: params.search || undefined,
      page: params.page,
      page_size: PROMPT_PAGE_SIZE,
    },
  })
  return requireServerSuccess<{ data: ImagePromptPage }>(res.data).data
}

/** 封面外链在国内经常不可达，加载失败时回落到同源代理。 */
export function imagePromptCoverProxyURL(coverURL: string): string {
  return `/api/prompts/cover?url=${encodeURIComponent(coverURL)}`
}
