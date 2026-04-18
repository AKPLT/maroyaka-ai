function parseTopicsToFields(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  const fields = [];
  for (const line of lines) {
    const match = line.match(/^\*\*(.+?)\*\*\s+(.+)$/);
    if (match) {
      const value =
        match[2].length > 1024 ? match[2].substring(0, 1021) + "..." : match[2];
      fields.push({ name: match[1].substring(0, 256), value, inline: false });
    }
  }
  return fields.length > 0 ? fields.slice(0, 25) : null;
}

module.exports = { parseTopicsToFields };
