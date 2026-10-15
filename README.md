# Teams · Membership administration

Local web app that adds an existing user to a maintainable list of teams and channels. Requires Node.js 22 or newer, PowerShell 7 (`pwsh`), and the `Microsoft.Graph.Authentication` module. No npm packages need to be installed. You do not create your own app registration or configure a client ID or client secret.

## Features

- Sign in with Microsoft Graph using a one-time device code. No custom app registration is required.
- Keep a local list of teams and channels. Add entries from Microsoft, type them in, or import and export JSON.
- Look up team and channel names and fill in the Microsoft IDs and channel type.
- Add one existing user to many selected teams and channels in a single run, with progress while it works.
- Grant standard-channel access through team membership. Add private-channel members to the team first, then to the channel. Add shared-channel members directly.
- Skip a destination when the user is already a direct member. A failure in one destination does not stop the rest.
- Listen only on localhost. Graph tokens stay in the local PowerShell session and are not sent to the browser.

## Quick start

1. Install Node.js 22 or newer and PowerShell 7.
2. Double-click `Start.cmd`.
3. Open http://localhost:3000 and choose **Sign in with Graph**.
4. Sign in with a work account that can manage the relevant memberships.
5. Get teams and channels, or import your own list. The list starts empty.
6. Enter the user's sign-in address, select the entries, and confirm.

## Setup

1. Install PowerShell 7 if `pwsh` is not already available.
2. Double-click `Start.cmd`, or run `powershell -NoProfile -ExecutionPolicy Bypass -File .\Start.ps1` from the project folder. The start script finds Node.js and PowerShell 7 even when they are not on your PATH. It can use the Node.js runtime that comes with Codex. npm is not required. The app checks the Graph module automatically and installs it from the PowerShell Gallery for the current user if it is missing. The first installation needs internet access, but not administrator rights. An already installed module is reused without an automatic update. If installation or loading fails, an error is shown and startup stops. `npm start` can still be used if npm is installed.
3. Open http://localhost:3000 in the browser.
4. Click **Sign in with Graph**. The app shows a one-time code and a link to Microsoft sign-in. Open the link, enter the code, and sign in with a work account that can manage the relevant memberships. The app continues automatically when sign-in is complete.

The check lives in `ensure-graph.ps1` and also runs in the Graph process if the server is started directly with `node server.js`. The start script's dependencies can be checked without starting the server with `powershell -NoProfile -ExecutionPolicy Bypass -File .\Start.ps1 -CheckOnly`.

The app uses `Connect-MgGraph -ContextScope Process` with Microsoft's existing Graph PowerShell application. The required delegated scopes are `User.Read`, `User.ReadBasic.All`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `TeamMember.Read.All`, `TeamMember.ReadWriteNonOwnerRole.All`, and `ChannelMember.ReadWrite.All`. The organization may require administrator consent or block this Microsoft application.

The app uses `-UseDeviceCode`, so sign-in happens in the browser with a one-time code. That avoids the WAM error about a missing window handle in background processes. The organization's Conditional Access can block this sign-in method. See [Microsoft's sign-in documentation](https://learn.microsoft.com/powershell/module/microsoft.graph.authentication/connect-mggraph?view=graph-powershell-1.0).

The previous `config.json` is no longer used.

## Use

The app starts with an empty access list and contains no organization-specific names or IDs. Sign in with your own organization's account and get teams and channels with **Get the organization's teams**, or add entries manually. You can also import your own JSON list. The files `teams-import.json` and `channels-import.json` are empty and can be used as a starting point.

- Get your teams and channels, or enter the team ID and channel ID manually. Names are display names only; Microsoft IDs identify the destination.
- Save, edit, or delete entries. The list is stored in `data/catalog.json` and can be exported and imported as JSON. Import replaces the list after confirmation.
- Enter the user's UPN (sign-in address) or Entra object ID, select entries, and confirm the addition. For guests, use the object ID of a guest that already exists in the organization.
- Results are shown per entry. An existing direct membership is skipped. An error in one destination does not stop the rest. The result is not a transaction: successful additions remain if a later entry fails. Run again to retry the failed entries.

Standard channels follow team membership, which gives access to all of the team's standard channels. Private channels also require team membership; the app adds that first and tries again after a short synchronization delay. Shared channels are added directly without adding the user to the team. Indirect shared memberships and external B2B direct connect users are not handled separately. Microsoft can reject an addition depending on the account's permissions and the channel policy.

The app gets the organization's teams through Microsoft Graph /teams with Team.ReadBasic.All. IDs for other teams can be entered manually if the account has the required permissions. Each local browser session uses its own PowerShell process with a process-local Graph sign-in. Graph calls are made with `Invoke-MgGraphRequest`; tokens are not sent to the web app or the browser. The Graph module handles token renewal. Sign out ends the session's PowerShell process and removes the app's sign-in, but does not sign the Windows account out of Microsoft.

The app listens only locally and is intended for one administrator on one computer. The list is shared by local browser sessions. It is not intended as a shared server on the network. Close the process with Ctrl+C after use.

## Check

`npm test` checks list validation, existing membership, and local HTTP access control. Live sign-in and membership must be checked in your tenant with your account.

Microsoft documentation: [Team membership](https://learn.microsoft.com/en-us/graph/api/team-post-members?view=graph-rest-1.0), [channel membership](https://learn.microsoft.com/en-us/graph/api/channel-post-members?view=graph-rest-1.0).
