const axios = require('axios');
const { abrirDB } = require('../db/schema');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ============================================================
//   DEPIN TRUST ORACLE — Actualizador de precios de referencia
//
//   - Siembra datos iniciales si la tabla está vacía
//   - Actualiza precios AWS desde Vantage API (semanal)
//   - Precios Akash: curados manualmente (futuro: desde LCD Akash)
//
//   Run:  node src/actualizar-precios.js
//   Run (solo seed): node src/actualizar-precios.js --seed
//   Run (solo AWS):  node src/actualizar-precios.js --aws
// ============================================================

// --- DATOS SEED ---
// Fuente AWS: on-demand us-east-1 (serán reemplazados por Vantage)
// Fuente Akash: estimación basada en bids observados (sesión 6-Apr-2026)
// Nota: RTX/GTX son consumer GPUs, AWS no las ofrece (n/a)
const SEED = [
    // GPUs datacenter — AWS tiene equivalentes
    { modelo: 'h100',      ram: '80Gi',  aws_usd_hr: 12.29, gcp_usd_hr: 13.20, akash_min_uakt: 1500, akash_max_uakt: 3500, nota: 'AWS: p5.48xlarge÷8 on-demand us-east-1' },
    { modelo: 'h200',      ram: '141Gi', aws_usd_hr: 16.00, gcp_usd_hr: 17.50, akash_min_uakt: 2000, akash_max_uakt: 4500, nota: 'AWS: estimado (no disponible en todos los regions)' },
    { modelo: 'a100',      ram: '80Gi',  aws_usd_hr: 5.00,  gcp_usd_hr: 5.20,  akash_min_uakt: 1000, akash_max_uakt: 2500, nota: 'AWS: p4de.24xlarge÷8 on-demand us-east-1' },
    { modelo: 'a100',      ram: '40Gi',  aws_usd_hr: 4.10,  gcp_usd_hr: 4.30,  akash_min_uakt: 800,  akash_max_uakt: 2000, nota: 'AWS: p4d.24xlarge÷8 on-demand us-east-1' },
    { modelo: 't4',        ram: '16Gi',  aws_usd_hr: 0.526, gcp_usd_hr: 0.35,  akash_min_uakt: 100,  akash_max_uakt: 300,  nota: 'AWS: g4dn.xlarge on-demand us-east-1' },
    { modelo: 'l4',        ram: '24Gi',  aws_usd_hr: 0.812, gcp_usd_hr: 0.704, akash_min_uakt: 200,  akash_max_uakt: 500,  nota: 'AWS: g6.xlarge on-demand us-east-1' },
    { modelo: 'p40',       ram: '24Gi',  aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 150,  akash_max_uakt: 400,  nota: 'AWS: sin equivalente directo (GPU legacy)' },
    // GPUs consumer — AWS/GCP no las ofrecen
    { modelo: 'rtx5090',   ram: '32Gi',  aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 800,  akash_max_uakt: 2000, nota: 'Consumer GPU: sin equivalente en AWS/GCP' },
    { modelo: 'rtx4090',   ram: '24Gi',  aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 400,  akash_max_uakt: 1200, nota: 'Consumer GPU: sin equivalente en AWS/GCP' },
    { modelo: 'rtx4070',   ram: '12Gi',  aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 200,  akash_max_uakt: 600,  nota: 'Consumer GPU: sin equivalente en AWS/GCP' },
    { modelo: 'rtx3090ti', ram: '24Gi',  aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 250,  akash_max_uakt: 700,  nota: 'Consumer GPU: sin equivalente en AWS/GCP' },
    { modelo: 'rtx3090',   ram: '24Gi',  aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 200,  akash_max_uakt: 600,  nota: 'Consumer GPU: sin equivalente en AWS/GCP' },
    { modelo: 'rtx4060ti', ram: '16Gi',  aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 150,  akash_max_uakt: 400,  nota: 'Consumer GPU: sin equivalente en AWS/GCP' },
    { modelo: 'rtx3080',   ram: '10Gi',  aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 200,  akash_max_uakt: 500,  nota: 'Consumer GPU: sin equivalente en AWS/GCP' },
    { modelo: 'rtx3070',   ram: '8Gi',   aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 150,  akash_max_uakt: 400,  nota: 'Consumer GPU: sin equivalente en AWS/GCP' },
    { modelo: 'gtx1070ti', ram: '8Gi',   aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 80,   akash_max_uakt: 200,  nota: 'Consumer GPU: sin equivalente en AWS/GCP' },
    { modelo: 'gtx1060',   ram: '6Gi',   aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 50,   akash_max_uakt: 150,  nota: 'Consumer GPU: sin equivalente en AWS/GCP' },
    { modelo: 'gtx1050ti', ram: '4Gi',   aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 50,   akash_max_uakt: 150,  nota: 'Consumer GPU: sin equivalente en AWS/GCP' },
    { modelo: 'gtx1660ti', ram: '6Gi',   aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 60,   akash_max_uakt: 180,  nota: 'Consumer GPU: sin equivalente en AWS/GCP' },
    { modelo: 'pro6000se', ram: '48Gi',  aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 600,  akash_max_uakt: 2000, nota: 'Workstation GPU: sin equivalente directo en AWS/GCP' },
    { modelo: 'rtx4000ada',ram: '20Gi',  aws_usd_hr: null,  gcp_usd_hr: null,  akash_min_uakt: 300,  akash_max_uakt: 900,  nota: 'Workstation GPU: sin equivalente directo en AWS/GCP' },
];

