export function recordingFilename(blob) {
  const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
  return `blackpink-mirror.${extension}`;
}

export async function saveRecording(blob, { environment = globalThis, objectUrl } = {}) {
  const filename = recordingFilename(blob);
  const mimeType = (blob.type || 'video/webm').split(';', 1)[0];

  if (typeof environment.showSaveFilePicker === 'function') {
    try {
      const handle = await environment.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'Mirror video',
          accept: { [mimeType]: [`.${filename.split('.').pop()}`] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { status: 'saved', filename };
    } catch (error) {
      if (error?.name === 'AbortError') return { status: 'cancelled', filename };
      throw error;
    }
  }

  if (!objectUrl || !environment.document?.body) {
    throw new Error('This browser cannot open a save picker or download the recording.');
  }

  const link = environment.document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  environment.document.body.append(link);
  link.click();
  link.remove();
  return { status: 'downloaded', filename };
}
