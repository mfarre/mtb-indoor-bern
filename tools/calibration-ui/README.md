# Bike profile and calibration UI checks

[Simulator](../../docs/simulator.md) · [Calibration guide](../../docs/bike-calibration.md)

This DOM test harness imports `src/MTBIndoorBern/Scene/bike-settings.js` and the application's styles directly. It does not duplicate the screen and requires no JavaScript dependencies.

From the repository root:

```sh
python -m http.server 8766 --bind 127.0.0.1
```

Open the [test harness](http://127.0.0.1:8766/tools/calibration-ui/). Checks run automatically and write their results to the page and console. **Executa les comprovacions** (run checks) repeats them. `window.bikeUiHarness.getSummary()` returns the counts, while `window.bikeUiHarness.results` contains the details.

To inspect the appearance after the checks:

- [Bike profile](http://127.0.0.1:8766/tools/calibration-ui/?preview=profile).
- [Guided calibration](http://127.0.0.1:8766/tools/calibration-ui/?preview=guide).

Check at least the 1440 × 852 and 1100 × 772 viewport sizes. The dimension check uses the browser's current viewport and does not replace visual inspection.

## Coverage

The checks cover initial loading, gear previews, input validation, millimetre-to-metre conversion, draft preservation during periodic updates, save confirmation, persistent errors, existing difficulty settings such as 60% and 0%, explicit test start, cancellation, calibration states, keyboard navigation, focus and dialog dismissal.

The bridge is simulated. It does not import the game, native bridge or Bluetooth code. **It sends no trainer commands and does not change the application's settings.** Power readings and calibration results in the test cases are synthetic; they do not demonstrate physical KICKR response. Manual previews always start with the trainer disconnected.
