import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testHome = mkdtempSync(join(tmpdir(), "pi-prompt-diet-test-"));
process.env.HOME = testHome;

const { default: promptDiet } = await import("../index.ts");
const {
	fingerprintToolGuidelines,
	getValidToolGuidelineCapsule,
	loadSkillCapsuleCache,
	loadToolGuidelineCapsuleCache,
	saveSkillCapsuleCache,
	saveToolGuidelineCapsule,
} = await import("../adaptive.ts");

const tools = [
	{ name: "read", description: "Read a file", promptGuidelines: ["Use read for files."], sourceInfo: { source: "builtin" } },
	{ name: "web_search", description: "Search current facts", promptGuidelines: ["Use web_search for current facts."], sourceInfo: { source: "npm:web" } },
	{ name: "edit", description: "Edit files", promptGuidelines: ["Use edit precisely."], sourceInfo: { source: "builtin" } },
];

const systemPrompt = `Available tools:
- read: Read
- web_search: Search
- edit: Edit

Guidelines:
- Use read for files.
- Use web_search for current facts.
- Use edit precisely.

<available_skills>
placeholder
</available_skills>`;

function createHarness(complete, setActiveTools = () => {}, extraTools = []) {
	const handlers = new Map();
	const registeredTools = [...tools, ...extraTools];
	const toolDefinitions = new Map();
	const commandDefinitions = new Map();
	const entries = [];
	let activeTools = registeredTools.map((tool) => tool.name);
	const pi = {
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
		registerTool(definition) {
			toolDefinitions.set(definition.name, definition);
			registeredTools.push({ ...definition, sourceInfo: { source: "test-extension" } });
			activeTools.push(definition.name);
		},
		registerCommand(name, definition) {
			commandDefinitions.set(name, definition);
		},
		appendEntry(type, data) { entries.push({ type: "custom", customType: type, data }); },
		getAllTools: () => registeredTools,
		getActiveTools: () => activeTools,
		setActiveTools(names) {
			setActiveTools(names);
			activeTools = [...names];
		},
	};
	promptDiet(pi);
	const ctx = {
		cwd: process.cwd(),
		hasUI: false,
		signal: undefined,
		model: { provider: "test", id: "router" },
		modelRegistry: {
			hasConfiguredAuth: () => true,
			find: () => undefined,
			complete,
		},
		sessionManager: { getBranch: () => entries },
	};
	return {
		async emit(name, event, overrideCtx = ctx) {
			let result;
			for (const handler of handlers.get(name) ?? []) result = await handler(event, overrideCtx);
			return result;
		},
		async executeTool(name, params = {}) {
			return toolDefinitions.get(name).execute("call", params, undefined, undefined, ctx);
		},
		async executeCommand(name, args = "") {
			return commandDefinitions.get(name).handler(args, ctx);
		},
		ctx,
		entries,
		getActiveTools: () => activeTools,
	};
}

function createSkills(prefix) {
	const weatherDirectory = join(testHome, prefix, "weather-helper");
	const otherDirectory = join(testHome, prefix, "other");
	mkdirSync(weatherDirectory, { recursive: true });
	mkdirSync(otherDirectory, { recursive: true });
	const weatherPath = join(weatherDirectory, "SKILL.md");
	const otherPath = join(otherDirectory, "SKILL.md");
	writeFileSync(weatherPath, "# Weather helper\nUse this for current weather. Always verify freshness.");
	writeFileSync(otherPath, "# Other\nUnrelated.");
	return {
		weatherPath,
		skills: [
			{ name: "weather-helper", description: "Long original weather helper description.", filePath: weatherPath, sourceInfo: { source: "user" } },
			{ name: "other", description: "Unrelated skill.", filePath: otherPath, sourceInfo: { source: "user" } },
		],
	};
}

function eventFor(skills) {
	return {
		prompt: "What is the weather?",
		systemPrompt,
		systemPromptOptions: { skills, promptGuidelines: tools.flatMap((tool) => tool.promptGuidelines) },
	};
}

test("malformed route and tool activation failure preserve the static prompt", async () => {
	const malformed = createHarness(async () => ({ stopReason: "stop", content: [{ type: "text", text: "{}" }] }));
	const { skills } = createSkills("malformed");
	await malformed.emit("session_start", { reason: "startup" }, malformed.ctx);
	const malformedResult = await malformed.emit("before_agent_start", eventFor(skills), malformed.ctx);
	assert.match(malformedResult.systemPrompt, /- edit: Edit/);
	assert.match(malformedResult.systemPrompt, /<name>other<\/name>/);

	const activationFailure = createHarness(
		async () => ({ stopReason: "stop", content: [{ type: "text", text: '{"tools":["web_search"],"skills":[]}' }] }),
		() => { throw new Error("activation failed"); },
	);
	await activationFailure.emit("session_start", { reason: "startup" }, activationFailure.ctx);
	const failureResult = await activationFailure.emit("before_agent_start", eventFor(skills), activationFailure.ctx);
	assert.match(failureResult.systemPrompt, /- edit: Edit/);
	assert.match(failureResult.systemPrompt, /<name>other<\/name>/);
});

