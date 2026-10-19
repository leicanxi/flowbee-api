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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { beforeAll, describe, expect, test, vi } from 'vitest'

import { ParameterPanel } from '../components/parameter-panel'
import { ResultGrid } from '../components/result-grid'
import { ImageStudio } from '../index'
import type { GenerationRecord, SizeOption } from '../types'

vi.mock('../api', () => ({
  getUserGroups: vi
    .fn()
    .mockResolvedValue([{ label: 'gpt-pro', value: 'gpt-pro' }]),
  getGroupModels: vi
    .fn()
    .mockResolvedValue(['gemini-3.7-flash', 'grok-imagine-image-2.0']),
  generateImages: vi.fn(),
}))

const groups = [{ label: 'gpt-pro', value: 'gpt-pro' }]
const models = [
  { label: 'grok-imagine-image-2.0', value: 'grok-imagine-image-2.0' },
]
const ratioOptions: SizeOption[] = [
  { label: '16:9', value: '16:9', param: 'aspect_ratio' },
  { label: '1:1', value: '1:1', param: 'aspect_ratio' },
]

function renderPanel(
  overrides: Partial<Parameters<typeof ParameterPanel>[0]> = {}
) {
  return render(
    <ParameterPanel
      count={1}
      group='gpt-pro'
      groups={groups}
      isGenerating={false}
      model='grok-imagine-image-2.0'
      models={models}
      onCountChange={() => undefined}
      onGroupChange={() => undefined}
      onModelChange={() => undefined}
      onSizeChange={() => undefined}
      size='16:9'
      sizeOptions={ratioOptions}
      {...overrides}
    />
  )
}

const record: GenerationRecord = {
  id: 'rec-1',
  prompt: 'a red apple on a white table',
  model: 'grok-imagine-image-2.0',
  images: [{ b64_json: 'aGVsbG8=' }],
  durationMs: 27000,
  createdAt: 1792400000,
}

describe('image studio parameter panel', () => {
  beforeAll(() => {
    i18next.addResourceBundle('en', 'translation', {
      Model: 'Model',
      'Aspect ratio': 'Aspect ratio',
      'Number of images': 'Number of images',
    })
  })

  test('renders ratio options and reports selection', async () => {
    const user = userEvent.setup()
    const onSizeChange = vi.fn()
    renderPanel({ onSizeChange })

    expect(screen.getByText('Aspect ratio')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '1:1' }))

    expect(onSizeChange).toHaveBeenCalledWith('1:1')
  })

  test('reports the chosen image count', async () => {
    const user = userEvent.setup()
    const onCountChange = vi.fn()
    renderPanel({ onCountChange })

    await user.click(screen.getByRole('button', { name: '3' }))

    expect(onCountChange).toHaveBeenCalledWith(3)
  })

  test('hides the ratio row when the model fixes its own resolution', () => {
    renderPanel({ sizeOptions: [] })

    expect(screen.queryByText('Aspect ratio')).not.toBeInTheDocument()
  })
})

describe('image studio result grid', () => {
  beforeAll(() => {
    i18next.addResourceBundle('en', 'translation', {
      'Describe an image and press generate':
        'Describe an image and press generate',
      'Image preview': 'Image preview',
    })
  })

  test('shows an empty state before the first generation', () => {
    render(<ResultGrid isGenerating={false} pendingCount={1} records={[]} />)

    expect(
      screen.getByText('Describe an image and press generate')
    ).toBeInTheDocument()
  })

  test('renders generated images as inline data urls', () => {
    render(
      <ResultGrid isGenerating={false} pendingCount={1} records={[record]} />
    )

    const image = screen.getByRole('img', { name: record.prompt })
    expect(image).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=')
    expect(screen.getByText('27s')).toBeInTheDocument()
  })

  test('surfaces relay errors inline', () => {
    render(
      <ResultGrid
        isGenerating={false}
        pendingCount={1}
        records={[{ ...record, images: [], error: 'upstream overloaded' }]}
      />
    )

    expect(screen.getByText('upstream overloaded')).toBeInTheDocument()
  })
})

describe('image studio page', () => {
  beforeAll(() => {
    i18next.addResourceBundle('en', 'translation', {
      'Image studio': 'Image studio',
      'Images are billed to your account balance':
        'Images are billed to your account balance',
      'Describe the image you want to create':
        'Describe the image you want to create',
      Generate: 'Generate',
    })
  })

  test('keeps only image models from the selected group', async () => {
    render(<ImageStudio />)

    expect(screen.getByText('Image studio')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('grok-imagine-image-2.0')).toBeInTheDocument()
    })
    expect(screen.queryByText('gemini-3.7-flash')).not.toBeInTheDocument()
  })
})
