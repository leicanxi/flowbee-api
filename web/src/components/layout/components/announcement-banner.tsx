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
import { Megaphone, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { getAnnouncementKey, toPlainText } from '@/lib/announcement'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notification-store'

/** Horizontal travel speed of the marquee, in pixels per second. */
const SCROLL_SPEED = 60
/** Gap between the two copies of the text, keeps the loop seam invisible. */
const LOOP_GAP_PX = 64
/** How long a non-scrolling announcement stays before the next one rotates in. */
const DWELL_MS = 6000

type AnnouncementBannerProps = {
  announcements: Record<string, unknown>[]
  onOpenAnnouncements: () => void
}

/**
 * Top-of-page announcement banner.
 *
 * Only announcements whose `displayMode` is `banner` appear here. Text that
 * fits stays centred and still; text wider than the available space scrolls
 * horizontally on a seamless loop so the whole message can be read.
 */
export function AnnouncementBanner({
  announcements,
  onOpenAnnouncements,
}: AnnouncementBannerProps) {
  const { t } = useTranslation()
  const dismissedBannerKeys = useNotificationStore(
    (state) => state.dismissedBannerKeys
  )
  const dismissBanner = useNotificationStore((state) => state.dismissBanner)

  // `announcements` is rebuilt on every render by useNotifications, so a
  // memo here would never hit. The list is capped at 20 items.
  const items = announcements.filter((item) => {
    if (item.displayMode !== 'banner') return false
    return !dismissedBannerKeys.includes(getAnnouncementKey(item))
  })

  const [index, setIndex] = useState(0)
  const activeIndex = items.length > 0 ? index % items.length : 0
  const activeItem = items[activeIndex]
  const text = toPlainText(
    typeof activeItem?.content === 'string' ? activeItem.content : ''
  )

  const containerRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [scrollDuration, setScrollDuration] = useState(0)

  // Measure whether the text actually overflows, so short messages stay still.
  useEffect(() => {
    const container = containerRef.current
    const textNode = textRef.current
    if (!container || !textNode) return

    const measure = () => {
      const textWidth = textNode.scrollWidth
      if (textWidth <= container.clientWidth) {
        setScrollDuration(0)
        return
      }
      setScrollDuration((textWidth + LOOP_GAP_PX) / SCROLL_SPEED)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [text, activeIndex])

  // Rotate between announcements, waiting for a full pass when one is scrolling.
  useEffect(() => {
    if (items.length <= 1) return

    const delay = scrollDuration > 0 ? scrollDuration * 1000 : DWELL_MS
    const timer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % items.length)
    }, delay)

    return () => window.clearTimeout(timer)
  }, [items.length, scrollDuration, activeIndex])

  if (!activeItem) return null

  const isScrolling = scrollDuration > 0
  const activeKey = getAnnouncementKey(activeItem)

  return (
    <div className='announcement-banner bg-muted/50 border-b'>
      <div className='flex h-10 items-center gap-2 px-2 sm:px-3'>
        <Megaphone className='text-muted-foreground size-4 shrink-0' />

        <button
          type='button'
          onClick={onOpenAnnouncements}
          className='min-w-0 flex-1 text-left'
          aria-label={t('Open notification center')}
        >
          <span ref={containerRef} className='block w-full overflow-hidden'>
            <span
              aria-live='polite'
              className={cn(
                'flex',
                isScrolling
                  ? 'animate-announcement-marquee w-max'
                  : 'w-full justify-center'
              )}
              style={
                isScrolling
                  ? { animationDuration: `${scrollDuration}s` }
                  : undefined
              }
            >
              <span
                ref={textRef}
                className={cn(
                  'shrink-0 text-sm whitespace-nowrap',
                  isScrolling && 'mr-16'
                )}
              >
                {text}
              </span>
              {isScrolling ? (
                <span
                  aria-hidden='true'
                  className='shrink-0 pr-16 text-sm whitespace-nowrap'
                >
                  {text}
                </span>
              ) : null}
            </span>
          </span>
        </button>

        <Button
          variant='ghost'
          size='icon'
          className='size-6 shrink-0'
          onClick={() => dismissBanner(activeKey)}
          aria-label={t('Dismiss')}
        >
          <X className='size-3.5' />
        </Button>
      </div>
    </div>
  )
}
