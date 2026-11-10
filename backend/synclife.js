const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Conexión a la base de datos SQLite
const dbPath = process.env.SQLITE_DB_PATH
  ? path.resolve(process.env.SQLITE_DB_PATH)
  : path.resolve(__dirname, 'synclife.db');
if (process.env.SQLITE_DB_PATH) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);
const serviceCache = new Map();
const providerUsage = { openMeteo: 0, wttr: 0 };
const EXTERNAL_API_TIMEOUT_MS = 7000;
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
const WEATHER_API_TIMEOUT_MS = 5000;
const WEATHER_DESCRIPTIONS = {
  0: 'Despejado',
  1: 'Mayormente despejado',
  2: 'Parcialmente nublado',
  3: 'Nublado',
  45: 'Niebla',
  48: 'Niebla con escarcha',
  51: 'Llovizna ligera',
  53: 'Llovizna',
  55: 'Llovizna intensa',
  61: 'Lluvia ligera',
  63: 'Lluvia',
  65: 'Lluvia fuerte',
  71: 'Nieve ligera',
  73: 'Nieve',
  75: 'Nieve fuerte',
  80: 'Chubascos ligeros',
  81: 'Chubascos',
  82: 'Chubascos fuertes',
  95: 'Tormenta',
  96: 'Tormenta con granizo',
  99: 'Tormenta fuerte con granizo',
};

// Inicialización de tablas
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS Registros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT,
      actividad TEXT,
      horas REAL,
      comida TEXT,
      costo_comida REAL,
      gasto_usd REAL,
      gasto_pen REAL,
      ejercicio TEXT,
      ejercitado INTEGER,
      animo INTEGER,
      ciudad TEXT,
      score INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS Eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      fecha TEXT,
      status TEXT,
      modo TEXT,
      hora_inicio TEXT,
      hora_fin TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ClimaCache (
      ciudad TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
});

async function fetchJson(url, timeoutMs = EXTERNAL_API_TIMEOUT_MS) {
  const hostname = new URL(url).hostname;
  if (hostname === 'geocoding-api.open-meteo.com' || hostname === 'api.open-meteo.com') {
    providerUsage.openMeteo += 1;
  } else if (hostname === 'wttr.in') {
    providerUsage.wttr += 1;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SyncLifeOS/1.0', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`External API returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function getProviderUsage() {
  return {
    openMeteo: providerUsage.openMeteo,
    wttr: providerUsage.wttr,
  };
}

async function consultarOpenMeteo(ciudad) {
  const geoData = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(ciudad)}&count=1&language=es`,
    WEATHER_API_TIMEOUT_MS,
  );
  const location = geoData.results?.[0];
  if (!location) throw new Error(`Open-Meteo no encontró la ciudad ${ciudad}.`);

  const weatherData = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto`,
    WEATHER_API_TIMEOUT_MS,
  );
  const current = weatherData.current;
  const temperature = current?.temperature_2m;
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
    throw new Error('Open-Meteo no devolvió la temperatura actual.');
  }
  const windSpeed = current.wind_speed_10m;
  const weatherCode = Number(current.weather_code);
  return {
    ciudad: location.name,
    pais: location.country,
    temp: temperature,
    temperatura: temperature,
    viento: typeof windSpeed === 'number' && Number.isFinite(windSpeed) ? windSpeed : null,
    descripcion: WEATHER_DESCRIPTIONS[weatherCode] || 'Sin descripción',
    unidades: {
      temperatura: weatherData.current_units?.temperature_2m || '°C',
      viento: weatherData.current_units?.wind_speed_10m || 'km/h',
    },
    lat: location.latitude,
    lon: location.longitude,
    source: 'Open-Meteo',
  };
}

async function consultarWttr(ciudad) {
  const data = await fetchJson(`https://wttr.in/${encodeURIComponent(ciudad)}?format=j1`);
  const temperature = Number(data.current_condition?.[0]?.temp_C);
  if (!Number.isFinite(temperature)) throw new Error('wttr.in no devolvió la temperatura actual.');
  return {
    ciudad: data.nearest_area?.[0]?.areaName?.[0]?.value || ciudad,
    temp: temperature,
    lat: null,
    lon: null,
    source: 'wttr.in',
  };
}

function guardarClimaCache(ciudad, clima) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO ClimaCache (ciudad, payload, updated_at) VALUES (?, ?, ?)',
      [ciudad, JSON.stringify(clima), clima.updatedAt],
      (error) => error ? reject(error) : resolve(),
    );
  });
}

function leerClimaCache(ciudad) {
  return new Promise((resolve, reject) => {
    db.get('SELECT payload FROM ClimaCache WHERE ciudad = ?', [ciudad], (error, row) => {
      if (error) return reject(error);
      if (!row) return resolve(null);
      try {
        return resolve(JSON.parse(row.payload));
      } catch (parseError) {
        return reject(parseError);
      }
    });
  });
}

