const axios = require('axios');
const { abrirDB } = require('../db/schema');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ============================================================
//   DEPIN TRUST ORACLE â€” Actualizar precios de referencia
//
//   QuÃ© hace:
//   1. Descubre los modelos GPU activos en la red Akash (/v1/gpu)
//   2. Para cada uno, busca el precio AWS equivalente en Vantage
//   3. Guarda en tabla precios_referencia â€” sin hardcoding, sin seed
//
//   Precios Akash: NO estÃ¡n en esta tabla.
//   Akash funciona por subasta inversa â€” no hay precio fijo por modelo.
//   El precio real aparece cuando un tenant hace un deployment.
//
//   Fuentes:
//   - Modelos GPU activos: console-api.akash.network/v1/gpu
//   - Precios AWS on-demand: instances.vantage.sh (us-east-1, Linux)
//
//   Run:  node src/actualizar-precios.js
//   Run (solo AWS): node src/actualizar-precios.js --aws
// ============================================================

const API_BASE = 'https://console-api.akash.network/v1';
const VANTAGE_URL = 'https://instances.vantage.sh/instances.json';

// Mapeo de modelo GPU â†’ instancia AWS equivalente
// Solo modelos que AWS ofrece directamente en su catÃ¡logo
const AWS_MAPPING = {
    'h100':  [{ instance: 'p5.48xlarge',   gpus: 8 }, { instance: 'p5e.48xlarge',  gpus: 8 }],
    'h200':  [{ instance: 'p5en.48xlarge', gpus: 8 }],
    'a100':  [{ instance: 'p4d.24xlarge',  gpus: 8, ram: '40Gi' }, { instance: 'p4de.24xlarge', gpus: 8, ram: '80Gi' }],
    't4':    [{ instance: 'g4dn.xlarge',   gpus: 1 }],
    'l4':    [{ instance: 'g6.xlarge',     gpus: 1 }],
    'l40s':  [{ instance: 'g6e.xlarge',    gpus: 1 }],
};

function run(db, sql, params = {}) {
    const stmt = db.prepare(sql);
    stmt.run(params);
    stmt.free();
}

