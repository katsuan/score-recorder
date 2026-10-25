// ろくが：入口。はじめに一度だけ動かすこと（最初の表示：スコア・左右・設定・色・プレビュー、はじめての人への使い方）。
// index.html の最後に読む（js/ のファイルの関数を使うので、全部読んでから）。
"use strict";

showSetupScore();
showHand();
showSides();
showGoalFxSetting();
showFxLabel();
showSplitSetting();
renderHighlightRange();
showResultCardSetting();
showLineHint();
renderTransitionChoices();
// プレビューは、字（M PLUS Rounded）を読みこんだあとにも描き直す
drawPreview();
document.fonts?.ready.then(drawPreview);
// はじめて開いた人にだけ、使い方を3つ（Q キットの firstTip。「わかった」で消え、この端末では次から出さない）。
// ui.js は defer なので、読みこみ終わってから
document.addEventListener("DOMContentLoaded", () =>
  window.LineShareUI?.firstTip(
    "roqga",
    ["チーム名と色を決める（さくせん盤と共通）", "📹 撮りながら：横にして撮り、点が入ったら ＋1", "🎞 撮った動画に：あとから得点板を入れる"],
    document.querySelector(".teams")
  )
);
