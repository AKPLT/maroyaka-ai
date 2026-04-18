const { EmbedBuilder } = require("discord.js");
const prompts = require("./prompts");
const { collectServerLogs, collectChannelLogs } = require("./logs");
const {
  generateAiSummary,
  generateConversationReply,
  modelNameCommon,
  modelNameHaiku,
} = require("./ai");
const schedule = require("./schedule");
const { parseTopicsToFields } = require("./utils");

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

  const ephemeral = interaction.options.getBoolean("private") ?? true;
  await interaction.deferReply({ ephemeral });
  isProcessing = true;
  const progress = makeProgress(interaction);

  const start = Date.now();
  console.log(
    `[cmd] /${interaction.commandName} 開始 user=${interaction.user.tag} guild=${interaction.guildId}`,
  );

  try {
    const logText =
      interaction.commandName === "news"
        ? await collectServerLogs(interaction.guild, progress)
        : await collectChannelLogs(interaction.channel, progress);

    if (!logText) {
      console.warn(
        `[cmd] /${interaction.commandName} ログ取得結果が空のため終了`,
      );
      return interaction.deleteReply();
    }

    const modelName =
      interaction.commandName === "haiku" ? modelNameHaiku : modelNameCommon;
    let promptConfig = prompts[interaction.commandName];
    if (["news", "summary"].includes(interaction.commandName)) {
      const style = interaction.options.getString("style") ?? "maroyaka";
      promptConfig =
        prompts.SUMMARY_STYLES[style] ?? prompts.SUMMARY_STYLES.maroyaka;
      console.log(`[cmd] /${interaction.commandName} スタイル=${style}`);
    }
    const replyContent = await generateAiSummary(
      promptConfig,
      logText,
      progress,
      modelName,
    );

    const embed = new EmbedBuilder()
      .setTitle(
        getEmbedTitle(interaction.commandName, interaction.channel.name),
      )
      .setColor(0xf5c2e7)
      .setTimestamp();

    const fields = parseTopicsToFields(replyContent);
    if (fields) {
      embed.addFields(fields);
    } else {
      const safeContent =
        replyContent.length > 4096
          ? replyContent.substring(0, 4093) + "..."
          : replyContent;
      embed.setDescription(safeContent);
    }
    await interaction.editReply({ content: "", embeds: [embed] });
    console.log(
      `[cmd] /${interaction.commandName} 完了 (${((Date.now() - start) / 1000).toFixed(1)}s)`,
    );
  } catch (error) {
    console.error(
      `[cmd] /${interaction.commandName} エラー (${((Date.now() - start) / 1000).toFixed(1)}s):`,
      error,
    );
    await interaction.deleteReply().catch(() => {});
  } finally {
    isProcessing = false;
  }
}

