// Elevation sampling from DEM tiles.

import { DEM_SOURCE_ID, DEM_MAX_Z } from './constants.js';

// ---- Elevation sampling ----

export function sampleElevationFromDEMData(dem, fx, fy) {
  if (!dem || typeof dem.get !== 'function' || typeof dem.dim !== 'number') return null;
  const dim = dem.dim;
  const px = Math.max(0, Math.min(dim - 1, fx * dim));
  const py = Math.max(0, Math.min(dim - 1, fy * dim));

  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, dim - 1);
  const y1 = Math.min(y0 + 1, dim - 1);

  const tx = px - x0;
  const ty = py - y0;

  const e00 = dem.get(x0, y0);
  const e10 = dem.get(x1, y0);
  const e01 = dem.get(x0, y1);
  const e11 = dem.get(x1, y1);

  return (1 - tx) * (1 - ty) * e00 + tx * (1 - ty) * e10 + (1 - tx) * ty * e01 + tx * ty * e11;
}

export function queryLoadedElevationAtLngLat(map, lngLat) {
  const style = map && map.style;
  const tileManager = style && style.tileManagers && style.tileManagers[DEM_SOURCE_ID];
  if (!tileManager || !tileManager.getRenderableIds || !tileManager.getTileByID) return null;

  const tilesByCanonical = new Map();
  for (const id of tileManager.getRenderableIds()) {
    const tile = tileManager.getTileByID(id);
    if (!tile || !tile.dem || !tile.tileID || !tile.tileID.canonical) continue;
    const c = tile.tileID.canonical;
    tilesByCanonical.set(`${c.z}/${c.x}/${c.y}`, tile);
  }

  const lat = Math.max(-85.051129, Math.min(85.051129, lngLat.lat));
  const lngWrapped = ((lngLat.lng + 180) % 360 + 360) % 360 - 180;
  const rad = lat * Math.PI / 180;
  const mx = Math.max(0, Math.min(1 - 1e-15, (lngWrapped + 180) / 360));
  const my = Math.max(0, Math.min(1 - 1e-15, (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2));

  const maxZ = Math.min(typeof tileManager.maxzoom === 'number' ? tileManager.maxzoom : DEM_MAX_Z, DEM_MAX_Z);
  const minZ = Math.max(typeof tileManager.minzoom === 'number' ? tileManager.minzoom : 0, 0);

  for (let z = maxZ; z >= minZ; z--) {
    const n = Math.pow(2, z);
    const x = Math.min(Math.floor(mx * n), n - 1);
    const y = Math.min(Math.floor(my * n), n - 1);
    const tile = tilesByCanonical.get(`${z}/${x}/${y}`);
    if (!tile || !tile.dem) continue;

    const fx = mx * n - x;
    const fy = my * n - y;
    const elevation = sampleElevationFromDEMData(tile.dem, fx, fy);
    if (elevation === null) continue;

    // Compute slope via central differences on the DEM grid
    const dim = tile.dem.dim;
    const px = fx * dim, py = fy * dim;
    const dx = 1; // 1 pixel offset
    const eL = sampleElevationFromDEMData(tile.dem, Math.max(0, (px - dx)) / dim, fy);
    const eR = sampleElevationFromDEMData(tile.dem, Math.min(dim - 1, (px + dx)) / dim, fy);
    const eD = sampleElevationFromDEMData(tile.dem, fx, Math.max(0, (py - dx)) / dim);
    const eU = sampleElevationFromDEMData(tile.dem, fx, Math.min(dim - 1, (py + dx)) / dim);
    let slopeDeg = null;
    if (eL != null && eR != null && eD != null && eU != null) {
      const latRad = lat * Math.PI / 180;
      const cellMeters = (40075016.7 / n / dim) * Math.cos(latRad);
      const dzx = (eR - eL) / (2 * cellMeters);
      const dzy = (eU - eD) / (2 * cellMeters);
      slopeDeg = Math.atan(Math.sqrt(dzx * dzx + dzy * dzy)) * 180 / Math.PI;
    }

    return {elevation, slopeDeg, tileZoom: z};
  }

  return null;
}

// ---- Tile processing helpers ----

function idxPad(x, y) {
  return (y + 1) * PAD_STRIDE + (x + 1);
}

function createFallbackTileRecord(z, x, y) {
  return {
    key: `${z}/${x}/${y}`,
    z,
    x,
    y,
    core: new Float32Array(CORE_DIM * CORE_DIM),
    padded: new Float32Array(PAD_STRIDE * PAD_STRIDE),
    texture: null,
    loaded: false,
    dirtyTexture: true
  };
}

function initPaddedFromCore(tile) {
  for (let y = 0; y < CORE_DIM; y++) {
    for (let x = 0; x < CORE_DIM; x++) {
      tile.padded[idxPad(x, y)] = tile.core[y * CORE_DIM + x];
    }
  }

  for (let x = 0; x < CORE_DIM; x++) {
    tile.padded[idxPad(x, -1)] = tile.padded[idxPad(x, 0)];
    tile.padded[idxPad(x, CORE_DIM)] = tile.padded[idxPad(x, CORE_DIM - 1)];
  }
  for (let y = 0; y < CORE_DIM; y++) {
    tile.padded[idxPad(-1, y)] = tile.padded[idxPad(0, y)];
    tile.padded[idxPad(CORE_DIM, y)] = tile.padded[idxPad(CORE_DIM - 1, y)];
  }

  tile.padded[idxPad(-1, -1)] = tile.padded[idxPad(0, 0)];
  tile.padded[idxPad(CORE_DIM, -1)] = tile.padded[idxPad(CORE_DIM - 1, 0)];
  tile.padded[idxPad(-1, CORE_DIM)] = tile.padded[idxPad(0, CORE_DIM - 1)];
  tile.padded[idxPad(CORE_DIM, CORE_DIM)] = tile.padded[idxPad(CORE_DIM - 1, CORE_DIM - 1)];

  tile.dirtyTexture = true;
}

function adjustedDx(aTile, bTile) {
  const world = Math.pow(2, aTile.z);
  let dx = bTile.x - aTile.x;
  if (Math.abs(dx) > 1) {
    if (Math.abs(dx + world) === 1) dx += world;
    else if (Math.abs(dx - world) === 1) dx -= world;
  }
  return dx;
}

function backfillBorder(dstTile, srcTile, dx, dy) {
  let xMin = dx * CORE_DIM;
  let xMax = dx * CORE_DIM + CORE_DIM;
  let yMin = dy * CORE_DIM;
  let yMax = dy * CORE_DIM + CORE_DIM;

  if (dx === -1) xMin = xMax - 1;
  if (dx === 1) xMax = xMin + 1;
  if (dy === -1) yMin = yMax - 1;
  if (dy === 1) yMax = yMin + 1;

  const ox = -dx * CORE_DIM;
  const oy = -dy * CORE_DIM;

  for (let y = yMin; y < yMax; y++) {
    for (let x = xMin; x < xMax; x++) {
      dstTile.padded[idxPad(x, y)] = srcTile.padded[idxPad(x + ox, y + oy)];
    }
  }

  dstTile.dirtyTexture = true;
}

function uploadPaddedTexture(gl, tile) {
  if (!tile.loaded || !tile.dirtyTexture) return;

  const bytes = new Uint8Array(PAD_STRIDE * PAD_STRIDE * 4);
  for (let i = 0; i < tile.padded.length; i++) {
    encodeTerrarium(tile.padded[i], bytes, i * 4);
  }

  if (!tile.texture) tile.texture = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, tile.texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, PAD_STRIDE, PAD_STRIDE, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);

  tile.dirtyTexture = false;
}