// Mapeo de instancias AWS → modelo GPU (para Vantage API)
const AWS_MAPPING = [
    { instance: 'p5.48xlarge',    modelo: 'h100', ram: '80Gi',  gpus: 8  },
    { instance: 'p5e.48xlarge',   modelo: 'h100', ram: '80Gi',  gpus: 8  },
    { instance: 'p4d.24xlarge',   modelo: 'a100', ram: '40Gi',  gpus: 8  },
    { instance: 'p4de.24xlarge',  modelo: 'a100', ram: '80Gi',  gpus: 8  },
    { instance: 'g4dn.xlarge',    modelo: 't4',   ram: '16Gi',  gpus: 1  },
    { instance: 'g4dn.2xlarge',   modelo: 't4',   ram: '16Gi',  gpus: 1  },
    { instance: 'g6.xlarge',      modelo: 'l4',   ram: '24Gi',  gpus: 1  },
    { instance: 'g6.2xlarge',     modelo: 'l4',   ram: '24Gi',  gpus: 1  },
];

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

// --- SEED ---
async function sembrarInicial(db, save) {
    const ahora = new Date().toISOString();
    let insertados = 0;
    let existentes = 0;

    for (const r of SEED) {
        const existe = query(db,
            'SELECT id FROM precios_referencia WHERE modelo = ? AND (ram = ? OR ram IS NULL)',
            [r.modelo, r.ram]
        );
        if (existe.length === 0) {
            run(db, `INSERT INTO precios_referencia
                (modelo, ram, aws_usd_hr, gcp_usd_hr, akash_min_uakt, akash_max_uakt,
                 aws_fuente, akash_fuente, aws_updated_at, akash_updated_at, nota)
                VALUES ($modelo, $ram, $aws, $gcp, $ak_min, $ak_max,
                 $aws_f, $ak_f, $aws_up, $ak_up, $nota)`,
            {
                $modelo: r.modelo, $ram: r.ram,
                $aws: r.aws_usd_hr, $gcp: r.gcp_usd_hr,
                $ak_min: r.akash_min_uakt, $ak_max: r.akash_max_uakt,
                $aws_f: 'manual-seed', $ak_f: 'manual-seed',
                $aws_up: r.aws_usd_hr ? ahora : null,
                $ak_up: ahora,
                $nota: r.nota
            });
            insertados++;
        } else {
            existentes++;
        }
    }
    save();
    console.log(`   Seed: ${insertados} insertados, ${existentes} ya existían`);
}

