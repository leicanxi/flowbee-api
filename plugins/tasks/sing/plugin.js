// Singing covers through the sing-gateway job API.
//
// The gateway accepts a job in under a second, renders in the background and
// answers a status query with the audio URL, actual clip length and cache flag.
// That lets new-api bill per second (usageSchema.seconds) and optionally charge
// cache hits differently, while the client only submits and polls.
export const meta = {
  apiVersion: 1,
  key: "sing",
  name: "Sing",
  icon: "text",
  description: {
    en: "AI singing covers via the sing-gateway job API",
    zh: "通过 sing-gateway 任务接口生成 AI 翻唱",
  },
  version: "1.0.1",
  author: { name: "leicanxi" },
  models: ["sing-song"],
  fetchMode: "per_task",
  auth: "api_key",
  usageSchema: {
    // Actual clip length in seconds; settles the per-second price.
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Generated clip length", zh: "生成片段时长" },
    },
    // Whether the gateway served the cover from its disk cache.
    cached: {
      type: "boolean",
      description: { en: "Served from cache", zh: "命中缓存" },
    },
  },
  usageExamples: [
    { label: "25s", facts: { seconds: 25, cached: false } },
    { label: "60s", facts: { seconds: 60, cached: false } },
    { label: "120s", facts: { seconds: 120, cached: false } },
    { label: "60s · cache", facts: { seconds: 60, cached: true } },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }],
  routes: [
    { method: "POST", path: "/sing/v1/jobs", type: "submit", models: ["sing-song"], decode: "decodeSubmit", render: "taskCreated" },
    { method: "GET", path: "/sing/v1/jobs/:task_id", type: "query", render: "taskStatus" },
  ],
};

const MIN_SECONDS = 5;
const MAX_SECONDS = 120;
const DEFAULT_SECONDS = 25;
const STATUSES = {
  queued: "SUBMITTED",
  running: "IN_PROGRESS",
  succeeded: "SUCCESS",
  failed: "FAILURE",
};

function trimmed(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function apiKey(ctx) {
  const key = trimmed(ctx && ctx.apiKey);
  if (!key) throw new Error("api_key is empty");
  return key;
}

function requestHeaders(ctx) {
  return { "Content-Type": "application/json", Authorization: "Bearer " + apiKey(ctx) };
}

function gatewayRoot(ctx) {
  const base = trimmed(ctx && ctx.baseUrl).replace(/\/+$/, "");
  // The job API lives at the gateway root, so tolerate an admin pasting the
  // OpenAI-style /v1 base URL into the channel form.
  return base.replace(/\/v1$/, "");
}

function jobURL(ctx, suffix) {
  return gatewayRoot(ctx) + "/sing/v1/jobs" + (suffix || "");
}

function clampSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_SECONDS;
  return Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, Math.round(seconds)));
}

function jobBody(ctx) {
  const body = plainObject(ctx.requestBody);
  const requestBody = {};
  const url = trimmed(body.url);
  const song = trimmed(body.song);
  if (url) requestBody.url = url;
  else if (song) requestBody.song = song;
  else throw new Error("song or url is required");
  const voice = trimmed(body.voice);
  if (voice) requestBody.voice = voice;
  const source = trimmed(body.source);
  if (source) requestBody.source = source;
  const pitchMode = trimmed(body.pitch_mode);
  if (pitchMode) requestBody.pitch_mode = pitchMode;
  for (const key of ["start", "pitch"]) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== "") requestBody[key] = body[key];
  }
  requestBody.duration = clampSeconds(body.duration);
  return requestBody;
}

function decodeSubmit(ctx) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  const body = plainObject(ctx.body.value);
  const url = trimmed(body.url);
  const song = trimmed(body.song);
  if (!url && !song) throw new Error("song or url is required");
  // Native routes receive no pinned model: read it from the request body and
  // fall back to the plugin's only model.
  const model = trimmed(body.model) || (ctx && trimmed(ctx.model)) || "sing-song";
  const requestBody = {};
  if (url) requestBody.url = url;
  else requestBody.song = song;
  const voice = trimmed(body.voice);
  if (voice) requestBody.voice = voice;
  const source = trimmed(body.source);
  if (source) requestBody.source = source;
  const pitchMode = trimmed(body.pitch_mode);
  if (pitchMode) requestBody.pitch_mode = pitchMode;
  for (const key of ["start", "pitch"]) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== "") requestBody[key] = body[key];
  }
  requestBody.duration = clampSeconds(body.duration);
  return { kind: "submit", model: model, requestBody: requestBody };
}

export function buildSubmitRequest(ctx) {
  return { url: jobURL(ctx), method: "POST", headers: requestHeaders(ctx), body: jobBody(ctx) };
}

export function parseSubmitResponse(ctx, response) {
  const body = plainObject(response && response.body);
  const id = trimmed(body.id);
  if (!id) throw new Error("missing job id");
  return { taskId: id, taskData: body };
}

export function buildQueryRequest(ctx) {
  return {
    url: jobURL(ctx, "/" + encodeURIComponent(ctx.taskId)),
    method: "GET",
    headers: requestHeaders(ctx),
  };
}

export function parseTaskResult(ctx, body) {
  const data = plainObject(body);
  const status = STATUSES[trimmed(data.status)];
  if (!status) return { status: "UNKNOWN", reason: "unknown job status: " + trimmed(data.status) };
  const result = { taskId: ctx.taskId, status: status, reason: trimmed(data.error) };
  if (status === "SUCCESS") {
    const url = trimmed(data.audio_url);
    if (url) result.url = url;
  }
  return result;
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const requestBody = plainObject(ctx.requestBody);
  return { seconds: clampSeconds(requestBody.duration), cached: false };
}

