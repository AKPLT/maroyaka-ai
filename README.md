# Maroyaka Discord Summary Bot

Discord サーバーの24時間の会話をまろやかに要約したり、俳句にまとめたりするボットです。

## 概要

このプロジェクトは Discord Bot と Ollama を連携して、指定サーバー／チャンネルの過去24時間のログを取得し、AI で要約・俳句化します。

- `/news` : サーバー全体の24時間を要約
- `/summary` : 現在のチャンネルの24時間を要約
- `/haiku` : サーバー全体の24時間を五・七・五の俳句にまとめる

## 必要条件

- Node.js
- Discord Bot トークン
- Discord アプリケーションのクライアント ID
- Ollama サーバーが稼働している環境
- Bot を追加した Discord サーバーの Guild ID

## セットアップ

1. リポジトリをクローンまたはコピー

```bash
cd e:/DEV/maroyaka-ai
```

2. 依存関係をインストール

```bash
npm install
```

3. `.env` ファイルを作成

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_GUILD_IDS=#your_discord_guild_id
OLLAMA_HOST_IP=127.0.0.1
OLLAMA_MODEL=使うモデル名
```

### `.env` 説明

- `DISCORD_TOKEN`: Discord Bot のトークン
- `DISCORD_CLIENT_ID`: Discord アプリの Client ID
- `DISCORD_GUILD_IDS`: コマンドを登録する Guild ID のカンマ区切りリスト
- `OLLAMA_HOST_IP`: Ollama サーバーのホスト IP（例: `127.0.0.1`）
- `OLLAMA_MODEL`: 使用する Ollama モデル名

## 実行方法

### 開発モード

```bash
npm run dev
```

`nodemon` による再起動付きで実行します。

### 本番モード

```bash
npm start
```

## 使い方

1. Discord サーバーに Bot を招待する
2. `.env` の `GUILD_IDS` にテスト対象のサーバー ID を設定する
3. ボットを起動すると、指定したギルドへ `/news`、`/summary`、`/haiku` のコマンド登録を試みます
4. Discord 上で以下のコマンドを実行
   - `/news`
   - `/summary`
   - `/haiku`

### コマンドの動作

- `/news` : すべてのパブリックなテキストチャンネルを巡回し、過去24時間分のログを収集して要約します
- `/summary` : 現在操作しているチャンネル内の過去24時間分のログを要約します
- `/haiku` : 過去24時間のサーバー活動を五・七・五の俳句にまとめます

## 補足

- `index.js` では、ボットがログを取得する際に以下を除外します
  - Bot メッセージ
  - スラッシュコマンド
  - 空白メッセージ
  - URL / 絵文字
- `prompts.js` で Ollama へ送るプロンプトを定義しています。
- `GUILD_IDS` が未設定の場合、コマンド登録は行われません。

## カスタマイズ

- `prompts.js` の `system` / `user` プロンプトを変更すれば、出力スタイルを調整できます
- `OLLAMA_MODEL` を変更すると、使用するモデルを切り替えられます

## 注意事項

- `OLLAMA_HOST_IP` は Ollama サーバーの IP を指します。`http://` とポート `11434` はコード内で自動的に付与されます。
- Discord API の制限を考慮して、メッセージ取得時にウェイトを入れています。
