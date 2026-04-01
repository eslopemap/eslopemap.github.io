(function () {
  const importMap = {
    "imports": {
      "marked": "../vendor/marked/17.0.5/lib/marked.esm.js"
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
