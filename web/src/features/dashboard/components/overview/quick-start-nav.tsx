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
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  ArrowUpRight,
  BadgeDollarSign,
  BookOpen,
  Bot,
  Copy,
  CreditCard,
  FlaskConical,
  Gift,
  Heart,
  Image as ImageIcon,
  Link2,
  Music2,
  TerminalSquare,
  Video,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { fetchTokenKey } from '@/features/keys/api'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

/** 概览「快速开始」所需的接入信息示例，由概览页在自动建键后组装。 */
export interface RequestExample {
  endpoint: string
  model: string
  keyId?: number
  displayKey: string
  plainKey?: string
  ready: boolean
}

type QuickNavPath =
  | '/playground'
  | '/image-studio'
  | '/pricing'
  | '/wallet'
  | '/invite'
  | '/feedback'
  | '/keys'

type QuickStartTab = 'start' | 'features' | 'more'

const CONNECTION_SLIDES = ['key', 'endpoint'] as const

// 「API 端点」一格给的是 base URL（…/v1），不是 …/v1/chat/completions：
// 客户端配置里那一栏要的正是 base URL，给全路径反而要用户自己往回删。
function toBaseEndpoint(endpoint: string): string {
  const suffix = '/chat/completions'
  const trimmed = endpoint.replace(/\/+$/, '')
  if (trimmed.endsWith(suffix)) {
    return trimmed.slice(0, -suffix.length)
  }
  return trimmed
}

function FeatureNavItem(props: {
  to: QuickNavPath
  icon: LucideIcon
  title: string
}) {
  const Icon = props.icon
  return (
    <Link
      to={props.to}
      className='hover:bg-muted/50 flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 transition-colors'
    >
      <Icon
        className='text-muted-foreground size-4 shrink-0'
        aria-hidden='true'
      />
      <span className='truncate text-sm'>{props.title}</span>
    </Link>
  )
}

function FeatureExternalNavItem(props: {
  href: string
  icon: LucideIcon
  title: string
}) {
  const Icon = props.icon
  return (
    <a
      href={props.href}
      target='_blank'
      rel='noreferrer'
      className='hover:bg-muted/50 flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 transition-colors'
    >
      <Icon
        className='text-muted-foreground size-4 shrink-0'
        aria-hidden='true'
      />
      <span className='truncate text-sm'>{props.title}</span>
    </a>
  )
}

function MoreNavCard(props: {
  href?: string
  icon: LucideIcon
  title: string
  desc?: string
  badge?: string
}) {
  const Icon = props.icon
  const content = (
    <>
      <span className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg'>
        <Icon className='size-4' aria-hidden='true' />
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-0.5 text-left'>
        <span className='flex min-w-0 items-center gap-1.5'>
          <span className='truncate text-sm font-medium'>{props.title}</span>
          {props.badge ? (
            <span className='bg-muted/70 text-muted-foreground shrink-0 rounded px-1 py-px text-[9.5px] leading-4'>
              {props.badge}
            </span>
          ) : null}
        </span>
        {props.desc ? (
          <span className='text-muted-foreground line-clamp-2 text-xs leading-relaxed'>
            {props.desc}
          </span>
        ) : null}
      </span>
    </>
  )
  const className =
    'h-auto w-full justify-start gap-2.5 rounded-xl px-3 py-3 text-left whitespace-normal'

  if (!props.href) {
    return (
      <div
        className={cn(
          'border-border bg-background flex items-center',
          className
        )}
        aria-disabled='true'
      >
        {content}
      </div>
    )
  }
  return (
    <Button
      variant='outline'
      className={className}
      render={<a href={props.href} target='_blank' rel='noreferrer' />}
    >
      {content}
    </Button>
  )
}

