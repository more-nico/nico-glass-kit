# M4 最高画质优化：实现与未通过的验收

2026-10-22；分支 `codex/perf-m4-rendering`，基线 develop `7e5e51a`。

本报告保留本机实验记录；`results/` 下的原始数据、录屏与构建由本机保存，不随 GitHub 源码和 npm 包发布。

测试精简说明（2026-10-23）：当前仅保留 `npm run bench:playground` 原生滚动复跑入口。
历史交互矩阵、一次性截图和分组对照工具已移除；下文对应旧工具的数据及方法记录仍保留。
精简后 `npm run test:release` 通过：239个单元测试、27个浏览器测试、两个构建及打包使用检查，
日志见 `results/test-cleanup-release-20261023.log`。另有7个按需指标解析测试通过，
滚动脚本已完成headless短跑链路检查；该短跑不作为性能验收。库运行逻辑和生产构建hash保持不变。

**本轮实现已经落地，60fps 目标没有达成。** 原生快速滚动的呈现吞吐有改善，但丢帧、内容缺失和长卡顿仍严重。不能把本报告或新增分组 API 视为最高画质 60fps 保证。完整的全场景五轮验收也尚未完成。

**2026-10-23 状态：按用户要求停止继续优化，保留当前版本供体验。** 当前生产预览为 `http://127.0.0.1:4190`，构建 `index-BW72aZ4P.js`。该构建通过完整发布回归；最近完整五轮性能数据对应下述 `index-B9AsZLUv.js`，不把复审修正后的构建冒充为已重新完成性能验收。最后启动的分组单独对照被用户叫停，仅保留部分原始记录，不用于判断分组收益。

## 最新完成的 1800×1200、DPR 2 五轮对照

[原始结果](results/m4-1800-final-scroll-20261022T141406/summary.json)，真实普通窗口，固定内容视口1800×1200、原生DPR 2、Metal、High、倍率0.5、自动明暗；每端5轮×20秒，逐轮交替，不录制。优化构建为 `index-B9AsZLUv.js`。

| 指标 | 原 develop | 优化版 |
|---|---:|---:|
| 呈现吞吐推导值中位数 | 10.50fps | 15.67fps |
| 各轮范围 | 8.74–10.62fps | 14.20–18.84fps |
| 最差轮 dropped_v4 / expected | 72.58% | 66.91% |
| 已终止段的内容缺失比例 | 75.61% | 74.32% |
| rAF 中位数 | 13.20fps | 12.44fps |
| 主线程 task 忙碌比例中位数 | 11.04% | 8.70% |
| 达到验收的轮数 | 0/5 | 0/5 |

呈现吞吐中位数约提高49.2%，仍远未达到目标。它可能包含不完整内容；内容缺失子集不能替代缺失的全轮计数。High有效性检查全通过，终态约61–70个表面共享渲染。字形未就绪的rAF采样，基线各轮均0；优化版一轮1帧、其他四轮0帧，仍需处理动态新字符首次出现的准备时序。

此前同配置的[单轮连续输入诊断](results/m4-1800-worker-spinner-20261022T140439/summary.json) 使用 `index-BF9xQUUK.js`：曲率调节的辅助呈现约10.55→23.16fps，十字符字号约10.17→23.99fps；字形精确React提交约135ms。只覆盖了单轮、单个可测输入场景，不能证明所有输入在200ms内已呈现。

最终复审修正了嵌套分组弹簧引起父级逐帧重算、同元素组合动画挂起不恢复、异步贴图失败停留在旧预览、Worker运行失败后的可用性与回退调度，以及任务所有者和已提交参数的隔离。父级只在嵌套交互开始/结束时保守切换，期间忽略内部弹簧逐帧写入。**精简前复审时的完整 `npm run test:release` 通过：289个单元测试、14个指标测试、32个浏览器测试、库与playground构建、tarball ESM/CJS SSR及真实Worker/无Worker回退、尺寸和卸载检查。** 日志保存在 `results/m4-release-reviewed.log`。历史像素期望未修改，当时改动尚未提交或发布。

