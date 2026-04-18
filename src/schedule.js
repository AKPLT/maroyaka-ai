const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { EmbedBuilder } = require("discord.js");
const prompts = require("./prompts");
const { collectServerLogs } = require("./logs");
const { generateAiSummary } = require("./ai");

const ROOT = path.join(__dirname, "..");
const scheduleConfigPath = path.join(ROOT, "scheduleConfig.json");
const scheduledTasks = new Map();

let discordClient = null;
let isClientReady = false;

let scheduleConfig = loadScheduleConfig();

function init(client) {
  discordClient = client;
}

function setClientReady() {
  isClientReady = true;
}

function loadScheduleConfig() {
  try {
    const text = fs.readFileSync(scheduleConfigPath, "utf8");
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !data.guilds) {
      const legacy = {
        channelId: data.scheduledChannelId || null,
        scheduleHour:
          typeof data.scheduleHour === "number" ? data.scheduleHour : 8,
        scheduleMinute:
          typeof data.scheduleMinute === "number" ? data.scheduleMinute : 0,
      };
      return { guilds: {}, legacy };
    }
    return data && typeof data === "object" ? data : { guilds: {} };
  } catch {
    return { guilds: {} };
  }
}

function saveScheduleConfig() {
  try {
    fs.writeFileSync(
      scheduleConfigPath,
      JSON.stringify(scheduleConfig, null, 2),
      "utf8",
    );
  } catch (error) {
    console.error("scheduleConfig 保存エラー:", error);
  }
}

function getGuildConfig(guildId) {
  return scheduleConfig.guilds?.[guildId] || {};
}

function getScheduledChannelId(guildId) {
  return getGuildConfig(guildId).channelId || null;
}

function setGuildConfig(guildId, partial) {
  scheduleConfig.guilds = scheduleConfig.guilds || {};
  scheduleConfig.guilds[guildId] = {
    ...scheduleConfig.guilds[guildId],
    ...partial,
  };
  saveScheduleConfig();
  if (isClientReady) scheduleGuildNews(guildId);
  return scheduleConfig.guilds[guildId];
}

function setScheduledChannelId(guildId, channelId) {
  return setGuildConfig(guildId, { channelId });
}

function getScheduledChannelMention(guildId) {
  const channelId = getScheduledChannelId(guildId);
  return channelId ? `<#${channelId}>` : "未設定です";
}

function normalizeScheduleNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return fallback;
  return number;
}

function getScheduleTime(guildId) {
  const guildConfig = getGuildConfig(guildId);
  return {
    scheduleHour:
      typeof guildConfig.scheduleHour === "number"
        ? guildConfig.scheduleHour
        : normalizeScheduleNumber(guildConfig.scheduleHour, 8),
    scheduleMinute:
      typeof guildConfig.scheduleMinute === "number"
        ? guildConfig.scheduleMinute
        : normalizeScheduleNumber(guildConfig.scheduleMinute, 0),
  };
}

function setScheduleTime(guildId, hour, minute) {
  return setGuildConfig(guildId, {
    scheduleHour: normalizeScheduleNumber(hour, 8),
    scheduleMinute: normalizeScheduleNumber(minute, 0),
  });
}

function getNewsStyle(guildId) {
  return getGuildConfig(guildId).newsStyle ?? "maroyaka";
}

function setNewsStyle(guildId, style) {
  return setGuildConfig(guildId, { newsStyle: style });
}

function getScheduleTimeString(guildId) {
  const { scheduleHour, scheduleMinute } = getScheduleTime(guildId);
  return `${String(scheduleHour).padStart(2, "0")}:${String(scheduleMinute).padStart(2, "0")}`;
}

function getScheduleCronExpression(guildId) {
  const { scheduleHour, scheduleMinute } = getScheduleTime(guildId);
  return `${scheduleMinute} ${scheduleHour} * * *`;
}

function scheduleGuildNews(guildId) {
  if (scheduledTasks.has(guildId)) {
    scheduledTasks.get(guildId).stop();
    scheduledTasks.delete(guildId);
  }

  const channelId = getScheduledChannelId(guildId);
  if (!channelId) return;

  const task = cron.schedule(getScheduleCronExpression(guildId), async () => {
    const channel =
      discordClient.channels.cache.get(channelId) ||
      (await discordClient.channels.fetch(channelId).catch(() => null));

    if (!channel) {
      console.warn(
        `定期ニュース配信先チャンネルが見つかりませんでした: ${channelId}`,
      );
      return;
    }

    await postScheduledNews(channel);
  });

  scheduledTasks.set(guildId, task);
}

