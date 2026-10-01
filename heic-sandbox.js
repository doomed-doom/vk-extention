window.addEventListener("message", async (event) => {
  if (event.source !== parent || event.data?.type !== "convertHeic") return;

  const { id, buffer } = event.data;
  try {
    const jpeg = await window.heicTo({
      blob: new Blob([buffer], { type: "image/heic" }),
      type: "image/jpeg",
      quality: 0.92,
    });
    if (!(jpeg instanceof Blob)) throw new Error("HEIC-декодер не вернул JPEG");
    const jpegBuffer = await jpeg.arrayBuffer();
    parent.postMessage({ type: "heicResult", id, buffer: jpegBuffer }, "*", [jpegBuffer]);
  } catch (error) {
    parent.postMessage({ type: "heicResult", id, error: error.message || String(error) }, "*");
  }
});
