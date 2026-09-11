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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

/**
 * 抽奖设置（改造#12）
 *
 * 抽象成「一套通用抽奖机制」而不是「一次生日活动」：活动名、奖池、时间窗、
 * 分享文案、折算口径全部可配，换一期活动只改这里，不用动代码。
 *
 * 奖池参数必须可配，否则「改份数不用重新编译」就是一句空话。
 * 奖池里 id / weight / reserved_user_ids 这几个字段不在表单里暴露，
 * 但提交时会原样保留 —— 尤其是 reserved_user_ids（内定预留位），
 * 如果被表单覆盖成空数组，活动造势的预留就会失效，而且很难发现。
 */

const prizeSchema = z.object({
  id: z.string(),
  name: z.string(),
  quota: z.coerce.number().int().min(0),
  total: z.coerce.number().int().min(0),
})

const schema = z.object({
  enabled: z.boolean(),
  title: z.string().min(1),
  startTime: z.string(),
  endTime: z.string(),
  maxDrawsPerUser: z.coerce.number().int().min(1).max(10),
  freeDrawsPerUser: z.coerce.number().int().min(0).max(10),
  pacingSlack: z.coerce.number().min(0.1).max(5),
  shareText: z.string(),
  // 折算口径：按「模型单价 × 补贴倍率」推出展示用的综合单价
  anchorInputPrice: z.coerce.number().min(0),
  anchorOutputPrice: z.coerce.number().min(0),
  anchorCachePrice: z.coerce.number().min(0),
  anchorCacheHitRate: z.coerce.number().min(0).max(1),
  anchorOutputShare: z.coerce.number().min(0).max(1),
  anchorGroupRatio: z.coerce.number().min(0),
  prizes: z.array(prizeSchema),
})

/**
 * 客户端复算一遍综合单价，仅用于表单里那行提示。
 *
 * 公式必须与后端 LotteryAnchorPricePerMillion 完全一致：
 *   (1-输出占比) × [命中率×缓存价 + (1-命中率)×输入价] + 输出占比×输出价
 * 再乘分组倍率。不一致的话，提示就会和用户实际看到的 token 数对不上。
 */
function estimateAnchorPrice(v: {
  anchorInputPrice: number
  anchorOutputPrice: number
  anchorCachePrice: number
  anchorCacheHitRate: number
  anchorOutputShare: number
  anchorGroupRatio: number
}): number {
  const hit = Math.min(1, Math.max(0, v.anchorCacheHitRate || 0))
  const outputShare = Math.min(1, Math.max(0, v.anchorOutputShare || 0))
  const groupRatio = v.anchorGroupRatio > 0 ? v.anchorGroupRatio : 1
  const inputPart =
    (1 - outputShare) *
    (hit * (v.anchorCachePrice || 0) + (1 - hit) * (v.anchorInputPrice || 0))
  const outputPart = outputShare * (v.anchorOutputPrice || 0)
  const price = (inputPart + outputPart) * groupRatio
  return price > 0 ? Number(price.toFixed(4)) : 0
}

type Values = z.infer<typeof schema>

interface RawPrize {
  id: string
  name: string
  quota: number
  total: number
  weight?: number
  reserved_user_ids?: number[]
}

