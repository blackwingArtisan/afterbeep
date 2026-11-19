import { createContext, useContext } from 'react';
import type { Business } from '../../domain/types';

export interface MachineState {
  business: Business | null;
  newCount: number;
  /** Re-reads the message counter, e.g. after a new call or a booking. */
  refresh: () => Promise<void>;
  /** Replaces the business after the owner changes it, e.g. a new greeting. */
  setBusiness: (business: Business) => void;
}

export const MachineContext = createContext<MachineState>({ business: null, newCount: 0, refresh: async () => {}, setBusiness: () => {} });

export function useMachine(): MachineState {
  return useContext(MachineContext);
}

export function useTitle(title: string) {
  if (typeof document !== 'undefined') document.title = title ? `${title} | AfterBeep` : 'AfterBeep';
}
