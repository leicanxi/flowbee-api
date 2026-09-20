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
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { isApiSuccess } from '@/features/wallet/api'
import { useTopupInfo } from '@/features/wallet/hooks'
import { formatCurrency, getPaymentIcon, submitPaymentForm } from '@/features/wallet/lib'
import type { PaymentMethod } from '@/features/wallet/types'
import { cn } from '@/lib/utils'

import { requestSponsorshipPayment } from '../api'
import type { SponsorshipInfo, SponsorshipTierOption } from '../types'

function TierTile(props: {
  option: SponsorshipTierOption
  selected: boolean
  minMoney: number
  maxMoney: number
  customMoney: string
  onSelect: (option: SponsorshipTierOption) => void
  onCustomMoneyChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const {
    option,
    selected,
    minMoney,
    maxMoney,
    customMoney,
    onSelect,
    onCustomMoneyChange,
  } = props

  const tileClassName = cn(
    'flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 transition-all duration-200',
    selected
      ? 'border-foreground/30 bg-muted/50 shadow-sm'
      : 'border-border/70 hover:border-foreground/25 hover:bg-muted/30'
  )

  // 图标固定宽高：外链图片加载慢，不给尺寸会让整排选项在加载时抖一下。
  const icon = option.icon_url ? (
    <img
      src={option.icon_url}
      alt=''
      width={36}
      height={36}
      loading='lazy'
      decoding='async'
      className='h-9 w-9 object-contain'
    />
  ) : (
    <span className='h-9 w-9' aria-hidden='true' />
  )

  // 自定义档把金额输入框直接做进卡片里，和其他档位保持同一个形状：
  // 前三个档位"点一下就选好了"，第四个却要展开下面的输入框，两套操作
  // 方式并存会让人以为自定义是另一条路径。
  //
  // 它不能是 button —— 按钮里放输入框是无效嵌套，点击也会被按钮吞掉。
  if (option.custom) {
    return (
      <div
        className={cn(
          tileClassName,
          'focus-within:ring-ring/50 focus-within:ring-3 focus-within:outline-none'
        )}
      >
        {icon}
        <span className='text-sm font-semibold whitespace-nowrap'>
          {option.label}
        </span>
        <div className='flex h-7 items-center gap-1'>
          <span className='text-muted-foreground text-xs'>¥</span>
          <Input
            id='sponsorship-custom-money'
            type='number'
            inputMode='decimal'
            min={minMoney}
            max={maxMoney}
            step='1'
            value={customMoney}
            onChange={(event) => onCustomMoneyChange(event.target.value)}
            onFocus={() => onSelect(option)}
            onClick={() => onSelect(option)}
            placeholder={`${minMoney}-${maxMoney}`}
            aria-label={t('Custom Amount')}
            className='h-7 w-20 px-2 text-center text-sm'
          />
        </div>
      </div>
    )
  }

  return (
    <button
      type='button'
      onClick={() => onSelect(option)}
      aria-pressed={selected}
      aria-label={`${option.label}, ¥${formatCurrency(option.money)}`}
      className={cn(
        tileClassName,
        'focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none'
      )}
    >
      {icon}
      <span className='text-sm font-semibold whitespace-nowrap'>
        {option.label}
      </span>
      {/* 固定 h-7 与自定义档的输入框同高，否则四个格子的高度会差一截。 */}
      <span className='text-muted-foreground flex h-7 items-center text-xs tabular-nums'>
        ¥{formatCurrency(option.money)}
      </span>
    </button>
  )
}

/**
 * 支付方式列表。
 *
 * 这个组件只在已登录时挂载，这一点是必须的：渠道配置来自
 * /api/user/topup/info，它需要鉴权，未登录时请求会被 401 并触发全局
 * 「跳登录」拦截 —— 那会把整张公开的支持页也一起带走，而访客本来就
 * 应该能看名单。所以把它拆成子组件，靠"不挂载"来避免这次请求，
 * 而不是在 hook 里加开关。
 */
function PaymentMethodPicker(props: {
  money: number
  payingMethod: string
  onPay: (method: PaymentMethod) => void
}) {
  const { t } = useTranslation()
  const { topupInfo } = useTopupInfo()

  const payMethods = (topupInfo?.pay_methods ?? []).filter(
    (method) => (method.min_topup || 0) <= props.money
  )

  if (payMethods.length === 0) {
    return (
      <p className='text-muted-foreground text-sm'>
        {t('No payment method available for this amount. Try a larger one.')}
      </p>
    )
  }

  return (
    <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
      {payMethods.map((method) => (
        <Button
          key={method.type}
          type='button'
          variant='outline'
          disabled={!!props.payingMethod}
          onClick={() => props.onPay(method)}
          className='h-auto min-h-12 min-w-0 justify-start gap-2 px-3 py-2.5'
        >
          {props.payingMethod === method.type ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            getPaymentIcon(method.type, 'h-4 w-4', method.icon, method.name)
          )}
          <span className='min-w-0 truncate'>{method.name}</span>
        </Button>
      ))}
    </div>
  )
}

