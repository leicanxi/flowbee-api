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

type AnnouncementLike = {
  id?: unknown
  link?: unknown
  publishDate?: unknown
  content?: unknown
  extra?: unknown
  type?: unknown
  title?: unknown
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function hashString(input: string): string {
  let hash = 0
  if (!input) return '0'

  for (let i = 0; i < input.length; i += 1) {
    const chr = input.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }

  return hash.toString(36)
}

/**
 * Build a stable key for an announcement.
 * Prefers the backend id; otherwise falls back to a content fingerprint so that
 * editing an announcement's text registers as a new, unread item.
 */
export function getAnnouncementKey(item: AnnouncementLike): string {
  if (item.id !== undefined && item.id !== null) {
    return `id:${String(item.id)}`
  }

  const fingerprint = JSON.stringify({
    publishDate: asText(item.publishDate),
    content: asText(item.content).trim(),
    extra: asText(item.extra).trim(),
    type: asText(item.type),
    title: asText(item.title).trim(),
    link: asText(item.link).trim(),
  })
  return `hash:${hashString(fingerprint)}`
}

/**
 * Flatten announcement content (Markdown or HTML) into a single plain-text line.
 * Images are dropped entirely, so a leading banner image neither leaves a blank
 * preview nor pushes the readable text out of view.
 */
export function toPlainText(content: string): string {
  if (!content) return ''

  return content
    .replaceAll(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll(/[#*_`>]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
}
