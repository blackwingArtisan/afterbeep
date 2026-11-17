import { Link } from 'react-router-dom';
import { GhostIcon } from '../components/Icons';
import { useTitle } from '../lib/machine';

export default function NotFound() {
  useTitle('Not found');
  return (
    <div className="caller-page">
      <div className="caller-card panel panel-pad stack" style={{ textAlign: 'center', justifyItems: 'center' }}>
        <GhostIcon width={56} height={56} />
        <h1 className="caller-title">Nobody here but us ghosts.</h1>
        <p className="muted">That page hung up.</p>
        <Link className="btn btn-primary" to="/">
          Back to AfterBeep
        </Link>
      </div>
    </div>
  );
}
