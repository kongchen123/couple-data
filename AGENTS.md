# AGENTS.md — 情侣小站 AI 操作手册

> **给 AI 编码助手看的文件。目标：用最少的读取精确定位，避免改错返工。**
> 改代码前先读完本文。行号基于 **index.html 当前 4003 行版本**（sha256 `E4C56C3B…`）。
> 行号会随修改漂移 —— 优先用「章节标题」配合 `search_files` 定位，行号只作粗略参考。

---

## 0. 30 秒速览（先看这段）

| 项目 | 值 |
|---|---|
| 形态 | 单文件 PWA，**无构建、无框架、无依赖、无 node_modules** |
| 主文件 | `index.html`（4003 行 / 230 KB，CSS + HTML + JS 全在里面） |
| 数据 | localStorage 本地优先 + GitHub Contents API 云同步 |
| 二进制 | 照片/语音存 GitHub 仓库，本地用 IndexedDB 缓存 Blob |
| 运行宿主 | 手机浏览器 / PWA，且**可能运行在「无思」平台内**（有 `wusiFetch`/`wusiStorage` 桥接） |
| 改完怎么验 | 见 §9 清单，**每一条都对应一个真实会踩的坑** |

**三个最容易犯的错**（详见 §7）：
1. 改了函数名却没改内联 `onclick` → 点击静默失败，**不报错**
2. 绕过 `commit()` 直接改 `S` → 数据不落盘、不上传
3. 新增文件没同步 `sw.js` 的 `SHELL` → 离线白屏

---

## 1. 仓库当前状态（重要，2026-11 变更）

仓库 `kongchen123/couple-data` 已经**清空数据，只保留前端外壳**：

```
.gitignore
README.md
index.html              ← 全部代码
manifest.webmanifest
sw.js
icons/icon-180.png
icons/icon-192.png
icons/icon-512.png
```

**已删除**（数据迁往私有仓库 `couple-data-private`）：
`couple-data.json`、`photos/`、`voices/`、`data/couple.json`、`undefined`、`.github/workflows/remind.yml`

⚠️ **注意这个不一致**：`index.html` 里 `DEFAULT_GH.repo` 仍是 `'couple-data'`（公开仓库），
并没有指向 `couple-data-private`。所以：

- 数据文件删除后不会被自动恢复，**但任何设备一旦触发同步，就会在公开仓库重新创建 `couple-data.json`**
- 这是已知待处理项，动手前先确认当前意图，**不要擅自改这个常量**

另外 `couple-data-private` 是**私有**仓库，需要 token 才可读；仓库内的 `remind.yml`（Bark/ntfy 通知）
也已随之迁过去，Secrets 需要在新仓库单独配置。

---

## 2. 文件清单

| 文件 | 作用 | 改动频率 |
|---|---|---|
| `index.html` | **全部代码**。CSS(L20-524) + HTML(L540-876) + 农历脚本(L876-1076) + 主逻辑(L1077-4000) | 高频 |
| `sw.js` | Service Worker 离线壳。**改文件名/加文件必须同步 `SHELL` + 升 `VERSION`** | 低频 |
| `manifest.webmanifest` | PWA 清单（名称/图标/主题色） | 极低频 |
| `icons/icon-{180,192,512}.png` | 应用图标 | 极低频 |
| `.gitignore` | 当前只有 `data/` 一行 | 极低频 |
| `AGENTS.md` | 本文件 | — |

---

## 3. index.html 代码地图

### 3.1 顶层区块

| 行号 | 区块 | 说明 |
|---|---|---|
| 20–524 | `<style>` | **CSS 全部在这里**。设计变量在 L21 起的 `:root`（共 4 个 `:root` 块） |
| 540–876 | HTML 骨架 | 8 个 `<section class="page">` + 全部弹层 |
| 876–1076 | `<script>` #0 | **农历算法独立脚本**（约 6.5 KB），纯函数零 DOM |
| 1077–4000 | `<script>` #1 | **主逻辑**（约 136 KB），327 个函数 |

### 3.2 八个页面（`<section class="page" id="page-xxx">`）

