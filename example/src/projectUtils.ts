import * as fflate from 'fflate';
import { serializeTrackToVTT } from './vttUtils';
import { WebVttTrack } from './types';

// Converts string to Uint8Array
function strToU8(str: string): Uint8Array {
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    buf[i] = str.charCodeAt(i);
  }
  return buf;
}

export function exportProjectZip(tracks: WebVttTrack[]): Uint8Array {
  const zipFiles: Record<string, Uint8Array> = {};
  
  tracks.forEach(track => {
    const vttContent = serializeTrackToVTT(track);
    zipFiles[`${track.id}.vtt`] = strToU8(vttContent);
  });

  // Pack and compress into zip
  const zipBuffer = fflate.zipSync(zipFiles);
  return zipBuffer;
}

export function importProjectZip(buffer: Uint8Array): void {
  const files = fflate.unzipSync(buffer);
  console.log('Unpacked files:', Object.keys(files));
}
