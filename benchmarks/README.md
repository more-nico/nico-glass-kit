# 可复跑的玻璃渲染 Benchmark

## 日常与发布验证

`npm test` 运行快速单元测试；`npm run test:browser` 运行浏览器回归。
发布前统一运行一次 `npm run test:release`，包含类型检查、单元测试、浏览器回归、两个构建及打包后使用检查。
随后用 `npm pack --ignore-scripts` 打包，并发布同一份已验证的 tarball，避免生命周期钩子重复执行检查和构建。

浏览器用例共用初始化、页面异常检查和卸载清理检查。尺寸回归在 ResizeObserver 提交后、绘制前采样，覆盖
Medium/High 共享滤镜及 High 私有滤镜的连续宽高动画、共享所有权和弹性/悬停状态。
`resize.spec.ts` 负责动态尺寸；`transparency.spec.ts` 负责透明/半透明像素，不再重复检查动画停止后的尺寸。
`batching.spec.ts` 集中覆盖分组等价性和交互切换；`workers.spec.ts` 集中覆盖异步更新、过期任务和回退。
打包使用检查负责实际 tarball 的 ESM/CJS、Worker、无 Worker 回退和卸载，避免在单元测试中重复模拟。

以下性能实验按需运行，不属于每次发布的必跑项。`evidence*` 是已有报告对应的历史构建、截图和原始数据，
不是额外测试套件；历史打包脚本共用 `lib/evidence.mjs`，保留各轮构建校验及元数据，不能用当前构建覆盖旧证据。

## 性能实验

生产构建独立于 playground，避免开发模式、HMR、StrictMode 重复挂载与控制面板自身的更新干扰性能数据。视觉 fixture 使用确定性网格、彩色背景、嵌套玻璃和字形玻璃，没有外部图片或网络字体。

## 运行

```powershell
npm ci
npx playwright install chromium
npm run bench:build
npm run bench:serve
# 在另一个终端、同一仓库目录运行：
npm run bench:run -- baseline
```

默认每场景 3 次独立浏览器 context；预热 2.5 秒及同负载 1 秒，采样 5 秒。浏览器 context 每次关闭，浏览器进程在整个 suite 内复用。首次截图在预热负载之前、背景固定相位拍摄。默认 headless Chromium 启用 GPU；GPU 实际后端及 featureStatus 保存在 JSON。

`BENCH_BROWSER_PATH` 可指向现有 Chromium，避免下载。`BENCH_REPETITIONS`、`BENCH_DURATION_MS`、`BENCH_CASES`、`BENCH_URL` 可覆盖默认值；比较时两端必须一致。`BENCH_SOFTWARE_GPU=1` 使用 SwiftShader 测试软件渲染，不能等同于真实低端移动 GPU。

优化前保存完整构建，避免修改源代码污染基线：

```powershell
Copy-Item -LiteralPath .benchmark-dist -Destination .benchmark-baseline -Recurse
# 在第三个终端保持原版 server：
npx vite preview benchmarks --config benchmarks/vite.config.ts --outDir ../.benchmark-baseline --host 127.0.0.1 --port 4179 --strictPort
# 修改源代码、重新 bench:build 后：
npm run bench:run -- final
npm run bench:compare -- baseline final
# 可选：同一浏览器交替加载基线和优化版；每个 repetition 交换先后次序。
$env:BENCH_PAIR_URL='http://127.0.0.1:4179'
npm run bench:run -- matched
npm run bench:compare -- matched-baseline matched-optimized
```

## 固定场景

| 场景 | 表面数* | CSS viewport / DPR | 负载 |
|---|---:|---|---|
| idle-25 | 25 | 1440×900 / 2 | 静态 |
| animated-25 | 25 | 同上 | 背景按时间移动 |
| dense-100 | 100 | 同上 | 密集、多半径、不同高度、嵌套玻璃 |
| 4k-quality-25 | 25 | 3840×2160 / 1 | 高质量、贴图倍率 **0.5** |
| cpu6-dense-100 | 100 | 1440×900 / 2 | CDP **6 倍 CPU 降速** |
| group-pointer-100 | 100 | 同上 | 分组弹性、每帧 8 个 pointermove |
| resize-25 | 25 | 同上 | 确定性连续调整网格宽度 |
| scroll-250 | 250 | 同上 | 长页面、固定背景、往返滚动 |
| medium-100 | 100 | 同上 | medium 共享过滤器 |