function query(db, sql, params = []) {
    const stmt = db.prepare(sql);
    const rows = [];
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

async function obtenerModelosActivos() {
    const r = await axios.get(`${API_BASE}/gpu`, { timeout: 8000 });
    const details = r.data?.gpus?.details || {};
    const modelos = [];
    for (const [vendor, lista] of Object.entries(details)) {
        if (!Array.isArray(lista)) continue;
        for (const g of lista) {
            modelos.push({
                vendor,
                modelo: (g.model || 'desconocido').toLowerCase(),
                ram:    g.ram || null,
                total:  g.allocatable || 0,
                activas: g.allocated  || 0,
            });
        }
    }
    return modelos;
}

async function obtenerPreciosAWS() {
    console.log('â³ Descargando precios AWS desde Vantage...');
    try {
        const r = await axios.get(VANTAGE_URL, { timeout: 20000, headers: { 'Accept-Encoding': 'gzip' } });
        const arr = Array.isArray(r.data) ? r.data : [];
        // Mapa instance_type â†’ precio on-demand us-east-1 Linux
        const mapa = {};
        for (const i of arr) {
            const precio = i.pricing?.['us-east-1']?.linux?.ondemand;
            if (precio) mapa[i.instance_type] = +precio;
        }
        console.log(`   âœ… Vantage: ${arr.length} instancias cargadas`);
        return mapa;
    } catch (e) {
        console.log(`   âŒ Vantage no disponible: ${e.message}`);
        console.log('   Los precios AWS quedan como estaban. ReintentÃ¡ sin VPN.');
        return null;
    }
}

async function main() {
    const soloAWS = process.argv.includes('--aws');

    console.log('====================================================');
    console.log('   í²¹ DEPIN TRUST ORACLE â€” Actualizar Precios');
    console.log(`   ${new Date().toLocaleString()}`);
    console.log('====================================================\n');

    const { db, save } = await abrirDB();
    const ahora = new Date().toISOString();

    // Asegurar tabla (puede ser DB vieja)
    db.run(`CREATE TABLE IF NOT EXISTS precios_referencia (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        modelo           TEXT    NOT NULL,
        ram              TEXT,
        aws_usd_hr       REAL,
        gcp_usd_hr       REAL,
        akash_min_uakt   INTEGER,
        akash_max_uakt   INTEGER,
        aws_fuente       TEXT,
        akash_fuente     TEXT,
        aws_updated_at   TEXT,
        akash_updated_at TEXT,
        nota             TEXT,
        UNIQUE(modelo, ram)
    )`);

    // Paso 1: descubrir modelos activos en la red
    if (!soloAWS) {
        console.log('í´ Descubriendo modelos GPU activos en la red Akash...');
        const modelos = await obtenerModelosActivos();
        let nuevos = 0;
        for (const m of modelos) {
            const existe = query(db, 'SELECT id FROM precios_referencia WHERE modelo = ? AND (ram = ? OR (ram IS NULL AND ? IS NULL))', [m.modelo, m.ram, m.ram]);
            if (existe.length === 0) {
                run(db, `INSERT INTO precios_referencia (modelo, ram, aws_fuente, akash_fuente, nota)
                    VALUES ($modelo, $ram, $fuente, $ak_f, $nota)`, {
                    $modelo: m.modelo,
                    $ram:    m.ram,
                    $fuente: 'pendiente',
                    $ak_f:   'n/a - subasta inversa',
                    $nota:   `Descubierto de /v1/gpu el ${ahora.slice(0,10)}. Akash usa subasta: precio aparece al deployar.`
                });
                nuevos++;
                console.log(`   + nuevo modelo: ${m.modelo} ${m.ram || ''}`);
            }
        }
        save();
        console.log(`   ${nuevos} modelos nuevos registrados\n`);
    }

    // Paso 2: actualizar precios AWS desde Vantage
    const preciosAWS = await obtenerPreciosAWS();
    if (preciosAWS) {
        let actualizados = 0;
        for (const [modelo, mappings] of Object.entries(AWS_MAPPING)) {
            for (const m of mappings) {
                const precioTotal = preciosAWS[m.instance];
                if (!precioTotal) continue;
                const precioPorGPU = +(precioTotal / m.gpus).toFixed(4);
                const ram = m.ram || null;
                // Actualizar todos los registros de ese modelo (o el ram especÃ­fico si lo tiene)
                const whereRam = ram ? 'AND ram = ?' : 'AND ram IS NOT NULL'; // si el mapping tiene ram, filtra; si no, actualiza todos
                const params = ram
                    ? [precioPorGPU, `vantage:${m.instance}Ã·${m.gpus} us-east-1 on-demand`, ahora, modelo, ram]
                    : [precioPorGPU, `vantage:${m.instance}Ã·${m.gpus} us-east-1 on-demand`, ahora, modelo];
                db.run(
                    `UPDATE precios_referencia SET aws_usd_hr = ?, aws_fuente = ?, aws_updated_at = ? WHERE modelo = ? ${whereRam}`,
                    params
                );
                console.log(`   âœ… ${modelo.toUpperCase()} ${ram || '(todas las RAM)'}: $${precioPorGPU}/hr (${m.instance} Ã· ${m.gpus})`);
                actualizados++;
            }
        }
        save();
        console.log(`\n   ${actualizados} entradas AWS actualizadas\n`);
    }

    // Mostrar tabla resultante
    const rows = query(db, `
        SELECT modelo, ram, aws_usd_hr, aws_fuente, aws_updated_at, nota
        FROM precios_referencia
        ORDER BY aws_usd_hr DESC NULLS LAST, modelo
    `);

    console.log('í³‹ TABLA precios_referencia:');
    console.log('   Modelo              RAM      AWS ref/hr  Fuente');
    console.log('   ' + '-'.repeat(65));
    rows.forEach(r => {
        const aws    = r.aws_usd_hr ? `$${(+r.aws_usd_hr).toFixed(3)}` : 'sin equiv.';
        const modelo = `${r.modelo} ${r.ram || ''}`.padEnd(22);
        const fuente = (r.aws_fuente || '').slice(0, 30);
        console.log(`   ${modelo} ${aws.padEnd(11)} ${fuente}`);
    });
    console.log(`\n   Total: ${rows.length} modelos | Akash: precio por subasta (no listado)`);
    console.log('\n====================================================');
    console.log('   í²¾ Guardado en data/oracle.db');
    console.log('====================================================');
    db.close();
}

main().catch(console.error);