async function obtenerClima(ciudad = "Cusco") {
  const city = typeof ciudad === 'string' && ciudad.trim() ? ciudad.trim() : 'Cusco';
  const cacheKey = `weather:${city.toLocaleLowerCase('es')}`;
  const cachedEntry = serviceCache.get(cacheKey);
  if (cachedEntry && Date.now() - cachedEntry.cachedAt < WEATHER_CACHE_TTL_MS) {
    return cachedEntry.data;
  }

  try {
    let result;
    try {
      result = await consultarOpenMeteo(city);
    } catch (openMeteoError) {
      try {
        result = await consultarWttr(city);
        console.warn('Open-Meteo no está disponible; se usará wttr.in:', openMeteoError.message);
      } catch (fallbackError) {
        throw new AggregateError([openMeteoError, fallbackError], 'No hay proveedores del clima disponibles.');
      }
    }
    result.updatedAt = new Date().toISOString();
    result.stale = false;
    serviceCache.set(cacheKey, { data: result, cachedAt: Date.now() });
    try {
      await guardarClimaCache(cacheKey, result);
    } catch (cacheError) {
      console.error('No se pudo guardar el último clima en SQLite:', cacheError.message);
    }
    return result;
  } catch (error) {
    const errors = error.errors || [error];
    console.error('No se pudo consultar ningún proveedor del clima:', errors.map((item) => item.message).join('; '));
    let cached = cachedEntry?.data;
    if (!cached) {
      try {
        cached = await leerClimaCache(cacheKey);
        if (cached) serviceCache.set(cacheKey, { data: cached, cachedAt: Date.now() });
      } catch (cacheError) {
        console.error('No se pudo leer el último clima guardado en SQLite:', cacheError.message);
      }
    }
    if (cached) return {
      ...cached,
      source: `${cached.source} (último dato guardado)`,
      stale: true,
      warning: `No se pudo actualizar el clima. Última consulta: ${cached.updatedAt}.`,
    };
    return {
      ciudad: city,
      temp: null,
      lat: null,
      lon: null,
      source: 'sin conexión',
      stale: true,
      warning: 'No se pudo consultar Open-Meteo ni wttr.in y no hay un dato guardado para esta ciudad.',
    };
  }
}

async function convertirMoneda(montoUSD, origen = "USD", destino = "PEN") {
  const cacheKey = `exchange:${origen}:${destino}`;
  const roundAmount = (rate, source, stale, warning) => ({
    montoUSD,
    gastoPEN: (montoUSD * rate).toFixed(2),
    tasa: rate,
    source,
    stale,
    ...(warning ? { warning } : {}),
    esAhorro: montoUSD * rate <= 40.00,
  });
  try {
    const data = await fetchJson(`https://open.er-api.com/v6/latest/${origen}`);
    const tasa = Number(data.rates?.[destino]);
    if (data.result !== 'success' || !Number.isFinite(tasa) || tasa <= 0) throw new Error('El proveedor principal no devolvió una tasa válida.');
    serviceCache.set(cacheKey, { rate: tasa, source: 'ExchangeRate-API', timestamp: Date.now() });
    return roundAmount(tasa, 'ExchangeRate-API', false);
  } catch (error) {
    console.error('No se pudo consultar ExchangeRate-API:', error.message);
  }
  try {
    const data = await fetchJson(`https://api.frankfurter.app/latest?from=${encodeURIComponent(origen)}&to=${encodeURIComponent(destino)}`);
    const tasa = Number(data.rates?.[destino]);
    if (!Number.isFinite(tasa) || tasa <= 0) throw new Error('Frankfurter no devolvió una tasa válida.');
    serviceCache.set(cacheKey, { rate: tasa, source: 'Frankfurter', timestamp: Date.now() });
    return roundAmount(tasa, 'Frankfurter', false);
  } catch (error) {
    console.error('No se pudo consultar Frankfurter:', error.message);
  }
  const cached = serviceCache.get(cacheKey);
  if (cached) return roundAmount(cached.rate, `${cached.source} (último dato guardado)`, true, 'No hay conexión con los proveedores; se reutilizó la última tasa consultada.');
  const fallbackRate = 3.75;
  return roundAmount(fallbackRate, 'estimación local', true, 'No hay conexión con los proveedores; se usó una tasa referencial. El monto puede no reflejar el tipo de cambio actual.');
}