\* 表面数为主网格数；额外每 9 个组件增加 1 个嵌套表面，并包含 9 个字形表面。除 medium 场景外，均使用 high；默认 `overLight='auto'`、默认 optics、弹性 0.2、贴图倍率 0.2，不自动降档。

## 指标含义与限制

- FPS 是 rAF callback 频率；p50/p95/p99 是 callback 之间的时间，包含排队等待，并非 GPU 内核耗时或物理显示扫描帧率。静态场景可能接近宿主刷新上限，不能用其 FPS 声称 GPU 吞吐量提高。
- `Performance.getMetrics` 的 TaskDuration / ScriptDuration / LayoutDuration / RecalcStyleDuration 给出页面主线程墙钟时间；CPU 降速时包含节流影响，可能因边界误差略超 100%。
- `SystemInfo.getProcessInfo` 的累计 CPU 秒差汇总整个专用浏览器进程树，除以采样时间及宿主逻辑核数，得到整机归一化 CPU 使用率；另存按单核归一化的值。
- Windows CIM 每秒采样专用浏览器 PID 的 working set、GPU engine 使用率及专用 / 共享显存。GPU 百分比取最忙的单个引擎，不能相加为“总 GPU 占用”。PID / 性能计数器不可用时记录 null，不能解读为 0%。这些采样有固定开销，两端均启用。
- JS heap 不包括所有 TypedArray / Canvas / GPU 内存；`retention.mjs` 额外强制 GC 后记录 `Runtime.getHeapUsage.backingStorageSize`、DOM 和事件监听器。32 MiB 是缓存保留预算，不是整页或浏览器总内存预算。
- 单台 Windows / 桌面 GPU 及 CPU 降速不能代表所有设备。驱动调度、温度、其他应用和 GPU 纹理池仍会造成波动，报告保留每次样本及没有改善的结果。
- 帧预算依据实测耗时，保留全部 9 个采样点并轮换队列。快速探测先检查本轮首点再整批完成，慢探测在点与点之间暂停；每帧重新建立 DOM 读取缓存。普通及续算时间片均为 6ms。检测到真实颜色 / 图片变化、class / 树结构变化或图片解码完成时，重启陈旧任务并给予最多 8ms 的优先时间片。每轮计入首个 hit-test / 样式刷新，并依据已测单点成本决定是否继续。跨帧采样仍会混合相邻时刻的背景，明暗决策可能延后。预算是软限制，无法抢占单次原生命中测试。折射滤镜质量及渲染频率不受这个调度限制。

## 回归、视觉与内存

```powershell
npm run test:browser
node benchmarks/retention.mjs
node benchmarks/visual-states.mjs
node benchmarks/compatibility.mjs
# 第二轮专项测试（两个 preview 保持运行）
node benchmarks/image-retention.mjs round2-memory
node benchmarks/image-working-set.mjs review-images # 同时可见 40 张图片，检查缓存反馈循环
node benchmarks/light-latency.mjs
npx vite-node benchmarks/glyph-benchmark.ts glyph-audit
```

浏览器回归包含 StrictMode、共享与私有滤镜、节点清理、悬停亮度、点击、弹性 / 高光、材质 scale、连续尺寸变化、DPR、明暗切换、字形和失败回退。UA 路由测试只验证路由逻辑；`compatibility.mjs` 另启动真实 Firefox / WebKit，可通过 `BENCH_FIREFOX_PATH` / `BENCH_WEBKIT_PATH` 指定已有可执行文件。WebKit 不等同于 macOS / iOS Safari 的设备实测。