export function extractUsageOnComplete(ctx, _result, taskData) {
  const data = plainObject(taskData);
  const seconds = Number(data.duration_seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return { seconds: Math.min(3600, Math.round(seconds)), cached: Boolean(data.cached) };
}

export function listArtifacts(task) {
  const data = plainObject(task.data);
  return task.status === "SUCCESS" && trimmed(data.audio_url) ? [{ key: "audio", type: "audio" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "audio") throw new Error("artifact_not_found");
  const url = trimmed(plainObject(ctx.data).audio_url);
  if (!url) throw new Error("artifact_not_found");
  return { url: url, method: ctx.clientRequest.method, credentialless: true };
}

function audioText(task, ctx) {
  const data = plainObject(task.data);
  const artifact = plainObject(ctx && ctx.artifacts && ctx.artifacts.audio);
  const url = trimmed(artifact.url) || trimmed(data.audio_url);
  if (!url) throw new Error("audio artifact is unavailable");
  return JSON.stringify({
    audio_url: url,
    title: trimmed(data.title),
    artist: trimmed(data.artist),
    duration_seconds: Number(data.duration_seconds) || 0,
    cached: Boolean(data.cached),
  });
}

function responsesPayload(req) {
  const metadata = plainObject(req.metadata);
  let payload = {};
  const input = req.input;
  if (typeof input === "string") {
    const text = input.trim();
    if (text.startsWith("{")) {
      try {
        payload = plainObject(JSON.parse(text));
      } catch (_error) {
        payload = { song: text };
      }
    } else if (text) {
      payload = { song: text };
    }
  } else if (Array.isArray(input)) {
    const texts = [];
    for (const item of input) {
      if (typeof item === "string") {
        texts.push(item);
        continue;
      }
      const entry = plainObject(item);
      const content = entry.content === undefined ? [entry] : Array.isArray(entry.content) ? entry.content : [entry.content];
      for (const part of content) {
        if (typeof part === "string") texts.push(part);
        else if (plainObject(part).text) texts.push(String(part.text));
      }
    }
    const text = texts.join("\n").trim();
    if (text) payload = { song: text };
  }
  payload = Object.assign({}, metadata, payload);
  for (const key of ["song", "url", "voice", "start", "duration", "pitch", "pitch_mode", "source"]) {
    if (req[key] !== undefined) payload[key] = req[key];
  }
  if (payload.duration === undefined && req.seconds !== undefined) payload.duration = req.seconds;
  return payload;
}

export const protocols = {
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = plainObject(ctx.body.value);
      const payload = responsesPayload(req);
      if (!trimmed(payload.url) && !trimmed(payload.song)) throw new Error("input is required");
      const requestBody = {};
      if (trimmed(payload.url)) requestBody.url = trimmed(payload.url);
      else requestBody.song = trimmed(payload.song);
      if (trimmed(payload.voice)) requestBody.voice = trimmed(payload.voice);
      if (trimmed(payload.source)) requestBody.source = trimmed(payload.source);
      if (trimmed(payload.pitch_mode)) requestBody.pitch_mode = trimmed(payload.pitch_mode);
      for (const key of ["start", "pitch"]) {
        if (payload[key] !== undefined && payload[key] !== null && payload[key] !== "") requestBody[key] = payload[key];
      }
      requestBody.duration = clampSeconds(payload.duration);
      return { kind: "submit", model: ctx.model, requestBody: requestBody };
    },
    renderEvents: function (ctx, task, previousState) {
      const status = String(task.status || "UNKNOWN").toUpperCase();
      const state = { status: status };
      if (status === "SUCCESS") {
        const events = previousState && previousState.status === status ? [] : [{ type: "output", data: audioText(task, ctx) }];
        return { events: events, state: state, done: true };
      }
      if (status === "FAILURE") {
        const data = plainObject(task.data);
        return {
          events: [{ type: "error", code: "task_failed", message: trimmed(task.fail_reason) || trimmed(data.error) || "task failed" }],
          state: state,
          done: true,
        };
      }
      if (previousState && previousState.status === status) return { events: [], state: state, done: false };
      return { events: [{ type: "progress", message: status.toLowerCase() }], state: state, done: false };
    },
    renderFinal: function (ctx, task) {
      const data = plainObject(task.data);
      return {
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: audioText(task, ctx), annotations: [], logprobs: [] }],
          },
        ],
        metadata: {
          vendor: "sing",
          title: trimmed(data.title),
          artist: trimmed(data.artist),
          duration_seconds: Number(data.duration_seconds) || 0,
          cached: Boolean(data.cached),
        },
      };
    },
  },
};

export const native = {
  decodeSubmit: decodeSubmit,
  taskCreated: function (_ctx, task) {
    const data = plainObject(task.data);
    return { id: task.task_id, status: trimmed(data.status) || "queued" };
  },
  taskStatus: function (_ctx, task) {
    const data = plainObject(task.data);
    const hostStatus = String(task.status || "").toUpperCase();
    const status = hostStatus === "SUCCESS" ? "succeeded" : hostStatus === "FAILURE" ? "failed" : trimmed(data.status) || "queued";
    const view = { id: task.task_id, status: status };
    for (const key of ["audio_url", "filename", "title", "artist", "duration_seconds", "cached"]) {
      if (data[key] !== undefined) view[key] = data[key];
    }
    if (status === "failed") view.error = trimmed(task.fail_reason) || trimmed(data.error) || "生成失败";
    return view;
  },
  error: function (_ctx, error) {
    return { detail: error.message };
  },
};
