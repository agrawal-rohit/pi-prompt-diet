# Architecture & Design Principles / 架构设计与核心原理

> Deep dive into how `pi-prompt-diet` optimizes the Pi Coding Agent context pipeline without breaking tool calling or progressive disclosure.  
> 深入解析 `pi-prompt-diet` 如何在不破坏工具调用和渐进式披露的前提下，对 Pi Coding Agent 提示词流水线进行去脂优化。

[English](#english) | [中文说明](#中文说明)

---

<a name="english"></a>
## 🇬🇧 English: Architecture & Design

### 1. The Context Inflation Problem in Modern Agent Frameworks

In modern multi-agent and coding assistant architectures, two separate abstraction layers exist:
1. **Tool Definition Layer (`ToolSchema`)**: Standard JSON Schema definitions describing tool parameters, types, and function signatures. This is the **primary driver** for LLM function calling.
2. **Instruction Layer (`promptGuidelines` & `available_skills`)**: Textual heuristics injected into the natural language System Prompt to guide the model's behavior.

#### What goes wrong?
As users install more third-party packages, each package author independently appends guidelines. Package authors frequently:
- Duplicate parameter constraints already enforced by the Schema;
- Embed entire multi-paragraph state machine workflows into base guidelines;
- Write massive Skill descriptions with dozens of keyword trigger examples.

Because Pi concatenates all guidelines linearly, the baseline System Prompt quickly grows from **2,000 characters to over 20,000 characters (5,000+ tokens)** before any user input is processed.

---

### 2. How `pi-prompt-diet` Works

`pi-prompt-diet` acts as a pure, non-destructive **Prompt Pipeline Middleware** via Pi's `before_agent_start` lifecycle event.

```
                  ┌──────────────────────────────┐
                  │ User Input / Turn Triggered  │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ Pi Base Prompt Construction  │
                  │ (Full Tools + Guidelines)    │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                 ┌────────────────────────────────┐
                 │ pi-prompt-diet Middleware      │
                 │ 1. Filter Guidelines (via keep)│
                 │ 2. Compress Whitelisted Skills │
                 │ 3. Replace with Core Standard  │
                 └───────────────┬────────────────┘
                                 │
                                 ▼
                 ┌────────────────────────────────┐
                 │ Streamlined System Prompt      │
                 │ (~6,190 chars / ~1,548 Tokens) │
                 └───────────────┬────────────────┘
                                 │
                                 ▼
                 ┌────────────────────────────────┐
                 │ Sent to LLM (GPT-5/Gemini/etc.)│
                 └────────────────────────────────┘
```

#### Key Execution Stages

1. **Schema Preservation**: Tool parameters (`parameters.properties`) and active tool registrations are untouched. The LLM retains 100% precise schema knowledge.
2. **Hierarchical Configuration Pipeline (matching settings.json)**:
   - Evaluates global fallback rules for `guidelines` and `skills`.
   - Checks the `packages` array for granular per-package overrides (e.g. keep one package's guidelines as `full`, strip another package's skills completely).
   - Injects a crisp 7-bullet core standard alongside any whitelisted rules.
3. **Skill Description Normalization**:
   - Prunes all non-whitelisted skills from `<available_skills>`.
   - Truncates whitelisted descriptions down to the primary sentence (or up to `maxDescriptionLength` characters).
   - Sanitizes XML entities (`&`, `<`, `>`) to ensure structural validity.
4. **Zero Disk Modification**:
   - Never touches physical files under `~/.agents/skills/` or `~/.pi/agent/skills/`.
   - All compression occurs strictly in ephemeral runtime memory.

---

### 3. Progressive Disclosure (On-Demand Loading)

`pi-prompt-diet` strictly enforces the **Three-Tier Progressive Disclosure Pattern**:

| Tier | Component | How it is Handled | Token Overhead |
|---|---|---|---|
| **Tier 1 (Base Context)** | Tool Schemas & Core Index | Always resident in System Prompt (compressed) | ~1,548 Tokens |
| **Tier 2 (Core Workflow)** | `SKILL.md` Files | Loaded dynamically via `read` only when task matches | 0 Base Tokens (On-Demand) |
| **Tier 3 (Deep Reference)** | `references/*.md` | Read recursively by the agent only during complex edge cases | 0 Base Tokens (On-Demand) |

---

<a name="中文说明"></a>
## 🇨🇳 中文：架构设计与实现原理

### 1. 现代 Agent 框架中的上下文膨胀机制

在现代多 Agent 协同和代码辅助架构中，存在两层截然不同的抽象：
1. **工具定义层 (`ToolSchema`)**：标准的 JSON Schema 定义，描述工具参数名、数据类型、枚举值及必填项。这是大模型发起函数调用（Function Calling）的**核心唯一依据**。
2. **提示词指导层 (`promptGuidelines` 与 `available_skills`)**：拼接到 System Prompt 中的自然语言文本，用于对模型做行为约束。

---

### 2. `pi-prompt-diet` 的中间件处理流水线

`pi-prompt-diet` 通过 Pi 的 `before_agent_start` 扩展生命周期，作为一个非侵入式中间件执行：

1. **Schema 绝对保留**：底层 30+ 个工具的函数定义与参数 Schema 100% 完整交付给大模型，确保工具调用毫秒级精准。
2. **分层式配置处理流水线（完全对齐 settings.json 范式）**：
   - 首先加载顶层全局默认策略（`guidelines.mode` 与 `skills.mode`）；
   - 解析 `packages` 数组中针对特定插件的局部微调（支持独立设置 `slim` / `strip` / `full` / `compress`）；
   - 提取需要保留的完整规则，并注入 7 条高浓度核心执行原则。
3. **Skill 描述规范化压缩**：
   - 仅将用户在 `skills.keep` 中显式声明的技能注入 `<available_skills>`；
   - 提取每个放行 Skill 的首句核心说明（或截取最精华的 120 字符）；
   - 对 `&`、`<`、`>` 进行 XML 转义保护。
4. **磁盘零修改保证**：
   - 绝不修改本地 `~/.agents/skills/` 里的任何文件；
   - 模型需要时直接使用 `read` 工具读取完整正文。
