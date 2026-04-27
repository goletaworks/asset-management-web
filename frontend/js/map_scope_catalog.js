(function () {
  'use strict';

  function boundsFromCenter(center, latSpan, lngSpan) {
    const lat = Number(center?.[0]) || 0;
    const lng = Number(center?.[1]) || 0;
    return [
      [lat - latSpan, lng - lngSpan],
      [lat + latSpan, lng + lngSpan],
    ];
  }

  const CONTINENTS = [
    { key: 'africa', label: 'Africa', center: [1.5, 20], zoom: 3, bounds: [[-35, -20], [38, 52]] },
    { key: 'asia', label: 'Asia', center: [34, 100], zoom: 3, bounds: [[-10, 25], [80, 180]] },
    { key: 'europe', label: 'Europe', center: [54, 15], zoom: 4, bounds: [[34, -12], [72, 41]] },
    { key: 'north-america', label: 'North America', center: [46, -98], zoom: 3, bounds: [[7, -170], [84, -52]] },
    { key: 'south-america', label: 'South America', center: [-15, -60], zoom: 3, bounds: [[-56, -82], [13, -34]] },
    { key: 'oceania', label: 'Oceania', center: [-24, 134], zoom: 4, bounds: [[-50, 109], [1, 180]] },
    { key: 'antarctica', label: 'Antarctica', center: [-82, 0], zoom: 3, bounds: [[-90, -180], [-60, 180]] },
  ].map(item => ({ ...item, bounds: item.bounds || boundsFromCenter(item.center, 20, 20) }));

  const COUNTRIES = [
    { key: 'canada', label: 'Canada', center: [56.1304, -106.3468], zoom: 4, bounds: [[41.7, -141], [83.1, -52.6]] },
    { key: 'united-states', label: 'United States', center: [39.8283, -98.5795], zoom: 4, bounds: [[24.5, -125], [49.5, -66.9]] },
    { key: 'mexico', label: 'Mexico', center: [23.6345, -102.5528], zoom: 5, bounds: [[14.3, -118.5], [32.8, -86.7]] },
    { key: 'united-kingdom', label: 'United Kingdom', center: [55.3781, -3.436], zoom: 5, bounds: [[49.8, -8.7], [60.95, 1.8]] },
    { key: 'france', label: 'France', center: [46.2276, 2.2137], zoom: 5, bounds: [[41.3, -5.2], [51.2, 9.7]] },
    { key: 'germany', label: 'Germany', center: [51.1657, 10.4515], zoom: 5, bounds: [[47.2, 5.8], [55.1, 15.1]] },
    { key: 'india', label: 'India', center: [20.5937, 78.9629], zoom: 5, bounds: [[6.5, 68.1], [37.1, 97.4]] },
    { key: 'china', label: 'China', center: [35.8617, 104.1954], zoom: 4, bounds: [[18.1, 73.6], [53.6, 135.1]] },
    { key: 'japan', label: 'Japan', center: [36.2048, 138.2529], zoom: 5, bounds: [[24, 122.9], [45.8, 145.8]] },
    { key: 'australia', label: 'Australia', center: [-25.2744, 133.7751], zoom: 4, bounds: [[-44, 112.9], [-10.1, 154]] },
  ];

  const US_STATES = [
    ['al','Alabama',[32.8,-86.8]],['ak','Alaska',[64.2,-149.5]],['az','Arizona',[34.3,-111.7]],
    ['ar','Arkansas',[35.1,-92.4]],['ca','California',[36.8,-119.4]],['co','Colorado',[39,-105.5]],
    ['ct','Connecticut',[41.6,-72.7]],['de','Delaware',[38.9,-75.5]],['fl','Florida',[27.8,-81.7]],
    ['ga','Georgia',[32.2,-82.9]],['hi','Hawaii',[19.8,-155.5]],['id','Idaho',[44.2,-114.1]],
    ['il','Illinois',[40,-89.2]],['in','Indiana',[39.9,-86.3]],['ia','Iowa',[42.1,-93.5]],
    ['ks','Kansas',[38.5,-98]],['ky','Kentucky',[37.5,-85.3]],['la','Louisiana',[31.2,-92.3]],
    ['me','Maine',[45.2,-69]],['md','Maryland',[39,-76.7]],['ma','Massachusetts',[42.4,-71.4]],
    ['mi','Michigan',[44.3,-85.6]],['mn','Minnesota',[46.4,-94.6]],['ms','Mississippi',[32.7,-89.7]],
    ['mo','Missouri',[38.5,-92.5]],['mt','Montana',[46.9,-110]],['ne','Nebraska',[41.5,-99.7]],
    ['nv','Nevada',[38.8,-116.4]],['nh','New Hampshire',[43.2,-71.6]],['nj','New Jersey',[40.1,-74.7]],
    ['nm','New Mexico',[34.5,-106.2]],['ny','New York',[43,-75]],['nc','North Carolina',[35.6,-79.4]],
    ['nd','North Dakota',[47.5,-100.5]],['oh','Ohio',[40.4,-82.8]],['ok','Oklahoma',[35.6,-97.5]],
    ['or','Oregon',[43.9,-120.6]],['pa','Pennsylvania',[41.2,-77.2]],['ri','Rhode Island',[41.7,-71.6]],
    ['sc','South Carolina',[33.8,-80.9]],['sd','South Dakota',[44.3,-100.2]],['tn','Tennessee',[35.8,-86.4]],
    ['tx','Texas',[31,-100]],['ut','Utah',[39.3,-111.7]],['vt','Vermont',[44.1,-72.7]],
    ['va','Virginia',[37.5,-78.7]],['wa','Washington',[47.4,-120.5]],['wv','West Virginia',[38.6,-80.6]],
    ['wi','Wisconsin',[44.5,-89.6]],['wy','Wyoming',[43,-107.5]],
  ].map(([key, label, center]) => ({
    key,
    label,
    center,
    zoom: 6,
    bounds: boundsFromCenter(center, 2.4, 3.8),
  }));

  const CANADA_PROVINCES = [
    ['ab','Alberta',[53.9,-116.6]],['bc','British Columbia',[53.7,-127.6]],['mb','Manitoba',[53.8,-98.8]],
    ['nb','New Brunswick',[46.6,-66.5]],['nl','Newfoundland and Labrador',[53.1,-57.7]],['ns','Nova Scotia',[44.7,-63.7]],
    ['on','Ontario',[50,-85]],['pe','Prince Edward Island',[46.3,-63.1]],['qc','Quebec',[52.9,-71.2]],
    ['sk','Saskatchewan',[52.9,-106.4]],['nt','Northwest Territories',[64.8,-124.8]],['nu','Nunavut',[70.3,-83.1]],
    ['yt','Yukon',[64.1,-135.1]],
  ].map(([key, label, center]) => ({
    key,
    label,
    center,
    zoom: 5,
    bounds: boundsFromCenter(center, 3.2, 5.1),
  }));

  const byType = {
    continent: CONTINENTS,
    country: COUNTRIES,
    us_state: US_STATES,
    canada_province: CANADA_PROVINCES,
  };

  function getScope(type, key) {
    const list = byType[type] || [];
    const match = list.find(item => item.key === key);
    if (!match) return null;
    return {
      type,
      key,
      label: match.label,
      center: match.center,
      zoom: match.zoom,
      bounds: match.bounds || null,
    };
  }

  window.CompanyMapCatalog = {
    byType,
    getScope,
    defaultWorldScope: {
      type: 'continent',
      key: 'north-america',
      label: 'North America',
      center: [46, -98],
      zoom: 3,
      bounds: [[7, -170], [84, -52]],
    },
  };
})();
