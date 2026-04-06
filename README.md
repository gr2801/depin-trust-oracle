# DePIN Trust Oracle

Auditor de providers GPU en redes DePIN (Decentralized Physical Infrastructure Networks).  
Analiza en tiempo real la confiabilidad de los providers en **Akash Network**, asignando un **trust score 0-100** basado en datos on-chain reales.

## ¿Para qué sirve?

- Saber **qué providers GPU son confiables** antes de deployar un workload
- **Comparar precios** de GPU en Akash vs AWS/GCP en tiempo real
- Acumular **historial de performance** de cada provider en SQLite local
- Base para construir un **agente autónomo** en ecosistemas como [Olas/Autonolas](https://olas.network/)

## Datos que entrega

```
✅ [100/100] https://provider.btc.com:8443
   GPU: h100 80Gi, rtx4090 24Gi
   EXCELENTE | Online: Sí | Uptime30d: 99.8% | Auditado: Sí

💰 H100 80Gi | 48/63 alquiladas | Akash: $0.41-$0.96/hr | AWS: $3.28/hr | 79% más barato
💰 Ingreso potencial broker (10%): $126.90/día | $3,807/mes
```

## Stack

- **Node.js** — scripts de auditoría y precios
- **sql.js** — SQLite en WebAssembly (sin compilar, compatible Windows/Linux/Mac)
- **Akash Console API** — `console-api.akash.network/v1` (fuente de datos on-chain)
- **CoinGecko API** — precio AKT en tiempo real
- **Vantage API** — precios AWS reales (~2MB, semanal) en vez del JSON oficial de 1GB

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

- Siembra precios de 21 modelos GPU si la tabla está vacía
- Actualiza precios AWS on-demand (us-east-1) desde [Vantage API](https://instances.vantage.sh) (~2MB)
- Precios Akash: estimados desde bids observados en la red (futuro: LCD Akash)
- Opciones: `--seed` (solo sembrar), `--aws` (solo actualizar AWS)

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

- **182 GPUs** totales en la red | **87 activas** (~48%)
- **H100** a 78% de ocupación — GPU más demandada
- **RTX5090** a 94% de ocupación — casi sold out
- Precios **86-94% más baratos** que AWS on-demand (precios reales desde Vantage)
  - H100: Akash $0.41-$0.96/hr vs AWS **$6.88/hr** (on-demand us-east-1) → **90% más barato**
  - A100 80Gi: Akash $0.27-$0.68/hr vs AWS **$3.43/hr** → **86% más barato**
  - T4: Akash $0.027-$0.082/hr vs AWS **$0.75/hr** → **93% más barato**
- AKT: ~$0.456 USD
- Ingreso potencial broker 10%: **$133/día | $4,007/mes**

## Redes soportadas

| Red | Estado |
|-----|--------|
| Akash Network | ✅ Activo |
| io.net | Próximamente |
| Render Network | Próximamente |

## Licencia

MIT
