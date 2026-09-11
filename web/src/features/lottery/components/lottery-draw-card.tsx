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
import { Gift, Loader2, Share2, Sparkles } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Turnstile } from '@/components/turnstile'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

import { drawLottery, getLotteryStatus, shareLottery } from '../api'
import type { LotteryDrawResult, LotteryPrize } from '../types'

interface LotteryDrawCardProps {
  lotteryEnabled: boolean
  turnstileEnabled: boolean
  turnstileSiteKey: string
}

/**
 * 把 token 折算数压成一个干净的整数级数字：「3000万」「1000万」「100万」。
 *
 * 只保留 1 位有效数字。这个数是从人民币反推出来的（¥5 ÷ ¥0.1519/百万 ≈ 3292 万），
 * 尾数本来就不精确，写成「3292 万」既啰嗦又假装精确 —— 用户要的是「哪一档更大」的
 * 量级对比，不是账目核对（真实数字在余额里）。
 *
 * 同时刻意不带「≈」「token」这类前后缀：满屏修饰词会把数字本身淹掉，
 * 「3000万」比「≈ 3000 万 token」短得多、也重得多。折算口径统一由卡片底部脚注交代。
 */
function formatTokenHint(tokens: number): string {
  if (tokens <= 0) return ''
  const magnitude = 10 ** Math.floor(Math.log10(tokens))
  const rounded = Math.round(tokens / magnitude) * magnitude
  if (rounded >= 1e8) return `${Math.round(rounded / 1e8)}亿`
  if (rounded >= 1e4) return `${Math.round(rounded / 1e4)}万`
  return String(rounded)
}

function findLowestQuota(prizes: LotteryPrize[]): number {
  const quotas = prizes.map((p) => p.quota).filter((q) => q > 0)
  return quotas.length > 0 ? Math.min(...quotas) : 0
}

/**
 * 分享文案的兜底值。
 *
 * 正常情况由服务端下发（后台可改），这里只是「接口没给」时的保底，
 * 保证复制按钮永远不会复制出空字符串。
 */
const DEFAULT_SHARE_TEXT = '快来flowbee瓜分福利，免费ai额度，尽在flowbee.top'

/** token 单价保留 3 位小数展示：0.15186… 写成 0.152 就够，多写的位是噪声。 */
function formatAnchorPrice(price: number): number {
  return Number((price || 0).toFixed(3))
}

/**
 * 福利页抽奖卡（改造#12）
 *
 * 几个刻意的产品决定：
 *  1. 中奖只展示奖项名，**从不展示人民币金额**，也不再重复一遍 token 数。
 *     用户看到「13700 额度」会去换算成两毛钱；而奖池预览已经把量级
 *     （3000万 / 1000万 / 100万）摆在那里了，中奖结果再报一次数字只是噪音 ——
 *     这一刻用户想知道的只有一件事：「我中了什么」。
 *     这是视觉分级，不是虚报 —— 用户查余额能看到真实数字，不可以说谎。
 *  2. 高额档额外更换背景色，并把活动名与日期放进卡片，
 *     让截图自带品牌信息，用户晒图就是免费曝光。
 *  3. 奖池预览**不展示份数**。份数是库存状态，露出去用户就能推算剩余量、
 *     挑时间刷；「限量」的感知用文案表达就够了。
 *  4. 分享文案只说「你还有 1 次抽奖机会」（损失厌恶），
 *     **不写「也可能抽不到」** —— 那是运营自己的免责心态，写在按钮旁会砍掉一半点击率。
 *  5. 分享解锁由服务端记账（/lottery/share），前端只负责在免费次数用完后
 *     把引导露出来。只在前端判断的话，直接调抽奖接口就能跳过分享。
 *  6. 抽奖记录常驻展示。结果卡片刷新即消失，记录列表才是「我中过什么」的凭据。
 */
