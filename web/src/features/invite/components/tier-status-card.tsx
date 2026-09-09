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
import { ChevronLeft, ChevronRight, Crown } from 'lucide-react'
import {
  RiGlobalFill,
  RiHandCoinFill,
  RiHandHeartFill,
  RiSparklingFill,
} from 'react-icons/ri'
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { formatQuotaWithCurrency } from '@/lib/currency'

import type { UserWalletData } from '@/features/wallet/types'

/**
 * 改造#8：福利页「我的等级」卡组。
 *
 * 视觉按设计稿（member-cards.html，1140px 设计宽度）1:1 像素复刻：
 * 卡片内部所有尺寸/坐标（勋章、丝带、金币、标题、权益栏）均使用设计稿
 * 的原始 px 值，整卡固定为 1140×520 的「画布」（卡片满宽 1140，与其他卡片
 * 左右边缘对齐），再通过 ResizeObserver
 * 计算 scale = 容器宽度 / 1140 整体等比缩放。这样任何断点下卡片各处
 * 比例与设计稿完全一致，避免响应式重排导致的样式漂移。
 *
 * 内容接入：前三档的解锁阈值复用「分组余额速率限制」里 welfare 组的
 * min_quota（后端通过 /api/user/self 的 welfare_thresholds 返回已排序
 * 阈值），当前等级由用户余额对比阈值得到。后两档（揽境/极观）为
 * 「未开放」档位，不渲染权益图标栏，仅展示一段说明文字。
 */

/** 设计稿画布尺寸：wrap 宽 1140（卡片满宽 1140），高 = 10 + 498 + 12。 */
const DESIGN_WIDTH = 1140
const DESIGN_HEIGHT = 520

type ThemeVars = Record<string, string>

const LEVEL_THEME: ThemeVars[] = [
  // 拾光 (silver)
  {
    '--bg1': '#d9dbdf',
    '--bg2': '#c3c7cd',
    '--bg3': '#b2b6be',
    '--stripe': '110,120,140',
    '--title': '#4a4d58',
    '--sub': '#62656f',
    '--label': '#4a4c56',
    '--icon': '#5d6370',
    '--circ1': '#ffffff',
    '--circ2': '#f3f5f7',
    '--circ3': '#e4e7ea',
    '--cut': '#ffffff',
    '--tagbg': 'rgba(70,80,95,0.10)',
    '--tagtxt': '#4a4d58',
    '--disc1': '#fdfeff',
    '--disc2': '#eef1f4',
    '--discShad': '130,150,170',
    '--discArc': '#ffffff',
    '--discArc2': '255,255,255',
  },
  // 逐行 (blue)
  {
    '--bg1': '#d2e5ec',
    '--bg2': '#c4d9e4',
    '--bg3': '#adc9d6',
    '--stripe': '110,140,160',
    '--title': '#34586e',
    '--sub': '#54727f',
    '--label': '#3a5a6c',
    '--icon': '#48718c',
    '--circ1': '#ffffff',
    '--circ2': '#f2f9fc',
    '--circ3': '#e4eef5',
    '--cut': '#ffffff',
    '--tagbg': 'rgba(84,100,115,0.10)',
    '--tagtxt': '#3a5c6e',
    '--disc1': '#fdfeff',
    '--disc2': '#eef6fa',
    '--discShad': '130,155,175',
    '--discArc': '#ffffff',
    '--discArc2': '255,255,255',
  },
  // 知遇 (gold)
  {
    '--bg1': '#f6e9cd',
    '--bg2': '#efd9ad',
    '--bg3': '#e2c593',
    '--stripe': '178,138,76',
    '--title': '#5d401c',
    '--sub': '#79613c',
    '--label': '#5a3e1f',
    '--icon': '#7f643c',
    '--circ1': '#fdf6e7',
    '--circ2': '#f6e5c2',
    '--circ3': '#ecd6a8',
    '--cut': '#ffffff',
    '--tagbg': 'rgba(120,90,40,0.10)',
    '--tagtxt': '#6b4c22',
    '--disc1': '#fdf6e9',
    '--disc2': '#f4e2c0',
    '--discShad': '170,130,70',
    '--discArc': '#ffffff',
    '--discArc2': '255,250,240',
  },
  // 揽境 (plat)
  {
    '--bg1': '#f8e6d0',
    '--bg2': '#edcfa8',
    '--bg3': '#dbb791',
    '--stripe': '170,120,85',
    '--title': '#4a2915',
    '--sub': '#684c34',
    '--label': '#4a2c18',
    '--icon': '#705238',
    '--circ1': '#fdf1e4',
    '--circ2': '#f6e2cc',
    '--circ3': '#eed5b8',
    '--cut': '#ffffff',
    '--tagbg': 'rgba(140,90,60,0.10)',
    '--tagtxt': '#5a331c',
    '--disc1': '#fdf1e5',
    '--disc2': '#f5dfc6',
    '--discShad': '160,110,70',
    '--discArc': '#ffffff',
    '--discArc2': '255,250,244',
  },
  // 极观 (black)
  {
    '--bg1': '#3a3835',
    '--bg2': '#2e2d2a',
    '--bg3': '#232220',
    '--stripe': '255,255,255',
    '--title': '#fbead0',
    '--sub': '#bfae85',
    '--label': '#f3e3c0',
    '--icon': '#efd9ae',
    '--circ1': '#4a4640',
    '--circ2': '#403c37',
    '--circ3': '#37342f',
    '--cut': '#3a3733',
    '--tagbg': 'rgba(255,255,255,0.07)',
    '--tagtxt': '#efdfbd',
    '--disc1': '#0a0908',
    '--disc2': '#1e1d1b',
    '--discShad': '0,0,0',
    '--discArc': '#060606',
    '--discArc2': '6,6,6',
  },
]

