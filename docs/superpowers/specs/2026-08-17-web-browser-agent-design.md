# Web Browser Agent Design

Date: 2026-08-17
Status: approved for Linux v1

## Goal

Add an automatic WEB send mode to Zotero AI Sidebar. Zotero sends a prompt
through a dedicated local browser, waits for the new ChatGPT or DeepSeek answer,
and writes that answer back to the original Zotero conversation.

Authentication is always manual. The agent must not enter credentials, handle
two-factor authentication, solve challenges, read cookie values, or bypass a
site security check.

## Scope

Linux v1 supports the current workstation, system Google Chrome, ChatGPT Web,
and DeepSeek Web. The existing API flow remains unchanged. The existing Prompt
Hub remains available as a manual fallback.

Windows, macOS, other web providers, automatic login, hidden web APIs, and
concurrent tasks against the same provider are out of scope.

## Architecture

The feature has three isolated components:

1. The Zotero sidebar creates tasks, displays status, and owns conversation
   persistence.
2. A localhost Web Agent process owns Playwright and the task workers.
3. A dedicated persistent Chrome profile stores the browser's normal site
   session after the user logs in manually.

The Web Agent is installed under
`~/.local/share/zotero-ai-sidebar/web-agent`. Its browser profile is separate
from the user's daily Chrome profile. Zotero starts the agent on demand and
communicates through `127.0.0.1` using a random bearer token stored in a
user-readable configuration file.

Provider-specific DOM rules live in separate adapters. A provider page update
must not require changes to Zotero conversation handling.

## Authentication Boundary

The user manually performs all identity-related actions:

- entering an account name or password;
- scanning a QR code;
- completing two-factor authentication or a CAPTCHA;
- accepting account, security, or cookie prompts;
- re-authenticating or switching accounts.

The agent only detects whether the provider page has reached a usable composer.
If it has not, the task stays in `needs_login`. Once the user finishes the
manual steps and the composer becomes available, the task resumes automatically.

## Task Flow

Task states are `queued`, `starting_browser`, `needs_login`, `submitting`,
`generating`, `completed`, `failed`, and `cancelled`.

For each provider, the Web Agent runs one active task and queues later tasks.
ChatGPT and DeepSeek may each have one active task. Before submission, the
adapter records the existing assistant-response count. It then fills the
composer and submits exactly once. Only a newly created response node can be
returned to Zotero.

Completion requires both the provider's generating control to disappear and
the new response text to remain stable across consecutive polls. A task times
out after ten minutes. Login challenges pause rather than fail the task.

The callback always includes the original task ID. Zotero uses that ID to
replace the pending assistant message in the original paper and conversation,
even if another item or conversation is currently visible.

Pending status text is presentation only. It must never be included in the
prompt's conversation history.

## Sidebar UI

The composer footer uses two levels:

- a segmented `API` / `WEB` mode control;
- mode-specific controls to its right.

API mode retains the existing preset, model, reasoning, and permission
controls. WEB mode shows a provider selector with `ChatGPT` and `DeepSeek`,
plus a compact connection/task status. Both the mode and last WEB provider are
persisted independently.

WEB mode defaults to automatic execution. A failed task exposes `Retry` and
`Manual handling` actions on the task message instead of permanently adding
controls to the composer footer.

## Failure Handling

- Missing browser or agent runtime: fail before submission with setup guidance.
- Login or account challenge: pause in `needs_login` and open/focus the page.
- Selector mismatch: fail with a provider-adapter diagnostic and retain the
  prompt for manual handling.
- Browser exit or agent restart: mark the active task interrupted; never submit
  it again without an explicit retry.
- Timeout: retain partial diagnostics but do not import unstable output.
- Callback failure: retry the localhost callback without resubmitting the web
  prompt.

The agent logs states and selector outcomes but does not log prompt or answer
content by default.

## Verification

Unit tests cover persisted mode/provider settings, task callbacks, exclusion of
pending placeholders, and provider-adapter state decisions. Local fixture pages
cover manual-login waiting, one-time submission, streaming completion, timeout,
and old-response rejection.

Targeted sidebar tests verify the two-level footer in classic and compact
layouts. Build verification checks TypeScript and the XPI. Deployment checks
the installed Web Agent health endpoint and confirms that the built and
installed XPI hashes match.

A final real-provider check requires the user to complete any login or security
steps in the dedicated browser. The agent does not automate those steps.
