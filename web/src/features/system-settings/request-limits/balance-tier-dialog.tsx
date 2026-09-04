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
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
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

// The form edits the balance threshold as a money amount; the stored
// ModelRequestRateLimitBalanceTier JSON keeps quota units. Conversion
// uses the system currency config (CNY applies usdExchangeRate).
import { getCurrencyDisplay } from '@/lib/currency'

/** Convert a quota amount to the display currency amount. */
function quotaToMoney(quota: number): number {
  const { config, meta } = getCurrencyDisplay()
  if (meta.kind === 'tokens') return quota / config.quotaPerUnit
  const rate = meta.kind === 'currency' ? (meta as { exchangeRate?: number }).exchangeRate ?? 1 : 1
  return (quota / config.quotaPerUnit) * rate
}

/** Convert a display currency amount back to quota units. */
function moneyToQuota(money: number): number {
  const { config, meta } = getCurrencyDisplay()
  if (meta.kind === 'tokens') return Math.round(money * config.quotaPerUnit)
  const rate = meta.kind === 'currency' ? (meta as { exchangeRate?: number }).exchangeRate ?? 1 : 1
  return Math.round(money / rate * config.quotaPerUnit)
}

/** Symbol prefix for the display currency (e.g. "$", "¥", or none for tokens). */
function moneySymbol(): string {
  const { meta } = getCurrencyDisplay()
  return meta.kind === 'currency' || meta.kind === 'custom' ? meta.symbol : ''
}

const balanceTierDialogSchema = z.object({
  groupName: z.string().min(1, 'Group name is required'),
  minMoney: z
    .number()
    .min(0, 'Must be ≥ 0')
    .max(1000000, 'Must be ≤ 1,000,000'),
  total: z
    .number()
    .min(0, 'Must be ≥ 0')
    .max(2147483647, 'Must be ≤ 2,147,483,647'),
  success: z
    .number()
    .min(1, 'Must be ≥ 1')
    .max(2147483647, 'Must be ≤ 2,147,483,647'),
})

type BalanceTierDialogFormValues = z.infer<typeof balanceTierDialogSchema>

const BALANCE_TIER_FORM_ID = 'balance-tier-form'

export type BalanceTierEntryData = {
  groupName: string
  minQuota: number
  total: number
  success: number
}

type BalanceTierDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: BalanceTierEntryData) => void
  editData?: BalanceTierEntryData | null
}

export function BalanceTierDialog({
  open,
  onOpenChange,
  onSave,
  editData,
}: BalanceTierDialogProps) {
  const { t } = useTranslation()
  const isEditMode = !!editData

  const form = useForm<BalanceTierDialogFormValues>({
    resolver: zodResolver(balanceTierDialogSchema),
    defaultValues: {
      groupName: '',
      minMoney: 0,
      total: 0,
      success: 1,
    },
  })

  useEffect(() => {
    if (editData) {
      form.reset({
        groupName: editData.groupName,
        minMoney: quotaToMoney(editData.minQuota),
        total: editData.total,
        success: editData.success,
      })
    } else {
      form.reset({
        groupName: '',
        minMoney: 0,
        total: 0,
        success: 1,
      })
    }
  }, [editData, form, open])

  const handleSubmit = (values: BalanceTierDialogFormValues) => {
    onSave({
      groupName: values.groupName,
      minQuota: moneyToQuota(values.minMoney),
      total: values.total,
      success: values.success,
    })
    form.reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditMode ? t('Edit balance tier') : t('Add balance tier')}
      description={t(
        'Configure a rate limit tier based on account balance for a specific user group.'
      )}
      contentClassName='sm:max-w-[500px]'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={BALANCE_TIER_FORM_ID}>
            {isEditMode ? t('Update') : t('Add')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={BALANCE_TIER_FORM_ID}
          onSubmit={form.handleSubmit(handleSubmit)}
          className='space-y-4'
        >
          <FormField
            control={form.control}
            name='groupName'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Group Name')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t('e.g., default, vip, premium')}
                    {...field}
                    disabled={isEditMode}
                  />
                </FormControl>
                <FormDescription>
                  {isEditMode
                    ? t('Group name cannot be changed when editing.')
                    : t('Unique identifier for this group.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='minMoney'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Min Balance')}</FormLabel>
                <FormControl>
                  <div className='flex items-center gap-2'>
                    {moneySymbol() && (
                      <span className='text-muted-foreground text-sm'>
                        {moneySymbol()}
                      </span>
                    )}
                    <Input
                      type='number'
                      min={0}
                      max={1000000}
                      step={0.01}
                      {...field}
                      onChange={(e) =>
                        field.onChange(parseFloat(e.target.value) || 0)
                      }
                    />
                  </div>
                </FormControl>
                <FormDescription>
                  {t(
                    'Minimum account balance required for this tier, in display currency.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='total'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Max Requests (including failures)')}</FormLabel>
                <FormControl>
                  <div className='flex items-center gap-2'>
                    <Input
                      type='number'
                      min={0}
                      max={2147483647}
                      step={1}
                      {...field}
                      onChange={(e) =>
                        field.onChange(parseInt(e.target.value) || 0)
                      }
                    />
                    <span className='text-muted-foreground text-sm'>
                      {t('times')}
                    </span>
                  </div>
                </FormControl>
                <FormDescription>
                  {t('Total requests allowed per period. 0 = unlimited.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='success'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Max Successful Requests')}</FormLabel>
                <FormControl>
                  <div className='flex items-center gap-2'>
                    <Input
                      type='number'
                      min={1}
                      max={2147483647}
                      step={1}
                      {...field}
                      onChange={(e) =>
                        field.onChange(parseInt(e.target.value) || 1)
                      }
                    />
                    <span className='text-muted-foreground text-sm'>
                      {t('times')}
                    </span>
                  </div>
                </FormControl>
                <FormDescription>
                  {t('Only successful requests count toward this limit.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Dialog>
  )
}
