user:
review strategy, be critical (but fair)
@20260329-TAURI-DESKTOP-ARCHI.md 

agent:
[...]

user:
# 1.  check recent Tauri changelog for features that may help us

# 2. modify the strategy md file with the following:

* use explicit vendored module paths. no need for a spike, let's just do it for both desktop and web, keeping them aligned.
* "Architecturally, the bridge idea is correct. But it should depend on a stable public Tauri JS surface, not internals." -> a solution for that
* 3. Narrow GPX sync v1 -> agreed
* 4. Add an explicit validation phase before architecture commitment -> agreed, see below, and also include the testing strategy, and how to make this design test-friendly. eg vendoring deps and having test mbtiles files will help TDD


# 3. spikes 

make a plan for the spikes that are needed
for example
spike 1:
<quote>
Make localhost HTTP the primary plan for offline tile serving
For offline/base-map serving, I would favor:
localhost HTTP server first
custom protocol only after a spike proves it works cleanly with MapLibre
Why:
it matches MapLibre’s normal fetch model
easier debugging
clearer MIME/caching semantics
fewer surprises with workers and vector tiles
</quote>
-->
create  '20260331_TAURI_SPIKE1_PLAN_PROTOCOL.md' to create 2 sets of demonstrators  spike_demo/mbtiles_custom_protocol and spike_demo/mbtiles_to_localhost ; those should be minimal tauri apps with only @eslopemap/maplibre-gl as an online dependency, and the minimal set of feature to switch between an online source (osm) and an mbtiles (a dummy one: only z1/2/3 tiles, with each tile being a PNG with square with the coordinates as text, that will be created for demo & test purpose)

add plans for other spikes with same model, as needed, but try to stick to things that we really can't decide without one! and/or mixing things to avoid creating dozens of projects

be thorough.