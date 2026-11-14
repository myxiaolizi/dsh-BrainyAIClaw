/**
 * dsh-brainyaiclaw — Host half.
 *
 * Registers one LLM provider route (`brainyaiclaw`, displayed as `BAC`) that
 * serves BrainyAIClaw's model list to DeepSeek Harness.
 *
 * BrainyAIClaw owns the endpoint and the credential. Both are read here and
 * never edited: the endpoint is the app's OpenAI-compatible gateway, and the
 * key is the login token the app keeps in `clawcommon.config.json`, re-read on
 * a timer and on every HTTP 401 so a rotated token reaches the next request
 * without a restart.
 *
 * The endpoint is the public gateway, not the app's loopback proxy, so the
 * route keeps working whether BrainyAIClaw is running or not.
 *
 * The model list comes from the app's own `openclaw.json` when that file
 * exists, and from the bundled catalog otherwise, so the provider keeps a full
 * model list even before the app has ever written its configuration.
 *
 * Per-model display names, enable switches and input modalities are the
 * plugin's own user state, kept in `<DSH_HOME>/dsh-brainyaiclaw/state.json`.
 * `client.js` renders the page that edits them.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Route id this plugin owns. */
const PROVIDER = 'brainyaiclaw'
/** Menu label the model picker shows for the route. */
const PROVIDER_NAME = 'BAC'
/** Credential reference the route's bearer token resolves through. */
const CREDENTIAL_REF = 'BRAINYAICLAW_API_KEY'
/** BrainyAIClaw's OpenAI-compatible gateway. */
const DEFAULT_BASE_URL = 'https://gpt.sinohealth.com/v2/openai'
/** Deployment headers the gateway attributes requests with. */
const GATEWAY_HEADERS = { bizType: 'BrainyAIClaw', client: '10' }
/** Host HTTP path the settings page reads the catalog from. */
export const CATALOG_ROUTE = '/api/brainyaiclaw/catalog'
/** Host HTTP path the settings page writes model preferences to. */
export const PREFERENCES_ROUTE = '/api/brainyaiclaw/preferences'

/** Reasoning levels offered when the app declares a thinking model without a list. */
const DEFAULT_REASONING_LEVELS = ['low', 'medium', 'high']
/** Request-image pixel budget shared by the serializer and `imageRequestTarget`. */
const REQUEST_IMAGE_MAX_PIXELS = 4194304
/** Request-image byte target for one model request. */
const REQUEST_IMAGE_MAX_BYTES = 1048576
/** How long a read token stays valid before the app's file is checked again. */
const TOKEN_TTL_MS = 30000

/**
 * BrainyAIClaw's own model catalog as of the app version this plugin targets.
 * Used when `openclaw.json` is missing, unreadable, or lists no model.
 */
const FALLBACK_MODELS = [
  { id: 'plmf/deepseek-v4.1-flash-1017', name: 'deepseek-v4.1-flash', input: ['text', 'image'], contextWindow: 1000000 },
  { id: 'wcn/gemini-4-argon', name: 'gemini-4-argon', input: ['text', 'image'], contextWindow: 1000000, reasoning: ['low', 'medium', 'high'] },
  { id: 'plmf/glm-5.3-flash', name: 'glm-5.3-flash', input: ['text', 'image'], contextWindow: 1000000, reasoning: ['low', 'high', 'xhigh'] },
  { id: 'inner/sinomed3.0_27b', name: 'sinomed3.0-27b', input: ['text', 'image'], contextWindow: 655360, reasoning: ['low', 'medium', 'xhigh'] },
  { id: 'wcn/gemini-3.6-flash', name: 'gemini-3.6-flash', input: ['text', 'image'], contextWindow: 1000000, reasoning: ['low', 'medium', 'high'] },
  { id: 'wcn/gemini-3.8-flash', name: 'gemini-3.8-flash', input: ['text', 'image'], contextWindow: 1000000, reasoning: ['low', 'high', 'xhigh'] },
  { id: 'wcn/qwen3.8-max', name: 'qwen3.8-max', input: ['text'], contextWindow: 1000000, reasoning: ['low', 'medium', 'high'] },
  { id: 'wcn/gemini-3.7-flash', name: 'gemini-3.7-flash', input: ['text', 'image'], contextWindow: 1000000 },
  { id: 'wcn/qwen3.7-plus', name: 'qwen3.7-plus', input: ['text', 'image'], contextWindow: 1000000 },
  { id: 'wcn/glm-5.2', name: 'glm-5.2', input: ['text'], contextWindow: 1000000 },
  { id: 'wcn/deepseek-v4-flash', name: 'deepseek-v4-flash', input: ['text'], contextWindow: 1000000 },
  { id: 'wcn/deepseek-v4-pro', name: 'deepseek-v4-pro', input: ['text'], contextWindow: 1000000 },
  { id: 'wcn/gpt-5.6-terra', name: 'gpt-5.6-terra', input: ['text', 'image'], contextWindow: 1000000 },
  { id: 'wcn/gpt-5.5', name: 'gpt-5.5', input: ['text'], contextWindow: 1000000 },
]

