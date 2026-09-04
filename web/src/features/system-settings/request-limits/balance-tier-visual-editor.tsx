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
import { Plus, Search } from 'lucide-react'
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table/static/static-data-table'
import { StaticRowActions } from '@/components/data-table/static/static-row-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { safeJsonParseWithValidation } from '../utils/json-parser'
import { isObjectRecord } from '../utils/json-validators'
import { BalanceTierDialog, type BalanceTierEntryData } from './balance-tier-dialog'
import { formatQuotaWithCurrency } from '@/lib/currency'

type BalanceTierVisualEditorProps = {
  value: string
  onChange: (value: string) => void
}

type BalanceTierEntry = BalanceTierEntryData

export function BalanceTierVisualEditor({
  value,
  onChange,
}: BalanceTierVisualEditorProps) {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editData, setEditData] = useState<BalanceTierEntry | null>(null)

  const tiers = useMemo(() => {
    if (!value || value.trim() === '') return []

    const parsed = safeJsonParseWithValidation<Record<string, unknown>>(
      value,
      {
        fallback: {},
        validator: isObjectRecord,
        validatorMessage: 'Balance tiers must be a JSON object',
        context: 'balance tiers',
      }
    )

    const entries: BalanceTierEntry[] = []
    for (const [groupName, groupTiers] of Object.entries(parsed)) {
      if (!Array.isArray(groupTiers)) continue
      for (const tier of groupTiers) {
        if (
          tier &&
          typeof tier === 'object' &&
          typeof (tier as Record<string, unknown>).min_quota === 'number' &&
          typeof (tier as Record<string, unknown>).total === 'number' &&
          typeof (tier as Record<string, unknown>).success === 'number'
        ) {
          const typed = tier as {
            min_quota: number
            total: number
            success: number
          }
          entries.push({
            groupName,
            minQuota: typed.min_quota,
            total: typed.total,
            success: typed.success,
          })
        }
      }
    }
    return entries.sort((a, b) => {
      if (a.groupName !== b.groupName) {
        return a.groupName.localeCompare(b.groupName)
      }
      return a.minQuota - b.minQuota
    })
  }, [value])

  const filteredTiers = useMemo(() => {
    if (!searchText) return tiers
    const lowerSearch = searchText.toLowerCase()
    return tiers.filter((tier) =>
      tier.groupName.toLowerCase().includes(lowerSearch)
    )
  }, [tiers, searchText])

  const parseCurrentValue = () =>
    safeJsonParseWithValidation<Record<string, unknown>>(value, {
      fallback: {},
      validator: isObjectRecord,
      silent: true,
    })

  const serialize = (parsed: Record<string, unknown>) => {
    // Drop groups that no longer have any tier.
    for (const [groupName, groupTiers] of Object.entries(parsed)) {
      if (Array.isArray(groupTiers) && groupTiers.length === 0) {
        delete parsed[groupName]
      }
    }
    return JSON.stringify(parsed, null, 2)
  }

  const handleSave = (data: BalanceTierEntryData) => {
    const parsed = parseCurrentValue()

    // Remove the old entry when editing (group name is locked, min quota may change).
    if (editData && Array.isArray(parsed[editData.groupName])) {
      parsed[editData.groupName] = (
        parsed[editData.groupName] as Array<Record<string, unknown>>
      ).filter((tier) => tier.min_quota !== editData.minQuota)
    }

    if (!Array.isArray(parsed[data.groupName])) {
      parsed[data.groupName] = []
    }
    parsed[data.groupName] = [
      ...(parsed[data.groupName] as Array<Record<string, unknown>>),
      { min_quota: data.minQuota, total: data.total, success: data.success },
    ].sort(
      (a, b) =>
        (a as { min_quota: number }).min_quota -
        (b as { min_quota: number }).min_quota
    )

    onChange(serialize(parsed))
  }

  const handleDelete = (entry: BalanceTierEntry) => {
    const parsed = parseCurrentValue()
    if (Array.isArray(parsed[entry.groupName])) {
      parsed[entry.groupName] = (
        parsed[entry.groupName] as Array<Record<string, unknown>>
      ).filter((tier) => tier.min_quota !== entry.minQuota)
    }
    onChange(serialize(parsed))
  }

  const handleEdit = (tier: BalanceTierEntry) => {
    setEditData(tier)
    setDialogOpen(true)
  }

  const handleAdd = () => {
    setEditData(null)
    setDialogOpen(true)
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-4'>
        <div className='relative flex-1'>
          <Search className='text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4' />
          <Input
            placeholder={t('Search group names...')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className='pl-9'
          />
        </div>
        <Button onClick={handleAdd}>
          <Plus className='mr-2 h-4 w-4' />
          {t('Add tier')}
        </Button>
      </div>

      <StaticDataTable
        data={filteredTiers}
        getRowKey={(tier) => `${tier.groupName}:${tier.minQuota}`}
        emptyContent={
          searchText
            ? t('No groups match your search')
            : t(
                'No balance tiers configured. Click "Add tier" to get started.'
              )
        }
        columns={[
          {
            id: 'group',
            header: t('Group Name'),
            cellClassName: 'font-medium',
            cell: (tier) => tier.groupName,
          },
          {
            id: 'min-quota',
            header: t('Min Balance'),
            className: 'text-right',
            cellClassName: 'text-right',
            cell: (tier) => (
              <span className='font-mono'>
                {formatQuotaWithCurrency(tier.minQuota)}
              </span>
            ),
          },
          {
            id: 'max-requests',
            header: t('Max Requests (incl. failures)'),
            className: 'text-right',
            cellClassName: 'text-right',
            cell: (tier) => (
              <span className='font-mono'>
                {tier.total === 0
                  ? t('Unlimited')
                  : tier.total.toLocaleString()}
              </span>
            ),
          },
          {
            id: 'max-success',
            header: t('Max Success'),
            className: 'text-right',
            cellClassName: 'text-right',
            cell: (tier) => (
              <span className='font-mono'>
                {tier.success.toLocaleString()}
              </span>
            ),
          },
          {
            id: 'actions',
            header: t('Actions'),
            className: 'text-right',
            cellClassName: 'text-right',
            cell: (tier) => (
              <StaticRowActions
                editLabel={t('Edit')}
                deleteLabel={t('Delete')}
                menuLabel={t('Open menu')}
                onEdit={() => handleEdit(tier)}
                onDelete={() => handleDelete(tier)}
              />
            ),
          },
        ]}
      />

      <BalanceTierDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
        editData={editData}
      />
    </div>
  )
}