## 环境与方法

本机 Apple M4（10 核 CPU / 10 核 GPU）、16GB、macOS 27.0.1；Edge Canary 158.0.4354.0，ANGLE Metal Apple M4，Graphite 保持启用。生产预览使用原生最大化窗口，约 1792×996 CSS px、DPR 2，屏幕 60Hz。High、贴图倍率 0.5、自动明暗及默认折射/色散保持启用。所有浏览器实验串行执行。

A 是冻结的原 develop 生产构建，B 是优化构建。五轮逐轮 A→B、B→A 交替，原生 mouse wheel 约 3000px/s，持续至少 20 秒穿过实际 playground。保存每轮 viewport、画质有效性、rAF、主线程、Trace、截图和录屏。包含录屏的样本会有录制开销，另保留无录制诊断作为交叉检查。

后续窗口移动到另一台竖屏，产生了 1432×2446、DPR 1 的[一组数据](results/m4-delivery-verification-20261022T133938/summary.json)。这组数据**排除出 DPR 2 验收**。系统主屏仍有 HiDPI（逻辑 2560×1440、像素 5120×2880），此前仅凭 `CGDisplayPixelsWide` 判断所有屏幕为 DPR 1 不准确。用户随后指定按 **1800×1200** 继续，因此新基准固定主屏上的真实 **1800×1200 CSS 内容视口、原生 DPR 2**，记录为 `windowed-1800x1200`；它与旧最大化/全屏样本分别统计。脚本加入视口和 DPR 检查，既不强制浏览器 DPR，也不使用设备模拟代替原生渲染。

