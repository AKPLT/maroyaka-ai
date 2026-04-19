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
    const logResult =
      interaction.commandName === "news"
        ? await collectServerLogs(interaction.guild, progress)
        : await collectChannelLogs(interaction.channel, progress);

    const logText = logResult.text;
    if (!logText) {
      console.warn(
        `[cmd] /${interaction.commandName} ログ取得結果が空のため終了`,
      );
      return interaction.deleteReply();
    }

    let modelName =
      interaction.commandName === "haiku" ? modelNameHaiku : modelNameCommon;
    let promptConfig = prompts[interaction.commandName];
    if (["news", "summary"].includes(interaction.commandName)) {
      const style = interaction.options.getString("style") ?? "maroyaka";
      promptConfig =
        prompts.SUMMARY_STYLES[style] ?? prompts.SUMMARY_STYLES.maroyaka;
      if (promptConfig.model) modelName = promptConfig.model;
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
    const { text: logText } = await collectChannelLogs(
      interaction.channel,
      progress,
    );
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
  const start = Date.now();
  const channel = interaction.options.getChannel("channel");
  if (!channel || !channel.isTextBased() || channel.isThread()) {
    return interaction.reply({
      content: "有効なテキストチャンネルを指定してください。",
      ephemeral: true,
    });
  }
  schedule.setScheduledChannelId(interaction.guildId, channel.id);
  console.log(
    `[cmd] /setnewschannel user=${interaction.user.tag} channel=${channel.name} (${((Date.now() - start) / 1000).toFixed(1)}s)`,
  );
  return interaction.reply({
    content: `定期配信先を ${channel} に設定しました。`,
    ephemeral: true,
  });
}

async function handleGetNewsChannel(interaction) {
  const start = Date.now();
  const styleName =
    prompts.STYLE_CHOICES.find(
      (c) => c.value === schedule.getNewsStyle(interaction.guildId),
    )?.name ?? "まろやか（デフォルト）";
  const enabledStatus = schedule.isNewsEnabled(interaction.guildId)
    ? "オン"
    : "オフ";
  console.log(
    `[cmd] /getnewschannel user=${interaction.user.tag} (${((Date.now() - start) / 1000).toFixed(1)}s)`,
  );
  return interaction.reply({
    content: `現在の定期配信先は ${schedule.getScheduledChannelMention(interaction.guildId)}、配信時刻は ${schedule.getScheduleTimeString(interaction.guildId)}、スタイルは「${styleName}」、定期配信は **${enabledStatus}** です。`,
    ephemeral: true,
  });
}

async function handleToggleNews(interaction) {
  const start = Date.now();
  const enabled = interaction.options.getBoolean("enabled");
  schedule.setNewsEnabled(interaction.guildId, enabled);
  const status = enabled ? "オン" : "オフ";
  console.log(
    `[cmd] /setnewsenabled user=${interaction.user.tag} enabled=${enabled} (${((Date.now() - start) / 1000).toFixed(1)}s)`,
  );
  return interaction.reply({
    content: `定期配信を **${status}** にしました。`,
    ephemeral: true,
  });
}

async function handleSetNewsStyle(interaction) {
  const start = Date.now();
  const style = interaction.options.getString("style");
  schedule.setNewsStyle(interaction.guildId, style);
  const styleName =
    prompts.STYLE_CHOICES.find((c) => c.value === style)?.name ?? style;
  console.log(
    `[cmd] /setnewsstyle user=${interaction.user.tag} style=${style} (${((Date.now() - start) / 1000).toFixed(1)}s)`,
  );
  return interaction.reply({
    content: `定期配信のスタイルを「${styleName}」に設定しました。`,
    ephemeral: true,
  });
}

async function handleHelp(interaction) {
  const start = Date.now();
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
          "`/excludechannel` 監視・反応の対象からチャンネルを除外",
          "`/includechannel` 除外したチャンネルを監視対象に戻す",
        ].join("\n"),
      },
    )
    .setColor(0xf5c2e7)
    .setTimestamp();
  console.log(
    `[cmd] /help user=${interaction.user.tag} (${((Date.now() - start) / 1000).toFixed(1)}s)`,
  );
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleSetNewsTime(interaction) {
  const start = Date.now();
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

  console.log(
    `[cmd] /setnewstime user=${interaction.user.tag} time=${timeStr} (${((Date.now() - start) / 1000).toFixed(1)}s)`,
  );
  return interaction.reply({
    content: `定期配信時刻を ${timeStr} に設定しました。${notice}`,
    ephemeral: true,
  });
}

