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
import { Gauge } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { IconBadge } from '@/components/ui/icon-badge'
import { Progress } from '@/components/ui/progress'
import type { UserWalletData } from '@/features/wallet/types'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { resolveWelfareTier, welfareTierLabel } from '@/lib/welfare-tier'

/**
 * 改造#8：福利页「我的等级」卡组。视觉曾按设计稿（member-cards.html，
 * 1140px 设计宽度）1:1 像素复刻，整卡固定 1140×520 画布再整体等比缩放。
 *
 * 改造#27：上述卡组整块删除，只保留档位摘要条。删掉的是 Lv1–Lv5 五张轮播大卡
 * （勋章、金币、丝带、四个权益图标与「当前等级」角标）、两侧箭头、指示点，以及
 * 为它们服务的等比缩放容器与五套档位主题色。
 *
 * 删除理由是重复：摘要条已经说清了「我在哪一档、还差多少、怎么解锁」，而大卡把
 * 同一组数字又画了一遍，代价是 520px 高的一屏、五张卡、五套主题色和五个远程
 * 勋章图，且用户必须滑完全部卡片才能拼出摘要条一句话就讲完的信息。
 *
 * 大卡上真正独有的内容是四个权益图标（基础公益调用 / 站长补贴 / 腾讯公益 /
 * 更多权益开放中）：它们是「会员权益」时代的产物，与这张卡现在要表达的
 * 「免费模型调用速率」不是同一件事，留着会让用户以为速率是权益之一。
 *
 * 内容接入不变：前三档阈值复用「分组余额速率限制」里 welfare 组的 min_quota
 * （后端通过 /api/user/self 的 welfare_thresholds 返回已排序阈值），当前档位由
 * 用户余额对比阈值得到。
 */

/**
 * TierStatusCard 渲染福利页的档位摘要条：当前档位、距下一档的缺口与解锁状态。
 * user 为空时兜底展示第一档。
 */
export function TierStatusCard({ user }: { user: UserWalletData | null }) {
  const { t } = useTranslation()

  const quota = user?.quota ?? 0
  // 改造#33：档位 / 缺口 / 进度的算法抽进 lib/welfare-tier.ts，与钱包页的
  // 等级卡片、概览页第 2 步的徽标共用一份。三处各写一遍时，最容易漏的
  // 就是「余额低于最低档」这条边界（后端此时返回 level = -1 并直接 429）。
  const tier = resolveWelfareTier(quota, user?.welfare_thresholds ?? [])
  const {
    locked,
    isTopTier,
    nextLevelIndex,
    progressTargetQuota,
    progressPercent,
  } = tier
  const progressTierName =
    nextLevelIndex === undefined
      ? undefined
      : welfareTierLabel(t, nextLevelIndex)

  // 解锁状态文案：三档速率不同，但差异只能落在「档位 + 缺口」上，
  // 不写具体请求速率（见下方摘要条注释）。
  let summaryStatus: string
  if (locked) {
    summaryStatus = t(
      'Balance must reach {{amount}} to use free models in the welfare group.',
      { amount: formatQuotaWithCurrency(tier.progressTargetQuota) }
    )
  } else if (isTopTier) {
    // 改造#24：删掉了原句尾的「继续充值不会提升速率」。那半句是给「正准备
    // 充值的人」的提醒，但能看到这一行的人已经解锁、且已在最高档 —— 等于对着
    // 一个已经满足的用户重复一条负面约束（"再充也没用"），不改变任何决策，
    // 却让整行读起来像警告。档位上限本身是事实陈述，说清状态就够了。
    summaryStatus = t(
      'Highest tier reached: the free model request rate is already at its cap.'
    )
  } else {
    summaryStatus = t(
      'Free models in the welfare group are unlocked. Topping up raises the request rate tier.'
    )
  }

  return (
    /* 改造#26：这里原本还有一块「Crown + 福利等级」标题，以及标题下的免费额度
       说明段，整块删除且不保留替代文案：
       - 「福利等级」是这块内容的第二个名字，而这块内容的真名已经是下面的
         「免费模型调用速率」；
       - 说明段里唯一不可替代的信息是「免费额度按余额分档」，摘要条的
         「¥1.06 / ¥2.00」与「余额达到 ¥X 可升级至 Lv2」已在表达这件事；
       - 剩下的是「平台为什么限速」——那是理由不是权益，只在用户真被拦下的那一刻
         （429）说才有意义；常驻在页面上会先指控用户，收益是负的。

       改造#27：摘要条下方原本还有一组 Lv1–Lv5 轮播大卡，整块删除（原因见文件头）。 */
    /* 改造#23：档位摘要条。原来用户必须滑完全部卡片才能拼出「我在哪一档、
       还差多少」。摘要条把「当前档位 / 进度 / 解锁状态」集中到一处，
       数据全部来自现有的 welfare_thresholds，不引入新接口。
       刻意不展示具体请求速率：这些数字是防止刷号的闸门，写进卡片等于把它
       当成产品能力展示。档位之间的差异落在「档位名 + 缺口金额」上，
       用户要的「几档不一样」由此体现，而不用把 1 次/分钟写在脸上。 */
    <div className='bg-muted/30 rounded-xl border p-3.5 sm:p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <IconBadge tone='chart-1' size='sm'>
          <Gauge />
        </IconBadge>
        <span className='text-sm font-semibold'>
          {t('Free model request rate')}
        </span>
        <Badge
          variant={locked ? 'outline' : 'secondary'}
          className='h-5 px-2 text-[10px]'
        >
          {locked ? t('Locked') : welfareTierLabel(t, tier.level)}
        </Badge>
      </div>

      <div className='mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs'>
        <span className='tabular-nums'>
          {formatQuotaWithCurrency(quota)}
          <span className='text-muted-foreground'>
            {' / '}
            {formatQuotaWithCurrency(progressTargetQuota)}
          </span>
        </span>
        <span className='text-muted-foreground'>
          {progressTierName === undefined
            ? t('Highest open tier reached')
            : /* 改造#27：这里原先用「Reach balance {{amount}} to upgrade」，传入的却是
                 「目标余额 - 当前余额」的差额 —— 文案说「余额达到 ¥0.94 可升级」，
                 而 ¥0.94 根本不是目标余额（目标是 ¥2.00），读起来就是在教用户充值
                 一笔不够的钱。改成「距 Lv2 还差 ¥0.94」后，数字与说法终于对齐：
                 差额就是差额，目标余额由上面那行「¥1.06 / ¥2.00」承担。 */
              t('{{amount}} away from {{tier}}', {
                amount: formatQuotaWithCurrency(
                  Math.max(progressTargetQuota - quota, 0)
                ),
                tier: progressTierName,
              })}
        </span>
      </div>

      <Progress value={progressPercent} className='mt-2' />

      <p className='text-muted-foreground mt-3 border-t border-dashed pt-2.5 text-xs leading-relaxed'>
        {summaryStatus}
        {/* 改造#33：补上「每分钟次数用完之后去哪」。用户此前最担心的一点是
            「用完是不是就掉进付费区间」——这件事得说出来，而且要在讲档位的地方
            说。未解锁时不成立（还没用上免费模型），所以只在已解锁时出现。 */}
        {!locked && (
          <>
            {' '}
            {t(
              'Once the per-minute quota runs out, requests fall back to the subsidy channel.'
            )}
          </>
        )}
      </p>
    </div>
  )
}
