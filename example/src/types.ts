import { type TimelineItem } from 'rn-video-timeline-ui';

export type EditMode = 'global' | 'track_edit';

export type TrackKind = 'source' | 'subtitles' | 'captions' | 'descriptions' | 'chapters' | 'metadata';

export interface SourcePayload {
  src: string;
  mediaStart: number;
  playbackRate: number;
  originalDuration?: number;
  effects?: Record<string, any>;
}

export interface WebVttCue {
  id: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  payload: SourcePayload | string; // SourcePayload for 'source', string (JSX/text) for others
  vttSettings?: string;
}

export interface WebVttTrack {
  id: string;
  name: string; // User-friendly name
  kind: TrackKind;
  cues: WebVttCue[];
}

export interface ProjectState {
  tracks: WebVttTrack[];
  editMode: EditMode;
  activeTrackId: string | null;
}

// Extend TimelineItem to carry our specific data when mapped to UI
export interface EditorTimelineItem extends TimelineItem {
  trackId: string;
  kind: TrackKind;
  payload: SourcePayload | string;
}
