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

Crea `data/oracle.db` con 3 tablas: `auditorias`, `market_snapshots`, `gpu_precios`.

### 2. Auditar providers GPU

```bash
node src/auditor.js
```

Descarga todos los providers con GPU de Akash, calcula el trust score de cada uno y guarda los resultados en la DB.

### 3. Capturar snapshot de precios

```bash
node src/precios.js
```

Obtiene precios de GPU actuales en Akash, compara contra AWS/GCP y guarda el historial en la DB.

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
│   └── schema.js          # Inicialización SQLite
├── src/
│   ├── auditor.js         # Auditoría de providers
│   └── precios.js         # Snapshot de precios de mercado
├── data/
│   └── oracle.db          # Base de datos local (gitignored)
└── package.json
```

## Datos del mercado (Abril 2026)

- **182 GPUs** totales en la red | **84 activas** (~46%)
- **H100** a 76% de ocupación — GPU más demandada
- **RTX5090** a 94% de ocupación — casi sold out
- Precios **77-84% más baratos** que AWS equivalente
- AKT: ~$0.45 USD

## Hoja de ruta

- [x] Auditor local con scoring y SQLite
- [x] Comparación de precios vs cloud
- [ ] API REST pública (Express.js) para exponer scores
- [ ] Webhook de alertas cuando un provider cae o sube
- [ ] Registro como agente autónomo en [Olas](https://olas.network/)
- [ ] Soporte para io.net, Render Network, Flux

## Redes soportadas

| Red | Estado |
|-----|--------|
| Akash Network | ✅ Activo |
| io.net | Próximamente |
| Render Network | Próximamente |

## Licencia

MIT
