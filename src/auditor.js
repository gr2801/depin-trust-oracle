const axios = require('axios');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const API_BASE = 'https://console-api.akash.network/v1';
const RED = 'akash';
const DB_PATH = path.join(__dirname, '..', 'data', 'oracle.db');

async function abrirDB() {
    if (!fs.existsSync(DB_PATH)) {
        console.error('âŒ Base de datos no encontrada. EjecutÃ¡ primero: node db/schema.js');
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

async function fetchProviders() {
    const r = await axios.get(`${API_BASE}/providers?withDetails=true`, { timeout: 12000 });
    return Array.isArray(r.data) ? r.data : [];
}

async function fetchNetworkCapacity() {
    const r = await axios.get(`${API_BASE}/network-capacity`, { timeout: 8000 });
    return r.data?.resources || {};
}

function calcularScore(provider) {
    let score = 100;
    const flags = [];
    if (!provider.isOnline) { score -= 40; flags.push('OFFLINE'); }
    if (!provider.isValidVersion) { score -= 15; flags.push('VERSION_DESACTUALIZADA'); }
    const uptime7d  = provider.uptime7d  || 0;
    const uptime30d = provider.uptime30d || 0;
    if (uptime7d < 0.90)       { score -= 20; flags.push(`UPTIME_7D_BAJO:${(uptime7d * 100).toFixed(1)}%`); }
    else if (uptime7d < 0.95)  { score -= 10; flags.push(`UPTIME_7D_MEDIO:${(uptime7d * 100).toFixed(1)}%`); }
    if (uptime30d < 0.85)      { score -= 10; flags.push(`UPTIME_30D_BAJO:${(uptime30d * 100).toFixed(1)}%`); }
    if (!provider.isAudited)   { score -= 10; flags.push('NO_AUDITADO'); }
    const statsGpu = provider.stats?.gpu || {};
    if ((provider.gpuModels || []).length > 0 && (statsGpu.total || 0) === 0) {
        score -= 15; flags.push('INCONSISTENCIA_GPU');
    }
    if (!provider.email && !provider.website) { score -= 5; flags.push('SIN_CONTACTO'); }
    if (provider.isAudited && provider.isOnline && uptime30d > 0.97) {
        score += 5; flags.push('BONUS_EXCELENTE');
    }
    return { score: Math.max(0, Math.min(100, score)), flags };
}

function clasificarScore(score) {
    if (score >= 90) return 'EXCELENTE';
    if (score >= 75) return 'BUENO';
    if (score >= 60) return 'REGULAR';
    if (score >= 40) return 'MALO';
    return 'NO_CONFIABLE';
}

function guardarAuditoria(db, timestamp, provider, score, clasificacion, flags) {
    run(db, `INSERT OR REPLACE INTO auditorias (
        timestamp, red, provider_owner, host_uri, organizacion, pais, region,
        online, auditado, version_valida, uptime_1d, uptime_7d, uptime_30d,
        gpu_modelos, gpu_activa, gpu_disponible, gpu_total, score, clasificacion, flags
    ) VALUES (
        $timestamp, $red, $provider_owner, $host_uri, $organizacion, $pais, $region,
        $online, $auditado, $version_valida, $uptime_1d, $uptime_7d, $uptime_30d,
        $gpu_modelos, $gpu_activa, $gpu_disponible, $gpu_total, $score, $clasificacion, $flags
    )`, {
        $timestamp:      timestamp,
        $red:            RED,
        $provider_owner: provider.owner,
        $host_uri:       provider.hostUri || null,
        $organizacion:   provider.organization || provider.name || null,
        $pais:           provider.ipCountry || provider.country || null,
        $region:         provider.locationRegion || provider.ipRegion || null,
        $online:         provider.isOnline ? 1 : 0,
        $auditado:       provider.isAudited ? 1 : 0,
        $version_valida: provider.isValidVersion ? 1 : 0,
        $uptime_1d:      provider.uptime1d  || null,
        $uptime_7d:      provider.uptime7d  || null,
        $uptime_30d:     provider.uptime30d || null,
        $gpu_modelos:    JSON.stringify(provider.gpuModels || []),
        $gpu_activa:     provider.stats?.gpu?.active    || 0,
        $gpu_disponible: provider.stats?.gpu?.available || 0,
        $gpu_total:      provider.stats?.gpu?.total     || 0,
        $score:          score,
        $clasificacion:  clasificacion,
        $flags:          flags.join('|')
    });
}

async function auditar() {
    
    console.log('====================================================');
    console.log('   í´ DEPIN TRUST ORACLE â€” AuditorÃ­a de Providers');
    console.log(`   Red: ${RED.toUpperCase()} | ${new Date().toLocaleString()}`);
    console.log('====================================================\n');

    const { db, save } = await abrirDB();
    const timestamp = new Date().toISOString();

    let providers, networkCapacity;
    try {
        process.stdout.write('â³ Descargando datos de la red...');
        [providers, networkCapacity] = await Promise.all([fetchProviders(), fetchNetworkCapacity()]);
        console.log(` âœ… ${providers.length} providers totales\n`);
    } catch (e) {
        console.log(` âŒ Error: ${e.message}`);
        db.close(); process.exit(1);
    }

    const conGPU = providers.filter(p => p.gpuModels?.length > 0);
    console.log(`í¶¥ï¸  Providers con GPU declarada: ${conGPU.length}\n`);

    const resultados = [];
    for (const provider of conGPU) {
        const { score, flags } = calcularScore(provider);
        const clasificacion = clasificarScore(score);
        const icono = score >= 75 ? 'âœ…' : score >= 50 ? 'âš ï¸ ' : 'âŒ';
        console.log(`${icono} [${score}/100] ${provider.hostUri || provider.owner?.slice(0, 35)}`);
        console.log(`   GPU: ${provider.gpuModels?.map(g => `${g.model} ${g.ram}`).join(', ')}`);
        console.log(`   ${clasificacion} | Online: ${provider.isOnline ? 'SÃ­' : 'No'} | Uptime30d: ${provider.uptime30d ? (provider.uptime30d * 100).toFixed(1) + '%' : 'N/A'} | Auditado: ${provider.isAudited ? 'SÃ­' : 'No'}`);
        if (flags.length) console.log(`   âš‘ ${flags.join(' | ')}`);
        console.log('');
        resultados.push({ provider, score, clasificacion, flags });
    }

    for (const item of resultados) {
        guardarAuditoria(db, timestamp, item.provider, item.score, item.clasificacion, item.flags);
    }
    save();

    const totalReg  = query(db, 'SELECT COUNT(*) as total FROM auditorias WHERE red = ?', [RED]);
    const avgScore  = query(db, 'SELECT AVG(score) as avg FROM auditorias WHERE red = ?', [RED]);
    const mejores   = query(db, `SELECT host_uri, provider_owner, score FROM auditorias WHERE red = ? AND online = 1 ORDER BY score DESC LIMIT 5`, [RED]);
    const excelentes = resultados.filter(r => r.score >= 90).length;
    const buenos     = resultados.filter(r => r.score >= 75 && r.score < 90).length;
    const regulares  = resultados.filter(r => r.score >= 60 && r.score < 75).length;
    const malos      = resultados.filter(r => r.score < 60).length;

    console.log('====================================================');
    console.log('   í³Š RESUMEN ESTA AUDITORÃA');
    console.log('====================================================');
    console.log(`   EXCELENTE (90-100): ${excelentes} | BUENO (75-89): ${buenos}`);
    console.log(`   REGULAR   (60-74):  ${regulares} | MALO  (<60):   ${malos}`);
    console.log(`\n   RED: GPU activas: ${networkCapacity.gpu?.active || 0} | Disponibles: ${networkCapacity.gpu?.available || 0} | Total: ${networkCapacity.gpu?.total || 0}`);
    console.log(`\n   í³ˆ Total registros DB: ${totalReg[0]?.total || 0} | Score promedio: ${(+(avgScore[0]?.avg || 0)).toFixed(1)}/100`);

    if (mejores.length > 0) {
        console.log('\n   í¿† TOP 5 PROVIDERS (mejor score, online):');
        mejores.forEach((p, i) => {
            console.log(`   ${i + 1}. [${p.score}/100] ${p.host_uri || String(p.provider_owner).slice(0, 30)}`);
        });
    }

    console.log('\n====================================================');
    console.log(`   í²¾ Guardado en data/oracle.db`);
    console.log('====================================================');
    db.close();
}

auditar().catch(console.error);
