import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatTime, loadYouTubeApi } from '../lib/youtube';
import type { PlaybackAction, Role, SyncState } from '../lib/types';
import type { Reaction } from '../hooks/useRoom';

interface Props {
  syncState: SyncState | null;
  isController: boolean;
  role?: Role;
  reactions: Reaction[];
  onAction: (action: PlaybackAction) => void;
  onResync: () => void;
}

// Allowed difference between our player and the room before we jump
const DRIFT_TOLERANCE = 1.2;

export function Player({ syncState, isController, role, reactions, onAction, onResync }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const readyRef = useRef(false);
  const loadedVideoRef = useRef<string | null>(null);
  // last state from the server + when we got it (local clock, so no clock skew issues)
  const latestRef = useRef<{ state: SyncState; receivedAt: number } | null>(null);
  const playAttemptsRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const expectedTime = useCallback(() => {
    const latest = latestRef.current;
    if (!latest) return 0;
    const { state, receivedAt } = latest;
    if (state.playState !== 'playing') return state.currentTime;
    return state.currentTime + (performance.now() - receivedAt) / 1000;
  }, []);

  /** Bring the local YouTube player in line with the room state */
  const applyState = useCallback(
    (force = false) => {
      const player = playerRef.current;
      const latest = latestRef.current;
      if (!player || !readyRef.current || !latest) return;

      const { state } = latest;
      const target = expectedTime();

      if (loadedVideoRef.current !== state.videoId) {
        loadedVideoRef.current = state.videoId;
        if (state.playState === 'playing') player.loadVideoById({ videoId: state.videoId, startSeconds: target });
        else player.cueVideoById({ videoId: state.videoId, startSeconds: target });
        return;
      }

      const ytState = player.getPlayerState();
      const dur = player.getDuration() || 0;
      const ended = ytState === YT.PlayerState.ENDED;
      // room clock ran past the end of the video, nothing to correct
      if (ended && dur && target >= dur - 1) return;

      const current = player.getCurrentTime() || 0;
      if (force || Math.abs(current - target) > DRIFT_TOLERANCE) {
        player.seekTo(Math.min(target, dur ? dur - 0.25 : target), true);
      }

      if (state.playState === 'playing') {
        if (ytState !== YT.PlayerState.PLAYING && ytState !== YT.PlayerState.BUFFERING) {
          player.playVideo();
          playAttemptsRef.current += 1;
          if (playAttemptsRef.current > 3) setAutoplayBlocked(true);
        } else {
          playAttemptsRef.current = 0;
          setAutoplayBlocked(false);
        }
      } else {
        playAttemptsRef.current = 0;
        setAutoplayBlocked(false);
        if (ytState === YT.PlayerState.PLAYING || ytState === YT.PlayerState.BUFFERING) player.pauseVideo();
      }
    },
    [expectedTime],
  );

  // create the YouTube player once
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi()
      .then((YTApi) => {
        if (cancelled || !mountRef.current) return;
        const host = document.createElement('div');
        mountRef.current.appendChild(host);
        playerRef.current = new YTApi.Player(host, {
          width: '100%',
          height: '100%',
          playerVars: {
            controls: 0, // we render our own controls so we know exactly who did what
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              readyRef.current = true;
              setReady(true);
              e.target.setVolume(80);
              applyState(true);
            },
            onStateChange: (e) => {
              // buffering is not a reason to correct, we'd just make it buffer again
              if (e.data !== YTApi.PlayerState.BUFFERING) applyState();
            },
            onError: (e) => {
              const messages: Record<number, string> = {
                2: 'Invalid video id',
                5: 'This video cannot be played in an embedded player',
                100: 'Video not found or private',
                101: 'The owner does not allow this video to be embedded',
                150: 'The owner does not allow this video to be embedded',
              };
              setLoadError(messages[e.data] ?? 'Could not play this video');
            },
          },
        });
      })
      .catch((err) => setLoadError(err.message));

    return () => {
      cancelled = true;
      readyRef.current = false;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [applyState]);

  // new state from the server
  useEffect(() => {
    if (!syncState) return;
    const previousVideo = latestRef.current?.state.videoId;
    latestRef.current = { state: syncState, receivedAt: performance.now() };
    if (previousVideo !== syncState.videoId) setLoadError(null);
    applyState();
  }, [syncState, applyState]);

  // tick: update the UI and correct drift every couple of seconds
  useEffect(() => {
    let tick = 0;
    const id = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      setTime(player.getCurrentTime() || 0);
      setDuration(player.getDuration() || 0);
      if (++tick % 4 === 0) applyState();
    }, 500);
    return () => window.clearInterval(id);
  }, [applyState]);

  const isPlaying = syncState?.playState === 'playing';
  const shownTime = scrub ?? time;

  const togglePlay = () => {
    const current = playerRef.current?.getCurrentTime();
    onAction(isPlaying ? { type: 'pause', time: current } : { type: 'play', time: current });
  };

  const commitScrub = () => {
    if (scrub === null) return;
    const value = scrub;
    setScrub(null);
    onAction({ type: 'seek', time: value });
  };

  const skip = (delta: number) => {
    const next = Math.max(0, Math.min((duration || Infinity) - 0.5, expectedTime() + delta));
    onAction({ type: 'seek', time: next });
  };

  const toggleMute = () => {
    const player = playerRef.current;
    if (!player) return;
    if (muted) player.unMute();
    else player.mute();
    setMuted(!muted);
  };

  const changeVolume = (v: number) => {
    setVolume(v);
    playerRef.current?.setVolume(v);
    if (v > 0 && muted) {
      playerRef.current?.unMute();
      setMuted(false);
    }
  };

  const unlockAutoplay = () => {
    setAutoplayBlocked(false);
    playAttemptsRef.current = 0;
    playerRef.current?.playVideo();
    applyState(true);
  };

  const viewerOnly = role === 'viewer';
  const verb = isController ? '' : 'Request ';

  return (
    <div className="player">
      <div className="player-frame">
        <div ref={mountRef} className="player-mount" />
        {/* click shield: nobody talks to the iframe directly, everything goes through the room */}
        <div
          className="player-shield"
          onClick={viewerOnly ? undefined : togglePlay}
          title={
            viewerOnly
              ? 'Viewers can only watch'
              : isController
                ? isPlaying ? 'Pause' : 'Play'
                : isPlaying ? 'Click to request pause' : 'Click to request play'
          }
        />
        {!ready && !loadError && <div className="player-overlay">Loading player…</div>}
        {loadError && (
          <div className="player-overlay error">
            <strong>{loadError}</strong>
            {isController && <span>Paste a different link below.</span>}
          </div>
        )}
        {autoplayBlocked && (
          <button className="player-overlay unlock" onClick={unlockAutoplay}>
            <span className="unlock-icon">▶</span>
            Your browser blocked autoplay. Click to catch up with the room.
          </button>
        )}
        <div className="reaction-layer" aria-hidden>
          {reactions.map((r) => (
            <span key={r.id} className="floating-reaction" style={{ left: `${r.left}%` }}>
              {r.emoji}
              <small>{r.username}</small>
            </span>
          ))}
        </div>
      </div>

      <div className={`controls ${isController ? '' : 'restricted'}`}>
        <input
          type="range"
          className="seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(shownTime, duration || 0)}
          disabled={!duration || viewerOnly}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={commitScrub}
          onKeyUp={commitScrub}
          onBlur={() => setScrub(null)}
          aria-label="Seek"
          style={{ '--progress': `${duration ? (Math.min(shownTime, duration) / duration) * 100 : 0}%` } as CSSProperties}
        />
        <div className="controls-row">
          <button className="ctrl primary" onClick={togglePlay} disabled={viewerOnly} title={`${verb}${isPlaying ? 'pause' : 'play'}`}>
            {isPlaying ? '❚❚' : '▶'}
            {!isController && <span className="ctrl-label">{isPlaying ? 'Request pause' : 'Request play'}</span>}
          </button>
          <button className="ctrl" onClick={() => skip(-10)} disabled={viewerOnly} title={`${verb}rewind 10s`}>
            −10
          </button>
          <button className="ctrl" onClick={() => skip(10)} disabled={viewerOnly} title={`${verb}forward 10s`}>
            +10
          </button>
          <span className="time">
            {formatTime(shownTime)} <span className="muted">/ {formatTime(duration)}</span>
          </span>
          <div className="spacer" />
          <button className="ctrl" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
            {muted || volume === 0 ? '🔇' : '🔊'}
          </button>
          <input
            type="range"
            className="volume"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            aria-label="Volume"
          />
          <button className="ctrl" onClick={onResync} title="Resync with the room">
            ⟳
          </button>
        </div>
      </div>
    </div>
  );
}
