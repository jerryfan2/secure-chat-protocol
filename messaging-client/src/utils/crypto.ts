import { openDB } from 'idb';
import { type UserKeyRecord } from '../models/models';
import { httpService } from '../api/httpService';

const DB_NAME = 'UserKeyStore';
const STORE_NAME = 'keys';

export async function getPersistentKeyPair(userId: number): Promise<UserKeyRecord> {
  const db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('user_active', ['userId', 'isActive']);
      }
    },
  });

  const savedKeys = await getActiveKey(db, userId);
  if (savedKeys) return savedKeys;

  const keyPair = await window.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"]
  );
  const publicKey = await exportPublicKey(keyPair.publicKey);
  try {
    const serverData = await httpService.uploadKey(userId, publicKey);
    const dataToSave: UserKeyRecord = {
      id: serverData.id,
      userId: userId,
      keyPair: keyPair,
      isActive: serverData.is_active ? 1 : 0,
      createdAt: new Date(serverData.creation_time)
    };
    await db.put(STORE_NAME, dataToSave);
    return dataToSave;
  } catch (error) {
    console.error("Failed to register key with server", error);
    throw error;
  }
}

export async function deriveSharedSecret(myPrivateKey: CryptoKey, theirPublicKeyRaw: ArrayBuffer) {
  const theirPublicKey = await window.crypto.subtle.importKey(
    "raw",
    theirPublicKeyRaw,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );

  return await window.crypto.subtle.deriveKey(
    {
      name: "ECDH",
      public: theirPublicKey,
    },
    myPrivateKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<number[]> {
  const exported = await window.crypto.subtle.exportKey("raw", key);
  return Array.from(new Uint8Array(exported));
}

export async function encryptData(text: string, key: CryptoKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    data
  );

  return {
    ciphertext: Array.from(new Uint8Array(encrypted)),
    iv: Array.from(iv)
  };
}

export async function decryptData(ciphertext: number[], iv: number[], key: CryptoKey) {
  const decoder = new TextDecoder();
  
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    new Uint8Array(ciphertext)
  );

  return decoder.decode(decrypted);
}

async function getActiveKey(db: any, userId: number): Promise<UserKeyRecord | null> {
  const record = await db.getFromIndex(STORE_NAME, 'user_active', [userId, 1]);
  return record || null;
}