| 行号 | id | 标题 | 层级 |
|---|---|---|---|
| 540 | `page-home` | 情侣小站 | 一级（tabbar） |
| 574 | `page-timeline` | 时间线 | 一级（tabbar） |
| 581 | `page-wishes` | 心愿 | 一级（tabbar） |
| 608 | `page-capsule` | 时间胶囊 | 一级（tabbar） |
| 622 | `page-voice` | 语音留言 | 二级（从「更多」进） |
| 634 | `page-period` | 经期记录 | 二级 |
| 664 | `page-more` | 更多 | 一级（tabbar） |
| 688 | `page-settings` | 设置 | 二级 |

路由表在 L3784–3787：`PAGE_TAB` / `PAGE_TITLES` / `SUB_PAGES`。tabbar 有 5 个按钮
（`data-p` = home / timeline / wishes / capsule / more）。

### 3.3 主逻辑分区（行号 + 分区注释原文）

| 行号 | 分区 | 核心函数 |
|---|---|---|
| 1079 | 数据层 | `S`、`defaultData()`、`persist()`、`meta`、`saveMeta()`、`mirrorCache()` |
| 1213 | 自制日期选择面板 | `dp*`（9 个）：`dpPick`/`dpGoToday`/`dpShift`/`dpYmShift`… |
| 1306 | 弹层栈（返回键/Esc 先关弹层） | `ovPush`/`ovPop`/`ovCloseTop`/`ovFocusables` |
| 1366 | GitHub Contents API | `ghCfg`/`ghGet`/`ghPut`/`ghPutBinary`/`ghDelete`/`ghGetBinary`/`ghUrl` |
| 1450 | 同步（本地优先） | `buildPayload`/`importData`/`schedulePush`/`flushPush`/`pullLatest`/`markPushOk` |
| 1608 | 云端孤儿照片延迟回收 | `gcOrphans`、`ORPHAN_GRACE_MS`(3天)、`ORPHAN_BATCH`(5) |
| 1672 | 通用 add/del（墓碑模式） | `RENDERERS`、`commit`、`addListItem`/`delListItem`、`showUndo` |
| 1721 | 首页 | `renderHome`、值得期待的日子翻页、`onSwipe` |
| 1838 | 照片墙 | `renderWall`、`compressToTarget`、`onWallChange`、多选删除 |
| 1978 | 今日情话 | `renderQuote`、在线接口 + `QUOTES` 本地兜底、`coupleQuoteCache` |
| 2055 | 时间线 | `renderTimeline`、发布/编辑/搜索/标签、`itemPhotos` |
| 2556 | 灯箱 | `lb*`（6 个）：双击/双指缩放、拖动、左右切换 |
| 2672 | 上传进度条 | `showUpload`/`updateUpload`/`hideUpload`/`cancelUpload` |
| 2678 | 时间线动作面板 | `openActionSheet`/`closeActionSheet`（长按或 ⋯） |
| 2819 | 心愿 | `renderWishes`、标签筛选 `wishFil` |
| 2905 | 时间胶囊 | `renderCapsules`、`blurText`（未解锁打码） |
| 2926 | 语音留言 | MediaRecorder 录音、`voiceStore` 三级缓存、播放进度 |
| 3269 | 经期记录 & 预测 | `renderPeriods`、`invalidatePeriods`、`validPeriods`、`nextPeriod` |
| 3504 | 设置 | Token / 仓库配置 / 缓存统计 / 导出 |
| 3721 | 本地缓存状态展示 | `refreshCacheUI`、`renderSetupHint` |
| 3782 | 路由 & 渲染 | `go()`、历史栈、`renderAll()`、FAB、下拉刷新、滑动切页 |
| 3852 | 滚动容器定位 | `saveScroll`/按页记忆（`display:none` 会丢滚动位置） |
| 3867 | 通用下拉刷新 | 时间线/心愿/胶囊/经期共用 |
| 3913 | 左右滑动切换页面 | 触摸手势 |

### 3.4 弹层与遮罩 DOM id（改动 UI 时必查）

