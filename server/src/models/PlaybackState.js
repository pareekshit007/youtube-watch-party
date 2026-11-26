import { DEFAULT_VIDEO_ID } from '../constants.js';

/**
 * Server is the source of truth for playback.
 * Instead of streaming the time every second we store "position at updatedAt" and
 * whether it's playing; anyone can then compute where the video should be right now.
 */
export class PlaybackState {
  constructor(videoId = DEFAULT_VIDEO_ID) {
    this.videoId = videoId;
    this.playState = 'paused';
    this.position = 0;
    this.updatedAt = Date.now();
  }

  get currentTime() {
    if (this.playState !== 'playing') return this.position;
    return this.position + (Date.now() - this.updatedAt) / 1000;
  }

  play(at) {
    this.position = at ?? this.currentTime;
    this.playState = 'playing';
    this.updatedAt = Date.now();
  }

  pause(at) {
    this.position = at ?? this.currentTime;
    this.playState = 'paused';
    this.updatedAt = Date.now();
  }

  seek(time) {
    this.position = Math.max(0, time);
    this.updatedAt = Date.now();
  }

  changeVideo(videoId) {
    this.videoId = videoId;
    this.position = 0;
    this.playState = 'playing';
    this.updatedAt = Date.now();
  }

  toJSON() {
    return {
      videoId: this.videoId,
      playState: this.playState,
      currentTime: this.currentTime,
      serverTime: Date.now(),
    };
  }
}
