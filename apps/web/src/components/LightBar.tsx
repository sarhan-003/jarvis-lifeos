import type { Status } from '../types';

/** Glowing bar at the bottom of the stage: cyan while listening, blue sweep while thinking, wave while speaking. */
export function LightBar({ status }: { status: Status }) {
  if (status === 'speaking') {
    return (
      <div className="flex h-3 items-center justify-center gap-1" aria-hidden="true">
        {Array.from({ length: 28 }, (_, i) => (
          <span key={i} className="wave-bar h-3 w-2 rounded-full bg-gradient-to-t from-glow-2 to-glow" style={{ animationDelay: `${(i % 7) * 0.09}s` }} />
        ))}
      </div>
    );
  }
  const cls =
    status === 'listening'
      ? 'lightbar-listening bg-glow shadow-[0_0_24px_4px] shadow-glow/70'
      : status === 'thinking'
        ? 'lightbar-thinking bg-[linear-gradient(90deg,#1e3a8a,#38bdf8,#2563eb,#1e3a8a)] shadow-[0_0_18px_2px] shadow-blue-500/50'
        : 'bg-slate-700/60';
  return <div className={`mx-auto h-1.5 w-full rounded-full transition-all ${cls}`} aria-hidden="true" />;
}
