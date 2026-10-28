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
/**
 * 参考图上传的上限与格式，必须与后端 controller/playground_image.go 的校验保持一致。
 */
export const MAX_REFERENCE_IMAGES = 4
export const MAX_REFERENCE_IMAGE_BYTES = 10 << 20
export const REFERENCE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'

export const REFERENCE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export function isSupportedReferenceImage(file: File): boolean {
  return REFERENCE_IMAGE_TYPES.includes(file.type)
}
