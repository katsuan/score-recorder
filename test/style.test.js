// style.css のテスト。node --test test/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
// { selector, body } の並び（@keyframes の中は除く）
const rules = [...css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

// 押したときに光らせる動き（hit）は transform で大きさを変える。位置を transform で決めているボタンにつけると、
// 光っているあいだ位置の指定が消えてずれる（⭐ ナイスが幅の半分だけ右へずれていた）。位置は translate で決める
test("光らせるボタンは、位置を transform で決めない", () => {
  const keyframes = css.match(/@keyframes hit\s*\{[\s\S]*?\}\s*\}/)[0];
  assert.match(keyframes, /transform/);
  const hitClasses = rules
    .filter((r) => /animation:\s*hit\b/.test(r.body))
    .flatMap((r) => r.selector.split(",").map((s) => s.trim().replace(/\.is-hit$/, "")));
  assert.ok(hitClasses.includes(".mark-btn"));
  for (const base of hitClasses) {
    const last = base.split(/\s+/).pop(); // ".side button" なら "button" ではなく、ふつうは ".mark-btn"
    const own = rules.filter((r) => r.selector.split(",").some((s) => s.trim().endsWith(last) && !s.includes(".is-hit")));
    for (const r of own) {
      const m = r.body.match(/(?:^|;)\s*transform:\s*([^;]+)/);
      assert.ok(!m || m[1].trim() === "none", `${r.selector} が transform: ${m && m[1].trim()} で位置を決めている`);
    }
  }
});
