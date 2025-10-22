
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export default function Tile({ to, title, children }: { to: string, title: string, children?: ReactNode }) {
  return (
    <Link to={to} className="tile block">
      <div className="text-lg font-semibold mb-2">{title}</div>
      <div className="text-sm text-gray-700">{children}</div>
    </Link>
  );
}
