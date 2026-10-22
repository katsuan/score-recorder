// 端末に残った中身（ろくが・さくせん盤）を読むところのテスト。node --test test/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const XSS = "<img src=x onerror=alert(1)>"; // qcheck-ok: W8 テストの見本の文字（画面では動かさない）

const code = fs.readFileSync(path.join(__dirname, "../js/core.js"), "utf8");

// 端末に store（キー → 文字）を入れて core.js を読み、state を返す
function boot(store) {
  const mem = { ...store };
  const localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => (mem[k] = String(v))
  };
  const ctx = vm.createContext({ localStorage, document: {} });
  vm.runInContext(code, ctx);
  return { state: vm.runInContext("state", ctx), shareTeams: vm.runInContext("shareTeams", ctx), mem };
}

test("なにも残っていなければ初めの値", () => {
  const { state } = boot({});
  assert.equal(state.teamUs, "");
  assert.equal(state.us, 0);
  assert.equal(state.colorUs, "#22a447");
});

test("壊れた JSON・配列・数・null でも落ちない", () => {
  for (const bad of ["{", "[1,2]", "5", "null", '"abc"', "\u0000"]) {
    const { state } = boot({ "soccer:state": bad, "roqga:state": bad });
    assert.equal(state.teamUs, "");
    assert.equal(state.us, 0);
  }
});

test("さくせん盤のチーム名が文字でなければ使わない", () => {
  const { state } = boot({ "soccer:state": JSON.stringify({ team: { a: 1 }, opponent: 12 }), "roqga:state": JSON.stringify({ teamUs: "前の名前" }) });
  assert.equal(state.teamUs, "前の名前");
  assert.equal(state.teamThem, "");
  assert.equal(typeof state.teamUs.trim(), "string");
});

test("チーム名は文字のまま、20 字まで", () => {
  const { state } = boot({ "soccer:state": JSON.stringify({ team: XSS, opponent: "あ".repeat(500) }) });
  assert.equal(state.teamUs, XSS.slice(0, 20));
  assert.equal([...state.teamThem].length, 20);
});

test("色は #rrggbb だけ", () => {
  const { state } = boot({ "soccer:state": JSON.stringify({ ourColor: "red;background:url(x)", oppColor: XSS }) });
  assert.equal(state.colorUs, "#22a447");
  assert.equal(state.colorThem, "#ffffff");
});

test("点は 0〜999 の整数", () => {
  const cases = [["-5", 0], [1e9, 999], ["abc", 0], [2.7, 2], [{}, 0], [3, 3]];
  for (const [v, want] of cases) assert.equal(boot({ "roqga:state": JSON.stringify({ us: v }) }).state.us, want);
});

test("エフェクトの文字・アイコン・つなぎ目は文字だけ、長さに上限", () => {
  const { state } = boot({ "roqga:state": JSON.stringify({ fxIcon: ["⚽"], fxCustom: "x".repeat(99), fxText: XSS, transition: 5, hand: XSS, turn: "up" }) });
  assert.equal(state.fxIcon, "⚽");
  assert.equal(state.fxCustom.length, 16);
  assert.equal(state.fxText.length, 12);
  assert.equal(state.transition, "roqga");
  assert.equal(state.hand, "center");
  assert.equal(state.turn, null);
});

test("さくせん盤へ書くときは、チーム名・色だけを変え、ほかはそのまま", () => {
  const { state, shareTeams, mem } = boot({ "soccer:state": JSON.stringify({ team: "A", players: [1, 2] }) });
  state.teamThem = "B";
  shareTeams();
  const now = JSON.parse(mem["soccer:state"]);
  assert.deepEqual(now.players, [1, 2]);
  assert.equal(now.opponent, "B");
});
