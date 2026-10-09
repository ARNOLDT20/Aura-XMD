
## LuxAlgo feature compatibility

The LuxAlgo archive was audited and its portable, keyless features were adapted to Aura-XMD's plugin interface rather than copied wholesale. The imported features are session-safe and include:

- `.tts`, `.tts2`, `.tts3`, and `.trt` for free text-to-speech, with English, Swahili, Urdu, and Arabic language options
- `.base64`, `.unbase64`, `.urlencode`, `.urldecode`, `.roll`, `.flip`, `.pick`, `.calculate`, `.timenow`, and `.date`
- `.weather <city>` through the public wttr.in endpoint
- `.wiki <topic>` through the public Wikipedia summary endpoint
- `.npm <package>` through the public npm registry
- `.take`, `.sticker`, `.toimage`, `.tovideo`, and `.url` media tools
- Existing Aura group welcome/goodbye, downloader, status, and per-session dashboard features remain isolated per linked number

The archive also contained hard-coded third-party API keys, alternate Baileys forks, MongoDB/SQLite single-user state, payment/admin controls, and plugins that execute arbitrary requests or code. Those were not copied into Aura-XMD. Any feature requiring a private API key must be added through an environment variable and a reviewed adapter; it must never be embedded in a plugin or committed to Git.
