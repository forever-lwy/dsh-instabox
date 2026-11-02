# DSH Instabox

适用于 **DeepSeek Harness 0.2.1-rc.5** 的 Instabox 云电脑插件。独立的 Host 插件、浏览器面板及模型工具，使用官方 API 和固定版本 `@insforge/instabox-sdk@0.6.0`。

## 安装

开发源码和运行副本分离。完成构建验证的首个版本包为：

```text
/plugins/releases/dsh-instabox-0.1.0.tgz
```

在 DSH 的「插件 → 添加插件」输入上面的**容器路径**，由用户确认安装并启用。是否需要重启以安装界面提示为准。不要把源码目录用 `link:`、目录依赖或模块路径接入常用 profile。

插件提供「Instabox」主导航入口和设置页面。首次打开设置，填入 Instabox API Key 并保存；界面仅显示是否配置，不会读回密钥。普通设置存入 DSH_HOME 下的插件独立文件，密钥交给 DSH credentials 服务保存。

推荐使用**创建机器的本人账号的个人 API Key**：机器执行需要 `machines:read` 和 `machines:write`，删除机器需要 `machines:delete`，快照管理需要对应的 `images:*` 权限。只读 Key 无法启动桌面。

官方桌面分享接口不接受 workspace API Key；该 Key 可执行其他有权限的操作，但生成桌面 viewer 会得到 403。当前版本以个人 Key 的官方 viewer 为桌面接入方式，不提供 workspace Key 的自建 VNC WebSocket 中继。

## 桌面与人工接管

选择机器后启动桌面，可以在插件内观看、全屏或在新窗口打开官方桌面。默认观看链接为服务端强制只读。

点击「接管」后，插件请求官方接管状态，生成可操控链接，同时建立插件内的人工控制租约。键盘、鼠标和剪贴板通过官方 viewer 连接云电脑，API Key 不会交给 iframe。接管期间，本插件的模型工具不能对该机器执行命令、修改文件、变更生命周期或发送键鼠输入；截图等只读操作仍可用。

点击「交还」会撤销该机器的桌面分享链接并交还官方控制状态。官方撤销接口以整台机器为粒度，会断开该机的其他分享 viewer；因此不要在同一机器上依赖其他长期分享链接。仅链接到期不能断开已连接 viewer。

界面切换机器或退出时尝试交还；人工租约有续约与失联回收，浏览器突然关闭也不应永久锁住模型。接管不会自动终止此前已经启动的后台程序；如需停止它们，使用任务列表终止对应后台任务。

接管清理记录保存在设置同目录的 `control-leases.json`，只包含机器 ID、租约标识和时间。DSH 热重载或重启后会先撤销旧连接；失败时显示「上次接管待清理」，模型仍不能变更该机器。可在设置更新失效密钥，再点击「清理并交还」。不要用删除记录文件的方式代替撤销旧桌面连接。

除直接桌面接管外，插件还提供截图、坐标点击/双击、右键/中键、移动、拖拽、滚动、文字输入、快捷键及打开网址。让模型依据截图操作，需要当前模型支持图片输入；纯文本模型可用命令和网页脚本。

## 其他功能

- 云机：列表、详情、模板、创建、启动、暂停、恢复、停止、修改配置、复制、日志、磁盘和删除。
- 命令：前台执行和后台任务，查询日志、结果与终止任务。长任务通过插件任务 ID 查询，不依赖 MCP 的单次 60 秒等待。
- 文件：目录浏览、文本编辑、上传、下载、删除。官方 SDK 单次文件传输最多 10 MiB；插件按同一限制处理，不自动同步整个工作区。
- 快照：列表、详情、创建、删除和从快照创建机器。
- 网络：端口列表、发布和取消发布，支持官方允许的私有访问模式。
- 运维：机器指标、账号/单机用量，以及用用户提供的 SSH 公钥申请短时登录凭证。
- 模型工具：独立开关，任务提交和状态查询，桌面截图使用 DSH 附件通道供模型读取。

插件操作的是 Instabox 云机，DSH 现有本地终端和 `/workspace` 的位置不变。机器、快照、资源和运行时长均受 Instabox 账号套餐限制；创建或运行机器可能产生计费。

完整字段见 [操作参考](docs/actions.md)。模型可先调用 `instabox_help` 查询单个操作的精确输入结构，无需猜测高级参数。

## 开发和打包

只在本插件目录执行：

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm test
npm pack --pack-destination ../releases
```

Git 来源安装可通过 `prepare` 构建；如果 pnpm 提示构建许可，由用户按具体包确认。发布下一版时递增版本号并使用新的 `.tgz` 文件名。此项目不自动向 GitHub 推送、不发布市场索引、不安装到日常 profile。

离线测试覆盖协议、输入校验、凭据边界、接管互斥及浏览器行为。没有真实账号时不能声称完成了官方云端端到端测试。账号安装后的验证步骤见 [实机验证](docs/verification.md)。

## 官方接口

- [SDK reference](https://instabox.sh/docs/sdk)
- [Desktop](https://instabox.sh/docs/desktop)
- [REST API](https://instabox.sh/docs/api)
- [OpenAPI](https://api.instabox.sh/v1/openapi.json)
- [API keys](https://instabox.sh/docs/api-keys)
- [Plans and limits](https://instabox.sh/docs/limits)

本插件为独立第三方 DSH 插件，与 Instabox 官方无隶属关系。SDK 由其作者按 Apache-2.0 许可提供，作为依赖安装，未复制到插件源码。
