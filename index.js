require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");
const commands = require("./commands");
const schedule = require("./schedule");
const handlers = require("./handlers");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

schedule.init(client);

// --- コマンドの登録 ---
(async () => {
  try {
    const guildIds = process.env.DISCORD_GUILD_IDS
      ? process.env.DISCORD_GUILD_IDS.split(",")
      : [];
    if (guildIds.length === 0) return console.warn("GUILD_IDSが設定されていません。");

    const rest = new REST({ version: "10" }).setToken(token);
    console.log("スラッシュコマンドを登録中...");
    for (const guildId of guildIds) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId.trim()), { body: commands });
    }
    console.log("登録完了！");
  } catch (error) {
    console.error("登録エラー:", error);
  }
})();

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
  schedule.setClientReady();
  schedule.scheduleDailyNews();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "setnewschannel") return handlers.handleSetNewsChannel(interaction);
  if (commandName === "setnewstime")    return handlers.handleSetNewsTime(interaction);
  if (commandName === "getnewschannel") return handlers.handleGetNewsChannel(interaction);
  if (commandName === "suggesttopic")   return handlers.handleSuggestTopic(interaction);
  if (handlers.AI_COMMANDS.includes(commandName)) return handlers.handleSlashCommand(interaction);
});

client.login(token);
