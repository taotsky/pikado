# VBD embedding

The standalone application keeps its existing behavior. VBD uses
`/tools/pikado/index.html?embed=1&session=<random-session-id>` in a same-origin
iframe. Embedded boot waits for the parent `init` message before opening storage
or restoring documents. No VBD credentials are passed to the editor.

Messages use `{ namespace: 'vbd:pikado', version: 1, sessionId, type, requestId?, payload? }`.
Both sides must check the exact origin, source window and session ID. The bridge
accepts only `init`, `get-targets`, `insert-images`, `flush`, `dispose` and
`download-project`. It sends `booted`, `ready`, `result`, `error` and `save-state`.
The VBD implementation plan owns the detailed v1 payload contract.

`init` carries `{ userId, projectId, expectedCommit }`. A Web Lock prevents two
editors from writing the same user/project IndexedDB partition. A failed lock or
initialization requires remounting the iframe. `ready` is emitted only after
restore completes and reports `{ buildCommit }`.

`insert-images` carries `{ docId, layerId, images: [{ blob, name }] }`. Null docId
explicitly creates a new document; null layerId inserts at root top. Images are
placed in result order from top to bottom, with contain scaling and no enlargement.
Existing documents receive one undo step; catchable failures restore the previous
snapshot. Requests with the same requestId reuse their response and never insert
twice. Limits: 8 images, 64 MiB encoded bytes, 16,777,216 pixels/image, 8192 maximum
edge, 33,554,432 total source pixels, and 67,108,864 for target pixels times image
count plus source pixels. These checks do not guarantee recovery from browser OOM.

`flush` waits for prior insertion and pending document saves, then persists the
session pointer. Normal `dispose` saves first and releases the lock only on
success; failed saves restore editing. `{ discard: true }` skips unsaved work and
is reserved for a host-confirmed discard. Downloads preserve the existing `.pkd`
format. Embedded mode disables offline/PWA setup and built-in AI commands/dialogs.
The static page's stale-SW recovery never runs in embedded mode.

## Development and validation

```sh
npm ci
pnpm dev
npm run build -- --base=/tools/pikado/
```

`pnpm dev` starts the VBD integration server at `http://127.0.0.1:5175/tools/pikado/`.
Keep dependency installation on `npm ci` and `package-lock.json`; running the dev
script with pnpm does not require migrating the dependency manager.
`pnpm-workspace.yaml` disables automatic dependency installation before scripts,
so newer pnpm versions do not create a second lockfile or change dependency versions.
On Windows PowerShell, use `npm.cmd` if `npm.ps1` consumes the `--` separator.
Stop fork dev/preview processes before a clean dependency install or production
packaging on Windows; their native Vite/Rolldown bindings otherwise remain locked.
Production builds record the actual full Git HEAD in both runtime and
`dist/pikado-version.json`; development reports `development`. The build record
contains `{ repository, commit, protocolVersion: 1 }`, and dist includes LICENSE.
Only build a clean, committed checkout for deployment.

Open `/tools/pikado/tests/embed.html` for the real iframe integration checks.
The default `case=smoke` creates a random test-only user/project namespace and
runs insertion, download, autosave, lock and failed-save recovery checks. After
success, use its `restore`, `other-project`, `other-user` and `version` links.
Each link opens one independent case with the same `run` identifier, and every
page creates just one iframe. Keep the origin unchanged between cases. The run
identifier is a disposable test namespace, not a credential; no real account is
used. Cases can also be opened as `?case=restore&run=<smoke-run-id>`. A missing
seed or unexpected successful version handshake is reported as a failure.

Verified on 2026-10-19 in desktop Chrome on Windows using a root-base Vite
server: smoke 14/14, restore 2/2, other-project 1/1, other-user 1/1 and version
1/1 passed (19 assertions total). The cases used one shared random run ID and
separate top-level pages, each with one iframe. Smoke included real `.pkd`
serialization/reopening and an injected encoding failure followed by recovery.
The existing full suite and new transaction tests run at `/tests/` with Vite's
default root base: some upstream fixtures use absolute `/tests/` and `/src/`
URLs, so start a separate root-base server for that suite. Reports are exposed as
`window.__pikadoEmbedTests` / `window.__pikadoEmbedTestsDone` and the existing
`window.__pikadoTests` / `window.__pikadoTestsDone`.

Projects are local browser data. Clearing browser storage loses them; users must
download `.pkd` backups. No cloud sync or collaborative editing is implemented.

