
doc:
* check `git log` over last 3 days and update FEATURES.md accordingly, keeping it succinct and DRY
* look at each occurence of 'Slope' as the name of the app in user-facing docs and if it's not 'Slope Mapper then replace it with 'Slope Mapper'. 

chore:
* update all tests with the new test mode and fix the failing ones.

bug:
- regarding the new IGN topo 
sometimes I get Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://data.geopf.fr/private/wmts?apikey=ign_scan_ws&layer=GEOGRAPHICALGRIDSYSTEMS.MAPS&style=normal&tilematrixset=PM&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fjpeg&TileMatrix=6&TileCol=32&TileRow=23 (Reason: CORS request did not succeed). Status code: (null).
I ran curl -I -H eslopemap.github.io ... but this works
edit: This CORS failure was indeed an intermittent network failure. no need to do anything.

---
then prepare the next stage:

* There are 3 buttons that toggle panels: settings (left panel), profile (bottom panel), tracks (right panel). what UX good practice can make their function more obvious and aligned? think carefully of their placement and the interaction with other widgets.

* check /UI.md and consider the top row widgets (settings #settings-controls-toggle, #search-box, #edit-rail which we are moving to top-center, and #track-tool-row toolbar). put all of them in the same <div id="controls-wrapper"> with responsive layout: 
- desktop layout: when growing, settings & search stays on the left, edit-rail in the center, track-tool-row on the right, with empty space between.
  when i toggle track-panel, it does not contain (in html hierarchy) the track-tool-row buttons anymore, it is just displayed behind with a enough width to appear to include the buttons
- on mobile, I want this new #controls div at the bottom, in a 'bottom navigation bar' position, outside of the map component, taking full-width, no text on 'settings' to save space, responsive design with buttons spaced out up to some max-width, and text labels that starts appearing when wider, from the left. 

fill in the gaps in this high-level description, make everything consistent, apply UX best practices, but keep height small as it is. write the plan to /plans/20260401-PLAN-TOP-ROW.md


focused commits for each task. include this file. dedicated report file if needed.
