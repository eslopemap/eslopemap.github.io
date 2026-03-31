
1. add 
- ign orthophoto baselayer, 
- ign ski and swisstopo ski overlays
commit those changes.
2. then add gpx coordinates in the elevation/slope cursor info (both desktop and mobile flavour.) the new format should be like `xx.xxxº, xx.xxxº, x m, Slope: ...`
commit

3. those layer defintions are all over the place.
make a proposal in 
plans/<yyyymmdd>-PLAN-LAYERS.md for a more maintainable design, addressing as well the need for user-built composite maps.
4. then investigate how build a plans/<yyyymmdd>-PLAN-GPX-WEB-IMPORT.md on the following premise:
I can paste a URL of either
- https://www.camptocamp.org/outings/1868877/fr/traversee-cougourde-guilie-fremamorte
- https://skitour.fr/sorties/186927
- https://www.gulliver.it/itinerari/tibert-monte-da-santuario-di-san-magno/#map
- any direct link to a gpx download

and for each of those supported site, the correct api calls would be made to load the gpx track and display it

check for correct aproach eg

- for skitour, direct link https://skitour.fr/downloadGPX/sorties/186927 or API https://skitour.fr/api/
- for camptocamp, try the URL called by clicking 'GPX' button, or for API check local ./c2c_api folder 
- gulliver 
https://www.gulliver.it/wp-content/uploads/2009/12/11/oserot-monte-da-bersezio_5f11.gpx but the actual link has to be parsed from the page I guess


I understand there may be restrictions (CORS, Referer ...), make curl tests, skip those where  some protection cannot be worked around, and handle errors gracefully with  messages.

as usual, highlight  decision points