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
    const result = await Promise.any([consultarOpenMeteo(city), consultarWttr(city)]);
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

module.exports = { db, obtenerClima, convertirMoneda, analizarNutricion, generarDiagnostico, guardarRegistroDB };