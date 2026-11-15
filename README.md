# dsh-BrainyAIClaw

把 **BrainyAIClaw（有道龙虾 / LobsterAI）** 的模型作为 **DeepSeek Harness（DSH）** 的一个模型供应商使用。

供应商在模型菜单与设置页里显示为 **BAC**。模型清单直接来自 BrainyAIClaw 自己的配置，登录令牌自动同步，无需手工填 Key。

## 安装

把下面这句话发给 DSH 里的 Agent：

```text
请调用 plugin_manager 工具（action: install_bundle），安装插件：https://wenjian.zhengl.vip/DSH/dsh-brainyaiclaw-1.0.2.tgz
```

这是打包好的安装包，不需要本机有 Git，国内下载也快。

装完 DSH 会自动加载插件，不需要重启。若设置页里没看到 BAC，重启一次 DSH。

## 它能做什么

| 能力 | 说明 |
|---|---|
| 自动连接 | 每次启动 DSH 都会读取 BrainyAIClaw 的登录令牌并写入 DSH 凭据库，之后定时核对；令牌轮换后下一次请求就用新的 |
| 模型清单 | 读取 BrainyAIClaw 自己的配置；该文件不存在时用内置清单 |
| 不依赖 App 运行 | 走云端网关而不是 App 的本机代理端口，因此 BrainyAIClaw 开不开都能用 |
| 思考档位 | 按模型提供可切换的思考档位，在标准「设置 → 模型」页里逐个开关 |
| 隐藏重复供应商 | 安装后模型菜单只保留 BAC 一组，避免出现两个来源相同的供应商 |

支持工具调用、推理过程（思考）、图片输入、用量统计和请求取消，与 DSH 自带供应商一致。

## 设置

- **设置 → 模型**：BAC 作为标准供应商行出现，可查看凭证状态、编辑模型清单与思考档位。
- **设置 → BAC 模型**：只读信息（供应商、凭证状态、模型清单来源）。

停用的模型不会出现在模型选择器里，但仍然保留在设置页，随时可以重新启用。

## 工作方式

- 认证使用 BrainyAIClaw 登录后写入本地配置的令牌，令牌同步写入 DSH 凭据库，配置文件本身不含任何密钥。
- 每次请求都重新解析令牌；网关回 401 会清掉缓存，下一次请求自动重新读取 App 的令牌，因此令牌刷新不需要重启 DSH。
- 插件偏好保存在 `$DSH_HOME/dsh-brainyaiclaw/state.json`，与 DSH 配置分开，DSH 升级不会覆盖。

## 配置项

在 `cordis.patch.yml` 的 `dsh-brainyaiclaw` 条目下可调：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `900000` | 单次请求超时（毫秒） |
| `syncIntervalMs` | `60000` | 核对登录令牌的间隔（毫秒） |
| `useAppCatalog` | `true` | 是否读取 BrainyAIClaw 的模型清单 |
| `registerRoute` | `true` | 是否由本插件认领模型路由；内置 pi-ai 已承载该路由时置 `false` |

## 卸载

```text
请调用 plugin_manager 工具（action: remove_bundle），卸载 dsh-brainyaiclaw
```

## 许可

MIT。
