module.exports = {
  apps: [
    {
      name: "maroyaka-ai",
      script: "index.js",
      watch: true,
      ignore_watch: ["node_modules", "last_prompt.log", "scheduleConfig.json", "*.log"],
    },
  ],
};
