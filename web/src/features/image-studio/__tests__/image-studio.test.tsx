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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { beforeAll, describe, expect, test, vi } from 'vitest'

import { Composer } from '../components/composer'
import { ResultGrid } from '../components/result-grid'
import { ImageStudio } from '../index'
import type { GenerationRecord, SizeOption } from '../types'

const { promptPage } = vi.hoisted(() => ({
  promptPage: {
    items: [
      {
        id: 'prompt-1',
        title: '电影感夜市女剑客',
        prompt: '一位电影感夜市女剑客站在霓虹灯下',
        cover_url: 'https://cms-assets.youmind.com/media/night.jpg',
        category: '摄影',
        source_name: 'Nano Banana Pro Prompts',
        source_url:
          'https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts',
      },
    ],
    total: 1,
    page: 1,
    page_size: 24,
    categories: [{ name: '摄影', count: 1 }],
  },
}))

vi.mock('../api', () => ({
  getUserGroups: vi
    .fn()
    .mockResolvedValue([{ label: 'gpt-pro', value: 'gpt-pro' }]),
  getGroupModels: vi
    .fn()
    .mockResolvedValue(['gemini-3.7-flash', 'grok-imagine-image']),
  // 能力表现由服务端下发，前端只负责按表渲染；这里固定一份最小表。
  getImageModelCaps: vi.fn().mockResolvedValue({
    version: 1,
    rules: [
      {
        match: 'exact',
        model: 'grok-imagine-image',
        aspect_ratio: ['16:9', '1:1', '9:16'],
      },
      {
        match: 'exact',
        model: 'grok-imagine-image-2.0',
        note: 'size 与 aspect_ratio 都被上游忽略',
      },
    ],
  }),
  generateImages: vi.fn().mockResolvedValue([{ b64_json: 'aGVsbG8=' }]),
  generateImageEdits: vi.fn().mockResolvedValue([{ b64_json: 'ZWRpdA==' }]),
  getImagePrompts: vi.fn().mockResolvedValue(promptPage),
  imagePromptCoverProxyURL: (url: string) =>
    `/api/prompts/cover?url=${encodeURIComponent(url)}`,
}))

// jsdom 没有实现 object URL，缩略图只需要一个稳定字符串。
URL.createObjectURL = vi.fn(() => 'blob:mock-reference-image')
URL.revokeObjectURL = vi.fn()

const groups = [{ label: 'gpt-pro', value: 'gpt-pro' }]
const models = [{ label: 'grok-imagine-image', value: 'grok-imagine-image' }]
const ratioOptions: SizeOption[] = [
  { label: '16:9', value: '16:9', param: 'aspect_ratio' },
  { label: '1:1', value: '1:1', param: 'aspect_ratio' },
]

function composerProps(
  overrides: Partial<Parameters<typeof Composer>[0]> = {}
): Parameters<typeof Composer>[0] {
  return {
    count: 1,
    group: 'gpt-pro',
    groups,
    isGenerating: false,
    model: 'grok-imagine-image',
    models,
    onAddReferenceImages: () => undefined,
    onCountChange: () => undefined,
    onGenerate: () => undefined,
    onGroupChange: () => undefined,
    onModelChange: () => undefined,
    onPromptChange: () => undefined,
    onRemoveReferenceImage: () => undefined,
    onSizeChange: () => undefined,
    prompt: '',
    referenceImages: [],
    size: '16:9',
    sizeOptions: ratioOptions,
    textareaRef: { current: null },
    ...overrides,
  }
}

function renderStudio() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ImageStudio />
    </QueryClientProvider>
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

