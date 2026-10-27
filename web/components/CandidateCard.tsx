'use client';
import Link from 'next/link';
import { initials, mediaUrl } from '../lib/format';
import type { Candidate } from '../lib/types';
import type { T } from '../lib/i18n';

export default function CandidateCard({ c, selected, canVote, onToggle, href, t, highlight }:
  { c: Candidate; selected: boolean; canVote: boolean; onToggle: () => void; href: string; t: T['t']; highlight: boolean }) {
  const img = mediaUrl(c.imageKey);
  return (
    <article className={`card${selected ? ' is-selected' : ''}${highlight ? ' is-focus' : ''}`} id={`c${c.number}`}>
      <Link href={href} className="card-media" aria-label={c.name} prefetch={false}>
        {img ? <img src={img} alt="" loading="lazy" width={400} height={400} /> : <span className="ph" aria-hidden>{initials(c.name)}</span>}
        <span className="num">{c.number}</span>
      </Link>
      <div className="card-body">
        <h3>{c.name}</h3>
        {c.description && <p className="muted clamp">{c.description}</p>}
        {canVote && (
          <button type="button" className={`btn ${selected ? 'btn-primary' : 'btn-outline'} block`} aria-pressed={selected} onClick={onToggle}>
            {selected ? `✓ ${t('selected')}` : t('select')}
          </button>
        )}
      </div>
    </article>
  );
}