// ---- WebGL hybrid border layer ----

export function createHybridBorderLayer(state, getVisibleTriplesForMap, updateStatus) {
  return {
    id: 'dem-analysis-hybrid-border',
    type: 'custom',
    renderingMode: '2d',

    map: null,
    program: null,
    buffer: null,
    aPos: -1,
    aUv: -1,
    uMatrix: null,
    uDem: null,
    uOpacity: null,
    uMode: null,
    uZoom: null,
    uLatRange: null,
    uTileSize: null,
    uTexel: null,
    uUvOffset: null,
    uUvScale: null,

    internalTextures: new Map(),
    fallbackTiles: new Map(),
    fallbackInFlight: new Set(),

    onAdd(map, gl) {
      this.map = map;

      const vertexSource = `
        precision highp float;
        uniform mat4 u_matrix;
        attribute vec2 a_pos;
        attribute vec2 a_uv;
        varying vec2 v_uv;
        void main() {
          v_uv = a_uv;
          gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
        }
      `;

      const fragmentSource = `
        precision highp float;
        uniform sampler2D u_dem;
        uniform float u_opacity;
        uniform int u_mode;
        uniform float u_zoom;
        uniform vec2 u_latrange;
        uniform float u_tile_size;
        uniform vec2 u_texel;
        uniform float u_uv_offset;
        uniform float u_uv_scale;
        uniform int u_step_count;
        uniform float u_step_values[${MAX_STEP_STOPS}];
        uniform vec3 u_step_colors[${MAX_STEP_STOPS + 1}];
        varying vec2 v_uv;

        float decodeTerrarium(vec4 c) {
          float r = c.r * 255.0;
          float g = c.g * 255.0;
          float b = c.b * 255.0;
          return (r * 256.0 + g + b / 256.0) - 32768.0;
        }

        vec2 paddedUV(vec2 uv) {
          return uv * u_uv_scale + vec2(u_uv_offset);
        }

        float elevationAt(vec2 uv) {
          return decodeTerrarium(texture2D(u_dem, clamp(uv, vec2(0.0), vec2(1.0))));
        }

        vec2 coreUVForDeriv(vec2 uvCore) {
          vec2 tileCoord = floor(clamp(uvCore, vec2(0.0), vec2(1.0)) * u_tile_size);
          tileCoord = clamp(tileCoord, vec2(0.0), vec2(u_tile_size - 1.0));
          return (tileCoord + vec2(0.5)) / u_tile_size;
        }

        vec2 hornDeriv(vec2 uvCore) {
          vec2 uv = paddedUV(uvCore);
          vec2 e = u_texel;

          float a = elevationAt(uv + vec2(-e.x, -e.y));
          float b = elevationAt(uv + vec2(0.0, -e.y));
          float c = elevationAt(uv + vec2(e.x, -e.y));
          float d = elevationAt(uv + vec2(-e.x, 0.0));
          float f = elevationAt(uv + vec2(e.x, 0.0));
          float g = elevationAt(uv + vec2(-e.x, e.y));
          float h = elevationAt(uv + vec2(0.0, e.y));
          float i = elevationAt(uv + vec2(e.x, e.y));

          float dzdx = (c + 2.0 * f + i) - (a + 2.0 * d + g);
          float dzdy = (g + 2.0 * h + i) - (a + 2.0 * b + c);

          vec2 deriv = vec2(dzdx, dzdy) * u_tile_size / pow(2.0, 28.2562 - u_zoom);
          float lat = (u_latrange.x - u_latrange.y) * (1.0 - uvCore.y) + u_latrange.y;
          deriv /= max(cos(radians(lat)), 0.0001);
          return deriv;
        }

        vec3 colorFromStep(float value) {
          vec3 color = u_step_colors[0];
          for (int i = 0; i < ${MAX_STEP_STOPS}; i++) {
            if (i >= u_step_count) break;
            if (value >= u_step_values[i]) {
              color = u_step_colors[i + 1];
            }
          }
          return color;
        }

        void main() {
          vec2 d = hornDeriv(coreUVForDeriv(v_uv));
          float gradient = length(d);
          float slopeDeg = clamp(degrees(atan(gradient)), 0.0, 90.0);

          float aspectDeg = degrees(atan(d.y, -d.x));
          aspectDeg = mod(90.0 - aspectDeg, 360.0);
          if (gradient < 0.0001) aspectDeg = 0.0;

          float scalar = (u_mode == 0) ? slopeDeg : aspectDeg;
          vec3 color = colorFromStep(scalar);
          gl_FragColor = vec4(color * u_opacity, u_opacity);
        }
      `;

      function compile(gl, type, src) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed');
        }
        return shader;
      }

      const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
      const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);

      this.program = gl.createProgram();
      gl.attachShader(this.program, vs);
      gl.attachShader(this.program, fs);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(this.program) || 'Program link failed');
      }

      this.aPos = gl.getAttribLocation(this.program, 'a_pos');
      this.aUv = gl.getAttribLocation(this.program, 'a_uv');
      this.uMatrix = gl.getUniformLocation(this.program, 'u_matrix');
      this.uDem = gl.getUniformLocation(this.program, 'u_dem');
      this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity');
      this.uMode = gl.getUniformLocation(this.program, 'u_mode');
      this.uZoom = gl.getUniformLocation(this.program, 'u_zoom');
      this.uLatRange = gl.getUniformLocation(this.program, 'u_latrange');
      this.uTileSize = gl.getUniformLocation(this.program, 'u_tile_size');
      this.uTexel = gl.getUniformLocation(this.program, 'u_texel');
      this.uUvOffset = gl.getUniformLocation(this.program, 'u_uv_offset');
      this.uUvScale = gl.getUniformLocation(this.program, 'u_uv_scale');
      this.uStepCount = gl.getUniformLocation(this.program, 'u_step_count');
      this.uStepValues = gl.getUniformLocation(this.program, 'u_step_values');
      this.uStepColors = gl.getUniformLocation(this.program, 'u_step_colors');

      this.buffer = gl.createBuffer();
    },

    getDemTileManager() {
      const style = this.map && this.map.style;
      if (!style || !style.tileManagers) return null;
      return style.tileManagers[DEM_SOURCE_ID] || null;
    },

    getVisibleTriples() {
      return getVisibleTriplesForMap(this.map);
    },

    updateInternalTexture(gl, internalTile) {
      if (!internalTile.dem || !internalTile.dem.getPixels || typeof internalTile.dem.stride !== 'number') return null;

      const uid = String(internalTile.dem.uid);
      const cacheKey = `dem:${uid}`;
      const stride = internalTile.dem.stride;
      const cached = this.internalTextures.get(cacheKey);
      if (cached) return cached;

      const pixels = internalTile.dem.getPixels();
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, stride, stride, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels.data);

      const entry = {
        texture: tex,
        stride
      };
      this.internalTextures.set(cacheKey, entry);
      return entry;
    },

    async ensureFallbackTile(v, gl) {
      if (!this.fallbackTiles.has(v.key)) {
        this.fallbackTiles.set(v.key, createFallbackTileRecord(v.z, v.x, v.y));
      }
      const tile = this.fallbackTiles.get(v.key);

      if (tile.loaded || this.fallbackInFlight.has(v.key)) return tile;

      this.fallbackInFlight.add(v.key);
      try {
        const url = demTileUrl(v.z, v.x, v.y);
        const response = await fetch(url, {mode: 'cors', cache: 'force-cache'});
        if (!response.ok) throw new Error(`DEM tile ${v.key}: HTTP ${response.status}`);

        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = CORE_DIM;
        canvas.height = CORE_DIM;
        const ctx = canvas.getContext('2d', {willReadFrequently: true});
        ctx.drawImage(bitmap, 0, 0, CORE_DIM, CORE_DIM);
        const bytes = ctx.getImageData(0, 0, CORE_DIM, CORE_DIM).data;

        for (let i = 0; i < CORE_DIM * CORE_DIM; i++) {
          const bi = i * 4;
          tile.core[i] = decodeTerrarium(bytes[bi], bytes[bi + 1], bytes[bi + 2]);
        }

        initPaddedFromCore(tile);
        tile.loaded = true;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx0 = -1; dx0 <= 1; dx0++) {
            if (dx0 === 0 && dy === 0) continue;
            const nx = normalizeTileX(tile.x + dx0, tile.z);
            const ny = tile.y + dy;
            if (ny < 0 || ny >= Math.pow(2, tile.z)) continue;

            const nKey = `${tile.z}/${nx}/${ny}`;
            const neighbor = this.fallbackTiles.get(nKey);
            if (!neighbor || !neighbor.loaded) continue;

            const dx = adjustedDx(tile, neighbor);
            const ddy = neighbor.y - tile.y;
            if (Math.abs(dx) > 1 || Math.abs(ddy) > 1 || (dx === 0 && ddy === 0)) continue;

            backfillBorder(tile, neighbor, dx, ddy);
            backfillBorder(neighbor, tile, -dx, -ddy);
          }
        }

        uploadPaddedTexture(gl, tile);
        this.map.triggerRepaint();
      } catch (err) {
        console.error('Fallback DEM fetch failed:', v.key, err);
      } finally {
        this.fallbackInFlight.delete(v.key);
      }

      return tile;
    },

    render(gl, args) {
      if (!state.mode || state.mode === 'color-relief' || state.effectiveSlopeOpacity <= 0) {
        state.internalCount = 0;
        state.fallbackCount = 0;
        updateStatus();
        return;
      }

      state.internalCount = 0;
      state.fallbackCount = 0;

      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.uMatrix, false, args.defaultProjectionData.mainMatrix);
      gl.uniform1f(this.uOpacity, state.effectiveSlopeOpacity);
      const renderAsSlope = (state.mode === 'slope' || state.mode === 'slope+relief');
      gl.uniform1i(this.uMode, renderAsSlope ? 0 : 1);

      const ramp = renderAsSlope ? PARSED_RAMPS.slope : PARSED_RAMPS.aspect;
      gl.uniform1i(this.uStepCount, ramp.stepCount);
      gl.uniform1fv(this.uStepValues, ramp.values);
      gl.uniform3fv(this.uStepColors, ramp.colors);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(this.aUv);
      gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 16, 8);

      gl.enable(gl.BLEND);
      if (state.multiplyBlend) {
        gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      } else {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }

      const tileManager = this.getDemTileManager();
      const visible = this.getVisibleTriples();

      const internalByCanonical = new Map();
      if (tileManager && tileManager.getRenderableIds && tileManager.getTileByID) {
        const ids = tileManager.getRenderableIds();
        for (const id of ids) {
          const tile = tileManager.getTileByID(id);
          if (!tile || !tile.tileID || !tile.tileID.canonical) continue;
          const cz = tile.tileID.canonical.z;
          const cx = tile.tileID.canonical.x;
          const cy = tile.tileID.canonical.y;
          internalByCanonical.set(`${cz}/${cx}/${cy}`, tile);
        }
      }

      for (const v of visible) {
        const tileBounds = tileToLngLatBounds(v.x, v.y, v.z);
        const canonicalKey = `${v.z}/${v.x}/${v.y}`;

        let texture = null;
        let stride = PAD_STRIDE;
        let wrap = 0;

        const internalTile = internalByCanonical.get(canonicalKey);
        if (internalTile) {
          const internalTex = this.updateInternalTexture(gl, internalTile);
          if (internalTex) {
            texture = internalTex.texture;
            stride = internalTex.stride;
            wrap = internalTile.tileID && typeof internalTile.tileID.wrap === 'number' ? internalTile.tileID.wrap : 0;
            state.internalCount += 1;
          }
        }

        if (!texture) {
          this.ensureFallbackTile(v, gl);
          const fallback = this.fallbackTiles.get(v.key);
          if (!fallback || !fallback.loaded) continue;
          uploadPaddedTexture(gl, fallback);
          if (!fallback.texture) continue;
          texture = fallback.texture;
          stride = PAD_STRIDE;
          wrap = 0;
          state.fallbackCount += 1;
        }

        const verts = mercatorVertsForTile(v.z, v.x, v.y, wrap);

        gl.uniform1f(this.uZoom, v.z);
        gl.uniform2f(this.uLatRange, tileBounds.north, tileBounds.south);
        gl.uniform1f(this.uTileSize, stride - 2);
        gl.uniform2f(this.uTexel, 1 / stride, 1 / stride);
        gl.uniform1f(this.uUvOffset, 1 / stride);
        gl.uniform1f(this.uUvScale, (stride - 2) / stride);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(this.uDem, 0);

        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      updateStatus();
    },

    onRemove(_map, gl) {
      for (const entry of this.internalTextures.values()) {
        if (entry.texture) gl.deleteTexture(entry.texture);
      }
      for (const tile of this.fallbackTiles.values()) {
        if (tile.texture) gl.deleteTexture(tile.texture);
      }

      this.internalTextures.clear();
      this.fallbackTiles.clear();
      this.fallbackInFlight.clear();

      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.program) gl.deleteProgram(this.program);
    }
  };
}
