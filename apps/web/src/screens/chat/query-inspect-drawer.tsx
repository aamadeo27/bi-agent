import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { getGeneratedQuery } from "../../lib/api-client";

// ─── Syntax tokeniser ─────────────────────────────────────────────────────────

type TokenType = "keyword" | "string" | "number" | "comment" | "boolean" | "key" | "plain";
type Token = { text: string; type: TokenType };

const SQL_KW = new Set(
  (
    "SELECT FROM WHERE AND OR NOT IN IS NULL JOIN LEFT RIGHT INNER OUTER FULL CROSS ON " +
    "GROUP BY ORDER HAVING LIMIT OFFSET AS WITH DISTINCT COUNT SUM AVG MIN MAX UNION ALL " +
    "BETWEEN LIKE EXISTS CASE WHEN THEN ELSE END INSERT INTO VALUES UPDATE SET DELETE " +
    "TOP FETCH NEXT ROW ROWS ONLY OVER PARTITION RANK ROW_NUMBER"
  ).split(" "),
);

// Regex groups: 1=line-comment 2=block-comment 3=string 4=number 5=word 6=other
const SQL_RE =
  /(--[^\n]*)|(\/\*[\s\S]*?\*\/)|(N?'(?:[^'\\]|\\[\s\S]|'')*')|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|([\s\S])/g;

function tokenizeSql(sql: string): Token[] {
  const tokens: Token[] = [];
  SQL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SQL_RE.exec(sql)) !== null) {
    if (m[1] || m[2]) tokens.push({ text: m[0], type: "comment" });
    else if (m[3]) tokens.push({ text: m[0], type: "string" });
    else if (m[4]) tokens.push({ text: m[0], type: "number" });
    else if (m[5])
      tokens.push({ text: m[0], type: SQL_KW.has(m[5].toUpperCase()) ? "keyword" : "plain" });
    else tokens.push({ text: m[0], type: "plain" });
  }
  return tokens;
}

// Regex groups: 1=key 2=string 3=number 4=boolean/null 5=other
const JSON_RE =
  /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(-?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b)|(\b(?:true|false|null)\b)|([\s\S])/g;

function tokenizeJson(json: string): Token[] {
  const tokens: Token[] = [];
  JSON_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JSON_RE.exec(json)) !== null) {
    if (m[1]) tokens.push({ text: m[0], type: "key" });
    else if (m[2]) tokens.push({ text: m[0], type: "string" });
    else if (m[3]) tokens.push({ text: m[0], type: "number" });
    else if (m[4]) tokens.push({ text: m[0], type: "boolean" });
    else tokens.push({ text: m[0], type: "plain" });
  }
  return tokens;
}

/** Split a flat token stream into per-line token arrays (handles multi-line tokens). */
function splitIntoLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const tok of tokens) {
    const parts = tok.text.split("\n");
    lines[lines.length - 1].push({ ...tok, text: parts[0] });
    for (let i = 1; i < parts.length; i++) {
      lines.push([{ ...tok, text: parts[i] }]);
    }
  }
  return lines;
}

const TOKEN_CLASS: Record<TokenType, string> = {
  keyword: "text-blue-600 font-semibold",
  string: "text-green-600",
  number: "text-orange-500",
  comment: "text-neutral-400 italic",
  boolean: "text-purple-600",
  key: "text-blue-500",
  plain: "",
};

// ─── LineNumberedCode ─────────────────────────────────────────────────────────

interface LineNumberedCodeProps {
  text: string;
  queryType: "sql" | "rest";
}

