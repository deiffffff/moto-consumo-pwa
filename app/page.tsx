"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  assignRefuelsToVehicle,
  auth,
  deleteCloudRefuel,
  deleteVehicle,
  migrateRefuels,
  saveCloudRefuel,
  saveVehicle,
  subscribeToRefuels,
  subscribeToVehicles,
  type Refuel,
  type Vehicle,
} from "../lib/firebase";

const LEGACY_INITIAL_ODOMETER = 22489;
type Filter = "all" | "month" | "threeMonths" | "year" | "custom";
type Tab = "records" | "summary";
type AuthMode = "signin" | "register" | "reset";
type CalculatedRefuel = Refuel & { distance: number; consumption: number; measurable: boolean };

const DB_NAME = "moto-consumo";
const STORE_NAME = "refuels";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getLocalRefuels(): Promise<Refuel[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as Refuel[]);
    request.onerror = () => reject(request.error);
  });
}

function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function parseLocalDate(value: string) { return new Date(`${value}T12:00:00`); }

function formatDate(value: string, long = false) {
  return new Intl.DateTimeFormat("es-ES", long
    ? { day: "numeric", month: "long", year: "numeric" }
    : { day: "2-digit", month: "short", year: "numeric" }).format(parseLocalDate(value));
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function normalizePlate(value: string) { return value.toUpperCase().replace(/[^A-Z0-9]/g, ""); }

function calculate(refuels: Refuel[], vehicle: Vehicle | undefined): CalculatedRefuel[] {
  const ordered = [...refuels].sort((a, b) => a.odometer - b.odometer);
  return ordered.map((refuel, index) => {
    const previous = index === 0 ? vehicle?.initialOdometer : ordered[index - 1].odometer;
    const measurable = typeof previous === "number" && refuel.odometer > previous;
    const distance = measurable ? refuel.odometer - previous : 0;
    return { ...refuel, distance, measurable, consumption: measurable ? (refuel.liters / distance) * 100 : 0 };
  });
}

function getDateRange(filter: Filter, start: string, end: string) {
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  if (filter === "month") return [new Date(now.getFullYear(), now.getMonth(), 1), todayEnd];
  if (filter === "threeMonths") return [new Date(now.getFullYear(), now.getMonth() - 2, 1), todayEnd];
  if (filter === "year") return [new Date(now.getFullYear(), 0, 1), todayEnd];
  if (filter === "custom") return [start ? parseLocalDate(start) : null, end ? new Date(`${end}T23:59:59`) : null];
  return [null, null];
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [refuels, setRefuels] = useState<Refuel[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [vehiclesLoaded, setVehiclesLoaded] = useState(false);
  const [syncState, setSyncState] = useState<"synced" | "pending" | "offline">("synced");
  const [appError, setAppError] = useState("");
  const [tab, setTab] = useState<Tab>("records");

  const [vehicleSheetOpen, setVehicleSheetOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [vehicleNickname, setVehicleNickname] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [vehicleError, setVehicleError] = useState("");
  const [vehicleBusy, setVehicleBusy] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Refuel | null>(null);
  const [formVehicleId, setFormVehicleId] = useState("");
  const [date, setDate] = useState(today());
  const [odometer, setOdometer] = useState("");
  const [liters, setLiters] = useState("");
  const [formError, setFormError] = useState("");

  const [legacyRefuels, setLegacyRefuels] = useState<Refuel[]>([]);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(today());

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(new URL("sw.js", document.baseURI).pathname).catch(() => undefined);
    setPersistence(auth, browserLocalPersistence).catch(() => undefined);
    return onAuthStateChanged(auth, (currentUser) => { setUser(currentUser); setAuthLoading(false); });
  }, []);

  useEffect(() => {
    if (!user) {
      setVehicles([]); setRefuels([]); setLoaded(false); setVehiclesLoaded(false); setSelectedVehicleId("");
      return;
    }
    let active = true;
    setLoaded(false); setVehiclesLoaded(false); setAppError("");
    getLocalRefuels().then((items) => active && setLegacyRefuels(items)).catch(() => setLegacyRefuels([]));

    const stopVehicles = subscribeToVehicles(user.uid, (items) => {
      if (!active) return;
      setVehicles(items); setVehiclesLoaded(true);
      setSelectedVehicleId((current) => items.some((item) => item.id === current) ? current : (items[0]?.id ?? ""));
    }, () => setAppError("No se pudieron cargar los vehículos. Revisa las reglas de Firebase."));

    const stopRefuels = subscribeToRefuels(user.uid, (items, pending, cached) => {
      if (!active) return;
      setRefuels(items); setLoaded(true);
      setSyncState(pending ? "pending" : cached && !navigator.onLine ? "offline" : "synced");
    }, () => { setAppError("No se pudieron sincronizar los repostajes. Revisa las reglas de Firebase."); setLoaded(true); });

    const online = () => setSyncState("pending");
    const offline = () => setSyncState("offline");
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    return () => { active = false; stopVehicles(); stopRefuels(); window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, [user]);

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId);
  const unassignedRefuels = useMemo(() => refuels.filter((item) => !item.vehicleId), [refuels]);
  const vehicleRefuels = useMemo(() => refuels.filter((item) => item.vehicleId === selectedVehicleId), [refuels, selectedVehicleId]);
  const calculated = useMemo(() => calculate(vehicleRefuels, selectedVehicle), [vehicleRefuels, selectedVehicle]);
  const newestFirst = useMemo(() => [...calculated].sort((a, b) => b.date.localeCompare(a.date) || b.odometer - a.odometer), [calculated]);
  const filtered = useMemo(() => {
    const [start, end] = getDateRange(filter, customStart, customEnd);
    return calculated.filter((item) => {
      const itemDate = parseLocalDate(item.date);
      return (!start || itemDate >= start) && (!end || itemDate <= end);
    });
  }, [calculated, filter, customStart, customEnd]);
  const measurableFiltered = filtered.filter((item) => item.measurable);
  const totals = useMemo(() => {
    const distance = measurableFiltered.reduce((sum, item) => sum + item.distance, 0);
    const fuel = measurableFiltered.reduce((sum, item) => sum + item.liters, 0);
    return { distance, fuel, average: distance > 0 ? (fuel / distance) * 100 : 0 };
  }, [measurableFiltered]);
  const lastRefuel = newestFirst[0];
  const localPending = user ? legacyRefuels.filter((item) => !localStorage.getItem(`moto-consumo-migrated-${user.uid}`)) : [];

  async function handleAuth(event: FormEvent) {
    event.preventDefault(); setAuthError(""); setAuthMessage(""); setAuthBusy(true);
    try {
      const cleanEmail = email.trim();
      if (!cleanEmail) throw new Error("email");
      if (authMode !== "reset" && password.length < 6) throw new Error("password");
      if (authMode === "register" && password !== confirmPassword) throw new Error("confirm");
      if (authMode === "register") await createUserWithEmailAndPassword(auth, cleanEmail, password);
      else if (authMode === "reset") { await sendPasswordResetEmail(auth, cleanEmail); setAuthMessage("Te hemos enviado un correo para restablecer la contraseña."); }
      else await signInWithEmailAndPassword(auth, cleanEmail, password);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      if (code === "email") setAuthError("Introduce tu correo electrónico.");
      else if (code === "password") setAuthError("La contraseña debe tener al menos 6 caracteres.");
      else if (code === "confirm") setAuthError("Las contraseñas no coinciden.");
      else if (code.includes("email-already-in-use")) setAuthError("Ya existe una cuenta con este correo.");
      else if (code.includes("invalid-credential")) setAuthError("El correo o la contraseña no son correctos.");
      else setAuthError("No se pudo completar la operación. Inténtalo de nuevo.");
    } finally { setAuthBusy(false); }
  }

  function changeAuthMode(mode: AuthMode) { setAuthMode(mode); setAuthError(""); setAuthMessage(""); setPassword(""); setConfirmPassword(""); }

  function openVehicle(vehicle?: Vehicle) {
    setEditingVehicle(vehicle ?? null); setVehicleNickname(vehicle?.nickname ?? ""); setVehiclePlate(vehicle?.plate ?? ""); setVehicleError(""); setVehicleSheetOpen(true);
  }

  async function handleVehicle(event: FormEvent) {
    event.preventDefault();
    const nickname = vehicleNickname.trim(); const plate = normalizePlate(vehiclePlate);
    if (!nickname || plate.length < 3) { setVehicleError("Introduce un apodo y una matrícula válidos."); return; }
    if (vehicles.some((item) => item.id !== editingVehicle?.id && normalizePlate(item.plate) === plate)) { setVehicleError("Ya existe un vehículo con esta matrícula."); return; }
    if (!user) return;
    setVehicleBusy(true); setVehicleError("");
    const vehicle: Vehicle = {
      id: editingVehicle?.id ?? crypto.randomUUID(), nickname, plate,
      initialOdometer: editingVehicle?.initialOdometer ?? ((vehicles.length === 0 && (unassignedRefuels.length || localPending.length)) ? LEGACY_INITIAL_ODOMETER : null),
    };
    try {
      await saveVehicle(user.uid, vehicle, !editingVehicle);
      if (!editingVehicle && vehicles.length === 0 && unassignedRefuels.length) await assignRefuelsToVehicle(user.uid, vehicle.id, unassignedRefuels);
      if (!editingVehicle && vehicles.length === 0 && localPending.length) {
        await migrateRefuels(user.uid, vehicle.id, localPending);
        localStorage.setItem(`moto-consumo-migrated-${user.uid}`, "done");
      }
      setSelectedVehicleId(vehicle.id); setVehicleSheetOpen(false);
    } catch { setVehicleError("No se pudo guardar el vehículo. Comprueba las reglas de Firebase."); }
    finally { setVehicleBusy(false); }
  }

  async function handleDeleteVehicle(vehicle: Vehicle) {
    if (!user) return;
    if (refuels.some((item) => item.vehicleId === vehicle.id)) { setVehicleError("Elimina primero los repostajes de este vehículo."); return; }
    if (!window.confirm(`¿Eliminar ${vehicle.nickname} (${vehicle.plate})?`)) return;
    await deleteVehicle(user.uid, vehicle.id);
  }

  async function assignPending() {
    if (!user || !selectedVehicle) return;
    setMigrationBusy(true); setAppError("");
    try {
      if (unassignedRefuels.length) await assignRefuelsToVehicle(user.uid, selectedVehicle.id, unassignedRefuels);
      if (localPending.length) {
        await migrateRefuels(user.uid, selectedVehicle.id, localPending);
        localStorage.setItem(`moto-consumo-migrated-${user.uid}`, "done");
      }
    } catch { setAppError("No se pudieron asignar los registros anteriores."); }
    finally { setMigrationBusy(false); }
  }

  function openNew() {
    if (!vehicles.length) { openVehicle(); return; }
    setEditing(null); setFormVehicleId(selectedVehicleId || vehicles[0].id); setDate(today()); setOdometer(""); setLiters(""); setFormError(""); setFormOpen(true);
  }

  function openEdit(refuel: Refuel) {
    setEditing(refuel); setFormVehicleId(refuel.vehicleId ?? selectedVehicleId); setDate(refuel.date); setOdometer(String(refuel.odometer)); setLiters(String(refuel.liters).replace(".", ",")); setFormError(""); setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsedOdometer = Number(odometer.replace(",", ".")); const parsedLiters = Number(liters.replace(",", "."));
    if (!formVehicleId || !date || !Number.isInteger(parsedOdometer) || !Number.isFinite(parsedLiters)) { setFormError("Completa correctamente todos los campos."); return; }
    if (parsedOdometer < 0 || parsedOdometer >= 2000000) { setFormError("Introduce un kilometraje válido."); return; }
    if (parsedLiters <= 0 || parsedLiters > 100) { setFormError("Introduce una cantidad de litros válida."); return; }
    if (refuels.some((item) => item.id !== editing?.id && item.vehicleId === formVehicleId && item.odometer === parsedOdometer)) { setFormError("Ese vehículo ya tiene un repostaje con ese kilometraje."); return; }
    if (!user) return;
    const refuel: Required<Refuel> = { id: editing?.id ?? crypto.randomUUID(), vehicleId: formVehicleId, date, odometer: parsedOdometer, liters: Math.round(parsedLiters * 100) / 100 };
    try { await saveCloudRefuel(user.uid, refuel, !editing); setSelectedVehicleId(formVehicleId); setFormOpen(false); }
    catch { setFormError("No se pudo guardar. Inténtalo de nuevo."); }
  }

  async function handleDeleteRefuel(refuel: Refuel) {
    if (!user || !window.confirm(`¿Eliminar el repostaje del ${formatDate(refuel.date, true)}?`)) return;
    await deleteCloudRefuel(user.uid, refuel.id);
  }

  if (authLoading) return <div className="auth-loading">Abriendo Moto Consumo…</div>;
  if (!user) return <AuthScreen mode={authMode} email={email} password={password} confirmPassword={confirmPassword} busy={authBusy} error={authError} message={authMessage} onEmail={setEmail} onPassword={setPassword} onConfirmPassword={setConfirmPassword} onMode={changeAuthMode} onSubmit={handleAuth} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">Moto Consumo</p><h1>{tab === "records" ? "Repostajes" : "Resumen"}</h1></div>
        <button className="vehicle-settings" onClick={() => openVehicle()} aria-label="Añadir vehículo">+ Vehículo</button>
      </header>

      <div className="account-bar">
        <div><span className={`sync-dot ${syncState}`} /><span>{syncState === "offline" ? "Sin conexión" : syncState === "pending" ? "Sincronizando…" : "Sincronizado"}</span><small>{user.email}</small></div>
        <button onClick={() => signOut(auth)}>Cerrar sesión</button>
      </div>
      {appError && <p className="app-error" role="alert">{appError}</p>}

      {vehicles.length > 0 && (
        <section className="vehicle-switcher" aria-label="Vehículo seleccionado">
          <label><span>Vehículo</span><select value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)}>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.nickname} · {vehicle.plate}</option>)}</select></label>
          {selectedVehicle && <button onClick={() => openVehicle(selectedVehicle)}>Editar</button>}
        </section>
      )}

      {(unassignedRefuels.length > 0 || localPending.length > 0) && selectedVehicle && (
        <article className="migration-card"><div><h2>Registros anteriores</h2><p>Asigna {unassignedRefuels.length + localPending.length} registros sin vehículo a {selectedVehicle.nickname}.</p></div><button className="compact-primary" onClick={assignPending} disabled={migrationBusy}>{migrationBusy ? "Asignando…" : "Asignar"}</button></article>
      )}

      <main>
        {!vehiclesLoaded || !loaded ? <div className="loading-card">Cargando datos…</div> : vehicles.length === 0 ? (
          <div className="empty-state vehicle-empty"><div className="empty-mark"><span /></div><h3>Añade tu primer vehículo</h3><p>Solo necesitamos un apodo y la matrícula para empezar.</p><button className="primary-button" onClick={() => openVehicle()}><span className="plus">+</span>Añadir vehículo</button></div>
        ) : tab === "records" ? (
          <section className="records-view" aria-labelledby="records-title">
            <h2 id="records-title" className="sr-only">Registros de repostaje</h2>
            <button className="primary-button" onClick={openNew}><span className="plus">+</span>Añadir repostaje</button>
            {newestFirst.length === 0 ? <div className="empty-state"><div className="empty-mark"><span /></div><h3>Primer repostaje de {selectedVehicle?.nickname}</h3><p>Este primer registro establecerá la referencia del odómetro. El consumo aparecerá a partir del siguiente depósito lleno.</p></div> : (
              <div className="record-list"><div className="section-heading"><h2>Historial</h2><span>{newestFirst.length} {newestFirst.length === 1 ? "registro" : "registros"}</span></div>
                {newestFirst.map((item) => <article className="record-card" key={item.id}>
                  <div className="record-card-header"><div><time dateTime={item.date}>{formatDate(item.date)}</time><p>{selectedVehicle?.nickname} · {formatNumber(item.odometer)} km</p></div><div className="record-actions"><button onClick={() => openEdit(item)}>Editar</button><button className="danger-link" onClick={() => handleDeleteRefuel(item)}>Eliminar</button></div></div>
                  <div className="record-metrics"><div><span>Repostado</span><strong>{formatNumber(item.liters, 2)} L</strong></div><div><span>Recorridos</span><strong>{item.measurable ? `${formatNumber(item.distance)} km` : "—"}</strong></div><div className="consumption-metric"><span>Consumo</span><strong>{item.measurable ? formatNumber(item.consumption, 2) : "—"} <small>L/100 km</small></strong></div></div>
                </article>)}
              </div>
            )}
          </section>
        ) : (
          <section className="summary-view" aria-labelledby="summary-title">
            <h2 id="summary-title" className="sr-only">Resumen de {selectedVehicle?.nickname}</h2>
            <div className="filter-row" role="group" aria-label="Periodo del resumen">{([["all","Todo"],["month","Este mes"],["threeMonths","3 meses"],["year","Este año"],["custom","Personalizado"]] as [Filter,string][]).map(([value,label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</button>)}</div>
            {filter === "custom" && <div className="custom-range"><label>Desde<input type="date" value={customStart} max={customEnd || undefined} onChange={(event) => setCustomStart(event.target.value)} /></label><label>Hasta<input type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}
            <article className="kpi-card"><p>Consumo medio · {selectedVehicle?.nickname}</p><div className="kpi-value">{measurableFiltered.length ? formatNumber(totals.average, 2) : "—"}</div><span>L/100 km</span><div className="kpi-rule" /><small>Calculado sobre {formatNumber(totals.distance)} km</small></article>
            <div className="stat-grid"><article><span>Kilómetros</span><strong>{formatNumber(totals.distance)}</strong><small>km recorridos</small></article><article><span>Combustible</span><strong>{formatNumber(totals.fuel, 2)}</strong><small>litros calculables</small></article><article><span>Repostajes</span><strong>{filtered.length}</strong><small>en el periodo</small></article></div>
            <article className="chart-card"><div className="section-heading"><div><h2>Evolución</h2><p>Consumo de {selectedVehicle?.nickname}</p></div><span>L/100 km</span></div>{measurableFiltered.length ? <ConsumptionChart data={measurableFiltered} /> : <div className="chart-empty">Se necesitan dos repostajes para calcular el consumo.</div>}</article>
            <article className="last-card"><div className="section-heading"><h2>Último repostaje</h2></div>{lastRefuel ? <><div className="last-main"><div><time>{formatDate(lastRefuel.date, true)}</time><p>{formatNumber(lastRefuel.odometer)} km en el odómetro</p></div><strong>{formatNumber(lastRefuel.liters, 2)} L</strong></div><div className="last-stats"><span>{lastRefuel.measurable ? `${formatNumber(lastRefuel.distance)} km recorridos` : "Registro de referencia"}</span><span>{lastRefuel.measurable ? `${formatNumber(lastRefuel.consumption, 2)} L/100 km` : "Consumo pendiente"}</span></div></> : <p className="muted">Aún no hay repostajes.</p>}</article>
          </section>
        )}
      </main>

      {vehicles.length > 0 && <nav className="bottom-nav" aria-label="Navegación principal"><button className={tab === "records" ? "active" : ""} onClick={() => setTab("records")}><span className="nav-icon list-icon"><i/><i/><i/></span>Registros</button><button className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}><span className="nav-icon chart-icon"><i/><i/><i/></span>Resumen</button></nav>}

      {formOpen && <Sheet title={editing ? "Editar repostaje" : "Nuevo repostaje"} eyebrow="Depósito lleno" onClose={() => setFormOpen(false)}><form onSubmit={handleSubmit}><label>Vehículo<select required value={formVehicleId} onChange={(event) => setFormVehicleId(event.target.value)}>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.nickname} · {vehicle.plate}</option>)}</select></label><label>Fecha<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Kilometraje<div className="input-with-unit"><input inputMode="numeric" type="text" required placeholder="Ej. 23180" value={odometer} onChange={(event) => setOdometer(event.target.value)} /><span>km</span></div></label><label>Litros repostados<div className="input-with-unit"><input inputMode="decimal" type="text" required placeholder="Ej. 12,45" value={liters} onChange={(event) => setLiters(event.target.value)} /><span>L</span></div></label>{formError && <p className="form-error" role="alert">{formError}</p>}<button className="primary-button submit-button" type="submit">{editing ? "Guardar cambios" : "Guardar repostaje"}</button></form></Sheet>}

      {vehicleSheetOpen && <Sheet title={editingVehicle ? "Editar vehículo" : "Nuevo vehículo"} eyebrow="Tu garaje" onClose={() => setVehicleSheetOpen(false)}><form onSubmit={handleVehicle}><label>Apodo<input type="text" required maxLength={40} placeholder="Ej. Honda, Scooter…" value={vehicleNickname} onChange={(event) => setVehicleNickname(event.target.value)} /></label><label>Matrícula<input className="plate-input" type="text" required maxLength={12} autoCapitalize="characters" placeholder="Ej. 1234ABC" value={vehiclePlate} onChange={(event) => setVehiclePlate(event.target.value.toUpperCase())} /></label>{vehicleError && <p className="form-error" role="alert">{vehicleError}</p>}<button className="primary-button submit-button" type="submit" disabled={vehicleBusy}>{vehicleBusy ? "Guardando…" : editingVehicle ? "Guardar cambios" : "Añadir vehículo"}</button>{editingVehicle && <button type="button" className="delete-vehicle" onClick={() => handleDeleteVehicle(editingVehicle)}>Eliminar vehículo</button>}</form>{vehicles.length > 0 && !editingVehicle && <div className="garage-list"><h3>Mis vehículos</h3>{vehicles.map((vehicle) => <button key={vehicle.id} onClick={() => openVehicle(vehicle)}><span><strong>{vehicle.nickname}</strong><small>{vehicle.plate}</small></span><i>Editar</i></button>)}</div>}</Sheet>}
    </div>
  );
}