/**
 * 支持区：选档位 → 填寄语 → 选支付方式。
 *
 * 两处刻意的设计：
 *   - 支付通道在选中档位之后才展开。四个选项先把决策成本降到"点一下"，
 *     一上来就铺开金额输入框和一堆支付方式，只会让人先关掉页面。
 *   - 整块收在 max-w-2xl 里。页面容器很宽，铺满之后四个格子会被拉成四条
 *     细长的横条，底下的支付按钮更是长到失去点击意图。
 */
export function SupportSection(props: {
  info: SponsorshipInfo
  isAuthenticated: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [selected, setSelected] = useState<SponsorshipTierOption | null>(null)
  const [customMoney, setCustomMoney] = useState('')
  const [message, setMessage] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [payingMethod, setPayingMethod] = useState('')
  // 金额区默认收起。页面第一屏留给"为什么需要支持"（目标、进度、已支持人数），
  // 付款表单摆在下面一层，由用户自己决定什么时候展开。
  const [joined, setJoined] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const tiersRef = useRef<HTMLDivElement>(null)

  // 展开金额区后把它带进视野：手机上它落在首屏之下，
  // 点了按钮却没反应的话，用户会以为按钮坏了。
  useEffect(() => {
    if (!joined) {
      return
    }
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    tiersRef.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
    })
  }, [joined])

  // 选中档位后把下面展开的区块带进视野。
  //
  // 手机上一排档位正好压在首屏底部，展开的寄语与支持方式落在首屏之外 ——
  // 不滚这一下，用户点完会以为"什么都没发生"，就卡在那儿了。
  // 用 block: 'nearest'：桌面上这块本来就在视野内，此时不会有任何滚动，
  // 不会出现"点一下整页乱跳"。
  useEffect(() => {
    if (!selected) {
      return
    }
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    panelRef.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
    })
  }, [selected])

  const isCustom = selected?.custom === true
  const parsedCustom = Number(customMoney)
  const customIsValid =
    Number.isFinite(parsedCustom) &&
    parsedCustom >= props.info.custom_min_money &&
    parsedCustom <= props.info.custom_max_money
  let money = selected?.money ?? 0
  if (isCustom) {
    money = customIsValid ? parsedCustom : 0
  }

  const handlePay = async (method: PaymentMethod) => {
    if (!selected) {
      return
    }
    setPayingMethod(method.type)
    try {
      const response = await requestSponsorshipPayment({
        tier_id: selected.id,
        money: isCustom ? money : undefined,
        payment_method: method.type,
        anonymous,
        message,
      })
      if (!isApiSuccess(response) || !response.url || !response.data) {
        toast.error(response.message || t('Payment request failed'))
        return
      }
      submitPaymentForm(response.url, response.data)
      toast.success(t('Redirecting to payment page...'))
    } catch {
      toast.error(t('Payment request failed'))
    } finally {
      setPayingMethod('')
    }
  }

  // 支付方式区有三种互斥状态：金额还没填或不合法、未登录、正常列出渠道。
  // 写成变量而不是嵌套三元，是因为每个分支都带自己的文案和布局，
  // 堆进一个表达式之后就看不出哪个分支对应哪种情况了。
  let payMethodsBody: ReactNode
  if (!Number.isFinite(money) || money <= 0) {
    payMethodsBody = (
      <p className='text-muted-foreground text-sm'>
        {t('Enter an amount first.')}
      </p>
    )
  } else if (!props.isAuthenticated) {
    payMethodsBody = (
      <div className='space-y-3'>
        <p className='text-muted-foreground text-sm'>
          {t('Sign in first, then pick a payment method.')}
        </p>
        <Button
          type='button'
          className='h-10'
          onClick={() =>
            navigate({
              to: '/sign-in',
              search: { redirect: window.location.href },
            })
          }
        >
          {t('Sign in to support')}
        </Button>
      </div>
    )
  } else {
    payMethodsBody = (
      <PaymentMethodPicker
        money={money}
        payingMethod={payingMethod}
        onPay={handlePay}
      />
    )
  }

  // 收起态只留一个按钮。这是单向门：展开之后按钮就退场，表单接管这一块 ——
  // 让人再点一次把正在填的表单收起来没有意义。
  if (!joined) {
    return (
      <div className='text-center'>
        <Button
          type='button'
          onClick={() => setJoined(true)}
          className='h-11 rounded-full px-8 text-sm font-semibold'
        >
          {t('I want to join in')}
        </Button>
      </div>
    )
  }

  return (
    <div className='mx-auto w-full max-w-2xl'>
      <div ref={tiersRef} className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        {props.info.options.map((option) => (
          <TierTile
            key={option.id}
            option={option}
            selected={selected?.id === option.id}
            minMoney={props.info.custom_min_money}
            maxMoney={props.info.custom_max_money}
            customMoney={customMoney}
            onSelect={setSelected}
            onCustomMoneyChange={setCustomMoney}
          />
        ))}
      </div>

      {isCustom && (
        <p className='text-muted-foreground mt-2 text-center text-xs'>
          {t('Supported range: ¥{{min}} - ¥{{max}}', {
            min: formatCurrency(props.info.custom_min_money),
            max: formatCurrency(props.info.custom_max_money),
          })}
        </p>
      )}

      {selected && (
        <div ref={panelRef} className='mt-6 space-y-6'>
          <div className='space-y-2'>
            <label htmlFor='sponsorship-message' className='text-sm font-medium'>
              {t('Leave a few words (optional)')}
            </label>
            <Textarea
              id='sponsorship-message'
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={props.info.max_message_length}
              rows={2}
              placeholder={props.info.default_message}
              className='resize-none'
            />
            <div className='flex items-center justify-end gap-3'>
              <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                {message.length}/{props.info.max_message_length}
              </span>
            </div>
          </div>

          <label className='flex cursor-pointer items-start gap-2.5'>
            <Checkbox
              checked={anonymous}
              onCheckedChange={(checked) => setAnonymous(checked === true)}
              className='mt-0.5'
            />
            <span className='text-sm'>
              <span className='font-medium'>{t('Support anonymously')}</span>
              <span className='text-muted-foreground mt-0.5 block text-xs'>
                {t('Your avatar and name stay hidden on the wall. You can still see this record yourself.')}
              </span>
            </span>
          </label>

          <div className='space-y-2.5 border-t pt-5'>
            <p className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
              {t('Support Method')}
            </p>
            {payMethodsBody}
          </div>
        </div>
      )}

      {!selected && (
        <p className='text-muted-foreground mt-4 text-center text-sm'>
          {t('Pick an amount to continue.')}
        </p>
      )}
    </div>
  )
}
