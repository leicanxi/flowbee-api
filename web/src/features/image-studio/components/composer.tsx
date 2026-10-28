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
import { ChevronDown, Images, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelGroupSelector } from '@/components/model-group-selector'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'

import type { GroupOption } from '../api'
import {
  MAX_REFERENCE_IMAGES,
  REFERENCE_IMAGE_ACCEPT,
} from '../lib/reference-images'
import type { SizeOption } from '../types'

const COUNT_OPTIONS = [1, 2, 3, 4]

type ComposerProps = {
  count: number
  group: string
  groups: GroupOption[]
  isGenerating: boolean
  model: string
  models: { label: string; value: string }[]
  onAddReferenceImages: (files: File[]) => void
  onCountChange: (count: number) => void
  onGenerate: () => void
  onGroupChange: (group: string) => void
  onModelChange: (model: string) => void
  onPromptChange: (prompt: string) => void
  onRemoveReferenceImage: (index: number) => void
  onSizeChange: (size: string) => void
  prompt: string
  referenceImages: File[]
  size: string
  sizeOptions: SizeOption[]
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

export function Composer(props: ComposerProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canGenerate =
    props.prompt.trim() !== '' && props.model !== '' && !props.isGenerating
  const activeSize = props.sizeOptions.find(
    (option) => option.value === props.size
  )
  const sizeLocked = props.model !== '' && props.sizeOptions.length === 0
  const canAddReference = props.referenceImages.length < MAX_REFERENCE_IMAGES

  const previews = useMemo(
    () =>
      props.referenceImages.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      })),
    [props.referenceImages]
  )
  useEffect(
    () => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)),
    [previews]
  )

  return (
    <div className='bg-card/80 focus-within:border-ring/40 rounded-2xl border shadow-sm transition-colors'>
      <div className='flex flex-wrap items-start gap-2 px-3 pt-3'>
        {previews.map((preview, index) => (
          <div
            key={`${preview.file.name}-${preview.file.size}-${preview.file.lastModified}`}
            className='group/tile relative size-16 shrink-0 transition-transform duration-200 hover:z-10 hover:-translate-y-0.5 hover:scale-105'
          >
            <img
              src={preview.url}
              alt=''
              className='size-full rounded-lg border object-cover shadow-sm'
            />
            <Button
              type='button'
              variant='secondary'
              size='icon'
              className='border-background absolute -top-1.5 -right-1.5 size-5 rounded-full border shadow-sm'
              aria-label={`${t('Remove reference image')} ${index + 1}`}
              disabled={props.isGenerating}
              onClick={() => props.onRemoveReferenceImage(index)}
            >
              <X aria-hidden className='size-3' />
            </Button>
          </div>
        ))}

        {canAddReference && (
          <Button
            type='button'
            variant='outline'
            className='text-muted-foreground hover:text-foreground size-16 shrink-0 rounded-lg border-dashed'
            aria-label={t('Add reference images')}
            title={t('Add reference images')}
            disabled={props.isGenerating}
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus aria-hidden className='size-5' />
          </Button>
        )}

        <input
          ref={fileInputRef}
          type='file'
          accept={REFERENCE_IMAGE_ACCEPT}
          multiple
          className='hidden'
          aria-label={t('Add reference images')}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            if (files.length > 0) {
              props.onAddReferenceImages(files)
            }
          }}
        />
      </div>

      <Textarea
        ref={props.textareaRef}
        value={props.prompt}
        onChange={(event) => props.onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            if (canGenerate) {
              props.onGenerate()
            }
          }
        }}
        aria-label={t('Describe the image you want to create')}
        placeholder={t('Describe the image you want to create')}
        className='max-h-64 min-h-32 resize-none border-0 bg-transparent px-4 pt-4 text-base shadow-none focus-visible:ring-0 md:min-h-36 md:text-base'
        disabled={props.isGenerating}
      />

      <div className='flex flex-wrap items-center gap-2 px-3 pb-3'>
        <ModelGroupSelector
          selectedModel={props.model}
          models={props.models}
          onModelChange={props.onModelChange}
          selectedGroup={props.group}
          groups={props.groups}
          onGroupChange={props.onGroupChange}
          disabled={props.isGenerating}
        />

        {props.sizeOptions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='h-8 gap-1 px-2.5 text-xs font-medium'
                  disabled={props.isGenerating}
                  aria-label={`${t('Aspect ratio')}: ${activeSize?.label ?? ''}`}
                >
                  <span>{activeSize?.label ?? t('Aspect ratio')}</span>
                  <ChevronDown aria-hidden className='size-3.5 opacity-50' />
                </Button>
              }
            />
            <DropdownMenuContent align='start' className='min-w-32'>
              <DropdownMenuRadioGroup
                value={props.size}
                onValueChange={(value) => props.onSizeChange(String(value))}
              >
                {props.sizeOptions.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='h-8 gap-1 px-2.5 text-xs font-medium'
                disabled={props.isGenerating}
                aria-label={`${t('Number of images')}: ${props.count}`}
              >
                <Images aria-hidden className='size-3.5 opacity-70' />
                <span>{props.count}</span>
                <ChevronDown aria-hidden className='size-3.5 opacity-50' />
              </Button>
            }
          />
          <DropdownMenuContent align='start' className='min-w-24'>
            <DropdownMenuRadioGroup
              value={String(props.count)}
              onValueChange={(value) => props.onCountChange(Number(value))}
            >
              {COUNT_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option} value={String(option)}>
                  {option}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className='ml-auto flex items-center gap-3'>
          {sizeLocked && (
            <span className='text-muted-foreground hidden text-xs sm:inline'>
              {t('Resolution is fixed by this model')}
            </span>
          )}
          <Button
            type='button'
            size='sm'
            className='h-8 gap-2 rounded-full px-4'
            disabled={!canGenerate}
            onClick={props.onGenerate}
          >
            {props.isGenerating ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Sparkles className='size-4' />
            )}
            {props.isGenerating ? t('Generating...') : t('Generate')}
          </Button>
        </div>
      </div>
    </div>
  )
}
