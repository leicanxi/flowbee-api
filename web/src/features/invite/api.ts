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
import { api } from '@/lib/api'

export type WelfarePromoResponse = {
  success: boolean
  message: string
  data?: string
}

export async function getWelfarePromoContent(): Promise<WelfarePromoResponse> {
  // Same trick as getAboutContent: drop the global `Cache-Control: no-store`
  // so the browser can keep the ETag and revalidate (304) instead of
  // re-downloading unchanged content.
  const res = await api.get<WelfarePromoResponse>('/api/welfare_promo', {
    headers: { 'Cache-Control': null },
  })
  return res.data
}
