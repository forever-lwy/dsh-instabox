# 0.1.1

本版处理桌面接管仍只读、资源信息难读和规格表单没有当前值三个问题。

## 桌面接管

官方分享链接为同一路径 `/desktop/{machineId}#token=...`，观看与控制切换只变更 URL fragment。官方 viewer 初始挂载解析 token，未在 hash 变化时重建其 noVNC 会话。旧版只修改 iframe 的 src，浏览器执行同文档导航，导致旧只读 token 和 viewOnly 状态继续生效。

现在以机器、观看模式和完整 URL 作为 iframe key，使新权限对应新文档和新桌面连接。回归测试使用真实的 hash 链接格式，检查旧 iframe 已断开、新 iframe 携带控制 token；同时验证 Host 确实申请 viewOnly:false，续期保留同一控制链接。

协议依据：官方 [Desktop](https://instabox.sh/docs/desktop)、[OpenAPI](https://api.instabox.sh/v1/openapi.json) 及排查时的公开 [viewer 代码](https://dashboard.instabox.sh/assets/891f303403eb7779/js/app.js)。公开构建中 Jv / $v 的初始化行为支持上述判断。没有改动 Host 接管身份或放松人工锁。

## 资源和规格

- 自动独立读取各类资源，显示中文名称、明确单位和配额进度，原始响应折叠。
- 机器规格读取后预填；空缺数据保留未知，不用假零替代。
- 保存仅提交已修改字段，避免扩容磁盘时意外发送 CPU 和内存变更。
- 保存和切机忽略过期响应，重新读取服务器规格；某个接口失败不阻断其他卡片。
- 金额只使用平台实际返回字段，不根据资源规格估算账单，也不把停机预算余量当作余额。

本版依旧按独立开发、局部验证和版本包手动安装流程交付。真实云桌面的鼠标效果需要安装新版后在账号环境确认，局部测试不等同于云端端到端测试。
