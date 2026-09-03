import { useEffect, useMemo, useState } from 'react';
import { useBattery } from './useBattery';
import { useNetworkInfo, shouldDeferHeavyUploads, type NetworkInfo } from './useNetworkInfo';

export interface MobileResourceState {
  deferUploads: boolean;
  reason: string | null;
  network: NetworkInfo;
  batteryLevel: number | null;
  lowPower: boolean;
  charging: boolean | null;
}

export function useMobileResourceState(): MobileResourceState {
  const battery = useBattery();
  const network = useNetworkInfo();
  const [override, setOverride] = useState<'auto' | 'force' | 'defer'>('auto');

  const state = useMemo<MobileResourceState>(() => {
    let defer = shouldDeferHeavyUploads(network);
    let reason: string | null = null;
    if (defer) {
      reason = !network.online
        ? 'offline'
        : network.saveData
          ? 'save-data'
          : network.effectiveType
            ? `slow-${network.effectiveType}`
            : null;
    }
    if (battery.lowPower) {
      defer = true;
      reason = 'low-battery';
    }
    if (override === 'force') {
      defer = false;
      reason = null;
    } else if (override === 'defer') {
      defer = true;
      reason = 'user';
    }
    return {
      deferUploads: defer,
      reason,
      network,
      batteryLevel: battery.level,
      lowPower: battery.lowPower,
      charging: battery.charging,
    };
  }, [battery.lowPower, battery.level, battery.charging, network, override]);

  useEffect(() => {
    (window as unknown as { __mobileState?: MobileResourceState; __setMobileOverride?: typeof setOverride }).__mobileState = state;
    (window as unknown as { __setMobileOverride?: typeof setOverride }).__setMobileOverride = setOverride;
  }, [state]);

  return state;
}

export function setMobileSyncOverride(next: 'auto' | 'force' | 'defer'): void {
  const setter = (window as unknown as { __setMobileOverride?: (n: 'auto' | 'force' | 'defer') => void }).__setMobileOverride;
  if (setter) setter(next);
}
