import { useEffect, useState } from 'react';

export interface BatteryState {
  supported: boolean;
  level: number | null;
  charging: boolean | null;
  chargingTime: number | null;
  dischargingTime: number | null;
  lowPower: boolean;
}

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}

function isLow(level: number | null, charging: boolean | null): boolean {
  if (charging) return false;
  if (level === null) return false;
  return level < 0.2;
}

export function useBattery(): BatteryState {
  const [state, setState] = useState<BatteryState>({
    supported: false,
    level: null,
    charging: null,
    chargingTime: null,
    dischargingTime: null,
    lowPower: false,
  });

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    if (typeof nav.getBattery !== 'function') return;
    let mounted = true;
    let battery: BatteryManager | null = null;
    nav.getBattery().then((b) => {
      if (!mounted) return;
      battery = b;
      const update = () => {
        setState({
          supported: true,
          level: b.level,
          charging: b.charging,
          chargingTime: b.chargingTime,
          dischargingTime: b.dischargingTime,
          lowPower: isLow(b.level, b.charging),
        });
      };
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    });
    return () => {
      mounted = false;
      if (battery) {
        battery.removeEventListener('levelchange', () => {});
        battery.removeEventListener('chargingchange', () => {});
      }
    };
  }, []);

  return state;
}
