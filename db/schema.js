const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// ============================================================
//   DB SCHEMA — depin-trust-oracle
//   Inicializa la base de datos SQLite con todas las tablas
//   Ejecutar una sola vez: node db/schema.js
// ============================================================

const DB_PATH = path.join(__dirname, '..', 'data', 'oracle.db');
const dataDir = path.join(__dirname, '..', 'data');

// Helper: abre (o crea) la DB y devuelve { SQL, db, save() }
async function abrirDB(crear = false) {
    const SQL = await initSqlJs();
    let db;
    if (fs.existsSync(DB_PATH)) {
        db = new SQL.Database(fs.readFileSync(DB_PATH));
    } else if (crear) {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        db = new SQL.Database();
    } else {
        console.error('❌ Base de datos no encontrada. Ejecutá primero: node db/schema.js');
        process.exit(1);
    }
    const save = () => fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
    return { SQL, db, save };
}

module.exports = { abrirDB };

// Si se ejecuta directamente, inicializa el schema
if (require.main === module) {
    abrirDB(true).then(({ db, save }) => {

// ============================================================
//   TABLA: auditorias
//   Un registro por cada provider auditado en cada ciclo
// ============================================================
db.run(`
    CREATE TABLE IF NOT EXISTS auditorias (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp       TEXT    NOT NULL,
        red             TEXT    NOT NULL DEFAULT 'akash',
        provider_owner  TEXT    NOT NULL,
        host_uri        TEXT,
        organizacion    TEXT,
        pais            TEXT,
        region          TEXT,
        online          INTEGER NOT NULL DEFAULT 0,
        auditado        INTEGER NOT NULL DEFAULT 0,
        version_valida  INTEGER NOT NULL DEFAULT 0,
        uptime_1d       REAL,
        uptime_7d       REAL,
        uptime_30d      REAL,
        gpu_modelos     TEXT,
        gpu_activa      INTEGER DEFAULT 0,
        gpu_disponible  INTEGER DEFAULT 0,
        gpu_total       INTEGER DEFAULT 0,
        score           INTEGER NOT NULL,
        clasificacion   TEXT    NOT NULL,
        flags           TEXT,
        UNIQUE(timestamp, provider_owner)
    )
`);

// ============================================================
//   TABLA: market_snapshots
//   Estado del mercado en cada ciclo de auditoría
// ============================================================
db.run(`
    CREATE TABLE IF NOT EXISTS market_snapshots (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp           TEXT    NOT NULL UNIQUE,
        red                 TEXT    NOT NULL DEFAULT 'akash',
        akt_precio_usd      REAL,
        leases_activos      INTEGER,
        leases_nuevos_hoy   INTEGER,
        gpu_activas_red     INTEGER,
        gasto_diario_usd    REAL,
        providers_activos   INTEGER
    )
`);

// ============================================================
//   TABLA: gpu_precios
//   Precios y ocupación por modelo de GPU en cada ciclo
// ============================================================
db.run(`
    CREATE TABLE IF NOT EXISTS gpu_precios (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp               TEXT    NOT NULL,
        red                     TEXT    NOT NULL DEFAULT 'akash',
        vendor                  TEXT,
        modelo                  TEXT    NOT NULL,
        ram                     TEXT,
        total                   INTEGER DEFAULT 0,
        alquiladas              INTEGER DEFAULT 0,
        disponibles             INTEGER DEFAULT 0,
        ocupacion_pct           INTEGER DEFAULT 0,
        precio_akash_min_usd    REAL,
        precio_akash_max_usd    REAL,
        precio_aws_usd          REAL,
        descuento_vs_aws_pct    INTEGER,
        UNIQUE(timestamp, red, modelo, ram)
    )
`);

// Índices para queries frecuentes
// ============================================================
//   TABLA: precios_referencia
//   Precios de referencia por modelo GPU (AWS/GCP/Akash)
//   Actualizados por src/actualizar-precios.js
// ============================================================
db.run(`
    CREATE TABLE IF NOT EXISTS precios_referencia (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        modelo           TEXT    NOT NULL,
        ram              TEXT,
        aws_usd_hr       REAL,
        gcp_usd_hr       REAL,
        akash_min_uakt   INTEGER,
        akash_max_uakt   INTEGER,
        aws_fuente       TEXT    DEFAULT 'manual',
        akash_fuente     TEXT    DEFAULT 'manual',
        aws_updated_at   TEXT,
        akash_updated_at TEXT,
        nota             TEXT,
        UNIQUE(modelo, ram)
    )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_auditorias_provider  ON auditorias(provider_owner)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_auditorias_timestamp ON auditorias(timestamp)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_auditorias_score     ON auditorias(score)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_gpu_precios_modelo   ON gpu_precios(modelo)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_market_timestamp     ON market_snapshots(timestamp)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_precios_modelo       ON precios_referencia(modelo)`);

save();
db.close();

console.log('✅ Base de datos inicializada correctamente');
console.log(`📍 Ubicación: ${DB_PATH}`);
console.log('');
console.log('Tablas creadas:');
console.log('  • auditorias        → historial de scores por provider');
console.log('  • market_snapshots  → estado del mercado por ciclo');
console.log('  • gpu_precios       → precios y ocupación por modelo GPU');
console.log('  • precios_referencia → precios AWS/GCP/Akash de referencia');
    });
}
