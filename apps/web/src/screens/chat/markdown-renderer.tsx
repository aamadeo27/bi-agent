import React from "react";

/**
 * Minimal inline markdown renderer.
 * Supports: **bold**, `inline code`, unordered lists (- / *), line breaks.
 * No external dependency — avoids adding react-markdown to the bundle.
 */

function renderInline(text: string): React.ReactNode[] {
  // Split on **bold** and `code` spans
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-neutral-100 px-1 font-mono text-body-sm"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

export function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listKey = 0;

  function flushList() {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${listKey++}`} className="my-1 list-disc pl-4">
          {listItems}
        </ul>,
      );
      listItems = [];
    }
  }

  lines.forEach((line, i) => {
    if (line.startsWith("- ") || line.startsWith("* ")) {
      listItems.push(
        <li key={i} className="text-body-lg">
          {renderInline(line.slice(2))}
        </li>,
      );
    } else {
      flushList();
      if (line === "") {
        // blank line between paragraphs — use spacing via next element's margin
        elements.push(<div key={`br-${i}`} className="h-2" aria-hidden="true" />);
      } else {
        elements.push(
          <p key={i} className="text-body-lg leading-relaxed">
            {renderInline(line)}
          </p>,
        );
      }
    }
  });
  flushList();

  return <>{elements}</>;
}
