import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { initLiff } from "../lib/liff";
import { authenticateWithLine } from "../lib/auth";
import type { UserDoc } from "../types";

interface AuthState {
  /** Firebase auth user */
  firebaseUser: FirebaseUser | null;
  /** Firestore user document */
  userDoc: UserDoc | null;
  /** True while LIFF init + auth flow is in progress */
  loading: boolean;
  /** Error message if auth failed */
  error: string | null;
  /** Re-run auth flow */
  retry: () => void;
}

const AuthContext = createContext<AuthState>({
  firebaseUser: null,
  userDoc: null,
  loading: true,
  error: null,
  retry: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runAuth = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Step 1: Initialize LIFF
      await initLiff();

      // Step 2: Authenticate with LINE → Firebase
      await authenticateWithLine();
    } catch (err) {
      const message = err instanceof Error ? err.message : "認証に失敗しました";
      setError(message);
      setLoading(false);
    }
  }, []);

  // Listen for Firebase auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      if (user) {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  // Start auth flow on mount
  useEffect(() => {
    runAuth();
  }, [runAuth]);

  // Subscribe to user document when authenticated
  useEffect(() => {
    if (!firebaseUser) {
      setUserDoc(null);
      return;
    }

    const userRef = doc(db, "users", firebaseUser.uid);
    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setUserDoc(snapshot.data() as UserDoc);
        } else {
          setUserDoc(null);
        }
      },
      (err) => {
        console.error("Failed to listen to user doc:", err);
      }
    );

    return unsubscribe;
  }, [firebaseUser]);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userDoc,
        loading,
        error,
        retry: runAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
