import { api } from '@/lib/api'

import type { GeneratedImage, ImageGenerationRequest } from './types'

export type GroupOption = {
  label: string
  value: string
  ratio?: number
  desc?: string
}

const IMAGE_ENDPOINT = '/pg/images/generations'

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

export async function generateImages(
  payload: ImageGenerationRequest
): Promise<GeneratedImage[]> {
  try {
    const res = await api.post(IMAGE_ENDPOINT, payload, {
      skipErrorHandler: true,
    } as Record<string, unknown>)
    const images = (res.data?.data ?? []) as GeneratedImage[]
    return images.filter((image) => Boolean(image.b64_json))
  } catch (error) {
    throw new Error(readErrorMessage(error))
  }
}

function readErrorMessage(error: unknown): string {
  const response = (error as { response?: { data?: unknown } })?.response
  const body = response?.data as
    | { error?: { message?: string }; message?: string }
    | undefined
  const message = body?.error?.message ?? body?.message
  if (message) {
    return message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'Request failed'
}
