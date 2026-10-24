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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch } from '@/components/ui/switch'

import {
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

export function CheckinSettingsSection({
  defaultValues,
}: {
  defaultValues: {
    enabled: boolean
  }
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [enabled, setEnabled] = useState(defaultValues.enabled)

  const save = async () => {
    if (enabled === defaultValues.enabled) return
    await updateOption.mutateAsync({
      key: 'checkin_setting.enabled',
      value: String(enabled),
    })
  }

  return (
    <SettingsSection title={t('Check-in Settings')}>
      <div className='space-y-3'>
        <SettingsSwitchItem>
          <SettingsSwitchContent>
            <span className='text-sm font-medium'>
              {t('Enable check-in feature')}
            </span>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Allow users to check in daily. The points awarded are configured in Welfare Points.'
              )}
            </p>
          </SettingsSwitchContent>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={updateOption.isPending}
          />
        </SettingsSwitchItem>
        <SettingsPageFormActions
          onSave={save}
          isSaving={updateOption.isPending}
          isSaveDisabled={enabled === defaultValues.enabled}
          saveLabel='Save check-in settings'
        />
      </div>
    </SettingsSection>
  )
}
