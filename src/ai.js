const fs = require("fs");
const path = require("path");
const { Ollama } = require("ollama");
const thinkingMessages = require("../data/thinkingMessages");

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
  console.log(`[validate] モデル=${targetModel} 文字数=${output.length}`);
  const start = Date.now();
  const response = await ollama.chat(
    {
      model: targetModel,
      messages: [
        { role: "system", content: promptConfig.system },
        { role: "user", content: "この指示を理解しましたか？" },
        { role: "assistant", content: "はい、理解しましたっ！" },
        {
          role: "user",
          content: `以下の出力がシステムプロンプトのすべてのルールを守っているか確認してください。必ず「YES」または「NO」のみで答えてください。\n\n${output}`,
        },
      ],
    },
    { signal: AbortSignal.timeout(ollamaTimeoutMs) },
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const result = response.message.content.trim();
  console.log(`[validate] 判定=${result} (${elapsed}s)`);
  console.log(`[validate] 元の文:\n${output}`);

  return result.toUpperCase().startsWith("YES");
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

  console.log(`[ai] 生成開始 モデル=${targetModel} ログ=${truncatedLog.length}文字 validate=${validate}`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const stopThinking = startThinkingInterval(onProgress);
    const start = Date.now();
    try {
      const response = await ollama.chat(
        {
          model: targetModel,
          messages: [
            { role: "system", content: promptConfig.system },
            { role: "user", content: "この指示を理解しましたか？次にログを送ります。" },
            { role: "assistant", content: "はい、理解しましたっ！ログをお送りください。" },
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
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      lastOutput = sanitizeText(response.message.content);
      console.log(`[ai] 生成完了 (${elapsed}s) 出力=${lastOutput.length}文字`);
    } catch (error) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`[ai] 生成エラー (${elapsed}s): ${error.message}`);
      throw error;
    } finally {
      stopThinking();
    }

    if (!validate) break;

    onProgress?.(`回答を検証中ですっ... (${attempt + 1}/${maxAttempts}回目)`);
    console.log(`[ai] バリデーション中... (${attempt + 1}/${maxAttempts}回目)`);
    const isValid = await validateOutput(
      lastOutput,
      promptConfig,
      ollamaTimeoutMs,
      modelNameValidation,
    );
    if (isValid) {
      console.log(`[ai] バリデーション成功 (${attempt + 1}回目)`);
      break;
    }
    if (attempt < maxAttempts - 1) {
      onProgress?.(`もう一度試みますっ... (${attempt + 2}/${maxAttempts}回目)`);
      console.log(`[ai] バリデーション失敗 (${attempt + 1}回目)、再生成中...`);
    } else {
      console.log(`[ai] バリデーション失敗 (最終試行)、最後の出力を使用します`);
    }
  }

  return lastOutput;
}

async function generateConversationReply(systemPrompt, messages) {
  const ollamaTimeoutMs = parseInt(
    process.env.OLLAMA_TIMEOUT_MS ?? "300000",
    10,
  );
  console.log(`[ai] 会話返答生成 モデル=${modelNameCommon} 履歴=${messages.length}件`);
  const start = Date.now();
  try {
    const response = await ollama.chat(
      {
        model: modelNameCommon,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        options: {
          temperature: parseFloat(process.env.OLLAMA_TEMPERATURE ?? "0.2"),
          top_p: parseFloat(process.env.OLLAMA_TOP_P ?? "0.8"),
          repeat_penalty: parseFloat(process.env.OLLAMA_REPEAT_PENALTY ?? "1.2"),
          num_predict: parseInt(process.env.OLLAMA_NUM_PREDICT ?? "1500", 10),
        },
      },
      { signal: AbortSignal.timeout(ollamaTimeoutMs) },
    );
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const output = sanitizeText(response.message.content);
    console.log(`[ai] 会話返答完了 (${elapsed}s) 出力=${output.length}文字`);
    return output;
  } catch (error) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`[ai] 会話返答エラー (${elapsed}s): ${error.message}`);
    throw error;
  }
}

module.exports = {
  sanitizeText,
  startThinkingInterval,
  validateOutput,
  generateAiSummary,
  generateConversationReply,
  modelNameCommon,
  modelNameHaiku,
  modelNameValidation,
};
