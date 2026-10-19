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
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort --base /tools/pikado/
npm run build -- --base=/tools/pikado/
```

On Windows PowerShell, use `npm.cmd` if `npm.ps1` consumes the `--` separator.
Production builds record the actual full Git HEAD in both runtime and
`dist/pikado-version.json`; development reports `development`. The build record
contains `{ repository, commit, protocolVersion: 1 }`, and dist includes LICENSE.
Only build a clean, committed checkout for deployment.

Open `/tools/pikado/tests/embed.html` for the real iframe integration checks.
The existing full suite and new transaction tests run at `/tests/` with Vite's
default root base: some upstream fixtures use absolute `/tests/` and `/src/`
URLs, so start a separate root-base server for that suite. Reports are exposed as
`window.__pikadoEmbedTests` / `window.__pikadoEmbedTestsDone` and the existing
`window.__pikadoTests` / `window.__pikadoTestsDone`.

Projects are local browser data. Clearing browser storage loses them; users must
download `.pkd` backups. No cloud sync or collaborative editing is implemented.