async function handleSuggestTopic(interaction) {
  if (isProcessing) {
    return interaction.reply({ content: BUSY_MESSAGE, ephemeral: true });
  }

  const ephemeral = interaction.options.getBoolean("private") ?? true;
  await interaction.deferReply({ ephemeral });
  isProcessing = true;
  const progress = makeProgress(interaction);

  const start = Date.now();
  console.log(`[cmd] /suggesttopic 開始 user=${interaction.user.tag}`);
  try {
    const logText = await collectChannelLogs(interaction.channel, progress);
    if (!logText) {
      console.warn(`[cmd] /suggesttopic ログ取得結果が空のため終了`);
      return interaction.deleteReply();
    }

    const suggestion = await generateAiSummary(
      prompts.topic,
      logText,
      progress,
    );
    if (!suggestion) return interaction.deleteReply();

    const embed = new EmbedBuilder()
      .setTitle("次の話題はこちらですっ")
      .setDescription(suggestion)
      .setColor(0xf5c2e7)
      .setTimestamp();
    await interaction.editReply({ content: "", embeds: [embed] });
    console.log(
      `[cmd] /suggesttopic 完了 (${((Date.now() - start) / 1000).toFixed(1)}s)`,
    );
  } catch (error) {
    console.error(
      `[cmd] /suggesttopic エラー (${((Date.now() - start) / 1000).toFixed(1)}s):`,
      error,
    );
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
  const enabledStatus = schedule.isNewsEnabled(interaction.guildId)
    ? "オン"
    : "オフ";
  return interaction.reply({
    content: `現在の定期配信先は ${schedule.getScheduledChannelMention(interaction.guildId)}、配信時刻は ${schedule.getScheduleTimeString(interaction.guildId)}、スタイルは「${styleName}」、定期配信は **${enabledStatus}** です。`,
    ephemeral: true,
  });
}

async function handleToggleNews(interaction) {
  const enabled = interaction.options.getBoolean("enabled");
  schedule.setNewsEnabled(interaction.guildId, enabled);
  const status = enabled ? "オン" : "オフ";
  return interaction.reply({
    content: `定期配信を **${status}** にしました。`,
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
          "`private` 自分にだけ見えるメッセージで返す（デフォルト: オン）",
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
          "`/setnewsenabled` 定期配信のオン/オフを設定",
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
const MAX_CONVERSATION_DEPTH = 10;

const CONVERSATION_SYSTEM = `あなたはDiscordサーバーのかわいいAIキャラクター「まろやかAI」です。

【絶対に守ること】
- 1〜3文の短い返答のみ出力すること
- 語尾は「〜ですっ」「〜ましたっ」などの可愛い口調にすること
- 会話の流れに自然に乗ること
- 日本語のみで回答すること`;

async function buildConversationHistory(message, botId) {
  const messages = [];
  let current = message;

  while (current && messages.length < MAX_CONVERSATION_DEPTH) {
    messages.unshift({
      role: current.author.id === botId ? "assistant" : "user",
      content: current.content,
    });
    if (!current.reference?.messageId) break;
    try {
      current = await current.channel.messages.fetch(
        current.reference.messageId,
      );
    } catch {
      break;
    }
  }
  return messages;
}

async function handleMessageCreate(message, botId) {
  if (message.author.bot) return;

  // ボットへのリプライ → 会話継続
  if (message.reference?.messageId) {
    try {
      const referenced = await message.channel.messages.fetch(
        message.reference.messageId,
      );
      if (referenced.author.id === botId) {
        console.log(
          `[msg] リプライ検出 user=${message.author.tag} channel=${message.channelId}`,
        );
        const history = await buildConversationHistory(message, botId);
        console.log(`[msg] 会話履歴=${history.length}件`);
        const reply = await generateConversationReply(
          CONVERSATION_SYSTEM,
          history,
        );
        await message
          .reply(reply)
          .catch((e) =>
            console.error(`[msg] リプライ送信エラー: ${e.message}`),
          );
        return;
      }
    } catch (e) {
      console.error(`[msg] リプライ元メッセージ取得エラー: ${e.message}`);
    }
  }

  // 「まろやかAI」またはメンション → 必ず反応（空リプ）
  const mentionsBot = message.mentions.users.has(botId);
  if (!mentionsBot && !message.content.includes("まろやかAI")) return;

  const now = Date.now();
  const lastTime = maroyakaCooldowns.get(message.channelId) ?? 0;
  if (now - lastTime < MAROYAKA_COOLDOWN_MS) {
    const remaining = Math.ceil(
      (MAROYAKA_COOLDOWN_MS - (now - lastTime)) / 60000,
    );
    console.log(
      `[msg] まろやかAI検出 クールダウン中 残り約${remaining}分 channel=${message.channelId}`,
    );
    return;
  }
  maroyakaCooldowns.set(message.channelId, now);
  console.log(
    `[msg] まろやかAI検出 反応生成 user=${message.author.tag} channel=${message.channelId}`,
  );

  try {
    const reply = await generateAiSummary(
      prompts.maroyakaReaction,
      message.content,
    );
    await message.channel
      .send(reply || MAROYAKA_FALLBACK_RESPONSES[0])
      .catch((e) => console.error(`[msg] 送信エラー: ${e.message}`));
  } catch (e) {
    console.error(`[msg] まろやかAI反応エラー: ${e.message}`);
    const fallback =
      MAROYAKA_FALLBACK_RESPONSES[
        Math.floor(Math.random() * MAROYAKA_FALLBACK_RESPONSES.length)
      ];
    await message.channel.send(fallback).catch(() => {});
  }
}

module.exports = {
  AI_COMMANDS,
  parseTopicsToFields,
  handleSlashCommand,
  handleSuggestTopic,
  handleSetNewsChannel,
  handleGetNewsChannel,
  handleSetNewsTime,
  handleSetNewsStyle,
  handleToggleNews,
  handleHelp,
  handleMessageCreate,
};
