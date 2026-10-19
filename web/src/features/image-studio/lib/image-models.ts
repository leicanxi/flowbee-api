import type { SizeOption } from '../types'

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
 * Resolution tiers encoded in the model name cannot be overridden at request
 * time, so those models get no selector at all.
 */
function hasTierSuffix(modelName: string): boolean {
  return /-(1k|2k|4k)$/.test(modelName.toLowerCase())
}

export function getSizeOptions(modelName: string): SizeOption[] {
  if (hasTierSuffix(modelName)) {
    return []
  }
  const name = modelName.toLowerCase()
  if (name.includes('grok-imagine')) {
    return [
      { label: '16:9', value: '16:9', param: 'aspect_ratio' },
      { label: '1:1', value: '1:1', param: 'aspect_ratio' },
      { label: '9:16', value: '9:16', param: 'aspect_ratio' },
    ]
  }
  if (name.includes('gpt-image') || name.startsWith('dall-e')) {
    return [
      { label: '1024×1024', value: '1024x1024', param: 'size' },
      { label: '1536×1024', value: '1536x1024', param: 'size' },
      { label: '1024×1536', value: '1024x1536', param: 'size' },
    ]
  }
  return []
}

export function pickDefaultModel(models: string[]): string {
  return models.find((model) => model.includes('banana')) ?? models[0] ?? ''
}
