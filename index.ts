import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * 参考 settings.json 的分层策略定义：
 * 支持全局默认策略 + packages 数组对指定插件做精细化局部覆盖。
 */
export type TreatmentMode = "compress" | "slim" | "strip" | "full";

export type SkillRuleValue = TreatmentMode | { mode?: TreatmentMode; maxDescriptionLength?: number };

export interface PackageOverrideConfig {
	source: string; // 例如 "npm:pi-subagents", "pi-gpt", "ego-browser"
	guidelines?: TreatmentMode | { mode?: TreatmentMode };
	// skills 支持：
	// 1. 统一模式字符串: "compress" | "strip" | "full"
	// 2. 模式对象: { "mode": "strip" }
	// 3. 数组规则: ["-skills/council-mode", "+skills/pi-subagents"]
	// 4. 精准文件键值映射对象: { "skills/council-mode": "strip", "skills/pi-subagents": "full" }
	skills?: TreatmentMode | { mode?: TreatmentMode; maxDescriptionLength?: number; rules?: string[] } | string[] | Record<string, SkillRuleValue>;
	maxDescriptionLength?: number;
}

export interface PromptDietConfig {
	enabled?: boolean;
	guidelines?: {
		mode?: TreatmentMode;      // 全局默认: "slim" | "strip" | "full"
		customCore?: string[];     // 自定义核心 7 准则
	};
	skills?: {
		mode?: TreatmentMode;      // 全局默认: "compress" | "strip" | "full"
		maxDescriptionLength?: number;
	};
	packages?: (string | PackageOverrideConfig)[];
}

const DEFAULT_CORE_GUIDELINES = [
	"- Use read to examine files instead of cat or sed.",
	"- Use edit for precise changes (edits[].oldText must match exactly).",
	"- When changing multiple separate locations in one file, use one edit call with multiple entries.",
	"- Keep edits[].oldText as small as possible while still unique; do not pad with large unchanged regions.",
	"- Use write only for new files or complete rewrites.",
	"- Rely on each tool's parameter schema or read skills on demand for advanced workflows.",
	"- Be concise in your responses and show file paths clearly.",
];

const DEFAULT_CONFIG: PromptDietConfig = {
	enabled: true,
	guidelines: {
		mode: "slim",
	},
	skills: {
		mode: "compress",
		maxDescriptionLength: 120,
	},
	packages: [],
};

function normalizeName(name: string): string {
	return name.replace(/^npm:/, "").replace(/^git:/, "").toLowerCase();
}