`toast`(L787) · `cfMask`/`cfPanel`/`cfMsg`/`cfOkBtn`(L789-794 确认框) ·
`undoToast`(L799 撤销条) · `asMask`/`asPanel`/`asTitle`/`asList`(L801-804 动作面板) ·
`lightbox`/`lbClose`/`lbCount`/`lbPrev`/`lbNext`/`lbDel`/`lbZoomTip`(L838-845) ·
`dpMask`/`dpPanel`/`dpTitle`/`dpYm`/`dpGrid`(L848-865 日期面板) ·
`fab`(L786) · `uploadBar`(L785) · `wallSelBar`(L784) · `syncDot`(L534) · `syncState`(L742)

---

## 4. 命名前缀速查

函数总数 327。按前缀能直接猜出所属模块：

| 前缀 | 数量 | 模块 | 前缀 | 数量 | 模块 |
|---|---|---|---|---|---|
| `render*` | 25 | 各页渲染 | `dp*` | 9 | 日期选择面板 |
| `tl*` | 16 | 时间线 | `lb*` | 6 | 灯箱 |
| `del*` | 9 | 各类删除 | `gh*` | 7 | GitHub API |
| `lunar*` | 7 | 农历换算 | `ov*` | 4 | 弹层栈 |
| `save*` | 6 | 保存（含 `saveRepoCfg`/`saveGhToken`） | `sync*`/`push*`/`pull*` | 3 | 同步 |
| `add*` | 6 | 新增 | `pick*` | 6 | 标签/筛选选择 |
| `toggle*` | 6 | 开关/勾选 | `wall*` | — | 照片墙 |
| `wish*` | — | 心愿 | `cap*` | — | 时间胶囊 |
| `per*`/`cal*` | — | 经期/日历 | `cf*` | — | 确认框 |
| `voi*`/`voice*` | — | 语音 | `show*`/`hide*` | 8 | 提示/进度显隐 |

**通用约定**：渲染函数统一 `renderXxx()`；数据变更**一律**走 `commit(...keys)`；
列表增删用 `addListItem` / `delListItem`。

---

## 5. 数据契约

### 5.1 列表字段注册表（单一入口）

```js
// index.html L1083
const LIST_FIELDS = ['timeline', 'wishes', 'capsules', 'voices', 'customDays', 'periods', 'wall', 'trash'];
```

**新增列表型数据字段，只改这一行** —— `buildPayload()` / `importData()` / `hasUserData()`
会自动覆盖。但还要补：`defaultData()` 里加空数组、对应 `renderXxx()`、`RENDERERS` 映射。

### 5.2 全局状态 `S` 结构（`defaultData()` L1090）

```js
{
  name1: '', name2: '',              // 两人名字
  anniversary: '',                   // 纪念日 'YYYY-MM-DD'
  birthday1: null, birthday2: null,  // 农历对象 { m:1-12, d:1-30, leap:bool }，不是字符串！
  me: 1 | 2,                         // 本机是谁：defaultMe() = isAndroid() ? 1 : 2
  tags: [],                          // 自定义标签（对象数组，见下）
  periodCfg: { cycle: 28, len: 5 },  // 经期周期/长度
  // ↓ 由 LIST_FIELDS 管理
  timeline: [], wishes: [], capsules: [], voices: [],
  customDays: [], periods: [], wall: [], trash: [],
  lastSyncAt: 0, syncError: ''
}
```

### 5.3 各实体字段（**依据实际构造代码，勿凭记忆**）

所有列表元素共有：`id`、`createdAt`、`updatedAt`、`deleted`（墓碑）

| 集合 | 字段 | 构造位置 |
|---|---|---|
| `timeline` | `author, text, tag, photo(第一张), photos[](全部), date, time, pw, ph` | L2457 |
| `wishes` | `text, tag, done` | L2899 |
| `capsules` | `author, text, unlockAt` | L2921 |
| `voices` | `by, audio, mime, duration` | L3125 |
| `periods` | `start, end`（`end` 空串=单日） | L3344 |
| `wall` | `photo` | L1917 |
| `customDays` | `name, date` | L3767 |
| `trash` | `path, at`（孤儿照片回收队列） | L1701 |
| `tags` | `id('tag:'+名), name, deleted, updatedAt` | `normalizeTags()` |

