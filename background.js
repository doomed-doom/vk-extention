chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let task;
  if (message?.type === "downloadPhotos") {
    task = openDownloadTab(message);
  } else if (message?.type === "prepareHeic" && sender.url?.startsWith(chrome.runtime.getURL("popup.html"))) {
    task = conversionQueue.then(() => heicAsJpegUrl(message.url));
    conversionQueue = task.catch(() => {});
  } else {
    return;
  }

  task.then(sendResponse).catch((error) => sendResponse({ error: error.message || String(error) }));
  return true;
});
