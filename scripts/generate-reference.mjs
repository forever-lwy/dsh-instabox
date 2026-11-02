import {writeFile} from 'node:fs/promises'
import {z} from 'zod'
import {ACTION_INPUT_SCHEMAS} from '../lib/api.js'
const rows = Object.entries(ACTION_INPUT_SCHEMAS).map(([action,schema]) => {
  const json = z.toJSONSchema(schema)
  const required = json.required ?? []
  const fields = Object.keys(json.properties ?? {}).map(key => `${key}${required.includes(key) ? '*' : ''}`)
  return `| \`${action}\` | ${fields.length ? fields.map(key => `\`${key}\``).join(', ') : '无'} |`
})
const text = `# 操作参考\n\n由固定版本输入 schema 生成；星号为必填字段。模型可调用 \`instabox_help\` 查询单个 action 的完整 JSON Schema。机器操作一律使用列表返回的 \`m_…\` ID，不接受机器名称别名。\n\n每个请求为 \`{action, machineId?, input?}\`；下表列出 \`input\` 字段，前端“高级操作”中只填写这个 input 对象。\n\n| action | input 字段 |\n| --- | --- |\n${rows.join('\n')}\n\n## 人工控制\n\n这些 action 仅供用户界面，不向模型开放：\n\n- \`control.take\`：machineId + input.ownerId，启动桌面、申请接管并生成可控制链接。\n- \`control.renew\`：machineId + input.ownerId，维持人工租约；界面每 10 秒调用。\n- \`control.release\`：machineId + input.ownerId，撤销分享链接并交还。\n- \`control.status\`：machineId，查询状态；模型也能查询不含链接的状态。\n\n官方桌面低层 takeover/handback/view/revoke 同样不提供给模型。官方撤销会断开该机所有分享 viewer，模型工具的人工锁只覆盖本插件操作。\n\n## 长任务\n\n\`execute\` 返回插件 JobView，status 为 queued/running/succeeded/failed/cancelled。用插件 jobId 查询原操作，不重复提交。API 层会追踪生命周期 operation 的最终状态；失败或超时后保留 operationId 时可用 operations.get 查询。\n\n\`commands.run\` 的 background=true 返回的是**云机后台命令 jobId**，用 jobs.get/list/kill 管理，与插件任务 ID 不同。前台非零退出仍返回 stdout、stderr 和 exitCode，不自动重试命令。\n\n\`files.read\` 返回 {path,format,content}，format 为 text 或 base64；\`files.write\` 使用同样格式。截图返回 PNG 原始尺寸与 base64，模型工具会转换为 DSH 图片附件。坐标按原屏幕像素计算。\n\n\`ports.publish\` 的 access 默认 private；public 才是公开入口。\`machines.create\` 不自动注入个人 Vault 或组织 Secrets。模板用 templateId，快照来源用 snapshotId，两者不可同时填写。\n`
await writeFile(new URL('../docs/actions.md',import.meta.url), text)
console.log('Updated docs/actions.md')
