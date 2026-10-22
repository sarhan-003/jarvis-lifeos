// Study plan timeline: focus blocks and breaks laid out in time order.
import { useState } from 'react';

const fmt = (m) => (m % 60 === 0 ? `${m / 60}h` : m > 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

export function PlanTimeline({ plan }) {
  return (
    <div className="plan">
      <div className="plan-head">
        <div>
          <div className="plan-title">{plan.title}</div>
          <div className="dim small">
            {plan.startTime}–{plan.endTime} · {fmt(plan.studyMinutes)} focus · breaks {plan.breakMinutes}m
          </div>
        </div>
        <div className="plan-topics">
          {plan.sessions.map((s) => (
            <span key={s.topic} className="topic-pill">
              {s.topic} <b>{fmt(s.minutes)}</b>
            </span>
          ))}
        </div>
      </div>
      <ol className="timeline">
        {plan.blocks.map((b, i) => (
          <li key={i} className={`block block-${b.type}`}>
            <span className="block-time">
              {b.start}
              <span className="dim">–{b.end}</span>
            </span>
            <span className="block-label">{b.label}</span>
            <span className="block-len dim">{fmt(b.minutes)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function PlansView({ plans, today }) {
  const upcoming = plans.filter((p) => p.date >= today);
  const past = plans.filter((p) => p.date < today).reverse();
  const [showPast, setShowPast] = useState(false);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Study plans</h2>
      </div>
      {!plans.length && (
        <p className="empty-small">
          No study plans yet. Ask Jarvis: “Create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming.”
        </p>
      )}
      {upcoming.map((p) => (
        <PlanTimeline key={p.id} plan={p} />
      ))}
      {past.length > 0 && (
        <>
          <button className="link-btn" onClick={() => setShowPast((s) => !s)} aria-expanded={showPast}>
            {showPast ? 'Hide' : 'Show'} {past.length} past plan{past.length === 1 ? '' : 's'}
          </button>
          {showPast && past.map((p) => <PlanTimeline key={p.id} plan={p} />)}
        </>
      )}
    </section>
  );
}
