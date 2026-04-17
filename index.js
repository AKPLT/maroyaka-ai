require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { Ollama } = require("ollama");
const prompts = require("./prompts");
const thinkingMessages = require("./thinkingMessages");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const ollamaIp = process.env.OLLAMA_HOST_IP;
const modelName = process.env.OLLAMA_MODEL;

const ollama = new Ollama({ host: `http://${ollamaIp}:11434` });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- コマンドの定義 ---
const commands = [
  new SlashCommandBuilder()
    .setName("news")
    .setDescription("サーバー全体の24時間をまろやかに要約します")
    .addBooleanOption((option) =>
      option.setName("private").setDescription("自分にだけ見えるメッセージで返します"),
    )
    .addBooleanOption((option) =>
      option.setName("validate").setDescription("出力を検証し問題があれば再生成します（True: 低速・高品質 / False: 高速）"),
    ),
  new SlashCommandBuilder()
    .setName("summary")
    .setDescription("チャンネルの24時間をまろやかに要約します")
    .addBooleanOption((option) =>
      option.setName("private").setDescription("自分にだけ見えるメッセージで返します"),
    )
    .addBooleanOption((option) =>
      option.setName("validate").setDescription("出力を検証し問題があれば再生成します（True: 低速・高品質 / False: 高速）"),
    ),
  new SlashCommandBuilder()
    .setName("haiku")
    .setDescription("サーバー全体の24時間の出来事を五・七・五で詠みます")
    .addBooleanOption((option) =>
      option.setName("private").setDescription("自分にだけ見えるメッセージで返します"),
    )
    .addBooleanOption((option) =>
      option.setName("validate").setDescription("出力を検証し問題があれば再生成します（True: 低速・高品質 / False: 高速）"),
    ),
  new SlashCommandBuilder()
    .setName("story")
    .setDescription("チャンネルの24時間の会話をもとに短編小説を書きます")
    .addBooleanOption((option) =>
      option.setName("private").setDescription("自分にだけ見えるメッセージで返します"),
    )
    .addBooleanOption((option) =>
      option.setName("validate").setDescription("出力を検証し問題があれば再生成します（True: 低速・高品質 / False: 高速）"),
    ),
  new SlashCommandBuilder()
    .setName("question")
    .setDescription("チャンネルの会話をもとに、みんなへの質問を1つ投げかけます")
    .addBooleanOption((option) =>
      option.setName("private").setDescription("自分にだけ見えるメッセージで返します"),
    )
    .addBooleanOption((option) =>
      option.setName("validate").setDescription("出力を検証し問題があれば再生成します（True: 低速・高品質 / False: 高速）"),
    ),
  new SlashCommandBuilder()
    .setName("suggesttopic")
    .setDescription("過去の会話をもとに、次の話題を提案します")
    .addBooleanOption((option) =>
      option.setName("private").setDescription("自分にだけ見えるメッセージで返します"),
    )
    .addBooleanOption((option) =>
      option.setName("validate").setDescription("出力を検証し問題があれば再生成します（True: 低速・高品質 / False: 高速）"),
    ),
  new SlashCommandBuilder()
    .setName("mvp")
    .setDescription("今日一番面白かった発言を選びます")
    .addBooleanOption((option) =>
      option.setName("private").setDescription("自分にだけ見えるメッセージで返します"),
    )
    .addBooleanOption((option) =>
      option.setName("validate").setDescription("出力を検証し問題があれば再生成します（True: 低速・高品質 / False: 高速）"),
    ),
  new SlashCommandBuilder()
    .setName("fortune")
    .setDescription("今日の会話の雰囲気でサーバーのおみくじを引きます")
    .addBooleanOption((option) =>
      option.setName("private").setDescription("自分にだけ見えるメッセージで返します"),
    )
    .addBooleanOption((option) =>
      option.setName("validate").setDescription("出力を検証し問題があれば再生成します（True: 低速・高品質 / False: 高速）"),
    ),
  new SlashCommandBuilder()
    .setName("title")
    .setDescription("今日活躍したメンバーに称号を授けます")
    .addBooleanOption((option) =>
      option.setName("private").setDescription("自分にだけ見えるメッセージで返します"),
    )
    .addBooleanOption((option) =>
      option.setName("validate").setDescription("出力を検証し問題があれば再生成します（True: 低速・高品質 / False: 高速）"),
    ),
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
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

// --- コマンドの登録 ---
// (async () => {
//   try {
//     console.log("スラッシュコマンドをグローバルに登録中...");
//     console.log("反映まで最大1時間ほどかかる場合があります。");

//     // Routes.applicationCommands(clientId) を使うのが本番形式です
//     await rest.put(
//       Routes.applicationCommands(clientId),
//       { body: commands }
//     );

//     console.log("全サーバーへのグローバル登録リクエストが完了しました！");
//   } catch (error) {
//     console.error("グローバル登録エラー:", error);
//   }
// })();

//  --- ギルドごとへの即時登録（テスト用） ---
(async () => {
  try {
    const guildIds = process.env.DISCORD_GUILD_IDS
      ? process.env.DISCORD_GUILD_IDS.split(",")
      : [];
    if (guildIds.length === 0)
      return console.warn("GUILD_IDSが設定されていません。");

    console.log("スラッシュコマンドを登録中...");
    for (const guildId of guildIds) {
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId.trim()),
        { body: commands },
      );
    }
    console.log("登録完了！");
  } catch (error) {
    console.error("登録エラー:", error);
  }
})();

