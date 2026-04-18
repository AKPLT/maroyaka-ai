const { EmbedBuilder } = require("discord.js");
const prompts = require("./prompts");
const { collectServerLogs, collectChannelLogs } = require("./logs");
const { generateAiSummary, modelNameCommon, modelNameHaiku } = require("./ai");
const schedule = require("./schedule");

const AI_COMMANDS = [
  "news",
  "summary",
  "haiku",
  "story",
  "question",
  "mvp",
  "fortune",
  "title",
  "wanted",
];

let isProcessing = false;

const BUSY_MESSAGE =
  "今ほかのコマンドを処理中ですっ！もう少しだけ待ってくださいねっ";

const EMBED_TITLES = {
  haiku: "今日の一句ですっ",
  news: "24時間のニュースですっ",
  story: "今日の物語ですっ",
  question: "ちょっといい？",
  mvp: "今日のMVPですっ",
  fortune: "今日のおみくじですっ",
  title: "今日の称号ですっ",
  wanted: "🚨 本日の指名手配 🚨",

};

function getEmbedTitle(commandName, channelName) {
  return EMBED_TITLES[commandName] ?? `#${channelName} の24時間ですっ`;
}

function makeProgress(interaction) {
  return (msg) =>
    interaction.editReply({ content: msg, embeds: [] }).catch(() => {});
}

async function handleSlashCommand(interaction) {
  if (isProcessing) {
    return interaction.reply({ content: BUSY_MESSAGE, ephemeral: true });
  }

  const ephemeral = interaction.options.getBoolean("private") ?? false;
  await interaction.deferReply({ ephemeral });
  isProcessing = true;
  const progress = makeProgress(interaction);

  try {
    const logText =
      interaction.commandName === "news"
        ? await collectServerLogs(interaction.guild, progress)
        : await collectChannelLogs(interaction.channel, progress);

    if (!logText) return interaction.deleteReply();

    const modelName =
      interaction.commandName === "haiku" ? modelNameHaiku : modelNameCommon;
    const validate = interaction.options.getBoolean("validate") ?? false;
    let promptConfig = prompts[interaction.commandName];
    if (["news", "summary"].includes(interaction.commandName)) {
      const style = interaction.options.getString("style") ?? "maroyaka";
      promptConfig =
        prompts.SUMMARY_STYLES[style] ?? prompts.SUMMARY_STYLES.maroyaka;
    }
    const replyContent = await generateAiSummary(
      promptConfig,
      logText,
      validate,
      progress,
      modelName,
    );

    // replyContentを安全に切り詰める処理
    const safeContent =
      replyContent.length > 4096
        ? replyContent.substring(0, 4093) + "..."
        : replyContent;

    const embed = new EmbedBuilder()
      .setTitle(
        getEmbedTitle(interaction.commandName, interaction.channel.name),
      )
      .setDescription(safeContent) // 安全な文字列を渡す
      .setColor(0xf5c2e7)
      .setTimestamp();
    await interaction.editReply({ content: "", embeds: [embed] });
  } catch (error) {
    console.error("Error:", error);
    await interaction.deleteReply().catch(() => {});
  } finally {
    isProcessing = false;
  }
}

async function handleSuggestTopic(interaction) {
  if (isProcessing) {
    return interaction.reply({ content: BUSY_MESSAGE, ephemeral: true });
  }

  const ephemeral = interaction.options.getBoolean("private") ?? false;
  await interaction.deferReply({ ephemeral });
  isProcessing = true;
  const progress = makeProgress(interaction);

  try {
    const logText = await collectChannelLogs(interaction.channel, progress);
    if (!logText) return interaction.deleteReply();

    const validate = interaction.options.getBoolean("validate") ?? false;
    const suggestion = await generateAiSummary(
      prompts.topic,
      logText,
      validate,
      progress,
    );
    if (!suggestion) return interaction.deleteReply();

    const embed = new EmbedBuilder()
      .setTitle("次の話題はこちらですっ")
      .setDescription(suggestion)
      .setColor(0xf5c2e7)
      .setTimestamp();
    await interaction.editReply({ content: "", embeds: [embed] });
  } catch (error) {
    console.error("Topic suggestion error:", error);
    await interaction.deleteReply().catch(() => {});
  } finally {
    isProcessing = false;
  }
}

async function handleSetNewsChannel(interaction) {
  const channel = interaction.options.getChannel("channel");
  if (!channel || !channel.isTextBased() || channel.isThread()) {
    return interaction.reply({
      content: "有効なテキストチャンネルを指定してください。",
      ephemeral: true,
    });
  }
  schedule.setScheduledChannelId(interaction.guildId, channel.id);
  return interaction.reply({
    content: `定期配信先を ${channel} に設定しました。`,
    ephemeral: true,
  });
}

