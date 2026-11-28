# Activity panel checks

Run `node tools/activities/test.mjs` from the repository root. The test imports the application's actual `activities-ui.js` module and obtains element identifiers from `index.html`. It uses the same small event/focus-stub approach as the presentation controls tests, with child elements and disabled-button behaviour added.

The checks exercise:

- Real, paused, demo and practice calorie display, including absent or invalid values and stale real totals during demo.
- Modal opening, brake-input cleanup, keyboard isolation, Escape, restored focus and explicit resume semantics.
- Safe text rendering, activity selection and measured summary formatting.
- Export acknowledgement, cancellation, failure, duplicate clicks, refresh and reopened/closed panel lifecycle.
- Request correlation for late, duplicate and out-of-order history, export and Strava replies, including a resumed ride with the same activity ID.
- Recoverable browser-launch errors without losing the acknowledgement for a valid exported file.
- Short or sample-limited recordings and storage-warning responses that retain an exportable in-memory ride.

The host callback is a recording stub. These tests do not open a browser, export a file, upload an activity, connect Bluetooth or inspect personal activity files. The Strava-button check verifies only that the UI requests the host action with the selected activity ID and a unique request token. Native save-dialog behaviour, fixed-URL browser launching, actual file persistence and full app layout require separate host/integration verification.

Host recording/model and TCX-export tests are separate from this UI suite. A rendered screenshot demonstrates layout, not successful file export or publication to Strava.
