
import { fb } from '../lib/auth';

export default function StatusBadge() {
  const connected = !!fb;
  return (
    <span className={'text-xs px-2 py-1 rounded ' + (connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700')}>
      {connected ? 'Connected to Firebase' : 'Local-only mode'}
    </span>
  );
}
