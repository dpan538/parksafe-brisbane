// data.js — crime data lookup and suburb matching along a route

// Hardcoded Brisbane suburb crime data (from QPS 2023-24 statistics)
// score: 0-100 risk index, rank: high/medium/low
// Will be replaced by crime-cache.json fetch when scraper is ready
const CRIME_DATA = {
    'Brisbane City': { score: 82, rank: 'high',   peak: 'Fri-Sat 20:00-03:00', incidents: 186 },
    'South Brisbane':{ score: 74, rank: 'high',   peak: 'Fri-Sat 19:00-02:00', incidents: 142 },
    'Milton':        { score: 78, rank: 'high',   peak: 'Fri-Sat 20:00-02:00', incidents: 155 },
    'Toowong':       { score: 71, rank: 'high',   peak: 'Thu-Sat 19:00-01:00', incidents: 128 },
    'West End':      { score: 58, rank: 'medium', peak: 'Fri-Sat 20:00-01:00', incidents: 97  },
    'Fortitude Valley': { score: 88, rank: 'high', peak: 'Fri-Sun 21:00-04:00', incidents: 203 },
    'Spring Hill':   { score: 62, rank: 'medium', peak: 'Thu-Sat 18:00-01:00', incidents: 108 },
    'Woolloongabba': { score: 55, rank: 'medium', peak: 'Sat-Sun 18:00-00:00', incidents: 89  },
    'Newstead':      { score: 48, rank: 'medium', peak: 'Fri-Sat 19:00-01:00', incidents: 74  },
    'Kangaroo Point':{ score: 44, rank: 'medium', peak: 'Sat 18:00-23:00',     incidents: 68  },
    'St Lucia':      { score: 28, rank: 'low',    peak: 'Mon-Fri 08:00-18:00', incidents: 34  },
    'Auchenflower':  { score: 35, rank: 'low',    peak: 'Weekdays 09:00-17:00',incidents: 42  },
    'Paddington':    { score: 38, rank: 'low',    peak: 'Fri-Sat 19:00-23:00', incidents: 51  },
    'New Farm':      { score: 52, rank: 'medium', peak: 'Fri-Sat 19:00-01:00', incidents: 82  },
    'Teneriffe':     { score: 46, rank: 'medium', peak: 'Fri-Sat 18:00-00:00', incidents: 71  },
    'Bowen Hills':   { score: 59, rank: 'medium', peak: 'Mon-Fri 07:00-19:00', incidents: 94  },
    'Herston':       { score: 33, rank: 'low',    peak: 'Weekdays 08:00-18:00', incidents: 39 },
    'Kelvin Grove':  { score: 31, rank: 'low',    peak: 'Weekdays 09:00-17:00', incidents: 36 },
    'Red Hill':      { score: 36, rank: 'low',    peak: 'Fri-Sat 19:00-23:00', incidents: 44  },
    'Taringa':       { score: 29, rank: 'low',    peak: 'Weekdays 08:00-17:00', incidents: 32  },
    'Indooroopilly': { score: 41, rank: 'medium', peak: 'Fri-Sat 17:00-23:00', incidents: 63  },
  };
  
  // Rough suburb centroids for Brisbane (lat, lng)
  const SUBURB_CENTROIDS = {
    'Brisbane City':    { lat: -27.4698, lng: 153.0251 },
    'South Brisbane':   { lat: -27.4820, lng: 153.0180 },
    'Milton':           { lat: -27.4600, lng: 153.0050 },
    'Toowong':          { lat: -27.4850, lng: 152.9980 },
    'West End':         { lat: -27.4800, lng: 153.0100 },
    'Fortitude Valley': { lat: -27.4560, lng: 153.0330 },
    'Spring Hill':      { lat: -27.4610, lng: 153.0220 },
    'Woolloongabba':    { lat: -27.4940, lng: 153.0340 },
    'Newstead':         { lat: -27.4430, lng: 153.0480 },
    'Kangaroo Point':   { lat: -27.4870, lng: 153.0350 },
    'St Lucia':         { lat: -27.4975, lng: 153.0137 },
    'Auchenflower':     { lat: -27.4720, lng: 152.9990 },
    'Paddington':       { lat: -27.4610, lng: 152.9950 },
    'New Farm':         { lat: -27.4660, lng: 153.0440 },
    'Teneriffe':        { lat: -27.4530, lng: 153.0440 },
    'Bowen Hills':      { lat: -27.4440, lng: 153.0280 },
    'Herston':          { lat: -27.4510, lng: 153.0170 },
    'Kelvin Grove':     { lat: -27.4530, lng: 153.0050 },
    'Red Hill':         { lat: -27.4580, lng: 152.9990 },
    'Taringa':          { lat: -27.4970, lng: 152.9870 },
    'Indooroopilly':    { lat: -27.5020, lng: 152.9730 },
  };
  
  // Return crime data for a named suburb, or null if not found
  export function getCrimeScore(suburb) {
    return CRIME_DATA[suburb] || null;
  }
  
  // Find suburbs whose centroid falls within a bounding box
  // bounds: { south, west, north, east }
  // Returns array of { name, lat, lng, score, rank, peak }
  export function getSuburbsInBounds(bounds) {
    const { south, west, north, east } = bounds;
    const results = [];
    for (const [name, coord] of Object.entries(SUBURB_CENTROIDS)) {
      if (
        coord.lat >= south && coord.lat <= north &&
        coord.lng >= west  && coord.lng <= east
      ) {
        const crime = CRIME_DATA[name];
        if (crime) {
          results.push({ name, ...coord, ...crime });
        }
      }
    }
    // Sort highest risk first
    return results.sort((a, b) => b.score - a.score);
  }
  
  // Calculate overall route risk score (weighted average of suburbs)
  // Returns { score, rank, label }
  export function calcRouteRisk(suburbs) {
    if (!suburbs.length) return { score: 0, rank: 'low', label: 'Low' };
    const avg = suburbs.reduce((sum, s) => sum + s.score, 0) / suburbs.length;
    const score = Math.round(avg);
    const rank  = score >= 65 ? 'high' : score >= 40 ? 'medium' : 'low';
    const label = rank === 'high' ? 'High' : rank === 'medium' ? 'Medium' : 'Low';
    return { score, rank, label };
  }

  // Get the peak risk period from the highest-scoring suburb in a list
  // suburbs: array from getSuburbsInBounds
  // Returns peak_period string or fallback
  export function getPeakRiskPeriod(suburbs) {
    if (!suburbs.length) return 'No data';
    const highest = suburbs.reduce((a, b) => (a.score > b.score ? a : b));
    return highest.peak_period || highest.peak || 'See QPS data';
  }