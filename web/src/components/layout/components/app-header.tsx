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
import { Link } from '@tanstack/react-router'
import { Gift } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfigDrawer } from '@/components/config-drawer'
// 改造#34：顶栏的语言切换下线，改成福利页入口（用户要求）。实现仍在
// `@/components/language-switcher`，要恢复就取消这行与下方 JSX 里的注释。
// import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/hooks/use-notifications'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'

import { defaultTopNavLinks } from '../config/top-nav.config'
import type { TopNavLink } from '../types'
import { AnnouncementBanner } from './announcement-banner'
import { Header } from './header'
import { SystemBrand } from './system-brand'
import { TopNav } from './top-nav'

/**
 * General application Header component
 * Integrates navigation bar, search, configuration and profile functions
 *
 * @example
 * // Basic usage
 * <AppHeader />
 *
 * @example
 * // Custom navigation links
 * <AppHeader navLinks={customLinks} />
 *
 * @example
 * // Hide navigation bar and search box
 * <AppHeader showTopNav={false} showSearch={false} />
 *
 * @example
 * // Fully customize left and right content
 * <AppHeader
 *   leftContent={<CustomLeft />}
 *   rightContent={<CustomRight />}
 * />
 */
type AppHeaderProps = {
  /**
   * Custom navigation links, uses default global navigation or dynamically generated from backend if not provided
   */
  navLinks?: TopNavLink[]
  /**
   * Whether to show top navigation bar
   * @default true
   */
  showTopNav?: boolean
  /**
   * Left content, overrides TopNav if provided
   */
  leftContent?: React.ReactNode
  /**
   * Whether to show search box
   * @default true
   */
  showSearch?: boolean
  /**
   * Custom right content, overrides default right content if provided
   */
  rightContent?: React.ReactNode
  /**
   * Whether to show notification button
   * @default true
   */
  showNotifications?: boolean
  /**
   * Whether to show config drawer
   * @default true
   */
  showConfigDrawer?: boolean
  /**
   * Whether to show profile dropdown
   * @default true
   */
  showProfileDropdown?: boolean
}

export function AppHeader({
  navLinks = defaultTopNavLinks,
  showTopNav = true,
  leftContent,
  showSearch = true,
  rightContent,
  showNotifications = true,
  showConfigDrawer = true,
  showProfileDropdown = true,
}: AppHeaderProps) {
  const { t } = useTranslation()

  // Prioritize dynamically generated links from backend
  const dynamicLinks = useTopNavLinks()
  const links = dynamicLinks.length > 0 ? dynamicLinks : navLinks

  // Notifications hook
  const notifications = useNotifications()

  const headerRef = useRef<HTMLDivElement>(null)

  // 改造#30：横幅插在 header 上方，会让整个头部比固定的 3rem 更高。而侧栏位置
  // 与内容区高度都是按 --app-header-height 算的，所以这里把实测高度写回该变量，
  // 让它们跟着横幅下移，而不是把内容挤出视口。
  useEffect(() => {
    const node = headerRef.current
    if (!node) return

    const publishHeight = () => {
      document.documentElement.style.setProperty(
        '--app-header-height',
        `${node.offsetHeight}px`
      )
    }

    publishHeight()
    const observer = new ResizeObserver(publishHeight)
    observer.observe(node)

    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty('--app-header-height')
    }
  }, [])

  return (
    <div ref={headerRef} className='sticky top-0 z-40 w-full shrink-0'>
      <AnnouncementBanner
        announcements={notifications.announcements}
        onOpenAnnouncements={() => notifications.openPopover('announcements')}
      />

      <Header>
        <SystemBrand variant='inline' />

        {leftContent ? (
          <div className='ms-2 flex items-center'>{leftContent}</div>
        ) : null}

        {rightContent ?? (
          <div className='ms-auto flex items-center gap-1 sm:gap-2'>
            {showTopNav && (
              <div className='me-1 hidden lg:block'>
                <TopNav links={links} />
              </div>
            )}
            {showSearch && <Search />}
            {showNotifications && (
              <NotificationPopover
                open={notifications.popoverOpen}
                onOpenChange={notifications.setPopoverOpen}
                unreadCount={notifications.unreadCount}
                activeTab={notifications.activeTab}
                onTabChange={notifications.setActiveTab}
                notice={notifications.notice}
                announcements={notifications.announcements}
                loading={notifications.loading}
              />
            )}
            {/* 改造#34：语言切换下线，改成福利页入口（用户要求）。 */}
            {/* <LanguageSwitcher /> */}
            <Button
              variant='ghost'
              size='icon'
              className='h-9 w-9'
              render={<Link to='/invite' />}
            >
              <Gift className='size-[1.2rem]' />
              <span className='sr-only'>{t('Welfare')}</span>
            </Button>
            {showConfigDrawer && <ConfigDrawer />}
            {showProfileDropdown && <ProfileDropdown />}
          </div>
        )}
      </Header>
    </div>
  )
}
