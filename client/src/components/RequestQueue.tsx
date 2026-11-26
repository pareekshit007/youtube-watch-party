import type { ChangeRequest } from '../lib/types';
import { formatTime } from '../lib/youtube';
import { labelForRequest } from '../hooks/useRoom';

interface Props {
  requests: ChangeRequest[];
  onResolve: (id: string, approve: boolean) => void;
}

function describe(req: ChangeRequest) {
  switch (req.type) {
    case 'seek':
      return `jump to ${formatTime(req.payload.time ?? 0)}`;
    case 'change_video':
      return 'play a different video';
    default:
      return labelForRequest(req.type);
  }
}

export function RequestQueue({ requests, onResolve }: Props) {
  if (!requests.length) {
    return (
      <div className="empty">
        <p>No pending requests.</p>
        <p className="muted">When participants ask to play, pause, seek or change the video it shows up here.</p>
      </div>
    );
  }

  return (
    <ul className="requests">
      {requests.map((req) => (
        <li key={req.id} className="request">
          {req.type === 'change_video' && req.payload.videoId && (
            <img
              className="request-thumb"
              src={`https://i.ytimg.com/vi/${req.payload.videoId}/mqdefault.jpg`}
              alt=""
              loading="lazy"
            />
          )}
          <div className="request-body">
            <p>
              <strong>{req.from.username}</strong> wants to {describe(req)}
            </p>
            <div className="request-actions">
              <button className="btn tiny primary" onClick={() => onResolve(req.id, true)}>
                Approve
              </button>
              <button className="btn tiny ghost" onClick={() => onResolve(req.id, false)}>
                Decline
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