const WORDLE_KEYWORDS = /wordle|ワードル/i;

const WORDLE_SYSTEM = `You are playing Wordle. Guess a valid 5-letter English word each turn.

Feedback after each guess:
🟩 = correct letter in the correct position — always keep this letter here
🟨 = correct letter but wrong position — use it in a different position
⬛ = this letter is not in the word at all — never use it again

Rules you must follow:
- NEVER use a letter marked ⬛ in any future guess
- ALWAYS place 🟩 letters in exactly the same position
- ALWAYS include 🟨 letters but in a different position than before
- Each guess must be a real English word

Reply with ONLY the 5-letter uppercase word. No explanation.`;

async function fetchTodaysWordleWord() {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(
    `https://www.nytimes.com/svc/wordle/v2/${today}.json`,
  );
  if (!res.ok) throw new Error(`Wordle API ${res.status}`);
  const data = await res.json();
  return data.solution?.toUpperCase();
}

function computeWordleGrid(guess, answer) {
  const result = ["⬛", "⬛", "⬛", "⬛", "⬛"];
  const ansArr = answer.split("");
  const gssArr = guess.split("");

  for (let i = 0; i < 5; i++) {
    if (gssArr[i] === ansArr[i]) {
      result[i] = "🟩";
      ansArr[i] = null;
      gssArr[i] = null;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (!gssArr[i]) continue;
    const idx = ansArr.indexOf(gssArr[i]);
    if (idx !== -1) {
      result[i] = "🟨";
      ansArr[idx] = null;
    }
  }
  return result.join("");
}

function explainGrid(guess, grid) {
  const cells = [...grid];
  return guess
    .split("")
    .map((letter, i) => {
      if (cells[i] === "🟩") return `${letter}=correct position`;
      if (cells[i] === "🟨") return `${letter}=wrong position`;
      return `${letter}=not in word`;
    })
    .join(", ");
}

async function handleWordleSolve(message) {
  const start = Date.now();
  console.log(
    `[msg] Wordle解読開始 user=${message.author.tag} channel=${message.channelId}`,
  );
  const thinking = await message.channel.send(
    "今日のWordleを解いていますっ…！少し待ってくださいっ！",
  );
  try {
    const word = await fetchTodaysWordleWord();
    if (!word) throw new Error("解答が取得できませんでした");

    const history = [{ role: "user", content: "Make your first guess." }];
    const rows = [];
    let solvedIn = 0;

    for (let turn = 1; turn <= 6; turn++) {
      const raw = await generateConversationReply(WORDLE_SYSTEM, history);
      const guess = (raw.match(/[A-Za-z]{5}/) || [""])[0].toUpperCase();

      if (guess.length !== 5) {
        console.warn(`[wordle] ターン${turn} 無効な推測: "${raw}"`);
        continue;
      }

      const grid = computeWordleGrid(guess, word);
      rows.push(`${turn}. ${grid} ||${guess}||`);
      history.push({ role: "assistant", content: guess });

      if (grid === "🟩🟩🟩🟩🟩") {
        solvedIn = turn;
        break;
      }

      history.push({
        role: "user",
        content: `Result: ${grid} (${explainGrid(guess, grid)})\nMake your next guess using this feedback.`,
      });
    }

    const impressionPrompt = solvedIn
      ? `今日のWordleを${solvedIn}手で解けましたっ！一言感想を「〜ですっ」口調で1文だけお願いします。`
      : `今日のWordleを6手以内に解けませんでしたっ…一言感想を「〜ですっ」口調で1文だけお願いします。`;
    const impression = await generateConversationReply(CONVERSATION_SYSTEM, [
      { role: "user", content: impressionPrompt },
    ]);

    await thinking.edit([...rows, "", impression].join("\n"));

    console.log(
      `[msg] Wordle解読完了 (${((Date.now() - start) / 1000).toFixed(1)}s)`,
    );
  } catch (e) {
    console.error(
      `[msg] Wordle解読エラー (${((Date.now() - start) / 1000).toFixed(1)}s): ${e.message}`,
    );
    await thinking
      .edit("Wordleの取得に失敗しましたっ…ごめんなさいっ！")
      .catch(() => {});
  }
}

const COMMAND_INTENT_MAP = [
  {
    pattern: /ニュース|全体.*要約|サーバー.*まとめ|全体.*まとめ/,
    command: "news",
  },
  { pattern: /要約|まとめ|ダイジェスト|振り返り/, command: "summary" },
  { pattern: /俳句|一句|五七五/, command: "haiku" },
  { pattern: /小説|物語|ストーリー/, command: "story" },
  { pattern: /質問/, command: "question" },
  { pattern: /MVP|一番.*面白|面白.*発言|ベスト.*発言/i, command: "mvp" },
  { pattern: /おみくじ|占い|運勢/, command: "fortune" },
  { pattern: /称号|タイトル/, command: "title" },
  { pattern: /指名手配|やらかし/, command: "wanted" },
  {
    pattern: /話題.*提案|提案.*話題|次.*話題|話題.*考え/,
    command: "suggesttopic",
  },
];

const NATURAL_PROMPT_KEY = { suggesttopic: "topic" };

const NATURAL_EMBED_TITLE = {
  ...EMBED_TITLES,
  suggesttopic: "次の話題はこちらですっ",
};

function detectNaturalCommand(content) {
  for (const { pattern, command } of COMMAND_INTENT_MAP) {
    if (pattern.test(content)) return command;
  }
  return null;
}

async function handleNaturalCommand(message, commandName) {
  if (isProcessing) {
    return message.channel.send(BUSY_MESSAGE);
  }

  isProcessing = true;
  const start = Date.now();
  console.log(
    `[msg] 自然言語コマンド command=${commandName} user=${message.author.tag} channel=${message.channelId}`,
  );

  const thinking = await message.channel.send(
    "少し待ってくださいっ…考えていますっ！",
  );
  const progress = (msg) =>
    thinking.edit({ content: msg, embeds: [] }).catch(() => {});

  try {
    const logResult =
      commandName === "news"
        ? await collectServerLogs(message.guild, progress)
        : await collectChannelLogs(message.channel, progress);

    const logText = logResult.text;
    if (!logText) {
      console.warn(
        `[msg] 自然言語コマンド ログ取得結果が空 command=${commandName}`,
      );
      return thinking.delete().catch(() => {});
    }

    const promptKey = NATURAL_PROMPT_KEY[commandName] ?? commandName;
    const promptConfig = prompts[promptKey];
    const modelName =
      commandName === "haiku" ? modelNameHaiku : modelNameCommon;

    const replyContent = await generateAiSummary(
      promptConfig,
      logText,
      progress,
      modelName,
    );

    const embed = new EmbedBuilder()
      .setTitle(
        NATURAL_EMBED_TITLE[commandName] ??
          getEmbedTitle(commandName, message.channel.name),
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

    await thinking.edit({ content: "", embeds: [embed] });
    console.log(
      `[msg] 自然言語コマンド完了 command=${commandName} (${((Date.now() - start) / 1000).toFixed(1)}s)`,
    );
  } catch (error) {
    console.error(
      `[msg] 自然言語コマンドエラー command=${commandName} (${((Date.now() - start) / 1000).toFixed(1)}s):`,
      error,
    );
    await thinking.delete().catch(() => {});
  } finally {
    isProcessing = false;
  }
}

// ===== ウミガメのスープゲーム =====

const UMI_KEYWORDS = /ウミガメ|水平思考|スープゲーム/;
const UMI_GIVEUP_KEYWORDS =
  /ギブアップ|降参|答え.*教えて|教えて.*答え|お手上げ|終わり|ゲーム終了/;
const UMI_GAME_DURATION_MS = 60 * 60 * 1000;

const activeGames = new Map();

const umiGenPrompt = {
  system: `あなたはウミガメのスープ（水平思考ゲーム）の出題者です。
提供されたDiscordサーバーのログから、実際に起きた出来事を題材にして問題を1つ生成してください。

必ずこの形式のみで出力すること：

【問題】
（ログの出来事を謎めいた状況として2〜4文で描写する。真相・固有名詞・具体的な経緯が直接わからないようにすること）

【真相】
（ログの出来事の実際の経緯を2〜5文で説明する。「なるほど！」と思えるオチになるようにすること）

絶対に守ること：日本語のみ・問題文に真相のヒントを含めない・ログにない出来事は作らない`,
  user: (log) =>
    `以下のDiscordサーバーのログをもとに、実際の出来事を題材としたウミガメのスープの問題を1つ生成してください。\n\n${log}\n\n必ず【問題】【真相】の形式で出力すること。`,
};

function buildUmiJudgeSystem(puzzle, answer) {
  return `あなたはウミガメのスープ（水平思考ゲーム）のゲームマスターです。

【問題】
${puzzle}

【真相（絶対に漏らさないこと）】
${answer}

プレイヤーのメッセージに対して：
- はい/いいえで答えられる質問 → 真相に基づき「はいっ！」「いいえっ！」「関係ありませんっ！」「どちらともいえますっ！」のいずれか1文だけ返す
- 真相と概ね一致する解答 → 「🎉 正解ですっ！」から始め、真相を全文明かす
- 真相と大きく異なる解答 → 「惜しいですっ！」または「違いますっ！」と1文だけ返す

絶対に守ること：正解でない限り真相を絶対に漏らさない・語尾は「〜ですっ」などかわいい口調・正解なら必ず「🎉 正解ですっ！」を含める`;
}

function parseUmiPuzzle(text) {
  const puzzleMatch = text.match(/【問題】\s*([\s\S]*?)(?=【真相】)/);
  const answerMatch = text.match(/【真相】\s*([\s\S]*?)$/);
  return {
    puzzle: puzzleMatch?.[1]?.trim() ?? null,
    answer: answerMatch?.[1]?.trim() ?? null,
  };
}

function endUmiGame(channelId, channel, revealed = false) {
  const game = activeGames.get(channelId);
  if (!game) return;
  clearTimeout(game.timeoutId);
  activeGames.delete(channelId);
  if (!revealed) {
    channel
      .send(
        `⏰ 60分が経過しましたっ！時間切れですっ！\n\n**真相はこちらですっ：**\n${game.answer}`,
      )
      .catch(() => {});
  }
}

async function startUmiGame(message) {
  if (activeGames.has(message.channelId)) {
    return message.channel.send(
      "今ウミガメのスープゲームが進行中ですっ！終わるまで待ってくださいっ！",
    );
  }

  const start = Date.now();
  console.log(
    `[umi] ゲーム開始 user=${message.author.tag} channel=${message.channelId}`,
  );
  const thinking = await message.channel.send(
    "今日の出来事から問題を考えていますっ…！少し待ってくださいっ！",
  );
  const progress = (msg) =>
    thinking.edit({ content: msg, embeds: [] }).catch(() => {});

  try {
    const { text: logText } = await collectChannelLogs(
      message.channel,
      progress,
    );
    if (!logText) throw new Error("ログが取得できませんでした");

    const raw = await generateAiSummary(umiGenPrompt, logText, progress);
    const { puzzle, answer } = parseUmiPuzzle(raw);
    if (!puzzle || !answer) throw new Error("問題のパースに失敗");

    const timeoutId = setTimeout(
      () => endUmiGame(message.channelId, message.channel),
      UMI_GAME_DURATION_MS,
    );

    activeGames.set(message.channelId, {
      puzzle,
      answer,
      timeoutId,
      isAnswering: false,
    });

    const embed = new EmbedBuilder()
      .setTitle("🐢 ウミガメのスープ")
      .setDescription(puzzle)
      .setColor(0x74c7ec)
      .setFooter({
        text: "はい・いいえで答えられる質問をどうぞっ！制限時間は60分ですっ！",
      })
      .setTimestamp();

    await thinking.edit({ content: "", embeds: [embed] });
    await message.channel.send(
      "質問はなんでもどうぞっ！わからなくなったら「ギブアップ」と言えば真相を教えますっ！",
    );
    console.log(
      `[umi] 問題生成完了 (${((Date.now() - start) / 1000).toFixed(1)}s)`,
    );
  } catch (e) {
    console.error(`[umi] 問題生成エラー: ${e.message}`);
    activeGames.delete(message.channelId);
    await thinking
      .edit("問題の生成に失敗しましたっ…ごめんなさいっ！")
      .catch(() => {});
  }
}

async function handleUmiGameMessage(message) {
  const game = activeGames.get(message.channelId);
  if (!game || game.isAnswering) return;

  if (UMI_GIVEUP_KEYWORDS.test(message.content)) {
    endUmiGame(message.channelId, message.channel, true);
    return message.channel.send(
      `降参ですねっ！\n\n**真相はこちらですっ：**\n${game.answer}`,
    );
  }

  game.isAnswering = true;
  const start = Date.now();
  console.log(
    `[umi] 質問処理 user=${message.author.tag} q="${message.content.slice(0, 50)}"`,
  );

  try {
    const reply = await generateConversationReply(
      buildUmiJudgeSystem(game.puzzle, game.answer),
      [{ role: "user", content: message.content }],
    );

    await message.channel.send(reply);
    console.log(
      `[umi] 返答完了 (${((Date.now() - start) / 1000).toFixed(1)}s)`,
    );

    if (reply.includes("🎉 正解ですっ")) {
      endUmiGame(message.channelId, message.channel, true);
    }
  } catch (e) {
    console.error(`[umi] 返答エラー: ${e.message}`);
  } finally {
    if (activeGames.has(message.channelId)) {
      activeGames.get(message.channelId).isAnswering = false;
    }
  }
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

async function handleExcludeChannel(interaction) {
  const start = Date.now();
  const channel = interaction.options.getChannel("channel");
  const added = schedule.addExcludedChannel(interaction.guildId, channel.id);
  console.log(
    `[cmd] /excludechannel user=${interaction.user.tag} channel=${channel.name} added=${added} (${((Date.now() - start) / 1000).toFixed(1)}s)`,
  );
  return interaction.reply({
    content: added
      ? `${channel} を監視・反応の対象から除外しましたっ。`
      : `${channel} はすでに除外されていますっ。`,
    ephemeral: true,
  });
}

async function handleIncludeChannel(interaction) {
  const start = Date.now();
  const channel = interaction.options.getChannel("channel");
  const removed = schedule.removeExcludedChannel(
    interaction.guildId,
    channel.id,
  );
  console.log(
    `[cmd] /includechannel user=${interaction.user.tag} channel=${channel.name} removed=${removed} (${((Date.now() - start) / 1000).toFixed(1)}s)`,
  );
  return interaction.reply({
    content: removed
      ? `${channel} の除外を解除しましたっ。`
      : `${channel} は除外リストにありませんっ。`,
    ephemeral: true,
  });
}

async function handleMessageCreate(message, botId) {
  if (message.author.bot) return;
  if (schedule.isChannelExcluded(message.guildId, message.channelId)) return;

  // アクティブなウミガメゲーム → 全メッセージをゲーム処理
  if (activeGames.has(message.channelId)) {
    return handleUmiGameMessage(message);
  }

  // ボットへのリプライ → 会話継続
  if (message.reference?.messageId) {
    try {
      const referenced = await message.channel.messages.fetch(
        message.reference.messageId,
      );
      if (referenced.author.id === botId) {
        const start = Date.now();
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
        console.log(
          `[msg] リプライ完了 (${((Date.now() - start) / 1000).toFixed(1)}s)`,
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

  if (UMI_KEYWORDS.test(message.content)) {
    return startUmiGame(message);
  }

  if (WORDLE_KEYWORDS.test(message.content)) {
    return handleWordleSolve(message);
  }

  const matchedCommand = detectNaturalCommand(message.content);
  if (matchedCommand) {
    return handleNaturalCommand(message, matchedCommand);
  }

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
    const start = Date.now();
    const reply = await generateAiSummary(
      prompts.maroyakaReaction,
      message.content,
    );
    await message.channel
      .send(reply || MAROYAKA_FALLBACK_RESPONSES[0])
      .catch((e) => console.error(`[msg] 送信エラー: ${e.message}`));
    console.log(
      `[msg] まろやかAI反応完了 (${((Date.now() - start) / 1000).toFixed(1)}s)`,
    );
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
  handleWordleSolve,
  handleSuggestTopic,
  handleSetNewsChannel,
  handleGetNewsChannel,
  handleSetNewsTime,
  handleSetNewsStyle,
  handleToggleNews,
  handleHelp,
  handleMessageCreate,
  handleExcludeChannel,
  handleIncludeChannel,
};