⚠️ **三个易错点**（旧文档写错过，这里以代码为准）：
- `capsules` 用 **`unlockAt`**，不是 `date`；`unlocked` 是渲染时**派生**的，不存储
- `voices` 用 **`duration`**，不是 `seconds`
- `timeline` 用 **`photos` 数组**存多图，`photo` 只是第一张的镜像（兼容旧数据）。
  读图请用 `itemPhotos(t)`（L2462），它同时兼容两种形态

### 5.4 本地存储键

| 键 | 常量 | 内容 |
|---|---|---|
| `coupleStationData` | `KEY` | 整个 `S` 的 JSON |
| `coupleGithubConfig` | `GH_KEY` | `{owner, repo, token, branch}` |
| `coupleRemoteSha` | `SHA_KEY` | 云端文件 sha（换仓库必须清） |
| `coupleStationMeta` | `META_KEY` | `{pendingPush, lastPullAt, pullState}` |
| `coupleStationCache` | `MIRROR_KEY` | 无思私有存储镜像备份 |
| `coupleQuoteCache` | `QUOTE_CACHE_KEY` | 今日情话缓存 `{date, text, from}` |
| `coupleTlDraft` | 字面量 | 时间线草稿 |
| `coupleSetupDismissed` | 字面量 | 引导提示已关闭 = `'1'` |

### 5.5 IndexedDB

| 库名 | store | 上限 |
|---|---|---|
| `couplePhotoCache` | `blobs` | 60 条 / 20 MB，按 `savedAt` 淘汰 |
| `coupleVoiceCache` | `blobs` | 同上策略 |

`createBlobStore(dbName, label)` 封装（L~2060），返回 `{get, put, del, entries}`。
IndexedDB 不可用时自动降级（`dbDisabled`），不会抛错。

---

## 6. 同步机制（改这里最容易数据错乱）

### 6.1 写入链路

```
用户操作 → commit(...keys)
              ├─ persist()          写 localStorage + mirrorCache() + saveMeta()
              ├─ invalidatePeriods() 经期缓存失效
              ├─ RENDERERS[key]      按 key 局部重渲染
              └─ schedulePush()      标记 pendingPush，2 秒防抖
                     └─ flushPush()  → ghPut('couple-data.json')
```

### 6.2 冲突处理

`flushPush()` 捕获 **HTTP 409 / 422** 时，会重新 `ghGet` → `importData` 合并远端改动 → 重试上传。
**这一步不能省**，否则会覆盖对方刚写入的数据。

### 6.3 合并规则

- `importData(d)` 先 `JSON.stringify` 前后对比，**只有真变化才** `persist()` + `renderAll()`
  （避免定时拉取打断用户正在输入的内容）
- `mergeList(local, remote)`：按 `id` 建 Map，**`updatedAt` 大的胜出**；所以每次改数据必须
  `touch(obj)` 更新时间戳
- `birthday1/2` 兼容旧公历字符串 → `normalizeBirthday()` 统一转农历对象
- `tags` 兼容旧字符串数组 → `normalizeTags()` 统一转对象

### 6.4 平台桥接（项目特有，勿删）

```js
netFetch  → 优先 window.wusiFetch，回退原生 fetch
wusiStorage → 存在时启用 mirrorCache() 镜像备份
```
`hasWusiStorage()` 会同时校验 `getItem`/`setItem`/`getAll` 三个方法都存在。

---

## 7. 硬约束（违反会静默出 bug）

1. **108 处内联 `onclick="xxx()"` 依赖函数是全局的**
   → 不能改成 ES module；重命名/删除函数前必须全局搜索 `onclick=` 和模板字符串里的引用。
   **写错函数名不会报错，只是点击没反应。**
2. **新增/改名文件 → 必须同步 `sw.js` 的 `SHELL` 数组并升 `VERSION`**（当前 `v1`），
   否则离线白屏。`SHELL` 现有 6 项：`./`、`./index.html`、`./manifest.webmanifest`、三个 icon。
3. **GitHub Token 只存 localStorage**，任何情况下不得写进代码或提交到仓库。
4. **照片删除走墓碑 + `S.trash` 回收队列，不立即删云端文件**：
   `ORPHAN_GRACE_MS` = 3 天宽限（撤销窗口 + 对方设备可能还在用），`gcOrphans` 每批最多 5 个。
