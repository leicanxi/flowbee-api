import { Loader2, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import {
  generateImages,
  getGroupModels,
  getUserGroups,
  type GroupOption,
} from './api'
import { ParameterPanel } from './components/parameter-panel'
import { ResultGrid } from './components/result-grid'
import {
  getSizeOptions,
  isImageModel,
  pickDefaultModel,
} from './lib/image-models'
import type { GenerationRecord, ImageGenerationRequest } from './types'

export function ImageStudio() {
  const { t } = useTranslation()
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [group, setGroup] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [size, setSize] = useState('')
  const [count, setCount] = useState(1)
  const [prompt, setPrompt] = useState('')
  const [records, setRecords] = useState<GenerationRecord[]>([])
  const [isGenerating, setIsGenerating] = useState(false)

  const sizeOptions = useMemo(() => getSizeOptions(model), [model])

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

  const statusLabel = useMemo(() => {
    if (!model) return ''
    return sizeOptions.length > 0
      ? ''
      : t('Resolution is fixed by the model name')
  }, [model, sizeOptions.length, t])

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
    try {
      const images = await generateImages(payload)
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
  }, [count, isGenerating, model, prompt, size, sizeOptions, t])

  return (
    <div className='flex size-full min-h-0 flex-col overflow-auto'>
      <div className='mx-auto w-full max-w-6xl p-4 md:p-6'>
        <div className='mb-4'>
          <h1 className='text-lg font-medium'>{t('Image studio')}</h1>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t('Images are billed to your account balance')}
          </p>
        </div>

        <div className='bg-card mb-4 rounded-lg border p-3'>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t('Describe the image you want to create')}
            className='min-h-24 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0'
            disabled={isGenerating}
          />
          <div className='mt-2 flex items-center justify-between gap-3'>
            <span className='text-muted-foreground text-xs'>{statusLabel}</span>
            <Button
              type='button'
              className='gap-2'
              disabled={!prompt.trim() || !model || isGenerating}
              onClick={handleGenerate}
            >
              {isGenerating ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <Sparkles className='size-4' />
              )}
              {isGenerating ? t('Generating...') : t('Generate')}
            </Button>
          </div>
        </div>

        <div className='grid gap-4 lg:grid-cols-[280px_1fr]'>
          <ParameterPanel
            count={count}
            group={group}
            groups={groups}
            isGenerating={isGenerating}
            model={model}
            models={modelOptions}
            onCountChange={setCount}
            onGroupChange={setGroup}
            onModelChange={setModel}
            onSizeChange={setSize}
            size={size}
            sizeOptions={sizeOptions}
          />
          <ResultGrid
            isGenerating={isGenerating}
            pendingCount={count}
            records={records}
          />
        </div>
      </div>
    </div>
  )
}
