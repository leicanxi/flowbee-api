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
import { useQuery } from '@tanstack/react-query'

import { RichContent } from '@/components/rich-content'
import { isLikelyHtml } from '@/lib/content-format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getWelfarePromoContent } from '../api'

/**
 * Admin-authored promo/activity content for the welfare page: one free-form
 * HTML/Markdown blob from console_setting, rendered through the same
 * sanitized pipeline as the About page. It has no shell of its own — layout,
 * categories and styling live entirely in the admin's HTML, and the collapse
 * toggle lives in the page title row.
 */
export function WelfarePromoSection({
  enabled,
  collapsed,
}: {
  enabled: boolean
  collapsed: boolean
}) {
  // Stays mounted while collapsed so expanding is instant from cache.
  const { data } = useQuery({
    queryKey: ['welfare-promo-content'],
    queryFn: async () => requireServerSuccess(await getWelfarePromoContent()),
    enabled,
  })

  if (!enabled || collapsed) return null

  const content = data?.data?.trim() ?? ''
  if (!content) return null

  return (
    <RichContent
      mode={isLikelyHtml(content) ? 'html' : 'markdown'}
      htmlVariant='isolated'
      content={content}
    />
  )
}
