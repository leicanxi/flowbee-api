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
/*
 * 改造#39：第三方账号头像推导的边界测试。
 *
 * 锁两件事：
 * 1. 只有「纯数字前缀 + QQ 域名」的邮箱才推导头像 —— 字母别名（leicanxi@qq.com）
 *    和非 QQ 邮箱都必须返回 null，否则会把别人的 QQ 头像挂到用户身上；
 * 2. 头像偏好只认 default 一个值。老用户的 setting 里没有这个键、读出来是空，
 *    必须走「使用第三方头像」，否则新功能对存量用户完全不生效 —— 这正是
 *    改造#39 最容易写错、且错了不报错的地方。
 */
import { describe, expect, test } from 'vitest'

import { getAccountAvatarUrl, isAccountAvatarDisabled } from '../avatar'

describe('getAccountAvatarUrl', () => {
  test('QQ 邮箱的数字前缀推导出 qlogo 头像地址', () => {
    expect(getAccountAvatarUrl({ email: '123456789@qq.com' })).toBe(
      'https://q1.qlogo.cn/g?b=qq&nk=123456789&s=160'
    )
  })

  test('foxmail 与 vip.qq.com 也按 QQ 号处理', () => {
    expect(getAccountAvatarUrl({ email: '10001@foxmail.com' })).toBe(
      'https://q1.qlogo.cn/g?b=qq&nk=10001&s=160'
    )
    expect(getAccountAvatarUrl({ email: '10001@vip.qq.com' })).toBe(
      'https://q1.qlogo.cn/g?b=qq&nk=10001&s=160'
    )
  })

  test('忽略大小写与首尾空格', () => {
    expect(getAccountAvatarUrl({ email: '  123456789@QQ.com  ' })).toBe(
      'https://q1.qlogo.cn/g?b=qq&nk=123456789&s=160'
    )
  })

  test('字母前缀的 QQ 邮箱别名不推导', () => {
    expect(getAccountAvatarUrl({ email: 'leicanxi@qq.com' })).toBeNull()
  })

  test('位数不足的数字前缀不推导', () => {
    expect(getAccountAvatarUrl({ email: '1234@qq.com' })).toBeNull()
  })

  test('非 QQ 邮箱不推导', () => {
    expect(getAccountAvatarUrl({ email: 'leicanxi@gmail.com' })).toBeNull()
  })

  test('没有邮箱时用 GitHub 数字 ID 拼官方头像地址', () => {
    expect(getAccountAvatarUrl({ github_id: '12345' })).toBe(
      'https://avatars.githubusercontent.com/u/12345?s=160'
    )
  })

  test('github_id 可能是数字字符串，也可能是带空格的数字字符串', () => {
    expect(getAccountAvatarUrl({ github_id: ' 987654 ' })).toBe(
      'https://avatars.githubusercontent.com/u/987654?s=160'
    )
  })

  test('非数字的 github_id 不拼（login 可被改名，不能用）', () => {
    expect(getAccountAvatarUrl({ github_id: 'leicanxi' })).toBeNull()
  })

  test('QQ 邮箱优先于 GitHub', () => {
    const url = getAccountAvatarUrl({
      email: '123456789@qq.com',
      github_id: '999',
    })
    expect(url).toContain('qlogo.cn')
  })

  test('两个来源都没有时返回 null', () => {
    expect(getAccountAvatarUrl({})).toBeNull()
    expect(getAccountAvatarUrl({ email: null, github_id: null })).toBeNull()
    expect(getAccountAvatarUrl({ email: '', github_id: '' })).toBeNull()
  })
})

describe('isAccountAvatarDisabled', () => {
  test('未设置偏好时默认启用账号头像（老用户直接生效）', () => {
    expect(isAccountAvatarDisabled(undefined)).toBe(false)
    expect(isAccountAvatarDisabled(null)).toBe(false)
    expect(isAccountAvatarDisabled('')).toBe(false)
    expect(isAccountAvatarDisabled('{}')).toBe(false)
    expect(isAccountAvatarDisabled({})).toBe(false)
  })

  test('偏好为 oauth 时启用', () => {
    expect(isAccountAvatarDisabled('{"avatar_preference":"oauth"}')).toBe(false)
    expect(isAccountAvatarDisabled({ avatar_preference: 'oauth' })).toBe(false)
  })

  test('偏好为 default 时禁用', () => {
    expect(isAccountAvatarDisabled('{"avatar_preference":"default"}')).toBe(
      true
    )
    expect(isAccountAvatarDisabled({ avatar_preference: 'default' })).toBe(true)
  })

  test('setting 是坏 JSON 时不抛错，按启用处理', () => {
    expect(isAccountAvatarDisabled('{ not json')).toBe(false)
  })
})
