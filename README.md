# 🥗 pi-prompt-diet

> A configuration-driven, high-efficiency System Prompt optimizer
> for [Pi Coding Agent](https://github.com/earendil-works/pi) that cuts baseline token overhead by **over 51%** (~2,557
> Tokens/turn) out-of-the-box while keeping **100% of all tool calling capabilities intact**.

[English](#english) | [中文说明](#中文说明)

---

<a name="english"></a>

## 🇬🇧 English Documentation

### ⚡ The Problem

As the Pi package ecosystem expands, installing multiple third-party packages causes `promptGuidelines` and
`<available_skills>` to bloat uncontrollably.

A standard setup with 8–10 packages often results in:

- **9,000+ characters (50+ bullet points)** of rigid guidelines injected on *every turn*;
- **5,700+ characters (14+ skills)** of multi-paragraph skill descriptions;
- Over **5,000 baseline Tokens** consumed before you even type a prompt;
- Severe context window dilution and unnecessary API billing.

### 💡 The Solution: Hierarchical Configuration Engine

`pi-prompt-diet` follows the exact design philosophy of Pi's native `settings.json`:

1. **Global Top-Level Defaults**: Define system-wide fallback treatments (`guidelines.mode`, `skills.mode`).
2. **Per-Package Granular Overrides (`packages: [...]`)**: Fine-tune specific packages (e.g. keep one package's
   guidelines as `full`, strip another's skills completely, or compress others).
3. **Zero Functional Loss**: Modern LLMs (GPT-5, Gemini 2.5, Claude 3.7) rely on tool parameter schemas (`JSON Schema`)
   for accurate calling. All 30+ tools remain 100% callable.
4. **True Progressive Disclosure**: All pruned skills stay intact on disk and remain 100% available for the agent to
   `read` on demand.

---

### 📊 Benchmark & Real-world Savings (Clean Default Baseline)

| Metric                     | Before Diet              | With `pi-prompt-diet` (Default: `slim` + `compress`)   | Reduction              |
|----------------------------|--------------------------|--------------------------------------------------------|------------------------|
| **System Prompt Size**     | 20,030 chars (~5,008 T)  | **9,805 chars (~2,451 T)**                             | 🔻 **-51.1%**          |
| **Guidelines Block**       | 9,265 chars (52 bullets) | **537 chars (7 core heuristics)**                      | 🔻 **-94.2%**          |
| **Skills Block**           | 5,755 chars (14 skills)  | **4,258 chars (14 skills compressed to 1st sentence)** | 🔻 **-26.0%**          |
| **Token Savings Per Turn** | -                        | **~2,557 Tokens / turn**                               | 💰 **Instant Savings** |
| **Tool Functionality**     | 33 tools active          | **33 tools active**                                    | ✅ **100% Preserved**  |

<details>
<summary>🔍 <b>Click to expand granular per-package breakdown & reduction evidence</b></summary>

#### Measured Per-Package Guidelines Breakdown (Empirical Trace)

| Package Name                             | Associated Tool         | Baseline Guidelines Chars | Rules Count | Optimization Applied                            |
|------------------------------------------|-------------------------|---------------------------|-------------|-------------------------------------------------|
| `npm:pi-subagents`                       | `subagent`              | **~2,800 chars**          | 12 bullets  | Offloaded advanced syntax to on-demand skill    |
| `npm:@juicesharp/rpiv-ask-user-question` | `ask_user_question`     | **~1,300 chars**          | 4 bullets   | Deduplicated schema constraints from guidelines |
| `npm:@juicesharp/rpiv-todo`              | `todo`                  | **~1,100 chars**          | 8 bullets   | Trimmed redundant state-machine prose           |
| `npm:pi-gpt`                             | `gpt_chat`              | **~1,000 chars**          | 6 bullets   | Relies on skill for code review contracts       |
| `npm:@ff-labs/pi-fff`                    | `fffind`, `ffgrep`      | **~800 chars**            | 10 bullets  | Consolidated into 2 concise heuristics          |
| `Pi Core Guidelines`                     | `read`, `edit`, `write` | **~1,200 chars**          | 8 bullets   | Preserved core file safety standards            |

#### Measured Skill Description Breakdown

| Skill Name             | Location / Origin                         | Original Description Length           | Whitelist Treatment           |
|------------------------|-------------------------------------------|---------------------------------------|-------------------------------|
| `ego-browser`          | `~/.agents/skills/ego-browser`            | **977 chars** (verbose trigger lists) | Offloaded to on-demand `read` |
| `research-routing`     | `~/.pi/agent/extensions/research-routing` | **210 chars**                         | Kept in whitelist (120 chars) |
| `private-house-code`   | `~/.agents/skills/private-house-code`     | **241 chars**                         | Kept in whitelist (120 chars) |
| `pi-lens-*` (4 skills) | `npm:pi-lens`                             | **~500 chars** combined               | Offloaded to on-demand `read` |

</details>

---

<details>
<summary>⚙️ <b>Click to expand Configuration Guide (<code>pi-prompt-diet.json</code>)</b></summary>

### Hierarchical Configuration (`pi-prompt-diet.json`)

`pi-prompt-diet.json` supports top-level global defaults + a `packages` array for granular overrides (including exact per-skill/file mode mappings like `"skills/council-mode": "full"` and `"skills/pi-subagents": "slim"`).

> 💡 **Auto-Initialization**: If `~/.pi/agent/pi-prompt-diet.json` does not exist on startup, `pi-prompt-diet` will automatically generate a standard, best-practice default configuration file for you!

```json
{
  "$schema": "https://raw.githubusercontent.com/XRSec/pi-prompt-diet/main/schema.json",
  "enabled": true,
  "guidelines": {
    "mode": "slim"
  },
  "skills": {
    "mode": "compress",
    "maxDescriptionLength": 120
  },
  "packages": []
}
```

#### Advanced Package Overrides (`packages` Array)

When you need granular control over specific third-party packages, populate the `packages` array:

```json
{
  "packages": [
    {
      "source": "npm:pi-subagents",
      "guidelines": { "mode": "slim" },
      "skills": {
        "skills/council-mode": "full",   // 👈 Keep full multi-paragraph description
        "skills/pi-subagents": "slim"    // 👈 Compress to concise primary sentence
      }
    }
  ]
}
```

#### Configuration Reference

| Level                | Key                           | Options / Type                                                                                              | Description                                                                       |
|----------------------|-------------------------------|-------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------|
| **Global**           | `guidelines.mode`             | `"slim"` \| `"strip"` \| `"full"`                                                                           | Default guideline treatment across all packages.                                  |
| **Global**           | `skills.mode`                 | `"compress"` \| `"strip"` \| `"full"`                                                                       | Default skill description treatment.                                              |
| **Global**           | `skills.maxDescriptionLength` | `number` (default: `120`)                                                                                   | Max character limit when compressing skill descriptions.                          |
| **Package Override** | `packages[].source`           | `string`                                                                                                    | Package name (e.g. `"npm:pi-subagents"` or `"pi-gpt"`).                           |
| **Package Override** | `packages[].guidelines`       | `"slim"` \| `"strip"` \| `"full"` \| `{"mode": "..."}`                                                      | Package-specific guidelines override.                                             |
| **Package Override** | `packages[].skills`           | `"compress"` \| `"strip"` \| `"full"` \| `{"mode": "..."}` \| `Record<string, "full" \| "slim" \| "strip">` | Package-specific skill override (supports mode object or exact per-file mapping). |

</details>

---

### 📚 Deep Dive Architecture

For an in-depth explanation of the multi-agent context inflation problem, internal prompt middleware pipeline, and
progressive disclosure implementation, see the [Architecture & Design Principles](ARCHITECTURE.md) document.

---

### 📦 Installation

Install directly via Pi package manager:

```bash
pi install git:github.com/XRSec/pi-prompt-diet
# Or once published on npm:
pi install npm:pi-prompt-diet
```

---

<a name="中文说明"></a>

## 🇨🇳 中文说明

### ⚡ 核心痛点

随着 Pi 插件生态的繁荣，用户在安装多个常用扩展后，各扩展注册的 `promptGuidelines` 和技能描述会在后台不断累加。

这导致：

- **即便只是问一句“今天星期几”**，每轮也会无脑带入 **9,000+ 字符（50 多条）** 的死板文档与 **5,700+ 字符** 的技能清单；
- 会话还未开始，就已被吃掉 **5,000+ Baseline Tokens**；
- 严重稀释大模型的上下文注意力窗口，造成显著的 API 费用浪费。

### 💡 解决方案：分层配置引擎（对齐 settings.json 范式）

`pi-prompt-diet` 作为 `before_agent_start` 流水线上的轻量中间件，采用与 Pi 官方 `settings.json` 完全一致的分层设计：

1. **顶层全局默认策略**：定义系统级的通用去脂规则（`guidelines.mode`、`skills.mode`）；
2. **`packages` 数组局部精准微调**：支持针对特定插件单独声明策略（如某个包的 guidelines 保留 `full`，某个包的 skills 完全
   `strip` 剥离，其余保持全局默认）；
3. **工具能力 100% 完好保留**：现代模型完全依赖 JSON Schema 即可精准调用工具，30 多个工具随时待命；
4. **真正的渐进式披露**：被剥离的技能，其物理文件依然完好保留在本地磁盘，需要时 AI 随时通过 `read` 工具按需加载。

---

### 📊 实测削减数据与账单对比 (纯净开箱默认配置)

| 模块 / 指标                           | 优化前基线             | 启用 `pi-prompt-diet` (默认 `slim` + `compress`) | 缩减幅度             |
|---------------------------------------|------------------------|--------------------------------------------------|----------------------|
| **System Prompt 实际体积**            | 20,030 字符 (~5,008 T) | **9,805 字符 (~2,451 T)**                        | 🔻 **-51.1%**        |
| **Guidelines 规则区**                 | 9,265 字符 (52 条)     | **537 字符 (7 条核心准则)**                      | 🔻 **-94.2%**        |
| **技能描述区 (`<available_skills>`)** | 5,755 字符 (14 个技能) | **4,258 字符 (14 个技能全部浓缩首句)**           | 🔻 **-26.0%**        |
| **单轮节省 Token**                    | -                      | **~2,557 Tokens / 轮**                           | 💰 **极致省流**      |
| **工具与技能可用性**                  | 33 个工具全激活        | **33 个工具全激活**                              | ✅ **100% 完整保留** |

<details>
<summary>🔍 <b>点击展开：具体各 NPM 插件削减明细与量化证据</b></summary>

#### 按 NPM 包统计的 Guidelines 削减明细

| 插件名称 (NPM Package)                   | 对应工具                | 原 Guidelines 字符数 | 条数  | 优化方式与去噪点                               |
|------------------------------------------|-------------------------|----------------------|-------|------------------------------------------------|
| `npm:pi-subagents`                       | `subagent`              | **~2,800 字符**      | 12 条 | 复杂 workflowScript / lanes 语法下沉至按需技能 |
| `npm:@juicesharp/rpiv-ask-user-question` | `ask_user_question`     | **~1,300 字符**      | 4 条  | 剔除与 JSON Schema 重复的 options/preview 描述 |
| `npm:@juicesharp/rpiv-todo`              | `todo`                  | **~1,100 字符**      | 8 条  | 剔除 4 状态机与 update payload 的大段冗余文本  |
| `npm:pi-gpt`                             | `gpt_chat`              | **~1,000 字符**      | 6 条  | 代码审查传 diff 契约与重试规则下沉至按需技能   |
| `npm:@ff-labs/pi-fff`                    | `fffind`, `ffgrep`      | **~800 字符**        | 10 条 | 将 10 条琐碎用例浓缩为 2 条核心搜索启发式      |
| `Pi Core 内置规则`                       | `read`, `edit`, `write` | **~1,200 字符**      | 8 条  | 完整保留核心文件安全与编辑准则                 |

</details>

---

<details>
<summary>⚙️ <b>点击展开：极简配置文件参考 (<code>pi-prompt-diet.json</code>)</b></summary>

### 分层式配置文件参考 (`pi-prompt-diet.json`)

采用与 Pi 官方 `settings.json` 一致的分层结构，顶层写全局默认策略，`packages` 数组中写特定插件的精准覆盖（支持单个文件独立指定策略，如 `"skills/council-mode": "full"`）：

> 💡 **自动初始化**：如果本地尚不存在 `~/.pi/agent/pi-prompt-diet.json`，插件在首次运行时会自动创建开箱即用的标准默认配置！

```json
{
  "$schema": "https://raw.githubusercontent.com/XRSec/pi-prompt-diet/main/schema.json",
  "enabled": true,
  "guidelines": {
    "mode": "slim"
  },
  "skills": {
    "mode": "compress",
    "maxDescriptionLength": 120
  },
  "packages": []
}
```

#### 进阶包微调覆盖示例 (`packages` 数组)

当你需要对特定第三方插件进行精细化微调时，可使用 `packages` 数组：

```json
{
  "packages": [
    {
      "source": "npm:pi-subagents",
      "guidelines": { "mode": "slim" },
      "skills": {
        "skills/council-mode": "full",   // 👈 保留原版多段落完整描述
        "skills/pi-subagents": "slim"    // 👈 浓缩为单句核心说明
      }
    }
  ]
}
```

#### 配置层级与参数说明

| 配置层级     | 参数项                        | 可选值                                                                                                      | 说明                                                                         |
|--------------|-------------------------------|-------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------|
| **全局默认** | `guidelines.mode`             | `"slim"` \| `"strip"` \| `"full"`                                                                           | 全局通用的 Guidelines 处理策略（默认 `"slim"`）。                            |
| **全局默认** | `skills.mode`                 | `"compress"` \| `"strip"` \| `"full"`                                                                       | 全局通用的技能描述处理策略（默认 `"compress"` 浓缩首句）。                   |
| **全局默认** | `skills.maxDescriptionLength` | `number` (默认 `120`)                                                                                       | 浓缩 Skill 描述时的最大字符上限。                                            |
| **包级覆盖** | `packages[].source`           | `string`                                                                                                    | 目标插件包名（如 `"npm:pi-subagents"` 或 `"pi-gpt"`）。                      |
| **包级覆盖** | `packages[].guidelines`       | `"slim"` \| `"strip"` \| `"full"` \| `{"mode": "..."}`                                                      | 针对该特定插件的 Guidelines 处理策略覆盖。                                   |
| **包级覆盖** | `packages[].skills`           | `"compress"` \| `"strip"` \| `"full"` \| `{"mode": "..."}` \| `Record<string, "full" \| "slim" \| "strip">` | 针对该特定插件的技能处理覆盖（支持模式对象，或精准到具体文件的策略映射表）。 |

</details>

---

### 📚 深度架构与设计原理

关于多插件生态下提示词膨胀机理、中间件处理流水线图以及三层渐进式披露体系的深度技术实现，请参阅根目录下的 [架构设计与核心原理 (ARCHITECTURE.md)](ARCHITECTURE.md)。

---

## 📄 License

MIT License © 2026 [XRSec](https://github.com/XRSec)