function loadConfig(cwd: string): PromptDietConfig {
	const userConfigDir = join(homedir(), ".pi", "agent");
	const primaryUserConfigPath = join(userConfigDir, "pi-prompt-diet.json");
	const legacyUserConfigPath = join(userConfigDir, "prompt-diet.json");
	const projectConfigPath = join(cwd, ".pi", "pi-prompt-diet.json");
	const legacyProjectConfigPath = join(cwd, ".pi", "prompt-diet.json");

	// 1. 如果用户全局配置不存在，自动创建标准的默认配置文件
	if (!existsSync(primaryUserConfigPath) && !existsSync(legacyUserConfigPath)) {
		try {
			mkdirSync(userConfigDir, { recursive: true });
			writeFileSync(primaryUserConfigPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
		} catch {}
	}

	let config: PromptDietConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

	// 2. 按优先级加载配置（优先 pi-prompt-diet.json，兼容 prompt-diet.json）
	const searchPaths = [legacyUserConfigPath, primaryUserConfigPath, legacyProjectConfigPath, projectConfigPath];
	for (const p of searchPaths) {
		if (existsSync(p)) {
			try {
				const userCfg = JSON.parse(readFileSync(p, "utf8"));
				config = {
					...config,
					...userCfg,
					guidelines: { ...config.guidelines, ...(userCfg.guidelines || {}) },
					skills: { ...config.skills, ...(userCfg.skills || {}) },
					packages: userCfg.packages ?? config.packages,
				};
			} catch {}
		}
	}
	return config;
}

function matchSkillRule(skillPath: string, skillName: string, rules: string[]): "include" | "exclude" | "none" {
	const p = skillPath.replace(/\\/g, "/");
	for (const r of rules) {
		const isExclude = r.startsWith("-");
		const isInclude = r.startsWith("+");
		const pattern = (isExclude || isInclude ? r.slice(1) : r).trim();
		const cleanPattern = pattern.replace(/^\/+/, "");
		if (p.includes(cleanPattern) || skillName === cleanPattern || skillName.includes(cleanPattern)) {
			return isExclude ? "exclude" : "include";
		}
	}
	return "none";
}

export default function promptDiet(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const cwd = (ctx as any)?.cwd || process.cwd();
		const config = loadConfig(cwd);

		if (config.enabled === false) return undefined;

		let prompt = event.systemPrompt;

		// ── 构建 packages 覆盖映射表 ─────────────────────────────────────────
		const overrides = new Map<string, PackageOverrideConfig>();
		if (Array.isArray(config.packages)) {
			for (const item of config.packages) {
				if (item && typeof item === "object" && item.source) {
					const norm = normalizeName(item.source);
					overrides.set(norm, item);
					// 同时支持短名称匹配（如 @juicesharp/rpiv-todo 与 rpiv-todo）
					if (norm.includes("/")) {
						overrides.set(norm.split("/").pop()!, item);
					}
				}
			}
		}

		// ── 1. Guidelines 处理 ──────────────────────────────────────────────────
		const globalGMode = config.guidelines?.mode ?? "slim";
		if (globalGMode !== "full") {
			const guidelinesStart = prompt.indexOf("Guidelines:\n");
			if (guidelinesStart !== -1) {
				const candidates = [
					prompt.indexOf("\n\nPi documentation", guidelinesStart),
					prompt.indexOf("\n\nAlways respond in Chinese", guidelinesStart),
					prompt.indexOf("\n\n<available_skills>", guidelinesStart),
				].filter((idx) => idx !== -1);

				if (candidates.length > 0) {
					const nextSectionStart = Math.min(...candidates);
					const rawGuidelinesList = event.systemPromptOptions?.promptGuidelines || [];

					// 检查是否有 package 被显式覆盖为 "full" 保留
					const preservedFullRules: string[] = [];
					for (const g of rawGuidelinesList) {
						const lower = g.toLowerCase();
						for (const [pkgName, pkgCfg] of overrides.entries()) {
							const gMode = typeof pkgCfg.guidelines === "object" ? pkgCfg.guidelines?.mode : pkgCfg.guidelines;
							if (gMode === "full" && lower.includes(pkgName)) {
								preservedFullRules.push(`- ${g}`);
								break;
							}
						}
					}

					let slimText = "";
					if (globalGMode === "slim") {
						const core = config.guidelines?.customCore ?? DEFAULT_CORE_GUIDELINES;
						const allLines = [...core, ...preservedFullRules];
						slimText = `Guidelines:\n${allLines.join("\n")}`;
					} else if (globalGMode === "strip" && preservedFullRules.length > 0) {
						slimText = `Guidelines:\n${preservedFullRules.join("\n")}`;
					}

					prompt = prompt.slice(0, guidelinesStart) + slimText + prompt.slice(nextSectionStart);
				}
			}
		}

		// ── 2. Skills 处理（支持按包/技能独立指定 compress / strip / full） ────────
		const globalSMode = config.skills?.mode ?? "compress";
		if (globalSMode !== "full" || overrides.size > 0) {
			const skillsStart = prompt.indexOf("<available_skills>");
			const skillsEnd = prompt.indexOf("</available_skills>");
			if (skillsStart !== -1 && skillsEnd !== -1) {
				const rawSkills = event.systemPromptOptions?.skills || [];
				const globalMaxLen = config.skills?.maxDescriptionLength ?? 120;

				const activeSkillBlocks: string[] = [];

				for (const s of rawSkills) {
					if (s.disableModelInvocation) continue;

					// 查找该 Skill 是否命中了 package override
					const sNameNorm = normalizeName(s.name);
					const sSourceNorm = s.sourceInfo?.source ? normalizeName(s.sourceInfo.source) : "";
					
					const override = overrides.get(sNameNorm) || (sSourceNorm ? overrides.get(sSourceNorm) : undefined);
					const rawOverrideSkills = override?.skills;
					
					let effectiveMode = globalSMode;
					let itemMaxLen: number | undefined = undefined;

					// ── 1. 细粒度规则数组模式 (["-skills/council-mode", ...]) ──
					if (Array.isArray(rawOverrideSkills)) {
						const res = matchSkillRule(s.filePath, s.name, rawOverrideSkills);
						if (res === "exclude") continue;
					} 
					// ── 2. 精准文件路径键值映射模式 ({"skills/council-mode": "full", "skills/pi-subagents": "strip"}) ──
					else if (typeof rawOverrideSkills === "object" && rawOverrideSkills !== null) {
						if (Array.isArray((rawOverrideSkills as any).rules)) {
							const res = matchSkillRule(s.filePath, s.name, (rawOverrideSkills as any).rules);
							if (res === "exclude") continue;
						} else if ("mode" in rawOverrideSkills) {
							effectiveMode = (rawOverrideSkills as any).mode ?? globalSMode;
							itemMaxLen = (rawOverrideSkills as any).maxDescriptionLength;
						} else {
							// 遍历键值对匹配技能路径或名称
							const p = s.filePath.replace(/\\/g, "/");
							for (const [key, val] of Object.entries(rawOverrideSkills)) {
								const cleanKey = key.replace(/^\/+/, "");
								if (p.includes(cleanKey) || s.name === cleanKey || s.name.includes(cleanKey)) {
									if (typeof val === "string") {
										effectiveMode = (val === "slim" ? "compress" : val) as TreatmentMode;
									} else if (typeof val === "object" && val !== null) {
										effectiveMode = (val.mode === "slim" ? "compress" : val.mode) ?? globalSMode;
										itemMaxLen = val.maxDescriptionLength;
									}
									break;
								}
							}
						}
					} 
					// ── 3. 统一字符串模式 ("strip" | "compress" | "full") ──
					else if (typeof rawOverrideSkills === "string") {
						effectiveMode = (rawOverrideSkills === "slim" ? "compress" : rawOverrideSkills) as TreatmentMode;
					}

					if (effectiveMode === "strip") {
						// 彻底剥离该技能
						continue;
					}

					let desc = (s.description || "").trim();
					if (effectiveMode === "compress" || effectiveMode === "slim") {
						const maxLen = itemMaxLen ?? override?.maxDescriptionLength ?? globalMaxLen;
						desc = desc.split("\n")[0];
						if (desc.length > maxLen) {
							desc = `${desc.slice(0, maxLen - 3)}...`;
						}
					}
					// full 模式则原汁原味保留完整 desc

					desc = desc.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
					activeSkillBlocks.push(`  <skill>\n    <name>${s.name}</name>\n    <description>${desc}</description>\n    <location>${s.filePath}</location>\n  </skill>`);
				}

				const slimSkillsSection = activeSkillBlocks.length > 0
					? `<available_skills>\n${activeSkillBlocks.join("\n")}\n</available_skills>`
					: "";

				prompt = prompt.slice(0, skillsStart) + slimSkillsSection + prompt.slice(skillsEnd + "</available_skills>".length);
			}
		}

		return { systemPrompt: prompt };
	});
}
