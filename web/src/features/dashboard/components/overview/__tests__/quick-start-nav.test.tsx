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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { QuickStartNav } from '../quick-start-nav'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: (props: { to: string; children?: ReactNode; className?: string }) => (
    <a href={props.to} className={props.className}>
      {props.children}
    </a>
  ),
}))

const example = {
  endpoint: 'https://example.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  displayKey: 'sk-...',
  plainKey: 'test',
  ready: true,
}

describe('QuickStartNav', () => {
  it('shows only the active tab content and switches between all three tabs', async () => {
    render(<QuickStartNav example={example} />)

    expect(screen.getByRole('tab', { name: 'Quick start' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByText('Connection info')).toBeInTheDocument()
    expect(screen.getByText('Add credits')).toBeInTheDocument()
    expect(screen.getByText('Manage my keys')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Feature entries' }))
    expect(
      screen.getByRole('tab', { name: 'Feature entries' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Playground')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Wishlist & Feedback' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Connection info')).not.toBeInTheDocument()
    expect(screen.queryByText('Add credits')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'More' }))
    expect(screen.getByText('Voice models')).toBeInTheDocument()
    expect(screen.getByText('BeeWith')).toBeInTheDocument()
    expect(screen.getByText('Douyin')).toBeInTheDocument()
    expect(screen.queryByText('Connection info')).not.toBeInTheDocument()
    expect(screen.getByText('Voice models').closest('a')).toHaveAttribute(
      'href',
      'https://voice-models.flowbee.top'
    )
    expect(
      screen.getByText('BeeWith').closest('[aria-disabled="true"]')
    ).not.toBeNull()
  })

  it('switches the connection panel from the key to the endpoint', async () => {
    render(<QuickStartNav example={example} />)

    expect(screen.getByText('sk-test')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'API endpoint' }))

    expect(screen.getByText('https://example.com/v1')).toBeInTheDocument()
    expect(screen.queryByText('sk-test')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'API endpoint' })
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
