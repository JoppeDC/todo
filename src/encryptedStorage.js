const STORAGE_KEY = 'little-list.encrypted-todos.v1'
const ITERATIONS = 310_000

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes))
}

function base64ToBytes(value) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function deriveKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function hasSavedTodos() {
  return localStorage.getItem(STORAGE_KEY) !== null
}

export async function unlockTodos(passphrase) {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (!saved) {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    return { todos: [], key: await deriveKey(passphrase, salt), salt }
  }

  try {
    const { salt, iv, ciphertext } = JSON.parse(saved)
    const saltBytes = base64ToBytes(salt)
    const key = await deriveKey(passphrase, saltBytes)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext))
    const todos = JSON.parse(new TextDecoder().decode(decrypted))
    if (!Array.isArray(todos)) throw new Error('Invalid todo data')
    return { todos, key, salt: saltBytes }
  } catch {
    throw new Error('That passphrase could not unlock this list.')
  }
}

export async function saveTodos(todos, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(todos)))
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  }))
}

export function forgetTodos() {
  localStorage.removeItem(STORAGE_KEY)
}
