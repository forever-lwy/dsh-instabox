# 操作参考

由固定版本输入 schema 生成；星号为必填字段。模型可调用 `instabox_help` 查询单个 action 的完整 JSON Schema。机器操作一律使用列表返回的 `m_…` ID，不接受机器名称别名。

每个请求为 `{action, machineId?, input?}`；下表列出 `input` 字段，前端“高级操作”中只填写这个 input 对象。

| action | input 字段 |
| --- | --- |
| `account.me` | 无 |
| `account.usage` | 无 |
| `templates.list` | 无 |
| `machines.list` | `limit`, `cursor`, `metadata` |
| `machines.get` | 无 |
| `machines.create` | `name`, `templateId`, `snapshotId`, `vcpus`, `memMiB`, `metadata`, `autoSuspendAfterSeconds` |
| `machines.update` | `vcpus`, `memMiB`, `persistentDiskGiB`, `metadata`, `autoSuspendAfterSeconds` |
| `machines.start` | 无 |
| `machines.suspend` | 无 |
| `machines.resume` | 无 |
| `machines.stop` | `timeoutSeconds` |
| `machines.delete` | `confirm*` |
| `machines.fork` | `name`, `vcpus`, `memMiB`, `metadata` |
| `machines.logs` | `tail`, `after` |
| `machines.disk` | 无 |
| `operations.get` | `operationId*`, `waitSeconds` |
| `commands.run` | `cmd*`, `cwd`, `envs`, `timeoutSeconds`, `background`, `stdin` |
| `jobs.list` | 无 |
| `jobs.get` | `jobId*`, `tail` |
| `jobs.kill` | `jobId*` |
| `files.list` | `path*` |
| `files.read` | `path*`, `format` |
| `files.write` | `path*`, `format`, `content*` |
| `files.remove` | `path*`, `confirm*` |
| `desktop.start` | `width`, `height` |
| `desktop.status` | 无 |
| `desktop.takeover` | 无 |
| `desktop.handback` | 无 |
| `desktop.screenshot` | 无 |
| `desktop.click` | `x*`, `y*`, `button`, `double` |
| `desktop.move` | `x*`, `y*` |
| `desktop.drag` | `from*`, `to*` |
| `desktop.scroll` | `direction*`, `amount` |
| `desktop.type` | `text*`, `delayMs` |
| `desktop.press` | `keys*` |
| `desktop.open` | `url*` |
| `desktop.cursor` | 无 |
| `desktop.view` | `viewOnly`, `ttlSeconds` |
| `desktop.revoke` | 无 |
| `snapshots.list` | 无 |
| `snapshots.get` | `snapshotId*` |
| `snapshots.create` | `name*`, `description`, `rootOnly` |
| `snapshots.delete` | `snapshotId*`, `confirm*` |
| `ports.list` | 无 |
| `ports.publish` | `port*`, `name`, `access`, `rotateToken` |
| `ports.unpublish` | `port*` |
| `ssh.credentials` | `publicKey*`, `ttlSeconds` |
| `metrics.get` | `since` |
| `usage.get` | `from`, `to` |

## 人工控制

这些 action 仅供用户界面，不向模型开放：

- `control.take`：machineId + input.ownerId，启动桌面、申请接管并生成可控制链接。
- `control.renew`：machineId + input.ownerId，维持人工租约；界面每 10 秒调用。
- `control.release`：machineId + input.ownerId，撤销分享链接并交还。
- `control.status`：machineId，查询状态；模型也能查询不含链接的状态。

官方桌面低层 takeover/handback/view/revoke 同样不提供给模型。官方撤销会断开该机所有分享 viewer，模型工具的人工锁只覆盖本插件操作。

## 长任务

`execute` 返回插件 JobView，status 为 queued/running/succeeded/failed/cancelled。用插件 jobId 查询原操作，不重复提交。API 层会追踪生命周期 operation 的最终状态；失败或超时后保留 operationId 时可用 operations.get 查询。

`commands.run` 的 background=true 返回的是**云机后台命令 jobId**，用 jobs.get/list/kill 管理，与插件任务 ID 不同。前台非零退出仍返回 stdout、stderr 和 exitCode，不自动重试命令。

`files.read` 返回 {path,format,content}，format 为 text 或 base64；`files.write` 使用同样格式。截图返回 PNG 原始尺寸与 base64，模型工具会转换为 DSH 图片附件。坐标按原屏幕像素计算。

`ports.publish` 的 access 默认 private；public 才是公开入口。`machines.create` 不自动注入个人 Vault 或组织 Secrets。模板用 templateId，快照来源用 snapshotId，两者不可同时填写。