describe('image studio composer', () => {
  beforeAll(() => {
    i18next.addResourceBundle('en', 'translation', {
      Model: 'Model',
      'Aspect ratio': 'Aspect ratio',
      'Number of images': 'Number of images',
      'Describe the image you want to create':
        'Describe the image you want to create',
      Generate: 'Generate',
      'Generating...': 'Generating...',
      'Resolution is fixed by this model': 'Resolution is fixed by this model',
      'Add reference images': 'Add reference images',
      'Remove reference image': 'Remove reference image',
    })
  })

  test('reports the chosen aspect ratio', async () => {
    const user = userEvent.setup()
    const onSizeChange = vi.fn()
    render(<Composer {...composerProps({ onSizeChange })} />)

    await user.click(screen.getByRole('button', { name: /Aspect ratio/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: '1:1' }))

    expect(onSizeChange).toHaveBeenCalledWith('1:1')
  })

  test('reports the chosen image count', async () => {
    const user = userEvent.setup()
    const onCountChange = vi.fn()
    render(<Composer {...composerProps({ onCountChange })} />)

    await user.click(screen.getByRole('button', { name: /Number of images/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: '3' }))

    expect(onCountChange).toHaveBeenCalledWith(3)
  })

  test('disables generate until a prompt is entered', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    const view = render(<Composer {...composerProps({ onGenerate })} />)

    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()

    view.rerender(
      <Composer {...composerProps({ onGenerate, prompt: 'a cat' })} />
    )
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(onGenerate).toHaveBeenCalledOnce()
  })

  test('reports selected reference images', async () => {
    const user = userEvent.setup()
    const onAddReferenceImages = vi.fn()
    render(<Composer {...composerProps({ onAddReferenceImages })} />)

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement
    const file = new File(['png'], 'ref.png', { type: 'image/png' })
    await user.upload(input, file)

    expect(onAddReferenceImages).toHaveBeenCalledOnce()
    expect(onAddReferenceImages.mock.calls[0][0]).toEqual([file])
  })

  test('shows one removable tile per reference image', async () => {
    const user = userEvent.setup()
    const onRemoveReferenceImage = vi.fn()
    const files = [
      new File(['png'], 'a.png', { type: 'image/png' }),
      new File(['png'], 'b.png', { type: 'image/png' }),
    ]
    render(
      <Composer
        {...composerProps({ referenceImages: files, onRemoveReferenceImage })}
      />
    )

    expect(
      screen.getAllByRole('button', { name: /Remove reference image/ })
    ).toHaveLength(2)

    await user.click(
      screen.getByRole('button', { name: 'Remove reference image 2' })
    )
    expect(onRemoveReferenceImage).toHaveBeenCalledWith(1)
  })

  test('hides the add tile once the reference image limit is reached', () => {
    const files = Array.from(
      { length: 4 },
      (_, index) => new File(['png'], `ref-${index}.png`, { type: 'image/png' })
    )
    render(<Composer {...composerProps({ referenceImages: files })} />)

    expect(
      screen.queryByRole('button', { name: 'Add reference images' })
    ).not.toBeInTheDocument()
  })

  test('hides the ratio picker when the model fixes its own resolution', () => {
    render(<Composer {...composerProps({ sizeOptions: [] })} />)

    expect(
      screen.queryByRole('button', { name: /Aspect ratio/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Resolution is fixed by this model')
    ).toBeInTheDocument()
  })
})

describe('image studio result grid', () => {
  beforeAll(() => {
    i18next.addResourceBundle('en', 'translation', {
      'Image preview': 'Image preview',
    })
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
      'Hello, what would you like to create today?':
        'Hello, what would you like to create today?',
      'Images are billed to your account balance':
        'Images are billed to your account balance',
      'Not sure what to write? Pick a prompt from the gallery below.':
        'Not sure what to write? Pick a prompt from the gallery below.',
      'Prompt gallery': 'Prompt gallery',
      '{{count}} prompts curated from open-source collections':
        '{{count}} prompts curated from open-source collections',
      'Search prompts': 'Search prompts',
      All: 'All',
      'Use this prompt': 'Use this prompt',
      Results: 'Results',
      'Number of images': 'Number of images',
      Generate: 'Generate',
      Model: 'Model',
      'Prompt added to the composer': 'Prompt added to the composer',
    })
  })

  test('shows the greeting and keeps results hidden before generating', async () => {
    renderStudio()

    expect(
      screen.getByRole('heading', {
        name: 'Hello, what would you like to create today?',
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Results' })
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: 'Prompt gallery' })
    ).toBeInTheDocument()
  })

  test('keeps only image models from the selected group', async () => {
    renderStudio()

    await waitFor(() => {
      expect(screen.getByText('grok-imagine-image')).toBeInTheDocument()
    })
    expect(screen.queryByText('gemini-3.7-flash')).not.toBeInTheDocument()
  })

  test('fills the composer from a gallery prompt', async () => {
    const user = userEvent.setup()
    renderStudio()

    await user.click(
      await screen.findByRole('button', { name: 'Use this prompt' })
    )

    expect(
      screen.getByRole('textbox', {
        name: 'Describe the image you want to create',
      })
    ).toHaveValue('一位电影感夜市女剑客站在霓虹灯下')
    expect(screen.getByText('电影感夜市女剑客')).toBeInTheDocument()
  })

  test('uploads reference images to the edit endpoint', async () => {
    const user = userEvent.setup()
    const { generateImageEdits, generateImages } = await import('../api')
    renderStudio()

    await waitFor(() => {
      expect(screen.getByText('grok-imagine-image')).toBeInTheDocument()
    })

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement
    const file = new File(['png'], 'ref.png', { type: 'image/png' })
    await user.upload(input, file)
    await user.type(
      screen.getByRole('textbox', {
        name: 'Describe the image you want to create',
      }),
      '把红圆改成绿圆'
    )
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Aspect ratio: 16:9/ })
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    const edits = vi.mocked(generateImageEdits)
    await waitFor(() => expect(edits).toHaveBeenCalledOnce())
    expect(edits.mock.calls[0]?.[0]).toEqual([file])
    expect(edits.mock.calls[0]?.[1]).toEqual({
      model: 'grok-imagine-image',
      prompt: '把红圆改成绿圆',
      n: 1,
      aspect_ratio: '16:9',
    })
    expect(generateImages).not.toHaveBeenCalled()
  })

  test('generates images with the composed request', async () => {
    const user = userEvent.setup()
    const { generateImages } = await import('../api')
    renderStudio()

    await user.type(
      screen.getByRole('textbox', {
        name: 'Describe the image you want to create',
      }),
      'a cat on a sofa'
    )
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Aspect ratio: 16:9/ })
      ).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => {
      expect(generateImages).toHaveBeenCalledWith({
        model: 'grok-imagine-image',
        prompt: 'a cat on a sofa',
        n: 1,
        aspect_ratio: '16:9',
      })
    })
    expect(
      await screen.findByRole('heading', { name: 'Results' })
    ).toBeInTheDocument()
  })
})