function ConnectionInfoPanel(props: { example: RequestExample }) {
  const { t } = useTranslation()
  const { example } = props
  const [slideIndex, setSlideIndex] = useState(0)
  const [copying, setCopying] = useState(false)
  const { copyToClipboard } = useCopyToClipboard({ notify: false })

  const slide = CONNECTION_SLIDES[slideIndex]
  const endpointValue = toBaseEndpoint(example.endpoint)
  const keyValue = example.plainKey
    ? `sk-${example.plainKey}`
    : example.displayKey
  const currentValue = slide === 'key' ? keyValue : endpointValue
  const slideLabels: Record<(typeof CONNECTION_SLIDES)[number], string> = {
    key: t('API key'),
    endpoint: t('API endpoint'),
  }

  const copy = async () => {
    if (copying) {
      return
    }
    setCopying(true)
    try {
      let text = currentValue
      if (slide === 'key') {
        let plainKey = example.plainKey ?? ''
        let resolveError = ''
        if (!plainKey && example.keyId) {
          const result = await fetchTokenKey(example.keyId)
          plainKey = result.success ? (result.data?.key ?? '') : ''
          resolveError = result.message ?? ''
        }
        if (!plainKey) {
          toast.error(resolveError || t('Failed to copy to clipboard'))
          return
        }
        text = `sk-${plainKey}`
      }
      if (await copyToClipboard(text)) {
        toast.success(t('Copied to clipboard'))
      } else {
        toast.error(t('Failed to copy to clipboard'))
      }
    } catch (error) {
      handleServerError(error, t('Failed to copy to clipboard'))
    } finally {
      setCopying(false)
    }
  }

  const copyable = slide === 'endpoint' || example.ready

  return (
    <div className='bg-foreground/[0.035] rounded-xl p-3 font-mono text-xs'>
      <div
        className='mb-2 flex items-center gap-3 font-sans'
        role='group'
        aria-label={t('Connection info')}
      >
        {CONNECTION_SLIDES.map((item, index) => (
          <button
            key={item}
            type='button'
            aria-pressed={index === slideIndex}
            onClick={() => setSlideIndex(index)}
            className={cn(
              'text-[11px] transition-colors',
              index === slideIndex
                ? 'text-foreground font-medium'
                : 'text-muted-foreground/50 hover:text-muted-foreground'
            )}
          >
            {slideLabels[item]}
          </button>
        ))}
      </div>
      <div className='flex items-center justify-between gap-2'>
        <code className='truncate' title={currentValue}>
          {currentValue}
        </code>
        {copyable ? (
          <Button
            variant='ghost'
            size='xs'
            disabled={copying}
            onClick={copy}
            aria-label={t('Copy')}
          >
            <Copy data-icon='inline-start' />
            {t('Copy')}
          </Button>
        ) : (
          <Button variant='outline' size='xs' render={<Link to='/keys' />}>
            {t('Create API Key')}
          </Button>
        )}
      </div>
    </div>
  )
}

interface SetupStepCard {
  step: number
  title: string
  description: string
  icon: LucideIcon
  tone: IconBadgeTone
  /** 可选步骤：标题后面跟一枚极轻的「可选」。 */
  optional?: boolean
}

const CARD_SURFACE_CLASS_NAME =
  'bg-background/70 rounded-xl border px-3 py-2.5 shadow-xs'

const CARD_LINK_CLASS_NAME = cn(
  CARD_SURFACE_CLASS_NAME,
  'hover:bg-muted/60 flex items-center justify-between gap-3 transition-colors'
)

function StepCardBody(props: SetupStepCard & { action?: ReactNode }) {
  const { t } = useTranslation()
  const Icon = props.icon
  return (
    <span className='flex min-w-0 items-start gap-2.5'>
      <IconBadge tone={props.tone} size='sm' className='mt-0.5 rounded-lg'>
        <Icon />
      </IconBadge>
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='flex min-w-0 items-center gap-2'>
          <span className='text-muted-foreground font-mono text-xs tabular-nums'>
            {props.step}.
          </span>
          <span className='truncate text-sm font-medium'>{t(props.title)}</span>
          {props.optional ? (
            <span className='text-muted-foreground bg-muted/60 shrink-0 rounded px-1.5 py-px text-[10px] leading-4'>
              {t('Optional')}
            </span>
          ) : null}
          {props.action ? (
            <span className='ml-auto shrink-0'>{props.action}</span>
          ) : null}
        </span>
        <span className='text-muted-foreground line-clamp-1 text-xs'>
          {t(props.description)}
        </span>
      </span>
    </span>
  )
}

