(() => {
  const buttonId = "vk-photo-download-button";

  if (window.__vkPhotoDownloadInjected) return;
  window.__vkPhotoDownloadInjected = true;

  const style = document.createElement("style");
  style.id = `${buttonId}-style`;
  style.textContent = `
  #${buttonId} {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 8px;
    box-sizing: border-box;
    color: rgb(225, 227, 230);
    cursor: pointer;
    display: inline-flex;
    height: 28px;
    justify-content: center;
    min-width: 28px;
    padding: 0;
    padding-right: 12px;
    width: 28px;
  }

  #${buttonId}:focus-visible {
    outline: 2px solid #FFFFFF;
    outline-offset: 2px;
  }

  #${buttonId} .vk-photo-download-icon {
    background: currentColor;
    display: block;
    width: 18px;
    height: 16px;
    mask: url("https://st.vk.ru/images/icons/pv_actions.png") 0 0 / auto no-repeat;
    -webkit-mask: url("https://st.vk.ru/images/icons/pv_actions.png") 0 0 / auto no-repeat;
  }
`;
  document.documentElement.append(style);

  function urlsFromBackgroundImage(value) {
    return [...value.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((match) => match[1]);
  }

  function bestPhotoUrl(url) {
    try {
      const parsed = new URL(url);
      const best = (parsed.searchParams.get("as") || "")
        .split(",")
        .map((size) => size.match(/^(\d+)x(\d+)$/))
        .filter(Boolean)
        .map(([, width, height]) => ({ width: Number(width), height: Number(height) }))
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];

      if (best) parsed.searchParams.set("cs", `${best.width}x${best.height}`);

      return parsed.href;
    } catch {
      return url;
    }
  }

  function previewUrls(root) {
    const urls = new Set();

    root.querySelectorAll("img").forEach((img) => {
      if (img.currentSrc || img.src) urls.add(img.currentSrc || img.src);
    });

    [root, ...root.querySelectorAll("*")].forEach((element) => {
      urlsFromBackgroundImage(getComputedStyle(element).backgroundImage).forEach((url) => {
        urls.add(url);
      });
    });

    return [...urls]
      .filter((url) => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url))
      .map(bestPhotoUrl);
  }

  function imageDoc(link) {
    const name = link.querySelector("img")?.alt || link.textContent;
    const isImage = link.querySelector(".PhotoItem__img") || /\b(jpe?g|png|webp|gif)\b/i.test(name);

    if (!isImage) return null;

    return {
      originalUrl: link.href,
      filename: name.trim(),
    };
  }

  function selectedPhotos() {
    const photos = [];
    const articles = [...document.querySelectorAll('article input[type="checkbox"]:checked')]
      .map((checkbox) => checkbox.closest("article"))
      .filter(Boolean);

    articles.forEach((article) => {
      const links = [...article.querySelectorAll('a[href*="z=photo"]')];
      const docs = [...article.querySelectorAll('a.AttachDocPreview[href*="/doc"]')];

      links.forEach((link) => {
        const previewUrl = previewUrls(link)[0];
        if (!previewUrl) return;

        photos.push({
          pageUrl: link.href,
          previewUrl,
        });
      });

      docs.forEach((link) => {
        const doc = imageDoc(link);
        if (doc) photos.push(doc);
      });
    });

    return photos;
  }

  function selectedPhotoCount() {
    return selectedPhotos().length;
  }

  function chatInfo() {
    const id = location.pathname.match(/^\/im\/convo\/(\d+)/)?.[1] || "unknown";
    const title = document.querySelector("h2.ConvoTitle__author")?.getAttribute("title")
      || document.querySelector("h2.ConvoTitle__author")?.textContent
      || document.querySelector('[role="banner"] h2')?.textContent
      || "Chat";

    return {
      id,
      name: title.trim().replace(/\s+/g, " "),
    };
  }

  function addDownloadButton() {
    const toolbar = document.querySelector('[aria-label="Действия с выделенными сообщениями"]');
    const forwardButton = [...(toolbar?.querySelectorAll("button") || [])]
      .find((button) => button.getAttribute("aria-label") === "Переслать");

    if (!toolbar || !forwardButton || document.getElementById(buttonId)) return;

    const button = document.createElement("button");
    button.id = buttonId;
    button.type = "button";
    button.title = "Скачать фотографии";
    button.setAttribute("aria-label", "Скачать фотографии");
    button.append(Object.assign(document.createElement("span"), {
      className: "vk-photo-download-icon",
    }));
    button.addEventListener("click", () => {
      const photos = selectedPhotos();

      if (!globalThis.chrome?.runtime?.sendMessage) {
        console.error("VK Photo Extention: контекст расширения устарел. Перезагрузи вкладку VK.");
        return;
      }

      globalThis.chrome.runtime.sendMessage({ type: "downloadPhotos", photos, chat: chatInfo() }, (response = {}) => {
        if (globalThis.chrome.runtime.lastError) {
          console.error(`VK Photo Extention: ${globalThis.chrome.runtime.lastError.message}`);
          return;
        }

        if (response.error) {
          if (response.count) console.log(`Сохранено ${response.count} фотографий`);
          console.error(response.error);
          return;
        }

        let photoCount = response.count ?? selectedPhotoCount();
        console.log(
          photoCount
            ? `Загружается ${photoCount} фотографий`
            : "Не обнаружено кандидатов для скачивания"
        );
      });
    });

    forwardButton.after(button);
  }

  new MutationObserver(addDownloadButton).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  addDownloadButton();
})();