按 [Chromium 的 jank 调查方法](https://chromium.googlesource.com/chromium/src/+/lkgr/docs/speed/debug-janks.md) 分开分析 WheelScroll 与动画轨道。`FrameSequenceTrackerV3` 的真实数据结构兼容 BEGIN 上的 counters、空 END、并发 id2，以及未终止序列的嵌套 Frame 进度。具体行为参见 [Chromium 实现](https://chromium.googlesource.com/chromium/src/+/HEAD/cc/metrics/frame_sequence_metrics.cc)。

本文“呈现吞吐推导值”是 `(expected - dropped_v4) / 活跃序列秒数`，**仍可能包含内容不完整的呈现**，不能解释为完整效果的 fps。未终止尾段缺少 `missing_content` 时保留 null 并判失败，不以零代替。DevTools Presentation 瞬时事件另行按主进程 action 标记过滤、去重，仅提供辅助吞吐；它没有完整的缺帧/缺失内容计数。

## 已实现

- 可选 `GlassRenderGroup`，默认 div，支持标准属性、ref、`enabled`；内部玻璃字使用 span。相同光学参数的安全表面共享滤镜和解码后的位移图，保留每个组件原有染色、阴影、高光和内容。空间组初始限制 1024×512 CSS px，包围面积不超过成员面积之和的 1.8 倍，每组 atlas 保留预算 32MiB。
- 重叠、嵌套背景边界、绘制过的 wrapper、内部滚动/裁剪、不可证明等价的变换、隐藏表面和表面自身 padding/border 保留独立路径。悬停、弹簧、键盘按压及 CSS 几何动画先恢复独立滤镜；结束后重新合并。支持祖先纯 3D 平移，独立 scale/rotate/zoom 不能绕过检查。
- 分组采用先 detach/销毁旧归属、再 cover 新归属的顺序；同值滤镜属性不反复写入。私有滤镜可在保留 ID 的条件下更新光学图；共享私有条目仍保持 ownership 隔离。尺寸观察在 layout effect 订阅，关闭首次 ResizeObserver 被提前消费而产生 High 标签/CSS fallback 的竞态。
- 字形 coverage、距离场/法线、轮廓、光学像素和编码层拆开缓存。两只按需 Worker，每个所有者只保留最新待处理任务；旧 revision、卸载和旧缓存 epoch 的结果不能提交。传输缓冲区与回退输入分开，真实 transfer 后 Worker 失败仍能回退。同步生成 API 保持可用。
- 同档缓存字形逐字符适配新布局作为字号预览，后台精确结果一次提交全部字符。距离视口一屏以内提前生成精确贴图；远处不抢占可见字形的计算。字体族/字形不兼容时保留可读文本直到精确结果可用。
- 首次轮廓提前生成，避免首次快速滚入时才启动 Worker；只有已有兼容玻璃预览的屏幕外更新，才延后到一屏预热区生成精确结果。
- playground 画廊、控制面板安全分区和玻璃字接入分组，参数及拖拽输入按帧合并。FPS 行的内部 DOM 写入不再触发全局急迫重采样；明暗采样保持完整九点与权重，普通/续算 6ms、急迫 8ms，计入首点成本并公平轮换。固定背景、sticky 和内层滚动继续保守重采样。

## 第一阶段五轮原生滚动结果（含录制）

数据：[完整结果与录屏](results/m4-final-native-20261022T130031/summary.json)。

| 指标 | 原 develop | 优化版 |
|---|---:|---:|
| 每轮呈现吞吐推导值中位数 | 17.73fps | 27.94fps |
| 每轮吞吐范围 | 11.43–18.57fps | 25.22–30.32fps |
| 最差轮 dropped_v4 / expected | 65.73% | 46.08% |
| 已终止段的内容缺失累计比例 | 66.85% | 70.49% |
| rAF 中位数（含录制） | 12.19fps | 11.94fps |
| 主线程 task 忙碌比例中位数 | 9.55% | 7.15% |
| 画质有效性检查失败 | 0 | 0 |
| 达到验收的轮数 | 0/5 | 0/5 |

吞吐中位数提高约 58%，**内容缺失没有改善，rAF 也没有改善**。已终止段的比例只代表可取得完整 counters 的子集，不是全轮缺失内容比例；全轮尾段未结束，故原始结果仍是 null。不能从子集推算通过。

终态约 132 个 High surface 中，优化版约 61–63 个使用共享渲染，实际独立 backdrop 绘制点减少。私有 SVG filter 保留供即时回退，故 SVG 节点总数并未减少；不能用 filter 节点数量代表 GPU 绘制次数。

无录制的早期 20 秒交叉诊断约 17.47→26.48fps，仍失败：[原始记录](results/m4-native-20s-20261022T125533/summary.json)。

[全屏单轮20秒诊断](results/m4-fullscreen-diagnostic-20261022T132005/summary.json) 的实际 viewport 为 1792×1113、DPR 2，约 14.94→27.07fps，仍失败。开发模式另做了[单轮5秒诊断](results/m4-development-diagnostic-20261022T132327/summary.json)，约 19.53fps，仍失败。这些数据没有混入生产最大化五轮统计。

## 安全修复后的五轮原生滚动（无录制）

[安全修复构建的五轮结果](results/m4-final-clean-20261022T133011/summary.json)，原生最大化、DPR 2、每轮20秒，JS 为 `index-60SviWdj.js`。

| 指标 | 原 develop | 优化版 |
|---|---:|---:|
| 每轮呈现吞吐推导值中位数 | 17.75fps | 25.24fps |
| 每轮吞吐范围 | 15.68–19.67fps | 24.02–25.81fps |
| 最差轮 dropped_v4 / expected | 57.87% | 46.38% |
| 已终止段的内容缺失累计比例 | 67.30% | 71.57% |
| rAF 中位数 | 12.76fps | 15.89fps |
| 主线程 task 忙碌比例中位数 | 10.34% | 6.56% |
| 达到验收的轮数 | 0/5 | 0/5 |

画质有效性均通过，终态约17–19个表面合并。该版本屏幕外字形第一次靠近时才计算，快速滚动有2–5个采样帧的玻璃轮廓未就绪。随后改为首次轮廓提前生成；该变化对应 `index-BS-GSQK8.js`，后者的 DPR 1 样本不能用来证明已通过 DPR 2 内容完整性验收。五轮数据没有被改名为当前构建的测量。

## 分组独立收益与连续输入

[同一优化源码的分组对照](results/m4-group-controlled-20261022T130734/summary.json)：仅关闭 playground 分组约 21.48fps，启用约 29.77fps（单轮、20秒、不录制）。因此保留分组接入，但这个样本没有证明 60fps 或缺失内容达标。可用 `node benchmarks/build-playground-variant.mjs` 重新构建仅 `enabled=false` 的对照。

[12 秒连续输入诊断](results/m4-interaction-diagnostic-20261022T125217/summary.json)：十字符场景 rAF 约 13.69→31.58fps，最后一次字形精确提交约 102ms。综合光学滑杆在慢设备上没能覆盖全部参数，且当时的收敛统计包含屏幕外字形，不能用于证明全部光学参数 200ms；后续脚本改为每个参数单独一个场景，并只读取可见字形。200ms 记录衡量 React 精确提交，不等同于 GPU 已呈现或 PNG 已完全解码。

## 全场景短诊断

[35 场景、70 个样本](results/m4-matrix-diagnostic-20261022T130909/summary.json) 覆盖五种背景×面板展开/收起×默认/Vivid 共 20 组合，另含逐参数、内层滚动、hover/拖拽、Dock 与十字符字号。每端仅 1 轮×3秒，不属于正式验收。70 个样本的 High 有效性检查均通过；全部原生滚动组合仍失败，部分短样本还有倒退（例如 text 背景、收起面板）。不同背景不能只报一个整体提升数。

逐参数的主进程 Presentation 辅助吞吐约为：blur 15.0→29.8、saturation 27.4→39.6、brightness 30.7→41.6、refraction 13.1→33.0fps；Dock 约 48.8→56.1，hover/拖拽约 45.7→48.4。它们缺少完整的缺帧/内容缺失计数，均未验收。唯一可读取的本轮可见字形精确提交约 79.4ms；原始汇总把它标为 preview pass，后续脚本已修正为按覆盖率报告 partial，不能认为所有调参均在 200ms 内呈现。

## 视觉与兼容性

[首轮五背景、三个滚动位置的前后截图、差分](results/playground-visual-1792673399060/results.json) 保存在独立目录。大部分状态全画面平均通道差小于 0.1/255；个别位置约 1.49/255，主要可见差异包括固定导航的自动明暗状态。

随后使用最终构建、5秒稳定等待复查了差异较大的 aurora 以及 night 的 1800/4400 位置：[复查结果、明暗状态和3倍边缘图](results/playground-visual-1792675304707/results.json)。平均通道差约 0.009–0.067/255，导航最终明暗一致；人工检查时钟边缘基本一致。1.5秒时出现的差异在稳定后消失，但相同时间点的加载/明暗变化过程仍未全面验收。所有嵌套及动画状态尚未做完整截图矩阵，不能声称已全面视觉验收。

冻结的位移图/字形像素测试没有改期望；透明背景、色散、连续尺寸变化、hover 私有归属和 Low 回落仍通过浏览器回归。`npm run test:release` 已包含发布 tarball 的 ESM/CJS SSR、真实内嵌 Worker、无 Worker 回退、尺寸变化和卸载清理检查。

## 证据与复跑

基线冻结在 [baseline](results/m4-60fps/baseline/manifest.json)。主结果目录的旧 `build.json` 因 Node fetch 把本地 4190 视为 forbidden port 而记录了 hash=null；保留原文件，并补 [显式 HTTP 采集的构建证明](results/m4-final-native-20261022T130031/build-supplement.json)。优化 JS `index-Ce9XPaT-.js`、CSS `index-FQW0Pjhg.css` 在这些测量之间保持相同；完整构建 hash 为 `8a1ad848ec408e488027b44df274f55e84be7e74eb841c7f1207963ad9ea8984`。新采集器已修复该元数据问题。

```sh
npm run test:release
npm run build:playground
# 两个终端分别预览优化版与冻结基线
npx vite preview playground --host 127.0.0.1 --port 4190 --strictPort
npx vite preview playground --outDir ../benchmarks/results/m4-60fps/baseline/build --host 127.0.0.1 --port 4191 --strictPort
# 第三个终端执行；默认全部场景、5轮×20秒，需要较长时间
BENCH_BROWSER_PATH='/Applications/Microsoft Edge Canary.app/Contents/MacOS/Microsoft Edge Canary' \
BENCH_URL=http://127.0.0.1:4190 BENCH_PAIR_URL=http://127.0.0.1:4191 npm run bench:playground
```

当前脚本默认只重跑五轮原生滚动；`BENCH_FULLSCREEN=1` 请求全屏，实际 viewport/DPR 以样本为准。短诊断显式设置 `BENCH_ROUNDS` 和 `BENCH_DURATION_MS`。录屏用 `BENCH_RECORD_VIDEO=1`，应与不录制结果分开。

## 未完成与后续工作

1. 最高画质快速滚动 59fps、≤1% 丢帧/不完整帧及无持续卡顿均未达成。
2. 所有背景×面板×材质、悬停/拖拽、Dock、各光学参数及十字符字号的完整五轮×20秒验收未完成；短测不能替代它。
3. 全屏和开发模式的单轮诊断不替代完整重复验收，不能与生产最大化结果混合。
4. 全部可见光学调参及字号的 200ms 精确且已呈现收敛，尚未建立完整证据。
5. 固定导航的稳定终态差异已经复查消失；加载期间的时间过程及嵌套/交互/连续尺寸终态的完整截图矩阵仍需完成。
6. Trace 仍有 IOSurface / Dawn 提交调度等待；降低 JS 成本尚不能解决 GPU 侧的帧预算。下一步应对同一 Metal/Graphite 后端分离实验渲染面积、提交次数和光学 pass 成本，并继续验证不改变视觉的渲染架构。不能通过降低 DPR、倍率、色散或改 Low 来宣称达标。

原有工作区改动、历史 evidence 和冻结基线保留。实验输出与生成构建留在 gitignored results/dist，不提交到源码仓库。

最终安全复审另外关闭了挂起期间异步 atlas 重新 cover 的竞态，收紧了文本输入的键盘处理，按真实 Animation 实例的运行状态恢复分组，并补了失败 mask 缓存及 epoch 清理保护。第一阶段与短矩阵使用 `index-Ce9XPaT-.js`，不把它们冒充为安全修复后的构建。

后续补齐圆角表面光学贴图的 Worker 路径，复用同一个两 Worker 池；radius/edge/curvature 更新保留原精确图作为同档预览，旧 revision 和不匹配的尺寸/参数禁止提交。首次贴图及尺寸/DPR/贴图倍率变化仍按约束同步生成，折射强度和滤镜参数直接更新图结构，不提交多余任务。异步精确提交驱动表面刷新，通知分组重新准备 atlas；新增真实浏览器的延迟任务、atlas 刷新和同步尺寸回归。因此“所有贴图计算都已移出主线程”和“所有连续光学输入都已在 200ms 内呈现”仍不能成立。

分组覆盖率下降另查明一个原因：画廊内容内持续旋转的图标使整个画廊一直挂起。现已只对会影响背景层或布局的动画挂起，保留内容图标不触发全组退出；布局动画结束仍恢复分组。嵌套表面与跨组障碍仍采用保守独立渲染，全文档障碍检查也有进一步减少成本的空间。

缓存预览复用已有轮廓，在大幅放大字号时仍需完整的视觉验收；不能仅因仍使用 High 滤镜，就认为预览的每个边缘像素与精确结果相同。
