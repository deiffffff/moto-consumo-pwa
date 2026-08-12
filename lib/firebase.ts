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

export type Refuel = {
  id: string;
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

function refuelsCollection(userId: string) {
  return collection(db, "users", userId, "refuels");
}

function isRefuel(value: unknown): value is Omit<Refuel, "id"> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.date === "string"
    && typeof record.odometer === "number"
    && typeof record.liters === "number";
}

export function subscribeToRefuels(
  userId: string,
  onData: (refuels: Refuel[], pendingWrites: boolean, fromCache: boolean) => void,
  onError: () => void,
) {
  return onSnapshot(
    refuelsCollection(userId),
    { includeMetadataChanges: true },
    (snapshot) => {
      const refuels = snapshot.docs.flatMap((snapshotDoc) => {
        const data = snapshotDoc.data();
        return isRefuel(data) ? [{ id: snapshotDoc.id, ...data }] : [];
      });
      onData(refuels, snapshot.metadata.hasPendingWrites, snapshot.metadata.fromCache);
    },
    onError,
  );
}

export async function saveCloudRefuel(userId: string, refuel: Refuel, isNew: boolean) {
  const target = doc(refuelsCollection(userId), refuel.id);
  await setDoc(target, {
    date: refuel.date,
    odometer: refuel.odometer,
    liters: refuel.liters,
    updatedAt: serverTimestamp(),
    ...(isNew ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true });
}

export async function deleteCloudRefuel(userId: string, refuelId: string) {
  await deleteDoc(doc(refuelsCollection(userId), refuelId));
}

export async function migrateRefuels(userId: string, refuels: Refuel[]) {
  await Promise.all(refuels.map((refuel) => setDoc(doc(refuelsCollection(userId), refuel.id), {
    date: refuel.date,
    odometer: refuel.odometer,
    liters: refuel.liters,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })));
}
