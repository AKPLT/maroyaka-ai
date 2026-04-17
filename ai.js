require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Ollama } = require("ollama");
const thinkingMessages = require("./thinkingMessages");

const ollama = new Ollama({ host: `http://${process.env.OLLAMA_HOST_IP}:11434` });
const modelName = process.env.OLLAMA_MODEL;
const logCharLimit = parseInt(process.env.LOG_CHAR_LIMIT ?? "16000", 10);
const emojiPattern =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

function sanitizeText(text) {
  return text.replace(emojiPattern, "").trim();
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
    [
      `=== ${new Date().toISOString()} ===`,
      `--- SYSTEM ---`,
      promptConfig.system,
      `--- USER ---`,
      promptConfig.user(truncatedLog),
    ].join("\n"),
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

module.exports = { sanitizeText, startThinkingInterval, validateOutput, generateAiSummary };