function scheduleDailyNews() {
  for (const task of scheduledTasks.values()) task.stop();
  scheduledTasks.clear();

  const guildIds = Object.keys(scheduleConfig.guilds || {});
  const hasLegacy = !!scheduleConfig.legacy?.channelId;

  if (guildIds.length === 0 && hasLegacy) {
    const task = cron.schedule(
      `${scheduleConfig.legacy.scheduleMinute} ${scheduleConfig.legacy.scheduleHour} * * *`,
      async () => {
        const channelId = scheduleConfig.legacy.channelId;
        const channel =
          discordClient.channels.cache.get(channelId) ||
          (await discordClient.channels.fetch(channelId).catch(() => null));

        if (!channel) {
          console.warn(
            `定期ニュース配信先チャンネルが見つかりませんでした: ${channelId}`,
          );
          return;
        }

        await postScheduledNews(channel);
      },
    );
    scheduledTasks.set("_legacy", task);
    console.log(
      `定期ニュース配信を cron でスケジュールしました: 毎日 ${String(scheduleConfig.legacy.scheduleHour).padStart(2, "0")}:${String(scheduleConfig.legacy.scheduleMinute).padStart(2, "0")} に実行されます。`,
    );
    return;
  }

  if (guildIds.length === 0) {
    console.warn(
      "定期配信先チャンネルが未設定です。定期ニュース配信は無効です。",
    );
    return;
  }

  for (const guildId of guildIds) scheduleGuildNews(guildId);

  console.log(
    `定期ニュース配信を cron でスケジュールしました: 毎日 ${
      guildIds.length === 1
        ? getScheduleTimeString(guildIds[0])
        : "各サーバーの設定時刻"
    } に実行されます。`,
  );
}

function getNextAppearanceTimestamp(guildId) {
  return getGuildConfig(guildId).nextAppearanceTimestamp ?? null;
}

function scheduleNextAppearance(guildId) {
  const days = 25 + Math.floor(Math.random() * 11); // 25〜35日後
  const next = Date.now() + days * 24 * 60 * 60 * 1000;
  setGuildConfig(guildId, { nextAppearanceTimestamp: next });
  console.log(`次回のまろやかAI参上: ${days}日後 (${new Date(next).toLocaleDateString("ja-JP")})`);
}

async function postAppearance(channel) {
  try {
    const message = await generateAiSummary(prompts.appearance, "");
    if (message) await channel.send(message);
  } catch (error) {
    console.error("Appearance post error:", error);
  }
}

async function checkAndPostAppearances() {
  const now = Date.now();
  const guildIds = Object.keys(scheduleConfig.guilds || {});

  for (const guildId of guildIds) {
    const channelId = getScheduledChannelId(guildId);
    if (!channelId) continue;

    const next = getNextAppearanceTimestamp(guildId);
    if (next === null) {
      scheduleNextAppearance(guildId);
      continue;
    }
    if (now < next) continue;

    const channel =
      discordClient.channels.cache.get(channelId) ||
      (await discordClient.channels.fetch(channelId).catch(() => null));

    if (channel) {
      console.log(`まろやかAI参上投稿: guild=${guildId}`);
      await postAppearance(channel);
    }
    scheduleNextAppearance(guildId);
  }
}

let appearanceTask = null;

function scheduleAppearanceCheck() {
  if (appearanceTask) appearanceTask.stop();
  appearanceTask = cron.schedule("0 12 * * *", async () => {
    if (!isClientReady) return;
    await checkAndPostAppearances();
  });
}

const MIN_LOGS_FOR_NEWS = parseInt(process.env.MIN_LOGS_FOR_NEWS ?? "10", 10);

async function postScheduledNews(channel) {
  if (!channel || !channel.isTextBased() || channel.isThread()) return;

  try {
    const logText = await collectServerLogs(channel.guild);
    if (!logText) return;

    const logCount = logText.split("\n").filter((l) => l.trim()).length;
    if (logCount < MIN_LOGS_FOR_NEWS) {
      console.log(`投稿数が少ないため定期ニュースをスキップ (${logCount}件 < ${MIN_LOGS_FOR_NEWS}件)`);
      return;
    }

    console.log(`Ollama に送信中...`);
    const style = getNewsStyle(channel.guild.id);
    const summaryPrompt =
      prompts.SUMMARY_STYLES[style] ?? prompts.SUMMARY_STYLES.maroyaka;
    const summary = await generateAiSummary(summaryPrompt, logText);
    const mvp = await generateAiSummary(prompts.mvp, logText);
    const haiku = await generateAiSummary(prompts.haiku, logText);

    const embed = new EmbedBuilder()
      .setTitle("24時間のニュースですっ")
      .setDescription(summary)
      .addFields(
        { name: "今日のMVP発言…", value: mvp ?? "(MVP の生成に失敗しました)" },
        { name: "最後に一句…", value: haiku ?? "(俳句の生成に失敗しました)" },
      )
      .setColor(0xf5c2e7)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Scheduled news error:", error);
  }
}

module.exports = {
  init,
  setClientReady,
  scheduleDailyNews,
  scheduleGuildNews,
  scheduleAppearanceCheck,
  postScheduledNews,
  getScheduledChannelId,
  setScheduledChannelId,
  getScheduledChannelMention,
  getScheduleTimeString,
  setScheduleTime,
  getNewsStyle,
  setNewsStyle,
};
