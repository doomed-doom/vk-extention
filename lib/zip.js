// Stored ZIP: photos are already compressed. Write one photo at a time to disk.
async function writeZip(writable, entries) {
  const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    return value >>> 0;
  });
  const central = [];
  let offset = 0;
  let centralSize = 0;
  for await (const { name, blob, date = new Date() } of entries) {
    const filename = new TextEncoder().encode(name);
    // ponytail: classic ZIP below 4 GiB / 65535 entries; use ZIP64 for larger exports.
    if (filename.length > 65535 || central.length >= 65534
        || offset + 30 + filename.length + blob.size + centralSize + 46 + filename.length + 22 >= 0xffffffff) {
      throw new Error("Архив слишком большой для ZIP. Сохраните фотографии несколькими архивами или в папку.");
    }
    const data = new Uint8Array(await blob.arrayBuffer());
    let crc = 0xffffffff;
    for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    crc = (crc ^ 0xffffffff) >>> 0;
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((Math.min(2107, Math.max(1980, date.getFullYear())) - 1980) << 9)
      | ((date.getMonth() + 1) << 5) | date.getDate();
    const local = new Uint8Array(30 + filename.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true); // UTF-8 filenames, stored (method 0).
    header.setUint16(10, time, true);
    header.setUint16(12, day, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, filename.length, true);
    local.set(filename, 30);
    const record = new Uint8Array(46 + filename.length);
    const directory = new DataView(record.buffer);
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 20, true);
    record.set(local.subarray(4, 30), 6);
    directory.setUint32(42, offset, true);
    record.set(filename, 46);
    await writable.write(local);
    await writable.write(data);
    central.push(record);
    centralSize += record.length;
    offset += local.length + data.length;
  }
  for (const record of central) await writable.write(record);
  const end = new Uint8Array(22);
  const footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, central.length, true);
  footer.setUint16(10, central.length, true);
  footer.setUint32(12, centralSize, true);
  footer.setUint32(16, offset, true);
  await writable.write(end);
}
