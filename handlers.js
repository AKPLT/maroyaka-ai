const { EmbedBuilder } = require("discord.js");
const prompts = require("./prompts");
const { collectServerLogs, collectChannelLogs } = require("./logs");
const { generateAiSummary } = require("./ai");
const schedule = require("./schedule");

const AI_COMMANDS = ["news", "summary", "haiku", "story", "question", "mvp", "fortune", "title", "wanted", "drama"];

let isProcessing = false;

const BUSY_MESSAGE = "今ほかのコマンドを処理中ですっ！もう少しだけ待ってくださいねっ";

function getEmbedTitle(commandName, channelName) {
  const titles = {
    haiku:   "今日の一句ですっ",
    news:    "24時間のニュースですっ",
    story:   "今日の物語ですっ",
    question:"ちょっといい？",
    mvp:     "今日のMVPですっ",
    fortune: "今日のおみくじですっ",
    title:   "今日の称号ですっ",
    wanted:  "🚨 本日の指名手配 🚨",
    drama:   "今日の昼ドラですっ",
  };
  return titles[commandName] ?? `#${channelName} の24時間ですっ`;
}

function makeProgress(interaction) {
  return (msg) => interaction.editReply({ content: msg, embeds: [] }).catch(() => {});
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
    const logText = interaction.commandName === "news"
      ? await collectServerLogs(interaction.guild, progress)
      : await collectChannelLogs(interaction.channel, progress);

    if (!logText) return interaction.deleteReply();

    const validate = interaction.options.getBoolean("validate") ?? false;
    const replyContent = await generateAiSummary(prompts[interaction.commandName], logText, validate, progress);

    const embed = new EmbedBuilder()
      .setTitle(getEmbedTitle(interaction.commandName, interaction.channel.name))
      .setDescription(replyContent)
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
    const suggestion = await generateAiSummary(prompts.topic, logText, validate, progress);
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
    return interaction.reply({ content: "有効なテキストチャンネルを指定してください。", ephemeral: true });
  }
  schedule.setScheduledChannelId(interaction.guildId, channel.id);
  return interaction.reply({ content: `定期配信先を ${channel} に設定しました。`, ephemeral: true });
}

async function handleGetNewsChannel(interaction) {
  return interaction.reply({
    content: `現在の定期配信先は ${schedule.getScheduledChannelMention(interaction.guildId)}、配信時刻は ${schedule.getScheduleTimeString(interaction.guildId)} です。`,
    ephemeral: true,
  });
}

async function handleSetNewsTime(interaction) {
  const hour = interaction.options.getInteger("hour");
  const minute = interaction.options.getInteger("minute");

  if (hour === null || minute === null) {
    return interaction.reply({ content: "有効な時刻を指定してください。", ephemeral: true });
  }

  schedule.setScheduleTime(interaction.guildId, hour, minute);

  const timeStr = schedule.getScheduleTimeString(interaction.guildId);
  const channelId = schedule.getScheduledChannelId(interaction.guildId);
  const notice = channelId ? "" : "\nまだ配信先が設定されていないため、定期配信は実行されません。";

  return interaction.reply({ content: `定期配信時刻を ${timeStr} に設定しました。${notice}`, ephemeral: true });
}

module.exports = {
  AI_COMMANDS,
  handleSlashCommand,
  handleSuggestTopic,
  handleSetNewsChannel,
  handleGetNewsChannel,
  handleSetNewsTime,
};
