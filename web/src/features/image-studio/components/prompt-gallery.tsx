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
import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronDown, Search, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounce } from '@/hooks/use-debounce'
import { cn } from '@/lib/utils'

import { getImagePrompts, imagePromptCoverProxyURL } from '../api'
import type { ImagePrompt } from '../types'

const VISIBLE_CATEGORY_COUNT = 10
const SKELETON_SLOTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

type PromptGalleryProps = {
  onUsePrompt: (prompt: string) => void
}

export function PromptGallery(props: PromptGalleryProps) {
  const { t } = useTranslation()
  const [category, setCategory] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounce(searchInput.trim(), 300)

  const query = useInfiniteQuery({
    queryKey: ['image-prompts', category, search],
    queryFn: ({ pageParam }) =>
      getImagePrompts({ category, search, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.page_size < lastPage.total
        ? lastPage.page + 1
        : undefined,
    staleTime: 10 * 60 * 1000,
    meta: { errorToast: false },
  })

  const categories = query.data?.pages[0]?.categories ?? []
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const galleryTotal = categories.reduce((sum, item) => sum + item.count, 0)
  const visibleCategories = categories.slice(0, VISIBLE_CATEGORY_COUNT)
  const hiddenCategories = categories.slice(VISIBLE_CATEGORY_COUNT)

  const selectPrompt = (prompt: string) => {
    props.onUsePrompt(prompt)
    toast.success(t('Prompt added to the composer'))
  }

  return (
    <section
      aria-labelledby='prompt-gallery-title'
      className='flex flex-col gap-5'
    >
      <div className='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
        <div>
          <h2
            id='prompt-gallery-title'
            className='flex items-center gap-2 text-lg font-semibold'
          >
            <Sparkles aria-hidden className='size-4' />
            {t('Prompt gallery')}
          </h2>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t('{{count}} prompts curated from open-source collections', {
              count: galleryTotal,
            })}
          </p>
        </div>

        <div className='relative w-full md:w-72'>
          <Search
            aria-hidden
            className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
          />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('Search prompts')}
            aria-label={t('Search prompts')}
            className='pl-9'
          />
        </div>
      </div>

      {categories.length > 0 && (
        <div className='flex flex-wrap items-center gap-2'>
          <CategoryChip
            active={category === ''}
            count={galleryTotal}
            label={t('All')}
            onSelect={() => setCategory('')}
          />
          {visibleCategories.map((item) => (
            <CategoryChip
              key={item.name}
              active={category === item.name}
              count={item.count}
              label={item.name}
              onSelect={() => setCategory(item.name)}
            />
          ))}
          {hiddenCategories.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='h-7 shrink-0 gap-1 rounded-full px-3 text-xs font-normal'
                  >
                    {t('More categories')}
                    <ChevronDown aria-hidden className='size-3.5 opacity-50' />
                  </Button>
                }
              />
              <DropdownMenuContent
                align='start'
                className='max-h-72 overflow-y-auto'
              >
                {hiddenCategories.map((item) => (
                  <DropdownMenuItem
                    key={item.name}
                    onClick={() => setCategory(item.name)}
                  >
                    <span className='truncate'>{item.name}</span>
                    <span className='text-muted-foreground ml-auto text-xs'>
                      {item.count}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {query.isPending && (
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4'>
          {SKELETON_SLOTS.map((slot) => (
            <div
              key={slot}
              className='bg-card overflow-hidden rounded-xl border'
            >
              <Skeleton className='aspect-[4/3] w-full rounded-none' />
              <div className='space-y-2 p-3'>
                <Skeleton className='h-4 w-3/4' />
                <Skeleton className='h-3 w-1/2' />
              </div>
            </div>
          ))}
        </div>
      )}

      {query.isError && (
        <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center'>
          <p className='text-sm'>
            {query.error instanceof Error && query.error.message
              ? query.error.message
              : t('Prompt gallery is temporarily unavailable')}
          </p>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => void query.refetch()}
          >
            {t('Retry')}
          </Button>
        </div>
      )}

      {!query.isPending && !query.isError && items.length === 0 && (
        <div className='flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center'>
          <p className='text-sm font-medium'>{t('No prompts found')}</p>
          <p className='text-muted-foreground text-sm'>
            {t('Try a different keyword or category')}
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4'>
          {items.map((item) => (
            <PromptCard key={item.id} item={item} onUse={selectPrompt} />
          ))}
        </div>
      )}

      {query.hasNextPage && (
        <div className='flex justify-center'>
          <Button
            type='button'
            variant='outline'
            className='rounded-full px-6'
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage
              ? t('Loading...')
              : t('Load more prompts')}
          </Button>
        </div>
      )}
    </section>
  )
}

type CategoryChipProps = {
  active: boolean
  count: number
  label: string
  onSelect: () => void
}

function CategoryChip(props: CategoryChipProps) {
  return (
    <Button
      type='button'
      size='sm'
      variant={props.active ? 'default' : 'outline'}
      aria-pressed={props.active}
      className='h-7 shrink-0 gap-1.5 rounded-full px-3 text-xs font-normal'
      onClick={props.onSelect}
    >
      <span className='max-w-40 truncate'>{props.label}</span>
      <span
        className={cn(
          'text-[10px]',
          props.active ? 'opacity-70' : 'text-muted-foreground'
        )}
      >
        {props.count}
      </span>
    </Button>
  )
}

type PromptCardProps = {
  item: ImagePrompt
  onUse: (prompt: string) => void
}

function PromptCard(props: PromptCardProps) {
  const { t } = useTranslation()
  const [coverFailed, setCoverFailed] = useState(false)
  const cover = coverFailed
    ? imagePromptCoverProxyURL(props.item.cover_url)
    : props.item.cover_url

  return (
    <article className='bg-card group overflow-hidden rounded-xl border transition-shadow hover:shadow-md'>
      <button
        type='button'
        className='relative block aspect-[4/3] w-full overflow-hidden'
        onClick={() => props.onUse(props.item.prompt)}
        aria-label={t('Use this prompt')}
      >
        <img
          src={cover}
          alt=''
          loading='lazy'
          className='size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]'
          onError={() => setCoverFailed(true)}
        />
        <span className='absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 via-black/10 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100'>
          <span className='text-xs font-medium text-white'>
            {t('Use this prompt')}
          </span>
        </span>
      </button>
      <div className='space-y-2 p-3'>
        <h3 className='line-clamp-2 text-sm leading-snug font-medium'>
          {props.item.title}
        </h3>
        <div className='flex items-center gap-2'>
          <Badge variant='secondary' className='max-w-28 truncate'>
            {props.item.category}
          </Badge>
          <span className='text-muted-foreground truncate text-xs'>
            {props.item.source_name}
          </span>
        </div>
      </div>
    </article>
  )
}
