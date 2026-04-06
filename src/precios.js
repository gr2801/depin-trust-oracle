const axios = require('axios');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const API_BASE  = 'https://console-api.akash.network/v1';
const COINGECKO = 'https://api.coingecko.com/api/v3';
const RED = 'akash';
const DB_PATH = path.join(__dirname, '..', 'data', 'oracle.db');

const PRECIOS_CLOUD = {
    'h100':      { aws: 3.28, gcp: 3.67 },
    'h200':      { aws: 4.50, gcp: 4.80 },
    'a100':      { aws: 2.40, gcp: 2.55 },
    'rtx5090':   { aws: 1.80, gcp: 1.90 },
    'rtx4090':   { aws: 1.20, gcp: 1.25 },
    'rtx4070':   { aws: 0.65, gcp: 0.70 },
    'rtx3090ti': { aws: 0.55, gcp: 0.60 },
    'rtx4060ti': { aws: 0.45, gcp: 0.50 },
    't4':        { aws: 0.35, gcp: 0.38 },
    'p40':       { aws: 0.40, gcp: 0.43 },
    'rtx3080':   { aws: 0.50, gcp: 0.55 },
    'gtx1070ti': { aws: 0.25, gcp: 0.28 },
    'gtx1050ti': { aws: 0.15, gcp: 0.18 },
    'pro6000se': { aws: 2.10, gcp: 2.20 },
};

const PRECIOS_AKASH_UAKT = {
    'h100':      { min: 1500, max: 3500 },
    'h200':      { min: 2000, max: 4500 },
    'a100':      { min: 1000, max: 2500 },
    'rtx5090':   { min: 800,  max: 2000 },
    'rtx4090':   { min: 400,  max: 1200 },
    'rtx4070':   { min: 200,  max: 600  },
    'rtx3090ti': { min: 250,  max: 700  },
    'rtx4060ti': { min: 150,  max: 400  },
    't4':        { min: 100,  max: 300  },
    'p40':       { min: 150,  max: 400  },
    'rtx3080':   { min: 200,  max: 500  },
    'gtx1070ti': { min: 80,   max: 200  },
    'gtx1050ti': { min: 50,   max: 150  },
    'pro6000se': { min: 600,  max: 2000 },
};

function toUsdHr(uaktBloque, aktUsd) {
    return (uaktBloque * 600 / 1_000_000) * aktUsd;
}

async function abrirDB() {
    if (!fs.existsSync(DB_PATH)) {
        console.error('❌ Base de datos no encontrada. Ejecutá primero: node db/schema.js');
        process.exit(1);
    }
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(DB_PATH));
    const save = () => fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
    return { db, save };
}