// --- API制限対策付き：メッセージ取得関数 ---
async function fetchAndCleanLogs(channel, cutoff) {
  let lastId = null;
  let channelAllMessages = [];

  try {
    let fetchCount = 0;
    while (fetchCount < 500) {
      // 安全のため1チャンネル500件まで
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const fetched = await channel.messages.fetch(options).catch(() => null);
      if (!fetched || fetched.size === 0) break;

      const validMessages = fetched.filter((m) => m.createdTimestamp > cutoff);
      channelAllMessages.push(...validMessages.values());

      fetchCount += fetched.size;
      if (fetched.size < 100 || fetched.last().createdTimestamp <= cutoff)
        break;
      lastId = fetched.last().id;

      // API制限を避けるための短い待機
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch (err) {
    console.error(`[#${channel.name}] 取得エラー: ${err.message}`);
  }

  const validMessages = channelAllMessages.filter(
    (m) => !m.author.bot && !m.content.startsWith("/") && m.content.trim() !== "",
  );

  const uniqueUserIds = [...new Set(validMessages.map((m) => m.author.id))];
  const memberMap = new Map();
  try {
    const members = await channel.guild.members.fetch({ user: uniqueUserIds });
    members.forEach((member) => memberMap.set(member.id, member));
  } catch {
    // フェッチ失敗時はメッセージ付属のmemberにフォールバック
  }

  return validMessages
    .map((m) => {
      const member = memberMap.get(m.author.id) ?? m.member;
      const authorName =
        member?.nickname ?? member?.displayName ?? m.author.username;

      let text = m.content
        .replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, "")
        .replace(
          /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
          "",
        )
        .replace(/<a?:\w+:\d+>/g, "")
        .trim();

      const time = new Date(m.createdTimestamp).toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      return text ? `[#${channel.name}][${time}] ${authorName}: ${text}` : null;
    })
    .filter((log) => log !== null);
}

const scheduleConfigPath = path.join(__dirname, "scheduleConfig.json");
let scheduleConfig = loadScheduleConfig();
const scheduledTasks = new Map();
let isClientReady = false;
let isProcessing = false;
const summaryWindowMs = 24 * 60 * 60 * 1000;
const logCharLimit = parseInt(process.env.LOG_CHAR_LIMIT ?? "16000", 10);
const emojiPattern =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

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
  } catch (error) {
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
  const parsedHour = normalizeScheduleNumber(hour, 8);
  const parsedMinute = normalizeScheduleNumber(minute, 0);

  return setGuildConfig(guildId, {
    scheduleHour: parsedHour,
    scheduleMinute: parsedMinute,
  });
}

