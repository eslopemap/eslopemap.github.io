var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: !0, configurable: !0, writable: !0, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: !0 });
var __publicField = (obj, key, value) => (__defNormalProp(obj, typeof key != "symbol" ? key + "" : key, value), value);
const DEFAULT_OPTIONS = {
  // delete null fields in output
  removeEmptyFields: !0,
  // average speed threshold (in m/ms) used to determine the moving duration
  avgSpeedThreshold: 215e-6
}, calculateDistance = /* @__PURE__ */ __name((points) => {
  const cumulativeDistance = [0];
  for (let i = 0; i < points.length - 1; i++) {
    const currentTotalDistance = cumulativeDistance[i] + haversineDistance(points[i], points[i + 1]);
    cumulativeDistance.push(currentTotalDistance);
  }
  return {
    cumulative: cumulativeDistance,
    total: cumulativeDistance[cumulativeDistance.length - 1]
  };
}, "calculateDistance"), haversineDistance = /* @__PURE__ */ __name((point1, point2) => {
  const toRadians = /* @__PURE__ */ __name((degrees) => degrees * Math.PI / 180, "toRadians"), lat1Radians = toRadians(point1.latitude), lat2Radians = toRadians(point2.latitude), sinDeltaLatitude = Math.sin(
    toRadians(point2.latitude - point1.latitude) / 2
  ), sinDeltaLongitude = Math.sin(
    toRadians(point2.longitude - point1.longitude) / 2
  ), a = sinDeltaLatitude ** 2 + Math.cos(lat1Radians) * Math.cos(lat2Radians) * sinDeltaLongitude ** 2;
  return 6371e3 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}, "haversineDistance"), calculateDuration = /* @__PURE__ */ __name((points, distance, calculOptions = DEFAULT_OPTIONS) => {
  var _a;
  const { avgSpeedThreshold } = calculOptions, allTimedPoints = [], cumulative = [0];
  let lastTime = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const time = points[i].time, dist = distance.cumulative[i], previousPoint = cumulative[i];
    if (time !== null) {
      const movingTime = time.getTime() - lastTime;
      if (movingTime > 0) {
        let sumDistances = 0, sumTime = 0;
        for (let j = i; j >= 0; j--) {
          const prevTime = (_a = points[j].time) == null ? void 0 : _a.getTime();
          if (prevTime !== void 0) {
            const timeDiff = time.getTime() - prevTime;
            if (timeDiff > 1e4)
              break;
            sumDistances += distance.cumulative[j + 1] - distance.cumulative[j], sumTime += timeDiff;
          }
        }
        const nextCumul = (sumTime > 0 ? sumDistances / sumTime : 0) > avgSpeedThreshold ? previousPoint + movingTime : previousPoint;
        cumulative.push(nextCumul);
      } else
        cumulative.push(previousPoint);
      lastTime = time.getTime(), allTimedPoints.push({ time, distance: dist });
    } else
      cumulative.push(previousPoint);
  }
  const totalDuration = allTimedPoints.length === 0 ? 0 : allTimedPoints[allTimedPoints.length - 1].time.getTime() - allTimedPoints[0].time.getTime();
  return {
    startTime: allTimedPoints.length ? allTimedPoints[0].time : null,
    endTime: allTimedPoints.length ? allTimedPoints[allTimedPoints.length - 1].time : null,
    cumulative,
    movingDuration: cumulative[cumulative.length - 1] / 1e3,
    // Convert to seconds
    totalDuration: totalDuration / 1e3
    // Convert to seconds
  };
}, "calculateDuration"), calculateElevation = /* @__PURE__ */ __name((points) => {
  var _a, _b;
  let dp = 0, dn = 0;
  const elevation = [];
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const nextElevation = (_a = points[i + 1]) == null ? void 0 : _a.elevation, currentElevation = (_b = points[i]) == null ? void 0 : _b.elevation;
    if (nextElevation !== null && currentElevation !== null) {
      const diff = nextElevation - currentElevation;
      diff < 0 ? dn += diff : diff > 0 && (dp += diff);
    }
  }
  for (const point of points)
    point.elevation !== null && (elevation.push(point.elevation), sum += point.elevation);
  let max = elevation[0] ?? null, min = elevation[0] ?? null;
  for (let i = 1; i < elevation.length; i++)
    elevation[i] > max && (max = elevation[i]), elevation[i] < min && (min = elevation[i]);
  return {
    maximum: max,
    minimum: min,
    positive: Math.abs(dp) || null,
    negative: Math.abs(dn) || null,
    average: elevation.length ? sum / elevation.length : null
  };
}, "calculateElevation"), calculateSlopes = /* @__PURE__ */ __name((points, cumulativeDistance) => {
  var _a, _b;
  const slopes = [];
  for (let i = 0; i < points.length - 1; i++) {
    const nextElevation = (_a = points[i + 1]) == null ? void 0 : _a.elevation, currentElevation = (_b = points[i]) == null ? void 0 : _b.elevation;
    if (nextElevation !== null && currentElevation !== null) {
      const elevationDifference = nextElevation - currentElevation, displacement = cumulativeDistance[i + 1] - cumulativeDistance[i], slope = elevationDifference * 100 / displacement;
      slopes.push(slope);
    }
  }
  return slopes;
}, "calculateSlopes"), parseGPX = /* @__PURE__ */ __name((gpxSource, options = DEFAULT_OPTIONS) => {
  const parseMethod = /* @__PURE__ */ __name((gpxSource2) => typeof document > "u" ? null : typeof window > "u" ? (console.error(
    "window is undefined, try to use the parseGPXWithCustomParser method"
  ), null) : new window.DOMParser().parseFromString(gpxSource2, "text/xml"), "parseMethod"), allOptions = { ...DEFAULT_OPTIONS, ...options };
  return parseGPXWithCustomParser(gpxSource, parseMethod, allOptions);
}, "parseGPX"), parseGPXWithCustomParser = /* @__PURE__ */ __name((gpxSource, parseGPXToXML, options = DEFAULT_OPTIONS) => {
  const parsedSource = parseGPXToXML(gpxSource);
  if (parsedSource === null)
    return [null, new Error("Provided parsing method failed.")];
  const output = {
    xml: parsedSource,
    metadata: {
      name: "",
      description: "",
      time: "",
      author: null,
      link: null
    },
    waypoints: [],
    tracks: [],
    routes: []
  }, metadata = output.xml.querySelector("metadata");
  if (metadata !== null) {
    output.metadata.name = getElementValue(metadata, "name"), output.metadata.description = getElementValue(metadata, "desc"), output.metadata.time = getElementValue(metadata, "time");
    const authorElement = metadata.querySelector("author");
    if (authorElement !== null) {
      const emailElement = authorElement.querySelector("email"), linkElement2 = authorElement.querySelector("link");
      output.metadata.author = {
        name: getElementValue(authorElement, "name"),
        email: emailElement !== null ? {
          id: emailElement.getAttribute("id") ?? "",
          domain: emailElement.getAttribute("domain") ?? ""
        } : null,
        link: linkElement2 !== null ? {
          href: linkElement2.getAttribute("href") ?? "",
          text: getElementValue(linkElement2, "text"),
          type: getElementValue(linkElement2, "type")
        } : null
      };
    }
    const linkElement = querySelectDirectDescendant(metadata, "link");
    linkElement !== null && (output.metadata.link = {
      href: linkElement.getAttribute("href") ?? "",
      text: getElementValue(linkElement, "text"),
      type: getElementValue(linkElement, "type")
    });
  }
  const waypoints = Array.from(output.xml.querySelectorAll("wpt"));
  for (const waypoint of waypoints) {
    const point = {
      name: getElementValue(waypoint, "name"),
      symbol: getElementValue(waypoint, "sym"),
      latitude: parseFloat(waypoint.getAttribute("lat") ?? ""),
      longitude: parseFloat(waypoint.getAttribute("lon") ?? ""),
      elevation: null,
      comment: getElementValue(waypoint, "cmt"),
      description: getElementValue(waypoint, "desc"),
      time: null
    }, rawElevation = parseFloat(getElementValue(waypoint, "ele") ?? "");
    point.elevation = isNaN(rawElevation) ? null : rawElevation;
    const rawTime = getElementValue(waypoint, "time");
    point.time = rawTime == null ? null : new Date(rawTime), output.waypoints.push(point);
  }
  const routes = Array.from(output.xml.querySelectorAll("rte"));
  for (const routeElement of routes) {
    const route = {
      name: getElementValue(routeElement, "name"),
      comment: getElementValue(routeElement, "cmt"),
      description: getElementValue(routeElement, "desc"),
      src: getElementValue(routeElement, "src"),
      number: getElementValue(routeElement, "number"),
      type: null,
      link: null,
      points: [],
      distance: {
        cumulative: [],
        total: 0
      },
      duration: {
        cumulative: [],
        movingDuration: 0,
        totalDuration: 0,
        endTime: null,
        startTime: null
      },
      elevation: {
        maximum: null,
        minimum: null,
        average: null,
        positive: null,
        negative: null
      },
      slopes: []
    }, type = querySelectDirectDescendant(routeElement, "type");
    route.type = (type == null ? void 0 : type.innerHTML) ?? (type == null ? void 0 : type.textContent) ?? null;
    const linkElement = routeElement.querySelector("link");
    linkElement !== null && (route.link = {
      href: linkElement.getAttribute("href") ?? "",
      text: getElementValue(linkElement, "text"),
      type: getElementValue(linkElement, "type")
    });
    const routePoints = Array.from(routeElement.querySelectorAll("rtept"));
    for (const routePoint of routePoints) {
      const point = {
        latitude: parseFloat(routePoint.getAttribute("lat") ?? ""),
        longitude: parseFloat(routePoint.getAttribute("lon") ?? ""),
        elevation: null,
        time: null,
        extensions: null
      }, rawElevation = parseFloat(
        getElementValue(routePoint, "ele") ?? ""
      );
      point.elevation = isNaN(rawElevation) ? null : rawElevation;
      const rawTime = getElementValue(routePoint, "time");
      point.time = rawTime == null ? null : new Date(rawTime), route.points.push(point);
    }
    route.distance = calculateDistance(route.points), route.duration = calculateDuration(
      route.points,
      route.distance,
      options
    ), route.elevation = calculateElevation(route.points), route.slopes = calculateSlopes(route.points, route.distance.cumulative), output.routes.push(route);
  }
  const tracks = Array.from(output.xml.querySelectorAll("trk"));
  for (const trackElement of tracks) {
    const track = {
      name: getElementValue(trackElement, "name"),
      comment: getElementValue(trackElement, "cmt"),
      description: getElementValue(trackElement, "desc"),
      src: getElementValue(trackElement, "src"),
      number: getElementValue(trackElement, "number"),
      type: null,
      link: null,
      points: [],
      distance: {
        cumulative: [],
        total: 0
      },
      duration: {
        cumulative: [],
        movingDuration: 0,
        totalDuration: 0,
        startTime: null,
        endTime: null
      },
      elevation: {
        maximum: null,
        minimum: null,
        average: null,
        positive: null,
        negative: null
      },
      slopes: []
    }, type = querySelectDirectDescendant(trackElement, "type");
    track.type = (type == null ? void 0 : type.innerHTML) ?? (type == null ? void 0 : type.textContent) ?? null;
    const linkElement = trackElement.querySelector("link");
    linkElement !== null && (track.link = {
      href: linkElement.getAttribute("href") ?? "",
      text: getElementValue(linkElement, "text"),
      type: getElementValue(linkElement, "type")
    });
    const trackPoints = Array.from(trackElement.querySelectorAll("trkpt"));
    for (const trackPoint of trackPoints) {
      const point = {
        latitude: parseFloat(trackPoint.getAttribute("lat") ?? ""),
        longitude: parseFloat(trackPoint.getAttribute("lon") ?? ""),
        elevation: null,
        time: null,
        extensions: null
      }, extensionsElement = trackPoint.querySelector("extensions");
      if (extensionsElement !== null) {
        let extensions = {};
        extensions = parseExtensions(
          extensions,
          extensionsElement.childNodes
        ), point.extensions = extensions;
      }
      const rawElevation = parseFloat(
        getElementValue(trackPoint, "ele") ?? ""
      );
      point.elevation = isNaN(rawElevation) ? null : rawElevation;
      const rawTime = getElementValue(trackPoint, "time");
      point.time = rawTime == null ? null : new Date(rawTime), track.points.push(point);
    }
    track.distance = calculateDistance(track.points), track.duration = calculateDuration(
      track.points,
      track.distance,
      options
    ), track.elevation = calculateElevation(track.points), track.slopes = calculateSlopes(track.points, track.distance.cumulative), output.tracks.push(track);
  }
  return options.removeEmptyFields && (deleteNullFields(output.metadata), deleteNullFields(output.waypoints), deleteNullFields(output.tracks), deleteNullFields(output.routes)), [new ParsedGPX(output, options), null];
}, "parseGPXWithCustomParser"), parseExtensions = /* @__PURE__ */ __name((extensions, extensionChildrenCollection) => (Array.from(extensionChildrenCollection).filter((child) => child.nodeType === 1).forEach((child) => {
  var _a;
  const tagName = child.nodeName;
  if (((_a = child.childNodes) == null ? void 0 : _a.length) === 1 && child.childNodes[0].nodeType === 3 && child.childNodes[0].textContent) {
    const textContent = child.childNodes[0].textContent.trim(), value = isNaN(+textContent) ? textContent : parseFloat(textContent);
    extensions[tagName] = value;
  } else
    extensions[tagName] = {}, extensions[tagName] = parseExtensions(
      extensions[tagName],
      child.childNodes
    );
}), extensions), "parseExtensions"), getElementValue = /* @__PURE__ */ __name((parent, tag) => {
  var _a;
  const element = parent.querySelector(tag);
  return element !== null ? ((_a = element.firstChild) == null ? void 0 : _a.textContent) ?? element.innerHTML ?? null : null;
}, "getElementValue"), querySelectDirectDescendant = /* @__PURE__ */ __name((parent, tag) => {
  try {
    return parent.querySelector(`:scope > ${tag}`);
  } catch {
    return parent.childNodes ? Array.from(parent.childNodes).find(
      (element) => element.tagName == tag
    ) ?? null : null;
  }
}, "querySelectDirectDescendant"), deleteNullFields = /* @__PURE__ */ __name((object) => {
  if (!(typeof object != "object" || object === null || object === void 0)) {
    if (Array.isArray(object)) {
      object.forEach(deleteNullFields);
      return;
    }
    for (const [key, value] of Object.entries(object))
      value == null || value == null ? delete object[key] : deleteNullFields(value);
  }
}, "deleteNullFields"), _ParsedGPX = class _ParsedGPX {
  constructor({ xml, metadata, waypoints, tracks, routes }, options) {
    __publicField(this, "xml");
    __publicField(this, "metadata");
    __publicField(this, "waypoints");
    __publicField(this, "tracks");
    __publicField(this, "routes");
    __publicField(this, "options");
    this.xml = xml, this.metadata = metadata, this.waypoints = waypoints, this.tracks = tracks, this.routes = routes, this.options = options;
  }
  /**
   * Outputs the GPX data as GeoJSON, returning a JavaScript Object.
   *
   * @returns The GPX data converted to the GeoJSON format
   */
  toGeoJSON() {
    const GeoJSON2 = {
      type: "FeatureCollection",
      features: [],
      properties: this.metadata
    }, addFeature = /* @__PURE__ */ __name((track) => {
      const {
        name,
        comment,
        description,
        src,
        number,
        link,
        type,
        points
      } = track, feature = {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [] },
        properties: {
          name,
          comment,
          description,
          src,
          number,
          link,
          type
        }
      };
      for (const point of points) {
        const { longitude, latitude, elevation } = point;
        feature.geometry.coordinates.push([
          longitude,
          latitude,
          elevation
        ]);
      }
      GeoJSON2.features.push(feature);
    }, "addFeature");
    for (const track of [...this.tracks, ...this.routes])
      addFeature(track);
    for (const waypoint of this.waypoints) {
      const {
        name,
        symbol,
        comment,
        description,
        longitude,
        latitude,
        elevation
      } = waypoint, feature = {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [longitude, latitude, elevation]
        },
        properties: { name, symbol, comment, description }
      };
      GeoJSON2.features.push(feature);
    }
    return this.options.removeEmptyFields && deleteNullFields(GeoJSON2), GeoJSON2;
  }
  applyToTrack(trackIndex, func, ...args) {
    if (trackIndex < 0 || trackIndex >= this.tracks.length) {
      console.error("The track index is out of bounds.");
      return;
    }
    try {
      return func(this.tracks[trackIndex].points, ...args);
    } catch (error) {
      throw new Error(
        `An error occurred in the applyToTrack function.
${error}

				Check that the track index is valid, and that the function has the correct arguments.`
      );
    }
  }
  applyToRoute(routeIndex, func, ...args) {
    if (routeIndex < 0 || routeIndex >= this.routes.length) {
      console.error("The route index is out of bounds.");
      return;
    }
    try {
      return func(this.routes[routeIndex].points, ...args);
    } catch (error) {
      throw new Error(
        `An error occurred in the applyToRoute function.
${error}

				Check that the route index is valid, and that the function has the correct arguments.`
      );
    }
  }
};
__name(_ParsedGPX, "ParsedGPX");
let ParsedGPX = _ParsedGPX;
function stringifyGPX(gpx, customXmlSerializer) {
  const doc = gpx.xml.implementation.createDocument(GPX_NS, "gpx");
  return doc.documentElement.setAttribute("version", "1.1"), doc.documentElement.setAttribute("creator", "gpxjs"), new XmlMapper(doc).mapObject(GPX_MAPPING, gpx, doc.documentElement), (customXmlSerializer ?? new XMLSerializer()).serializeToString(doc);
}
__name(stringifyGPX, "stringifyGPX");
const GPX_NS = "http://www.topografix.com/GPX/1/1", EXPR_PROPERTY = "$expr", FOR_PROPERTY = "$for", FUNC_PROPERTY = "$func", LINK_MAPPING = {
  "@href": "=",
  text: "=",
  type: "="
};
function ExtensionsMapping(doc, srcObj, dstElem) {
  for (const key in srcObj) {
    const elem = doc.createElementNS(GPX_NS, key);
    dstElem.append(elem);
    const value = srcObj[key];
    if (typeof value == "object")
      ExtensionsMapping(doc, value, elem);
    else {
      const node = doc.createTextNode(value.toString());
      elem.append(node);
    }
  }
}
__name(ExtensionsMapping, "ExtensionsMapping");
const POINT_MAPPING = {
  "@lat": "latitude",
  "@lon": "longitude",
  ele: "elevation",
  time: "=",
  extensions: {
    $func: ExtensionsMapping
  }
}, GPX_MAPPING = {
  metadata: {
    name: "=",
    desc: "description",
    author: {
      name: "=",
      email: {
        "@id": "=",
        "@domain": "="
      },
      link: LINK_MAPPING
    },
    link: LINK_MAPPING,
    time: "="
  },
  wpt: {
    $expr: "waypoints",
    $for: {
      "@lat": "latitude",
      "@lon": "longitude",
      name: "=",
      desc: "description",
      ele: "elevation",
      time: "=",
      cmt: "comment"
    }
  },
  trk: {
    $expr: "tracks",
    $for: {
      name: "=",
      cmt: "comment",
      desc: "description",
      src: "=",
      number: "=",
      link: LINK_MAPPING,
      type: "=",
      trkseg: {
        $expr: ".",
        trkpt: {
          $expr: "points",
          $for: POINT_MAPPING
        }
      }
    }
  },
  rte: {
    $expr: "routes",
    $for: {
      name: "=",
      cmt: "comment",
      desc: "description",
      src: "=",
      number: "=",
      link: LINK_MAPPING,
      type: "=",
      rtept: {
        $expr: "points",
        $for: POINT_MAPPING
      }
    }
  }
}, _XmlMapper = class _XmlMapper {
  constructor(doc) {
    __publicField(this, "doc");
    this.doc = doc;
  }
  /**
   * Generate XML attributes and elements using the given mapping.
   */
  mapObject(objectMapping, srcObj, dstElem) {
    for (const field in objectMapping)
      field !== EXPR_PROPERTY && this.mapField(field, objectMapping[field], srcObj, dstElem);
  }
  /**
   * Generate XML elements and attributes for the specified field.
   */
  mapField(fieldExpr, mapping, srcObj, dstElem) {
    const isAttribute = fieldExpr.startsWith("@"), fieldName = isAttribute ? fieldExpr.substring(1) : fieldExpr;
    if (typeof mapping == "object") {
      const fieldMapping = mapping, fieldValue = this.evalExpr(srcObj, fieldMapping[EXPR_PROPERTY] ?? "=", fieldName);
      if (fieldValue == null)
        return;
      const forMapping = fieldMapping[FOR_PROPERTY];
      if (forMapping)
        for (const value of fieldValue) {
          const elem = this.doc.createElementNS(GPX_NS, fieldName);
          dstElem.append(elem), this.mapObject(forMapping, value, elem);
        }
      else {
        const elem = this.doc.createElementNS(GPX_NS, fieldName);
        dstElem.append(elem);
        const funcMapping = fieldMapping[FUNC_PROPERTY];
        funcMapping ? funcMapping(this.doc, fieldValue, elem) : this.mapObject(mapping, fieldValue, elem);
      }
    } else if (typeof mapping == "string") {
      const value = this.evalExpr(srcObj, mapping, fieldName);
      if (value == null)
        return;
      if (isAttribute)
        dstElem.setAttribute(fieldName, value);
      else {
        const valueElem = this.doc.createElementNS(GPX_NS, fieldName);
        dstElem.append(valueElem);
        const node = this.doc.createTextNode(value);
        valueElem.append(node);
      }
    } else
      throw new Error(`Unsupported field mapping: ${mapping}`);
  }
  /**
   * Evalutes a field expression for the specified object.  If the expression
   * equals `=`, then the specified `fieldName` will be used.
   */
  evalExpr(srcObj, expr, fieldName) {
    let property = expr;
    if (expr === ".")
      return srcObj;
    expr === "=" && (property = fieldName);
    const value = srcObj[property];
    return value != null && typeof value == "object" && fieldName === "time" ? value.toISOString() : value;
  }
};
__name(_XmlMapper, "XmlMapper");
let XmlMapper = _XmlMapper;
export {
  ParsedGPX,
  calculateDistance,
  calculateDuration,
  calculateElevation,
  calculateSlopes,
  parseGPX,
  parseGPXWithCustomParser,
  stringifyGPX
};