async function analizarNutricion(comidaNombre = "Saludable") {
  const cacheKey = `nutrition:${comidaNombre.trim().toLocaleLowerCase('es')}`;
  try {
    const data = await fetchJson(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(comidaNombre)}&search_simple=1&action=process&json=1&page_size=1`);
    if (data.products && data.products.length > 0) {
      const prod = data.products[0];
      const calories = Number(prod.nutriments?.['energy-kcal_100g']);
      if (!Number.isFinite(calories) || calories < 0) throw new Error('El producto no tiene datos calóricos válidos.');
      const result = {
        alimento: prod.product_name || comidaNombre,
        calorias: Math.round(calories),
        source: 'Open Food Facts',
        stale: false,
      };
      serviceCache.set(cacheKey, result);
      return result;
    }
    throw new Error('No se encontró un producto coincidente en Open Food Facts.');
  } catch (error) {
    console.error('No se pudo consultar Open Food Facts:', error.message);
    const cached = serviceCache.get(cacheKey);
    if (cached) return { ...cached, source: 'Open Food Facts (último dato guardado)', stale: true };
    return {
      alimento: comidaNombre,
      calorias: 220,
      source: 'estimación local',
      stale: true,
      warning: 'No se encontraron datos fiables del producto; las calorías son solo una estimación.',
    };
  }
}

async function buscarProductosNutricion(comidaNombre) {
  const apiKey = process.env.FDC_API_KEY || 'DEMO_KEY';
  const aliases = [
    ['a la plancha', 'grilled'],
    ['a la parrilla', 'grilled'],
    ['horneado', 'baked'],
    ['horneada', 'baked'],
    ['hervido', 'boiled'],
    ['hervida', 'boiled'],
    ['asado', 'roasted'],
    ['asada', 'roasted'],
    ['frito', 'fried'],
    ['frita', 'fried'],
    ['carne de res', 'beef'],
    ['carne molida', 'ground beef'],
    ['pure de papa', 'mashed potato'],
    ['frijoles negros', 'black beans'],
    ['garbanzos', 'chickpeas'],
    ['lentejas', 'lentils'],
    ['lenteja', 'lentil'],
    ['pollo', 'chicken'],
    ['arroz', 'rice'],
    ['pescado', 'fish'],
    ['huevos', 'eggs'],
    ['huevo', 'egg'],
    ['papas', 'potatoes'],
    ['papa', 'potato'],
    ['patatas', 'potatoes'],
    ['patata', 'potato'],
    ['tomates', 'tomatoes'],
    ['tomate', 'tomato'],
    ['pan', 'bread'],
    ['leche', 'milk'],
    ['avena', 'oats'],
    ['frijoles', 'beans'],
    ['porotos', 'beans'],
    ['quinua', 'quinoa'],
    ['quinoa', 'quinoa'],
    ['queso', 'cheese'],
    ['cafe', 'coffee'],
    ['platano', 'banana'],
    ['banana', 'banana'],
    ['manzana', 'apple'],
    ['aceite', 'oil'],
    ['ensalada', 'salad'],
  ];
  const normalizeText = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en');
  let query = normalizeText(comidaNombre);
  aliases.forEach(([phrase, replacement]) => {
    const pattern = phrase.split(' ').map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    query = query.replace(new RegExp(`\\b${pattern}\\b`, 'g'), replacement);
  });
  const stopWords = new Set(['a', 'al', 'and', 'con', 'de', 'del', 'el', 'en', 'for', 'la', 'las', 'los', 'of', 'para', 'por', 'the', 'un', 'una', 'unos', 'unas', 'y']);
  const preparationWords = new Set(['baked', 'boiled', 'fried', 'grilled', 'roasted', 'steamed']);
  const allTokens = [...new Set((query.match(/[a-z0-9]+/g) || [])
    .filter((token) => !stopWords.has(token)))];
  const preparationTokens = allTokens.filter((token) => preparationWords.has(token));
  const queryTokens = allTokens.filter((token) => !preparationWords.has(token));
  if (!queryTokens.length) return [];
  const queryTerms = [...queryTokens, ...preparationTokens].join(' ');
  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.searchParams.set('query', queryTerms);
  url.searchParams.set('pageSize', '20');
  url.searchParams.set('api_key', apiKey);
  const data = await fetchJson(url.toString());
  if (!Array.isArray(data.foods)) {
    throw new Error('FoodData Central devolvió una respuesta que no se pudo leer.');
  }

  const nutrientIds = {
    energyKcal: 1008,
    proteinG: 1003,
    carbohydratesG: 1005,
    fatG: 1004,
    fiberG: 1079,
    sodiumMg: 1093,
    addedSugarG: 1235,
  };
  const micronutrientIds = [
    [1087, 'Calcio', 'mg'],
    [1089, 'Hierro', 'mg'],
    [1092, 'Potasio', 'mg'],
    [1090, 'Magnesio', 'mg'],
    [1162, 'Vitamina C', 'mg'],
    [1106, 'Vitamina A', 'µg'],
  ];
  const validNutrientValue = (nutrient) => (
    typeof nutrient?.value === 'number' && Number.isFinite(nutrient.value) && nutrient.value >= 0
      ? nutrient.value
      : null
  );
  const tokenSynonyms = {
    beans: ['frijoles', 'porotos'],
    coffee: ['cafe'],
    chicken: ['pollo'],
    milk: ['leche'],
    rice: ['arroz'],
  };

  const matches = data.foods
    .map((food) => {
      const nutrients = new Map((food.foodNutrients || []).map((nutrient) => [
        Number(nutrient.nutrientId),
        nutrient,
      ]));
      const getValue = (nutrientId) => validNutrientValue(nutrients.get(nutrientId));
      const micronutrients = micronutrientIds.flatMap(([id, name, unit]) => {
        const value = getValue(id);
        return value === null ? [] : [{ name, value, unit }];
      });
      const per100g = Object.fromEntries(
        Object.entries(nutrientIds).map(([field, nutrientId]) => [field, getValue(nutrientId)]),
      );
      per100g.micronutrients = micronutrients;
      return {
        code: String(food.fdcId || ''),
        name: typeof food.description === 'string' ? food.description.trim().slice(0, 160) : '',
        brand: '',
        servingSize: '',
        quantity: '',
        source: 'USDA FoodData Central',
        dataType: typeof food.dataType === 'string' ? food.dataType : '',
        foodCategory: typeof food.foodCategory === 'string' ? food.foodCategory : '',
        per100g,
        apiScore: Number.isFinite(food.score) ? food.score : 0,
      };
    })
    .filter((food) => food.name && Object.entries(food.per100g)
      .some(([key, value]) => key === 'micronutrients' ? value.length > 0 : value !== null))
    .map((food) => {
      const descriptionTokens = new Set(normalizeText(food.name).match(/[a-z0-9]+/g) || []);
      const matchesToken = (token) => descriptionTokens.has(token)
        || (tokenSynonyms[token] || []).some((synonym) => descriptionTokens.has(synonym));
      const matchedTokens = queryTokens.filter(matchesToken);
      const matchedPreparations = preparationTokens.filter((token) => descriptionTokens.has(token));
      const coverage = matchedTokens.length / queryTokens.length;
      const preparationCoverage = preparationTokens.length
        ? matchedPreparations.length / preparationTokens.length
        : 0;
      const minimumMatchedTokens = Math.max(1, Math.ceil(queryTokens.length * 0.6));
      const isPreparedDish = queryTokens.length > 1
        && (food.dataType === 'Survey (FNDDS)' || /mixed dish/i.test(food.foodCategory));
      return {
        food,
        matchedTokens,
        matchedPreparations,
        coverage,
        preparationCoverage,
        minimumMatchedTokens,
        isPreparedDish,
      };
    })
    .filter(({ matchedTokens, minimumMatchedTokens }) => matchedTokens.length >= minimumMatchedTokens)
    .sort((first, second) => (
      second.coverage - first.coverage
      || second.preparationCoverage - first.preparationCoverage
      || Number(second.isPreparedDish) - Number(first.isPreparedDish)
      || second.food.apiScore - first.food.apiScore
      || first.food.name.localeCompare(second.food.name)
    ))
    .slice(0, 8)
    .map(({ food, matchedTokens, matchedPreparations, coverage }) => {
      const { apiScore, ...match } = food;
      return {
        ...match,
        searchMatch: coverage === 1 ? 'complete' : 'partial',
        matchedIngredients: matchedTokens,
        matchedPreparations,
      };
    });
  return matches;
}

function generarDiagnostico(datos) {
  const { horasEnfoque, animoValor, esAhorro, ejercitado } = datos;
  let puntaje = Math.min(40, horasEnfoque * 10) + Math.min(20, animoValor * 2) + (esAhorro ? 20 : 10) + (ejercitado ? 20 : 5);
  const score = Math.min(100, Math.max(15, puntaje));
  return {
    score,
    resumen: score >= 80 ? "Día de alto rendimiento y enfoque estratégico excelente." : "Día productivo estable con margen de mejora en gestión de tiempo."
  };
}

function guardarRegistroDB(data) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO Registros (fecha, actividad, horas, comida, costo_comida, gasto_usd, gasto_pen, ejercicio, ejercitado, animo,       ciudad: city, score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([
      new Date().toISOString().split('T')[0],
      data.actividadNombre,
      data.horasEnfoque,
      data.comidaDetalle,
      data.costoComidaPEN,
      data.montoUSD,
      data.gastoPEN,
      data.ejercicioCliente,
      data.ejercitado ? 1 : 0,
      data.animoValor,
      data.ciudad,
      data.score
    ], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
}

module.exports = {
  db,
  obtenerClima,
  convertirMoneda,
  analizarNutricion,
  buscarProductosNutricion,
  generarDiagnostico,
  guardarRegistroDB,
  getProviderUsage,
};