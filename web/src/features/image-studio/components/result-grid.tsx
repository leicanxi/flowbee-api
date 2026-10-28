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
import { Download, ImageIcon, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

import type { GenerationRecord } from '../types'

type ResultGridProps = {
  isGenerating: boolean
  pendingCount: number
  records: GenerationRecord[]
}

// Stable placeholders so pending skeletons never key off array indexes.
const PENDING_SLOTS = ['a', 'b', 'c', 'd']

export function ResultGrid({
  isGenerating,
  pendingCount,
  records,
}: ResultGridProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<string | null>(null)

  const hasContent = records.length > 0 || isGenerating

  if (!hasContent) {
    return (
      <div className='flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed'>
        <ImageIcon className='text-muted-foreground size-8' />
        <p className='text-muted-foreground text-sm'>
          {t('Describe an image and press generate')}
        </p>
      </div>
    )
  }

  return (
    <>
      <div className='flex flex-col gap-6'>
        {records.map((record) => (
          <div key={record.id} className='flex flex-col gap-3'>
            <div className='flex items-start justify-between gap-3'>
              <p className='text-sm leading-relaxed'>{record.prompt}</p>
              <span className='text-muted-foreground shrink-0 text-xs'>
                {Math.round(record.durationMs / 1000)}s
              </span>
            </div>

            {record.error && (
              <div className='text-destructive rounded-lg border border-dashed p-3 text-sm'>
                {record.error}
              </div>
            )}

            {record.images.length > 0 && (
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                {record.images.map((image, index) => {
                  const source = `data:image/png;base64,${image.b64_json}`
                  return (
                    <div
                      key={image.b64_json.slice(0, 32)}
                      className='bg-card group relative overflow-hidden rounded-lg border'
                    >
                      <button
                        type='button'
                        className='block w-full cursor-zoom-in'
                        onClick={() => setPreview(source)}
                      >
                        <img
                          src={source}
                          alt={record.prompt}
                          className='aspect-square w-full object-cover'
                        />
                      </button>
                      <Button
                        type='button'
                        variant='secondary'
                        size='icon'
                        className='absolute right-2 bottom-2 size-8 opacity-0 transition-opacity group-hover:opacity-100'
                        onClick={() =>
                          downloadImage(source, record.createdAt, index)
                        }
                      >
                        <Download className='size-4' />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}

        {isGenerating &&
          PENDING_SLOTS.slice(0, pendingCount).map((slot) => (
            <div key={`pending-${slot}`} className='flex flex-col gap-3'>
              <Skeleton className='h-4 w-1/2' />
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                <div className='flex aspect-square items-center justify-center rounded-lg border border-dashed'>
                  <Loader2 className='text-muted-foreground size-6 animate-spin' />
                </div>
              </div>
            </div>
          ))}
      </div>

      <Dialog open={Boolean(preview)} onOpenChange={() => setPreview(null)}>
        <DialogContent className='max-w-4xl p-2'>
          <DialogTitle className='sr-only'>{t('Image preview')}</DialogTitle>
          {preview && (
            <img src={preview} alt='' className='h-auto w-full rounded' />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function downloadImage(source: string, createdAt: number, index: number) {
  const link = document.createElement('a')
  link.href = source
  link.download = `flowbee-${createdAt}-${index + 1}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
}