async function handleGetNewsChannel(interaction) {
  const styleName =
    prompts.STYLE_CHOICES.find(
      (c) => c.value === schedule.getNewsStyle(interaction.guildId),
    )?.name ?? "まろやか（デフォルト）";
  return interaction.reply({
    content: `現在の定期配信先は ${schedule.getScheduledChannelMention(interaction.guildId)}、配信時刻は ${schedule.getScheduleTimeString(interaction.guildId)}、スタイルは「${styleName}」です。`,
    ephemeral: true,
  });
}

async function handleSetNewsStyle(interaction) {
  const style = interaction.options.getString("style");
  schedule.setNewsStyle(interaction.guildId, style);
  const styleName =
    prompts.STYLE_CHOICES.find((c) => c.value === style)?.name ?? style;
  return interaction.reply({
    content: `定期配信のスタイルを「${styleName}」に設定しました。`,
    ephemeral: true,
  });
}

async function handleHelp(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("まろやかAI コマンド一覧ですっ")
    .addFields(
      {
        name: "サーバー全体のAIコマンド",
        value: [
          "`/news` サーバー全体の24時間をまろやかに要約",
          "`/haiku` 今日の出来事を五・七・五で詠む",
          "`/mvp` 今日一番面白かった発言を選ぶ",
          "`/title` 今日活躍したメンバーに称号を授ける",
          "`/wanted` 今日一番やらかしたメンバーの指名手配書",
          "`/fortune` 今日の雰囲気でサーバーのおみくじ",
        ].join("\n"),
      },
      {
        name: "チャンネルのAIコマンド",
        value: [
          "`/summary` チャンネルの24時間を要約",
          "`/story` 今日の会話をもとに短編小説を書く",
          "`/question` みんなへの質問を1つ投げかける",
          "`/suggesttopic` 次の話題を提案する",

        ].join("\n"),
      },
      {
        name: "共通オプション（AIコマンド）",
        value: [
          "`private` 自分にだけ見えるメッセージで返す",
          "`validate` 出力を検証して再生成（True: 低速・高品質）",
          "`style` 要約スタイルを選択（`/news` `/summary` のみ）",
        ].join("\n"),
      },
      {
        name: "設定コマンド",
        value: [
          "`/setnewschannel` 定期配信先チャンネルを設定",
          "`/setnewstime` 定期配信の時刻を設定",
          "`/setnewsstyle` 定期配信の要約スタイルを設定",
          "`/getnewschannel` 現在の定期配信設定を確認",
        ].join("\n"),
      },
    )
    .setColor(0xf5c2e7)
    .setTimestamp();
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleSetNewsTime(interaction) {
  const hour = interaction.options.getInteger("hour");
  const minute = interaction.options.getInteger("minute");

  if (hour === null || minute === null) {
    return interaction.reply({
      content: "有効な時刻を指定してください。",
      ephemeral: true,
    });
  }

  schedule.setScheduleTime(interaction.guildId, hour, minute);

  const timeStr = schedule.getScheduleTimeString(interaction.guildId);
  const channelId = schedule.getScheduledChannelId(interaction.guildId);
  const notice = channelId
    ? ""
    : "\nまだ配信先が設定されていないため、定期配信は実行されません。";

  return interaction.reply({
    content: `定期配信時刻を ${timeStr} に設定しました。${notice}`,
    ephemeral: true,
  });
}

const MAROYAKA_FALLBACK_RESPONSES = [
  "呼びましたかっ？！",
  "なんですかっ？！",
  "はいっ、ここにいますっ！",
  "わたしのことですかっ？！",
];

const maroyakaCooldowns = new Map();
const MAROYAKA_COOLDOWN_MS = 60 * 60 * 1000;

async function handleMessageCreate(message) {
  if (message.author.bot) return;
  if (!message.content.includes("まろやか")) return;

  const now = Date.now();
  const lastTime = maroyakaCooldowns.get(message.channelId) ?? 0;
  if (now - lastTime < MAROYAKA_COOLDOWN_MS) return;

  maroyakaCooldowns.set(message.channelId, now);

  try {
    const reply = await generateAiSummary(
      prompts.maroyakaReaction,
      message.content,
    );
    await message.reply(reply || MAROYAKA_FALLBACK_RESPONSES[0]).catch(() => {});
  } catch {
    const fallback =
      MAROYAKA_FALLBACK_RESPONSES[
        Math.floor(Math.random() * MAROYAKA_FALLBACK_RESPONSES.length)
      ];
    await message.reply(fallback).catch(() => {});
  }
}

module.exports = {
  AI_COMMANDS,
  handleSlashCommand,
  handleSuggestTopic,
  handleSetNewsChannel,
  handleGetNewsChannel,
  handleSetNewsTime,
  handleSetNewsStyle,
  handleHelp,
  handleMessageCreate,
};
