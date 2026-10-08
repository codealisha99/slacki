# Slacki UI design system

Slacki is a focused reading and reply workspace. Its persistent navigation, conversation list, and reading pane keep orientation stable. The conversation is the primary content; chrome stays quiet.

Inspired by [Radix Themes](https://www.radix-ui.com/themes/docs/theme/overview): semantic tokens and a small set of complementary control variants. Implemented directly in `src/cli/ui.html` so the CLI continues to ship a self-contained UI with no font or component-library requests.

## Foundations

Use the CSS custom properties in `:root`. Light surfaces are white on cool gray (`#f5f6f8`); text is slate (`#202631`), secondary text is `#657084`, borders are `#e1e5eb`, and the interactive accent is iris (`#5054c7`). The dark theme overrides the same semantic roles. Use accent-soft for selections, success for connection state, danger for failures, and warning for caution.

Typography uses the platform sans-serif stack. Body text is 14px with 1.65 line height in messages; supporting text is 12–13px, pane titles are 17–20px, and empty-state titles are 24px. Reserve monospace for diagnostic output. Keep message lines below 78 characters where possible.

Spacing tokens follow 4, 8, 12, 16, 24, 32, and 48px. Radii distinguish controls (6px), list selections and avatars (10px), and the composer (16px). Borders define panes; avoid decorative shadows. The composer focus ring is the exception because it communicates active input.

## Components and behavior

- `.go`: primary action, generally one per task area. `.ghost`: secondary action with a neutral border. Always include visible text or an accessible name.
- `.ticket`: full-width conversation button; `.active` plus `aria-pressed` identifies selection. Snippets are limited to two lines; unread counts stay compact.
- `.row`: author identity, timestamp, message body, and an explicit keyboard-accessible thread button. Do not make a whole message an implicit click target.
- `.composer`: labeled textarea and actions. Keep unsent buffers scoped to channel and thread, never move text silently to a different recipient. Buffers are memory-only.
- `.welcome`, `.empty`, `.error-banner`, and `.status`: distinguish no selection, no results, failed requests, and action feedback. Never present failed loading as an empty conversation. Status feedback is a polite live region.

At desktop sizes show all three panes. At 760px and below show navigation with either the list or the conversation; Back returns to the list. Threads have a separate Conversation action. Use `hidden` for removed UI, preserve visible focus rings, and honor reduced motion. Theme preference is local to the browser, with the system preference as the initial default.

## Review checklist

Check light and dark appearances; desktop and 375px mobile widths; long channel names and message bodies; empty, loading, and failure states; keyboard search and thread controls. Verify that switching conversations preserves separate unsent text and late responses cannot replace the selected conversation. Use fixture data for write-interaction testing, never a live Slack workspace.
