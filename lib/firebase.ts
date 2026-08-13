import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  Firestore,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

export type Vehicle = {
  id: string;
  nickname: string;
  plate: string;
  initialOdometer: number | null;
};

export type Refuel = {
  id: string;
  vehicleId?: string;
  date: string;
  odometer: number;
  liters: number;
};

const firebaseConfig = {
  apiKey: "AIzaSyCQt9-jaFArTo5VixDl22ydGaMzZdK0gjY",
  authDomain: "moto-consumo.firebaseapp.com",
  projectId: "moto-consumo",
  storageBucket: "moto-consumo.firebasestorage.app",
  messagingSenderId: "407068923300",
  appId: "1:407068923300:web:0ec831c941d5cddc4ddd31",
  measurementId: "G-7C48XCJFDP",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

let firestore: Firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  firestore = getFirestore(app);
}
export const db = firestore;

const userCollection = (userId: string, name: "refuels" | "vehicles") =>
  collection(db, "users", userId, name);

function isRefuel(value: unknown): value is Omit<Refuel, "id"> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.date === "string"
    && typeof record.odometer === "number"
    && typeof record.liters === "number"
    && (record.vehicleId === undefined || typeof record.vehicleId === "string");
}

function isVehicle(value: unknown): value is Omit<Vehicle, "id"> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.nickname === "string"
    && typeof record.plate === "string"
    && (record.initialOdometer === null || typeof record.initialOdometer === "number");
}

export function subscribeToRefuels(userId: string, onData: (items: Refuel[], pending: boolean, cached: boolean) => void, onError: () => void) {
  return onSnapshot(userCollection(userId, "refuels"), { includeMetadataChanges: true }, (snapshot) => {
    const items = snapshot.docs.flatMap((entry) => isRefuel(entry.data()) ? [{ id: entry.id, ...entry.data() } as Refuel] : []);
    onData(items, snapshot.metadata.hasPendingWrites, snapshot.metadata.fromCache);
  }, onError);
}

export function subscribeToVehicles(userId: string, onData: (items: Vehicle[]) => void, onError: () => void) {
  return onSnapshot(userCollection(userId, "vehicles"), (snapshot) => {
    const items = snapshot.docs.flatMap((entry) => isVehicle(entry.data()) ? [{ id: entry.id, ...entry.data() } as Vehicle] : []);
    onData(items.sort((a, b) => a.nickname.localeCompare(b.nickname, "es")));
  }, onError);
}

export async function saveCloudRefuel(userId: string, refuel: Required<Refuel>, isNew: boolean) {
  await setDoc(doc(userCollection(userId, "refuels"), refuel.id), {
    vehicleId: refuel.vehicleId,
    date: refuel.date,
    odometer: refuel.odometer,
    liters: refuel.liters,
    updatedAt: serverTimestamp(),
    ...(isNew ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true });
}

export async function deleteCloudRefuel(userId: string, refuelId: string) {
  await deleteDoc(doc(userCollection(userId, "refuels"), refuelId));
}

export async function saveVehicle(userId: string, vehicle: Vehicle, isNew: boolean) {
  await setDoc(doc(userCollection(userId, "vehicles"), vehicle.id), {
    nickname: vehicle.nickname,
    plate: vehicle.plate,
    initialOdometer: vehicle.initialOdometer,
    updatedAt: serverTimestamp(),
    ...(isNew ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true });
}

export async function deleteVehicle(userId: string, vehicleId: string) {
  await deleteDoc(doc(userCollection(userId, "vehicles"), vehicleId));
}

export async function assignRefuelsToVehicle(userId: string, vehicleId: string, refuels: Refuel[]) {
  await Promise.all(refuels.map((refuel) => setDoc(doc(userCollection(userId, "refuels"), refuel.id), {
    vehicleId,
    date: refuel.date,
    odometer: refuel.odometer,
    liters: refuel.liters,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })));
}

export async function migrateRefuels(userId: string, vehicleId: string, refuels: Refuel[]) {
  return assignRefuelsToVehicle(userId, vehicleId, refuels);
}
