export function ConversationRowSkeleton() {
  return (
    <div className="skeleton-row" aria-hidden="true">
      <div className="skeleton skeleton-avatar" />
      <div className="skeleton-lines">
        <div className="skeleton skeleton-line" style={{ width: '60%' }} />
        <div className="skeleton skeleton-line" style={{ width: '85%' }} />
      </div>
    </div>
  );
}

export function ConversationListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading conversations">
      {Array.from({ length: count }).map((_, i) => (
        <ConversationRowSkeleton key={i} />
      ))}
    </div>
  );
}

export function MessageBubbleSkeleton({ mine = false }: { mine?: boolean }) {
  return (
    <div className={`skeleton-bubble-row ${mine ? 'mine' : ''}`} aria-hidden="true">
      <div className="skeleton skeleton-bubble" style={{ width: mine ? '40%' : '55%' }} />
    </div>
  );
}

export function MessageListSkeleton() {
  return (
    <div className="skeleton-message-list" aria-busy="true" aria-label="Loading messages">
      <MessageBubbleSkeleton />
      <MessageBubbleSkeleton mine />
      <MessageBubbleSkeleton />
      <MessageBubbleSkeleton mine />
      <MessageBubbleSkeleton />
    </div>
  );
}