5. **`commit()` 是数据变更唯一收口**（L1685，箭头函数，不是 `function commit`）：
   `persist()` → 重渲染 → `schedulePush()`。绕过它 = 数据不落盘、不上传。
6. **跨域请求不走 Service Worker**（`sw.js` 里 `url.origin !== self.location.origin` 直接 return），
   别往 sw.js 加照片/API 缓存。
7. **`renderWho()` 回填输入框时避开 `document.activeElement`** —— 改设置页要保持，
   否则后台同步会打断用户输入。`renderRepoCfg()` 也有同样处理。
8. **改 `periods` 后必须让经期缓存失效**：`commit` 内已自动调 `invalidatePeriods()`；
   绕过 `commit` 就要手动调。
9. **单文件共享作用域，`const` 不能重复声明** —— 重复直接抛 `SyntaxError`，整个页面白屏。
10. **换仓库后必须清 `SHA_KEY`**（`saveRepoCfg` 已处理）：
    拿旧 sha 去写新仓库，GitHub 必然返回 409。

---

## 8. 常见任务最短路径

| 任务 | 只读这些就够 |
|---|---|
| 改配色/主题 | `index.html` L21–60（第 1 个 `:root`，注意共 4 个） |
| 加列表型数据字段 | `LIST_FIELDS`(L1083) → `defaultData()`(L1090) → `renderXxx()` → `RENDERERS`(L1674) |
| 加新页面 | 仿 `page-voice`：加 `<section class="page">` → `PAGE_TITLES`/`SUB_PAGES`/`PAGE_TAB`(L3784) → `renderXxx()` → `RENDERERS` |
| 改同步逻辑 | L1450–1607 |
| 改照片压缩 | `compressToTarget`(L1841)：长边 1600px、目标 260 KB、质量下限 0.55 |
| 改照片/语音缓存 | L2060–2290（`createBlobStore` / `trimPhotoCache`） |
| 改农历 | L876–1076 独立脚本；`LUNAR_INFO` base64 是 **821 字符超长行**，用 offset 分段读 |
| 改情话 | `QUOTES`(L1084) |
| 改经期预测 | L3269–3500 |
| 改路由/手势 | L3782–4000 |

---

## 9. 改完怎么验（逐条打勾，不要跳）

> 每一条都对应一个**真实踩过的坑**。没验证就交付 = 返工。

### 9.1 语法层

- [ ] 抽出 `<script>` 用 `node --check` 逐个验证（两个 script 各自独立检查）
- [ ] 无重复 `const` 声明（单文件共享作用域，重复直接白屏）
- [ ] 浏览器控制台无报错

### 9.2 功能层

- [ ] 8 个页面都能切换，标题/返回键正确
- [ ] **所有内联 `onclick` 引用的函数都存在**（可用正则提取 `onclick="([^"]+)"` 后逐个比对）
- [ ] 每个页面渲染出预期内容（有空数据也不该空白）
- [ ] 新增/删除/编辑各走一遍，`commit()` 有被调用
- [ ] 删除有 5 秒撤销；带照片的删除进了 `S.trash`

### 9.3 数据层

- [ ] 改动后刷新页面，数据还在（`persist` 生效）
- [ ] 两台设备/两个浏览器都同步，能看到对方改动（`schedulePush` 生效）
- [ ] 断网时改动不丢，联网后自动补传（`pendingPush` 生效）
- [ ] 模拟并发写（两边几乎同时改）不丢数据（409 重试合并生效）

### 9.4 资源与 PWA

- [ ] 新增/改名文件已同步 `sw.js` 的 `SHELL`，`VERSION` 已升
- [ ] 强制刷新（Ctrl+F5）后仍是新版，没被 SW 缓存住旧页面

### 9.5 安全

- [ ] Token 未出现在任何代码、注释、日志、提交里
- [ ] 输出到 `innerHTML` 的用户内容走了 `esc()` 转义

### 9.6 视觉回归（改动涉及 CSS/模板字符串时必做）

- [ ] 改动前后用浏览器**逐元素比对计算样式与几何位置**，而不是肉眼看截图
      （曾经因为只比文本 diff，漏掉 `:root` 变量被拆坏、整站配色失效的问题）

