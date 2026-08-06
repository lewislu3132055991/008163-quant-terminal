(function initResearchUtils(root) {
  const NOTE_PATH = /^\/(?:explore|discovery\/item|search_result)\/([a-zA-Z0-9]+)/;

  function cleanText(value, maxLength = 6000) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, maxLength);
  }

  function canonicalNoteUrl(value) {
    try {
      const url = new URL(value, "https://www.xiaohongshu.com");
      if (url.hostname !== "www.xiaohongshu.com") return null;
      const match = url.pathname.match(NOTE_PATH);
      if (!match) return null;
      return `https://www.xiaohongshu.com/explore/${match[1]}`;
    } catch {
      return null;
    }
  }

  function noteId(value) {
    const canonical = canonicalNoteUrl(value);
    return canonical ? canonical.split("/").pop() : null;
  }

  function dedupeCandidates(items) {
    const seen = new Set();
    const result = [];
    for (const item of items || []) {
      const canonicalUrl = canonicalNoteUrl(item.url);
      if (!canonicalUrl || seen.has(canonicalUrl)) continue;
      seen.add(canonicalUrl);
      result.push({
        ...item,
        id: noteId(canonicalUrl),
        canonicalUrl,
        title: cleanText(item.title, 160),
      });
    }
    return result;
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  root.XhsResearchUtils = { canonicalNoteUrl, cleanText, dedupeCandidates, noteId, stableHash };
})(globalThis);
