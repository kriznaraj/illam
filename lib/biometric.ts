const CREDENTIAL_KEY_PREFIX = 'biometric_credential_';
const SESSION_UNLOCK_KEY = 'biometric_unlocked';

function credentialKey(userId: string): string {
  return `${CREDENTIAL_KEY_PREFIX}${userId}`;
}

export async function isBiometricAvailable(): Promise<boolean> {
  try {
    if (typeof window === 'undefined') return false;
    if (!window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function isBiometricRegistered(userId: string): boolean {
  try {
    return !!localStorage.getItem(credentialKey(userId));
  } catch {
    return false;
  }
}

export function isBiometricSessionUnlocked(): boolean {
  try {
    return sessionStorage.getItem(SESSION_UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSessionUnlocked(): void {
  try {
    sessionStorage.setItem(SESSION_UNLOCK_KEY, '1');
  } catch {
    // ignore
  }
}

export function clearSessionUnlock(): void {
  try {
    sessionStorage.removeItem(SESSION_UNLOCK_KEY);
  } catch {
    // ignore
  }
}

export async function registerBiometric(
  userId: string,
  userEmail: string,
): Promise<boolean> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userIdBuffer = new TextEncoder().encode(userId);

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'Illam',
          id: window.location.hostname,
        },
        user: {
          id: userIdBuffer,
          name: userEmail,
          displayName: userEmail,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!credential) return false;

    const credentialId = btoa(
      String.fromCharCode(...new Uint8Array(credential.rawId)),
    );
    localStorage.setItem(credentialKey(userId), credentialId);
    return true;
  } catch (err) {
    console.error('Biometric registration failed:', err);
    return false;
  }
}

export async function verifyBiometric(userId: string): Promise<boolean> {
  try {
    const stored = localStorage.getItem(credentialKey(userId));
    if (!stored) return false;

    const credentialIdBytes = Uint8Array.from(atob(stored), (c) =>
      c.charCodeAt(0),
    );
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            type: 'public-key',
            id: credentialIdBytes,
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    });

    return !!assertion;
  } catch (err) {
    console.error('Biometric verification failed:', err);
    return false;
  }
}

export function removeBiometric(userId: string): void {
  try {
    localStorage.removeItem(credentialKey(userId));
  } catch {
    // ignore
  }
}
