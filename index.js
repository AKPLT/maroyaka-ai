require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const { Ollama } = require("ollama");
const prompts = require("./prompts");

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
    .setDescription("サーバー全体の24時間をまろやかに要約します"),
  new SlashCommandBuilder()
    .setName("summary")
    .setDescription("このチャンネルだけの24時間を要約します"),
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
    if (guildIds.length === 0) {
      console.warn("DISCORD_GUILD_IDS が設定されていません。");
      return;
    }

    console.log("スラッシュコマンドを各サーバーに即時登録中...");
    for (const guildId of guildIds) {
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId.trim()),
        { body: commands },
      );
    }
    console.log("全サーバーへの登録が完了しました！");
  } catch (error) {
    console.error("コマンド登録エラー:", error);
  }
})();

// --- メッセージ取得・クリーンアップ関数 ---
async function fetchAndCleanLogs(channel, cutoff) {
  let lastId = null;
  let channelAllMessages = [];

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const fetched = await channel.messages.fetch(options);
    if (fetched.size === 0) break;

    const validMessages = fetched.filter((m) => m.createdTimestamp > cutoff);
    channelAllMessages.push(...validMessages.values());

    if (fetched.size < 100 || fetched.last().createdTimestamp <= cutoff) break;
    lastId = fetched.last().id;
  }

  return channelAllMessages
    .filter(
      (m) =>
        !m.author.bot && !m.content.startsWith("/") && m.content.trim() !== "",
    )
    .map((m) => {
      let text = m.content
        .replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, "") // URL除去
        .replace(
          /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
          "",
        ) // 絵文字除去
        .replace(/<a?:\w+:\d+>/g, "") // カスタム絵文字除去
        .trim();
      return text ? `[#${channel.name}] ${m.author.username}: ${text}` : null;
    })
    .filter((log) => log !== null);
}

client.on("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  if (commandName === "news" || commandName === "summary") {
    await interaction.deferReply();

    try {
      const duration = 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - duration;
      let allLogs = [];

      if (commandName === "news") {
        console.log("全チャンネルの巡回を開始...");
        const channels = interaction.guild.channels.cache.filter(
          (c) => c.isTextBased() && !c.isThread() && c.viewable,
        );
        for (const [id, channel] of channels) {
          const logs = await fetchAndCleanLogs(channel, cutoff);
          allLogs.push(...logs);
        }
      } else {
        console.log(`${interaction.channel.name} の取得を開始...`);
        const logs = await fetchAndCleanLogs(interaction.channel, cutoff);
        allLogs.push(...logs);
      }

      const finalLog = allLogs.reverse().join("\n");
      if (!finalLog)
        return interaction.editReply(
          "過去24時間に新しい投稿は見つかりませんでしたっ",
        );

      const promptConfig = prompts[commandName];
      const response = await ollama.chat({
        model: modelName,
        messages: [
          { role: "system", content: promptConfig.system },
          {
            role: "user",
            content: promptConfig.user(finalLog.substring(0, 6000)),
          },
        ],
      });

      // AIの回答からも絵文字を除去
      const replyContent = response.message.content.replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
        "",
      );

      const title =
        commandName === "news"
          ? "サーバー全体"
          : `#${interaction.channel.name}`;
      await interaction.editReply(
        `${title}の24時間をまろやかにまとめましたっ\n\n${replyContent.trim()}`,
      );
    } catch (error) {
      console.error("Error:", error);
      await interaction.editReply(
        "ごめんなさい、要約中にエラーが起きちゃいました。",
      );
    }
  }
});

client.login(token);