## 简体中文界面

`src/i18n.js` 提供独立静态词典与精确匹配的 `t()`；未收录文案保留英文，
原型属性名也按未知文本处理。目前固定使用简体中文，不提供语言切换。
只在明确的界面标签、按钮和提示显示处调用翻译；通用 `el()` 不自动翻译。
用户文件名、工程名、图层名、文字内容、动态文件列表、表单值、枚举值、
命令 ID 和快捷键保持原样。运行时不依赖迁移来源目录。

覆盖菜单、面板、工具参数、滤镜、调整、图层效果、导出、快捷键、帮助和
运行提示。词典按范围放在 `src/i18n/`，由 `src/i18n.js` 汇总；动态提示
使用占位符，历史记录仅翻译显示，不改写已保存的操作名称。字体、色彩
配置文件、模型与品牌名、格式/单位缩写及用户内容保持原值。

独立边界测试入口为 `tests/i18n.html`（带部署前缀时为
`/tools/pikado/tests/i18n.html`）；完整套件同时包含这些测试。
首轮迁移时内置 Chromium/IAB 实测边界测试 44/44 通过，涵盖原型键回退、
用户名称与文字的 `.pkd` 往返、原始属性/选项值，以及创建名为 `Save` 的
工程。相同快照的嵌入五个 case 在 IAB 中共 19/19 通过；`npm run build`
成功（198 个模块）。

首轮迁移的 Chrome 完整回归共 279 个 suite：3111 项断言通过，1 项性能断言
失败（3 MP 画笔帧 57.2 ms，高于 50 ms 阈值），另有 1 个原有 HEIC
导出 suite 在当前硬件环境抛异常；未修改性能阈值或 HEIC 实现。
仅复跑一次后的结果仍为 3111 通过、1 项性能断言失败、1 个相同 HEIC
suite 异常；画笔帧为 56.4 ms（阈值仍为 50 ms）。两次中文边界断言均
全部通过，没有降低阈值或继续循环重试。

补齐中文覆盖后的最终 Chrome 回归：294 个 suite，3363 项断言通过、
0 项断言失败，另有上述既有 HEIC suite 异常；20 个中文 suite 的 295 项
断言及 6 个性能 suite 的 51 项断言全部通过。导出预览测试等待实际异步
更新并保留 5 秒超时，不依赖固定延时。最终构建成功（202 个模块），
嵌入五个 case 共 19 项通过，未更改阈值或依赖。

修改存储依赖后运行嵌入夹具前应重启开发服务，避免 Vite 热更新 URL 与
夹具直接导入 URL 形成不同模块实例。使用干净根路径服务运行完整测试；
常规 VBD 调试仍使用 5175 的部署前缀。当前改动未提交、未更新发布 pin。

## 宿主主题同步

嵌入 URL 的 `theme=light|dark` 是当前 iframe 生命周期的首屏快照，
仅在 `embed=1` 时生效；同步脚本先于样式绘制设置配色、`color-scheme`
和浏览器 `theme-color`。独立运行默认暗色，不新增主题存储或切换器。

初始化载荷可包含 `theme`；运行时通过现有协议发送单向 `set-theme`，
载荷为 `{ theme: 'light' | 'dark' }`，不需要 `requestId` 或响应。
通知遵循原有 origin/source/session/namespace/version 校验，加载期间
已收到的新主题优先于旧初始化值。非法主题和 dispose 后的通知被忽略。
主题通知不进入工程队列，不设置 inert、不保存、不改写工程或撤销记录。

默认强调色与中性画布背景跟随主题；与默认值不同的用户自定义颜色
继续保留。重置为默认颜色会释放内联覆盖。主题或偏好变化会刷新标尺、
曲线和角度控件的界面绘制，作品像素、实际取色、通道颜色及透明棋盘
保持原样。用户自定义颜色的对比度由所选颜色决定。

主题边界纳入 `tests/i18n.html`；干净服务下内置 Chromium/IAB 实测中文、
PSD 和主题共 329 项通过、0 失败、0 异常。`tests/embed.html?case=theme`
的 10 项协议边界和 smoke 的 14 项通过，覆盖首屏快照、加载期间切换、
连续切换、不保存/不改工程、非法来源/会话/主题及 dispose 后停止处理。
`npm run build` 成功（203 个模块）；本轮不提交、不更新 pin 或发布产物。
