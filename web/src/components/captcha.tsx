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

import { useStatus } from '@/hooks/use-status'

import { Altcha } from './altcha'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => void
    }
  }
}

interface CaptchaProps {
  siteKey: string
  onVerify: (token: string) => void
  onExpire?: () => void
  className?: string
}

/**
 * Bot-protection widget. The backend enforces one provider at a time; the
 * status payload decides which widget the user actually sees.
 */
export function Captcha({
  siteKey,
  onVerify,
  onExpire,
  className,
}: CaptchaProps) {
  const { status } = useStatus()

  if (status?.altcha_check) {
    return (
      <Altcha onVerify={onVerify} onExpire={onExpire} className={className} />
    )
  }

  return (
    <TurnstileWidget
      siteKey={siteKey}
      onVerify={onVerify}
      onExpire={onExpire}
      className={className}
    />
  )
}

function TurnstileWidget({
  siteKey,
  onVerify,
  onExpire,
  className,
}: CaptchaProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const render = () => {
      if (!ref.current || !window.turnstile) return
      try {
        window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: (token: string) => onVerify(token),
          'error-callback': () => onExpire?.(),
          'expired-callback': () => onExpire?.(),
        })
      } catch {
        /* empty */
      }
    }

    if (window.turnstile) {
      render()
      return
    }
    const scriptId = 'cf-turnstile'
    if (document.getElementById(scriptId)) return
    const s = document.createElement('script')
    s.id = scriptId
    s.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.defer = true
    s.onload = () => render()
    document.head.appendChild(s)
  }, [siteKey, onVerify, onExpire])

  return <div ref={ref} className={className} />
}
