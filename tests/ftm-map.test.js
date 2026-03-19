import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("ftm-map", () => {
    const skillDir = join(__dirname, "..", "ftm-map");
    const skillMd = join(skillDir, "SKILL.md");
    const skillYml = join(__dirname, "..", "ftm-map.yml");
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "ftm-manifest.json"), "utf8"));

    it("has SKILL.md with required frontmatter", () => {
        const content = readFileSync(skillMd, "utf8");
        assert.ok(content.includes("name: ftm-map"), "Missing name in frontmatter");
        assert.ok(content.includes("description:"), "Missing description in frontmatter");
    });

    it("has .yml trigger file", () => {
        assert.ok(existsSync(skillYml), "ftm-map.yml should exist");
        const content = readFileSync(skillYml, "utf8");
        assert.ok(content.includes("name: ftm-map"), "yml should contain skill name");
    });

    it("declares map_updated event", () => {
        const content = readFileSync(skillMd, "utf8");
        assert.ok(content.includes("map_updated"), "Should declare map_updated event");
    });

    it("listens to code_committed event", () => {
        const content = readFileSync(skillMd, "utf8");
        assert.ok(content.includes("code_committed"), "Should listen to code_committed");
    });

    it("appears in manifest", () => {
        const mapSkill = manifest.skills.find(s => s.name === "ftm-map");
        assert.ok(mapSkill, "ftm-map should appear in manifest");
    });

    it("has three modes documented", () => {
        const content = readFileSync(skillMd, "utf8");
        assert.ok(content.includes("Bootstrap") || content.includes("bootstrap"), "Should document bootstrap mode");
        assert.ok(content.includes("Incremental") || content.includes("incremental"), "Should document incremental mode");
        assert.ok(content.includes("Query") || content.includes("query"), "Should document query mode");
    });

    it("has Python scripts", () => {
        const scripts = ["db.py", "parser.py", "index.py", "query.py", "views.py"];
        for (const script of scripts) {
            assert.ok(
                existsSync(join(skillDir, "scripts", script)),
                `Missing script: ${script}`
            );
        }
    });

    it("has setup.sh", () => {
        const setupPath = join(skillDir, "scripts", "setup.sh");
        assert.ok(existsSync(setupPath), "setup.sh should exist");
        const stats = statSync(setupPath);
        assert.ok(stats.mode & 0o111, "setup.sh should be executable");
    });

    it("has tree-sitter query files", () => {
        const queries = ["typescript-tags.scm", "python-tags.scm", "javascript-tags.scm"];
        for (const q of queries) {
            assert.ok(
                existsSync(join(skillDir, "scripts", "queries", q)),
                `Missing query file: ${q}`
            );
        }
    });
});
