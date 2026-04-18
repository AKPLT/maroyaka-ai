const fs = require("fs");
const path = require("path");
const { Ollama } = require("ollama");
const thinkingMessages = require("../data/thinkingMessages");
const { CommandInteractionOptionResolver } = require("discord.js");
const { haiku } = require("./prompts");

const ROOT = path.join(__dirname, "..");
const { fetch: undiciFetch, Agent } = require("undici");
const ollamaAgent = new Agent({
  headersTimeout: parseInt(process.env.OLLAMA_TIMEOUT_MS ?? "300000", 10),
  bodyTimeout: parseInt(process.env.OLLAMA_TIMEOUT_MS ?? "300000", 10),
});
const ollama = new Ollama({
  host: `http://${process.env.OLLAMA_HOST_IP}:11434`,
  fetch: (url, opts) => undiciFetch(url, { ...opts, dispatcher: ollamaAgent }),
});
const modelNameCommon = process.env.OLLAMA_MODEL;
const modelNameHaiku = process.env.OLLAMA_HAIKU_MODEL;
const modelNameValidation = process.env.OLLAMA_VALIDATION_MODEL;
const logCharLimit = parseInt(process.env.LOG_CHAR_LIMIT ?? "16000", 10);
const emojiPattern =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

function sanitizeText(text) {
  return text.replace(emojiPattern, "").trim();
}

function startThinkingInterval(onProgress, intervalMs = 4000) {
  if (!onProgress) return () => {};
  const tick = () => {
    const msg =
      thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)];
    onProgress(`まろやかAIが頑張っていますっ…！（${msg}）`);
  };
  tick();
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}

async function validateOutput(
  output,
  promptConfig,
  ollamaTimeoutMs,
  targetModel,
) {
  const response = await ollama.chat(
    {
      model: targetModel,
      messages: [
        { role: "system", content: promptConfig.system },
        {
          role: "user",
          content: `以下の出力がシステムプロンプトのすべてのルールを守っているか確認してください。必ず「YES」または「NO」のみで答えてください。\n\n${output}`,
        },
      ],
    },
    { signal: AbortSignal.timeout(ollamaTimeoutMs) },
  );

  console.log(`--- バリデーション詳細 ---`);
  console.log(`判定結果: ${response.message.content.trim()}`);
  console.log(`モデル: ${targetModel}`);
  console.log(`元の文:\n${output}`);
  console.log(`------------------------`);

  return response.message.content.trim().toUpperCase().startsWith("YES");
}

async function generateAiSummary(
  promptConfig,
  logText,
  validate = false,
  onProgress = null,
  targetModel = modelNameCommon,
) {
  const truncatedLog = logText.substring(0, logCharLimit);
  fs.writeFileSync(
    path.join(ROOT, "last_prompt.log"),
    [
      `=== ${new Date().toISOString()} ===`,
      `--- SYSTEM ---`,
      promptConfig.system,
      `--- USER ---`,
      promptConfig.user(truncatedLog),
    ].join("\n"),
    "utf8",
  );

  const ollamaTimeoutMs = parseInt(
    process.env.OLLAMA_TIMEOUT_MS ?? "300000",
    10,
  );
  const maxAttempts = validate ? 5 : 1;
  let lastOutput = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const stopThinking = startThinkingInterval(onProgress);
    try {
      const response = await ollama.chat(
        {
          model: targetModel,
          messages: [
            { role: "system", content: promptConfig.system },
            { role: "user", content: promptConfig.user(truncatedLog) },
          ],
          options: {
            temperature: parseFloat(process.env.OLLAMA_TEMPERATURE ?? "0.2"),
            top_p: parseFloat(process.env.OLLAMA_TOP_P ?? "0.8"),
            repeat_penalty: parseFloat(process.env.OLLAMA_REPEAT_PENALTY ?? "1.2"),
            num_predict: parseInt(process.env.OLLAMA_NUM_PREDICT ?? "1500", 10),
          },
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
    const isValid = await validateOutput(
      lastOutput,
      promptConfig,
      ollamaTimeoutMs,
      modelNameValidation,
    );
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

module.exports = {
  sanitizeText,
  startThinkingInterval,
  validateOutput,
  generateAiSummary,
  modelNameCommon,
  modelNameHaiku,
  modelNameValidation,
};