比较脚本校验场景参数完全一致，输出左右并排图、RGB 像素差异统计及放大 8 倍的差异图。48 组 `fixtures/lens-pixels.json` 是优化前 `79b42b5` 的 SHA-256，逐字节冻结位移编码。微基准额外对 8 张 1920×1080、DPR 2 的 map 计算 FNV hash，防止跳过工作。

`visual-states.mjs` 在相同固定背景相位等待额外 1.5 秒，检查悬停、分组、字形、medium 和 100 表面的稳定状态，避免将光照过渡时序混入折射静态差异。

大尺寸 canvas、无限 / NaN 输入、失败编码会沿现有 CSS 回退，超过 64×1024×1024 物理像素的单张 map 在分配前拒绝。这个极端安全阈值不影响上述测试场景。

字形 EDT 同时使用多个距离场，单张字形阈值另设为 4×1024×1024 物理像素（含距离场边界），超过时组件显示可读文本。字形 PNG 缓存上限为 128 条 / 32 MiB；解码图片缓存为 32 条 / 64 MiB 估算软预算，允许保留一张超预算图片以避免解码循环。预算均不代表整页 RAM 或显存上限。

`fixtures/glyph-pixels.json` 是第二轮改动前冻结的 6 组像素、SDF、ring SHA-256。普通微基准不会写入 fixture；只有首次建立基线时才可设置 `FREEZE_GLYPH=1`，优化后不可重新生成期望值。

完整原始数据与全部 PNG 留在 `results/`（gitignored），第一轮关键证据在 `evidence/`，第二轮在 `evidence-round2/`。修改实现后应重新采集证据，不应沿用旧的截图或数字。`compare.mjs` 的第 3 个位置参数可指定输出目录；`visual-states.mjs`、`retention.mjs`、`compatibility.mjs` 的首个位置参数可指定输出目录，避免覆盖历史数据。

## 本次结果与冻结构建

最新结果见 [第二轮报告](report-round2.md)、[第二轮证据](evidence-round2/manifest.json)。第二轮以第一轮优化版为基线，在新的相同条件下交替复测，不将两次实验不同刷新上限下的 FPS 混用：

提交前审查还修复了同时可见图片超过 LRU 容量时的解码反馈循环；该修复发生在第二轮冻结后。当前源码的验证与补充数据见 [审查报告](report-review.md)。第二轮冻结构建继续保持原样，其数据不能作为修复后构建的重新测量结果。

```powershell
# 分别在两个终端启动
npx vite preview benchmarks --config benchmarks/vite.config.ts --outDir evidence/builds/optimized --host 127.0.0.1 --port 4179 --strictPort
npx vite preview benchmarks --config benchmarks/vite.config.ts --outDir evidence-round2/build --host 127.0.0.1 --port 4178 --strictPort
# 在第三个终端运行
$env:BENCH_PAIR_URL='http://127.0.0.1:4179'
npm run bench:run -- round2-audit
npm run bench:compare -- round2-audit-baseline round2-audit-optimized round2-audit-comparison
```

第一轮历史结果见 [第一轮报告](report.md)、[证据校验和](evidence/manifest.json)。以下命令提供该轮实际被测的两份冻结构建：

```powershell
# 分别在两个终端启动
npx vite preview benchmarks --config benchmarks/vite.config.ts --outDir evidence/builds/baseline --host 127.0.0.1 --port 4179 --strictPort
npx vite preview benchmarks --config benchmarks/vite.config.ts --outDir evidence/builds/optimized --host 127.0.0.1 --port 4178 --strictPort
# 在第三个终端进行交替复核
$env:BENCH_PAIR_URL='http://127.0.0.1:4179'
npm run bench:run -- audit
npm run bench:compare -- audit-baseline audit-optimized
```

`package-evidence.mjs` 仅打包第一轮固定目录，并在触碰历史证据前校验第一轮构建 hash；当前源码不能重新运行它来覆盖旧证据。`package-round2.mjs` 打包第二轮完整数据和实际被测构建。它们不运行测试；新实验应先重新采集并使用新目录及报告。