/** Input modalities a model row may declare. */
const MODALITIES = ['text', 'image']

function note(message) {
  console.log(`[dsh-brainyaiclaw] ${message}`)
}

function warn(message, error) {
  console.warn(`[dsh-brainyaiclaw] ${message}: ${error?.message ?? error}`)
}

/** An Error carrying harness failure facts, so the terminal chunk names the real code. */
function failure(message, code, extra) {
  const error = new Error(message)
  error.code = code
  error.failure = { message, code, ...extra }
  return error
}

/** Resolve the app's data directory for the current OS user. */
function appDataDir() {
  const home = homedir()
  if (process.platform === 'win32') return process.env.APPDATA || join(home, 'AppData', 'Roaming')
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME || join(home, '.config')
}

/** Candidate `clawcommon.config.json` paths, most specific first. */
function tokenPaths() {
  const appData = join(appDataDir(), 'BrainyAiClaw')
  return [
    join(appData, 'clawcommon.config.json'),
    join(homedir(), 'AppData', 'Roaming', 'BrainyAiClaw', 'clawcommon.config.json'),
    join(homedir(), 'Library', 'Application Support', 'BrainyAiClaw', 'clawcommon.config.json'),
    join(homedir(), '.config', 'BrainyAiClaw', 'clawcommon.config.json'),
  ]
}

/** Candidate `openclaw.json` paths holding the app's own model catalog. */
function catalogPaths() {
  const appData = join(appDataDir(), 'BrainyAiClaw', 'openclaw', 'state')
  return [
    join(appData, 'openclaw.json'),
    join(homedir(), 'AppData', 'Roaming', 'BrainyAiClaw', 'openclaw', 'state', 'openclaw.json'),
  ]
}

/** Where this plugin keeps its own per-model preferences. */
function stateFile() {
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(dshHome, 'dsh-brainyaiclaw', 'state.json')
}

/** Normalize one modality list; an empty result falls back to the declared default. */
function modalitiesOf(value, fallback) {
  if (!Array.isArray(value)) return [...(fallback ?? ['text'])]
  const kept = [...new Set(value.filter((entry) => MODALITIES.includes(entry)))]
  return kept.length > 0 ? kept : [...(fallback ?? ['text'])]
}

/** Read one model entry of the app's catalog into this plugin's shape. */
function modelFromApp(entry) {
  if (typeof entry?.id !== 'string' || entry.id.trim() === '') return undefined
  const id = entry.id.trim()
  const name = typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name.trim() : id
  const contextWindow = Number.isInteger(entry.contextWindow) && entry.contextWindow > 0 ? entry.contextWindow : 1000000
  const declared = entry.compat?.supportedReasoningEfforts
  let reasoning
  if (Array.isArray(declared) && declared.length > 0) {
    reasoning = declared.filter((level) => typeof level === 'string' && level.length > 0)
  } else if (entry.reasoning === true) {
    const map = entry.thinkingLevelMap
    const levels =
      map !== null && typeof map === 'object'
        ? Object.entries(map)
            .filter(([, wire]) => typeof wire === 'string' && wire.length > 0)
            .map(([level]) => level)
        : []
    reasoning = levels.length > 0 ? levels : DEFAULT_REASONING_LEVELS
  }
  return {
    id,
    name,
    input: modalitiesOf(entry.input),
    contextWindow,
    ...(reasoning === undefined || reasoning.length === 0 ? {} : { reasoning }),
  }
}