function Sheet({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="form-sheet" role="dialog" aria-modal="true" aria-label={title}><div className="sheet-handle"/><div className="form-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button className="close-button" onClick={onClose} aria-label="Cerrar">×</button></div>{children}</section></div>;
}

type AuthScreenProps = { mode: AuthMode; email: string; password: string; confirmPassword: string; busy: boolean; error: string; message: string; onEmail: (value: string) => void; onPassword: (value: string) => void; onConfirmPassword: (value: string) => void; onMode: (mode: AuthMode) => void; onSubmit: (event: FormEvent) => void };
function AuthScreen({ mode, email, password, confirmPassword, busy, error, message, onEmail, onPassword, onConfirmPassword, onMode, onSubmit }: AuthScreenProps) {
  const title = mode === "register" ? "Crear cuenta" : mode === "reset" ? "Recuperar acceso" : "Bienvenido";
  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span/></div><p className="eyebrow">Moto Consumo</p><h1>{title}</h1><p className="auth-description">{mode === "register" ? "Tus vehículos y repostajes estarán disponibles en todos tus dispositivos." : mode === "reset" ? "Te enviaremos un enlace para elegir una contraseña nueva." : "Accede a tus vehículos desde el móvil o el ordenador."}</p><form onSubmit={onSubmit}><label>Correo electrónico<input type="email" autoComplete="email" required value={email} onChange={(event) => onEmail(event.target.value)} placeholder="tu@correo.com" /></label>{mode !== "reset" && <label>Contraseña<input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={6} value={password} onChange={(event) => onPassword(event.target.value)} placeholder="Mínimo 6 caracteres" /></label>}{mode === "register" && <label>Repite la contraseña<input type="password" autoComplete="new-password" required minLength={6} value={confirmPassword} onChange={(event) => onConfirmPassword(event.target.value)} /></label>}{error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? "Espera…" : mode === "register" ? "Crear cuenta" : mode === "reset" ? "Enviar enlace" : "Iniciar sesión"}</button></form><div className="auth-links">{mode === "signin" && <button onClick={() => onMode("reset")}>He olvidado mi contraseña</button>}{mode === "signin" ? <p>¿No tienes cuenta? <button onClick={() => onMode("register")}>Crear cuenta</button></p> : <button onClick={() => onMode("signin")}>Volver a iniciar sesión</button>}</div></section></main>;
}

function ConsumptionChart({ data }: { data: CalculatedRefuel[] }) {
  const ordered = [...data].sort((a, b) => a.date.localeCompare(b.date) || a.odometer - b.odometer);
  const values = ordered.map((item) => item.consumption); const min = Math.min(...values) * .85; const max = Math.max(...values) * 1.1; const range = Math.max(max - min, 1);
  return <div className="chart" role="img" aria-label={`Evolución del consumo en ${ordered.length} repostajes`}><div className="chart-guides"><i/><i/><i/></div><div className="chart-bars">{ordered.map((item, index) => <div className="chart-column" key={item.id} title={`${formatDate(item.date)} · ${formatNumber(item.consumption, 2)} L/100 km`}><span className="chart-value">{formatNumber(item.consumption, 1)}</span><div className="chart-bar" style={{ height: `${24 + ((item.consumption - min) / range) * 76}%` }}/><time>{ordered.length <= 7 || index === 0 || index === ordered.length - 1 ? new Intl.DateTimeFormat("es-ES", { month: "short" }).format(parseLocalDate(item.date)) : ""}</time></div>)}</div></div>;
}