## 真实 playground 滚动基准（按需）

只保留一个生产页面回归：High、贴图倍率0.5、自动明暗下，以约3000px/s原生滚轮往返滚动。
交互、字形更新、尺寸、分组和清理由浏览器回归覆盖，不再自动运行35场景矩阵。
一次性截图和分组开关构建工具已删除；`results/`、`evidence*`、冻结像素及历史报告保留。

```sh
npm run build:playground
npx vite preview playground --host 127.0.0.1 --port 4190 --strictPort
# 另一个终端；默认5轮×20秒
npm run bench:playground
```

前后对照需要分别预览两份生产构建：

```sh
BENCH_URL=http://127.0.0.1:4190 BENCH_PAIR_URL=http://127.0.0.1:4191 npm run bench:playground
```

A为冻结基线，B为当前构建，每轮交换先后顺序。保持浏览器实验串行；无需改动历史构建。
在原生HiDPI主屏固定1800×1200 CSS内容视口的示例：

```sh
BENCH_BROWSER_PATH='/Applications/Microsoft Edge Canary.app/Contents/MacOS/Microsoft Edge Canary' \
BENCH_WINDOW_LEFT=30 BENCH_WINDOW_TOP=30 \
BENCH_VIEWPORT_WIDTH=1800 BENCH_VIEWPORT_HEIGHT=1200 BENCH_EXPECT_DPR=2 \
BENCH_URL=http://127.0.0.1:4190 BENCH_PAIR_URL=http://127.0.0.1:4191 npm run bench:playground
```

| 变量 | 默认 | 用途 |
|---|---|---|
| `BENCH_URL` / `BENCH_PAIR_URL` | `4190` / 无 | 当前构建与可选基线URL |
| `BENCH_BROWSER_PATH` | Playwright Chromium | 指定本机浏览器 |
| `BENCH_ROUNDS` / `BENCH_DURATION_MS` | `5` / `20000` | 轮数与每轮时长 |
| `BENCH_BACKGROUND` | `night` | `night`、`aurora`、`sunset`、`ocean`、`text` |
| `BENCH_WINDOW_LEFT` / `BENCH_WINDOW_TOP` | 无 / `25` | 真实窗口的桌面坐标 |
| `BENCH_VIEWPORT_WIDTH` / `BENCH_VIEWPORT_HEIGHT` | 无 | 同时设置以调整真实内容视口 |
| `BENCH_EXPECT_DPR` | 无 | 检查实际DPR；不匹配则失败 |
| `BENCH_FULLSCREEN` | `0` | 真实全屏，不能与固定视口同时设置 |
| `BENCH_RECORD_VIDEO` | `0` | 可选录屏，会增加测量开销 |
| `BENCH_HEADLESS` | `0` | 脚本诊断；不作为本机呈现验收 |
| `BENCH_LABEL` | `playground-scroll` | 新结果目录前缀 |

每轮保存原始Trace、rAF间隔、主线程指标、画质检查、截图和错误；全局保存浏览器/GPU、
视口/DPR、源码版本与构建hash。缺失或未终止的计数保留null，判失败；rAF不替代浏览器呈现。
`WheelScroll`按[Chromium口径](https://chromium.googlesource.com/chromium/src/+/lkgr/docs/speed/debug-janks.md)
统计，同名非重叠序列去重。吞吐推导值可能包含不完整内容；通过仍要求≥59fps、≤1%丢帧，
并要求完整计数且没有内容缺失。少于5轮/20秒或headless的运行标记为诊断，不能报告正式通过。

```sh
# 短跑仅检查脚本链路；指标解析器也只在维护基准时运行
BENCH_HEADLESS=1 BENCH_ROUNDS=1 BENCH_DURATION_MS=250 npm run bench:playground
npm run test:metrics
```

性能实验不进入`test:release`。历史M4结果见[性能报告](report-m4-60fps.md)，60fps目标未达成。