/** Read every model the app writes for its own internal-model route. */
function modelsFromOpenClaw(document) {
  const providers = document?.models?.providers
  if (providers === null || providers === undefined || typeof providers !== 'object') return []
  for (const key of [PROVIDER, 'internalModel', 'lobsterai']) {
    const route = providers[key]
    if (route === null || route === undefined || !Array.isArray(route.models)) continue
    const models = route.models.map(modelFromApp).filter(Boolean)
    if (models.length > 0) return models
  }
  return []
}

/** Fit one image inside the request pixel budget, preserving its aspect ratio. */
function requestImageDimensions(width, height, maxPixels) {
  const pixels = width * height
  if (!Number.isFinite(pixels) || pixels <= maxPixels) return { width, height }
  const scale = Math.sqrt(maxPixels / pixels)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Join the text blocks of one harness message. */
function textOf(message) {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

/** Convert harness tool-call blocks into OpenAI `tool_calls`. */
function toolCallsOf(message) {
  return message.content
    .filter((block) => block.type === 'tool-call')
    .map((block) => ({
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: block.arguments === '' ? '{}' : block.arguments },
    }))
}

/**
 * One OpenAI-format `messages` array for a harness request.
 *
 * Leading system history joins the request-level system prompt; later system
 * and developer text becomes a `<system-reminder>` user message, because the
 * gateway's Completions route has one system message at the head.
 */
function toOpenAiMessages(options, imageParts) {
  const system = [options.system]
  const messages = []
  let leading = 0
  for (const message of options.messages) {
    if (message.role !== 'system') break
    system.push(textOf(message))
    leading += 1
  }
  for (const message of options.messages.slice(leading)) {
    switch (message.role) {
      case 'system':
      case 'developer': {
        const text = textOf(message)
        const reminder = text.replaceAll('</system-reminder>', '<\\/system-reminder>')
        if (reminder.trim() !== '') {
          messages.push({ role: 'user', content: `<system-reminder>\n${reminder}\n</system-reminder>` })
        }
        break
      }
      case 'assistant': {
        const text = textOf(message)
        const toolCalls = toolCallsOf(message)
        messages.push({
          role: 'assistant',
          content: text === '' && toolCalls.length > 0 ? null : text,
          ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
        })
        break
      }
      case 'tool': {
        messages.push({
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: textOf(message) || '(no output)',
        })
        break
      }
      default: {
        const parts = []
        for (const block of message.content) {
          if (block.type === 'text' && block.text !== '') parts.push({ type: 'text', text: block.text })
          else if (block.type === 'image') {
            const encoded = imageParts.get(block.attachment.attachmentId)
            if (encoded === undefined) continue
            parts.push({ type: 'image_url', image_url: { url: encoded } })
          }
        }
        const onlyText = parts.every((part) => part.type === 'text')
        messages.push({
          role: 'user',
          content: onlyText ? parts.map((part) => part.text).join('') : parts,
        })
        break
      }
    }
  }
  const systemText = system.filter((entry) => typeof entry === 'string' && entry.trim() !== '').join('\n\n')
  return systemText === '' ? messages : [{ role: 'system', content: systemText }, ...messages]
}

/** Convert harness tools into OpenAI function tools. */
function toOpenAiTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined
  const converted = tools
    .filter((tool) => tool.deferLoading !== true)
    .map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }))
  return converted.length === 0 ? undefined : converted
}

/** Map an OpenAI finish reason onto the harness vocabulary. */
function finishReasonOf(value) {
  if (value === 'tool_calls' || value === 'function_call') return { kind: 'tool-calls' }
  if (value === 'length') return { kind: 'max-tokens' }
  return { kind: 'stop' }
}

/** Read one SSE event's `usage` object into a harness `TokenUsage`. */
function usageOf(usage) {
  if (usage === null || typeof usage !== 'object') return undefined
  const inputTokens = Number(usage.prompt_tokens) || 0
  const outputTokens = Number(usage.completion_tokens) || 0
  const cacheReadTokens = Number(usage.prompt_tokens_details?.cached_tokens) || 0
  const reasoningTokens = Number(usage.completion_tokens_details?.reasoning_tokens) || 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number(usage.total_tokens) || inputTokens + outputTokens,
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
  }
}

/**
 * Cordis function-plugin name.
 */
export const name = 'dsh-brainyaiclaw'

/**
 * Services this plugin needs before it activates. `llm` is the registry it
 * adds its route to; everything else — `credentials`, `attachments`,
 * `connection`, `webServer` — is read with `ctx.get()` and may be absent.
 */