/** Unix 秒 → datetime-local 输入值 */
function toLocalInput(ts: number): string {
  if (!ts || ts <= 0) return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`
}

/** datetime-local 输入值 → Unix 秒 */
function toUnix(value: string): number {
  if (!value) return 0
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000)
}

function parsePrizes(raw: string): RawPrize[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as RawPrize[]
  } catch {
    return []
  }
}

export function LotterySettingsSection({
  defaultValues,
}: {
  defaultValues: {
    enabled: boolean
    title: string
    startTime: number
    endTime: number
    maxDrawsPerUser: number
    freeDrawsPerUser: number
    pacingSlack: number
    shareText: string
    anchorInputPrice: number
    anchorOutputPrice: number
    anchorCachePrice: number
    anchorCacheHitRate: number
    anchorOutputShare: number
    anchorGroupRatio: number
    prizes: string
  }
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const originalPrizes = useMemo(
    () => parsePrizes(defaultValues.prizes),
    [defaultValues.prizes]
  )

  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: {
      enabled: defaultValues.enabled,
      title: defaultValues.title,
      startTime: toLocalInput(defaultValues.startTime),
      endTime: toLocalInput(defaultValues.endTime),
      maxDrawsPerUser: defaultValues.maxDrawsPerUser,
      freeDrawsPerUser: defaultValues.freeDrawsPerUser,
      pacingSlack: defaultValues.pacingSlack,
      shareText: defaultValues.shareText,
      anchorInputPrice: defaultValues.anchorInputPrice,
      anchorOutputPrice: defaultValues.anchorOutputPrice,
      anchorCachePrice: defaultValues.anchorCachePrice,
      anchorCacheHitRate: defaultValues.anchorCacheHitRate,
      anchorOutputShare: defaultValues.anchorOutputShare,
      anchorGroupRatio: defaultValues.anchorGroupRatio,
      prizes: originalPrizes.map((p) => ({
        id: p.id,
        name: p.name,
        quota: p.quota,
        total: p.total,
      })),
    },
  })

  const { isDirty, isSubmitting } = form.formState
  const enabled = form.watch('enabled')
  const prizes = form.watch('prizes')
  const effectiveAnchorPrice = estimateAnchorPrice({
    anchorInputPrice: form.watch('anchorInputPrice'),
    anchorOutputPrice: form.watch('anchorOutputPrice'),
    anchorCachePrice: form.watch('anchorCachePrice'),
    anchorCacheHitRate: form.watch('anchorCacheHitRate'),
    anchorOutputShare: form.watch('anchorOutputShare'),
    anchorGroupRatio: form.watch('anchorGroupRatio'),
  })

  async function onSubmit(values: Values) {
    const updates: Array<{ key: string; value: string }> = []
    const push = (key: string, value: string, original: unknown) => {
      if (value !== String(original)) {
        updates.push({ key: `lottery_setting.${key}`, value })
      }
    }

    push('enabled', String(values.enabled), defaultValues.enabled)
    push('title', values.title, defaultValues.title)

    const startUnix = toUnix(values.startTime)
    const endUnix = toUnix(values.endTime)
    push('start_time', String(startUnix), defaultValues.startTime)
    push('end_time', String(endUnix), defaultValues.endTime)
    push(
      'max_draws_per_user',
      String(values.maxDrawsPerUser),
      defaultValues.maxDrawsPerUser
    )
    push(
      'free_draws_per_user',
      String(values.freeDrawsPerUser),
      defaultValues.freeDrawsPerUser
    )
    push('pacing_slack', String(values.pacingSlack), defaultValues.pacingSlack)
    push('share_text', values.shareText, defaultValues.shareText)
    push(
      'anchor_input_price_per_million',
      String(values.anchorInputPrice),
      defaultValues.anchorInputPrice
    )
    push(
      'anchor_output_price_per_million',
      String(values.anchorOutputPrice),
      defaultValues.anchorOutputPrice
    )
    push(
      'anchor_cache_price_per_million',
      String(values.anchorCachePrice),
      defaultValues.anchorCachePrice
    )
    push(
      'anchor_cache_hit_rate',
      String(values.anchorCacheHitRate),
      defaultValues.anchorCacheHitRate
    )
    push(
      'anchor_output_share',
      String(values.anchorOutputShare),
      defaultValues.anchorOutputShare
    )
    push(
      'anchor_group_ratio',
      String(values.anchorGroupRatio),
      defaultValues.anchorGroupRatio
    )

    // 合并回原始字段（weight / reserved_user_ids 不在表单里，必须原样保留）
    const merged = values.prizes.map((p) => {
      const origin = originalPrizes.find((o) => o.id === p.id)
      return {
        id: p.id,
        name: p.name,
        quota: p.quota,
        total: p.total,
        weight: origin?.weight ?? 1,
        reserved_user_ids: origin?.reserved_user_ids ?? [],
      }
    })
    push('prizes', JSON.stringify(merged), defaultValues.prizes)

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }
    form.reset(values)
  }

  return (
    <SettingsSection title={t('Lucky Draw')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || isSubmitting}
            isSaveDisabled={!isDirty}
            saveLabel='Save lottery settings'
          />

          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable lucky draw')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Rewards are drawn from a fixed-size prize pool and credited directly to user balance'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={updateOption.isPending || isSubmitting}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          {enabled && (
            <>
              <div className='grid gap-6 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='title'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Event title')}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Shown on the draw card — change it when you reuse this for another event'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='shareText'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Share text')}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Copied to the clipboard when a user taps share — keep the domain in it so the message can lead back'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='grid gap-6 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='startTime'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Start time')}</FormLabel>
                      <FormControl>
                        <Input type='datetime-local' {...field} />
                      </FormControl>
                      <FormDescription>
                        {t('Draws are rejected before this time')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='endTime'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('End time')}</FormLabel>
                      <FormControl>
                        <Input type='datetime-local' {...field} />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Leaving this empty disables drawing entirely — it is deliberately conservative'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='grid gap-6 sm:grid-cols-2 lg:grid-cols-4'>
                <FormField
                  control={form.control}
                  name='maxDrawsPerUser'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Draws per user')}</FormLabel>
                      <FormControl>
                        <Input type='number' min={1} max={10} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='freeDrawsPerUser'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Free draws per user')}</FormLabel>
                      <FormControl>
                        <Input type='number' min={0} max={10} {...field} />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Draws beyond this number require sharing first, enforced on the server'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='pacingSlack'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Pacing slack')}</FormLabel>
                      <FormControl>
                        <Input type='number' step='0.1' min={0.1} max={5} {...field} />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Higher spreads rewards earlier; lower keeps them back for later'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* token 折算口径。
                  这组参数只影响「≈ X 万 token」这个展示数字，完全不参与真实计费
                  （真实扣费走 model_ratio × group_ratio）。
                  之所以拆成单价 + 假设两组，是为了让这个数字可解释：
                  缓存命中率与输出占比对结果的影响，其实比单价本身更大。 */}
              <div className='space-y-3'>
                <div className='text-sm font-medium'>
                  {t('Token display conversion')}
                </div>
                <div className='grid gap-6 sm:grid-cols-3'>
                  <FormField
                    control={form.control}
                    name='anchorInputPrice'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Input price per million')}</FormLabel>
                        <FormControl>
                          <Input type='number' step='0.01' min={0} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='anchorOutputPrice'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Output price per million')}</FormLabel>
                        <FormControl>
                          <Input type='number' step='0.01' min={0} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='anchorCachePrice'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Cache hit price per million')}</FormLabel>
                        <FormControl>
                          <Input type='number' step='0.01' min={0} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='anchorCacheHitRate'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Cache hit rate')}</FormLabel>
                        <FormControl>
                          <Input type='number' step='0.01' min={0} max={1} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='anchorOutputShare'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Output token share')}</FormLabel>
                        <FormControl>
                          <Input type='number' step='0.01' min={0} max={1} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='anchorGroupRatio'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Group ratio')}</FormLabel>
                        <FormControl>
                          <Input type='number' step='0.01' min={0} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Display only — never used for real billing. Effective price now: about ¥{{price}} per million tokens',
                    { price: effectiveAnchorPrice }
                  )}
                </p>
              </div>

              <div className='space-y-3'>
                <div className='text-sm font-medium'>{t('Prize pool')}</div>
                {prizes.map((prize, index) => (
                  <div
                    key={prize.id || index}
                    className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]'
                  >
                    <FormField
                      control={form.control}
                      name={`prizes.${index}.name`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Prize name')}</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`prizes.${index}.quota`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Quota')}</FormLabel>
                          <FormControl>
                            <Input type='number' min={0} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`prizes.${index}.total`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Units')}</FormLabel>
                          <FormControl>
                            <Input type='number' min={0} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ))}
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Total cost is the sum of quota × units, and never exceeds it — units are a hard cap'
                  )}
                </p>
              </div>
            </>
          )}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
