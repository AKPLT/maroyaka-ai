require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { Ollama } = require("ollama");

const token = process.env.DISCORD_TOKEN;
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

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.content === "!maroyaka" && !message.author.bot) {
    await message.channel.sendTyping();
    console.log("全チャンネルの全件取得・要約を開始します...");

    try {
      const duration = 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - duration;
      let allLogs = [];

      const channels = message.guild.channels.cache.filter(
        (c) => c.isTextBased() && !c.isThread(),
      );

      for (const [id, channel] of channels) {
        try {
          let lastId = null;
          let channelAllMessages = [];

          // --- 再帰的なメッセージ取得ループ ---
          while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const fetched = await channel.messages.fetch(options);
            if (fetched.size === 0) break;

            // 24時間以内のメッセージだけを抽出
            const validMessages = fetched.filter(
              (m) => m.createdTimestamp > cutoff,
            );
            channelAllMessages.push(...validMessages.values());

            lastId = fetched.last().id;

            // 取得した中に24時間より古いものが含まれていたら終了
            if (fetched.last().createdTimestamp <= cutoff || fetched.size < 100)
              break;
          }

          // --- データのクリーニング ---
          const cleanedLogs = channelAllMessages
            .filter((m) => {
              // Botの発言、!で始まるコマンド、空のメッセージを除外
              return (
                !m.author.bot &&
                !m.content.startsWith("!") &&
                m.content.trim() !== ""
              );
            })
            .map((m) => {
              let text = m.content
                // URLを除去
                .replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, "")
                // 絵文字(Unicode)を除去
                .replace(
                  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
                  "",
                )
                // カスタム絵文字を除去
                .replace(/<a?:\w+:\d+>/g, "")
                .trim();

              return text
                ? `[#${channel.name}] ${m.author.username}: ${text}`
                : null;
            })
            .filter((log) => log !== null);

          allLogs.push(...cleanedLogs);
        } catch (err) {
          console.error(`[${channel.name}] 取得失敗:`, err.message);
        }
      }

      // ログを時系列順に戻す
      const finalLog = allLogs.reverse().join("\n");

      if (!finalLog)
        return message.reply(
          "過去24時間に要約対象のメッセージはありませんでした。",
        );

      // --- Ollamaリクエスト ---
      const response = await ollama.chat({
        model: modelName,
        messages: [
          {
            role: "system",
            content:
              "あなたはサーバーのログを分析し、可愛くまろやかに伝えるマネージャーです。日本語で回答し、絵文字やURL、コマンド情報は含めないでください。重要なトピックを10個、優しい口調で要約してください。",
          },
          {
            role: "user",
            content: `以下のログから重要な出来事を教えてね：\n\n${finalLog.substring(0, 6000)}`,
          },
        ],
      });

      // 最終的な回答からも余計な装飾をカット
      const replyContent = response.message.content.replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
        "",
      );

      message.reply(
        `サーバーの24時間をまろやかにまとめましたっ\n\n${replyContent.trim()}`,
      );
    } catch (error) {
      console.error("Error:", error);
      message.reply("ごめんなさい、要約中にエラーが起きちゃいました。");
    }
  }
});

client.login(token);