// 前三档公益调用的档位前缀（基础/进阶/充足），文案随档位变化。
const CHARITY_KEYS = [
  'Basic charity calls',
  'Advanced charity calls',
  'Full charity calls',
]

// 等级名（品牌名，不参与翻译）。
const LEVEL_NAMES = ['拾光', '逐行', '知遇', '揽境', '极观']
const BADGE_URLS = [
  'https://img.remit.ee/i/xA1C99HjLsnU',
  'https://img.remit.ee/i/AjqJLcmFTvbI',
  'https://img.remit.ee/i/3imWjhJP2xSF',
  'https://img.remit.ee/i/dMyDrvmVpRsJ',
  'https://img.remit.ee/i/fp1QjFw7d7nu',
]

/**
 * 设计稿等比缩放容器：外层占满可用宽度，内层为固定 1140×572 的设计画布，
 * transform scale 适配。返回的 scale 同时用于撑起外层高度。
 */
function useDesignScale(designWidth: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  const update = useCallback(
    (width: number) => {
      if (width > 0) setScale(width / designWidth)
    },
    [designWidth]
  )

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    update(el.clientWidth)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) update(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [update])

  return { ref, scale }
}

/** 权益图标 + 标签（设计稿 .item：圆 74px，标签 34px，圆心由 left 指定）。 */
function BenefitItem({
  left,
  icon,
  label,
}: {
  left: number
  icon: ReactNode
  label: string
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 302,
        left,
        transform: 'translateX(-50%)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 74,
          height: 74,
          margin: '0 auto',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(circle at 50% 35%, var(--circ1) 0%, var(--circ2) 55%, var(--circ3) 100%)',
          boxShadow:
            '0 11px 18px rgba(var(--discShad), 0.14), 0 3px 7px rgba(var(--discShad), 0.10)',
          color: 'var(--icon)',
        }}
      >
        {icon}
      </div>
      <div
        style={{
          marginTop: 25,
          fontSize: 34,
          fontWeight: 400,
          color: 'var(--label)',
          letterSpacing: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
    </div>
  )
}