function LineNumberedCode({ text, queryType }: LineNumberedCodeProps) {
  const rawTokens = queryType === "sql" ? tokenizeSql(text) : tokenizeJson(text);
  const lines = splitIntoLines(rawTokens);

  return (
    <div className="overflow-auto" data-testid="code-block">
      <table className="min-w-full font-mono text-xs leading-5" role="presentation">
        <tbody>
          {lines.map((lineTokens, i) => (
            <tr key={i}>
              <td
                className="w-10 select-none pr-3 text-right align-top text-neutral-400"
                aria-hidden="true"
              >
                {i + 1}
              </td>
              <td className="whitespace-pre text-neutral-900">
                {lineTokens.map((t, j) => (
                  <span key={j} className={TOKEN_CLASS[t.type]}>
                    {t.text}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CodeSkeleton() {
  return (
    <div className="animate-pulse space-y-2 p-4" data-testid="code-skeleton" aria-busy="true">
      {[70, 90, 55, 80, 65].map((w, i) => (
        <div key={i} className="h-3 rounded bg-neutral-200" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

// ─── QueryInspectDrawer ───────────────────────────────────────────────────────

export interface QueryInspectDrawerProps {
  messageId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function QueryInspectDrawer({ messageId, isOpen, onClose }: QueryInspectDrawerProps) {
  const [copied, setCopied] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: ["message-query", messageId],
    queryFn: () => getGeneratedQuery(messageId),
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
  });

  async function handleCopy() {
    if (!data?.queryText) return;
    try {
      await navigator.clipboard.writeText(data.queryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access denied — silent
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) onClose();
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        {/* Transparent overlay — timeline stays visible beneath the drawer */}
        <Dialog.Overlay className="fixed inset-0 z-40" />

        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex w-[40vw] min-w-80 flex-col bg-white shadow-xl focus:outline-none"
          aria-modal="true"
          data-testid="query-inspect-drawer"
        >
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-5 py-4">
            <Dialog.Title className="text-heading-2 text-neutral-900">
              Generated query
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                aria-label="Close query inspector"
                data-testid="drawer-close"
              >
                <XIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {/* ── Body ───────────────────────────────────────────────────────── */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {isPending ? (
              <CodeSkeleton />
            ) : isError || !data ? (
              <div
                className="flex flex-1 items-center justify-center px-6 py-8 text-center"
                role="alert"
                data-testid="query-error"
              >
                <p className="text-body text-neutral-500">Query details not available.</p>
              </div>
            ) : (
              <>
                {/* Metadata strip */}
                <div
                  className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-neutral-100 bg-neutral-50 px-5 py-3"
                  data-testid="metadata-strip"
                >
                  <span className="text-body-sm text-neutral-700" data-testid="data-source-name">
                    {data.dataSourceName}
                  </span>
                  <span
                    className={`inline-flex items-center rounded px-2 py-0.5 text-label font-medium ${
                      data.queryType === "sql"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-orange-100 text-orange-700"
                    }`}
                    data-testid="query-type-badge"
                  >
                    {data.queryType === "sql" ? "SQL" : "REST"}
                  </span>
                  <span className="text-body-sm text-neutral-500" data-testid="executed-at">
                    {new Date(data.executedAt).toLocaleString()}
                  </span>
                  <span className="text-body-sm text-neutral-500" data-testid="row-count">
                    {data.rowCount.toLocaleString()} rows
                  </span>
                </div>

                {/* Code block + copy button */}
                <div className="relative flex-1 overflow-auto bg-neutral-50 px-5 py-4">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="absolute right-5 top-4 z-10 flex items-center gap-1.5 rounded border border-neutral-200 bg-white px-3 py-1 text-body-sm text-neutral-700 shadow-sm hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                    aria-label="Copy query to clipboard"
                    data-testid="copy-button"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>

                  <LineNumberedCode text={data.queryText} queryType={data.queryType} />
                </div>
              </>
            )}
          </div>

          {/* ── Footer ─────────────────────────────────────────────────────── */}
          {!isPending && !isError && data && (
            <div className="shrink-0 border-t border-neutral-100 px-5 py-3">
              {/* Placeholder help link per UI/UX spec */}
              <a
                href="#"
                className="text-body-sm text-primary-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
              >
                Learn more about how queries are generated
              </a>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Icon ─────────────────────────────────────────────────────────────────────

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
