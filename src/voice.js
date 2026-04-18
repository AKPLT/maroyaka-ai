const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");
const { Readable } = require("stream");

const VOICEVOX_URL = process.env.VOICEVOX_URL ?? "http://localhost:50021";
const VOICEVOX_SPEAKER = parseInt(process.env.VOICEVOX_SPEAKER ?? "1", 10);
const MAX_TTS_LENGTH = 120;

const emojiPattern =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

const voiceStates = new Map();

async function synthesize(text) {
  const truncated = text.substring(0, MAX_TTS_LENGTH);
  const queryRes = await fetch(
    `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(truncated)}&speaker=${VOICEVOX_SPEAKER}`,
    { method: "POST" },
  );
  if (!queryRes.ok) throw new Error(`audio_query failed: ${queryRes.status}`);
  const query = await queryRes.json();

  const synthRes = await fetch(
    `${VOICEVOX_URL}/synthesis?speaker=${VOICEVOX_SPEAKER}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    },
  );
  if (!synthRes.ok) throw new Error(`synthesis failed: ${synthRes.status}`);
  return Buffer.from(await synthRes.arrayBuffer());
}

function cleanForTts(text) {
  return text
    .replace(/https?:\/\/\S+/g, "URL省略")
    .replace(/<@!?\d+>/g, "")
    .replace(/<#\d+>/g, "")
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(emojiPattern, "")
    .trim();
}

async function processQueue(guildId) {
  const state = voiceStates.get(guildId);
  if (!state || state.processing || state.queue.length === 0) return;

  state.processing = true;
  const text = state.queue.shift();

  try {
    const buffer = await synthesize(text);
    const resource = createAudioResource(Readable.from(buffer));
    state.player.play(resource);
  } catch (err) {
    console.error(`[voice] TTS エラー: ${err.message}`);
    state.processing = false;
    processQueue(guildId);
  }
}

function startReading(voiceChannel, textChannelId) {
  const guildId = voiceChannel.guild.id;

  if (voiceStates.has(guildId)) {
    voiceStates.get(guildId).connection.destroy();
    voiceStates.delete(guildId);
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });

  const player = createAudioPlayer();
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    const state = voiceStates.get(guildId);
    if (!state) return;
    state.processing = false;
    processQueue(guildId);
  });

  player.on("error", (err) => {
    console.error(`[voice] プレイヤーエラー: ${err.message}`);
    const state = voiceStates.get(guildId);
    if (state) {
      state.processing = false;
      processQueue(guildId);
    }
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
      voiceStates.delete(guildId);
      console.log(`[voice] VC切断: guild=${guildId}`);
    }
  });

  voiceStates.set(guildId, {
    connection,
    player,
    voiceChannelId: voiceChannel.id,
    textChannelId,
    queue: [],
    processing: false,
  });

  console.log(
    `[voice] 読み上げ開始: guild=${guildId} vc=${voiceChannel.name} ch=${textChannelId}`,
  );
}

function stopReading(guildId) {
  const state = voiceStates.get(guildId);
  if (!state) return false;
  state.connection.destroy();
  voiceStates.delete(guildId);
  console.log(`[voice] 読み上げ停止: guild=${guildId}`);
  return true;
}

function enqueueMessage(message) {
  const state = voiceStates.get(message.guildId);
  if (!state || state.textChannelId !== message.channelId) return;
  if (message.author.bot || message.content.startsWith("/")) return;

  const cleaned = cleanForTts(message.content);
  if (!cleaned) return;

  const name = message.member?.nickname ?? message.author.displayName;
  const text = `${name}。${cleaned}`;
  state.queue.push(text);
  console.log(`[voice] キュー追加 (${state.queue.length}件): "${text.substring(0, 40)}"`);
  processQueue(message.guildId);
}

function checkAndLeaveIfEmpty(guild) {
  const guildId = guild.id;
  const state = voiceStates.get(guildId);
  if (!state) return;

  const channel = guild.channels.cache.get(state.voiceChannelId);
  if (!channel) return;

  const humanCount = channel.members.filter((m) => !m.user.bot).size;
  if (humanCount === 0) {
    console.log(`[voice] VCが空になったため退出: guild=${guildId}`);
    stopReading(guildId);
  }
}

function isReading(guildId) {
  return voiceStates.has(guildId);
}

function getReadingTextChannelId(guildId) {
  return voiceStates.get(guildId)?.textChannelId ?? null;
}

module.exports = {
  startReading,
  stopReading,
  enqueueMessage,
  checkAndLeaveIfEmpty,
  isReading,
  getReadingTextChannelId,
};
