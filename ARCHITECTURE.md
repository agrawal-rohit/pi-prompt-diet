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

`pi-prompt-diet` uses Pi's `before_agent_start`, `tool_result`, and `agent_settled` lifecycle events as an adaptive control plane.

```
                  ┌──────────────────────────────┐
                  │ First User Request in Session│
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ Router LLM                   │
                  │ Request + capability catalog │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                 ┌────────────────────────────────┐
                 │ pi-prompt-diet Middleware      │
                 │ 1. Activate selected tools     │
                 │ 2. Keep selected Skill entries│
                 │ 3. Apply package policies      │
                 └───────────────┬────────────────┘
                                 │
                                 ▼
                 ┌────────────────────────────────┐
                 │ Main Agent                     │
                 │ Reads full SKILL.md on demand  │
                 └───────────────┬────────────────┘
                                 │ first Skill read
                                 ▼
                 ┌────────────────────────────────┐
                 │ Distiller LLM → capsule cache  │
                 └────────────────────────────────┘
```

#### Key Execution Stages

1. **Incremental Capability Route**:
   - `before_agent_start` refreshes registered capabilities and routes newly required names using the current request plus continuation state.
   - The first successful route may shrink the initial broad set; later changes are additive. `request_capabilities` provides an always-active recovery path inside the same agent run.
   - State is persisted in the Pi session, and routing or activation failures never shrink the current set. Recovery exposes Skill paths immediately and activates their read dependency within the additions budget. Failed attempts consume the per-turn request budget. Empty inactive catalogs skip the router model call.
2. **Hierarchical Configuration Pipeline**:
   - Explicit per-package policies remain authoritative.
   - Without an override, a third-party tool keeps its complete author-written guidelines on first successful use. Afterward, a cached evaluator decision either keeps `full` or uses a safe capsule.
   - Package provenance comes from `sourceInfo`, never from guessing prose; there is no built-in package whitelist.
3. **Progressive Tool and Skill Distillation**:
   - A selected cold Skill keeps its original description and path.
   - When the main model first reads that exact `SKILL.md`, `tool_result` records it; after the agent settles, a direct model call extracts the trigger, negative constraints, ordering rules, and the condition for opening the full file.
   - The next session uses the concise capsule plus the unchanged Skill path.
4. **Content-addressed Persistence with CAS & Version Lock**:
   - Tool decisions are stored independently under `~/.pi/agent/cache/pi-prompt-diet/tools/`; Skill capsules use `~/.pi/agent/cache/pi-prompt-diet/skills/`.
   - Fingerprints combine content/metadata with `DISTILLER_VERSION`.
   - Compare-And-Swap (CAS) validation ensures concurrent modifications to source files/metadata do not get overwritten with stale distillations.
   - Original plugin metadata and physical Skill files are never modified. Capsules are structurally validated before use. Complete bounded rules are retained without character slicing; invalid Skill summaries fall back to original descriptions, and unsafe or non-saving tool summaries keep full guidelines. Distiller version v3.2 invalidates earlier capsule fingerprints.

---

### 3. Progressive Disclosure (On-Demand Loading)

`pi-prompt-diet` strictly enforces the **Three-Tier Progressive Disclosure Pattern**:

| Tier | Component | How it is Handled | Token Overhead |
|---|---|---|---|
| **Tier 1 (Base Context)** | Selected tool schemas, core rules, Skill capsules | Resident after one session route | Task-dependent |
| **Tier 2 (Core Workflow)** | Full `SKILL.md` files | Loaded dynamically via `read` only when the capsule matches | 0 Base Tokens (On-Demand) |
| **Tier 3 (Deep Reference)** | `references/*.md` | Read recursively only during complex edge cases | 0 Base Tokens (On-Demand) |

---

<a name="中文说明"></a>
## 🇨🇳 中文：架构设计与实现原理

### 1. 现代 Agent 框架中的上下文膨胀机制

在现代多 Agent 协同和代码辅助架构中，存在两层截然不同的抽象：
1. **工具定义层 (`ToolSchema`)**：标准的 JSON Schema 定义，描述工具参数名、数据类型、枚举值及必填项。这是大模型发起函数调用（Function Calling）的**核心唯一依据**。
2. **提示词指导层 (`promptGuidelines` 与 `available_skills`)**：拼接到 System Prompt 中的自然语言文本，用于对模型做行为约束。

---

### 2. `pi-prompt-diet` 的中间件处理流水线

`pi-prompt-diet` 通过 Pi 的 `before_agent_start`、`tool_result` 与 `agent_settled` 生命周期构成自适应控制面：

1. **增量能力路由**：
   - 每次 `before_agent_start` 刷新能力目录，结合当前请求和 continuation state 选择新增能力；
   - 首次成功路由可以缩减初始宽泛集合，后续只增加；常驻 `request_capabilities` 可在同一个 Agent run 内补充工具；
   - 状态持久化到 Pi Session，路由或激活失败不缩减现有集合。补充 Skill 会立即披露路径，并在新增预算内启用 read 依赖；失败尝试计入每轮请求预算。没有未激活能力时跳过路由模型调用。
2. **分层配置继续生效**：
   - 用户显式包级策略始终优先；
   - 无 override 的第三方工具第一次成功使用时完整保留作者 Guidelines，之后采用缓存的 `full` 判断或安全胶囊；
   - 通过 `sourceInfo` 精确归属，不再维护内置插件白名单。
3. **渐进式工具与 Skill 蒸馏**：
   - 入选但尚无缓存的 Skill 保留原始描述与路径；
   - 主模型第一次读取该 `SKILL.md` 后，`tool_result` 记录路径，`agent_settled` 再调用模型提取触发条件、负向约束（Must Not）、执行顺序（Ordering）与完整读取条件；
   - 后续会话只注入短胶囊和原始路径，需要细节时主模型仍会读取完整 Skill。
4. **带 CAS 校验与版本锁的内容寻址持久缓存**：
   - 工具判断独立写入 `~/.pi/agent/cache/pi-prompt-diet/tools/`，Skill 胶囊写入 `~/.pi/agent/cache/pi-prompt-diet/skills/`；
   - 指纹混入 `DISTILLER_VERSION`；写入时执行 CAS (Compare-And-Swap) 校验，防止并发写入陈旧数据；
   - 工具指纹覆盖名称、描述、参数、Guidelines、来源与版本锁；Skill 指纹覆盖文件内容与版本锁，变化后自动回到冷启动；
   - 原始插件元数据与 Skill 文件始终不被修改。缓存使用前校验结构；已限制长度的完整规则不再裁切。Skill 摘要无效时回退原描述，工具摘要不安全或没有节省字符时保留完整 Guidelines。蒸馏版本 v3.2 使旧胶囊指纹失效。
