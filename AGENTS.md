# Protect the chess library during development

The user's existing library is data, not demo content. Preserve openings, games, notes, blunders, move annotations, and unknown fields during every change. Do not reset browser storage, replace a saved library with seed data, or change storage keys without an explicit, backward-compatible migration. The existing keys include `opening-notebook-v2`, `opening-notebook-v1`, and `opening-notebook-marks-v1`.

Before changing storage or import/export behavior, preserve the original data and test with an existing-library fixture containing nested openings, games, game notes, opening notes, blunders and board annotations. Verify that saving, reloading, export, import, and migration retain these records. If stored data is unreadable or storage is unavailable, do not overwrite the original; show a clear recovery message.

The standalone demo stores data in the current browser and origin. A GitHub Pages site is a different origin, and cloud sync is not deployed. Never represent source-code publication as a backup or automatic synchronization of the user's chess data.
