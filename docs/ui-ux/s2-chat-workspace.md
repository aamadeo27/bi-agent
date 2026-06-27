# S2: Chat Workspace

**Purpose:** Primary interface for all users — ask questions, see streamed responses, interact with charts.
**Layout:** Three-column layout (collapsed on mobile — mobile is out of scope for v1 unless confirmed):
- Left sidebar (240px, collapsible): Conversation list.
- Center content area (flex, fills remaining width): Chat timeline + input bar.
- Right: Query Inspect Drawer (S3) slides in on demand.

**Left Sidebar:**
- Tenant logo / name (top).
- "New conversation" button (primary, full-width at top of sidebar).
- Scrollable list of past conversations: title (truncated at 40 chars, derived from first user message), relative timestamp ("2 hours ago"), hover shows delete option.
- Active conversation is highlighted (`color-primary-200` background).

**Top Nav Bar (full width, above center):**
- Left: hamburger/toggle for sidebar on small viewports.
- Center: current conversation title (editable on double-click).
- Right: Admin nav link (Admin role only) | User menu (avatar + name, dropdown: Profile, Sign out).

**Chat Timeline (center, scrollable, bottom-anchored):**
- User messages: right-aligned bubble, `color-primary-200` fill, `color-neutral-900` text.
- System messages: left-aligned, `color-white` card with `color-neutral-300` border, `color-neutral-900` text.
- Timestamps: `text-body-sm`, `color-neutral-500`, shown on hover.
- Auto-scrolls to bottom on new message; user can scroll up without interruption; "Scroll to bottom" FAB appears if user has scrolled up while streaming.

**Input Bar (bottom, sticky):**
- Full-width text area (auto-expanding, max 6 lines before scroll).
- Placeholder: "Ask a question about your data..."
- Send button (icon + label "Send") enabled only when text is non-empty.
- Keyboard: Enter sends; Shift+Enter inserts newline.
- Disabled state while a response is streaming (send button grayed; text input accepts typing but queuing behavior is a GAP — see Section 10).
- Character limit: not enforced in UI (soft server limit, return error if exceeded — exact limit is GAP-8).

**FR coverage:** FR-UI-1, FR-UI-2, FR-LLM-4, FR-VIZ-4.
