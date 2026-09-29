function cleanName(value) {
  return String(value || "Chat")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Chat";
}

function chatFolder(chat) {
  return `${cleanName(chat?.name)}_${cleanName(chat?.id)}`;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "downloadPhotos") return;

  (async () => {
    try {
      const photos = message.photos || (message.urls || []).map((url) => ({ previewUrl: url }));
      const seen = new Set();
      const uniquePhotos = photos.filter((photo) => {
        const url = photo.originalUrl || photo.previewUrl;
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
      });

      if (!uniquePhotos.length) {
        sendResponse({ count: 0 });
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: "savePhotosToFolder",
        photos: uniquePhotos,
        folder: chatFolder(message.chat),
      });
      sendResponse(response || { count: 0, error: "Вкладка выбора папки не отвечает." });
    } catch (error) {
      const reason = error.message || String(error);
      const noReceiver = /receiving end does not exist|could not establish connection/i.test(reason);
      sendResponse({
        count: 0,
        error: noReceiver
          ? "Открой попап расширения, нажми «Выбрать папку» и оставь вкладку расширения открытой."
          : reason,
      });
    }
  })();

  return true;
});
