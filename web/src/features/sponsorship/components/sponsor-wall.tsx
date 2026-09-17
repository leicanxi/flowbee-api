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
import { Heart } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { cn } from '@/lib/utils'

import type { SponsorEntry } from '../types'
import { SupportBadge } from './support-badge'

/**
 * 三行的滚动参数。
 *
 * 每行时长与间距都不同：时长决定速度，间距决定密度，两者错开之后三行
 * 不会同步，看起来才像弹幕而不是三条并排的传送带。
 */
const ROW_PRESETS = [
  { duration: 46, gap: 18, offsets: [-4, 2, -1, 4, -5, 1] },
  { duration: 62, gap: 24, offsets: [3, -3, 4, -2, 2, -4] },
  { duration: 40, gap: 14, offsets: [-2, 4, -4, 1, -3, 3] },
] as const

/**
 * 一行里最少放几个气泡。
 *
 * 气泡是按内容自适应的，窄的可能只有 150px，太少就撑不满轨道，
 * 接缝处会露出空白。
 */
const MIN_BUBBLES_PER_ROW = 4

const ROW_COUNT = ROW_PRESETS.length

/**
 * 按人数决定用几行。
 *
 * 人数不够时硬撑三行，每行只有两三个人，就得把同一批人重复好几遍才够长，
 * 屏幕上会明明白白看到"张三、李四、张三、李四"——那不像热闹，像出错。
 * 人少时少用一行，每行反而更实。支持者攒够 3×4 位之后就一直是三行了。
 */
function resolveRowCount(sponsorCount: number): number {
  return Math.max(1, Math.min(ROW_COUNT, Math.floor(sponsorCount / MIN_BUBBLES_PER_ROW)))
}

/**
 * 行内重复用的标记：人数太少时要把同一批人重复几遍才够长，
 * 而 React 在同一父节点下的 key 必须唯一。用固定标记而不是数组下标，
 * 既满足唯一性，也不会因为下标做 key 而在重排时错配。
 */
const REPEAT_MARKS = ['a', 'b', 'c', 'd'] as const

/** 气泡底色。浅暖白，和站点主背景接近，所以必须配一道描边 + 阴影，
 *  否则气泡会糊在页面底色里看不出边界。 */
const BUBBLE_SURFACE = 'bg-[#faf9f5] border-[#e7dfd0]'

/** 两侧渐隐，让气泡看起来是从边缘浮出来的。 */
const EDGE_FADE =
  'linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)'

