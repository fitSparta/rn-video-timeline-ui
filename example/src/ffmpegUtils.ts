import { WebVttTrack, SourcePayload } from './types';

export function generateFfmpegCommand(tracks: WebVttTrack[]): string {
  const sourceTrack = tracks.find(t => t.kind === 'source');
  if (!sourceTrack || sourceTrack.cues.length === 0) return 'echo "No source track found"';

  const inputs = new Set<string>();
  sourceTrack.cues.forEach(cue => {
    const payload = cue.payload as SourcePayload;
    if (payload.src) inputs.add(payload.src);
  });

  const inputList = Array.from(inputs);
  const inputCmd = inputList.map(i => `-i "${i}"`).join(' ');

  let filterComplex = '';
  let concatInputs = '';
  let filterIndex = 0;

  sourceTrack.cues.forEach((cue, idx) => {
    const payload = cue.payload as SourcePayload;
    const inputIdx = inputList.indexOf(payload.src);
    const duration = cue.endTime - cue.startTime;
    
    // Video trim
    filterComplex += `[${inputIdx}:v]trim=start=${payload.mediaStart}:duration=${duration},setpts=PTS-STARTPTS`;
    
    // Audio trim
    filterComplex += `;[${inputIdx}:a]atrim=start=${payload.mediaStart}:duration=${duration},asetpts=PTS-STARTPTS`;
    
    // Playback rate (simplified)
    if (payload.playbackRate && payload.playbackRate !== 1.0) {
       const vSpeed = 1 / payload.playbackRate;
       filterComplex += `[v${filterIndex}];[v${filterIndex}]setpts=${vSpeed}*PTS`;
       // ATempo is more complex but we'll add basic structure
       filterComplex += `[v${filterIndex}_final];[a${filterIndex}_raw]atempo=${payload.playbackRate}[a${filterIndex}_final];`;
    } else {
       filterComplex += `[v${filterIndex}];`;
    }

    // Since we're writing a simplified example, we'll just concat the direct trims
    // (Assuming no playback rate to keep string simple for example)
    concatInputs += `[v${filterIndex}][a${filterIndex}]`;
    filterIndex++;
  });

  filterComplex = sourceTrack.cues.map((cue, idx) => {
    const payload = cue.payload as SourcePayload;
    const inputIdx = inputList.indexOf(payload.src);
    const duration = cue.endTime - cue.startTime;
    return `[${inputIdx}:v]trim=start=${payload.mediaStart}:duration=${duration},setpts=PTS-STARTPTS[v${idx}];` +
           `[${inputIdx}:a]atrim=start=${payload.mediaStart}:duration=${duration},asetpts=PTS-STARTPTS[a${idx}]`;
  }).join(';');

  const concatNames = sourceTrack.cues.map((_, idx) => `[v${idx}][a${idx}]`).join('');
  filterComplex += `;${concatNames}concat=n=${sourceTrack.cues.length}:v=1:a=1[outv][outa]`;

  return `ffmpeg ${inputCmd} -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" output.mp4`;
}
