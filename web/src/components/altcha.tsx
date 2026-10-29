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
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const ALTCHA_LANGUAGES: Record<string, string> = {
  en: 'en',
  zh: 'zh-cn',
  'zh-TW': 'zh-tw',
  fr: 'fr-fr',
  ja: 'ja',
  ru: 'ru',
  vi: 'vi',
}

const ALTCHA_I18N_LOADERS: Record<string, () => Promise<unknown>> = {
  en: () => import('altcha/i18n/en'),
  'zh-cn': () => import('altcha/i18n/zh-cn'),
  'zh-tw': () => import('altcha/i18n/zh-tw'),
  'fr-fr': () => import('altcha/i18n/fr-fr'),
  ja: () => import('altcha/i18n/ja'),
  ru: () => import('altcha/i18n/ru'),
  vi: () => import('altcha/i18n/vi'),
}

function toAltchaLanguage(language?: string): string {
  if (!language) return 'en'
  if (ALTCHA_LANGUAGES[language]) return ALTCHA_LANGUAGES[language]
  const base = language.split('-')[0]
  return ALTCHA_LANGUAGES[base] ?? 'en'
}

function loadAltcha(language: string) {
  return import('altcha')
    .then(() => ALTCHA_I18N_LOADERS[language]?.())
    .catch(() => undefined)
}

interface AltchaProps {
  onVerify: (token: string) => void
  onExpire?: () => void
  className?: string
}

/**
 * Self-hosted ALTCHA proof-of-work widget.
 *
 * The widget bundle is loaded on demand so deployments that use Turnstile (or
 * no captcha at all) never pay for it. The payload is emitted through the same
 * callback the Turnstile widget uses, so every form keeps one code path.
 */
export function Altcha({ onVerify, onExpire, className }: AltchaProps) {
  const { i18n } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onVerifyRef = useRef(onVerify)
  const onExpireRef = useRef(onExpire)

  useEffect(() => {
    onVerifyRef.current = onVerify
    onExpireRef.current = onExpire
  })

  const language = toAltchaLanguage(i18n.resolvedLanguage || i18n.language)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let widget: HTMLElement | null = null

    const handleStateChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{ state?: string; payload?: string }>
      ).detail
      if (detail?.state === 'verified' && detail.payload) {
        onVerifyRef.current(detail.payload)
        return
      }
      if (detail?.state === 'expired' || detail?.state === 'error') {
        onExpireRef.current?.()
      }
    }

    void loadAltcha(language).then(() => {
      if (disposed || !customElements.get('altcha-widget')) return
      widget = document.createElement('altcha-widget')
      widget.setAttribute('challenge', '/api/captcha/altcha')
      widget.setAttribute('name', 'altcha')
      widget.setAttribute('language', language)
      widget.setAttribute('configuration', '{"hideFooter":true}')
      widget.addEventListener('statechange', handleStateChange)
      container.replaceChildren(widget)
    })

    return () => {
      disposed = true
      widget?.removeEventListener('statechange', handleStateChange)
      container.replaceChildren()
    }
  }, [language])

  return <div ref={containerRef} className={className} />
}
