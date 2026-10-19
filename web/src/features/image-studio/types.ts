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
