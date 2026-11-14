# dsh-BrainyAIClaw

把 **BrainyAIClaw（有道龙虾 / LobsterAI）** 的模型作为 **DSH（DeepSeek Harness）** 的一个模型供应商使用。

供应商在模型菜单里显示为 **BAC**，模型列表直接来自 BrainyAIClaw 自己的配置；地址和登录令牌只读，只有显示名称、启停和输入类型可以在设置里改。

## 安装

把下面这句话发给 DSH 里的 Agent：

```text
请调用 plugin_manager 工具（action: install_bundle），安装插件：https://wenjian.zhengl.vip/DSH/dsh-brainyaiclaw-1.0.0.tgz
```

这是打包好的安装包，不需要本机有 Git，国内下载也快。

装完 DSH 会自动加载插件，不需要重启；如果设置页里没看到“BAC 模型”，重启一次 DSH。

> 也可以从源码安装（需要本机已安装 Git，DSH 安装时会先用 `git ls-remote` 检查仓库）：
>
> ```text
> 请调用 plugin_manager 工具（action: install_bundle），安装插件：git+https://github.com/myxiaolizi/dsh-BrainyAIClaw.git
> ```

## 它做的事

| 能力 | 说明 |
|---|---|
| 自动连接 | 每次启动 DSH 都会读取 BrainyAIClaw 的登录令牌并写入 DSH 凭据库，之后每 60 秒核对一次；令牌轮换后下一次请求就用新的 |
| 模型列表 | 读取 BrainyAIClaw 自己的 `openclaw.json`；该文件不存在时用内置的同一份模型清单 |
| 只读项 | 网关地址与登录令牌：界面显示，不可修改，也不会写进配置文件 |
| 可改项 | 模型显示名称、启用/停用某个模型、模型输入类型（文本 / 图像） |
| 不依赖 App | 走 BrainyAIClaw 的云端网关而不是它本机的代理端口，因此 BrainyAIClaw 开不开都能用 |
| 隐藏原供应商 | 默认隐藏内置的 DeepSeek 供应商，模型菜单里只保留 BAC 一组 |

支持工具调用、推理过程（思考）、图片输入、用量统计和请求取消，与 DSH 自带供应商一致。

## 设置页

`设置 → BAC 模型`：

- 上半部分是只读信息：供应商、网关地址、凭证状态、模型列表来源。
- 下半部分是模型清单，每一行可以改显示名称、切换启用状态、勾选输入类型，改完点“保存”即刻生效，不用重启 DSH。

停用的模型不会出现在模型选择器里，但仍然保留在设置页，随时可以重新启用。

## 模型清单

随 BrainyAIClaw 配置提供的 14 个模型（首次安装后按 App 配置为准）：

| 模型 ID | 默认显示名 | 上下文窗口 | 图像输入 | 思考档位 |
|---|---|--:|:--:|---|
| `plmf/deepseek-v4.1-flash-1017` | deepseek-v4.1-flash | 100 万 | 支持 | 默认开启 |
| `wcn/gemini-4-argon` | gemini-4-argon | 100 万 | 支持 | 默认开启 |
| `plmf/glm-5.3-flash` | glm-5.3-flash | 100 万 | 支持 | low / high / xhigh |
| `inner/sinomed3.0_27b` | sinomed3.0-27b | 65.5 万 | 支持 | low / medium / xhigh |
| `wcn/gemini-3.6-flash` | gemini-3.6-flash | 100 万 | 支持 | 默认开启 |
| `wcn/gemini-3.8-flash` | gemini-3.8-flash | 100 万 | 支持 | low / high / xhigh |
| `wcn/qwen3.8-max` | qwen3.8-max | 100 万 | 仅文本 | 默认开启 |
| `wcn/gemini-3.7-flash` | gemini-3.7-flash | 100 万 | 支持 | — |
| `wcn/qwen3.7-plus` | qwen3.7-plus | 100 万 | 支持 | — |
| `wcn/glm-5.2` | glm-5.2 | 100 万 | 仅文本 | — |
| `wcn/deepseek-v4-flash` | deepseek-v4-flash | 100 万 | 仅文本 | — |
| `wcn/deepseek-v4-pro` | deepseek-v4-pro | 100 万 | 仅文本 | — |
| `wcn/gpt-5.6-terra` | gpt-5.6-terra | 100 万 | 支持 | — |
| `wcn/gpt-5.5` | gpt-5.5 | 100 万 | 仅文本 | — |

## 工作方式

- 网关地址固定为 `https://gpt.sinohealth.com/v2/openai`，认证用 BrainyAIClaw 登录后写入 `clawcommon.config.json` 的 `claw_user_token`。
- 令牌同时写入 DSH 凭据库的 `BRAINYAICLAW_API_KEY`，由凭据服务按规定路径解析；配置文件里不含任何密钥。
- 每次请求都重新解析令牌；网关回 401 会清掉缓存，下一次请求自动重新读取 App 的令牌，因此 BrainyAIClaw 刷新令牌不需要重启 DSH。
- 模型偏好保存在 `$DSH_HOME/dsh-brainyaiclaw/state.json`，与 DSH 配置分开，DSH 升级不会覆盖。
- 插件补丁只新增自己的条目并隐藏内置 DeepSeek 供应商；BrainyAIClaw 每次启动只重写它自己的 `lobsterai-` 路由，不会覆盖这两处。

## 配置项

在 `cordis.patch.yml` 的 `dsh-brainyaiclaw` 条目下可调：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `https://gpt.sinohealth.com/v2/openai` | 网关地址；一般不需要改 |
| `timeoutMs` | `900000` | 单次请求超时（毫秒） |
| `syncIntervalMs` | `60000` | 核对登录令牌的间隔（毫秒） |
| `useAppCatalog` | `true` | 是否读取 BrainyAIClaw 的模型清单；`false` 时只用内置清单 |

## 卸载

```text
请调用 plugin_manager 工具（action: remove_bundle），卸载 dsh-brainyaiclaw
```

卸载后内置 DeepSeek 供应商会重新出现在模型菜单里。

## 许可

MIT。
