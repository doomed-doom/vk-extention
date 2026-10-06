(() => {
  const buttonId = "vk-photo-download-button";
  const photoButtonId = "vk-photo-gallery-button";

  if (window.__vkPhotoDownloadInjected) return;
  window.__vkPhotoDownloadInjected = true;

  const style = document.createElement("style");
  style.id = `${buttonId}-style`;
  style.textContent = `
  #${buttonId}:hover {
    background-color: var(--vkui--color_transparent--hover);
  }

  #${buttonId}:active {
    background-color: var(--vkui--color_transparent--active);
  }

  #${buttonId}:focus-visible {
    outline: 2px solid var(--vkui--color_stroke_accent);
    outline-offset: 2px;
  }

  #${buttonId} .vk-photo-download-icon {
    align-items: center;
    display: flex;
    flex-shrink: 0;
    justify-content: center;
    width: 24px;
    height: 24px;
  }

  #${buttonId} .vk-photo-download-icon::before {
    background: currentColor;
    content: "";
    display: block;
    width: 18px;
    height: 16px;
    mask: url("https://st.vk.ru/images/icons/pv_actions.png") 0 0 / auto no-repeat;
    -webkit-mask: url("https://st.vk.ru/images/icons/pv_actions.png") 0 0 / auto no-repeat;
  }

  #${photoButtonId} svg {
    height: 24px;
    width: 24px;
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
      .filter((url) => /\.(jpe?g|png|webp|heic|heif)(\?|$)/i.test(url))
      .map(bestPhotoUrl);
  }

  function imageDoc(link) {
    const name = link.querySelector("img")?.alt || link.textContent;
    const isImage = link.querySelector(".PhotoItem__img") || /\b(jpe?g|png|webp|heic|heif)\b/i.test(name);

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
    button.className = forwardButton.className;
    button.classList.remove("vkuiButton__singleIcon", "vkuiButton__hover", "vkuiButton__active");
    button.type = "button";
    button.setAttribute("aria-label", "Скачать фотографии");
    button.innerHTML = '<span class="vkuiButton__in"><span class="vkuiButton__before" role="presentation"><span class="vk-photo-download-icon" aria-hidden="true"></span></span><span class="vkuiButton__content"><span class="ComposerSelecting__buttonText">Скачать</span></span></span>';
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
          console.error(response.error);
          return;
        }

        if (response.opened) console.log("Выберите папку для сохранения фотографий в открывшейся вкладке.");
      });
    });

    forwardButton.after(button);
  }

  function addPhotoButton() {
    if (document.getElementById(photoButtonId)) return;
    const icon = document.querySelector('#l_ph svg, a[href*="/albums"] svg, [aria-label="Фото"] svg, [title="Фото"] svg');
    if (!icon) return;

    const callButton = document.querySelector('.ConvoHeader__controls #convo-call-menu-trigger');
    if (!callButton) return;

    const button = document.createElement("button");
    button.id = photoButtonId;
    button.className = callButton.className;
    button.type = "button";
    button.setAttribute("aria-label", "Фото");
    const copy = icon.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    button.append(copy);
    (callButton.closest(".DropdownReforged") || callButton).before(button);
  }

  function addButtons() {
    addDownloadButton();
    addPhotoButton();
  }

  new MutationObserver(addButtons).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  addButtons();
})();
