read git log -10 for context

let's work on improving the custom layer and local layer situation. research and turn thos ramblings into a strong plan:

double-check whether calling scanAndRegisterDesktopTileFolder(folderPath) will actually get it remembered in the backend settings. I didn't see config::save_config(&cfg)?;
I'm unclear how settings persistence should work in general (things like custom sources, tile cache size)
I see 2 paths:
A server-side persistence - but then UI has to retrieve it to display state (currently missing get_cache_max_size counterpart to set_cache. anyweay I want a generic path eg get_config_key/set_config_key instead of set_cache_max_size
B browser-side persistence together with the web stuff - but then the server starts fresh and the UI has to send it the settings to load sources etc, not efficient ?

consider that custom layers should be available client-side too, we were supposed to register any tileJSON server in the web mode. basically there should be a web UI for custom tiles input 
- if I drag a tilejson, it should get into those custom tiles
- if I drag a local mbtiles/pmtile/folder, only then should the extended desktop mode be triggerred : ie the local source needs addded to the server, to be served AND registered on the UI. but in that case we should avoid duplication of state that then needs sync, that's where the UI auto-discovery of backend layers should kick-in.

make a more in-depth comparison, recommend an aproach both for settings and layers, and implement it. make sure to have the full read/write server<>ui flow is working where relevant (at least custom sources, cache size)