function query(db, sql, params = []) {
    const stmt = db.prepare(sql);
    const rows = [];
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

function run(db, sql, params = {}) {
    const stmt = db.prepare(sql);
    stmt.run(params);
    stmt.free();
}

async function capturarPrecios() {
    
    console.log('====================================================');
    console.log('   ��� DEPIN TRUST ORACLE — Market Snapshot');
    console.log(`   Red: ${RED.toUpperCase()} | ${new Date().toLocaleString()}`);
    console.log('====================================================\n');

    const { db, save } = await abrirDB();
    const timestamp = new Date().toISOString();

    process.stdout.write('⏳ Descargando datos de mercado...');
    const [gpuRes, dashRes, aktRes] = await Promise.all([
        axios.get(`${API_BASE}/gpu`, { timeout: 8000 }),
        axios.get(`${API_BASE}/dashboard-data`, { timeout: 8000 }),
        axios.get(`${COINGECKO}/simple/price?ids=akash-network&vs_currencies=usd`, { timeout: 8000 }),
    ]);
    console.log(' ✅\n');

    const aktUsd  = aktRes.data['akash-network']?.usd || 0;
    const now     = dashRes.data?.now || {};
    const detalles = gpuRes.data?.gpus?.details || {};

    // Guardar snapshot del mercado
    run(db, `INSERT OR REPLACE INTO market_snapshots
        (timestamp, red, akt_precio_usd, leases_activos, leases_nuevos_hoy, gpu_activas_red, gasto_diario_usd, providers_activos)
        VALUES ($timestamp, $red, $akt_precio_usd, $leases_activos, $leases_nuevos_hoy, $gpu_activas_red, $gasto_diario_usd, $providers_activos)
    `, {
        $timestamp:         timestamp,
        $red:               RED,
        $akt_precio_usd:    aktUsd,
        $leases_activos:    now.activeLeaseCount  || 0,
        $leases_nuevos_hoy: now.dailyLeaseCount   || 0,
        $gpu_activas_red:   now.activeGPU         || 0,
        $gasto_diario_usd:  +((now.dailyUUsdSpent || 0) / 1_000_000).toFixed(2),
        $providers_activos: null
    });

    // Procesar modelos GPU
    const modelos = [];
    for (const [vendor, lista] of Object.entries(detalles)) {
        if (!Array.isArray(lista)) continue;
        for (const g of lista) {
            const modelo      = (g.model || 'desconocido').toLowerCase();
            const disponibles = (g.allocatable || 0) - (g.allocated || 0);
            const pAkash      = PRECIOS_AKASH_UAKT[modelo];
            const pCloud      = PRECIOS_CLOUD[modelo];
            const precioMin   = pAkash ? +toUsdHr(pAkash.min, aktUsd).toFixed(3) : null;
            const precioMax   = pAkash ? +toUsdHr(pAkash.max, aktUsd).toFixed(3) : null;
            const precioMedio = precioMin && precioMax ? (precioMin + precioMax) / 2 : null;
            const descuento   = precioMedio && pCloud?.aws
                ? Math.round((1 - precioMedio / pCloud.aws) * 100) : null;

            run(db, `INSERT OR REPLACE INTO gpu_precios
                (timestamp, red, vendor, modelo, ram, total, alquiladas, disponibles, ocupacion_pct,
                 precio_akash_min_usd, precio_akash_max_usd, precio_aws_usd, descuento_vs_aws_pct)
                VALUES ($timestamp, $red, $vendor, $modelo, $ram, $total, $alquiladas, $disponibles, $ocupacion_pct,
                 $precio_akash_min_usd, $precio_akash_max_usd, $precio_aws_usd, $descuento_vs_aws_pct)
            `, {
                $timestamp: timestamp, $red: RED, $vendor: vendor, $modelo: modelo,
                $ram:              g.ram || null,
                $total:            g.allocatable || 0,
                $alquiladas:       g.allocated   || 0,
                $disponibles:      disponibles,
                $ocupacion_pct:    g.allocatable ? Math.round((g.allocated / g.allocatable) * 100) : 0,
                $precio_akash_min_usd: precioMin,
                $precio_akash_max_usd: precioMax,
                $precio_aws_usd:       pCloud?.aws || null,
                $descuento_vs_aws_pct: descuento
            });

            modelos.push({ vendor, modelo, ram: g.ram, total: g.allocatable, alquiladas: g.allocated, disponibles, precioMin, precioMax, precioAws: pCloud?.aws, descuento, precioMedio });
        }
    }
    save();

    modelos.sort((a, b) => b.alquiladas - a.alquiladas);

    console.log('��� MERCADO');
    console.log(`   AKT: $${aktUsd} USD | Leases activos: ${now.activeLeaseCount || 0} | GPUs activas: ${now.activeGPU || 0}`);
    console.log(`   Gasto diario: $${((now.dailyUUsdSpent || 0) / 1_000_000).toFixed(2)} USD\n`);

    console.log('���️  GPUs CON DEMANDA ACTIVA:');
    modelos.filter(m => m.alquiladas > 0).forEach(m => {
        console.log(`   ${m.modelo.toUpperCase()} ${m.ram || ''} | ${m.alquiladas}/${m.total} alquiladas | Akash: $${m.precioMin}-$${m.precioMax}/hr | AWS: $${m.precioAws || 'N/A'}/hr | ${m.descuento || 'N/A'}% más barato`);
    });

    const ingresoDiario = modelos.reduce((acc, m) => acc + ((m.precioMedio || 0) * 0.10 * 24 * m.alquiladas), 0);
    console.log(`\n��� Ingreso potencial broker (10% comisión): $${ingresoDiario.toFixed(2)}/día | $${(ingresoDiario * 30).toFixed(2)}/mes`);

    const tendencia = query(db, `
        SELECT modelo, ram, ROUND(AVG(ocupacion_pct), 1) as ocupacion_promedio,
               MIN(ocupacion_pct) as ocupacion_min, MAX(ocupacion_pct) as ocupacion_max,
               COUNT(*) as snapshots
        FROM gpu_precios
        WHERE red = ? AND alquiladas > 0
        GROUP BY modelo, ram
        ORDER BY ocupacion_promedio DESC LIMIT 8
    `, [RED]);

    if (tendencia.length > 1) {
        console.log('\n��� HISTÓRICO DE OCUPACIÓN (acumulado en DB):');
        tendencia.forEach(t => {
            console.log(`   ${String(t.modelo).toUpperCase()} ${t.ram || ''} | Promedio: ${t.ocupacion_promedio}% | Rango: ${t.ocupacion_min}%-${t.ocupacion_max}% | ${t.snapshots} snapshots`);
        });
    }

    const totalSnap = query(db, 'SELECT COUNT(*) as total FROM market_snapshots WHERE red = ?', [RED]);
    console.log(`\n   ��� Guardado en data/oracle.db (${totalSnap[0]?.total || 0} snapshots totales)`);
    console.log('====================================================');
    db.close();
}

capturarPrecios().catch(console.error);
