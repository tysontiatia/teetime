# LaunchDarkly Setup

This project uses [LaunchDarkly](https://launchdarkly.com) for feature flag management.

## SDK Details

- **SDK**: `launchdarkly-js-client-sdk` (`launchdarkly-js-client-sdk`)
- **SDK Type**: client-side (browser)
- **Key Type**: client-side ID
- **Installed via**: `npm install launchdarkly-js-client-sdk` (run in `frontend/`)
- **Initialization entrypoint**: `frontend/src/state/LaunchDarklyContext.tsx` (calls `LDClient.initialize(...)`)

## Configuration

The frontend reads the client-side ID from `VITE_LAUNCHDARKLY_CLIENT_SIDE_ID`.

- If `VITE_LAUNCHDARKLY_CLIENT_SIDE_ID` is not set, the code currently falls back to the LaunchDarkly **test** client-side ID to keep local/onboarding runs simple.
- For production, set `VITE_LAUNCHDARKLY_CLIENT_SIDE_ID` in your deployment environment.

## Where to Find Things

- Feature flags dashboard: https://app.launchdarkly.com/projects/default/flags
- Project settings: https://app.launchdarkly.com/settings/projects/default
- Environments: https://app.launchdarkly.com/settings/projects/default/environments
- API access tokens: https://app.launchdarkly.com/settings/authorization
- LaunchDarkly docs: https://launchdarkly.com/docs

## How Feature Flags Work in This Project

1. The React app initializes the LaunchDarkly JS SDK and sets the evaluation context.
2. Flags are evaluated client-side via `client.variation(flagKey, defaultValue)`.
3. UI reacts to flag changes (when supported by the SDK/event wiring).

### Example: Evaluating `tt-ld-ui-banner`

```ts
const value = client.variation('tt-ld-ui-banner', false);
```

## First Proof Flag

- **Flag key**: `tt-ld-ui-banner`
- **Type**: boolean (temporary)
- **Purpose**: shows an in-app banner when the flag is ON
- **What you should see**: when `tt-ld-ui-banner` is enabled in the `test` environment, `frontend/src/components/LaunchDarklyFlagBanner.tsx` renders a green banner.

## Agent Integration (MCP Server)

To let an agent manage LaunchDarkly flags directly from your editor, the repo includes an MCP config:

- `.cursor/mcp.json` → hosted MCP server: `https://mcp.launchdarkly.com/mcp/launchdarkly`

## Next Steps

- Roll out new features by wrapping them in flags.
- Create targeting rules (percentage rollouts, user targeting, and segments).
- Add cleanup for temporary flags when you’re done.

