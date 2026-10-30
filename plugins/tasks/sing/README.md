# sing task plugin

Wraps the `sing-gateway` job API (`POST /sing/v1/jobs`, `GET /sing/v1/jobs/{id}`)
as a New API task plugin. The gateway renders in the background, so the plugin
only submits and polls short requests; billing can settle per second and price
cache hits differently.

## Channel

Create a **Task Plugin** channel:

| Field | Value |
|-------|-------|
| Base URL | `http://<gateway-host>:9001` (gateway root, no `/v1`) |
| Key | the gateway's `SING_GATEWAY_TOKEN` |
| Plugin | `sing` |
| Models | `sing-song` |

Keep the ordinary OpenAI-compatible channel for `chat/completions` if old
clients still use the synchronous path. Both providers may share `sing-song`
and are priced separately.

## Client call

```http
POST /sing/v1/jobs
Authorization: Bearer <new-api token>
{"model": "sing-song", "song": "雨爱", "voice": "keine", "duration": 60}
```

```http
GET /sing/v1/jobs/{task_id}
```

The submit response is `{"id": "...", "status": "queued"}`. Poll until
`status` is `succeeded` or `failed`; a succeeded job carries `audio_url`,
`filename`, `title`, `artist`, `duration_seconds` and `cached`.

## Billing

The plugin declares two usage facts:

- `seconds` — actual clip length (clamped 5–60 at submit, settled from
  `duration_seconds` on completion)
- `cached` — whether the gateway served the cover from its disk cache

Task expressions return USD directly. Set the provider expression
(`billing_setting.plugin_billing_expr`, key `sing::sing-song`):

```js
// Flat per-second price: $0.0032/s
tier("base", u("seconds") * 0.0032)

// Cache hits at $0.0005/s, fresh renders at $0.0032/s
u("cached") ? u("seconds") * 0.0005 : u("seconds") * 0.0032

// Cache hits free
u("cached") ? 0 : u("seconds") * 0.0032
```

The request reserves the requested duration; completion settles to the actual
`duration_seconds` and `cached`, so a failed render refunds and a cache hit can
be discounted. The `sing-song` model's `usageSchema` exposes the `second` unit,
so the model marketplace shows a per-second price instead of a per-million
token coefficient.

## Compatibility

- Requires a New API build that includes this plugin and the Task Plugin API.
- The gateway must expose the job API (`sing-gateway` with `jobs.py`).
- `openai_responses` is also claimed (stream/sync/background), so standard
  Responses clients can use `input` as a song name or a JSON payload and read
  the audio URL from the output text.
