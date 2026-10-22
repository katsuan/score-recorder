// ろくが：はじめに一度だけ動かすこと（ほかのファイルを全部読んでから。最初の表示）。
"use strict";

showSetupScore();
showHand();
showSides();
showGoalFxSetting();
showFxLabel();
renderTransitionChoices();
renderColorChips();
// プレビューは、字（M PLUS Rounded）を読みこんだあとにも描き直す
drawPreview();
document.fonts?.ready.then(drawPreview);
