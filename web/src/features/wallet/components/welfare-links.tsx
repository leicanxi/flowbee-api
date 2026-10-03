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
import { Gauge, Gift, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { UserWalletData } from '@/features/wallet/types'
import { resolveWelfareTier, welfareTierLabel } from '@/lib/welfare-tier'

/**
 * 改造#33：钱包页标题下面那两个入口胶囊。
 *
 * 起因是多数用户不知道「免费模型调用速率」这个东西：它由余额决定，只做在福利页，
 * 而进钱包的人远比进福利页的人多。这一版最初做的是「标题上的徽标 + 点开一张
 * 明细卡」，后来收成现在的样子 —— 明细卡要占掉一整块内容区，而它想说的
 * 「我在哪一档、还差多少」在福利页的摘要条里已经有一份完整版；钱包页需要的
 * 只是「说出这条规则」和「给个入口」，两件事一行胶囊就够。
 *
 * 「（余额决定）」是这一行的重点：之前页面上只有「速率」两个字，用户会把它读成
 * 会员等级。剩下的细节（当前档、缺口、进度）都交给福利页。
 */

/**
 * 胶囊外观直接借自模型广场的模型徽标（models/performance-overview.tsx 的
 * ModelBadge）：同一套 bg-muted/50 + rounded-full 浅色胶囊，避免钱包页为了
 * 这两个入口长出一套新的视觉语言。
 */
const CHIP_CLASS_NAME =
  'bg-muted/50 hover:bg-muted inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors'

/**
 * 档位胶囊 + 福利胶囊。两个入口都指向福利页：档位的完整说明（摘要条）和免费余额
 * 的来源（签到 / 邀请 / 不定期活动）都在那一页，用户点哪个都是「去同一个地方看
 * 明白」，不必让他先判断该点哪个。
 *
 * 图标取 info（蓝）与 success（绿），不用 chart-1：本站品牌主题把 --chart-1
 * 和 --primary 绑成了同一个橙红（实测 lab 62.3 / +40.6 / +38），而这两个胶囊
 * 只是提示，用强调色会跟旁边的「赞助一下」抢注意力。
 *
 * 文字用一个 span 承载、`·` 两侧不留空格：这三段是同一句话，拆成并列的 flex
 * 子项会让 gap 在「速率」和「·」之间也插进 6px，读起来是断开的三个标签。
 *
 * 福利胶囊也带一个「（免费余额）」：只说「福利」时用户不知道点进去能拿到什么，
 * 补上这四个字才和左边的档位胶囊对等。两份括号都用半角。
 */
export function WelfareLinks(props: { user: UserWalletData | null }) {
  const { t } = useTranslation()
  const tier = resolveWelfareTier(
    props.user?.quota ?? 0,
    props.user?.welfare_thresholds ?? []
  )

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Link to='/invite' className={CHIP_CLASS_NAME}>
        <Gauge className='text-info size-3.5 shrink-0' aria-hidden='true' />
        <span>
          {t('Free model request rate')}
          <span className='text-foreground font-semibold'>
            ·{tier.locked ? t('Locked') : welfareTierLabel(t, tier.level)}
          </span>
          <span className='text-muted-foreground'>({t('Set by balance')})</span>
        </span>
        {/* 用 Info 而不是 ArrowUpRight：这一步不是「跳去另一个页面」，而是
            「看这条规则是怎么定的」，箭头（尤其 ↗）会让人以为要离开本站。 */}
        <Info
          className='text-muted-foreground size-3 shrink-0'
          aria-hidden='true'
        />
      </Link>

      <Link to='/invite' className={CHIP_CLASS_NAME}>
        <Gift className='text-success size-3.5 shrink-0' aria-hidden='true' />
        <span>
          {t('Welfare')}
          <span className='text-muted-foreground'>({t('Free credits')})</span>
        </span>
      </Link>
    </div>
  )
}
