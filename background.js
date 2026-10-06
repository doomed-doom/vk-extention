chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
});

// Reloading an unpacked extension leaves its old buttons in existing VK tabs.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getManifest().content_scripts[0].matches });
  await Promise.all(tabs.map((tab) => chrome.scripting.executeScript({
    target: { tabId: tab.id }, files: ["content.js"], world: "ISOLATED",
  }).catch((error) => console.warn(`VK Photo Extention: ${error.message}`))));
});

async function openDownloadTab(message) {
  const id = `photoJob:${crypto.randomUUID()}`;
  await chrome.storage.session.set({ [id]: message });
  try {
    await chrome.tabs.create({ url: `${chrome.runtime.getURL("popup.html")}?job=${encodeURIComponent(id)}` });
    return { opened: true };
  } catch (error) {
    await chrome.storage.session.remove(id);
    throw error;
  }
}

async function heicAsJpegUrl(url) {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Decode selected HEIC photos and convert them to JPEG",
    });
  }

  const result = await chrome.runtime.sendMessage({ type: "convertHeic", url });
  if (result?.error) throw new Error(result.error);
  if (!result?.dataUrl) throw new Error("Не удалось преобразовать HEIC в JPEG");
  return result;
}

let conversionQueue = Promise.resolve();

async function attachmentPage(message) {
  const job = (await chrome.storage.session.get(message.jobId))[message.jobId];
  if (!job || job.type !== "openAttachments") throw new Error("Список вложений недоступен. Откройте его из чата заново.");
  if (!["photo", "doc"].includes(message.mediaType)
      || (message.startFrom != null && (typeof message.startFrom !== "string" || message.startFrom.length > 200))) {
    throw new Error("Недопустимый запрос вложений");
  }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: job.sourceTabId },
    world: "MAIN",
    func: async (peerId, mediaType, startFrom) => {
      try {
        if (!window.vkApi?.api) throw new Error("Откройте чат VK и обновите его вкладку.");
        const params = { peer_id: peerId, media_type: mediaType, count: 200, photo_sizes: 1, preserve_order: 1 };
        if (startFrom) params.start_from = startFrom;
        const data = await window.vkApi.api("messages.getHistoryAttachments", params);
        if (!Array.isArray(data?.items)) throw new Error(data?.error?.error_msg || "VK не вернул список вложений");
        return data;
      } catch (error) {
        return { error: error.message || error.error_msg || String(error) };
      }
    },
    args: [Number(job.chat.id), message.mediaType, message.startFrom || ""],
  });
  if (!result?.result) throw new Error("Не удалось получить вложения. Оставьте вкладку VK открытой.");
  return result.result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let task;
  if (message?.type === "downloadPhotos") {
    task = openDownloadTab(message);
  } else if (message?.type === "openAttachments" && sender.tab
      && /^https:\/\/(?:[^/]+\.)?vk\.(?:com|ru)\//.test(sender.url || "")) {
    task = /^-?\d+$/.test(String(message.chat?.id))
      ? openDownloadTab({ type: "openAttachments", chat: message.chat, sourceTabId: sender.tab.id })
      : Promise.reject(new Error("Не удалось определить текущий чат"));
  } else if (message?.type === "attachmentPage" && sender.url?.startsWith(chrome.runtime.getURL("popup.html"))) {
    task = attachmentPage(message);
  } else if (message?.type === "prepareHeic" && sender.url?.startsWith(chrome.runtime.getURL("popup.html"))) {
    task = conversionQueue.then(() => heicAsJpegUrl(message.url));
    conversionQueue = task.catch(() => {});
  } else {
    return;
  }

  task.then(sendResponse).catch((error) => sendResponse({ error: error.message || String(error) }));
  return true;
});