test("incremental routing preserves capabilities, then a read creates and reuses a content-addressed capsule", async () => {
	const { skills, weatherPath } = createSkills("lifecycle");
	let completions = 0;
	let activeTools;
	const harness = createHarness(async (_model, request) => {
		completions += 1;
		const isDistillation = request.systemPrompt.includes("distill a reusable routing capsule");
		const text = isDistillation
			? '{"trigger":"Use for current weather.","essentialRules":["Verify freshness."],"readFullWhen":"provider details are needed."}'
			: '{"tools":["web_search"],"skills":["weather-helper"]}';
		return { stopReason: "stop", content: [{ type: "text", text }] };
	}, (names) => { activeTools = names; });

	await harness.emit("session_start", { reason: "startup" }, harness.ctx);
	const cold = await harness.emit("before_agent_start", eventFor(skills), harness.ctx);
	assert.deepEqual(activeTools, ["read", "web_search", "request_capabilities"]);
	assert.match(cold.systemPrompt, /Long original weather helper description/);
	assert.doesNotMatch(cold.systemPrompt, /<name>other<\/name>/);

	const continuation = { ...eventFor(skills), prompt: "继续" };
	await harness.emit("before_agent_start", continuation, harness.ctx);
	assert.equal(completions, 1);
	assert.ok(activeTools.includes("read"));
	assert.ok(activeTools.includes("web_search"));

	await harness.emit("tool_result", { toolName: "read", isError: false, input: { path: weatherPath } }, harness.ctx);
	await harness.emit("agent_settled", {}, harness.ctx);
	assert.equal(completions, 2);

	await harness.emit("session_start", { reason: "new" }, harness.ctx);
	const warm = await harness.emit("before_agent_start", eventFor(skills), harness.ctx);
	assert.equal(completions, 3);
	assert.match(warm.systemPrompt, /Verify freshness/);
	assert.doesNotMatch(warm.systemPrompt, /Long original weather helper description/);

	writeFileSync(weatherPath, `${readFileSync(weatherPath, "utf8")}\nNew rule.`);
	await harness.emit("session_start", { reason: "new" }, harness.ctx);
	const invalidated = await harness.emit("before_agent_start", eventFor(skills), harness.ctx);
	assert.match(invalidated.systemPrompt, /Long original weather helper description/);
});

test("a used third-party tool is distilled once and its capsule replaces cold full guidelines", async () => {
	const pluginTool = {
		name: "plugin_search",
		description: "Search plugin data.",
		parameters: { type: "object", properties: { query: { type: "string" } } },
		promptGuidelines: [
			"plugin_search matches complete logical paths, not only leaf names.",
			"plugin_search uses query for fuzzy matching and exactPath for exact matching.",
		],
		sourceInfo: { source: "npm:test-plugin", path: "/test/plugin.ts" },
	};
	let completions = 0;
	const harness = createHarness(async (_model, request) => {
		completions += 1;
		const text = request.systemPrompt.includes("evaluate the prompt guidelines")
			? '{"mode":"capsule","essentialRules":["plugin_search: query is fuzzy; use exactPath for exact matching."],"reason":"The path rule can be combined without loss."}'
			: '{"tools":["plugin_search"],"skills":[]}';
		return { stopReason: "stop", content: [{ type: "text", text }] };
	}, undefined, [pluginTool]);
	const pluginPrompt = `Available tools:\n- read: Read\n- web_search: Search\n- edit: Edit\n- plugin_search: Search plugin data\n\nGuidelines:\n- Use read for files.\n- Use web_search for current facts.\n- Use edit precisely.\n- ${pluginTool.promptGuidelines[0]}\n- ${pluginTool.promptGuidelines[1]}\n\n<available_skills>\nplaceholder\n</available_skills>`;
	const event = { prompt: "Search plugin data", systemPrompt: pluginPrompt, systemPromptOptions: { skills: [], promptGuidelines: [...tools.flatMap((tool) => tool.promptGuidelines), ...pluginTool.promptGuidelines] } };

	await harness.emit("session_start", { reason: "startup" }, harness.ctx);
	const cold = await harness.emit("before_agent_start", event, harness.ctx);
	assert.match(cold.systemPrompt, /matches complete logical paths/);
	assert.match(cold.systemPrompt, /uses query for fuzzy matching/);

	await harness.emit("tool_result", { toolName: "plugin_search", isError: false, input: { query: "x" } }, harness.ctx);
	await harness.emit("agent_settled", {}, harness.ctx);
	assert.equal(completions, 2);

	await harness.emit("session_start", { reason: "new" }, harness.ctx);
	const warm = await harness.emit("before_agent_start", event, harness.ctx);
	assert.match(warm.systemPrompt, /query is fuzzy; use exactPath/);
	assert.doesNotMatch(warm.systemPrompt, /matches complete logical paths/);
});