/** 右侧金币装饰（卡内右下，375×322，含投影、双层弧线与星点）。 */
function CoinArt({ coinId }: { coinId: string }) {
  const blur4 = `${coinId}-blur4`
  const blur1 = `${coinId}-blur1`
  return (
    <svg
      style={{
        position: 'absolute',
        left: 765,
        top: -12,
        width: 375,
        height: 322,
        pointerEvents: 'none',
      }}
      viewBox='0 0 375 322'
      xmlns='http://www.w3.org/2000/svg'
    >
      <defs>
        <linearGradient id={coinId} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stopColor='var(--disc1)' stopOpacity='0.95' />
          <stop offset='50%' stopColor='var(--disc2)' stopOpacity='0.5' />
          <stop offset='100%' stopColor='var(--disc2)' stopOpacity='0' />
        </linearGradient>
        <filter
          id={blur4}
          x='-40%'
          y='-40%'
          width='180%'
          height='180%'
        >
          <feGaussianBlur stdDeviation='4' />
        </filter>
        <filter
          id={blur1}
          x='-40%'
          y='-40%'
          width='180%'
          height='180%'
        >
          <feGaussianBlur stdDeviation='1' />
        </filter>
      </defs>
      <ellipse
        cx='162'
        cy='262'
        rx='116'
        ry='21'
        fill='rgba(var(--discShad),0.09)'
        filter={`url(#${blur4})`}
      />
      <ellipse cx='162' cy='268' rx='122' ry='26' fill={`url(#${coinId})`} />
      <path
        d='M40 268 A122 26 0 0 1 284 268'
        fill='none'
        stroke='var(--discArc)'
        strokeWidth='2.8'
        filter={`url(#${blur1})`}
      />
      <path
        d='M52 274 A114 24 0 0 1 272 274'
        fill='none'
        stroke='rgba(var(--discArc2),0.75)'
        strokeWidth='1.6'
        filter={`url(#${blur1})`}
      />
      <circle cx='262' cy='26' r='2.4' fill='#ffffff' opacity='0.95' />
      <circle cx='281' cy='44' r='1.7' fill='#ffffff' opacity='0.9' />
      <circle cx='297' cy='20' r='2.0' fill='#ffffff' opacity='0.9' />
      <circle cx='310' cy='60' r='2.6' fill='#ffffff' opacity='0.95' />
      <circle cx='328' cy='88' r='2.0' fill='#ffffff' opacity='0.9' />
      <circle cx='299' cy='86' r='1.5' fill='#ffffff' opacity='0.85' />
    </svg>
  )
}

/** 单个等级卡片渲染需要的元数据。 */
type TierCardProps = {
  index: number
  name: string
  badgeUrl: string
  theme: ThemeVars
  coinId: string
  isCurrent: boolean
  /** 该档的解锁阈值（余额达到即解锁）。undefined 表示未开放。 */
  threshold?: number
  /** 下一档的解锁阈值，用于「余额达到 X 可升级」。undefined 表示无下一公开档。 */
  nextThreshold?: number
}

