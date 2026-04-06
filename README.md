# DePIN Trust Oracle

Auditor de providers GPU en redes DePIN (Decentralized Physical Infrastructure Networks).  
Analiza en tiempo real la confiabilidad de los providers en **Akash Network**, asignando un **trust score 0-100** basado en datos on-chain reales.

## ¿Para qué sirve?

- Saber **qué providers GPU son confiables** antes de deployar un workload
- Ver **ocupación real** de cada modelo GPU en la red (datos en vivo)
- Usar **precios AWS on-demand como referencia** para calibrar tus bids en Akash
- Acumular **historial de performance** de cada provider en SQLite local
- Base para construir un **agente autónomo** en ecosistemas como [Olas/Autonolas](https://olas.network/)

> **Nota sobre precios Akash:** Akash funciona por **subasta inversa** — no existe una lista de precios por modelo. El precio real se determina cuando hacés un deployment en [console.akash.network](https://console.akash.network). Este oracle muestra la ocupación de la red y el precio AWS equivalente como referencia.

## Datos que entrega

```
✅ [100/100] https://provider.btc.com:8443
   GPU: h100 80Gi, rtx4090 24Gi
   EXCELENTE | Online: Sí | Uptime30d: 99.8% | Auditado: Sí

🖥️  H100    80Gi  |  49/63  alquiladas ( 78%) | AWS ref: $6.880/hr
🖥️  RTX5090 32Gi  |  15/16  alquiladas ( 94%) | sin equiv. AWS
🖥️  H200    141Gi |  11/36  alquiladas ( 31%) | AWS ref: $7.912/hr
```

## Stack

- **Node.js** — scripts de auditoría y precios
- **sql.js** — SQLite en WebAssembly (sin compilar, compatible Windows/Linux/Mac)
- **Akash Console API** — `console-api.akash.network/v1` (fuente de datos on-chain)
- **CoinGecko API** — precio AKT en tiempo real
- **Vantage API** — precios AWS on-demand reales (~2MB, semanal) sin hardcoding en el código

## Instalación

```bash
git clone https://github.com/gr2801/depin-trust-oracle.git
cd depin-trust-oracle
npm install
```

## Uso

### 1. Inicializar la base de datos (solo primera vez)

```bash
node db/schema.js
```

Crea `data/oracle.db` con 4 tablas: `auditorias`, `market_snapshots`, `gpu_precios`, `precios_referencia`.

### 2. Cargar precios de referencia (primera vez y semanal)

```bash
node src/actualizar-precios.js
```

- Descubre automáticamente los modelos GPU activos en la red desde `/v1/gpu`
- Actualiza precios AWS on-demand (us-east-1, Linux) desde [Vantage API](https://instances.vantage.sh) (~2MB)
- Consumer GPUs (RTX/GTX/P40) se registran sin equivalente AWS — Akash es la única fuente
- Opción: `--aws` (solo actualizar precios AWS, sin re-descubrir modelos)

### 3. Auditar providers GPU

```bash
node src/auditor.js
```

Descarga todos los providers con GPU de Akash, calcula el trust score de cada uno y guarda los resultados en la DB.

### 4. Capturar snapshot de precios

```bash
node src/precios.js
```

Obtiene precios de GPU actuales en Akash, compara contra AWS (precios reales desde DB) y guarda el historial.

### Correr todo junto

```bash
npm run all
# equivale a: actualizar-precios → auditor → precios
```

## Sistema de scoring

| Flag | Penalización |
|------|-------------|
| OFFLINE | -40 pts |
| VERSION_DESACTUALIZADA | -15 pts |
| UPTIME_7D < 90% | -20 pts |
| UPTIME_7D < 95% | -10 pts |
| UPTIME_30D < 85% | -10 pts |
| NO_AUDITADO | -10 pts |
| INCONSISTENCIA_GPU | -15 pts |
| SIN_CONTACTO | -5 pts |
| Bonus: auditado + online + uptime30d > 97% | +5 pts |

| Score | Clasificación |
|-------|--------------|
| 90-100 | EXCELENTE |
| 75-89 | BUENO |
| 60-74 | REGULAR |
| 40-59 | MALO |
| 0-39 | NO_CONFIABLE |

## Estructura

```
depin-trust-oracle/
├── db/
│   └── schema.js              # Inicialización SQLite (4 tablas)
├── src/
│   ├── actualizar-precios.js  # Actualiza precios AWS desde Vantage (semanal)
│   ├── auditor.js             # Auditoría de providers GPU con trust score
│   └── precios.js             # Snapshot de precios y ocupación de mercado
├── data/
│   └── oracle.db              # Base de datos local (gitignored)
└── package.json
```

### Tablas SQLite

| Tabla | Contenido |
|---|---|
| `auditorias` | Score 0-100 por provider en cada ciclo |
| `market_snapshots` | Estado del mercado (leases, AKT price, GPUs activas) |
| `gpu_precios` | Ocupación y precios por modelo GPU en cada ciclo |
| `precios_referencia` | Precios AWS/GCP/Akash por modelo — actualizados por `actualizar-precios.js` |

## Datos del mercado (Abril 2026)

- **182 GPUs** totales en la red | **86 activas** (~47%)
- **RTX5090** a 94% de ocupación — casi sold out
- **H100** a 78% de ocupación — GPU más demandada
- **Precios AWS de referencia** (on-demand us-east-1, fuente: Vantage):
  - H200 141Gi: **$7.91/hr** | H100 80Gi: **$6.88/hr**
  - A100 80Gi: **$3.43/hr** | A100 40Gi: **$2.74/hr**
  - L4 24Gi: **$0.80/hr** | T4 16Gi: **$0.53/hr**
- Precio Akash real: por subasta — se determina al deployar
- AKT: ~$0.45 USD | Gasto diario en la red: ~$2,858 USD

## Redes soportadas

| Red | Estado |
|-----|--------|
| Akash Network | ✅ Activo |
| io.net | Próximamente |
| Render Network | Próximamente |

## Licencia

MIT
