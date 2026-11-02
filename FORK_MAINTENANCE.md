# 招聘部署 fork 维护记录

当前版本：`@onlyforchris/dsh-im@5.9.1-2`，上游为 `@xmanrui/dsh-im@5.9.1`。
上游 tag `v5.9.1` 对应 commit `17ee6ec1943aed134fe342d427bb8da341aac449`。

2026-11-02 将旧 `dsh-im-compat` 的有效定制与上游 5.9.1 三方合并，以 4.32.0 为差异基线。
旧源码目录保留，本目录是新版本的维护源码。`origin` 指向 onlyforchris fork，`upstream` 指向 xmanrui；安装包通过本地 tgz 交付，npm 发布独立管理。

保留的定制：

- 包、客户端模块和更新器使用 onlyforchris 身份，避免更新时覆盖为原版。
- `im/pre-ask` 在调用模型前返回招聘固定回执；普通招聘请求交给 flow-bus，路由只应用一次。
- 招聘固定回执按当前对话实际工作区判断，等待工作区切换提交后再路由。消息来源、发送人和消息 ID 标记按不可信输入传递，同时保留新版会话恢复、工作区切换和 artifacts 行为。
- 微信和企微的主动通知、目标持久化、图片失败降级；企微 outbox 透传完整事件。
- 保留新版 Host Peer 生命周期与诊断实现，使用上游 `method` 字段及安全错误链，替代旧版重复诊断字段。
- 更新新增界面的 fork 标识，保留上游依赖锁定和 5.9.1 的邮件、飞书、LAN 管理修复。

验证环境：Node 24.14.0、Windows、原版 DSH 0.2.1-rc.5。
`npm run check`：4,839 项，4,824 通过，0 失败，15 因平台或 symlink 权限条件跳过；构建和包校验通过。
业务验证：微信、企微、钉钉、飞书固定回执零模型调用；帮助菜单、配置错误保护、11 个招聘工具、两种消息来源标记及配置幂等通过。
隔离真实 DSH：固定问候原文、普通和流式回答、招聘约束注入、`/compact` 通过。

可复查命令（在招聘工作区执行）：

```powershell
npm.cmd --prefix .\dsh-im run check
node .\dsh-flow-compat\verify-host.mjs .\runtime\dsh-upgrade-021rc5 .\dsh-im .\runtime\dsh-clean-install-20261026
Push-Location .\dsh-flow-compat
node .\test-business-591.mjs
Pop-Location
```

本地验证没有向外部 IM 发送真实消息。渠道登录和客户机岗位发布流程须单独验收。
