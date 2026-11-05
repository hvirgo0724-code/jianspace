import { useState } from 'react';

export default function BeforeAfter({
  before,
  after,
  beforeLabel = '改前',
  afterLabel = '改后',
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const [value, setValue] = useState(50);
  return (
    <div className="before-after">
      <div className="ba-stage">
        <img src={before} alt={beforeLabel} />
        <div className="ba-after" style={{ clipPath: `inset(0 0 0 ${value}%)` }}>
          <img src={after} alt={afterLabel} />
        </div>
        <span className="ba-divider" style={{ left: `${value}%` }} aria-hidden="true" />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        aria-label="拖动对比改前与改后"
        onChange={(event) => setValue(Number(event.target.value))}
      />
      <div className="ba-labels">
        <span>{beforeLabel}</span>
        <span>{afterLabel}</span>
      </div>
    </div>
  );
}
