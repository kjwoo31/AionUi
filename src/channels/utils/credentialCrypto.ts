/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Credential storage utilities
 * Uses Electron safeStorage API for OS-level encryption (DPAPI on Windows,
 * Keychain on macOS, libsecret on Linux). Falls back to Base64 encoding
 * when safeStorage is unavailable.
 */

import { safeStorage } from 'electron';

/**
 * Check if OS-level encryption is available
 */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/**
 * Encrypt a string value for storage
 * @param plaintext - The string to encrypt
 * @returns Encrypted string with prefix (enc: for safeStorage, b64: for fallback)
 */
export function encryptString(plaintext: string): string {
  if (!plaintext) return '';

  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(plaintext);
      return `enc:${encrypted.toString('base64')}`;
    }
  } catch (error) {
    console.warn('[CredentialStorage] safeStorage encryption failed, falling back to Base64:', error);
  }

  // Fallback: Base64 encoding (not cryptographically secure)
  try {
    const encoded = Buffer.from(plaintext, 'utf-8').toString('base64');
    return `b64:${encoded}`;
  } catch (error) {
    console.error('[CredentialStorage] Encoding failed:', error);
    return `plain:${plaintext}`;
  }
}

/**
 * Decrypt a previously encrypted string
 * @param encoded - The encrypted string (with enc:, b64:, or plain: prefix)
 * @returns The decrypted plaintext
 */
export function decryptString(encoded: string): string {
  if (!encoded) return '';

  // Handle plain: prefix
  if (encoded.startsWith('plain:')) {
    return encoded.slice(6);
  }

  // Handle enc: prefix (safeStorage encrypted)
  if (encoded.startsWith('enc:')) {
    try {
      const buffer = Buffer.from(encoded.slice(4), 'base64');
      return safeStorage.decryptString(buffer);
    } catch (error) {
      console.error('[CredentialStorage] safeStorage decryption failed:', error);
      return '';
    }
  }

  // Handle b64: prefix (Base64 fallback)
  if (encoded.startsWith('b64:')) {
    try {
      return Buffer.from(encoded.slice(4), 'base64').toString('utf-8');
    } catch (error) {
      console.error('[CredentialStorage] Base64 decoding failed:', error);
      return '';
    }
  }

  // Legacy: no prefix means it was stored before encoding was added
  // Return as-is for backward compatibility
  console.warn('[CredentialStorage] Found legacy unencoded value, returning as-is');
  return encoded;
}

/**
 * Encrypt credentials object
 * Only encrypts sensitive fields (token)
 */
export function encryptCredentials(credentials: { token?: string } | undefined): { token?: string } | undefined {
  if (!credentials) return undefined;

  return {
    ...credentials,
    token: credentials.token ? encryptString(credentials.token) : undefined,
  };
}

/**
 * Decrypt credentials object
 */
export function decryptCredentials(credentials: { token?: string } | undefined): { token?: string } | undefined {
  if (!credentials) return undefined;

  return {
    ...credentials,
    token: credentials.token ? decryptString(credentials.token) : undefined,
  };
}