// --- ACTUALIZAR AWS desde Vantage ---
async function actualizarAWS(db, save) {
    console.log('⏳ Descargando precios AWS desde Vantage...');
    let data;
    try {
        const r = await axios.get('https://instances.vantage.sh/instances.json', {
            timeout: 20000,
            headers: { 'Accept-Encoding': 'gzip' }
        });
        data = Array.isArray(r.data) ? r.data : [];
    } catch (e) {
        console.log(`   ❌ Vantage no disponible: ${e.message}`);
        console.log('   Los precios AWS quedan como estaban. Reintentá sin VPN.');
        return 0;
    }

    const ahora = new Date().toISOString();
    const instMap = new Map(data.map(i => [i.instance_type, i]));
    let actualizados = 0;

    for (const m of AWS_MAPPING) {
        const inst = instMap.get(m.instance);
        if (!inst) continue;

        const precioTotal = inst.pricing?.['us-east-1']?.linux?.ondemand;
        if (!precioTotal) continue;

        const precioPorGPU = +(precioTotal / m.gpus).toFixed(4);

        const existe = query(db,
            'SELECT id FROM precios_referencia WHERE modelo = ? AND ram = ?',
            [m.modelo, m.ram]
        );

        if (existe.length > 0) {
            run(db, `UPDATE precios_referencia
                SET aws_usd_hr = $aws, aws_fuente = $fuente, aws_updated_at = $ts
                WHERE modelo = $modelo AND ram = $ram`,
            {
                $aws: precioPorGPU,
                $fuente: `vantage:${m.instance}÷${m.gpus}`,
                $ts: ahora,
                $modelo: m.modelo,
                $ram: m.ram
            });
        } else {
            run(db, `INSERT INTO precios_referencia
                (modelo, ram, aws_usd_hr, aws_fuente, aws_updated_at, nota)
                VALUES ($modelo, $ram, $aws, $fuente, $ts, $nota)`,
            {
                $modelo: m.modelo, $ram: m.ram,
                $aws: precioPorGPU,
                $fuente: `vantage:${m.instance}÷${m.gpus}`,
                $ts: ahora,
                $nota: `AWS: ${m.instance} ÷ ${m.gpus} GPUs`
            });
        }
        console.log(`   ✅ ${m.modelo.toUpperCase()} ${m.ram}: $${precioPorGPU}/hr (${m.instance} ÷ ${m.gpus}, us-east-1 on-demand)`);
        actualizados++;
    }

    save();
    return actualizados;
}

// --- MOSTRAR TABLA ACTUAL ---
function mostrarTabla(db) {
    const rows = query(db, `
        SELECT modelo, ram, aws_usd_hr, akash_min_uakt, akash_max_uakt,
               aws_fuente, aws_updated_at
        FROM precios_referencia
        ORDER BY aws_usd_hr DESC NULLS LAST, modelo
    `);

    console.log('\n📋 TABLA precios_referencia:');
    console.log('   Modelo         RAM    AWS/hr   Akash uAKT (min-max)  Fuente AWS');
    console.log('   ' + '-'.repeat(72));
    rows.forEach(r => {
        const aws = r.aws_usd_hr ? `$${r.aws_usd_hr.toFixed(3)}` : 'n/a  ';
        const akash = `${r.akash_min_uakt || '?'}-${r.akash_max_uakt || '?'}`;
        const fuente = (r.aws_fuente || '').slice(0, 24);
        const modelo = `${r.modelo} ${r.ram || ''}`.padEnd(20);
        console.log(`   ${modelo} ${aws.padEnd(8)} ${akash.padEnd(18)} ${fuente}`);
    });
    console.log(`\n   Total: ${rows.length} modelos registrados`);
}

// --- MAIN ---
async function main() {
    const args = process.argv.slice(2);
    const soloSeed = args.includes('--seed');
    const soloAWS  = args.includes('--aws');

    console.log('====================================================');
    console.log('   💹 DEPIN TRUST ORACLE — Actualizar Precios');
    console.log(`   ${new Date().toLocaleString()}`);
    console.log('====================================================\n');

    const { db, save } = await abrirDB();

    // Asegurar que la tabla existe (puede ser una DB vieja sin ella)
    db.run(`CREATE TABLE IF NOT EXISTS precios_referencia (
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
    )`);

    const total = query(db, 'SELECT COUNT(*) as c FROM precios_referencia')[0].c;

    // Siempre sembrar si la tabla está vacía
    if (total === 0 || soloSeed) {
        console.log('🌱 Sembrando datos iniciales...');
        await sembrarInicial(db, save);
    }

    // Actualizar AWS desde Vantage (salvo que sea --seed únicamente)
    if (!soloSeed) {
        const actualizados = await actualizarAWS(db, save);
        if (actualizados > 0) {
            console.log(`   ✅ ${actualizados} precios AWS actualizados desde Vantage`);
        }
    }

    mostrarTabla(db);

    console.log('\n====================================================');
    console.log('   💾 Guardado en data/oracle.db');
    console.log('====================================================');
    db.close();
}

main().catch(console.error);
