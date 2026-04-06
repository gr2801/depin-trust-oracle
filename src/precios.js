const axios = require('axios');
const { abrirDB } = require('../db/schema');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ============================================================
//   DEPIN TRUST ORACLE — Market Snapshot de GPUs
//
//   Qué hace:
//   - Captura ocupación actual de todos los modelos GPU en Akash
//   - Lee precios AWS reales desde la tabla precios_referencia
//   - Guarda snapshot en market_snapshots y gpu_precios
//
//   Nota sobre precios Akash:
//   No hay lista de precios en Akash — funciona por subasta inversa.
//   El precio real aparece cuando el tenant hace un deployment.
//   Esta herramienta muestra ocupación real + precio AWS como referencia.
//
//   Run: node src/precios.js
// ============================================================

const API_BASE  = 'https://console-api.akash.network/v1';
const COINGECKO = 'https://api.coingecko.com/api/v3';
const RED = 'akash';

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

    // Leer precios AWS de referencia (por modelo y ram)
    const refRows = query(db, 'SELECT modelo, ram, aws_usd_hr FROM precios_referencia');
    // Mapa modelo+ram → aws_usd_hr
    const PRECIOS_AWS = {};
    for (const r of refRows) {
        const k = `${r.modelo}|${r.ram || ''}`;
        PRECIOS_AWS[k] = r.aws_usd_hr;
        // También guardar solo por modelo como fallback
        if (!PRECIOS_AWS[r.modelo]) PRECIOS_AWS[r.modelo] = r.aws_usd_hr;
    }

    process.stdout.write('⏳ Descargando datos de mercado...');
    const [gpuRes, dashRes, aktRes] = await Promise.all([
        axios.get(`${API_BASE}/gpu`,          { timeout: 8000 }),
        axios.get(`${API_BASE}/dashboard-data`,{ timeout: 8000 }),
        axios.get(`${COINGECKO}/simple/price?ids=akash-network&vs_currencies=usd`, { timeout: 8000 }),
    ]);
    console.log(' ✅\n');

    const aktUsd   = aktRes.data['akash-network']?.usd || 0;
    const now      = dashRes.data?.now || {};
    const detalles = gpuRes.data?.gpus?.details || {};

    // Guardar snapshot de mercado global
    run(db, `INSERT OR REPLACE INTO market_snapshots
        (timestamp, red, akt_precio_usd, leases_activos, leases_nuevos_hoy, gpu_activas_red, gasto_diario_usd, providers_activos)
        VALUES ($timestamp, $red, $akt, $leases, $nuevos, $gpus, $gasto, $providers)
    `, {
        $timestamp: timestamp,
        $red:       RED,
        $akt:       aktUsd,
        $leases:    now.activeLeaseCount  || 0,
        $nuevos:    now.dailyLeaseCount   || 0,
        $gpus:      now.activeGPU         || 0,
        $gasto:     +((now.dailyUUsdSpent || 0) / 1_000_000).toFixed(2),
        $providers: null,
    });

    // Procesar cada modelo GPU
    const modelos = [];
    for (const [vendor, lista] of Object.entries(detalles)) {
        if (!Array.isArray(lista)) continue;
        for (const g of lista) {
            const modelo     = (g.model || 'desconocido').toLowerCase();
            const ram        = g.ram || null;
            const total      = g.allocatable || 0;
            const alquiladas = g.allocated   || 0;
            const disponibles = total - alquiladas;
            const ocupacion   = total ? Math.round((alquiladas / total) * 100) : 0;
            const awsRef      = PRECIOS_AWS[`${modelo}|${ram || ''}`] 
                             ?? PRECIOS_AWS[modelo] 
                             ?? null;

            run(db, `INSERT OR REPLACE INTO gpu_precios
                (timestamp, red, vendor, modelo, ram, total, alquiladas, disponibles,
                 ocupacion_pct, precio_akash_min_usd, precio_akash_max_usd,
                 precio_aws_usd, descuento_vs_aws_pct)
                VALUES ($timestamp, $red, $vendor, $modelo, $ram, $total, $alquiladas, $disponibles,
                 $ocupacion, NULL, NULL, $awsRef, NULL)
            `, {
                $timestamp: timestamp, $red: RED, $vendor: vendor,
                $modelo: modelo, $ram: ram, $total: total,
                $alquiladas: alquiladas, $disponibles: disponibles,
                $ocupacion: ocupacion, $awsRef: awsRef,
            });

            modelos.push({ vendor, modelo, ram, total, alquiladas, disponibles, ocupacion, awsRef });
        }
    }
    save();

    modelos.sort((a, b) => b.alquiladas - a.alquiladas);

    // ── Mercado global ──────────────────────────────────────
    console.log('��� MERCADO');
    console.log(`   AKT: $${aktUsd} USD | Leases activos: ${now.activeLeaseCount || 0} | GPUs activas: ${now.activeGPU || 0}`);
    console.log(`   Gasto diario: $${((now.dailyUUsdSpent || 0) / 1_000_000).toFixed(2)} USD\n`);

    // ── GPUs con demanda activa ─────────────────────────────
    const activas = modelos.filter(m => m.alquiladas > 0);
    console.log('���️  GPUs CON DEMANDA ACTIVA:');
    activas.forEach(m => {
        const awsStr = m.awsRef ? `AWS ref: $${(+m.awsRef).toFixed(3)}/hr` : 'sin equiv. AWS';
        const ram    = m.ram ? ` ${m.ram}` : '';
        console.log(`   ${m.modelo.toUpperCase()}${ram.padEnd(8)} | ${String(m.alquiladas).padStart(3)}/${String(m.total).padEnd(3)} alquiladas (${String(m.ocupacion).padStart(3)}%) | ${awsStr}`);
    });

    // ── GPUs disponibles sin demanda ────────────────────────
    const sin = modelos.filter(m => m.alquiladas === 0 && m.total > 0);
    if (sin.length > 0) {
        console.log('\n��� DISPONIBLES (sin demanda actual):');
        sin.forEach(m => {
            const ram = m.ram ? ` ${m.ram}` : '';
            console.log(`   ${m.modelo.toUpperCase()}${ram} | ${m.total} disponibles`);
        });
    }

    // ── Histórico de ocupación ──────────────────────────────
    const tendencia = query(db, `
        SELECT modelo, ram, ROUND(AVG(ocupacion_pct), 1) as prom,
               MIN(ocupacion_pct) as minp, MAX(ocupacion_pct) as maxp,
               COUNT(*) as n
        FROM gpu_precios
        WHERE red = ? AND alquiladas > 0
        GROUP BY modelo, ram
        ORDER BY prom DESC LIMIT 8
    `, [RED]);

    if (tendencia.length > 1) {
        console.log('\n��� HISTÓRICO DE OCUPACIÓN (acumulado en DB):');
        tendencia.forEach(t => {
            const ram = t.ram ? ` ${t.ram}` : '';
            console.log(`   ${String(t.modelo).toUpperCase()}${ram.padEnd(8)} | Prom: ${t.prom}% | Rango: ${t.minp}%-${t.maxp}% | ${t.n} snapshots`);
        });
    }

    const totalSnap = query(db, 'SELECT COUNT(*) as total FROM market_snapshots WHERE red = ?', [RED]);
    console.log(`\n   ��� Guardado en data/oracle.db (${totalSnap[0]?.total || 0} snapshots totales)`);
    console.log('   ℹ️  Precio Akash: por subasta — se determina al deployar en console.akash.network');
    console.log('====================================================');
    db.close();
}

capturarPrecios().catch(console.error);
