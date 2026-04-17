const { maroyakaBase, STYLE_CHOICES, SUMMARY_STYLES } = require("./styles");
const individual = require("./individual");

module.exports = {
  // 要約スタイル管理
  STYLE_CHOICES,
  SUMMARY_STYLES,

  // /news・/summary のデフォルト
  news: maroyakaBase,
  summary: maroyakaBase,

  // 個別コマンドプロンプト
  ...individual,
};