function TierCard({
  index,
  name,
  badgeUrl,
  theme,
  coinId,
  isCurrent,
  threshold,
  nextThreshold,
}: TierCardProps) {
  const { t } = useTranslation()
  const locked = threshold === undefined
  const { ref, scale } = useDesignScale(DESIGN_WIDTH)

  return (
    <div ref={ref} className='w-full' style={{ height: DESIGN_HEIGHT * scale }}>
      {/* 设计画布：固定 1140×520，整体等比缩放 */}
      <div
        style={{
          position: 'relative',
          width: DESIGN_WIDTH,
          height: DESIGN_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          ...theme,
        }}
      >
        {/* 勋章：正对下方椭圆高光（CoinArt 椭圆中心 ≈ 卡内 x 927），顶部轻微高出卡缘 */}
        <img
          src={badgeUrl}
          alt={name}
          aria-hidden
          loading='lazy'
          className='pointer-events-none'
          style={{
            position: 'absolute',
            left: 807,
            top: 0,
            width: 240,
            height: 240,
            zIndex: 3,
          }}
        />
        <div
          style={{
            position: 'relative',
            margin: '10px 0 12px 0',
            width: DESIGN_WIDTH,
            height: 498,
            borderRadius: 12 / scale,
            overflow: 'hidden',
            background:
              'linear-gradient(112deg, var(--bg1) 0%, var(--bg2) 52%, var(--bg3) 100%)',
          }}
        >
          {/* 斜向细条纹丝带 */}
          <div
            className='pointer-events-none'
            style={{
              position: 'absolute',
              left: -134,
              top: 150,
              width: 1400,
              height: 192,
              transform: 'rotate(-65.4deg)',
              background:
                'repeating-linear-gradient(0deg, rgba(var(--stripe), 0) 0px, rgba(var(--stripe), 0) 8px, rgba(var(--stripe), 0.46) 8px, rgba(var(--stripe), 0.46) 9.4px)',
              maskImage:
                'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
              WebkitMaskImage:
                'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
              opacity: 0.9,
            }}
          />
          {/* 右下角金币装饰 */}
          <CoinArt coinId={coinId} />

          {isCurrent ? (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                height: 50,
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 30px 0 26px',
                borderRadius: `${12 / scale}px 0 0 0`,
                background: 'var(--tagbg)',
                fontSize: 30,
                color: 'var(--tagtxt)',
                letterSpacing: 1,
              }}
            >
              {t('Current Tier')}
            </div>
          ) : null}

          <h3
            style={{
              position: 'absolute',
              left: 51,
              top: 96,
              margin: 0,
              fontSize: 52,
              fontWeight: 600,
              lineHeight: 1,
              color: 'var(--title)',
            }}
          >
            {name}
          </h3>
          <p
            style={{
              position: 'absolute',
              left: 51,
              top: 178,
              margin: 0,
              fontSize: 38,
              fontWeight: 500,
              lineHeight: 1,
              color: 'var(--sub)',
              whiteSpace: 'nowrap',
            }}
          >
            {levelNote(
              nextThreshold,
              LEVEL_NAMES[index + 1],
              locked,
              t
            )}
          </p>

          {locked ? (
            // 未开放档位（揽境/极观）：无权益图标栏，仅一段说明文字。
            // 文字范围覆盖整个卡宽（left 51 → 右边界 1089，含右侧金币装饰区），
            // 字号较设计稿放大，以改善手机端（整卡等比缩放）下的可读性。
            <p
              style={{
                position: 'absolute',
                left: 51,
                top: 296,
                width: 1038,
                margin: 0,
                fontSize: 36,
                fontWeight: 400,
                lineHeight: 1.6,
                color: 'var(--sub)',
              }}
            >
              {t(
                'Support our charity cause and we will donate to the Tencent Charity program based on your usage, then upgrade your tier.'
              )}
            </p>
          ) : (
            <>
              <BenefitItem
                left={179}
                icon={<RiHandHeartFill size={44} />}
                label={t(CHARITY_KEYS[index])}
              />
              <BenefitItem
                left={439}
                icon={<RiHandCoinFill size={44} />}
                label={t('Site subsidy')}
              />
              <BenefitItem
                left={697}
                icon={<RiGlobalFill size={44} />}
                label={t('Tencent charity')}
              />
              <BenefitItem
                left={956}
                icon={<RiSparklingFill size={44} />}
                label={t('More benefits coming')}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function levelNote(
  nextThreshold: number | undefined,
  nextTierName: string | undefined,
  locked: boolean,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (locked) return t('Not Available Yet')
  if (nextThreshold !== undefined && nextTierName !== undefined) {
    return t('Reach balance {{amount}} to upgrade', {
      amount: formatQuotaWithCurrency(nextThreshold),
      tier: nextTierName,
    })
  }
  return t('Highest open tier reached')
}

/**
 * TierStatusCard 渲染福利页面「福利等级」卡组（轮播）。
 * 默认定位到用户当前等级卡：手机端左右滑动切换档位，桌面端用两侧箭头
 * 或标题行内的档位标签切换。user 为空时兜底展示第一档。
 */
export function TierStatusCard({ user }: { user: UserWalletData | null }) {
  const { t } = useTranslation()

  // 后端返回的 welfare_thresholds 已升序；未配置时兜底为 [0]，保证入门档恒存在。
  const rawThresholds = user?.welfare_thresholds ?? []
  const thresholds = rawThresholds.length > 0 ? rawThresholds : [0]
  const quota = user?.quota ?? 0

  // 当前等级 = 余额 >= 阈值中最高的那一档，截断到前三档（揽境/极观永不自动命中）。
  let currentLevel = 0
  for (let i = 0; i < thresholds.length; i++) {
    if (quota >= thresholds[i]) currentLevel = i
  }
  currentLevel = Math.min(currentLevel, 2)

  // —— 轮播状态 ——
  const [activeIndex, setActiveIndex] = useState(currentLevel)
  const activeIndexRef = useRef(currentLevel)
  const viewportRef = useRef<HTMLDivElement>(null)
  const anchoredRef = useRef(false)

  const showIndex = useCallback((index: number) => {
    activeIndexRef.current = index
    setActiveIndex(index)
  }, [])

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = viewportRef.current
      if (!el) return
      const clamped = Math.min(
        Math.max(index, 0),
        LEVEL_NAMES.length - 1
      )
      showIndex(clamped)
      el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' })
    },
    [showIndex]
  )

  // 用户数据就绪后一次性定位到当前等级卡（数据异步到达，不能只在挂载时定位）
  useLayoutEffect(() => {
    if (anchoredRef.current || !user) return
    const el = viewportRef.current
    if (!el || el.clientWidth === 0) return
    el.scrollLeft = currentLevel * el.clientWidth
    showIndex(currentLevel)
    anchoredRef.current = true
  }, [user, currentLevel, showIndex])

  // 滚动时同步高亮的档位标签
  const handleScroll = useCallback(() => {
    const el = viewportRef.current
    if (!el || el.clientWidth === 0) return
    const index = Math.round(el.scrollLeft / el.clientWidth)
    const clamped = Math.min(
      Math.max(index, 0),
      LEVEL_NAMES.length - 1
    )
    if (clamped !== activeIndexRef.current) showIndex(clamped)
  }, [showIndex])

  // 容器宽度变化（断点切换等）时保持当前档位
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (el.clientWidth > 0) {
        el.scrollLeft = activeIndexRef.current * el.clientWidth
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <section className='space-y-3'>
      <div className='space-y-1.5'>
        <div className='flex flex-wrap items-center gap-2.5'>
          <IconBadge tone='chart-1' size='md'>
            <Crown />
          </IconBadge>
          <h2 className='text-sm font-semibold'>{t('Welfare Tier')}</h2>
        </div>
        {/* 免费额度规则说明：放在卡片外，避免受卡内设计稿等比缩放影响导致手机端过小 */}
        <p className='text-[13px] leading-relaxed text-muted-foreground sm:text-sm'>
          {t(
            'Free quota is allocated by balance to prevent bot abuse. The threshold is extremely low, and calling free models does not consume your quota.'
          )}
        </p>
      </div>

      <div className='relative'>
        {/* 切换箭头：仅桌面（sm+）显示，手机端手势滑动 */}
        <button
          type='button'
          onClick={() => scrollToIndex(activeIndexRef.current - 1)}
          disabled={activeIndex === 0}
          aria-label={t('Previous tier')}
          className='absolute top-1/2 left-1 z-20 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border bg-background/90 text-foreground shadow-sm backdrop-blur transition-opacity disabled:pointer-events-none disabled:opacity-40 sm:flex'
        >
          <ChevronLeft className='size-4' />
        </button>
        <button
          type='button'
          onClick={() => scrollToIndex(activeIndexRef.current + 1)}
          disabled={activeIndex === LEVEL_NAMES.length - 1}
          aria-label={t('Next tier')}
          className='absolute top-1/2 right-1 z-20 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border bg-background/90 text-foreground shadow-sm backdrop-blur transition-opacity disabled:pointer-events-none disabled:opacity-40 sm:flex'
        >
          <ChevronRight className='size-4' />
        </button>

        <div
          ref={viewportRef}
          onScroll={handleScroll}
          className='flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        >
          {LEVEL_NAMES.map((name, index) => {
            const reachable = index < thresholds.length
            const threshold = reachable ? thresholds[index] : undefined
            const nextThreshold =
              reachable && index + 1 < thresholds.length
                ? thresholds[index + 1]
                : undefined

            return (
              <div key={name} className='w-full shrink-0 snap-center'>
                <TierCard
                  index={index}
                  name={name}
                  badgeUrl={BADGE_URLS[index]}
                  theme={LEVEL_THEME[index]}
                  coinId={`welfare-coin-${index}`}
                  isCurrent={index === currentLevel}
                  threshold={threshold}
                  nextThreshold={nextThreshold}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* 轮播指示点：暗示可左右滑动（手机端无箭头，主要靠手势） */}
      <div className='flex items-center justify-center gap-2'>
        {LEVEL_NAMES.map((name, index) => (
          <button
            key={name}
            type='button'
            onClick={() => scrollToIndex(index)}
            aria-label={name}
            className={`h-1.5 rounded-full transition-all duration-200 ${
              index === activeIndex
                ? 'w-5 bg-primary'
                : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50'
            }`}
          />
        ))}
      </div>
    </section>
  )
}
