"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const INITIAL_ODOMETER = 22489;

type Refuel = {
  id: string;
  date: string;
  odometer: number;
  liters: number;
};

type CalculatedRefuel = Refuel & {
  distance: number;
  consumption: number;
};

type Filter = "all" | "month" | "threeMonths" | "year" | "custom";
type Tab = "records" | "summary";

const DB_NAME = "moto-consumo";
const STORE_NAME = "refuels";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getRefuels(): Promise<Refuel[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as Refuel[]);
    request.onerror = () => reject(request.error);
  });
}

async function saveRefuel(refuel: Refuel) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(refuel);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function removeRefuel(id: string) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function parseLocalDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

function formatDate(value: string, long = false) {
  return new Intl.DateTimeFormat("es-ES", long
    ? { day: "numeric", month: "long", year: "numeric" }
    : { day: "2-digit", month: "short", year: "numeric" })
    .format(parseLocalDate(value));
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function calculate(refuels: Refuel[]): CalculatedRefuel[] {
  return [...refuels]
    .sort((a, b) => a.odometer - b.odometer)
    .map((refuel, index, sorted) => {
      const previousOdometer = index === 0 ? INITIAL_ODOMETER : sorted[index - 1].odometer;
      const distance = refuel.odometer - previousOdometer;
      return {
        ...refuel,
        distance,
        consumption: distance > 0 ? (refuel.liters / distance) * 100 : 0,
      };
    });
}

function getDateRange(filter: Filter, start: string, end: string) {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  if (filter === "month") return [new Date(now.getFullYear(), now.getMonth(), 1), endOfToday];
  if (filter === "threeMonths") return [new Date(now.getFullYear(), now.getMonth() - 2, 1), endOfToday];
  if (filter === "year") return [new Date(now.getFullYear(), 0, 1), endOfToday];
  if (filter === "custom") {
    return [start ? parseLocalDate(start) : null, end ? new Date(`${end}T23:59:59`) : null];
  }
  return [null, null];
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("records");
  const [refuels, setRefuels] = useState<Refuel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Refuel | null>(null);
  const [date, setDate] = useState(today());
  const [odometer, setOdometer] = useState("");
  const [liters, setLiters] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(today());

  useEffect(() => {
    getRefuels().then(setRefuels).catch(() => setError("No se pudo abrir el almacenamiento local.")).finally(() => setLoaded(true));
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(new URL("sw.js", document.baseURI).pathname).catch(() => undefined);
    }
  }, []);

  const calculated = useMemo(() => calculate(refuels), [refuels]);
  const newestFirst = useMemo(() => [...calculated].sort((a, b) =>
    b.date.localeCompare(a.date) || b.odometer - a.odometer), [calculated]);

  const filtered = useMemo(() => {
    const [start, end] = getDateRange(filter, customStart, customEnd);
    return calculated.filter((item) => {
      const itemDate = parseLocalDate(item.date);
      return (!start || itemDate >= start) && (!end || itemDate <= end);
    });
  }, [calculated, filter, customStart, customEnd]);

  const totals = useMemo(() => {
    const distance = filtered.reduce((sum, item) => sum + item.distance, 0);
    const fuel = filtered.reduce((sum, item) => sum + item.liters, 0);
    return { distance, fuel, average: distance > 0 ? (fuel / distance) * 100 : 0 };
  }, [filtered]);

  const lastRefuel = newestFirst[0];

  function openNew() {
    setEditing(null);
    setDate(today());
    setOdometer("");
    setLiters("");
    setError("");
    setFormOpen(true);
  }

  function openEdit(refuel: Refuel) {
    setEditing(refuel);
    setDate(refuel.date);
    setOdometer(String(refuel.odometer));
    setLiters(String(refuel.liters).replace(".", ","));
    setError("");
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsedOdometer = Number(odometer.replace(",", "."));
    const parsedLiters = Number(liters.replace(",", "."));
    const otherRefuels = refuels.filter((item) => item.id !== editing?.id);

    if (!date || !Number.isFinite(parsedOdometer) || !Number.isFinite(parsedLiters)) {
      setError("Completa los tres campos.");
      return;
    }
    if (!Number.isInteger(parsedOdometer) || parsedOdometer <= INITIAL_ODOMETER) {
      setError(`El kilometraje debe ser un número entero mayor que ${formatNumber(INITIAL_ODOMETER)} km.`);
      return;
    }
    if (parsedLiters <= 0 || parsedLiters > 100) {
      setError("Introduce una cantidad de litros válida.");
      return;
    }
    if (otherRefuels.some((item) => item.odometer === parsedOdometer)) {
      setError("Ya existe un repostaje con ese kilometraje.");
      return;
    }

    const refuel: Refuel = {
      id: editing?.id ?? crypto.randomUUID(),
      date,
      odometer: parsedOdometer,
      liters: Math.round(parsedLiters * 100) / 100,
    };

    try {
      await saveRefuel(refuel);
      setRefuels((current) => [...current.filter((item) => item.id !== refuel.id), refuel]);
      setFormOpen(false);
    } catch {
      setError("No se pudo guardar. Inténtalo de nuevo.");
    }
  }

  async function handleDelete(refuel: Refuel) {
    if (!window.confirm(`¿Eliminar el repostaje del ${formatDate(refuel.date, true)}?`)) return;
    await removeRefuel(refuel.id);
    setRefuels((current) => current.filter((item) => item.id !== refuel.id));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Mi motocicleta</p>
          <h1>{tab === "records" ? "Repostajes" : "Resumen"}</h1>
        </div>
        <div className="odometer-origin" title="Kilometraje inicial">
          <span>Inicio</span>
          <strong>{formatNumber(INITIAL_ODOMETER)} km</strong>
        </div>
      </header>

      <main>
        {tab === "records" ? (
          <section className="records-view" aria-labelledby="records-title">
            <h2 id="records-title" className="sr-only">Registros de repostaje</h2>
            <button className="primary-button" onClick={openNew}>
              <span className="plus" aria-hidden="true">+</span>
              Añadir repostaje
            </button>

            {!loaded ? (
              <div className="loading-card">Cargando registros…</div>
            ) : newestFirst.length === 0 ? (
              <div className="empty-state">
                <div className="empty-mark" aria-hidden="true"><span /></div>
                <h3>Tu primer repostaje</h3>
                <p>Añádelo cuando llenes el depósito. Solo necesitas fecha, kilómetros y litros.</p>
              </div>
            ) : (
              <div className="record-list">
                <div className="section-heading">
                  <h2>Historial</h2>
                  <span>{newestFirst.length} {newestFirst.length === 1 ? "registro" : "registros"}</span>
                </div>
                {newestFirst.map((item) => (
                  <article className="record-card" key={item.id}>
                    <div className="record-card-header">
                      <div>
                        <time dateTime={item.date}>{formatDate(item.date)}</time>
                        <p>{formatNumber(item.odometer)} km</p>
                      </div>
                      <div className="record-actions">
                        <button onClick={() => openEdit(item)} aria-label={`Editar repostaje del ${formatDate(item.date)}`}>Editar</button>
                        <button className="danger-link" onClick={() => handleDelete(item)} aria-label={`Eliminar repostaje del ${formatDate(item.date)}`}>Eliminar</button>
                      </div>
                    </div>
                    <div className="record-metrics">
                      <div><span>Repostado</span><strong>{formatNumber(item.liters, 2)} L</strong></div>
                      <div><span>Recorridos</span><strong>{formatNumber(item.distance)} km</strong></div>
                      <div className="consumption-metric"><span>Consumo</span><strong>{formatNumber(item.consumption, 2)} <small>L/100 km</small></strong></div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="summary-view" aria-labelledby="summary-title">
            <h2 id="summary-title" className="sr-only">Resumen de consumo</h2>
            <div className="filter-row" role="group" aria-label="Periodo del resumen">
              {([
                ["all", "Todo"],
                ["month", "Este mes"],
                ["threeMonths", "3 meses"],
                ["year", "Este año"],
                ["custom", "Personalizado"],
              ] as [Filter, string][]).map(([value, label]) => (
                <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</button>
              ))}
            </div>

            {filter === "custom" && (
              <div className="custom-range">
                <label>Desde<input type="date" value={customStart} max={customEnd || undefined} onChange={(event) => setCustomStart(event.target.value)} /></label>
                <label>Hasta<input type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} /></label>
              </div>
            )}

            <article className="kpi-card">
              <p>Consumo medio</p>
              <div className="kpi-value">{filtered.length ? formatNumber(totals.average, 2) : "—"}</div>
              <span>L/100 km</span>
              <div className="kpi-rule" />
              <small>Calculado sobre {formatNumber(totals.distance)} km</small>
            </article>

            <div className="stat-grid">
              <article><span>Kilómetros</span><strong>{formatNumber(totals.distance)}</strong><small>km recorridos</small></article>
              <article><span>Combustible</span><strong>{formatNumber(totals.fuel, 2)}</strong><small>litros consumidos</small></article>
              <article><span>Repostajes</span><strong>{filtered.length}</strong><small>en el periodo</small></article>
            </div>

            <article className="chart-card">
              <div className="section-heading">
                <div><h2>Evolución</h2><p>Consumo por repostaje</p></div>
                <span>L/100 km</span>
              </div>
              {filtered.length ? (
                <ConsumptionChart data={filtered} />
              ) : (
                <div className="chart-empty">No hay repostajes en este periodo.</div>
              )}
            </article>

            <article className="last-card">
              <div className="section-heading"><h2>Último repostaje</h2></div>
              {lastRefuel ? (
                <>
                  <div className="last-main"><div><time>{formatDate(lastRefuel.date, true)}</time><p>{formatNumber(lastRefuel.odometer)} km en el odómetro</p></div><strong>{formatNumber(lastRefuel.liters, 2)} L</strong></div>
                  <div className="last-stats"><span>{formatNumber(lastRefuel.distance)} km recorridos</span><span>{formatNumber(lastRefuel.consumption, 2)} L/100 km</span></div>
                </>
              ) : <p className="muted">Aún no hay repostajes.</p>}
            </article>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Navegación principal">
        <button className={tab === "records" ? "active" : ""} onClick={() => setTab("records")} aria-current={tab === "records" ? "page" : undefined}>
          <span className="nav-icon list-icon" aria-hidden="true"><i /><i /><i /></span>
          Registros
        </button>
        <button className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")} aria-current={tab === "summary" ? "page" : undefined}>
          <span className="nav-icon chart-icon" aria-hidden="true"><i /><i /><i /></span>
          Resumen
        </button>
      </nav>

      {formOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setFormOpen(false)}>
          <section className="form-sheet" role="dialog" aria-modal="true" aria-labelledby="form-title">
            <div className="sheet-handle" aria-hidden="true" />
            <div className="form-header">
              <div><p className="eyebrow">Repostaje completo</p><h2 id="form-title">{editing ? "Editar repostaje" : "Nuevo repostaje"}</h2></div>
              <button className="close-button" onClick={() => setFormOpen(false)} aria-label="Cerrar">×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <label>Fecha<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <label>Kilometraje<div className="input-with-unit"><input inputMode="numeric" type="text" required placeholder="Ej. 23180" value={odometer} onChange={(event) => setOdometer(event.target.value)} /><span>km</span></div></label>
              <label>Litros repostados<div className="input-with-unit"><input inputMode="decimal" type="text" required placeholder="Ej. 12,45" value={liters} onChange={(event) => setLiters(event.target.value)} /><span>L</span></div></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button submit-button" type="submit">{editing ? "Guardar cambios" : "Guardar repostaje"}</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function ConsumptionChart({ data }: { data: CalculatedRefuel[] }) {
  const ordered = [...data].sort((a, b) => a.date.localeCompare(b.date) || a.odometer - b.odometer);
  const values = ordered.map((item) => item.consumption);
  const min = Math.min(...values) * 0.85;
  const max = Math.max(...values) * 1.1;
  const range = Math.max(max - min, 1);

  return (
    <div className="chart" role="img" aria-label={`Evolución del consumo en ${ordered.length} repostajes`}>
      <div className="chart-guides" aria-hidden="true"><i /><i /><i /></div>
      <div className="chart-bars">
        {ordered.map((item, index) => {
          const height = 24 + ((item.consumption - min) / range) * 76;
          const showLabel = ordered.length <= 7 || index === 0 || index === ordered.length - 1;
          return (
            <div className="chart-column" key={item.id} title={`${formatDate(item.date)} · ${formatNumber(item.consumption, 2)} L/100 km`}>
              <span className="chart-value">{formatNumber(item.consumption, 1)}</span>
              <div className="chart-bar" style={{ height: `${height}%` }} />
              <time>{showLabel ? new Intl.DateTimeFormat("es-ES", { month: "short" }).format(parseLocalDate(item.date)) : ""}</time>
            </div>
          );
        })}
      </div>
    </div>
  );
}