function getScheduleTimeString(guildId) {
  const { scheduleHour, scheduleMinute } = getScheduleTime(guildId);
  return `${String(scheduleHour).padStart(2, "0")}:${String(
    scheduleMinute,
  ).padStart(2, "0")}`;
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

  const cronExpression = getScheduleCronExpression(guildId);
  const task = cron.schedule(cronExpression, async () => {
    const channel =
      client.channels.cache.get(channelId) ||
      (await client.channels.fetch(channelId).catch(() => null));

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
  for (const task of scheduledTasks.values()) {
    task.stop();
  }
  scheduledTasks.clear();

  const guildIds = Object.keys(scheduleConfig.guilds || {});
  const hasLegacy = !!scheduleConfig.legacy?.channelId;

  if (guildIds.length === 0 && hasLegacy) {
    const task = cron.schedule(
      `${scheduleConfig.legacy.scheduleMinute} ${scheduleConfig.legacy.scheduleHour} * * *`,
      async () => {
        const channelId = scheduleConfig.legacy.channelId;
        const channel =
          client.channels.cache.get(channelId) ||
          (await client.channels.fetch(channelId).catch(() => null));

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
      `定期ニュース配信を cron でスケジュールしました: 毎日 ${String(
        scheduleConfig.legacy.scheduleHour,
      ).padStart(2, "0")}:${String(
        scheduleConfig.legacy.scheduleMinute,
      ).padStart(2, "0")} に実行されます。`,
    );
    return;
  }

  if (guildIds.length === 0) {
    console.warn(
      "定期配信先チャンネルが未設定です。定期ニュース配信は無効です。",
    );
    return;
  }

  for (const guildId of guildIds) {
    scheduleGuildNews(guildId);
  }

  console.log(
    `定期ニュース配信を cron でスケジュールしました: 毎日 ${
      guildIds.length === 1
        ? getScheduleTimeString(guildIds[0])
        : "各サーバーの設定時刻"
    } に実行されます。`,
  );
}

function sanitizeText(text) {
  return text.replace(emojiPattern, "").trim();
}

function isPublicTextChannel(channel, guild) {
  return (
    channel.isTextBased() &&
    !channel.isThread() &&
    channel.permissionsFor(guild.roles.everyone)?.has("ViewChannel")
  );
}

async function collectServerLogs(guild, onProgress = null) {
  const cutoff = Date.now() - summaryWindowMs;
  await guild.channels.fetch();

  const channels = [...guild.channels.cache.filter((channel) =>
    isPublicTextChannel(channel, guild),
  ).values()];

  let allLogs = [];
  let totalCount = 0;
  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i];
    console.log(`取得中... #${channel.name}`);
    onProgress?.(`#${channel.name} を取得中ですっ... (${i + 1}/${channels.length}チャンネル, 計${totalCount}件)`);
    const logs = await fetchAndCleanLogs(channel, cutoff);
    totalCount += logs.length;
    allLogs.push(...logs);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return allLogs.reverse().join("\n");
}

async function collectChannelLogs(channel, onProgress = null) {
  const cutoff = Date.now() - summaryWindowMs;
  onProgress?.(`#${channel.name} のメッセージを取得中ですっ...`);
  const logs = await fetchAndCleanLogs(channel, cutoff);
  onProgress?.(`#${channel.name} から ${logs.length}件 取得しましたっ`);
  return logs.reverse().join("\n");
}

function startThinkingInterval(onProgress, intervalMs = 4000) {
  if (!onProgress) return () => {};
  const tick = () => {
    const msg = thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)];
    onProgress(`まろやかAIが頑張っていますっ…！（${msg}）`);
  };
  tick();
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}

async function validateOutput(output, promptConfig, ollamaTimeoutMs) {
  const response = await ollama.chat(
    {
      model: modelName,
      messages: [
        { role: "system", content: promptConfig.system },
        {
          role: "user",
          content: `以下の出力がシステムプロンプトのすべてのルールを厳密に守っているか確認してください。YESまたはNOのみで答えてください。\n\n${output}`,
        },
      ],
    },
    { signal: AbortSignal.timeout(ollamaTimeoutMs) },
  );
  return response.message.content.trim().toUpperCase().startsWith("YES");
}