function StartTab(props: { example: RequestExample }) {
  const { t } = useTranslation()
  return (
    <ol className='bg-background/45 flex flex-1 flex-col justify-between gap-2 rounded-2xl border p-2 backdrop-blur'>
      <li className={cn(CARD_SURFACE_CLASS_NAME, 'flex flex-col gap-2.5')}>
        <StepCardBody
          step={1}
          title='Connection info'
          description='Key and endpoint, paste into your client'
          icon={Link2}
          tone='primary'
          action={
            <Link
              to='/keys'
              className='text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-medium transition-colors'
            >
              {t('Manage my keys')}
              <ArrowRight className='size-3' aria-hidden='true' />
            </Link>
          }
        />
        <ConnectionInfoPanel example={props.example} />
      </li>
      <li>
        <Link to='/wallet' className={CARD_LINK_CLASS_NAME}>
          <StepCardBody
            step={2}
            title='Add credits'
            description='More models with the Flowbee subsidy, from 30% of the official price'
            icon={CreditCard}
            tone='chart-4'
            optional
          />
          <ArrowRight
            className='text-muted-foreground size-4 shrink-0'
            aria-hidden='true'
          />
        </Link>
      </li>
      <li>
        <a
          href='https://docs.flowbee.top/flowbee/access.html'
          target='_blank'
          rel='noreferrer'
          className={CARD_LINK_CLASS_NAME}
        >
          <StepCardBody
            step={3}
            title='Connect your software'
            description='See setup guides for popular apps'
            icon={TerminalSquare}
            tone='info'
          />
          <ArrowUpRight
            className='text-muted-foreground size-4 shrink-0'
            aria-hidden='true'
          />
        </a>
      </li>
    </ol>
  )
}

function FeaturesTab() {
  const { t } = useTranslation()
  return (
    <ul className='grid grid-cols-2 gap-1.5'>
      <li>
        <FeatureNavItem
          to='/playground'
          icon={FlaskConical}
          title={t('Playground')}
        />
      </li>
      <li>
        <FeatureNavItem
          to='/image-studio'
          icon={ImageIcon}
          title={t('Image studio')}
        />
      </li>
      <li>
        <FeatureNavItem
          to='/pricing'
          icon={BadgeDollarSign}
          title={t('Model Square')}
        />
      </li>
      <li>
        <FeatureNavItem to='/wallet' icon={Wallet} title={t('Wallet')} />
      </li>
      <li>
        <FeatureNavItem to='/invite' icon={Gift} title={t('Welfare')} />
      </li>
      <li>
        <FeatureExternalNavItem
          href='https://docs.flowbee.top'
          icon={BookOpen}
          title={t('Usage guide')}
        />
      </li>
      <li>
        <FeatureNavItem
          to='/feedback'
          icon={Heart}
          title={t('Wishlist & Feedback')}
        />
      </li>
    </ul>
  )
}

function MoreTab() {
  const { t } = useTranslation()
  return (
    <ul className='flex flex-col gap-2'>
      <li>
        <MoreNavCard
          href='https://voice-models.flowbee.top'
          icon={Music2}
          title={t('Voice models')}
          desc={t('AstrBot singing plugin')}
        />
      </li>
      <li>
        <MoreNavCard
          icon={Bot}
          title='BeeWith'
          desc={t('AI companion')}
          badge={t('Coming soon')}
        />
      </li>
      <li>
        <MoreNavCard
          href='https://v.douyin.com/tKRpRAS6Rfo/'
          icon={Video}
          title={t('Douyin')}
          desc={t('Follow Flowbee')}
        />
      </li>
    </ul>
  )
}

/**
 * 快速开始卡片内部的三个页签：快速开始 / 功能入口 / 更多。
 *
 * 页签用文字深浅表示当前所在区块，不再放进度条和数字；内容只显示当前页签
 * 对应的入口，避免把密钥、充值、站外业务全部堆在一屏里。
 */
export function QuickStartNav(props: { example: RequestExample }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<QuickStartTab>('start')

  const tabs: { id: QuickStartTab; label: string }[] = [
    { id: 'start', label: t('Quick start') },
    { id: 'features', label: t('Feature entries') },
    { id: 'more', label: t('More') },
  ]

  return (
    <div className='flex flex-1 flex-col gap-4'>
      <div
        role='tablist'
        aria-label={t('Quick start')}
        className='flex items-center gap-4'
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type='button'
            role='tab'
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'text-sm transition-colors',
              tab === item.id
                ? 'text-foreground font-semibold'
                : 'text-muted-foreground/45 hover:text-muted-foreground'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role='tabpanel' className='flex min-h-0 flex-1 flex-col gap-3'>
        {tab === 'start' ? <StartTab example={props.example} /> : null}
        {tab === 'features' ? <FeaturesTab /> : null}
        {tab === 'more' ? <MoreTab /> : null}
      </div>
    </div>
  )
}
