import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "grok");

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

test("review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return Grok's output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /review "\$ARGUMENTS"/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /command:\s*`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/grok-companion\.mjs" review "\$ARGUMENTS"`/);
  assert.match(source, /description:\s*"Grok review"/);
  assert.match(source, /Do not call `BashOutput`/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(source, /Treat untracked files or directories as reviewable work/i);
  assert.match(source, /Recommend waiting only when the review is clearly tiny, roughly 1-2 files total/i);
  assert.match(source, /In every other case, including unclear size, recommend background/i);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(source, /does not support staged-only review, unstaged-only review, or extra focus text/i);
});

test("adversarial review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/adversarial-review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return Grok's output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /adversarial-review "\$ARGUMENTS"/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\] \[focus \.\.\.\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /command:\s*`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/grok-companion\.mjs" adversarial-review "\$ARGUMENTS"`/);
  assert.match(source, /description:\s*"Grok adversarial review"/);
  assert.match(source, /Do not call `BashOutput`/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(source, /Treat untracked files or directories as reviewable work/i);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(source, /uses the same review target selection as `\/grok:review`/i);
  assert.match(source, /supports working-tree review, branch review, and `--base <ref>`/i);
  assert.match(source, /does not support `--scope staged` or `--scope unstaged`/i);
  assert.match(source, /can still take extra focus text after the flags/i);
});

test("delegate commands cover composer, build, and legacy rescue alias", () => {
  const commandFiles = fs.readdirSync(path.join(PLUGIN_ROOT, "commands")).sort();
  assert.deepEqual(commandFiles, [
    "adversarial-review.md",
    "cancel.md",
    "delegate.md",
    "delegate_to_build.md",
    "delegate_to_composer.md",
    "rescue.md",
    "result.md",
    "review.md",
    "setup.md",
    "status.md"
  ]);
});

test("delegate command routes through grok-delegate without Skill recursion", () => {
  const delegate = read("commands/delegate.md");
  const agent = read("agents/grok-delegate.md");
  const runtimeSkill = read("skills/grok-acp-runtime/SKILL.md");

  assert.match(delegate, /The final user-visible response must be Grok's output verbatim/i);
  assert.match(delegate, /allowed-tools:\s*Bash\(node:\*\),\s*AskUserQuestion,\s*Agent/);
  assert.match(delegate, /subagent_type: "grok:grok-delegate"/);
  assert.match(delegate, /do not call `Skill\(grok:grok-delegate\)`/i);
  assert.match(delegate, /--background\|--wait/);
  assert.match(delegate, /--resume\|--fresh/);
  assert.match(delegate, /--model <composer\|build/);
  assert.match(delegate, /--effort <none\|minimal\|low\|medium\|high\|xhigh>/);
  assert.match(delegate, /task-resume-candidate --json/);
  assert.match(delegate, /Continue current Grok session/);
  assert.match(delegate, /Start a new Grok session/);
  assert.match(delegate, /Do not forward them to `task`/i);
  assert.match(agent, /thin forwarding wrapper/i);
  assert.match(agent, /Use exactly one `Bash` call/i);
  assert.match(agent, /Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own/i);
  assert.match(agent, /Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel`/i);
  assert.match(agent, /Return the stdout of the `task` command exactly as-is/i);
  assert.match(runtimeSkill, /grok-companion\.mjs" task "<raw arguments>"/);
  assert.match(runtimeSkill, /composer` → `grok-composer-2\.5-fast`/);
  assert.match(runtimeSkill, /build` or `fast` → `grok-build`/);
});

test("delegate_to_composer and delegate_to_build pin model aliases", () => {
  const composer = read("commands/delegate_to_composer.md");
  const build = read("commands/delegate_to_build.md");

  assert.match(composer, /--model composer/);
  assert.match(composer, /grok-composer-2\.5-fast/);
  assert.match(build, /--model build/);
  assert.match(build, /grok-build/);
});

test("rescue command remains a legacy alias for delegate", () => {
  const rescue = read("commands/rescue.md");
  assert.match(rescue, /Legacy alias/i);
  assert.match(rescue, /Same behavior as `\/grok:delegate`/);
  assert.match(rescue, /Invoke `grok:grok-delegate` \(not `grok:grok-rescue`\)/);
});

test("result and cancel commands are exposed as deterministic runtime entrypoints", () => {
  const result = read("commands/result.md");
  const cancel = read("commands/cancel.md");
  const resultHandling = read("skills/grok-result-handling/SKILL.md");

  assert.match(result, /disable-model-invocation:\s*true/);
  assert.match(result, /grok-companion\.mjs" result "\$ARGUMENTS"/);
  assert.match(cancel, /disable-model-invocation:\s*true/);
  assert.match(cancel, /grok-companion\.mjs" cancel "\$ARGUMENTS"/);
  assert.match(resultHandling, /present it verbatim/i);
});

test("hooks keep session-end cleanup and stop gating enabled", () => {
  const source = read("hooks/hooks.json");
  assert.match(source, /SessionStart/);
  assert.match(source, /SessionEnd/);
  assert.match(source, /stop-review-gate-hook\.mjs/);
  assert.match(source, /session-lifecycle-hook\.mjs/);
});

test("setup command can offer Grok install and still points users to grok login", () => {
  const setup = read("commands/setup.md");

  assert.match(setup, /argument-hint:\s*'\[--enable-review-gate\|--disable-review-gate\]'/);
  assert.match(setup, /AskUserQuestion/);
  assert.match(setup, /curl -fsSL https:\/\/x\.ai\/cli\/install\.sh/);
  assert.match(setup, /grok-companion\.mjs" setup --json \$ARGUMENTS/);
  assert.match(setup, /!grok login/);
});