function SponsorIdentity(props: { sponsor: SponsorEntry }) {
  const { sponsor } = props

  // 匿名只隐藏头像与昵称，寄语照常展示：
  // 勾了匿名的人写的话仍然是写给这个站看的，不该连带被丢掉。
  if (sponsor.anonymous) {
    return (
      <Avatar className='size-8 shrink-0'>
        <AvatarFallback className='bg-[#ece5d8] text-[#8b8070]'>
          <Heart className='size-3.5' aria-hidden='true' />
        </AvatarFallback>
      </Avatar>
    )
  }

  return (
    <Avatar className='size-8 shrink-0'>
      <AvatarFallback
        className='text-xs font-semibold text-white'
        style={getUserAvatarStyle(sponsor.name)}
      >
        {getUserAvatarFallback(sponsor.name)}
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * 一个支持者气泡。
 *
 * 形状是长条而不是方块：宽度由内容决定（有 min/max 兜底），高度只由行数决定，
 * 所以寄语长短不同气泡就长一截或短一截，但始终是薄薄一条。一堵大小一致的
 * 气泡墙看着很规整也很闷，参差本身就是这张墙的观感来源。
 *
 * 称号紧跟在名字后面同一行，靠的是把头像收小到 32px、胶囊也压到 10px 字号 ——
 * 只有把这两处省下来的横向空间让给名字行，两个称号才排得下不换行。
 *
 * 这里刻意不按序号调整透明度。参差的弹幕常靠明暗拉开层次，但在支持者名单上，
 * "谁的名字更淡"会被读成区分对待，和"不按金额排先后"直接冲突。
 */
function SponsorBubble(props: { sponsor: SponsorEntry; offset: number }) {
  const { t } = useTranslation()
  const { sponsor, offset } = props

  return (
    <div
      className={cn(
        'flex min-w-[150px] max-w-[290px] shrink-0 items-center gap-2.5 rounded-[22px] border px-3.5 py-2 shadow-sm',
        BUBBLE_SURFACE
      )}
      style={{ transform: `translateY(${offset}px)` }}
    >
      <SponsorIdentity sponsor={sponsor} />
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-x-1.5 gap-y-0.5'>
          <span className='truncate text-[13px] font-semibold text-[#2f2b26]'>
            {sponsor.anonymous ? t('Anonymous supporter') : sponsor.name}
          </span>
          {sponsor.badges.map((badge) => (
            <SupportBadge key={badge} badge={badge} onCream />
          ))}
        </div>
        {sponsor.message && (
          <p className='mt-0.5 line-clamp-2 text-[11px] leading-4 break-words text-[#7d7568]'>
            {sponsor.message}
          </p>
        )}
      </div>
    </div>
  )
}


function BubbleRow(props: {
  sponsors: SponsorEntry[]
  preset: (typeof ROW_PRESETS)[number]
}) {
  const { sponsors, preset } = props

  const repeats = Math.max(1, Math.ceil(MIN_BUBBLES_PER_ROW / sponsors.length))
  const items = REPEAT_MARKS.slice(0, repeats).flatMap((mark) =>
    sponsors.map((sponsor) => ({
      key: `${mark}-${sponsor.name}-${sponsor.last_time}`,
      sponsor,
    }))
  )

  // 轨道里放两份完全相同的内容，位移正好是一份的宽度（-50%），接缝处才看不出跳。
  // 每一份自带右侧内边距，把行间距算进自身宽度里，两份之间不再额外加 gap ——
  // 否则 -50% 会少走半个间距，接缝会错位。
  const renderCopy = (duplicate: boolean) => (
    <div
      className='flex shrink-0 items-center'
      style={{
        gap: `${preset.gap}px`,
        paddingRight: `${preset.gap}px`,
      }}
      aria-hidden={duplicate ? 'true' : undefined}
    >
      {items.map((item, position) => (
        <SponsorBubble
          key={item.key}
          sponsor={item.sponsor}
          offset={preset.offsets[position % preset.offsets.length] ?? 0}
        />
      ))}
    </div>
  )

  return (
    <div
      className='animate-drift-x flex w-max items-center'
      style={{ animationDuration: `${preset.duration}s` }}
    >
      {renderCopy(false)}
      {renderCopy(true)}
    </div>
  )
}

/**
 * 支持者气泡墙。
 *
 * 用固定行数的横向滚动代替纵向罗列，是为了把这一块的高度锁死：
 * 支持者越多原来的纵向列表就越长，手机用户要滑很久才能碰到
 * "我也要支持"，而那正是这个页面唯一想让访客做的动作。
 *
 * 鼠标悬停与键盘聚焦都会暂停滚动 —— 气泡里是名字和寄语，
 * 是用来读的内容，一直在动的目标读不了。
 */
export function SponsorWall(props: { sponsors: SponsorEntry[] }) {
  const { t } = useTranslation()

  if (props.sponsors.length === 0) {
    return (
      <p className='text-muted-foreground text-sm'>
        {t('No supporters yet. Your name could be the first one here.')}
      </p>
    )
  }

  // 按下标轮流分行：每行拿到的名额大致相当，相邻两位也不会挤在同一行。
  const rowCount = resolveRowCount(props.sponsors.length)
  const rows: SponsorEntry[][] = Array.from({ length: rowCount }, () => [])
  props.sponsors.forEach((sponsor, index) => {
    rows[index % rowCount].push(sponsor)
  })

  return (
    <div
      className='bubble-wall flex flex-col gap-2.5'
      role='region'
      aria-label={t('Supporters')}
    >
      {rows.map((row, rowIndex) => {
        if (row.length === 0) {
          return null
        }
        const preset = ROW_PRESETS[rowIndex]
        return (
          // py-2 给气泡的上下错位留出头，否则被 overflow-hidden 切掉。
          <div
            key={`${preset.duration}s`}
            className='overflow-hidden py-2'
            style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
          >
            <BubbleRow sponsors={row} preset={preset} />
          </div>
        )
      })}
    </div>
  )
}