async function generateAiSummary(promptConfig, logText, validate = false, onProgress = null) {
  const truncatedLog = logText.substring(0, logCharLimit);
  const logFilePath = path.join(__dirname, "last_prompt.log");
  fs.writeFileSync(
    logFilePath,
    [`=== ${new Date().toISOString()} ===`, `--- SYSTEM ---`, promptConfig.system, `--- USER ---`, promptConfig.user(truncatedLog)].join("\n"),
    "utf8",
  );

  const ollamaTimeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS ?? "300000", 10);
  const maxAttempts = validate ? 3 : 1;
  let lastOutput = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const stopThinking = startThinkingInterval(onProgress);
    try {
      const response = await ollama.chat(
        {
          model: modelName,
          messages: [
            { role: "system", content: promptConfig.system },
            { role: "user", content: promptConfig.user(truncatedLog) },
          ],
        },
        { signal: AbortSignal.timeout(ollamaTimeoutMs) },
      );
      lastOutput = sanitizeText(response.message.content);
    } finally {
      stopThinking();
    }

    if (!validate) break;

    onProgress?.(`回答を検証中ですっ... (${attempt + 1}/${maxAttempts}回目)`);
    console.log(`バリデーション中... (${attempt + 1}/${maxAttempts}回目)`);
    const isValid = await validateOutput(lastOutput, promptConfig, ollamaTimeoutMs);
    if (isValid) {
      console.log(`バリデーション成功 (${attempt + 1}回目)`);
      break;
    }
    if (attempt < maxAttempts - 1) {
      onProgress?.(`もう一度試みますっ... (${attempt + 2}/${maxAttempts}回目)`);
      console.log(`バリデーション失敗 (${attempt + 1}回目)、再生成中...`);
    } else {
      console.log(`バリデーション失敗 (最終試行)、最後の出力を使用します`);
    }
  }

  return lastOutput;
}

async function createNewsSummary(guild) {
  const logText = await collectServerLogs(guild);
  if (!logText) return null;

  console.log(`Ollama (${modelName}) に送信中...`);
  const summary = await generateAiSummary(prompts.news, logText);
  return { summary, logText };
}

async function createHaikuSummary(logText) {
  if (!logText) return null;
  return generateAiSummary(prompts.haiku, logText);
}

async function createTopicSuggestion(logText) {
  if (!logText) return null;
  return generateAiSummary(prompts.topic, logText);
}

