const summaryWindowMs = 24 * 60 * 60 * 1000;
const emojiPattern =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

function isPublicTextChannel(channel, guild) {
  return (
    channel.isTextBased() &&
    !channel.isThread() &&
    channel.permissionsFor(guild.roles.everyone)?.has("ViewChannel")
  );
}

async function fetchAndCleanLogs(channel, cutoff) {
  let lastId = null;
  let channelAllMessages = [];

  try {
    let fetchCount = 0;
    while (fetchCount < 500) {
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

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch (err) {
    console.error(`[#${channel.name}] 取得エラー: ${err.message}`);
  }

  const validMessages = channelAllMessages.filter(
    (m) =>
      !m.author.bot && !m.content.startsWith("/") && m.content.trim() !== "",
  );

  const uniqueUserIds = [...new Set(validMessages.map((m) => m.author.id))];
  const memberMap = new Map();
  try {
    const members = await channel.guild.members.fetch({ user: uniqueUserIds });
    members.forEach((member) => memberMap.set(member.id, member));
  } catch {
    // フェッチ失敗時はメッセージ付属のmemberにフォールバック
  }

  console.log(
    `[logs] #${channel.name} 有効メッセージ=${validMessages.length}件`,
  );
  return validMessages
    .map((m) => {
      const member = memberMap.get(m.author.id) ?? m.member;
      const authorName =
        member?.nickname ?? member?.displayName ?? m.author.username;

      let text = m.content
        .replace(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/g, "")
        .replace(emojiPattern, "")
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

async function collectServerLogs(guild, onProgress = null) {
  const cutoff = Date.now() - summaryWindowMs;
  await guild.channels.fetch();

  const channels = [
    ...guild.channels.cache
      .filter((channel) => isPublicTextChannel(channel, guild))
      .values(),
  ];

  let allLogs = [];
  let totalCount = 0;
  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i];
    console.log(`取得中... #${channel.name}`);
    onProgress?.(
      `#${channel.name} を取得中ですっ... (${i + 1}/${channels.length}チャンネル, 計${totalCount}件)`,
    );
    const logs = await fetchAndCleanLogs(channel, cutoff);
    totalCount += logs.length;
    allLogs.push(...logs);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(
    `[logs] サーバー全体 合計=${totalCount}件 チャンネル数=${channels.length}`,
  );
  return allLogs.reverse().join("\n");
}

async function collectChannelLogs(channel, onProgress = null) {
  const cutoff = Date.now() - summaryWindowMs;
  onProgress?.(`#${channel.name} のメッセージを取得中ですっ...`);
  const logs = await fetchAndCleanLogs(channel, cutoff);
  onProgress?.(`#${channel.name} から ${logs.length}件 取得しましたっ`);
  return logs.reverse().join("\n");
}

module.exports = { fetchAndCleanLogs, collectServerLogs, collectChannelLogs };
