# まろやかAI

Discord サーバーの会話を Ollama で要約・俳句化・エンタメ化するボットです。

## 機能一覧

### AIコマンド（サーバー全体）

| コマンド   | 内容                                         |
| ---------- | -------------------------------------------- |
| `/news`    | サーバー全体の24時間をまろやかに要約         |
| `/haiku`   | 今日の出来事を五・七・五で詠む               |
| `/mvp`     | 今日一番面白かった発言を選ぶ                 |
| `/title`   | 今日活躍したメンバーに称号を授ける           |
| `/wanted`  | 今日一番やらかしたメンバーの指名手配書を作成 |
| `/fortune` | 今日の会話の雰囲気でサーバーのおみくじを引く |

### AIコマンド（チャンネル）

| コマンド        | 内容                               |
| --------------- | ---------------------------------- |
| `/summary`      | チャンネルの24時間をまろやかに要約 |
| `/story`        | 今日の会話をもとに短編小説を書く   |
| `/question`     | みんなへの質問を1つ投げかける      |
| `/suggesttopic` | 次の話題を提案する                 |

### 共通オプション（AIコマンド）

| オプション | 内容                                                 |
| ---------- | ---------------------------------------------------- |
| `style`    | 要約スタイルを選択（`/news` `/summary` のみ）        |
| `private`  | 自分にだけ見えるメッセージで返す                     |
| `validate` | 出力を検証して問題があれば再生成（デフォルト: オフ） |

### 要約スタイル

| スタイル               | 内容                       |
| ---------------------- | -------------------------- |
| まろやか（デフォルト） | 可愛い口調でトピックを紹介 |
| 要約                   | 箇条書きで簡潔にまとめる   |
| 業務報告書風           | 真面目なビジネス文体で報告 |
| 昼ドラ風               | ドラマチックに脚色         |
| ニュースキャスター風   | 真剣なニュース口調で伝える |
| RPG冒険譚風            | RPGのバトルログ風に語る    |

### 設定コマンド

| コマンド          | 内容                         |
| ----------------- | ---------------------------- |
| `/setnewschannel` | 定期配信先チャンネルを設定   |
| `/setnewstime`    | 定期配信の時刻を設定         |
| `/setnewsstyle`   | 定期配信の要約スタイルを設定 |
| `/getnewschannel` | 現在の定期配信設定を確認     |
| `/help`           | コマンド一覧を表示           |

### 自動動作

- **定期ニュース配信**: 毎日設定時刻に24時間の要約を自動投稿（投稿数が少ない日はスキップ）
- **まろやかAI参上**: 月1回（25〜35日おきにランダム）、定期配信チャンネルに登場メッセージを投稿
- **名前反応**: 「まろやかAI」またはメンションで話しかけると返答
- **会話継続**: ボットへのリプライに対して会話を継続（最大10往復）

---

## セットアップ

### 必要条件

- Node.js 18以上
- Discord Bot トークン・クライアントID
- Ollama サーバー（稼働中）

### 手順

```bash
# 1. 依存関係のインストール
npm install

# 2. .env を作成（下記を参照）

# 3. 起動
npm start        # 本番
npm run dev      # 開発（nodemonで自動再起動）
```

---

## 環境変数

`.env` ファイルをプロジェクトルートに作成してください。

```env
# Discord
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_GUILD_IDS=guild_id_1,guild_id_2

# Ollama
OLLAMA_HOST_IP=127.0.0.1
OLLAMA_MODEL=llama3.1:latest
OLLAMA_HAIKU_MODEL=llama3.1:latest
OLLAMA_VALIDATION_MODEL=llama3.1:latest

# Ollamaパラメーター（任意）
OLLAMA_TIMEOUT_MS=300000
OLLAMA_TEMPERATURE=0.7
OLLAMA_TOP_P=0.95
OLLAMA_REPEAT_PENALTY=1.2
OLLAMA_NUM_PREDICT=1500

# 動作設定（任意）
LOG_CHAR_LIMIT=16000
MIN_LOGS_FOR_NEWS=10
```

| 変数                      | 説明                                       | デフォルト |
| ------------------------- | ------------------------------------------ | ---------- |
| `DISCORD_TOKEN`           | Discord Bot トークン                       | 必須       |
| `DISCORD_CLIENT_ID`       | Discord アプリの Client ID                 | 必須       |
| `DISCORD_GUILD_IDS`       | コマンド登録先のサーバーID（カンマ区切り） | 必須       |
| `OLLAMA_HOST_IP`          | OllamaサーバーのIPアドレス                 | 必須       |
| `OLLAMA_MODEL`            | メインで使用するモデル                     | 必須       |
| `OLLAMA_HAIKU_MODEL`      | 俳句生成に使用するモデル                   | 必須       |
| `OLLAMA_VALIDATION_MODEL` | バリデーションに使用するモデル             | 必須       |
| `OLLAMA_TIMEOUT_MS`       | Ollamaのタイムアウト（ミリ秒）             | `300000`   |
| `OLLAMA_TEMPERATURE`      | 生成の創造性（低いほど指示に忠実）         | `0.7`      |
| `OLLAMA_TOP_P`            | 語彙の多様性                               | `0.95`     |
| `OLLAMA_REPEAT_PENALTY`   | 繰り返し抑制                               | `1.2`      |
| `OLLAMA_NUM_PREDICT`      | 最大出力トークン数                         | `1500`     |
| `LOG_CHAR_LIMIT`          | Ollamaに渡すログの最大文字数               | `16000`    |
| `MIN_LOGS_FOR_NEWS`       | 定期ニュースを実行する最低投稿数           | `10`       |

---

## 定期配信の設定

ボット起動後、Discordで以下のコマンドを実行します。

```
/setnewschannel channel:#チャンネル名
/setnewstime hour:8 minute:0
/setnewsstyle style:まろやか（デフォルト）
```

設定は `scheduleConfig.json` に保存され、再起動後も維持されます。

---

## プロジェクト構成

```
├── index.js                  # エントリーポイント・イベントルーティング
├── src/
│   ├── ai.js                 # Ollama連携・テキスト生成
│   ├── commands.js           # スラッシュコマンド定義
│   ├── handlers.js           # コマンド・メッセージハンドラー
│   ├── logs.js               # Discordログ収集
│   ├── schedule.js           # 定期実行・スケジュール管理
│   └── prompts/
│       ├── base.js           # 共通ルール・ユーティリティ
│       ├── individual.js     # 個別コマンド用プロンプト
│       └── styles.js         # 要約スタイル定義
├── data/
│   └── thinkingMessages.js   # AI処理中のメッセージ一覧
├── scheduleConfig.json       # 定期配信設定（自動生成）
└── last_prompt.log           # 最後に送信したプロンプトのログ（自動生成）
```
