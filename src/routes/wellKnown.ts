import { Hono } from 'hono';
import type { AppContext } from '../env';

export const wellKnown = new Hono<AppContext>();

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' };

wellKnown.get('/assetlinks.json', (c) => {
  const fingerprints = c.env.ANDROID_CERT_SHA256.split(',')
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);
  if (fingerprints.length === 0) return c.notFound();
  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: c.env.ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ];
  return c.body(JSON.stringify(body), 200, JSON_HEADERS);
});

wellKnown.get('/apple-app-site-association', (c) => {
  const body = {
    applinks: {
      details: [
        {
          appIDs: [c.env.APPLE_APP_ID],
          components: [
            { '/': '/api/*', exclude: true },
            { '/': '/.well-known/*', exclude: true },
            { '/': '/?????', comment: 'share code (5 chars, current)' },
            { '/': '/??????', comment: 'share code (6 chars, reserved)' },
          ],
        },
      ],
    },
  };
  return c.body(JSON.stringify(body), 200, JSON_HEADERS);
});
