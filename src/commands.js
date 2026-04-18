const { SlashCommandBuilder } = require("discord.js");
const { STYLE_CHOICES } = require("./prompts");

function boolOption(name, description) {
  return (option) => option.setName(name).setDescription(description);
}

const privateOpt = boolOption(
  "private",
  "自分にだけ見えるメッセージで返します",
);
const validateOpt = boolOption(
  "validate",
  "出力を検証し問題があれば再生成します（True: 低速・高品質 / False: 高速）",
);

function aiCommand(name, description) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .addBooleanOption(privateOpt)
    .addBooleanOption(validateOpt);
}

function aiCommandWithStyle(name, description) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .addStringOption((option) =>
      option
        .setName("style")
        .setDescription("要約のスタイル")
        .addChoices(...STYLE_CHOICES),
    )
    .addBooleanOption(privateOpt)
    .addBooleanOption(validateOpt);
}

const commands = [
  aiCommandWithStyle("news", "サーバー全体の24時間をまろやかに要約します"),
  aiCommandWithStyle("summary", "チャンネルの24時間をまろやかに要約します"),
  aiCommand("haiku", "サーバー全体の24時間の出来事を五・七・五で詠みます"),
  aiCommand("story", "チャンネルの24時間の会話をもとに短編小説を書きます"),
  aiCommand(
    "question",
    "チャンネルの会話をもとに、みんなへの質問を1つ投げかけます",
  ),
  aiCommand("suggesttopic", "過去の会話をもとに、次の話題を提案します"),
  aiCommand("mvp", "今日一番面白かった発言を選びます"),
  aiCommand("fortune", "今日の会話の雰囲気でサーバーのおみくじを引きます"),
  aiCommand("title", "今日活躍したメンバーに称号を授けます"),
  aiCommand("wanted", "今日一番やらかしたメンバーの指名手配書を作成します"),
  new SlashCommandBuilder()
    .setName("setnewschannel")
    .setDescription("定期配信先チャンネルを設定します")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("定期配信先のチャンネルを指定してください")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("setnewstime")
    .setDescription("定期配信の時刻を設定します")
    .addIntegerOption((option) =>
      option
        .setName("hour")
        .setDescription("時 (0-23)")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(23),
    )
    .addIntegerOption((option) =>
      option
        .setName("minute")
        .setDescription("分 (0-59)")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(59),
    ),
  new SlashCommandBuilder()
    .setName("getnewschannel")
    .setDescription("現在の定期配信先チャンネルと時刻を表示します"),
  new SlashCommandBuilder()
    .setName("setnewsstyle")
    .setDescription("定期配信の要約スタイルを設定します")
    .addStringOption((option) =>
      option
        .setName("style")
        .setDescription("要約のスタイル")
        .setRequired(true)
        .addChoices(...STYLE_CHOICES),
    ),
  new SlashCommandBuilder()
    .setName("startreading")
    .setDescription("VCに入ってこのチャンネルのメッセージを読み上げます"),
  new SlashCommandBuilder()
    .setName("stopreading")
    .setDescription("読み上げを停止してVCから退出します"),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("使えるコマンドの一覧を表示します"),
].map((command) => command.toJSON());

module.exports = commands;
