import { useTranslation } from 'react-i18next'

import { ModelGroupSelector } from '@/components/model-group-selector'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { GroupOption } from '../api'
import type { SizeOption } from '../types'

const COUNT_OPTIONS = [1, 2, 3, 4]

type ParameterPanelProps = {
  count: number
  group: string
  groups: GroupOption[]
  isGenerating: boolean
  model: string
  models: { label: string; value: string }[]
  onCountChange: (count: number) => void
  onGroupChange: (group: string) => void
  onModelChange: (model: string) => void
  onSizeChange: (size: string) => void
  size: string
  sizeOptions: SizeOption[]
}

export function ParameterPanel({
  count,
  group,
  groups,
  isGenerating,
  model,
  models,
  onCountChange,
  onGroupChange,
  onModelChange,
  onSizeChange,
  size,
  sizeOptions,
}: ParameterPanelProps) {
  const { t } = useTranslation()

  return (
    <div className='bg-card flex flex-col gap-5 rounded-lg border p-4'>
      <div className='space-y-2'>
        <span className='text-muted-foreground block text-xs'>
          {t('Model')}
        </span>
        <ModelGroupSelector
          selectedModel={model}
          models={models}
          onModelChange={onModelChange}
          selectedGroup={group}
          groups={groups}
          onGroupChange={onGroupChange}
          disabled={isGenerating}
        />
      </div>

      {sizeOptions.length > 0 && (
        <div className='space-y-2'>
          <span className='text-muted-foreground block text-xs'>
            {t('Aspect ratio')}
          </span>
          <div className='flex gap-2'>
            {sizeOptions.map((option) => (
              <Button
                key={option.value}
                type='button'
                variant={size === option.value ? 'default' : 'outline'}
                size='sm'
                className={cn('flex-1 px-0 text-xs')}
                disabled={isGenerating}
                onClick={() => onSizeChange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className='space-y-2'>
        <span className='text-muted-foreground block text-xs'>
          {t('Number of images')}
        </span>
        <div className='flex gap-2'>
          {COUNT_OPTIONS.map((value) => (
            <Button
              key={value}
              type='button'
              variant={count === value ? 'default' : 'outline'}
              size='sm'
              className='flex-1 px-0 text-xs'
              disabled={isGenerating}
              onClick={() => onCountChange(value)}
            >
              {value}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
