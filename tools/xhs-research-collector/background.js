const STATE_KEY = "xhsResearchCollectorStateV1";
const ALARM_NAME = "xhsResearchCollectorNext";
const EMPTY_STATE = {
  version: "1.1",
  queue: [],
  records: [],
  running: false,
  remainingBatch: 0,
  status: "等待收录",
  lastError: null,
  updatedAt: null,
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return { ...EMPTY_STATE, ...(stored[STATE_KEY] || {}) };
}

async function saveState(state) {
  const next = { ...state, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== "www.xiaohongshu.com") return null;
    const match = url.pathname.match(/^\/(?:explore|discovery\/item|search_result)\/([a-zA-Z0-9]+)/);
    return match ? `https://www.xiaohongshu.com/explore/${match[1]}` : null;
  } catch {
    return null;
  }
}

async function addCandidates(candidates) {
  const state = await getState();
  const known = new Set([
    ...state.queue.map((item) => item.canonicalUrl),
    ...state.records.map((item) => item.canonicalUrl),
  ]);
  let added = 0;
  for (const candidate of candidates || []) {
    const canonical = canonicalUrl(candidate.url);
    if (!canonical || known.has(canonical)) continue;
    known.add(canonical);
    state.queue.push({
      id: candidate.id || canonical.split("/").pop(),
      url: candidate.url,
      canonicalUrl: canonical,
      title: candidate.title || "待读取",
      query: candidate.query || "",
      status: "pending",
      attempts: 0,
      queuedAt: new Date().toISOString(),
    });
    added += 1;
  }
  state.status = added ? `新增 ${added} 篇，等待批量读取` : "没有发现新的帖子";
  return saveState(state);
}

async function saveRecord(record) {
  const state = await getState();
  const canonical = canonicalUrl(record?.canonicalUrl || record?.url);
  if (!canonical) throw new Error("不是有效的小红书笔记链接");
  const normalized = { ...record, canonicalUrl: canonical, id: record.id || canonical.split("/").pop() };
  const existing = state.records.findIndex((item) => item.canonicalUrl === canonical);
  if (existing >= 0) state.records[existing] = normalized;
  else state.records.unshift(normalized);
  state.queue = state.queue.filter((item) => item.canonicalUrl !== canonical);
  state.status = `已收录：${normalized.title || normalized.id}`;
  return saveState(state);
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("页面加载超时"));
    }, timeoutMs);
    function listener(changedTabId, changeInfo) {
      if (changedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }).catch(() => undefined);
  });
}

async function extractFromNewTab(item) {
  const tab = await chrome.tabs.create({ url: item.url, active: false });
  try {
    await waitForTabComplete(tab.id);
    await delay(2500);
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: "XHS_EXTRACT_DETAIL" });
    } catch {
      await delay(2500);
      return chrome.tabs.sendMessage(tab.id, { type: "XHS_EXTRACT_DETAIL" });
    }
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

async function scheduleNext(state) {
  if (!state.running || state.remainingBatch <= 0 || !state.queue.some((item) => item.status === "pending")) {
    state.running = false;
    state.status = state.remainingBatch <= 0 ? "本批读取完成，可导出 JSON" : "队列已处理完毕";
    await saveState(state);
    return;
  }
  const waitMs = 12000 + Math.floor(Math.random() * 8000);
  chrome.alarms.create(ALARM_NAME, { when: Date.now() + waitMs });
  state.status = `已保存进度，约 ${Math.ceil(waitMs / 1000)} 秒后读取下一篇`;
  await saveState(state);
}

async function processOne() {
  let state = await getState();
  if (!state.running) return;
  const item = state.queue.find((candidate) => candidate.status === "pending");
  if (!item) return scheduleNext(state);
  item.status = "reading";
  item.attempts += 1;
  state.status = `正在读取：${item.title}`;
  state = await saveState(state);

  try {
    const record = await extractFromNewTab(item);
    state = await getState();
    const current = state.queue.find((candidate) => candidate.canonicalUrl === item.canonicalUrl);
    if (record?.blocked) {
      if (current) current.status = "pending";
      state.running = false;
      state.lastError = record.blocked;
      state.status = `已暂停：${record.blocked}`;
      return saveState(state);
    }
    if (!record?.ok) throw new Error("正文不完整，已保留待重试");
    state.records = [record, ...state.records.filter((saved) => saved.canonicalUrl !== item.canonicalUrl)];
    state.queue = state.queue.filter((candidate) => candidate.canonicalUrl !== item.canonicalUrl);
    state.remainingBatch -= 1;
    state.lastError = null;
  } catch (error) {
    state = await getState();
    const current = state.queue.find((candidate) => candidate.canonicalUrl === item.canonicalUrl);
    if (current) current.status = current.attempts >= 2 ? "failed" : "pending";
    state.remainingBatch -= 1;
    state.lastError = error instanceof Error ? error.message : String(error);
  }
  await scheduleNext(state);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) processOne();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "GET_STATE") return getState();
    if (message?.type === "ADD_CANDIDATES") return addCandidates(message.candidates);
    if (message?.type === "SAVE_RECORD") return saveRecord(message.record);
    if (message?.type === "START_BATCH") {
      let state = await getState();
      state.queue.forEach((item) => { if (item.status === "reading") item.status = "pending"; });
      state.running = true;
      state.remainingBatch = Math.min(6, state.queue.filter((item) => item.status === "pending").length);
      state.status = state.remainingBatch ? `本批准备读取 ${state.remainingBatch} 篇` : "没有待读取的帖子";
      state.lastError = null;
      state = await saveState(state);
      if (state.remainingBatch) chrome.alarms.create(ALARM_NAME, { when: Date.now() + 500 });
      else state.running = false;
      return saveState(state);
    }
    if (message?.type === "STOP_BATCH") {
      chrome.alarms.clear(ALARM_NAME);
      const state = await getState();
      state.running = false;
      state.queue.forEach((item) => { if (item.status === "reading") item.status = "pending"; });
      state.status = "已暂停，进度已保留";
      return saveState(state);
    }
    if (message?.type === "CLEAR_FAILED") {
      const state = await getState();
      state.queue = state.queue.filter((item) => item.status !== "failed");
      state.status = "失败记录已清理";
      return saveState(state);
    }
    throw new Error("未知操作");
  })().then(sendResponse).catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
  return true;
});
