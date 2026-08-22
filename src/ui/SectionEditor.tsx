/**
 * Editing a song's shape, behind an admin gate.
 *
 * The plan is what a chart is really made of — the arrows are output, and
 * regenerating them from an edited plan is cheap. So editing happens here, at
 * the level of "this passage is empty" and "this chorus should be busier",
 * rather than by dragging individual arrows around.
 *
 * Gated because a plan belongs to the song rather than to the player: everyone
 * in a room plays the same chart, so anyone editing one is editing it for
 * everybody.
 */
import { useState } from 'react';
import {
  normalisePlan,
  validatePlan,
  type Section,
  type SongPlan,
} from '../charts/SongPlan.ts';

interface Props {
  plan: SongPlan;
  onChange: (plan: SongPlan) => void;
  onRegenerate: (plan: SongPlan) => void;
  onClose: () => void;
}

const asTime = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export default function SectionEditor({ plan, onChange, onRegenerate, onClose }: Props) {
  const [draft, setDraft] = useState<SongPlan>(plan);
  const problems = validatePlan(draft);

  const update = (id: string, patch: Partial<Section>) => {
    const next = normalisePlan({
      ...draft,
      sections: draft.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
    setDraft(next);
    onChange(next);
  };

  /**
   * Split a section in two at its midpoint.
   *
   * Splitting then editing the halves is how a boundary gets moved without a
   * timeline to drag on — cruder than scrubbing, but it needs no waveform,
   * which is the whole constraint here.
   */
  const split = (section: Section) => {
    const middle = Math.round((section.startMs + section.endMs) / 2);
    if (middle <= section.startMs || middle >= section.endMs) return;
    const next = normalisePlan({
      ...draft,
      sections: [
        ...draft.sections.filter((s) => s.id !== section.id),
        { ...section, endMs: middle },
        { ...section, id: `${section.id}-b`, startMs: middle },
      ],
    });
    setDraft(next);
    onChange(next);
  };

  const total = draft.durationMs || 1;

  return (
    <div className="panel editor">
      <h2>Edit the song</h2>
      <p className="hint">
        Mark the passages with nothing worth hitting, and how busy the rest should be.
        Arrows are regenerated from this — the shape is the thing worth keeping.
      </p>

      {/* A bar of the whole song, so the shape is visible at a glance. */}
      <div className="timeline">
        {draft.sections.map((section) => (
          <div
            key={section.id}
            className={`timeline__block timeline__block--${section.kind}`}
            style={{
              left: `${(section.startMs / total) * 100}%`,
              width: `${((section.endMs - section.startMs) / total) * 100}%`,
              opacity: section.kind === 'skip' ? 0.28 : 0.35 + Math.min(1, section.intensity) * 0.5,
            }}
            title={`${asTime(section.startMs)}–${asTime(section.endMs)}`}
          />
        ))}
      </div>

      <div className="sections">
        {draft.sections.map((section) => (
          <div key={section.id} className="section">
            <div className="section__head">
              <span className="section__time mono">
                {asTime(section.startMs)}–{asTime(section.endMs)}
              </span>
              {section.label && <span className="section__label">{section.label}</span>}
            </div>

            <div className="section__controls">
              <button
                className={section.kind === 'skip' ? 'is-active' : ''}
                onClick={() =>
                  update(section.id, { kind: section.kind === 'skip' ? 'play' : 'skip' })
                }
              >
                {section.kind === 'skip' ? 'skipped' : 'playing'}
              </button>

              <label className="section__intensity">
                <span className="mono">{section.intensity.toFixed(2)}×</span>
                <input
                  type="range"
                  min={0.25}
                  max={3}
                  step={0.05}
                  value={section.intensity}
                  disabled={section.kind === 'skip'}
                  onChange={(e) => update(section.id, { intensity: Number(e.target.value) })}
                />
              </label>

              <button onClick={() => split(section)}>split</button>
            </div>
          </div>
        ))}
      </div>

      {problems.length > 0 && (
        <p className="hint" style={{ color: 'var(--bad)' }}>
          {problems[0].message}
        </p>
      )}

      <button
        className="button--primary"
        disabled={problems.length > 0}
        onClick={() => onRegenerate(draft)}
      >
        Rebuild the arrows
      </button>
      <button onClick={onClose}>Done</button>
    </div>
  );
}
