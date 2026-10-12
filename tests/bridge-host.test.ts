import { afterEach, expect, it } from 'vitest';
import { houseBridge as hostBridge, type HouseStatus } from '@agentshouse/app-bridge';
import { createHouseBridgeTestHost } from '@agentshouse/app-bridge/test-host';
import { houseBridge, type Runtime } from '../src/data/house';

afterEach(() => { Reflect.deleteProperty(globalThis, 'houseBridge'); });

it('uses the official ready bridge and runtime with only the bridge global', async () => {
  const status: HouseStatus = {
    app: null, preferences: { roomRef: 'r_preferences', path: 'preferences.md' },
    runtime: 'ready', credential: { state: 'held', expiresAt: 123 },
    sync: null, refusal: null, loss: null, analytics: { measures: true, choice: null },
    serviceMode: 'open', offline: false,
  };
  const host = createHouseBridgeTestHost({ address: '/test', status });
  const bridge = houseBridge();
  expect(bridge).toBe(hostBridge());
  expect(bridge).toBe(Reflect.get(globalThis, 'houseBridge'));
  expect(Object.hasOwn(globalThis, 'houseRuntime')).toBe(false);
  const client = {} as Runtime;
  host.attachRuntime(client);
  expect(await bridge.runtime).toBe(client);
  expect(houseBridge()).toBe(bridge);
  expect(host.tabs).toEqual([{ title: 'messenger-b' }]);
  await Promise.resolve();
  expect(bridge.address()).toBe('/test');
  expect(bridge.status()).toEqual(status);
  bridge.analyticsConsent('decline');
  await Promise.resolve();
  expect(host.consents).toEqual(['decline']);
  expect(bridge.status()?.analytics.choice).toBe('decline');
});
