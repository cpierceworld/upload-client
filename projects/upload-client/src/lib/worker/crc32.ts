import { createCRC32 } from 'hash-wasm';

export async function crc32Base64(file: Blob): Promise<string> {
  const hasher = await createCRC32();
  hasher.init();
  const reader = file.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
  }
  const bytes = hasher.digest('binary');
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
