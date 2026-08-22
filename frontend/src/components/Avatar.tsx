function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export default function Avatar({ name, url, online, size = 44 }: { name: string; url?: string | null; online?: boolean; size?: number }) {
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {url ? <img src={url} alt={name} /> : <span>{initials(name || '?')}</span>}
      {online !== undefined && <span className={`avatar-dot ${online ? 'on' : 'off'}`} />}
    </div>
  );
}
