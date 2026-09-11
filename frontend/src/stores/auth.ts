import { createContext, useContext } from 'react';

export interface User {
  id: number;
  telegram_id: number;
  username: string;
  balance: number;
  frozen_balance: number;
  available: number;
  ref_code: string;
  deposit_address?: string;
  withdraw_address?: string;
  pin_set: boolean;
  auto_safe_percent: number;
}

export interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  onboardingDone: boolean;
  login: (initData: string, refCode?: string) => Promise<void>;
  demoLogin: (id: number, name?: string, ref?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setOnboardingDone: () => void;
  showToast: (msg: string) => void;
  toast: string | null;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null, token: null, loading: true, onboardingDone: false,
  login: async () => {}, demoLogin: async () => {}, logout: () => {},
  refreshUser: async () => {}, setOnboardingDone: () => {},
  showToast: () => {}, toast: null
});

export const useAuth = () => useContext(AuthContext);
