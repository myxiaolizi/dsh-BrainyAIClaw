/**
 * dsh-brainyaiclaw — Client half.
 *
 * Adds a "BAC" page to Settings that lists the models BrainyAIClaw offers and
 * lets the user rename them, switch them off, and choose which input types each
 * one accepts. The endpoint and the credential are shown read-only: BrainyAIClaw
 * owns both.
 *
 * The page renders through the host's own slots, theme tokens and locale, so it
 * sits beside the Models page and follows the active language.
 */
window.__ModuleLoader__.load({
  id: 'dsh-brainyaiclaw',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const CATALOG_ROUTE = '/api/brainyaiclaw/catalog'
    const PREFERENCES_ROUTE = '/api/brainyaiclaw/preferences'
    const NS = 'dsh-brainyaiclaw'

    /** The page's own strings, registered into the host locale service. */
    const ZH = {
      nav: 'BAC 模型',
      title: 'BrainyAIClaw 模型',
      subtitle: '这些模型由 BrainyAIClaw 提供。地址与凭证只读，不能在此修改。',
      provider: '供应商',
      endpoint: '地址',
      credential: '凭证',
      credentialReady: '已连接',
      credentialMissing: '未找到登录令牌',
      credentialHint: '在 BrainyAIClaw 中登录一次即可，这里不需要填写任何密钥。',
      sourceApp: '读取自 BrainyAIClaw 配置',
      sourceRemembered: '沿用上次读取的配置',
      sourceBundled: '使用内置模型列表',
      models: '模型',
      enabled: '启用',
      disabled: '已停用',
      modelName: '显示名称',
      inputTypes: '输入类型',
      text: '文本',
      image: '图像',
      contextWindow: '上下文',
      reasoning: '思考档位',
      reset: '恢复默认',
      save: '保存',
      saved: '已保存',
      saveFailed: '保存失败',
      reload: '刷新',
      loading: '正在读取 BrainyAIClaw 的模型…',
      loadFailed: '读取失败',
      empty: '没有可用的模型',
      readonly: '只读',
      retry: '重试',
      enabledCount: '已启用 {enabled} / {total}',
    }

    const EN = {
      nav: 'BAC models',
      title: 'BrainyAIClaw models',
      subtitle: 'These models come from BrainyAIClaw. The endpoint and credential are read-only.',
      provider: 'Provider',
      endpoint: 'Endpoint',
      credential: 'Credential',
      credentialReady: 'Connected',
      credentialMissing: 'No login token found',
      credentialHint: 'Sign in to BrainyAIClaw once; there is no key to type here.',
      sourceApp: 'Read from the BrainyAIClaw configuration',
      sourceRemembered: 'Left over from the last read',
      sourceBundled: 'Using the built-in model list',
      models: 'Models',
      enabled: 'Enabled',
      disabled: 'Off',
      modelName: 'Display name',
      inputTypes: 'Input types',
      text: 'Text',
      image: 'Image',
      contextWindow: 'Context',
      reasoning: 'Thinking levels',
      reset: 'Reset',
      save: 'Save',
      saved: 'Saved',
      saveFailed: 'Could not save',
      reload: 'Refresh',
      loading: 'Reading the BrainyAIClaw model list…',
      loadFailed: 'Read failed',
      empty: 'No models available',
      readonly: 'Read-only',
      retry: 'Retry',
      enabledCount: '{enabled} of {total} enabled',
    }

    /** Substitute `{name}` placeholders. */
    function fill(text, values) {
      return Object.entries(values ?? {}).reduce(
        (result, [key, value]) => result.split(`{${key}}`).join(String(value)),
        text,
      )
    }

    const styles = {
      section: {
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: 860,
        color: 'var(--dsw-alias-label-primary)',
      },
      header: { display: 'flex', flexDirection: 'column', gap: 4 },
      title: { fontSize: 15, fontWeight: 600, margin: 0 },
      subtitle: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', margin: 0 },
      facts: {
        display: 'grid',
        gridTemplateColumns: 'minmax(96px, max-content) 1fr',
        gap: '6px 16px',
        fontSize: 12,
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      factLabel: { color: 'var(--dsw-alias-label-secondary)' },
      factValue: { margin: 0, wordBreak: 'break-all' },
      readonly: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginLeft: 6 },
      toolbar: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      counter: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', flex: 1 },
      button: {
        font: 'inherit',
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      primaryButton: {
        font: 'inherit',
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        color: '#ffffff',
        border: '1px solid var(--dsw-alias-brand-primary)',
        background: 'var(--dsw-alias-brand-primary)',
      },
      list: { display: 'flex', flexDirection: 'column', gap: 6 },
      row: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      rowOff: { opacity: 0.62 },
      rowMain: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      modelId: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary)',
        flex: 1,
        minWidth: 180,
        wordBreak: 'break-all',
      },
      nameInput: {
        font: 'inherit',
        fontSize: 12,
        padding: '3px 6px',
        borderRadius: 6,
        minWidth: 180,
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
      },
      toggle: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
      },
      chipGroup: { display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12 },
      chipLabel: { color: 'var(--dsw-alias-label-secondary)' },
      status: { fontSize: 12, minHeight: 16 },
      ok: { color: 'var(--dsw-alias-state-success-primary)' },
      error: { color: 'var(--dsw-alias-state-error-primary)' },
      hint: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', margin: 0 },
      chip: {
        fontSize: 11,
        padding: '1px 6px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
      },
    }

    /** A per-model draft so typing never loses focus. */
    function draftFromCatalog(catalog) {
      const draft = {}
      for (const model of catalog?.models ?? []) {
        draft[model.id] = { name: model.name, enabled: model.enabled, input: [...model.input] }
      }
      return draft
    }

    /** Whether one draft row differs from what the catalog reports. */
    function isDirty(draft, model) {
      const row = draft?.[model.id]
      if (row === undefined) return false
      if (row.name !== model.name || row.enabled !== model.enabled) return true
      return [...row.input].sort().join(',') !== [...model.input].sort().join(',')
    }

    /** The settings page. */
    function BacModelsSection(props) {
      const t = props.t
      const [state, setState] = React.useState({ status: 'loading', catalog: null, error: null })
      const [draft, setDraft] = React.useState({})
      const [notice, setNotice] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async () => {
        setState((current) => ({ ...current, status: 'loading', error: null }))
        try {
          const response = await fetch(CATALOG_ROUTE, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const catalog = await response.json()
          setState({ status: 'ready', catalog, error: null })
          setDraft(draftFromCatalog(catalog))
        } catch (error) {
          setState({ status: 'error', catalog: null, error: String(error?.message ?? error) })
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [load])

      const update = (id, patch) => {
        setDraft((current) => ({ ...current, [id]: { ...(current[id] ?? {}), ...patch } }))
        setNotice(null)
      }

      const reset = (model) => {
        setDraft((current) => ({
          ...current,
          [model.id]: { name: model.defaultName, enabled: true, input: [...model.defaultInput] },
        }))
        setNotice(null)
      }

      const toggleInput = (id, kind, checked) => {
        const current = Array.isArray(draft[id]?.input) ? [...draft[id].input] : []
        const next = checked ? [...new Set([...current, kind])] : current.filter((entry) => entry !== kind)
        update(id, { input: next.length > 0 ? next : ['text'] })
      }

      const save = async () => {
        const models = {}
        for (const model of state.catalog?.models ?? []) {
          const row = draft[model.id]
          if (row === undefined) continue
          models[model.id] = { name: row.name, enabled: row.enabled, input: row.input }
        }
        setBusy(true)
        setNotice(null)
        try {
          const response = await fetch(PREFERENCES_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ models }),
          })
          const body = await response.json().catch(() => null)
          if (!response.ok || body?.ok !== true) throw new Error(body?.error ?? `HTTP ${response.status}`)
          setState({ status: 'ready', catalog: body.catalog, error: null })
          setDraft(draftFromCatalog(body.catalog))
          setNotice({ kind: 'ok', text: t('saved') })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('saveFailed')}: ${error?.message ?? error}` })
        } finally {
          setBusy(false)
        }
      }

      const catalog = state.catalog
      const models = catalog?.models ?? []
      const enabledCount = models.filter((model) => draft[model.id]?.enabled !== false).length
      const dirty = models.some((model) => isDirty(draft, model))
      const sourceLabel =
        catalog?.catalogSource === 'app'
          ? t('sourceApp')
          : catalog?.catalogSource === 'remembered'
            ? t('sourceRemembered')
            : t('sourceBundled')
      const credentialReady = catalog?.credential?.configured === true

      const header = h(
        'div',
        { style: styles.header },
        h('h2', { style: styles.title }, t('title')),
        h('p', { style: styles.subtitle }, t('subtitle')),
      )

      const facts = h(
        'div',
        { style: styles.facts },
        h('span', { style: styles.factLabel }, t('provider')),
        h('p', { style: styles.factValue }, `${catalog?.providerName ?? 'BAC'} (${catalog?.provider ?? 'brainyaiclaw'})`),
        h('span', { style: styles.factLabel }, t('endpoint')),
        h(
          'p',
          { style: styles.factValue },
          catalog?.baseURL ?? '—',
          h('span', { style: styles.readonly }, t('readonly')),
        ),
        h('span', { style: styles.factLabel }, t('credential')),
        h(
          'p',
          { style: { ...styles.factValue, ...(credentialReady ? styles.ok : styles.error) } },
          credentialReady ? t('credentialReady') : t('credentialMissing'),
          h('span', { style: styles.readonly }, t('readonly')),
        ),
        h('span', { style: styles.factLabel }, t('models')),
        h('p', { style: styles.factValue }, sourceLabel),
      )

      const body = (() => {
        if (state.status === 'loading') return h('p', { style: styles.hint }, t('loading'))
        if (state.status === 'error') {
          return h(
            'div',
            { style: styles.toolbar },
            h('span', { style: { ...styles.status, ...styles.error } }, `${t('loadFailed')}: ${state.error}`),
            h('button', { type: 'button', style: styles.button, onClick: () => void load() }, t('retry')),
          )
        }
        const rows = models.map((model) => {
          const row = draft[model.id] ?? { name: model.name, enabled: model.enabled, input: model.input }
          const off = row.enabled === false
          const input = Array.isArray(row.input) ? row.input : [...model.input]
          return h(
            'div',
            { key: model.id, style: { ...styles.row, ...(off ? styles.rowOff : {}) } },
            h(
              'div',
              { style: styles.rowMain },
              h(
                'label',
                { style: styles.toggle, title: t('enabled') },
                h('input', {
                  type: 'checkbox',
                  checked: row.enabled !== false,
                  onChange: (event) => update(model.id, { enabled: event.target.checked }),
                }),
                off ? t('disabled') : t('enabled'),
              ),
              h('input', {
                type: 'text',
                style: styles.nameInput,
                value: row.name ?? '',
                'aria-label': t('modelName'),
                placeholder: model.defaultName,
                onChange: (event) => update(model.id, { name: event.target.value }),
              }),
              h('span', { style: styles.modelId }, model.id),
              h('button', { type: 'button', style: styles.button, onClick: () => reset(model) }, t('reset')),
            ),
            h(
              'div',
              { style: styles.chipGroup },
              h('span', { style: styles.chipLabel }, t('inputTypes')),
              h(
                'label',
                { style: styles.toggle },
                h('input', {
                  type: 'checkbox',
                  checked: input.includes('text'),
                  disabled: input.length === 1 && input.includes('text'),
                  onChange: (event) => toggleInput(model.id, 'text', event.target.checked),
                }),
                t('text'),
              ),
              h(
                'label',
                { style: styles.toggle },
                h('input', {
                  type: 'checkbox',
                  checked: input.includes('image'),
                  onChange: (event) => toggleInput(model.id, 'image', event.target.checked),
                }),
                t('image'),
              ),
              h(
                'span',
                { style: styles.chip },
                `${t('contextWindow')}: ${Number(model.contextWindow).toLocaleString()}`,
              ),
              Array.isArray(model.reasoning) && model.reasoning.length > 0
                ? h('span', { style: styles.chip }, `${t('reasoning')}: ${model.reasoning.join(' / ')}`)
                : null,
            ),
          )
        })
        return h(
          React.Fragment,
          null,
          h(
            'div',
            { style: styles.toolbar },
            h('span', { style: styles.counter }, fill(t('enabledCount'), { enabled: enabledCount, total: models.length })),
            notice !== null
              ? h(
                  'span',
                  { style: { ...styles.status, ...(notice.kind === 'ok' ? styles.ok : styles.error) } },
                  notice.text,
                )
              : null,
            h('button', { type: 'button', style: styles.button, onClick: () => void load() }, t('reload')),
            h(
              'button',
              {
                type: 'button',
                style: { ...styles.primaryButton, opacity: dirty && !busy ? 1 : 0.5 },
                disabled: !dirty || busy,
                onClick: () => void save(),
              },
              t('save'),
            ),
          ),
          models.length === 0 ? h('p', { style: styles.hint }, t('empty')) : h('div', { style: styles.list }, rows),
        )
      })()

      return h(
        'div',
        { style: styles.section },
        header,
        facts,
        catalog !== null && !credentialReady ? h('p', { style: styles.hint }, t('credentialHint')) : null,
        body,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'dsh-brainyaiclaw: zh dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'zh-CN', ZH), 'dsh-brainyaiclaw: zh-CN dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'dsh-brainyaiclaw: en dictionary')
        // Every other host language falls back to the English strings.
        for (const id of ['ja', 'es', 'fr', 'de', 'ru', 'pt']) {
          ctx.effect(() => ctx.locale.register(NS, id, EN), `dsh-brainyaiclaw: ${id} dictionary`)
        }
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'brainyaiclaw',
              order: 11,
              label: () => t('nav'),
              inject: () => ({ t }),
            },
            BacModelsSection,
          ),
        )
      },
    }
  },
})