export function LotteryDrawCard({
  lotteryEnabled,
  turnstileEnabled,
  turnstileSiteKey,
}: LotteryDrawCardProps) {
  const { t } = useTranslation()
  const [drawing, setDrawing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [result, setResult] = useState<LotteryDrawResult | null>(null)
  const [turnstileOpen, setTurnstileOpen] = useState(false)
  const [turnstileWidgetKey, setTurnstileWidgetKey] = useState(0)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['lottery-status'],
    queryFn: async () => {
      const res = await getLotteryStatus()
      if (!res.success || !res.data) {
        throw new Error(res.message || t('Failed to fetch lottery status'))
      }
      return res.data
    },
    enabled: lotteryEnabled,
  })

  const prizes = useMemo(() => data?.prizes ?? [], [data?.prizes])
  const lowestQuota = useMemo(() => findLowestQuota(prizes), [prizes])
  const topPrize = useMemo(
    () =>
      prizes.reduce<LotteryPrize | null>(
        (acc, p) => (!acc || p.quota > acc.quota ? p : acc),
        null
      ),
    [prizes]
  )

  const records = useMemo(() => data?.records ?? [], [data?.records])
  const shareText = data?.share_text?.trim() || DEFAULT_SHARE_TEXT

  const drawsLeft = data?.draws_left ?? 0
  const drawsUsed = data?.draws_used ?? 0
  const freeDraws = data?.free_draws ?? 1
  const maxDraws = data?.max_draws_per_user ?? 0
  const shared = data?.shared === true
  const isRunning = data?.status === 'running'
  const canDraw = isRunning && drawsLeft > 0 && !drawing
  // 免费次数用完、还没分享、且上限还没到 —— 这时分享是真能换到一次机会的
  const canShare = isRunning && !shared && drawsUsed >= freeDraws && drawsUsed < maxDraws
  // 抽过之后才露出分享区：没抽过的人先看到的是「立即抽奖」，不是「去分享」
  const showShareBlock = isRunning && drawsUsed > 0

  const runDraw = useCallback(
    async (token?: string) => {
      setDrawing(true)
      try {
        const res = await drawLottery(token)
        if (!res.success || !res.data) {
          toast.error(res.message || t('Draw failed'))
          await refetch()
          return
        }
        setResult(res.data)
        await refetch()
      } catch {
        toast.error(t('Draw failed'))
      } finally {
        setDrawing(false)
      }
    },
    [refetch, t]
  )

  const handleDraw = useCallback(() => {
    if (!canDraw) return
    if (turnstileEnabled) {
      setTurnstileWidgetKey((v) => v + 1)
      setTurnstileOpen(true)
      return
    }
    void runDraw()
  }, [canDraw, runDraw, turnstileEnabled])

  // 分享动作 = 复制文案（给用户看的那个动作）+ 服务端记账（真正解锁机会的那一步）。
  //
  // 复制的是「一段话」而不是活动页链接：链接丢进群里没人点，一段带品牌和利益点
  // 的文案才会被转发、被二次复制，而且用户不用二次编辑就能直接发出去。
  //
  // 复制失败不阻塞解锁：解锁条件是「点过分享」，不是「剪贴板写入成功」。
  const handleShare = useCallback(async () => {
    if (sharing) return
    setSharing(true)
    let copied = false
    try {
      await navigator.clipboard.writeText(shareText)
      copied = true
    } catch {
      copied = false
    }
    try {
      const res = await shareLottery()
      if (!res.success) {
        toast.error(res.message || t('Share failed'))
        return
      }
      await refetch()
      if (copied) {
        toast.success(t('Share text copied, paste it to your friends'))
      }
    } catch {
      toast.error(t('Share failed'))
    } finally {
      setSharing(false)
    }
  }, [refetch, sharing, shareText, t])

  if (!lotteryEnabled) return null

  if (isLoading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <div className='space-y-3 p-6'>
          <Skeleton className='h-5 w-40' />
          <Skeleton className='h-3 w-64' />
          <Skeleton className='h-10 w-32' />
        </div>
      </Card>
    )
  }

  if (!data) return null

  // 大奖定义：中奖且额度高于最低档 —— 决定结果区块是否换成金色背景。
  // 只做背景分级，不再切字号：中奖只显示奖项名，字号统一，档次靠背景色区分。
  const isBigWin =
    result != null && result.won && result.quota_awarded > lowestQuota

  return (
    <>
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <div className='border-b p-4 sm:p-6'>
          <div className='flex items-start gap-3'>
            <div className='bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-xl'>
              <Gift className='h-5 w-5' />
            </div>
            <div className='min-w-0 flex-1'>
              <h3 className='text-base font-medium'>{data.title}</h3>
              <p className='text-muted-foreground mt-1 text-xs'>
                {data.status === 'not_started'
                  ? t('Not started yet')
                  : data.status === 'ended'
                    ? t('Activity ended')
                    : drawsLeft > 0
                      ? t('You have {{count}} draw(s) left', { count: drawsLeft })
                      : canShare
                        ? t('Share to unlock 1 more draw')
                        : t('No draws left')}
              </p>
            </div>
          </div>

          {/* 奖池预览：把最高档放在最显眼的位置，用落差制造期待。
              刻意不展示份数 —— 份数一旦公开，用户就能推算剩余库存并挑时间刷；
              「限量」用文案表达就够了，不需要交出精确数字。
              同时不做「永远不会中的展示档位」——奖池里出现的每一档都必须真的发得出去，
              否则就是虚假宣传，用户核对后信任直接崩塌。 */}
          {prizes.length > 0 && (
            <div className='mt-4 space-y-2'>
              {prizes.map((prize) => (
                <div
                  key={prize.id}
                  className='bg-muted/40 flex items-center justify-between rounded-lg px-3 py-2'
                >
                  <div className='flex min-w-0 items-center gap-2'>
                    <Sparkles
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        prize.quota === topPrize?.quota
                          ? 'text-amber-500'
                          : 'text-muted-foreground'
                      )}
                    />
                    <span className='truncate text-xs font-medium'>
                      {prize.name}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-xs font-medium tabular-nums',
                      prize.quota === topPrize?.quota && 'text-amber-600'
                    )}
                  >
                    {formatTokenHint(prize.token_hint)}
                  </span>
                </div>
              ))}
              {/* 折算口径必须写出来：token 数是由额度反推的估算值，
                  不标口径就等于用不精确的数字充数。标注之后反而更可信 ——
                  而且「按本站补贴价折算」本身就是一句有用的广告。 */}
              <p className='text-muted-foreground text-[11px]'>
                {t(
                  'Token figures are estimated with your group subsidy rate (about ¥{{price}} per million tokens)',
                  { price: formatAnchorPrice(data.anchor_price) }
                )}
              </p>
            </div>
          )}

          {/* 抽奖按钮 */}
          <div className='mt-4'>
            {isRunning ? (
              <Button onClick={handleDraw} disabled={!canDraw} className='w-full'>
                {drawing ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    {t('Drawing in progress')}
                  </>
                ) : drawsLeft > 0 ? (
                  t('Draw now')
                ) : (
                  t('No draws left')
                )}
              </Button>
            ) : (
              <Button disabled className='w-full'>
                {data.status === 'not_started'
                  ? t('Not started yet')
                  : t('Activity ended')}
              </Button>
            )}
          </div>
        </div>

        {/* 抽奖结果 + 分享引导 + 抽奖记录。
            记录必须参与这个判断：活动结束后 showShareBlock 为 false，
            如果不带上 records，用户的活动记录会在结束后整块消失。 */}
        {(result != null || showShareBlock || records.length > 0) && (
          <div
            className={cn(
              'p-4 sm:p-6',
              isBigWin
                ? 'bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20'
                : 'bg-muted/30'
            )}
          >
            {result != null &&
              (result.won ? (
                <div className='text-center'>
                  <div className='text-sm font-medium'>{t('Congratulations')}</div>
                  {/* 中奖只报奖项名。奖池预览已经把量级（3000万/1000万/100万）说清楚了，
                      这里再报一遍 token 数只是噪音 —— 这一刻用户想知道的是「我中了什么」。
                      人民币金额依然从不出现：用户看到额度会去换算成几毛钱。 */}
                  <div className='mt-2 text-2xl font-medium'>
                    {result.prize_name}
                  </div>
                  <div className='text-muted-foreground mt-1 text-xs'>
                    {t('credited to your balance')}
                  </div>
                  {isBigWin && (
                    <div className='text-muted-foreground mt-3 text-[11px]'>
                      {data.title} · {dayjs().format('YYYY-MM-DD')}
                    </div>
                  )}
                </div>
              ) : (
                <div className='text-center text-sm'>
                  {t('Thanks for joining, see you next time')}
                </div>
              ))}

            {/* 分享引导：免费次数用完后才出现。
                文案用的是「你可以再抽一次」（机会已经在手里了），
                刻意不写「也可能抽不到」—— 那是运营自己的免责心态写在用户脸上，
                点击率会被砍掉一半，而这个免责本来就不需要。
                不加提示气泡：同一句话在按钮上方再说一遍只会稀释按钮本身。 */}
            {showShareBlock && (
              <div className={cn(result != null && 'mt-4')}>
                <div className='rounded-lg border border-dashed p-3'>
                  {!canShare && (
                    <div className='text-sm font-medium'>
                      {drawsLeft > 0
                        ? t('You have {{count}} draw(s) left', {
                            count: drawsLeft,
                          })
                        : t('Invite friends to join')}
                    </div>
                  )}
                  <div
                    className={cn(
                      'text-muted-foreground text-xs',
                      !canShare && 'mt-1'
                    )}
                  >
                    {topPrize
                      ? t('Tell friends to join, top prize is {{token}} tokens', {
                          token: formatTokenHint(topPrize.token_hint),
                        })
                      : t('Tell friends to join in, and use it up on the way')}
                  </div>
                  <Button
                    variant='outline'
                    size='sm'
                    className='mt-3 w-full'
                    onClick={handleShare}
                    disabled={sharing}
                  >
                    {sharing ? (
                      <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                    ) : (
                      <Share2 className='mr-2 h-3.5 w-3.5' />
                    )}
                    {canShare
                      ? t('Share the good news, and you can draw one more time')
                      : t('Share with friends')}
                  </Button>
                </div>
              </div>
            )}

            {/* 我的抽奖记录。
                结果卡片说的是「刚刚那一次」，刷新页面就没了；记录列表说的是
                「我到底抽到过什么」，必须一直看得见 —— 否则用户刷新一次就会怀疑
                「我是不是白抽了」，而这种怀疑没法靠客服解释消除。 */}
            {records.length > 0 && (
              <div
                className={cn(
                  'space-y-1.5',
                  (result != null || showShareBlock) && 'mt-4 border-t pt-3'
                )}
              >
                <div className='text-muted-foreground text-[11px]'>
                  {t('My draws')}
                </div>
                {records.map((record) => (
                  <div
                    key={record.seq}
                    className='flex items-center justify-between gap-2 text-xs'
                  >
                    <span className='text-muted-foreground shrink-0'>
                      {t('Draw #{{n}}', { n: record.seq })}
                    </span>
                    {record.quota_awarded > 0 ? (
                      <span className='truncate font-medium'>
                        {record.prize_name}
                      </span>
                    ) : (
                      <span className='text-muted-foreground truncate'>
                        {t('No prize')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <Dialog
        open={turnstileOpen}
        onOpenChange={(open) => {
          setTurnstileOpen(open)
          if (!open) setTurnstileWidgetKey((v) => v + 1)
        }}
        title={t('Security Check')}
        contentClassName='sm:max-w-md'
        contentHeight='auto'
        bodyClassName='space-y-4'
      >
        <div className='flex justify-center py-2'>
          <Turnstile
            key={turnstileWidgetKey}
            siteKey={turnstileSiteKey}
            onVerify={(token) => {
              setTurnstileOpen(false)
              void runDraw(token)
            }}
            onExpire={() => setTurnstileWidgetKey((v) => v + 1)}
          />
        </div>
      </Dialog>
    </>
  )
}
