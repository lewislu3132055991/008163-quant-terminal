(function initContentCollector() {
  const utils = globalThis.XhsResearchUtils;
  const BLOCK_PATTERNS = ["访问过于频繁", "当前操作频繁", "请完成安全验证", "网络环境存在风险", "账号存在异常"];

  function meta(name, attribute = "name") {
    return document.querySelector(`meta[${attribute}="${name}"]`)?.getAttribute("content") || "";
  }

  function firstUsefulText(selectors, maxLength = 6000) {
    for (const selector of selectors) {
      const values = Array.from(document.querySelectorAll(selector))
        .map((element) => utils.cleanText(element.textContent, maxLength))
        .filter((value) => value.length >= 8);
      if (values.length) return values.sort((a, b) => b.length - a.length)[0];
    }
    return "";
  }

  function detectBlock() {
    const visibleText = utils.cleanText(document.body?.innerText, 5000);
    const reason = BLOCK_PATTERNS.find((pattern) => visibleText.includes(pattern));
    return reason || null;
  }

  function extractSearch() {
    const query = new URL(location.href).searchParams.get("keyword") || "";
    const anchors = Array.from(document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/search_result/"]'));
    const candidates = anchors.slice(0, 80).map((anchor) => {
      let container = anchor;
      for (let depth = 0; depth < 4 && container.parentElement; depth += 1) container = container.parentElement;
      const lines = utils.cleanText(container.textContent, 600).split("\n").map((line) => line.trim()).filter(Boolean);
      const title = lines.find((line) => line.length >= 6 && line.length <= 100 && !/^\d+(?:\.\d+)?[万wW]?$/.test(line)) || anchor.getAttribute("aria-label") || "";
      return {
        url: anchor.href,
        title,
        query,
        discoveredAt: new Date().toISOString(),
      };
    });
    return {
      ok: true,
      kind: "search",
      query,
      candidates: utils.dedupeCandidates(candidates).slice(0, 30),
      blocked: detectBlock(),
    };
  }

  function extractDetail() {
    const canonicalUrl = utils.canonicalNoteUrl(location.href);
    const title = utils.cleanText(
      meta("og:title", "property") || firstUsefulText(["#detail-title", ".note-content .title", "[class*='title']"], 180),
      180,
    );
    const body = utils.cleanText(
      firstUsefulText(["#detail-desc", ".note-content .desc", ".note-text", "[class*='note-content']"], 6000)
        || meta("description")
        || meta("og:description", "property"),
      6000,
    );
    const author = utils.cleanText(firstUsefulText([".author-wrapper .username", ".author-container .name", "[class*='author'] [class*='name']"], 120), 120);
    const blockReason = detectBlock();
    const loginRequired = !title && body.length < 20 && utils.cleanText(document.body?.innerText, 2500).includes("登录后");
    const tags = Array.from(document.querySelectorAll('a[href*="search_result"]'))
      .map((element) => utils.cleanText(element.textContent, 50))
      .filter((value) => value.startsWith("#"))
      .slice(0, 20);
    const imageCount = Array.from(document.querySelectorAll("img"))
      .filter((image) => image.naturalWidth >= 240 && image.naturalHeight >= 240).length;
    const imageLed = body.length < 80 && imageCount > 0;

    return {
      ok: Boolean(canonicalUrl && title && (body.length >= 20 || imageLed) && !blockReason && !loginRequired),
      kind: "detail",
      id: utils.noteId(canonicalUrl || location.href),
      url: location.href,
      canonicalUrl,
      title,
      body,
      bodyHash: utils.stableHash(body),
      author,
      tags: Array.from(new Set(tags)),
      imageCount,
      contentMode: imageLed ? "image-led" : "text-led",
      needsOcr: imageLed,
      publishedText: utils.cleanText(firstUsefulText([".date", "[class*='publish']", "[class*='time']"], 100), 100),
      collectedAt: new Date().toISOString(),
      source: "xiaohongshu-user-session",
      pointInTimeSafe: false,
      quality: title && body.length >= 120 ? "complete" : title && (body.length >= 20 || imageLed) ? "partial" : "failed",
      blocked: blockReason || (loginRequired ? "需要登录" : null),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "XHS_SCAN_SEARCH") sendResponse(extractSearch());
    if (message?.type === "XHS_EXTRACT_DETAIL") sendResponse(extractDetail());
  });
})();