async function postScheduledNews(channel) {
  if (!channel || !channel.isTextBased() || channel.isThread()) return;

  try {
    const result = await createNewsSummary(channel.guild);
    if (!result) return;

    const mvp = await generateAiSummary(prompts.mvp, result.logText);
    const haiku = await createHaikuSummary(result.logText);
    const embed = new EmbedBuilder()
      .setTitle("24時間のニュースですっ")
      .setDescription(result.summary)
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

function getEmbedTitle(commandName, channelName) {
  if (commandName === "haiku") return "今日の一句ですっ";
  if (commandName === "news") return "24時間のニュースですっ";
  if (commandName === "story") return "今日の物語ですっ";
  if (commandName === "question") return "ちょっといい？";
  if (commandName === "mvp") return "今日のMVPですっ";
  if (commandName === "fortune") return "今日のおみくじですっ";
  if (commandName === "title") return "今日の称号ですっ";
  return `#${channelName} の24時間ですっ`;
}

async function handleSlashCommand(interaction) {
  if (isProcessing) {
    return interaction.reply({ content: "今ほかのコマンドを処理中ですっ！もう少しだけ待ってくださいねっ", ephemeral: true });
  }

  const ephemeral = interaction.options.getBoolean("private") ?? false;
  await interaction.deferReply({ ephemeral });
  isProcessing = true;
  const progress = (msg) => interaction.editReply({ content: msg, embeds: [] }).catch(() => {});

  try {
    let logText = "";
    if (interaction.commandName === "news") {
      console.log("全チャンネルの巡回を開始...");
      logText = await collectServerLogs(interaction.guild, progress);
    } else {
      logText = await collectChannelLogs(interaction.channel, progress);
    }

    if (!logText) {
      return interaction.deleteReply();
    }

    const validate = interaction.options.getBoolean("validate") ?? false;
    const promptConfig = prompts[interaction.commandName];
    const replyContent = await generateAiSummary(promptConfig, logText, validate, progress);

    const title = getEmbedTitle(
      interaction.commandName,
      interaction.channel.name,
    );
    const embed = new EmbedBuilder()
      .setTitle(title)
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

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
  isClientReady = true;
  scheduleDailyNews();
});

async function handleSetNewsChannel(interaction) {
  const channel = interaction.options.getChannel("channel");
  if (!channel || !channel.isTextBased() || channel.isThread()) {
    return interaction.reply({
      content: "有効なテキストチャンネルを指定してください。",
      ephemeral: true,
    });
  }

  setScheduledChannelId(interaction.guildId, channel.id);
  return interaction.reply({
    content: `定期配信先を ${channel} に設定しました。`,
    ephemeral: true,
  });
}

async function handleGetNewsChannel(interaction) {
  return interaction.reply({
    content: `現在の定期配信先は ${getScheduledChannelMention(
      interaction.guildId,
    )}、配信時刻は ${getScheduleTimeString(interaction.guildId)} です。`,
    ephemeral: true,
  });
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

  setScheduleTime(interaction.guildId, hour, minute);

  const message = `定期配信時刻を ${getScheduleTimeString(
    interaction.guildId,
  )} に設定しました。`;
  const channelId = getScheduledChannelId(interaction.guildId);
  const notice = channelId
    ? ""
    : "まだ配信先が設定されていないため、定期配信は実行されません。";

  return interaction.reply({
    content: `${message}${notice ? `\n${notice}` : ""}`,
    ephemeral: true,
  });
}

async function handleSuggestTopic(interaction) {
  if (isProcessing) {
    return interaction.reply({ content: "今ほかのコマンドを処理中ですっ！もう少しだけ待ってくださいねっ", ephemeral: true });
  }

  const ephemeral = interaction.options.getBoolean("private") ?? false;
  await interaction.deferReply({ ephemeral });
  isProcessing = true;
  const progress = (msg) => interaction.editReply({ content: msg, embeds: [] }).catch(() => {});

  const logText = await collectChannelLogs(interaction.channel, progress);
  if (!logText) {
    isProcessing = false;
    return interaction.deleteReply();
  }

  const validate = interaction.options.getBoolean("validate") ?? false;
  console.log("話題提案を生成中...");
  try {
    const suggestion = await generateAiSummary(prompts.topic, logText, validate, progress);
    if (!suggestion) {
      return interaction.deleteReply();
    }

    const embed = new EmbedBuilder()
      .setTitle("次の話題はこちらですっ")
      .setDescription(suggestion)
      .setColor(0xf5c2e7)
      .setTimestamp();
    return interaction.editReply({ content: "", embeds: [embed] });
  } catch (error) {
    console.error("Topic suggestion error:", error);
    return interaction.deleteReply().catch(() => {});
  } finally {
    isProcessing = false;
  }
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const commandName = interaction.commandName;
  if (commandName === "setnewschannel") {
    await handleSetNewsChannel(interaction);
    return;
  }

  if (commandName === "setnewstime") {
    await handleSetNewsTime(interaction);
    return;
  }

  if (commandName === "getnewschannel") {
    await handleGetNewsChannel(interaction);
    return;
  }

  if (commandName === "suggesttopic") {
    await handleSuggestTopic(interaction);
    return;
  }

  if (["news", "summary", "haiku", "story", "question", "mvp", "fortune", "title"].includes(commandName)) {
    await handleSlashCommand(interaction);
  }
});

client.login(token);
