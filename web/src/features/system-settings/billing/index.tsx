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
import { SettingsPage } from '../components/settings-page'
import type { BillingSettings } from '../types'
import {
  BILLING_DEFAULT_SECTION,
  getBillingSectionContent,
  getBillingSectionMeta,
} from './section-registry.tsx'

const defaultBillingSettings: BillingSettings = {
  QuotaForNewUser: 0,
  PreConsumedQuota: 0,
  QuotaForInviter: 0,
  QuotaForInvitee: 0,
  TopUpLink: '',
  'general_setting.docs_link': '',
  'quota_setting.enable_free_model_pre_consume': true,
  QuotaPerUnit: 500000,
  USDExchangeRate: 7,
  'general_setting.quota_display_type': 'USD',
  'general_setting.custom_currency_symbol': '¤',
  'general_setting.custom_currency_exchange_rate': 1,
  DisplayInCurrencyEnabled: true,
  DisplayTokenStatEnabled: true,
  ModelPrice: '',
  ModelRatio: '',
  CacheRatio: '',
  CreateCacheRatio: '',
  CompletionRatio: '',
  ImageRatio: '',
  AudioRatio: '',
  AudioCompletionRatio: '',
  ExposeRatioEnabled: false,
  'billing_setting.billing_mode': '{}',
  'billing_setting.billing_expr': '{}',
  'tool_price_setting.prices': '{}',
  TopupGroupRatio: '',
  GroupRatio: '',
  UserUsableGroups: '',
  GroupGroupRatio: '',
  AutoGroups: '',
  MaxTokenAutoGroups: 5,
  DefaultUseAutoGroup: false,
  'group_ratio_setting.group_special_usable_group': '{}',
  PayAddress: '',
  EpayId: '',
  EpayKey: '',
  Price: 7.3,
  MinTopUp: 1,
  CustomCallbackAddress: '',
  PayMethods: '',
  'payment_setting.amount_options': '',
  'payment_setting.amount_discount': '',
  'payment_setting.compliance_confirmed': false,
  'payment_setting.compliance_terms_version': '',
  'payment_setting.compliance_confirmed_at': 0,
  'payment_setting.compliance_confirmed_by': 0,
  'payment_setting.compliance_confirmed_ip': '',
  StripeApiSecret: '',
  StripeWebhookSecret: '',
  StripePriceId: '',
  StripeUnitPrice: 8.0,
  StripeMinTopUp: 1,
  StripePromotionCodesEnabled: false,
  CreemApiKey: '',
  CreemWebhookSecret: '',
  CreemTestMode: false,
  CreemProducts: '[]',
  WaffoEnabled: false,
  WaffoApiKey: '',
  WaffoPrivateKey: '',
  WaffoPublicCert: '',
  WaffoSandboxPublicCert: '',
  WaffoSandboxApiKey: '',
  WaffoSandboxPrivateKey: '',
  WaffoSandbox: false,
  WaffoMerchantId: '',
  WaffoCurrency: 'USD',
  WaffoUnitPrice: 1,
  WaffoMinTopUp: 1,
  WaffoNotifyUrl: '',
  WaffoReturnUrl: '',
  WaffoPayMethods: '[]',
  WaffoPancakeMerchantID: '',
  WaffoPancakePrivateKey: '',
  WaffoPancakeReturnURL: '',
  WaffoPancakeStoreID: '',
  WaffoPancakeProductID: '',
  'checkin_setting.enabled': false,
  'checkin_setting.min_quota': 1000,
  'checkin_setting.max_quota': 10000,
  // 改造#12：福利抽奖。这里的默认值必须与后端
  // setting/operation_setting/lottery_setting.go 的默认保持一致 ——
  // 它只在「从未保存过任何抽奖配置」时兜底；一旦不一致，
  // 走兜底路径保存一次就会把后端的内定预留位（reserved_user_ids）冲掉。
  'lottery_setting.enabled': false,
  'lottery_setting.title': '福利抽奖',
  'lottery_setting.start_time': 0,
  'lottery_setting.end_time': 0,
  'lottery_setting.max_draws_per_user': 2,
  'lottery_setting.free_draws_per_user': 1,
  'lottery_setting.pacing_slack': 1.3,
  'lottery_setting.share_text':
    '快来flowbee瓜分福利，免费ai额度，尽在flowbee.top',
  // token 折算口径：deepseek-flash 现行价 × flowbee专属补贴 3 折 × 高缓存假设
  'lottery_setting.anchor_input_price_per_million': 1,
  'lottery_setting.anchor_output_price_per_million': 4,
  'lottery_setting.anchor_cache_price_per_million': 0.02,
  'lottery_setting.anchor_cache_hit_rate': 0.9,
  'lottery_setting.anchor_output_share': 0.1,
  'lottery_setting.anchor_group_ratio': 0.3,
  'lottery_setting.prizes': JSON.stringify([
    {
      id: 'grand',
      name: '大杯',
      quota: 342500,
      total: 1,
      weight: 1,
      reserved_user_ids: [36],
    },
    { id: 'lucky', name: '小惊喜', quota: 137000, total: 8, weight: 1 },
    { id: 'daily', name: '小福袋', quota: 13700, total: 45, weight: 1 },
  ]),
  // 支持（赞助）。字段与默认值必须与后端
  // setting/operation_setting/sponsorship_setting.go 完全一致 ——
  // 它只在「从未保存过任何支持配置」时兜底，一旦不一致，
  // 走兜底路径保存一次就会把后端的默认档位覆盖成这里写的值。
  'sponsorship_setting.enabled': false,
  'sponsorship_setting.title': '支持 FlowBee',
  'sponsorship_setting.goal_enabled': true,
  'sponsorship_setting.goal_name': '每月服务器与 API 开销',
  'sponsorship_setting.goal_target_money': 1500,
  'sponsorship_setting.tiers': JSON.stringify([
    {
      id: 'coffee',
      label: '一杯咖啡',
      icon_url: 'https://img.remit.ee/i/iy8CP7nMOsgH',
      money: 10,
    },
    {
      id: 'cake',
      label: '一份甜点',
      icon_url: 'https://img.remit.ee/i/hDmAPrXEtflC',
      money: 30,
    },
    {
      id: 'meal',
      label: '一顿饭',
      icon_url: 'https://img.remit.ee/i/liwgI5R71BVT',
      money: 50,
    },
  ]),
  'sponsorship_setting.custom_label': '自定义',
  'sponsorship_setting.custom_icon_url': 'https://img.remit.ee/i/etqE1hhkxZXb',
  'sponsorship_setting.custom_min_money': 1,
  'sponsorship_setting.custom_max_money': 2000,
  'sponsorship_setting.max_message_length': 40,
  'sponsorship_setting.default_message': '悄悄支持了一下',
  // 2026-10-17 23:59:59 +08:00（上线后一个月）
  'sponsorship_setting.early_supporter_deadline': 1792252799,
  'sponsorship_setting.continuous_window_months': 2,
  'sponsorship_setting.continuous_min_count': 2,
}

export function BillingSettings() {
  return (
    <SettingsPage
      routePath='/_authenticated/system-settings/billing/$section'
      defaultSettings={defaultBillingSettings}
      defaultSection={BILLING_DEFAULT_SECTION}
      getSectionContent={getBillingSectionContent}
      getSectionMeta={getBillingSectionMeta}
    />
  )
}
