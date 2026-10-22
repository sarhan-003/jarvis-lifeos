export function Transcript({ heard, interim, reply, notice }: { heard: string; interim: string; reply: string; notice?: string | undefined }) {
  return (
    <div className="space-y-3" aria-live="polite">
      {(interim || heard) && (
        <p className="text-sm text-slate-400">
          You said: <span className={interim ? 'italic text-slate-300' : 'text-slate-200'}>“{interim || heard}”</span>
        </p>
      )}
      {reply && <p className="text-2xl font-light leading-snug text-white sm:text-3xl">{reply}</p>}
      {notice && <p className="text-sm text-amber-300">{notice}</p>}
    </div>
  );
}
