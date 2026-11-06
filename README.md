# dsh-plugin-vault-memory

![License](https://img.shields.io/github/license/nineberg/dsh-plugin-obsidian-memory) ![Platform](https://img.shields.io/badge/DeepSeek%20Harness-plugin-0969da) ![GitHub stars](https://img.shields.io/github/stars/nineberg/dsh-plugin-obsidian-memory?style=social)

> [!NOTE]
> **Fork 说明**：本仓库是 [zhaoxuejie/dsh-plugin-vault-memory](https://github.com/zhaoxuejie/dsh-plugin-vault-memory)（v0.4.0，MIT © moqian）的改良分支，由 [nineberg](https://github.com/nineberg) 维护。在原版基础上修复了若干 DeepSeek Harness（0.2.2-rc.1）兼容性问题，并对悬浮挂件交互/视觉做了增强。上游 MIT 协议与原许可声明完整保留（见 [LICENSE](LICENSE)）。
>
> 相对上游的主要改动：
> 1. **路由僵尸层**——插件重挂载后旧 HTTP 路由层残留并抢先应答（GUI 显示 "index missing"）；改为进程级单次注册 + 动态代理读取当前实例。
> 2. **开机时序**——挂载早于 webServer 就绪导致接口 404；改为路由注册重试。
> 3. **在线保存回退**——新版宿主无旧版 settings API 时，GUI 配置保存回退 sidecar JSON 持久化（`~/.dsh/vault-memory.settings.json`）。
> 4. **悬浮卡片**——callback-ref 挂载防时序空白、正文防塌陷（≥220px 可滚动）、折叠按钮交互与视觉对齐 plugin-island 生态、错误角标只报真实错误。

> **让 DeepSeek Harness agent 学会翻你的 Obsidian 库、用你的笔记、把成果存回你的库——你的笔记从此是活的资产。**

## 它解决什么问题

- **📥 笔记存了 = 白存？** Agent 能真正检索你的笔记：问它"我之前研究过 X 的什么结论"，它翻遍全库给你答案，并**标注出处文件，不编造**。
- **🤝 每次对话都要重新介绍自己？** 新会话开头自动注入"记忆快照"（库状态、活跃项目、近期笔记），AI 直接进入正题。
- **💾 聊完就忘、成果散在对话里？** 一键把会话产出存成笔记：自动 frontmatter、归类打标签、推荐与库内哪些笔记关联。
- **🧹 笔记库越用越乱？** 定期巡检：孤儿笔记、断链、缺总览逐条列出并给理由，**你批准它才动手**，写前自动备份可回滚。

## 核心特性

### Agent 工具集（对话里直接用自然语言触发）

| 你想做什么 | 直接说 | 背后 |
| --- | --- | --- |
| 翻旧笔记 | "库里有没有 Docker 相关笔记？" | 全文检索（中文分词） |
| 按条件找 | "查 tools/ 下近 30 天改过的笔记" | 结构化查询（目录/标签/时间） |
| 读某篇全文 | "把《Git 合并》笔记读给我" | 带行号读取 |
| 意思相近的 | "搜跟'Windows 命令行'相关的" | **语义检索**（本地模型，可选） |
| 关联推荐 | "这篇笔记跟哪些有关联？" | 入链/出链/同标签/共引，带理由 |
| 保存成果 | "把这段整理成笔记存进库" | 自动 frontmatter + 关联建议 |
| 体检 | "库里有孤儿/断链吗？" | 只读巡检报告 |

> 规则：引用必带笔记路径，找不到就明说没有——**绝不编造**。

### 知识库悬浮球 + 中央面板（可拖拽 · 支持灵动岛）

GUI 有三种形态，数据同源、位置记忆：

- **悬浮球** — 右下角纯图标圆球（不带文字），库有异常时显示红色计数徽标；点击展开成悬浮卡片，卡片标题栏可拖拽移动、可一键收起；球体拖到屏幕任意位置都会记住
- **侧栏图标** — 点击打开中央「知识库」面板；把图标拖出侧栏即在落点撕成悬浮卡片
- **灵动岛集成** — 把球（或侧栏图标）拖到 Plugin Island 上即收纳一个启动芯片；从灵动岛把芯片拖出，悬浮卡片会在落点重新浮出；拖回侧栏则停靠折叠

卡片与中央面板共用四个 Tab：

- **概览** — 各库健康：笔记数 / 断链 / 待审 / 趋势 / 语义状态
- **捕获** — 预览 → 保存 → 在 Obsidian 打开
- **审查** — 巡检建议逐条批准/忽略（孤儿可勾选关联对象、断链可下拉修复目标）；批准前自动备份
- **配置** — 在线增删库、开关，保存即生效

### 巡检管家

- 每日定时巡检（默认 03:00，可改），生成**带理由的建议清单**：孤儿（没人引用的笔记）、断链（指向不存在的链接）、缺总览（目录攒够了没目录页）
- **只建议，不擅改**：每条建议你批准才写盘，写前自动备份可回滚
- 忽略后同类建议 **30 天内不再打扰**（可配），过期再提醒防漏报
- 可选高级规则（需语义嵌入）：语义相近未互链 / 疑似重复 / 过期复审

### 隐私优先

- 索引、检索、巡检全部**本机完成**，笔记内容默认不出电脑
- 语义检索用本地 Ollama（`bge-m3`），也可切换兼容云端端点

## 安装

### 方式一：npm 安装（推荐）

```bash
# 安装到 web profile（装完需完全重启 dsh，不是刷新页面）
dsh plugin --profile web add dsh-plugin-vault-memory
```

### 方式二：本地源码（开发 / 自用）

```bash
git clone https://github.com/zhaoxuejie/dsh-plugin-vault-memory.git
dsh plugin --profile web add <仓库路径>
pnpm install   # link 安装模式必需
```

### 配置 vault（两种方式安装后都需要）

在插件设置页添加，或直接编辑 `~/.dsh/settings.yaml`：

```yaml
dsh-plugin-vault-memory:
  vaults:
    - path: D:\path\to\your-vault   # 你的 Obsidian 库绝对路径
      label: main                    # 可选：给库起个名字
```

重启 dsh 后，浏览器右下角出现书本图标悬浮球、左侧栏出现「知识库」图标即安装成功。

### 可选：语义检索

```bash
ollama pull bge-m3     # 安装本地模型
# 在浮卡「配置」开启"语义检索"并保存
```

开启后新笔记自动嵌入，即可使用"搜意思不搜字"的语义/混合检索（不可用时自动回退关键词检索）。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 没看到悬浮球/侧栏图标 | 完全重启 dsh；仍不行则清除浏览器 localStorage 对应项后刷新 |
| 悬浮球不见了 | 它可能被停靠：看左侧栏「知识库」图标，或灵动岛芯片；把侧栏图标拖出来即可重新浮出 |
| 检索提示"未配置 vault" | 浮卡「配置」添加库路径 |
| 保存提示"同名已存在" | 不覆盖是设计，换标题/目录重试 |
| 语义搜无感 | 首次嵌入需等待；确认 Ollama 在跑且已开启语义 |

## 文档

- [使用教程（新手从这里开始）](https://github.com/zhaoxuejie/dsh-plugin-vault-memory/blob/master/docs/usage-guide.md)
- [设计与开发文档](https://github.com/zhaoxuejie/dsh-plugin-vault-memory/blob/master/DESIGN.md)

## 开发

```bash
pnpm install   # link 安装模式必需
npm test       # 84 项单元测试
```

## License

MIT © moqian
