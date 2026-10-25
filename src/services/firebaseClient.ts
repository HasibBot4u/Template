import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  AuthenticatedUser,
  AuthErrorState,
  UserPreferences,
  UserRole,
} from '../types/sowveil';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on browser boot
async function testConnection() {
  if (typeof window === 'undefined') return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  reducedMotion: false,
  defaultSortOrder: 'name',
  preserveSearchOnModuleSwitch: false,
};

export function classifyFirebaseAuthError(error: unknown): NonNullable<AuthErrorState> {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  const rawMessage = error instanceof Error ? error.message : String(error);

  if (code === 'auth/popup-blocked') {
    return {
      code: 'popup-blocked',
      title: 'Sign-In Popup Blocked by Browser',
      message:
        'Your browser blocked the Google Sign-In popup window. Allow popups for this site in your browser address bar and try again.',
    };
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return {
      code: 'popup-cancelled',
      title: 'Sign-In Cancelled',
      message:
        'The Google Sign-In popup was closed before completing authentication. Click Sign in with Google whenever you are ready.',
    };
  }
  if (
    code === 'auth/user-token-expired' ||
    code === 'auth/invalid-user-token' ||
    code === 'auth/requires-recent-login'
  ) {
    return {
      code: 'invalid-session',
      title: 'Session Expired or Invalid',
      message: 'Your authentication token has expired. Please sign in again to refresh your session.',
    };
  }
  if (code === 'permission-denied' || rawMessage.toLowerCase().includes('insufficient permissions')) {
    return {
      code: 'permission-denied',
      title: 'Permission Denied by Security Rules',
      message:
        'Your account does not have permission to perform this action, or your email address is not verified.',
    };
  }
  if (code === 'auth/network-request-failed') {
    return {
      code: 'network-error',
      title: 'Network Connection Error',
      message: 'Could not reach Firebase Authentication servers. Check your network connection.',
    };
  }
  return {
    code: 'unknown',
    title: 'Authentication Error',
    message: rawMessage || 'An unexpected error occurred during Google Sign-In.',
  };
}

export async function signInWithGooglePopup(): Promise<{
  user: User | null;
  error: AuthErrorState;
}> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    if (!result.user.emailVerified) {
      return {
        user: null,
        error: {
          code: 'unverified-email',
          title: 'Verified Google Account Required',
          message:
            'Sowveil Studio security rules require a verified email address (email_verified == true).',
        },
      };
    }
    return { user: result.user, error: null };
  } catch (err) {
    return { user: null, error: classifyFirebaseAuthError(err) };
  }
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
}

export async function syncAndLoadAuthenticatedUser(
  fbUser: User
): Promise<{ profile: AuthenticatedUser; preferences: UserPreferences }> {
  const uid = fbUser.uid;
  const userPath = `users/${uid}`;
  const privatePath = `users/${uid}/private/info`;
  const adminPath = `admins/${uid}`;
  const now = new Date().toISOString();

  // Check if admin grant document exists in /admins/{uid}
  let adminGrantRole: UserRole | null = null;
  try {
    const adminSnap = await getDoc(doc(db, 'admins', uid));
    if (adminSnap.exists()) {
      const data = adminSnap.data();
      if (data.role === 'owner' || data.role === 'admin') {
        adminGrantRole = data.role;
      }
    }
  } catch {
    // Non-admin or not yet created
  }

  let existingProfile: AuthenticatedUser | null = null;
  let preferences: UserPreferences = DEFAULT_USER_PREFERENCES;

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      const data = snap.data();
      const storedRole: UserRole =
        adminGrantRole ||
        (data.role === 'owner' || data.role === 'admin' ? data.role : 'user');
      preferences = {
        ...DEFAULT_USER_PREFERENCES,
        ...(data.preferences || {}),
      };
      existingProfile = {
        uid,
        email: fbUser.email,
        emailVerified: fbUser.emailVerified,
        displayName: (data.displayName as string) || fbUser.displayName || 'Studio User',
        photoURL: (data.photoURL as string) || fbUser.photoURL || undefined,
        role: storedRole,
        status: (data.status as 'active' | 'suspended' | 'pending') || 'active',
        createdAt: (data.createdAt as string) || now,
        updatedAt: now,
      };

      // Update non-immutable fields allowed by firestore.rules
      await updateDoc(doc(db, 'users', uid), {
        displayName: existingProfile.displayName.slice(0, 120),
        ...(existingProfile.photoURL ? { photoURL: existingProfile.photoURL.slice(0, 500) } : {}),
        preferences,
        updatedAt: now,
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  if (!existingProfile) {
    // IMPORTANT: Never promote the first visitor automatically!
    // New profiles always initialize with role: 'user' unless already granted in /admins/{uid}.
    const initialRole: UserRole = adminGrantRole || 'user';
    const displayName = (fbUser.displayName || fbUser.email?.split('@')[0] || 'Studio User').slice(
      0,
      120
    );
    const photoURL = fbUser.photoURL ? fbUser.photoURL.slice(0, 500) : undefined;

    const createPayload: Record<string, unknown> = {
      uid,
      displayName,
      ...(photoURL ? { photoURL } : {}),
      role: initialRole,
      status: 'active',
      preferences: DEFAULT_USER_PREFERENCES,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await setDoc(doc(db, 'users', uid), createPayload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, userPath);
    }

    existingProfile = {
      uid,
      email: fbUser.email,
      emailVerified: fbUser.emailVerified,
      displayName,
      photoURL,
      role: initialRole,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
  }

  // Sync isolated PII record (/users/{uid}/private/info)
  if (fbUser.email) {
    try {
      const privSnap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
      if (!privSnap.exists()) {
        await setDoc(doc(db, 'users', uid, 'private', 'info'), {
          uid,
          email: fbUser.email.slice(0, 254),
          updatedAt: now,
        });
      } else {
        await updateDoc(doc(db, 'users', uid, 'private', 'info'), {
          email: fbUser.email.slice(0, 254),
          updatedAt: now,
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, privatePath);
    }
  }

  return { profile: existingProfile, preferences };
}
