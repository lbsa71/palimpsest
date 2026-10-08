# Connect the local seed to Slack

Use Socket Mode so the local process connects outward to Slack without a public webhook URL. It is implemented and connected to `serve`; fixture tests have passed, but live Slack connectivity has not been validated. Signed HTTP ingress remains an alternative.

1. Open [Slack app management](https://api.slack.com/apps), choose **Create New App → From a manifest**, select the workspace, and paste [the manifest](../config/slack-app-manifest.json).
2. Install the app to the workspace. Copy the **Bot User OAuth Token** from **OAuth & Permissions** into `SLACK_BOT_TOKEN` in the private external credentials file `~/.config/palimpsest/credentials.env`.
3. Under **Basic Information → App-Level Tokens**, generate a token with **connections:write**. Put its `xapp-…` value in `SLACK_APP_TOKEN` in that same private file. Socket Mode is enabled by the manifest; no signing secret or public URL is needed for this transport.
4. Invite Palimpsest to a dedicated test channel. Fill in the workspace (`T…`), your member (`U…`) and channel (`C…`) IDs in `SLACK_ALLOWED_TEAM_IDS`, `SLACK_ALLOWED_USER_IDS`, and `SLACK_ALLOWED_CHANNEL_IDS`. A channel link typically contains workspace/channel IDs. Your profile menu provides **Copy member ID**. Each setting can contain comma-separated IDs. Team/user allowlists are required; an omitted or blank channel setting adds no channel restriction, so set it explicitly for this test.
5. Keep the credentials file mode `0600`. Configure the intended model/provider before the first bootstrap, then run `npm start -- doctor` from a clean checkout. This reports credential presence and allowlists without making network calls; it does not validate tokens or live Slack access.
6. Stop any other coordinator for the same external state directory, then run `npm start -- serve`. With the bot and app token set, the startup record should contain `slackSocket.state: "connected"` and `slackUrl: null`. Initial connection failure exits the service; correct the configuration before retrying. The startup state confirms an opened socket, not successful message delivery.

The manifest requests `app_mentions:read` and `chat:write`, and subscribes only to `app_mention`. Mention `@Palimpsest` in each request, including thread follow-ups and `status`, `cancel`, or `correct` commands. These are ordinary mentioned messages, not registered Slack slash commands. Commands must target a task from the same thread; obtain its ID from the local task/event records. Unmentioned messages and DMs are outside this initial subscription. Allowed users in the same thread share that conversation context.

Save tokens only in the external private file, never in this manifest, Git or chat. After the connection is verified, send an explicit mention in the test channel to request a reply. Setup and authentication checks do not themselves authorize unsolicited channel messages.

Normal Socket Mode refreshes reconnect automatically. Repeated failures back off, then cool down before retrying; a disabled Slack link stops automatic reconnection. See the [Socket Mode contract](slack-socket.md). The CLI startup record is a snapshot, and there is no local HTTP endpoint for later socket status.

For signed HTTP instead, omit `SLACK_APP_TOKEN`, supply `SLACK_SIGNING_SECRET`, disable Socket Mode in the Slack app, and configure its Events API Request URL through an operator-controlled HTTPS forwarder to the `slackUrl` printed by `serve`. That loopback URL uses a separate ephemeral port. The bundled manifest enables Socket Mode and does not configure a public Request URL. See the [runbook](runbook.md) for lifecycle, state and forwarding limits.

References: [Slack Socket Mode setup and protocol](https://docs.slack.dev/apis/events-api/using-socket-mode/), [app manifest reference](https://docs.slack.dev/reference/app-manifest/), [app mention event](https://docs.slack.dev/reference/events/app_mention/).