---

## 10. 工具箱

**读取超长行**（工具会截断，这是真实痛点）：

| 位置 | 长度 | 说明 |
|---|---|---|
| L19 | 526 | favicon data URI（`<link rel="icon">`） |
| L891 | **821** | 农历 `LUNAR_INFO` base64 数据表 —— 最长的行 |
| L2322 | 570 | 时间线卡片模板字符串 |
| L335 | 556 | `.fab` CSS |
| L2914 | 544 | 时间胶囊条目模板 |
| 其余 | 200–450 | CSS 46 条 + JS 模板串，见下 |

当前 **> 200 字符的长行共 66 条**（CSS 46 条 + JS 20 条）。
读这些行请用 `read_file` 配 `offset` + `limit` 分段，或直接用 `search_files` 定位关键词。

**改动验证的可靠做法**：
1. `node --check` 验语法（从 HTML 里抽出 script 内容再检查）
2. 浏览器打开，`getComputedStyle` / `getBoundingClientRect` 逐元素比对改动前后
3. 用相同种子数据渲染，比对可见文本（注意 `.tl-item .text`、`.capsule-item .text`
   有 `white-space: pre-wrap`，模板里的缩进会被真实渲染！给这些元素加换行会改变显示）

---

## 11. 已知技术债（改到相关区域时顺手评估）

- **`DEFAULT_GH.repo` 仍指向已清空的公开仓库** `couple-data`，与「数据存私有仓库」
  的现状不一致（见 §1）。改动前先确认意图。
- `commit` 用箭头函数定义在 L1685，`RENDERERS` 在 L1674 —— 顺序上先有映射表后有 commit，
  新增 key 记得同步两处。
- 农历 `LUNAR_INFO`（L891，821 字符 base64）读取易被工具截断，是维护盲区。
- 单文件 4003 行、327 个函数，无模块边界；改跨模块逻辑时容易误伤。
- `dataUrlToBytes` 类函数逐字节 `atob` 解码，批量首屏可能阻塞主线程（照片多时）。

---

## 12. 给 AI 的操作纪律

1. **先读 §3 定位，再读目标函数**，不要整文件读（230 KB，浪费且易被截断）
2. **改任何 CSS/模板字符串后，必须做浏览器级等价性比对**，不能只 diff 文本
3. **不要假设字段名**，以 §5.3 和实际构造代码为准
4. **不确定就查**：`search_files` 找关键词比凭记忆猜更可靠
5. **涉及删除/迁移数据时先确认备份**，不可逆操作要明确告知用户
6. **不要把 token 写进代码**，也不要提交任何含 token 的文件

## 13. 软考高项模块（exam.js / exam-data.js，2026-11 新增）

独立于情侣业务，**不参与 `S` 同步**，也不写进 `couple-data.json`。

| 文件 | 作用 |
|---|---|
| `exam.js` | 页面渲染 / 知识点详情 / ITTO 自测 / 挣值计算题 / 全屏面板 `#examPanel` |
| `exam-data.js` | 内容：`EXAM_ITTO`（49 个过程，14 个有 ITTO 明细）、`EXAM_KP`（知识点） |

- 入口：更多 → 软考高项。路由 `exam` 已加进 `PAGE_TAB` / `PAGE_TITLES` / `SUB_PAGES`，
  `go()` 里调 `examEnter()`（脚本未就绪时有 `typeof` 保护）。
- DOM：`#page-exam > .scroll-area > #examRoot`；详情与自测走 `#examPanel`，
  已注册到 ov 栈的 `examDetail`，返回键 / Esc 可关。
- 数据：考试日期存 `localStorage` 的 `coupleExamCfg`；内容全是静态文件，
  不进 `S`、不上传、不占同步体积。
- 改内容只动 `exam-data.js`；改引擎动 `exam.js`。**新增文件必须同步 `sw.js` 的 `SHELL`
  并升 `VERSION`（当前 v15）**，否则离线白屏 / 旧缓存。
- 题库（真题）计划用 JSON + 本地导入（IndexedDB），**不提交公开仓库**，避免公开转载。
- 覆盖范围：P0 只有知识点、ITTO（14 个明细）、挣值计算题；刷题页是占位。
