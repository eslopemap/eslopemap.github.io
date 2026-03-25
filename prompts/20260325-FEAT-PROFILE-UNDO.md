* check if the code for ' Rectangle delete — ⬚ button with red dashed overlay' work on mobile ? ie I click it and drag on screen ? on mobile it would be nice to have a userfriendly way to confirm since touch on mobile is more error prone 

* add a toast when I double-click to stop track edition

* add real undo stack (on ctrl-z + toolbar button). KISS.

* on profile.js,
  - add horizontal and vertical speed.
  - add pause detection on the gpx (default threshold 5 minutes, add it to advanced settings panel) and show pauses in an unobtrusive way eg a point on x-axis with info on hover/    
  - add support for date, time, and time-without-pauses on x-axis. move x legend eg 'km' to the bottom left to optimize height fill 
  - add a small menu to the left of legend/close row with checkboxes to show/hide things (curves, pauses ). display settings are saved.

* make sure to split js files as you go to keep things modular
* phase the changes and make intermediate commits, incl. slope.md updates.