import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RealtimeClient } from '@supabase/realtime-js';
import { startRemoteStandIn } from './helpers/remote-stand-in.js';

// Exercise the actual locked transport, rather than reproducing its frame
// format in the assertions. Older releases defaulted to Phoenix v1; the current
// client defaults to v2. Both must work against our local device-test service.
for (const [name, options, expectedVsn] of [
  ['current default', {}, '2.0.0'],
  ['legacy v1', { vsn: '1.0.0' }, '1.0.0'],
]) {
  test(`remote stand-in acknowledges ${name} join, presence and heartbeat`, { timeout: 5000 }, async () => {
    const standIn = await startRemoteStandIn({ channel: true });
    const client = new RealtimeClient(`${standIn.url}/realtime/v1`, {
      params: { apikey: standIn.anonKey },
      timeout: 750,
      heartbeatIntervalMs: 60_000,
      reconnectAfterMs: () => 60_000,
      ...options,
    });
    try {
      const channel = client.channel(`user:${standIn.userId}`, {
        config: { private: true, presence: { key: standIn.deviceId, enabled: true } },
      }).on('broadcast', { event: 'new_call' }, () => {});
      await new Promise((resolve, reject) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
          if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) reject(new Error(`join: ${status}`));
        });
      });
      assert.equal(channel.state, 'joined');
      assert.equal(await channel.track({ device_id: standIn.deviceId }), 'ok');
      let heartbeatDeadline;
      try {
        const heartbeat = new Promise((resolve, reject) => {
          heartbeatDeadline = setTimeout(() => reject(new Error('heartbeat reply deadline exceeded')), 750);
          client.onHeartbeat((status) => {
            if (status === 'ok') resolve();
            if (status === 'timeout' || status === 'error') reject(new Error(`heartbeat: ${status}`));
          });
        });
        await client.sendHeartbeat();
        await heartbeat;
      } finally {
        clearTimeout(heartbeatDeadline);
      }
      assert.equal(standIn.heartbeatsAnswered, 1);
      const upgrade = standIn.requests.find((request) => request.method === 'UPGRADE');
      assert.equal(new URL(upgrade.url, standIn.url).searchParams.get('vsn'), expectedVsn);
    } finally {
      await client.removeAllChannels();
      client.disconnect();
      await standIn.close();
    }
  });
}
