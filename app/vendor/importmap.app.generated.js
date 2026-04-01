(function () {
  const importMap = {
    "imports": {
      "@we-gold/gpxjs": "./vendor/@we-gold/gpxjs/1.1.0/dist/gpxjs.js",
  
      "chart.js": "./vendor/chart.js/4.5.1/dist/chart.js",
  
      "chart.js/auto": "./vendor/chart.js/4.5.1/auto/auto.js",
  
      "chart.js/helpers": "./vendor/chart.js/4.5.1/helpers/helpers.js",
  
      "@kurkle/color": "./vendor/@kurkle/color/0.4.0/dist/color.esm.js",
  
      "chartjs-plugin-annotation": "./vendor/chartjs-plugin-annotation/3.1.0/dist/chartjs-plugin-annotation.esm.js"
    }
  };
  const script = document.createElement('script');
  script.type = 'importmap';
  script.textContent = JSON.stringify(importMap, null, 2);
  const currentScript = document.currentScript;
  if (currentScript && currentScript.parentNode) {
    currentScript.parentNode.insertBefore(script, currentScript.nextSibling);
  } else {
    document.head.appendChild(script);
  }
})();
