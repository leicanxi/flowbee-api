import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { JsonCodeEditor } from '@/components/json-code-editor'
import { Button } from '@/components/ui/button'

import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const DISABLED_DEFAULT = `{
  "enabled": false,
  "group": "福利",
  "subsidy_groups": ["flowbee专属补贴", "国模企业补贴"],
  "daily_base_points": 0,
  "new_user_points": 0,
  "model_costs": {
    "default": 1
  },
  "consume_tiers": [
    {"min_quota": 0, "points": 0}
  ],
  "checkin_min_points": 0,
  "checkin_max_points": 0,
  "invitee_points": 0,
  "inviter_points": 0,
  "sponsor_points": 0,
  "inviter_rebate_percent": 0,
  "inviter_rebate_max_quota": 0
}`

const EXAMPLE = `{
  "enabled": true,
  "group": "福利",
  "subsidy_groups": ["flowbee专属补贴", "国模企业补贴"],
  "daily_base_points": 5,
  "new_user_points": 10,
  "model_costs": {
    "default": 1,
    "deepseek-chat": 1,
    "gpt-4o-mini": 2
  },
  "consume_tiers": [
    {"min_quota": 0, "points": 0},
    {"min_quota": 500000, "points": 3},
    {"min_quota": 2500000, "points": 10}
  ],
  "checkin_min_points": 5,
  "checkin_max_points": 20,
  "invitee_points": 5,
  "inviter_points": 20,
  "sponsor_points": 30,
  "inviter_rebate_percent": 5,
  "inviter_rebate_max_quota": 1000000
}`

export function WelfarePointsSection({
  defaultValue,
}: {
  defaultValue: string
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [value, setValue] = useState(defaultValue || DISABLED_DEFAULT)

  const parseError = useMemo(() => {
    try {
      const parsed = JSON.parse(value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return t('Root value must be a JSON object')
      }
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, [t, value])

  const save = async () => {
    if (parseError) return
    await updateOption.mutateAsync({
      key: 'WelfarePointsSetting',
      value,
    })
  }

  return (
    <SettingsSection title={t('Welfare Points')}>
      <div className='space-y-3'>
        <p className='text-muted-foreground text-sm leading-relaxed'>
          {t(
            'Daily and check-in points reset every day. New-user, invite, consumption rebate and sponsorship points never expire. A call in the configured welfare group costs the model cost below; an exact model name wins, then the longest trailing "*" prefix, then "default".'
          )}
        </p>
        <p className='text-muted-foreground text-sm leading-relaxed'>
          {t(
            'Consumption tiers use quota units. 500000 quota is ¥1 with the default quota-per-unit setting.'
          )}
        </p>
        <p className='text-muted-foreground text-sm leading-relaxed'>
          {t(
            'When inviter_rebate_percent is above 0, the inviter earns that percentage of the invitee first credited top-up as balance instead of inviter_points; inviter_rebate_max_quota caps each rebate in quota units (0 means no cap).'
          )}
        </p>
        <p className='text-muted-foreground text-sm leading-relaxed'>
          {t(
            'Subsidy groups only feed the "site subsidy" figure on the overview page: the gap between list price and what users actually paid. They never change billing. List a group here only if it really sells below list price.'
          )}
        </p>
        <JsonCodeEditor
          value={value}
          onChange={setValue}
          name='WelfarePointsSetting'
          heightClassName='h-80 min-h-80 max-h-80'
          placeholder={EXAMPLE}
          aria-invalid={Boolean(parseError)}
        />
        {parseError ? (
          <p className='text-destructive text-xs'>{parseError}</p>
        ) : null}
        <SettingsPageFormActions
          onSave={save}
          isSaving={updateOption.isPending}
          isSaveDisabled={Boolean(parseError)}
          saveLabel='Save welfare points'
        />
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => setValue(EXAMPLE)}
        >
          {t('Load example')}
        </Button>
      </div>
    </SettingsSection>
  )
}
