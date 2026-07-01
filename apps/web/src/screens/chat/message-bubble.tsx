/** User message bubble — right-aligned, primary-200 background. */
export function MessageBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end" data-testid="message-bubble">
      <div className="max-w-[70%] rounded-lg bg-primary-200 px-4 py-3 text-body-lg text-neutral-900">
        {text}
      </div>
    </div>
  );
}
