const byId = (id) => document.getElementById(id);

async function message(payload) {
  const response = await chrome.runtime.sendMessage(payload);
  if (response?.error) throw new Error(response.error);
  return response;
}

async function activeXhsTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://www.xiaohongshu.com/")) throw new Error("请先打开小红书搜索页或帖子");
  return tab;
}

async function sendToActive(type) {
  const tab = await activeXhsTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, { type });
  } catch {
    throw new Error("页面尚未准备好，请刷新小红书页面后重试");
  }
}

function showError(error) {
  const node = byId("error");
  node.hidden = !error;
  node.textContent = error ? (error instanceof Error ? error.message : String(error)) : "";
}

async function render() {
  const state = await message({ type: "GET_STATE" });
  byId("status").textContent = state.status;
  byId("pending").textContent = state.queue.filter((item) => item.status === "pending" || item.status === "reading").length;
  byId("records").textContent = state.records.length;
  byId("failed").textContent = state.queue.filter((item) => item.status === "failed").length;
  byId("batch").disabled = state.running;
  byId("stop").disabled = !state.running;
  return state;
}

async function run(button, task) {
  showError(null);
  button.disabled = true;
  try {
    await task();
  } catch (error) {
    showError(error);
  } finally {
    await render();
    button.disabled = false;
  }
}

byId("scan").addEventListener("click", (event) => run(event.currentTarget, async () => {
  const result = await sendToActive("XHS_SCAN_SEARCH");
  if (result?.blocked) throw new Error(`页面已受限：${result.blocked}`);
  await message({ type: "ADD_CANDIDATES", candidates: result?.candidates || [] });
}));

byId("collect").addEventListener("click", (event) => run(event.currentTarget, async () => {
  const result = await sendToActive("XHS_EXTRACT_DETAIL");
  if (result?.blocked) throw new Error(`页面已受限：${result.blocked}`);
  if (!result?.ok) throw new Error("未读取到帖子内容，请确认当前打开的是具体帖子");
  await message({ type: "SAVE_RECORD", record: result });
}));

byId("batch").addEventListener("click", (event) => run(event.currentTarget, () => message({ type: "START_BATCH" })));
byId("stop").addEventListener("click", (event) => run(event.currentTarget, () => message({ type: "STOP_BATCH" })));

byId("export").addEventListener("click", (event) => run(event.currentTarget, async () => {
  const state = await message({ type: "GET_STATE" });
  const payload = {
    schemaVersion: "1.1",
    exportedAt: new Date().toISOString(),
    source: "xiaohongshu-user-session",
    pointInTimeSafe: false,
    records: state.records.map((item) => ({ ...item, url: item.canonicalUrl })),
    queue: state.queue.map((item) => ({ ...item, url: item.canonicalUrl })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `008163-xhs-research-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}));

render().catch(showError);
setInterval(() => render().catch(showError), 2000);
