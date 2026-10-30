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
import { Plus, Trash2 } from 'lucide-react'
import { useFieldArray, useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { SponsorshipModeration } from '@/features/sponsorship/components/moderation-list'
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

interface RawTier {
  id?: string
  label?: string
  icon_url?: string
  money?: number
}

interface RawPartner {
  name?: string
  url?: string
  note?: string
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

/**
 * 把配置里存储的 JSON 数组解析成表单行。
 *
 * 解析失败时返回空数组而不是抛错：后台配置里存了坏 JSON 时，
 * 页面应该还能打开并让人把它改回来，而不是整块设置页白屏。
 */
function parseJsonArray<T>(raw: string): T[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

const tierSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  label: z.string().min(1, 'Label is required'),
  iconUrl: z.string(),
  money: z.coerce.number().positive(),
})

const partnerSchema = z.object({
  name: z.string(),
  url: z.string(),
  note: z.string(),
})

/** 表单形态 → 配置里存储的 JSON 形态。 */
function toServerTiers(tiers: Values['tiers']): RawTier[] {
  return tiers.map((tier) => ({
    id: tier.id,
    label: tier.label,
    icon_url: tier.iconUrl,
    money: tier.money,
  }))
}

function toServerPartners(partners: Values['partners']): RawPartner[] {
  return partners.map((partner) => ({
    name: partner.name,
    url: partner.url,
    note: partner.note,
  }))
}

const schema = z.object({
  enabled: z.boolean(),
  title: z.string(),
  businessContact: z.string(),
  partners: z.array(partnerSchema),
  goalEnabled: z.boolean(),
  goalName: z.string(),
  goalTargetMoney: z.coerce.number().min(0),
  tiers: z.array(tierSchema),
  customLabel: z.string(),
  customIconUrl: z.string(),
  customMinMoney: z.coerce.number().positive(),
  customMaxMoney: z.coerce.number().positive(),
  maxMessageLength: z.coerce.number().int().positive(),
  defaultMessage: z.string(),
  earlyDeadline: z.string(),
  continuousWindowMonths: z.coerce.number().int().positive(),
  continuousMinCount: z.coerce.number().int().positive(),
  majorSupporterMinMoney: z.coerce.number().min(0),
  cumulativeSupporterMinMoney: z.coerce.number().min(0),
})

type Values = z.infer<typeof schema>

export interface SponsorshipSettingsDefaults {
  enabled: boolean
  title: string
  businessContact: string
  /** 配置里原样存下来的合作位 JSON 字符串 */
  partners: string
  goalEnabled: boolean
  goalName: string
  goalTargetMoney: number
  /** 配置里原样存下来的档位 JSON 字符串 */
  tiers: string
  customLabel: string
  customIconUrl: string
  customMinMoney: number
  customMaxMoney: number
  maxMessageLength: number
  defaultMessage: string
  earlyDeadline: number
  continuousWindowMonths: number
  continuousMinCount: number
  majorSupporterMinMoney: number
  cumulativeSupporterMinMoney: number
}

export function SponsorshipSettingsSection({
  defaultValues,
}: {
  defaultValues: SponsorshipSettingsDefaults
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const initialTiers = parseJsonArray<RawTier>(defaultValues.tiers).map(
    (tier) => ({
      id: tier.id ?? '',
      label: tier.label ?? '',
      iconUrl: tier.icon_url ?? '',
      money: tier.money ?? 0,
    })
  )
  const initialPartners = parseJsonArray<RawPartner>(
    defaultValues.partners
  ).map((partner) => ({
    name: partner.name ?? '',
    url: partner.url ?? '',
    note: partner.note ?? '',
  }))
  // 脏检查用规范化后的形态比对，而不是直接比原始 JSON 字符串：
  // 服务端存回来的字符串在字段顺序或空白上可能与重新序列化的结果不同，
  // 直接比字符串会导致"没改也会提交"。
  const initialTiersJson = JSON.stringify(toServerTiers(initialTiers))
  const initialPartnersJson = JSON.stringify(toServerPartners(initialPartners))
  const initialDeadline = toLocalInput(defaultValues.earlyDeadline)

  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: {
      enabled: defaultValues.enabled,
      title: defaultValues.title,
      businessContact: defaultValues.businessContact,
      partners: initialPartners,
      goalEnabled: defaultValues.goalEnabled,
      goalName: defaultValues.goalName,
      goalTargetMoney: defaultValues.goalTargetMoney,
      tiers: initialTiers,
      customLabel: defaultValues.customLabel,
      customIconUrl: defaultValues.customIconUrl,
      customMinMoney: defaultValues.customMinMoney,
      customMaxMoney: defaultValues.customMaxMoney,
      maxMessageLength: defaultValues.maxMessageLength,
      defaultMessage: defaultValues.defaultMessage,
      earlyDeadline: initialDeadline,
      continuousWindowMonths: defaultValues.continuousWindowMonths,
      continuousMinCount: defaultValues.continuousMinCount,
      majorSupporterMinMoney: defaultValues.majorSupporterMinMoney,
      cumulativeSupporterMinMoney: defaultValues.cumulativeSupporterMinMoney,
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'tiers',
  })

  const {
    fields: partnerFields,
    append: appendPartner,
    remove: removePartner,
  } = useFieldArray({
    control: form.control,
    name: 'partners',
  })

  const { isDirty, isSubmitting } = form.formState
  const enabled = form.watch('enabled')

  async function onSubmit(values: Values) {
    const updates: Array<{ key: string; value: string }> = []
    const push = (key: string, value: string, original: string) => {
      if (value !== original) {
        updates.push({ key: `sponsorship_setting.${key}`, value })
      }
    }

    push('enabled', String(values.enabled), String(defaultValues.enabled))
    push('title', values.title, defaultValues.title)
    push(
      'business_contact',
      values.businessContact,
      defaultValues.businessContact
    )

    const serializedPartners = JSON.stringify(toServerPartners(values.partners))
    push('partners', serializedPartners, initialPartnersJson)
    push('goal_enabled', String(values.goalEnabled), String(defaultValues.goalEnabled))
    push('goal_name', values.goalName, defaultValues.goalName)
    push(
      'goal_target_money',
      String(values.goalTargetMoney),
      String(defaultValues.goalTargetMoney)
    )

    const serializedTiers = JSON.stringify(toServerTiers(values.tiers))
    push('tiers', serializedTiers, initialTiersJson)

    push('custom_label', values.customLabel, defaultValues.customLabel)
    push('custom_icon_url', values.customIconUrl, defaultValues.customIconUrl)
    push(
      'custom_min_money',
      String(values.customMinMoney),
      String(defaultValues.customMinMoney)
    )
    push(
      'custom_max_money',
      String(values.customMaxMoney),
      String(defaultValues.customMaxMoney)
    )
    push(
      'max_message_length',
      String(values.maxMessageLength),
      String(defaultValues.maxMessageLength)
    )
    push('default_message', values.defaultMessage, defaultValues.defaultMessage)
    push(
      'early_supporter_deadline',
      String(toUnix(values.earlyDeadline)),
      String(defaultValues.earlyDeadline)
    )
    push(
      'continuous_window_months',
      String(values.continuousWindowMonths),
      String(defaultValues.continuousWindowMonths)
    )
    push(
      'continuous_min_count',
      String(values.continuousMinCount),
      String(defaultValues.continuousMinCount)
    )
    push(
      'major_supporter_min_money',
      String(values.majorSupporterMinMoney),
      String(defaultValues.majorSupporterMinMoney)
    )
    push(
      'cumulative_supporter_min_money',
      String(values.cumulativeSupporterMinMoney),
      String(defaultValues.cumulativeSupporterMinMoney)
    )

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
    <SettingsSection title={t('Support Settings')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || isSubmitting}
            isSaveDisabled={!isDirty}
            saveLabel='Save support settings'
          />

          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable support feature')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Show the support page with the supporter wall and payment entry'
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
              <FormField
                control={form.control}
                name='title'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Page title')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='businessContact'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Contact info')}</FormLabel>
                    <FormControl>
                      <Input placeholder='contact@example.com' {...field} />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Email or link shown at the bottom of the page. Leave empty to hide.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='space-y-4'>
                <div>
                  <FormLabel>{t('Partners')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Shown in a row of three slots. Empty slots invite new partners.'
                    )}
                  </FormDescription>
                </div>
                <div className='space-y-3'>
                  {partnerFields.map((field, index) => (
                    <div
                      key={field.id}
                      className='grid gap-3 sm:grid-cols-[1fr_1.5fr_1fr_auto]'
                    >
                      <FormField
                        control={form.control}
                        name={`partners.${index}.name`}
                        render={({ field: inputField }) => (
                          <FormItem>
                            <FormLabel className='sm:sr-only'>
                              {t('Name')}
                            </FormLabel>
                            <FormControl>
                              <Input {...inputField} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`partners.${index}.url`}
                        render={({ field: inputField }) => (
                          <FormItem>
                            <FormLabel className='sm:sr-only'>
                              {t('URL')}
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder='https://example.com'
                                {...inputField}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`partners.${index}.note`}
                        render={({ field: inputField }) => (
                          <FormItem>
                            <FormLabel className='sm:sr-only'>
                              {t('Note')}
                            </FormLabel>
                            <FormControl>
                              <Input {...inputField} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        onClick={() => removePartner(index)}
                        aria-label={t('Delete')}
                        className='self-start'
                      >
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() =>
                    appendPartner({ name: '', url: '', note: '' })
                  }
                >
                  <Plus className='h-4 w-4' />
                  {t('Add partner')}
                </Button>
              </div>

              <FormField
                control={form.control}
                name='goalEnabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Show the funding goal')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Progress counts the current calendar month and resets on the 1st. Set the target to 0 to hide it.'
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

              {form.watch('goalEnabled') && (
                <div className='grid gap-6 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='goalName'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Goal name')}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormDescription>
                          {t('Shown next to the progress bar')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='goalTargetMoney'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Monthly target amount')}</FormLabel>
                        <FormControl>
                          <Input type='number' min={0} {...field} />
                        </FormControl>
                        <FormDescription>
                          {t('0 means the goal is not shown')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              <div className='space-y-4'>
                <div>
                  <FormLabel>{t('Amount options')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Shown as a row of tiles. The custom amount is always the first tile.'
                    )}
                  </FormDescription>
                </div>
                <div className='space-y-3'>
                  {fields.map((field, index) => (
                    <div
                      key={field.id}
                      className='grid gap-3 sm:grid-cols-[5rem_1fr_1.5fr_6rem_auto]'
                    >
                      <FormField
                        control={form.control}
                        name={`tiers.${index}.id`}
                        render={({ field: inputField }) => (
                          <FormItem>
                            <FormLabel className='sm:sr-only'>
                              {t('ID')}
                            </FormLabel>
                            <FormControl>
                              <Input {...inputField} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`tiers.${index}.label`}
                        render={({ field: inputField }) => (
                          <FormItem>
                            <FormLabel className='sm:sr-only'>
                              {t('Label')}
                            </FormLabel>
                            <FormControl>
                              <Input {...inputField} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`tiers.${index}.iconUrl`}
                        render={({ field: inputField }) => (
                          <FormItem>
                            <FormLabel className='sm:sr-only'>
                              {t('Icon URL')}
                            </FormLabel>
                            <FormControl>
                              <Input {...inputField} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`tiers.${index}.money`}
                        render={({ field: inputField }) => (
                          <FormItem>
                            <FormLabel className='sm:sr-only'>
                              {t('Amount')}
                            </FormLabel>
                            <FormControl>
                              <Input type='number' min={1} {...inputField} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        onClick={() => remove(index)}
                        aria-label={t('Delete')}
                        className='self-start sm:mt-0'
                      >
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() =>
                    append({ id: '', label: '', iconUrl: '', money: 0 })
                  }
                >
                  <Plus className='h-4 w-4' />
                  {t('Add option')}
                </Button>
              </div>

              <div className='grid gap-6 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='customLabel'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Custom option label')}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='customIconUrl'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Custom option icon URL')}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='customMinMoney'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Minimum custom amount')}</FormLabel>
                      <FormControl>
                        <Input type='number' min={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='customMaxMoney'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Maximum custom amount')}</FormLabel>
                      <FormControl>
                        <Input type='number' min={1} {...field} />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Anything above {{max}} is rejected regardless of this setting',
                          { max: 100000 }
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
                  name='maxMessageLength'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Maximum message length')}</FormLabel>
                      <FormControl>
                        <Input type='number' min={1} {...field} />
                      </FormControl>
                      <FormDescription>
                        {t('Counted in characters, not bytes')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='defaultMessage'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Message shown when left blank')}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='grid gap-6 sm:grid-cols-3'>
                <FormField
                  control={form.control}
                  name='earlyDeadline'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Early supporter deadline')}</FormLabel>
                      <FormControl>
                        <Input type='datetime-local' {...field} />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Anyone supporting before this moment keeps the badge forever. Leave empty to stop giving it out.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='continuousWindowMonths'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Ongoing supporter window (months)')}</FormLabel>
                      <FormControl>
                        <Input type='number' min={1} {...field} />
                      </FormControl>
                      <FormDescription>
                        {t('How far back support still counts as ongoing')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='continuousMinCount'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('Ongoing supporter minimum count')}
                      </FormLabel>
                      <FormControl>
                        <Input type='number' min={1} {...field} />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'A single recent support is not ongoing — it needs a count floor to mean anything'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='majorSupporterMinMoney'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('Major supporter minimum amount')}
                      </FormLabel>
                      <FormControl>
                        <Input type='number' min={0} {...field} />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'A single payment at or above this amount earns the badge. 0 means it is not given out.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='cumulativeSupporterMinMoney'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('Cumulative supporter minimum amount')}
                      </FormLabel>
                      <FormControl>
                        <Input type='number' min={0} {...field} />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Total support at or above this amount earns the badge. 0 means it is not given out.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </>
          )}
        </SettingsForm>
      </Form>

      {enabled && (
        <div className='mt-8 space-y-3 border-t pt-6'>
          <div>
            <h3 className='text-sm font-medium'>{t('Messages on the wall')}</h3>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Messages show up as soon as the payment goes through. Take one down if it should not stay public.'
              )}
            </p>
          </div>
          <SponsorshipModeration />
        </div>
      )}
    </SettingsSection>
  )
}