export const inject = ['llm']

export function apply(ctx, config = {}) {
  const options = {
    baseURL: typeof config.baseURL === 'string' && config.baseURL.trim() !== '' ? config.baseURL.trim() : DEFAULT_BASE_URL,
    timeoutMs: Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 900000,
    syncIntervalMs: Number.isFinite(config.syncIntervalMs) && config.syncIntervalMs > 0 ? config.syncIntervalMs : 60000,
    useAppCatalog: config.useAppCatalog !== false,
  }

  /** Last successfully read app catalog, so a transient read failure never empties the menu. */
  let appModels = []
  /** Where the current catalog came from: `app`, `remembered`, or `bundled`. */
  let catalogSource = 'bundled'
  /** Token facts for the settings page; never the token itself. */
  let tokenState = { configured: false, source: null, checkedAt: null }
  /** Cached token value plus its read time. */
  let tokenCache
  /** Per-model preferences: `{ [modelId]: { name?, enabled?, input? } }`. */
  let preferences = {}
  /** The snapshot the settings page reads. */
  let snapshot = { models: [], updatedAt: null, error: null }

  /** Read the app's catalog from disk; keeps the previous one on failure. */
  async function refreshCatalog() {
    if (!options.useAppCatalog) {
      catalogSource = 'bundled'
      return
    }
    let lastError
    for (const candidate of catalogPaths()) {
      try {
        const document = JSON.parse(await readFile(candidate, 'utf8'))
        const models = modelsFromOpenClaw(document)
        if (models.length === 0) {
          lastError = new Error(`no model list in ${candidate}`)
          continue
        }
        appModels = models
        catalogSource = 'app'
        return
      } catch (error) {
        lastError = error
      }
    }
    catalogSource = appModels.length > 0 ? 'remembered' : 'bundled'
    if (lastError !== undefined && appModels.length === 0) {
      warn('could not read the app model catalog, using the bundled list', lastError)
    }
  }

  /** The provider's base catalog: the app's list, or the bundled fallback. */
  function baseModels() {
    const source = appModels.length > 0 ? appModels : FALLBACK_MODELS
    return source.map((model) => ({ ...model, input: [...model.input] }))
  }

  /** One model with the user's preferences applied. */
  function effectiveModel(model) {
    const preference = preferences[model.id] ?? {}
    const enabled = preference.enabled !== false
    const name = typeof preference.name === 'string' && preference.name.trim() !== '' ? preference.name.trim() : model.name
    const input = modalitiesOf(preference.input, model.input)
    return { ...model, name, input, enabled }
  }

  /** Enabled models in catalog order. */
  function enabledModels() {
    return baseModels().map(effectiveModel).filter((model) => model.enabled)
  }

  /** Resolve one enabled model, or throw the adapter's own failure. */
  function modelOf(id) {
    const model = enabledModels().find((entry) => entry.id === id)
    if (model !== undefined) return model
    const known = baseModels().some((entry) => entry.id === id)
    throw failure(
      known
        ? `model "${id}" is switched off on the BAC settings page`
        : `BrainyAIClaw offers no model "${id}" for the BAC provider`,
      known ? 'MODEL_DISABLED' : 'UNKNOWN_MODEL',
    )
  }

  /** The current login token, re-reading the app's file when it is stale. */
  async function resolveToken(force = false) {
    if (!force && tokenCache !== undefined && Date.now() - tokenCache.readAt < TOKEN_TTL_MS) return tokenCache
    for (const candidate of tokenPaths()) {
      try {
        const document = JSON.parse(await readFile(candidate, 'utf8'))
        const token = typeof document?.claw_user_token === 'string' ? document.claw_user_token.trim() : ''
        if (token === '') continue
        tokenCache = { token, path: candidate, readAt: Date.now() }
        tokenState = { configured: true, source: candidate, checkedAt: new Date().toISOString() }
        return tokenCache
      } catch {
        // try the next candidate
      }
    }
    tokenCache = undefined
    tokenState = { configured: false, source: null, checkedAt: new Date().toISOString() }
    throw failure(
      'BrainyAIClaw has no login token yet; open the app and sign in once, then retry',
      'MISSING_CREDENTIAL',
    )
  }

  /** Keep the harness credential store in step with the app's token. */
  async function syncCredential() {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return 'unavailable'
    const { token, path } = await resolveToken(true)
    const current = await credentials.resolve(CREDENTIAL_REF)
    if (current?.value === token) return 'current'
    await credentials.set(CREDENTIAL_REF, token)
    note(`credential ${current === undefined ? 'seeded' : 'rotated'} from ${path}`)
    return current === undefined ? 'seeded' : 'rotated'
  }

  /** Load this plugin's own per-model preferences. */
  async function loadPreferences() {
    try {
      const document = JSON.parse(await readFile(stateFile(), 'utf8'))
      preferences =
        document !== null && typeof document?.models === 'object' && document.models !== null ? document.models : {}
    } catch (error) {
      if (error?.code !== 'ENOENT') warn('could not read the preference file', error)
      preferences = {}
    }
  }

  /** Persist per-model preferences atomically. */
  async function savePreferences() {
    const path = stateFile()
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify({ version: 1, models: preferences }, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  }

  /** Rebuild the snapshot the settings page reads. */
  function publish(extra) {
    snapshot = {
      provider: PROVIDER,
      providerName: PROVIDER_NAME,
      baseURL: options.baseURL,
      credentialRef: CREDENTIAL_REF,
      credential: tokenState,
      catalogSource,
      models: baseModels().map((model) => {
        const effective = effectiveModel(model)
        return {
          id: model.id,
          name: effective.name,
          defaultName: model.name,
          enabled: effective.enabled,
          input: effective.input,
          defaultInput: [...model.input],
          contextWindow: model.contextWindow,
          reasoning: model.reasoning ?? null,
        }
      }),
      updatedAt: new Date().toISOString(),
      error: null,
      ...(extra ?? {}),
    }
    return snapshot
  }

  /** Resolve reasoning metadata for one model. */
  function reasoningOf(model) {
    const levels = Array.isArray(model.reasoning) ? model.reasoning.filter((level) => level !== 'off') : []
    if (levels.length === 0) return undefined
    return {
      efforts: levels.map((level) => ({ id: level, name: level })),
      defaultEffort: levels.includes('medium') ? 'medium' : levels[0],
    }
  }

  /** Describe one model with the metadata the harness validates. */
  function describeModel(model) {
    const reasoning = reasoningOf(model)
    return {
      provider: PROVIDER,
      id: model.id,
      name: model.name,
      inputModalities: model.input,
      context: { contextWindow: model.contextWindow },
      ...(reasoning === undefined ? {} : { reasoning }),
    }
  }

  /** Collect the image bytes this request needs, as data URLs. */
  async function imagePartsOf(messages, signal) {
    const attachments = ctx.get('attachments')
    if (attachments === undefined) return new Map()
    const refs = new Map()
    for (const message of messages) {
      for (const block of message.content) {
        if (block.type === 'image' && block.offloaded !== true) refs.set(block.attachment.attachmentId, block.attachment)
      }
    }
    const parts = new Map()
    for (const [id, ref] of refs) {
      const target = {
        ...requestImageDimensions(ref.width, ref.height, REQUEST_IMAGE_MAX_PIXELS),
        maxBytes: REQUEST_IMAGE_MAX_BYTES,
      }
      const prepared = await attachments.readImageRequest(ref, target, signal)
      parts.set(id, `data:${prepared.mediaType};base64,${Buffer.from(prepared.data).toString('base64')}`)
    }
    return parts
  }

  /** Assemble the gateway request body for one call. */
  async function requestBodyOf(options2) {
    const imageParts = await imagePartsOf(options2.messages, options2.signal)
    const body = {
      model: options2.model,
      messages: toOpenAiMessages(options2, imageParts),
      stream: true,
      stream_options: { include_usage: true },
    }
    const tools = toOpenAiTools(options2.tools)
    if (tools !== undefined) body.tools = tools
    if (Number.isInteger(options2.maxTokens) && options2.maxTokens > 0) body.max_tokens = options2.maxTokens
    if (typeof options2.temperature === 'number') body.temperature = options2.temperature
    const effort = options2.reasoningEffort
    if (typeof effort === 'string' && effort !== 'off') body.reasoning_effort = effort
    return body
  }

  /**
   * Stream one model call as harness chunks.
   *
   * A `block-end` closes a block with its complete content — the assembler keeps
   * what the terminal close carries, so an empty one would erase the deltas.
   */
  async function* stream(options2) {
    let token
    try {
      ;({ token } = await resolveToken())
    } catch (error) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: error.message, code: error.code ?? 'MISSING_CREDENTIAL' } } }
      return
    }

    let body
    try {
      body = await requestBodyOf(options2)
    } catch (error) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `could not prepare the BAC request: ${error?.message ?? error}`, code: 'INVALID_REQUEST' } } }
      return
    }

    if (options2.signal?.aborted === true) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the request was cancelled', code: 'ABORTED' } } }
      return
    }

    const controller = new AbortController()
    const onAbort = () => controller.abort(options2.signal?.reason)
    options2.signal?.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(new Error('BAC request timed out')), options.timeoutMs)
    timeout.unref?.()

    let response
    try {
      response = await fetch(`${options.baseURL.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          authorization: `Bearer ${token}`,
          ...GATEWAY_HEADERS,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      options2.signal?.removeEventListener('abort', onAbort)
      if (options2.signal?.aborted === true) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the request was cancelled', code: 'ABORTED' } } }
        return
      }
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `could not reach the BAC gateway: ${error?.message ?? error}`, code: 'NETWORK' } } }
      return
    }

    try {
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        // A rejected token may simply be stale: force the next call to re-read it.
        if (response.status === 401) {
          tokenCache = undefined
          tokenState = { configured: false, source: null, checkedAt: new Date().toISOString() }
        }
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: {
              message: `the BAC gateway answered HTTP ${response.status}${detail === '' ? '' : `: ${detail.slice(0, 500)}`}`,
              code:
                response.status === 401
                  ? 'INVALID_CREDENTIAL'
                  : response.status === 429
                    ? 'RATE_LIMIT'
                    : `HTTP_${response.status}`,
              status: response.status,
            },
          },
        }
        return
      }

      /** Open blocks by harness index: `{ blockType, text }`. */
      const open = new Map()
      let nextIndex = 0
      let reasoningIndex
      let textIndex
      const toolSlots = new Map()
      let finishReason
      let produced = false

      const openBlock = (blockType) => {
        const index = nextIndex++
        open.set(index, { blockType, text: '' })
        return index
      }
      /** Close one block with its accumulated content. */
      const closeBlock = (index) => {
        const partial = open.get(index)
        if (partial === undefined) return undefined
        open.delete(index)
        if (partial.blockType === 'reasoning') return { type: 'block-end', index, block: { type: 'reasoning', text: partial.text } }
        if (partial.blockType === 'text') return { type: 'block-end', index, block: { type: 'text', text: partial.text } }
        return undefined
      }

      const decoder = new TextDecoder()
      let buffer = ''
      const reader = response.body.getReader()
      let usage

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let newline
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).replace(/\r$/, '')
            buffer = buffer.slice(newline + 1)
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (payload === '' || payload === '[DONE]') continue
            let event
            try {
              event = JSON.parse(payload)
            } catch {
              continue
            }
            if (event?.error !== null && event?.error !== undefined) {
              const message = event.error.message ?? String(event.error)
              yield { type: 'finish', reason: { kind: 'error', failure: { message: `BAC gateway error: ${message}`, code: 'PROVIDER' } } }
              return
            }
            if (event?.usage !== null && event?.usage !== undefined) {
              const measured = usageOf(event.usage)
              if (measured !== undefined) usage = measured
            }
            const choice = Array.isArray(event?.choices) ? event.choices[0] : undefined
            if (choice === undefined || choice === null) continue
            if (typeof choice.finish_reason === 'string' && choice.finish_reason !== '') finishReason = choice.finish_reason
            const delta = choice.delta
            if (delta === null || typeof delta !== 'object') continue

            const reasoningText = [delta.reasoning_content, delta.reasoning, delta.reasoning_text].find(
              (candidate) => typeof candidate === 'string' && candidate !== '',
            )
            if (typeof reasoningText === 'string') {
              if (reasoningIndex === undefined) {
                reasoningIndex = openBlock('reasoning')
                yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
              }
              open.get(reasoningIndex).text += reasoningText
              produced = true
              yield { type: 'reasoning-delta', index: reasoningIndex, text: reasoningText }
            }

            if (typeof delta.content === 'string' && delta.content !== '') {
              if (reasoningIndex !== undefined) {
                const close = closeBlock(reasoningIndex)
                if (close !== undefined) yield close
                reasoningIndex = undefined
              }
              if (textIndex === undefined) {
                textIndex = openBlock('text')
                yield { type: 'block-start', index: textIndex, blockType: 'text' }
              }
              open.get(textIndex).text += delta.content
              produced = true
              yield { type: 'text-delta', index: textIndex, text: delta.content }
            }

            if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
              if (reasoningIndex !== undefined) {
                const close = closeBlock(reasoningIndex)
                if (close !== undefined) yield close
                reasoningIndex = undefined
              }
              if (textIndex !== undefined) {
                const close = closeBlock(textIndex)
                if (close !== undefined) yield close
                textIndex = undefined
              }
              for (const call of delta.tool_calls) {
                const slot = Number.isInteger(call?.index) ? call.index : 0
                let entry = toolSlots.get(slot)
                if (entry === undefined) {
                  const index = openBlock('tool-call')
                  entry = { index, id: '', name: '', arguments: '' }
                  toolSlots.set(slot, entry)
                  yield { type: 'block-start', index, blockType: 'tool-call' }
                }
                if (typeof call?.id === 'string' && call.id !== '') entry.id = call.id
                if (typeof call?.function?.name === 'string' && call.function.name !== '') entry.name = call.function.name
                const argumentsDelta = typeof call?.function?.arguments === 'string' ? call.function.arguments : ''
                entry.arguments += argumentsDelta
                produced = true
                yield {
                  type: 'tool-call-delta',
                  index: entry.index,
                  id: entry.id === '' ? `call-${slot}` : entry.id,
                  ...(entry.name === '' ? {} : { name: entry.name }),
                  argumentsDelta,
                }
              }
            }
          }
        }
      } finally {
        // Close anything still open, in stream order.
        for (const index of [...open.keys()].sort((left, right) => left - right)) {
          const partial = open.get(index)
          if (partial.blockType === 'tool-call') {
            const entry = [...toolSlots.values()].find((candidate) => candidate.index === index)
            open.delete(index)
            yield {
              type: 'block-end',
              index,
              block: {
                type: 'tool-call',
                id: entry === undefined || entry.id === '' ? `call-${index}` : entry.id,
                name: entry?.name ?? '',
                arguments: entry === undefined || entry.arguments === '' ? '{}' : entry.arguments,
              },
            }
          } else {
            const close = closeBlock(index)
            if (close !== undefined) yield close
          }
        }
        reader.releaseLock?.()
      }

      if (usage !== undefined) yield { type: 'usage', usage }
      const reason = finishReasonOf(finishReason)
      if (!produced && reason.kind === 'stop') {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'the BAC gateway returned an empty response', code: 'EMPTY_RESPONSE' } } }
        return
      }
      yield { type: 'finish', reason }
    } catch (error) {
      if (options2.signal?.aborted === true) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'the request was cancelled', code: 'ABORTED' } } }
        return
      }
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `the BAC stream failed: ${error?.message ?? error}`, code: 'PROVIDER' } } }
    } finally {
      clearTimeout(timeout)
      options2.signal?.removeEventListener('abort', onAbort)
    }
  }

  /**
   * The provider adapter. Every member the LLM runtime reaches for exists here,
   * so the route behaves like a first-class provider without importing any
   * harness package: a profile-installed bundle cannot resolve them.
   */
  const adapter = {
    providerInfo() {
      return { id: PROVIDER, name: PROVIDER_NAME }
    },
    providerRetryPolicy() {
      return undefined
    },
    imageRequestPricing() {
      return undefined
    },
    imageRequestTarget(_provider, _model, image) {
      return {
        ...requestImageDimensions(image.width, image.height, REQUEST_IMAGE_MAX_PIXELS),
        maxBytes: REQUEST_IMAGE_MAX_BYTES,
      }
    },
    listModels() {
      return Promise.resolve(
        enabledModels().map((model) => ({
          provider: PROVIDER,
          id: model.id,
          name: model.name,
          inputModalities: model.input,
        })),
      )
    },
    resolveModel(_provider, id) {
      try {
        return Promise.resolve(describeModel(modelOf(id)))
      } catch (error) {
        return Promise.reject(error)
      }
    },
    prepareCall(_provider, id) {
      try {
        const model = describeModel(modelOf(id))
        return Promise.resolve({ model, stream: (options2) => stream(options2) })
      } catch (error) {
        return Promise.reject(error)
      }
    },
    stream(options2) {
      return stream(options2)
    },
  }

  ctx.llm.registerAdapter([PROVIDER], adapter)

  // --- settings page HTTP surface -------------------------------------------

  /** Answer an untrusted or unauthenticated request; true when it was rejected. */
  function rejected(req, res) {
    const connection = ctx.get('connection')
    if (connection === undefined) return false
    const rejection = connection.requestRejection?.(req)
    if (rejection === undefined || rejection === false) return false
    res.statusCode = typeof rejection === 'number' ? rejection : 403
    res.end()
    return true
  }

  function sendJson(res, status, payload) {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(payload))
  }

  /** Read one bounded JSON body; `undefined` past the ceiling or when malformed. */
  async function readJsonBody(req) {
    const limit = 64 * 1024
    const chunks = []
    let total = 0
    for await (const chunk of req) {
      total += chunk.length
      if (total > limit) return undefined
      chunks.push(chunk)
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      return parsed !== null && typeof parsed === 'object' ? parsed : undefined
    } catch {
      return undefined
    }
  }

  // The web carrier is provided by a later bundle layer, so the routes wait for
  // it instead of reading it once here: `ctx.inject` re-runs this block when the
  // service arrives, and disposes it when the service leaves.
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    ctx.inject(['webServer'], (child) => {
      registerRoutes(child.get('webServer'), child)
    })
  } else {
    registerRoutes(webServer, ctx)
  }

  /**
   * Register the two routes the settings page calls.
   * @param server - the composition's web carrier.
   * @param owner - the context whose effect owns the registrations.
   */
  function registerRoutes(server, owner) {
    if (server === undefined || typeof server.register !== 'function') return

    owner.effect(
      () =>
        server.register({
          kind: 'exact',
          path: CATALOG_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'GET') {
              res.statusCode = 405
              res.setHeader('allow', 'GET')
              res.end()
              return
            }
            try {
              await syncCredential()
            } catch (error) {
              warn('credential sync failed', error)
            }
            await refreshCatalog()
            sendJson(res, 200, publish())
          },
        }),
      `dsh-brainyaiclaw: GET ${CATALOG_ROUTE}`,
    )

    owner.effect(
      () =>
        server.register({
          kind: 'exact',
          path: PREFERENCES_ROUTE,
          handler: async (req, res) => {
            if (rejected(req, res)) return
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.setHeader('allow', 'POST')
              res.end()
              return
            }
            const body = await readJsonBody(req)
            if (body === undefined) {
              sendJson(res, 400, { ok: false, error: 'a JSON body is required' })
              return
            }
            const known = new Set(baseModels().map((model) => model.id))
            const patch = body.models !== null && typeof body.models === 'object' ? body.models : {}
            for (const [id, value] of Object.entries(patch)) {
              if (!known.has(id) || value === null || typeof value !== 'object') continue
              const next = { ...(preferences[id] ?? {}) }
              if (typeof value.name === 'string') {
                const name = value.name.trim()
                if (name === '') delete next.name
                else next.name = name
              }
              if (typeof value.enabled === 'boolean') next.enabled = value.enabled
              if (Array.isArray(value.input)) next.input = modalitiesOf(value.input)
              if (Object.keys(next).length === 0) delete preferences[id]
              else preferences[id] = next
            }
            try {
              await savePreferences()
            } catch (error) {
              sendJson(res, 500, { ok: false, error: `could not save the settings: ${error?.message ?? error}` })
              return
            }
            sendJson(res, 200, { ok: true, catalog: publish() })
          },
        }),
      `dsh-brainyaiclaw: POST ${PREFERENCES_ROUTE}`,
    )
  }

  // --- lifecycle ------------------------------------------------------------

  ctx.effect(() => {
    let disposed = false
    let timer

    const start = async () => {
      await loadPreferences()
      await refreshCatalog()
      publish()
      try {
        await syncCredential()
      } catch (error) {
        warn('credential sync failed', error)
      }
      if (disposed) return
      // The app rotates its token on its own schedule; keep the store in step.
      timer = setInterval(
        () => {
          void syncCredential().catch((error) => warn('credential sync failed', error))
        },
        Math.max(options.syncIntervalMs, 5000),
      )
      timer.unref?.()
    }

    void start().catch((error) => warn('startup failed', error))

    return () => {
      disposed = true
      if (timer !== undefined) clearInterval(timer)
    }
  })
}
