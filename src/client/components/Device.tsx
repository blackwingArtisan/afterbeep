import { MessageCounter } from './Lcd';
import { Reels } from './Reels';

/** The hero illustration: a 1986 answering machine that never stopped working. */
export function Device({ count = 3 }: { count?: number }) {
  return (
    <div className="device" aria-hidden="true">
      <div className="device-top">
        <div className="device-grill" />
        <MessageCounter count={count} />
      </div>
      <div className="device-deck">
        <div className="cassette device-cassette">
          <div className="cassette-label">
            <span className="cassette-stripe emergency" />
            <div className="spread" style={{ marginTop: 6 }}>
              <span className="cassette-side">A1</span>
              <span className="chip chip-emergency">Emergency</span>
            </div>
            <div className="cassette-name">Priya N.</div>
            <div className="cassette-job">Water heater burst</div>
          </div>
          <Reels spinning />
        </div>
      </div>
      <div className="device-keys">
        <span className="key">Play</span>
        <span className="key">Book</span>
        <span className="key">Bill</span>
      </div>
      <div className="device-note">3 new jobs!</div>
    </div>
  );
}
