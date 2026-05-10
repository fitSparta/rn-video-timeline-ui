import { WebVttTrack, WebVttCue, SourcePayload } from './types';

// Converts seconds to HH:MM:SS.mmm
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);

  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

// Converts HH:MM:SS.mmm to seconds
export function parseTime(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length !== 3) return 0;
  const h = parseFloat(parts[0]);
  const m = parseFloat(parts[1]);
  const s = parseFloat(parts[2]);
  return h * 3600 + m * 60 + s;
}

export function serializeTrackToVTT(track: WebVttTrack): string {
  let vtt = `WEBVTT - ${track.name}\n\n`;

  track.cues.forEach(cue => {
    vtt += `${formatTime(cue.startTime)} --> ${formatTime(cue.endTime)}`;
    if (cue.vttSettings) {
      vtt += ` ${cue.vttSettings}`;
    }
    vtt += '\n';

    if (track.kind === 'source' || track.kind === 'metadata') {
      // payload might be JSON for source
      vtt += typeof cue.payload === 'string' ? cue.payload : JSON.stringify(cue.payload);
    } else {
      vtt += cue.payload;
    }
    vtt += '\n\n';
  });

  return vtt;
}
