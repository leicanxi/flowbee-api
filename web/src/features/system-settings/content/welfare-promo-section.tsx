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
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'

import {
  SettingsForm,
  SettingsSwitchField,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const welfarePromoSchema = z.object({
  content: z.string().max(20000),
})

type WelfarePromoFormValues = z.infer<typeof welfarePromoSchema>

type WelfarePromoSectionProps = {
  enabled: boolean
  data: string
}

export function WelfarePromoSection({ enabled, data }: WelfarePromoSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [isEnabled, setIsEnabled] = useState(enabled)

  const form = useForm<WelfarePromoFormValues>({
    resolver: zodResolver(welfarePromoSchema),
    defaultValues: {
      content: data ?? '',
    },
  })

  useEffect(() => {
    setIsEnabled(enabled)
  }, [enabled])

  useEffect(() => {
    form.reset({ content: data ?? '' })
  }, [data, form])

  const onSubmit = async (values: WelfarePromoFormValues) => {
    const normalized = values.content ?? ''
    if (normalized === (data ?? '')) {
      return
    }
    await updateOption.mutateAsync({
      key: 'console_setting.welfare_promo',
      value: normalized,
    })
  }

  const handleToggleEnabled = (checked: boolean) => {
    setIsEnabled(checked)
    updateOption.mutate(
      { key: 'console_setting.welfare_promo_enabled', value: checked },
      {
        onError: () => setIsEnabled(!checked),
      }
    )
  }

  return (
    <SettingsSection title={t('Welfare promo')}>
      <div className='space-y-4'>
        <div className='flex items-center justify-end'>
          <SettingsSwitchField
            checked={isEnabled}
            onCheckedChange={handleToggleEnabled}
            label={t('Enabled')}
            className='py-0'
          />
        </div>

        <Form {...form}>
          <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
            <SettingsPageFormActions
              onSave={form.handleSubmit(onSubmit)}
              isSaving={updateOption.isPending}
              saveLabel='Save promo content'
            />
            <FormField
              control={form.control}
              name='content'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Promo content')}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={12}
                      className='font-mono text-xs'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Free-form HTML or Markdown shown in a collapsible section on the welfare page. Images must use external URLs; total length is capped at 20000 characters.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsForm>
        </Form>
      </div>
    </SettingsSection>
  )
}
