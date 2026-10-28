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
import { ArrowDown } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import {
  generateImageEdits,
  generateImages,
  getGroupModels,
  getImageModelCaps,
  getUserGroups,
  type GroupOption,
} from './api'
import { Composer } from './components/composer'
import { PromptGallery } from './components/prompt-gallery'
import { ResultGrid } from './components/result-grid'
import {
  isImageModel,
  pickDefaultModel,
  resolveSizeOptions,
} from './lib/image-models'
import {
  isSupportedReferenceImage,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES,
} from './lib/reference-images'
import type {
  GenerationRecord,
  ImageGenerationRequest,
  ImageModelCaps,
} from './types'

export function ImageStudio() {
  const { t } = useTranslation()
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [group, setGroup] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [caps, setCaps] = useState<ImageModelCaps | null>(null)
  const [size, setSize] = useState('')
  const [count, setCount] = useState(1)
  const [prompt, setPrompt] = useState('')
  const [referenceImages, setReferenceImages] = useState<File[]>([])
  const [records, setRecords] = useState<GenerationRecord[]>([])
  const [isGenerating, setIsGenerating] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const galleryRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const sizeOptions = useMemo(
    () => resolveSizeOptions(caps, model),
    [caps, model]
  )

  const modelOptions = useMemo(
    () => models.map((name) => ({ label: name, value: name })),
    [models]
  )

  useEffect(() => {
    let cancelled = false
    void getUserGroups().then((result) => {
      if (cancelled) return
      setGroups(result)
      const preferred =
        result.find((item) => item.value === 'default') ?? result[0]
      setGroup(preferred?.value ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 能力表决定每个模型能选哪些分辨率，与分组/模型列表互不依赖，独立加载。
  useEffect(() => {
    let cancelled = false
    void getImageModelCaps().then((result) => {
      if (cancelled) return
      setCaps(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!group) return
    let cancelled = false
    void getGroupModels(group).then((result) => {
      if (cancelled) return
      const imageModels = result.filter(isImageModel)
      setModels(imageModels)
      setModel(pickDefaultModel(imageModels))
    })
    return () => {
      cancelled = true
    }
  }, [group])

  useEffect(() => {
    setSize(sizeOptions[0]?.value ?? '')
  }, [sizeOptions])

  const addReferenceImages = useCallback(
    (files: File[]) => {
      const accepted: File[] = []
      const rejected = new Set<'count' | 'size' | 'type'>()
      let total = referenceImages.length
      for (const file of files) {
        if (total >= MAX_REFERENCE_IMAGES) {
          rejected.add('count')
          break
        }
        if (!isSupportedReferenceImage(file)) {
          rejected.add('type')
          continue
        }
        if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
          rejected.add('size')
          continue
        }
        // 同一张图重复添加没有意义，直接按文件名+大小+修改时间去重。
        if (
          referenceImages.some(
            (item) =>
              item.name === file.name &&
              item.size === file.size &&
              item.lastModified === file.lastModified
          )
        ) {
          continue
        }
        accepted.push(file)
        total += 1
      }
      if (accepted.length > 0) {
        setReferenceImages((previous) => [...previous, ...accepted])
      }
      if (rejected.has('count')) {
        toast.error(
          t('A maximum of {{count}} reference images is allowed', {
            count: MAX_REFERENCE_IMAGES,
          })
        )
      }
      if (rejected.has('type')) {
        toast.error(t('Reference images must be PNG, JPEG or WebP'))
      }
      if (rejected.has('size')) {
        toast.error(
          t('Each reference image must be {{size}} MB or smaller', {
            size: MAX_REFERENCE_IMAGE_BYTES >> 20,
          })
        )
      }
    },
    [referenceImages, t]
  )

  const removeReferenceImage = useCallback((index: number) => {
    setReferenceImages((previous) =>
      previous.filter((_, position) => position !== index)
    )
  }, [])

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed || !model || isGenerating) return

    const startedAt = Date.now()
    const recordId = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`
    const payload: ImageGenerationRequest = {
      model,
      prompt: trimmed,
      n: count,
    }
    const activeSize = sizeOptions.find((option) => option.value === size)
    if (activeSize) {
      payload[activeSize.param] = activeSize.value
    }

    setIsGenerating(true)
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      })
    })
    try {
      const images =
        referenceImages.length > 0
          ? await generateImageEdits(referenceImages, payload)
          : await generateImages(payload)
      if (images.length === 0) {
        toast.error(t('No image returned'))
      }
      setRecords((previous) => [
        {
          id: recordId,
          prompt: trimmed,
          model,
          images,
          durationMs: Date.now() - startedAt,
          createdAt: startedAt,
        },
        ...previous,
      ])
    } catch (error) {
      setRecords((previous) => [
        {
          id: recordId,
          prompt: trimmed,
          model,
          images: [],
          durationMs: Date.now() - startedAt,
          createdAt: startedAt,
          error: error instanceof Error ? error.message : String(error),
        },
        ...previous,
      ])
    } finally {
      setIsGenerating(false)
    }
  }, [
    count,
    isGenerating,
    model,
    prompt,
    referenceImages,
    size,
    sizeOptions,
    t,
  ])

  const handleUsePrompt = useCallback((value: string) => {
    setPrompt(value)
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
    textareaRef.current?.focus()
  }, [])

  const scrollToGallery = useCallback(() => {
    galleryRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'start',
    })
  }, [])

  const hasResults = records.length > 0 || isGenerating

  return (
    <div ref={scrollRef} className='size-full min-h-0 overflow-y-auto'>
      <section className='mx-auto flex min-h-[calc(100svh-var(--app-header-height,0px))] w-full max-w-3xl flex-col items-center justify-center px-4 py-12'>
        <h1 className='mb-8 text-center text-2xl font-semibold tracking-tight sm:text-3xl'>
          {t('Hello, what would you like to create today?')}
        </h1>

        <div className='w-full'>
          <Composer
            count={count}
            group={group}
            groups={groups}
            isGenerating={isGenerating}
            model={model}
            models={modelOptions}
            onAddReferenceImages={addReferenceImages}
            onCountChange={setCount}
            onGenerate={() => void handleGenerate()}
            onGroupChange={setGroup}
            onModelChange={setModel}
            onPromptChange={setPrompt}
            onRemoveReferenceImage={removeReferenceImage}
            onSizeChange={setSize}
            prompt={prompt}
            referenceImages={referenceImages}
            size={size}
            sizeOptions={sizeOptions}
            textareaRef={textareaRef}
          />

          <div className='mt-4 flex flex-col items-center gap-1.5'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='text-muted-foreground hover:text-foreground gap-1.5 text-xs font-normal'
              onClick={scrollToGallery}
            >
              {t(
                'Not sure what to write? Pick a prompt from the gallery below.'
              )}
              <ArrowDown aria-hidden className='size-3.5' />
            </Button>
            <p className='text-muted-foreground/70 text-[11px]'>
              {t('Images are billed to your account balance')}
            </p>
          </div>
        </div>
      </section>

      {hasResults && (
        <section
          ref={resultsRef}
          aria-labelledby='image-results-title'
          className='mx-auto w-full max-w-6xl scroll-mt-6 px-4 pb-10'
        >
          <h2 id='image-results-title' className='mb-4 text-lg font-semibold'>
            {t('Results')}
          </h2>
          <ResultGrid
            isGenerating={isGenerating}
            pendingCount={count}
            records={records}
          />
        </section>
      )}

      <div
        ref={galleryRef}
        className='mx-auto w-full max-w-6xl scroll-mt-6 px-4 pb-16'
      >
        <PromptGallery onUsePrompt={handleUsePrompt} />
      </div>
    </div>
  )
}
