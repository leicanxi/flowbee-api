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
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { formatQuotaAsTokens } from '@/lib/format'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

interface TransferDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (amount: number) => Promise<boolean>
  availableQuota: number
  transferring: boolean
}

export function TransferDialog({
  open,
  onOpenChange,
  onConfirm,
  availableQuota,
  transferring,
}: TransferDialogProps) {
  const { t } = useTranslation()
  const currencyConfig = useSystemConfigStore((state) => state.config.currency)

  // 改造#13：奖励改用 token 展示后，这里不再让用户填数字 —— 待领奖励只有
  // 「一次划走」一种用法，而保留输入框就必须在 token 与额度之间来回换算：
  // token 是估算口径，用它反推真实额度会误导用户。全额提交真实额度最稳。
  const minimumQuota = Math.ceil(
    currencyConfig.quotaPerUnit > 0
      ? currencyConfig.quotaPerUnit
      : DEFAULT_CURRENCY_CONFIG.quotaPerUnit
  )
  const canTransfer = availableQuota >= minimumQuota

  const handleConfirm = async () => {
    if (!canTransfer) return

    const success = await onConfirm(availableQuota)
    if (success) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Transfer Rewards')}
      description={t('Move affiliate rewards to your main balance')}
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
      titleClassName='text-xl font-semibold'
      footerClassName='grid grid-cols-2 gap-2 sm:flex'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={transferring}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={transferring || !canTransfer}
          >
            {transferring && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {t('Transfer')}
          </Button>
        </>
      }
    >
      <div className='space-y-4 py-3 sm:space-y-6 sm:py-4'>
        <div className='space-y-2'>
          <div className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
            {t('Available Rewards')}
          </div>
          <div className='text-2xl font-semibold tabular-nums'>
            {formatQuotaAsTokens(availableQuota)} {t('tokens')}
          </div>
          <p className='text-muted-foreground text-xs'>
            {t('The full amount will be moved to your balance.')}
          </p>
        </div>

        {!canTransfer ? (
          <p className='text-xs text-amber-600 dark:text-amber-400'>
            {t('Minimum transferable reward is {{amount}} tokens', {
              amount: formatQuotaAsTokens(minimumQuota),
            })}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
