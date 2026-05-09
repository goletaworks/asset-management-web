'use strict';

const { startTestServer } = require('../helpers/server');

const MALICIOUS_VALUES = [
  '../etc/passwd',
  '..\\windows\\system32',
  'foo/bar',
  'foo\x00.txt',
  '',
  'A'.repeat(300)
];

const LEVELS = {
  READ_ONLY: { permissions: 'Read Only', admin: 'No' },
  READ_EDIT: { permissions: 'Read and Edit', admin: 'No' },
  READ_EDIT_GI: { permissions: 'Read and Edit, including General Info, and Add Infrastructure', admin: 'No' },
  FULL_ADMIN: { permissions: 'Full Admin', admin: 'Yes' }
};

function token(ctx, level) {
  return ctx.signToken({
    name: 'Path Test',
    email: `${level.toLowerCase()}@ec.gc.ca`,
    ...LEVELS[level]
  });
}

// Each case is a function that builds an inject() request given:
//   (badValue) -> { method, url, payload?, headers?, omitField? }
// All cases use the highest privilege level so the 400 reply must come from
// the path-segment validator, not a permission gate.
const CASES = [
  {
    name: 'POST /api/nuke/delete-company body.companyName',
    level: 'FULL_ADMIN',
    build: (bad) => ({
      method: 'POST',
      url: '/api/nuke/delete-company',
      payload: { companyName: bad }
    })
  },
  {
    name: 'POST /api/nuke/delete-location body.companyName',
    level: 'FULL_ADMIN',
    build: (bad) => ({
      method: 'POST',
      url: '/api/nuke/delete-location',
      payload: { companyName: bad, locationName: 'Loc' }
    })
  },
  {
    name: 'POST /api/nuke/delete-asset-type body.assetTypeName',
    level: 'FULL_ADMIN',
    build: (bad) => ({
      method: 'POST',
      url: '/api/nuke/delete-asset-type',
      payload: { companyName: 'Co', locationName: 'Loc', assetTypeName: bad }
    })
  },
  {
    name: 'DELETE /api/stations/:company/:location/:stationId via location',
    level: 'READ_EDIT_GI',
    build: (bad) => ({
      method: 'DELETE',
      url: `/api/stations/Co/${encodeURIComponent(bad)}/123`
    }),
    skipFor: (bad) => bad === '',  // empty path segment is unreachable in URL
    // For URL params, find-my-way refuses to route segments ≥100 chars and
    // returns 404 before our handler runs. That's also a valid rejection.
    acceptStatuses: [400, 404]
  },
  {
    name: 'POST /api/lookups/company body.name',
    level: 'READ_EDIT_GI',
    build: (bad) => ({
      method: 'POST',
      url: '/api/lookups/company',
      payload: { name: bad, active: true }
    })
  },
  {
    name: 'POST /api/lookups/location body.location',
    level: 'READ_EDIT_GI',
    build: (bad) => ({
      method: 'POST',
      url: '/api/lookups/location',
      payload: { location: bad, company: 'Co' }
    })
  },
  {
    name: 'POST /api/lookups/asset-type body.assetType',
    level: 'READ_EDIT_GI',
    build: (bad) => ({
      method: 'POST',
      url: '/api/lookups/asset-type',
      payload: { assetType: bad, company: 'Co', location: 'Loc' }
    })
  },
  {
    name: 'POST /api/excel/funding-settings body.company',
    level: 'READ_EDIT_GI',
    build: (bad) => ({
      method: 'POST',
      url: '/api/excel/funding-settings',
      payload: { company: bad, location: 'Loc', settings: {} }
    })
  },
  {
    name: 'GET /api/photos/structure ?siteName',
    level: 'READ_ONLY',
    build: (bad) => ({
      method: 'GET',
      url: `/api/photos/structure?siteName=${encodeURIComponent(bad)}&stationId=123`
    })
  },
  {
    name: 'DELETE /api/photos/file body.photoPath (segment with traversal)',
    level: 'READ_EDIT',
    build: (bad) => ({
      method: 'DELETE',
      url: '/api/photos/file',
      payload: { siteName: 'Site', stationId: '123', photoPath: bad }
    }),
    // photoPath is a relative path so foo/bar is allowed; only traversal,
    // null bytes, and empty are rejected.
    expectAcceptForBenignSlash: true
  }
];

describe('Path-component sanitization rejects malicious values', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  for (const c of CASES) {
    describe(c.name, () => {
      for (const bad of MALICIOUS_VALUES) {
        // photoPath legitimately allows '/'; skip 'foo/bar' for that case.
        if (c.expectAcceptForBenignSlash && bad === 'foo/bar') continue;
        if (c.skipFor && c.skipFor(bad)) continue;
        test(`rejects ${JSON.stringify(bad)} → 400`, async () => {
          const req = {
            ...c.build(bad),
            headers: { authorization: `Bearer ${token(ctx, c.level)}` }
          };
          const res = await ctx.fastify.inject(req);
          const accepted = c.acceptStatuses || [400];
          expect(accepted).toContain(res.statusCode);
        });
      }

      test('benign value → not 400', async () => {
        const req = {
          ...c.build('AcmeInc'),
          headers: { authorization: `Bearer ${token(ctx, c.level)}` }
        };
        const res = await ctx.fastify.inject(req);
        // The handler may go on to fail with 404/500 from the underlying logic
        // (no such company etc). Just make sure the validator did not 400.
        expect(res.statusCode).not.toBe(400);
      });
    });
  }
});
