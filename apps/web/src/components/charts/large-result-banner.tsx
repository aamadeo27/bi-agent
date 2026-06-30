interface LargeResultBannerProps {
  rowCount: number;
}

export function LargeResultBanner({ rowCount }: LargeResultBannerProps) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded border border-semantic-info/30 bg-semantic-info/5 px-3 py-2 text-sm text-semantic-info"
    >
      <svg
        className="h-4 w-4 shrink-0"
        fill="currentColor"
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
          clipRule="evenodd"
        />
      </svg>
      This result has {rowCount.toLocaleString("en-US")} rows. The chart shows a summary; use Export to get
      the full dataset.
    </div>
  );
}
