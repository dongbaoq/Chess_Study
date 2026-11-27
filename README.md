# The Opening Notebook

A personal chess study website. White and Black repertoires are separate. Saved openings, games, notes, blunders, and board markings live in the browser on the current device. A GitHub repository contains website files; it does not automatically contain or synchronize your chess library.

## Save and back up your study

Notes save in the browser as you type. To make a separate backup, scroll to **Library Storage**, select **Synchronize**, then **Export backup**. Keep the downloaded `chess-study-backup.json` somewhere safe. On another browser or device, open the website, choose **Synchronize**, then **Import backup** and select that file. Importing replaces that browser's current library, so export its current library first if you need to keep it. Do not upload a personal backup to a public GitHub repository.

Browser storage can be lost if browser data is cleared. This prototype's private online sync is not deployed. If the site reports that saved data cannot be read, do not erase browser data; use the recovery controls and keep the original copy.

## Upload to GitHub

Extract the GitHub website ZIP. Create a GitHub repository, open its **Code** page, choose **Add file → Upload files**, and upload the extracted files and folders to the repository root. Make sure `index.html` is at the root. Commit the files. To publish with GitHub Pages, go to **Settings → Pages**, select **Deploy from a branch**, choose `main` and `/(root)`, then save. See GitHub's official documentation for current access and plan details.

The GitHub Pages address uses a different browser storage location from a local file. Export the existing demo's backup first and import it after opening the GitHub Pages site. Moving the code to GitHub alone does not move your study data or synchronize devices.

Select a move on the board or in the move list, then use the **Marking** buttons to add a mistake (?), only move (!), brilliant move (!!), or blunder (??) symbol. Press the active button again to remove it. The symbol appears on the board and in the move list, is saved with the opening or game, and follows each analysis variation.

The move explorer shows saved continuations and game moves. Blunders are manually marked, not automatically evaluated. Pasted games must start from the standard chess position; PGN comments and variations remain in the pasted text but do not become displayed notes.

Chess piece artwork attribution is in `ATTRIBUTION.md` and the site footer. `AGENTS.md` records how future development should protect existing saved libraries.

To keep an opening variation without creating a subfolder, play to the position and select **Save line** beside the marking buttons. The saved moves remain in the opening’s move explorer when you return. Your existing folder position and subfolders are unchanged.

Select **Copy PGN** beside the move list to copy the current path through the position on the board. It excludes later moves, other variations, and notes.

Games with a recorded PGN result show the winning and losing sides (or a draw) in the game list and at the final recorded board position. Games without a clear result remain unlabelled.

To create an independent opening such as the Sicilian Defense, choose **Add opening** above the opening list and enter its moves from the starting position (for example, `1. e4 c5`). **Add subfolder** continues the currently selected opening.

Right-click a square to circle it, or right-drag to draw an arrow. Use Shift or Ctrl for red, Alt or Command for blue, and combine them for yellow. Repeat a mark to remove it. On touchscreens, use **Draw**. Existing saved square markings display as circles.