test("an already concise third-party guideline decision stays full until metadata changes", () => {
	const tool = {
		name: "dense_tool",
		description: "Dense tool.",
		parameters: { type: "object" },
		promptGuidelines: ["dense_tool must preserve this complete rule."],
		sourceInfo: { source: "npm:dense", path: "/dense.ts" },
	};
	const cache = loadToolGuidelineCapsuleCache();
	const key = "npm:dense:dense_tool";
	cache.tools[key] = {
		name: tool.name,
		source: tool.sourceInfo.source,
		fingerprint: fingerprintToolGuidelines(tool),
		mode: "full",
		reason: "Already concise.",
		generatedAt: "now",
	};
	saveToolGuidelineCapsule(cache, key);
	assert.equal(getValidToolGuidelineCapsule(loadToolGuidelineCapsuleCache(), tool)?.mode, "full");
	tool.promptGuidelines.push("A new rule.");
	assert.equal(getValidToolGuidelineCapsule(loadToolGuidelineCapsuleCache(), tool), undefined);
});

test("request_capabilities rejects calls exceeding the turn budget", async () => {
	const harness = createHarness(async () => ({ stopReason: "stop", content: [{ type: "text", text: '{"tools":[],"skills":[]}' }] }));
	await harness.emit("session_start", { reason: "startup" }, harness.ctx);
	await harness.emit("before_agent_start", eventFor([]), harness.ctx);

	const first = await harness.executeTool("request_capabilities", { tools: ["edit"], reason: "first request" });
	assert.equal(first.details.status, "activated");
	assert.deepEqual(first.details.addedTools, ["edit"]);

	const second = await harness.executeTool("request_capabilities", { tools: ["web_search"], reason: "second request" });
	assert.equal(second.details.status, "activated");
	assert.deepEqual(second.details.addedTools, ["web_search"]);

	const third = await harness.executeTool("request_capabilities", { tools: ["read"], reason: "third request (exceeds default budget of 2)" });
	assert.equal(third.details.status, "failed");
	assert.equal(third.details.failures[0]?.code, "turn_budget_exceeded");
	assert.match(third.content[0].text, /budget exceeded/);
});

test("CAS check rejects stale capsule writes if source was modified concurrently", async () => {
	const { weatherPath } = createSkills("cas");
	const cache = loadSkillCapsuleCache();
	const initialFingerprint = (await import("../adaptive.ts")).fingerprintSkill(weatherPath);
	cache.skills[weatherPath] = {
		name: "weather-helper",
		filePath: weatherPath,
		fingerprint: initialFingerprint,
		trigger: "Test",
		essentialRules: ["Test rule"],
		readFullWhen: "Always",
		generatedAt: "now",
	};

	// Concurrent modification happens before save
	writeFileSync(weatherPath, `${readFileSync(weatherPath, "utf8")}\nConcurrent modification.`);
	const { saveSkillCapsule } = await import("../adaptive.ts");
	const saved = saveSkillCapsule(cache, weatherPath, initialFingerprint);
	assert.equal(saved, false);
});

test("pi-prompt-diet command inspects capability state and cache counts", async () => {
	const harness = createHarness(async () => ({ stopReason: "stop", content: [{ type: "text", text: '{"tools":[],"skills":[]}' }] }));
	await harness.emit("session_start", { reason: "startup" }, harness.ctx);
	await harness.emit("before_agent_start", eventFor([]), harness.ctx);

	const outputFull = await harness.executeCommand("pi-prompt-diet");
	assert.match(outputFull, /=== pi-prompt-diet Status ===/);
	assert.match(outputFull, /Active Tools/);
	assert.match(outputFull, /Skill Capsules in Cache/);
	assert.match(outputFull, /Tool Guideline Capsules in Cache/);
});

test("stale cache snapshots cannot overwrite unrelated Skill capsules", () => {
	const first = loadSkillCapsuleCache();
	const second = loadSkillCapsuleCache();
	first.skills["/skill/one"] = {
		name: "one", filePath: "/skill/one", fingerprint: "one", trigger: "one", essentialRules: [], readFullWhen: "needed", generatedAt: "now",
	};
	second.skills["/skill/two"] = {
		name: "two", filePath: "/skill/two", fingerprint: "two", trigger: "two", essentialRules: [], readFullWhen: "needed", generatedAt: "now",
	};
	saveSkillCapsuleCache(first);
	saveSkillCapsuleCache(second);
	const merged = loadSkillCapsuleCache();
	assert.ok(merged.skills["/skill/one"]);
	assert.ok(merged.skills["/skill/two"]);
});

test.after(() => rmSync(testHome, { recursive: true, force: true }));
