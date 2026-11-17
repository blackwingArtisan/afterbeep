export function Reels({ spinning }: { spinning: boolean }) {
  return (
    <div className="cassette-window" aria-hidden="true">
      <span className={`reel ${spinning ? 'spin' : ''}`} />
      <span className="tape" />
      <span className={`reel ${spinning ? 'spin' : ''}`} />
    </div>
  );
}
