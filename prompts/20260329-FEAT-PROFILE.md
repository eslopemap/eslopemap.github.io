1. commit already-staged changes
2. ANALYSIS_COLOR.slope ramp rendering is missing the grey in maplibre, while rampToLegendCss works fine - investigate if issue is from maplibre or here

3. add those small features:  
    * need to be able to select a track by clicking it
    * figure out a way to show single-track file on 1 row, and single-segment track on 1 row -- to optimize space and reduce visual clutter. both menu items should be available though...
    * in profile:
      * clamp h-speed to 90% percentiles
      * clamp v-speed display to positive: 0-90% percentiles
      * the smoothing is still not happening 
      * it should be possible to resize profile to 2/3 of screen height with a toggle on top-right of the panel (left of cross)
      * fix track-panel-header background not aligned
  
as usual commit regularly