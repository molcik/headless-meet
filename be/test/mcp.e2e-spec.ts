// First: the SDK client needs a global crypto on Node 18 too.
import '../src/mcp/webcrypto.polyfill';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  ChromectlService,
  QueueTimeoutError,
} from '../src/chromectl/chromectl.service';
import { ChromiumLauncher } from '../src/chromectl/chromium.launcher';
import { FakeChromiumLauncher } from './fake-chromium.launcher';

const A = 'abc-defg-hij';
const B = 'xyz-abcd-efg';

describe('MCP server (e2e, fake Chromium)', () => {
  let app: INestApplication;
  let launcher: FakeChromiumLauncher;
  let baseUrl: string;
  const clients: Client[] = [];

  beforeEach(async () => {
    launcher = new FakeChromiumLauncher();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ChromiumLauncher)
      .useValue(launcher)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await app.close();
  });

  async function connect(name: string): Promise<Client> {
    const client = new Client({ name, version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)),
    );
    clients.push(client);
    return client;
  }

  async function call(client: Client, name: string, args = {}) {
    return (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
      structuredContent: any;
    };
  }

  it('lists exactly join, leave and status, and names the guide', async () => {
    const client = await connect('lister');

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'join',
      'leave',
      'status',
    ]);
    const join = tools.find((tool) => tool.name === 'join');
    expect(join.inputSchema.required).toEqual(['meeting']);
    expect(join.annotations).toMatchObject({ destructiveHint: true });
    expect(client.getServerVersion()).toMatchObject({ name: 'headless-meet' });
    expect(client.getInstructions()).toContain('http://webcam.local/mcp/guide');
  });

  it('scenario 3: joins by link, status shows code, time and name', async () => {
    const client = await connect('petr');

    const joined = await call(client, 'join', {
      meeting: `https://meet.google.com/${A}?authuser=0`,
      requestedBy: 'Petr',
    });

    expect(joined.isError).toBeFalsy();
    expect(joined.structuredContent).toMatchObject({
      result: 'joined',
      session: { meetingCode: A, startedBy: 'Petr', source: 'mcp' },
      replaced: null,
    });
    expect(joined.content[0].text).toBe(
      `The camera is opening meeting ${A}. Someone in the meeting must admit 'Meeting Room'.`,
    );
    expect(launcher.launchedUrls).toEqual([`https://meet.google.com/${A}`]);

    const status = await call(client, 'status');
    expect(status.isError).toBeFalsy();
    expect(status.structuredContent).toMatchObject({
      state: 'in_meeting',
      meetingCode: A,
      startedBy: 'Petr',
      startedAt: joined.structuredContent.session.startedAt,
    });
    expect(status.content[0].text).toContain('started by Petr (mcp)');
  });

  it('scenario 4: refuses a busy camera, then switches with force', async () => {
    const jana = await connect('jana');
    const petr = await connect('petr');
    await call(jana, 'join', { meeting: A, requestedBy: 'Jana' });

    const refused = await call(petr, 'join', {
      meeting: B,
      requestedBy: 'Petr',
    });

    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({
      error: 'busy',
      current: { meetingCode: A, startedBy: 'Jana' },
    });
    expect(refused.content[0].text).toMatch(
      new RegExp(
        `^The camera is in meeting ${A} since .+Z, started by Jana \\(mcp\\)\\. Ask the user`,
      ),
    );

    const forced = await call(petr, 'join', {
      meeting: B,
      force: true,
      requestedBy: 'Petr',
    });

    expect(forced.isError).toBeFalsy();
    expect(forced.structuredContent).toMatchObject({
      result: 'joined',
      session: { meetingCode: B, startedBy: 'Petr' },
      replaced: { meetingCode: A },
    });
    expect(forced.content[0].text).toContain(`It left meeting ${A} first.`);
  });

  it('scenario 5 and criterion 5: status and leave when idle', async () => {
    const client = await connect('anyone');

    const status = await call(client, 'status');
    expect(status.structuredContent).toEqual({ state: 'idle' });
    expect(status.content[0].text).toBe('The camera is idle.');

    const left = await call(client, 'leave');
    expect(left.isError).toBeFalsy();
    expect(left.structuredContent).toEqual({ result: 'was_idle' });
    expect(left.content[0].text).toBe('The camera was idle. Nothing to do.');
  });

  it('leave with another meeting is refused, with the right meeting it leaves', async () => {
    const client = await connect('jana');
    await call(client, 'join', { meeting: B });

    const refused = await call(client, 'leave', { meeting: A });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({
      error: 'not_in_that_meeting',
      current: { meetingCode: B },
    });

    const left = await call(client, 'leave', { meeting: B });
    expect(left.structuredContent).toMatchObject({
      result: 'left',
      session: { meetingCode: B },
    });
    expect((await call(client, 'status')).structuredContent).toEqual({
      state: 'idle',
    });
  });

  it('same meeting twice without force is safe', async () => {
    const client = await connect('automation');
    await call(client, 'join', { meeting: A });

    const again = await call(client, 'join', { meeting: A });

    expect(again.isError).toBeFalsy();
    expect(again.structuredContent).toMatchObject({
      result: 'already_in_meeting',
    });
    expect(launcher.launchedUrls).toHaveLength(1);
  });

  it.each(['$(reboot)', 'https://evil.com/abc-defg-hij', '--headless'])(
    'refuses invalid meeting %p and opens nothing',
    async (meeting) => {
      const client = await connect('attacker');

      const refused = await call(client, 'join', { meeting });

      expect(refused.isError).toBe(true);
      expect(refused.structuredContent).toMatchObject({
        error: 'invalid_meeting',
      });
      expect(refused.content[0].text).toMatch(/^Not a Google Meet meeting: /);
      expect(launcher.launchedUrls).toHaveLength(0);
      expect(launcher.stopAllCalls).toBe(0);
    },
  );

  it('reports a launch failure and stays idle', async () => {
    const client = await connect('petr');
    launcher.failNextLaunch = new Error(
      'spawn /usr/bin/chromium-browser ENOENT',
    );

    const failed = await call(client, 'join', { meeting: A });

    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toMatchObject({ error: 'launch_failed' });
    expect(failed.content[0].text).toBe(
      'The camera could not start Chromium: spawn /usr/bin/chromium-browser ENOENT.',
    );
    expect((await call(client, 'status')).structuredContent).toEqual({
      state: 'idle',
    });
  });

  it('reports Chromium that exits right after the start, and stays idle', async () => {
    const client = await connect('petr');
    launcher.exitAtStartNextLaunch = true;

    const failed = await call(client, 'join', { meeting: A });

    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toMatchObject({ error: 'launch_failed' });
    expect(failed.content[0].text).toBe(
      'The camera could not start Chromium: Chromium exited right after the start (code=1, signal=null).',
    );
    expect((await call(client, 'status')).structuredContent).toEqual({
      state: 'idle',
    });
  });

  it('refuses a call that waited too long for other calls', async () => {
    const client = await connect('petr');
    const service = app.get(ChromectlService);
    jest
      .spyOn(service, 'join')
      .mockRejectedValueOnce(new QueueTimeoutError(26_000));
    jest
      .spyOn(service, 'leave')
      .mockRejectedValueOnce(new QueueTimeoutError(26_000));

    const join = await call(client, 'join', { meeting: A, force: true });
    const leave = await call(client, 'leave');

    for (const refused of [join, leave]) {
      expect(refused.isError).toBe(true);
      expect(refused.structuredContent).toEqual({ error: 'queue_timeout' });
      expect(refused.content[0].text).toBe(
        'The camera is busy with other requests. Nothing was changed. Try again in a minute.',
      );
    }
  });

  describe('web UI REST endpoints', () => {
    it('GET /api/join switches the camera and status shows source web', async () => {
      const client = await connect('jana');
      await call(client, 'join', { meeting: B, requestedBy: 'Jana' });

      const response = await request(app.getHttpServer()).get(`/api/join/${A}`);

      expect(response.status).toBe(200);
      expect(response.text).toBe('Joining meeting...');
      expect((await call(client, 'status')).structuredContent).toMatchObject({
        state: 'in_meeting',
        meetingCode: A,
        source: 'web',
        startedBy: null,
      });
    });

    it('GET /api/join accepts the codes people type today', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/join/ABCDEFGHIJ',
      );
      expect(response.status).toBe(200);
      expect(launcher.launchedUrls).toEqual([`https://meet.google.com/${A}`]);
    });

    it('GET /api/join with invalid input returns 400', async () => {
      const response = await request(app.getHttpServer()).get(
        `/api/join/${encodeURIComponent('x;reboot')}`,
      );
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/^Not a Google Meet meeting/);
      expect(launcher.launchedUrls).toHaveLength(0);
    });

    it('GET /api/join returns 500 when Chromium cannot start', async () => {
      launcher.failNextLaunch = new Error('ENOENT');
      const response = await request(app.getHttpServer()).get(`/api/join/${A}`);
      expect(response.status).toBe(500);
    });

    it('GET /api/join returns 500 when Chromium exits right after the start', async () => {
      launcher.exitAtStartNextLaunch = true;
      const response = await request(app.getHttpServer()).get(`/api/join/${A}`);
      expect(response.status).toBe(500);
    });

    it('GET /api/join and /api/end return 503 when the call waited too long', async () => {
      const service = app.get(ChromectlService);
      jest
        .spyOn(service, 'join')
        .mockRejectedValueOnce(new QueueTimeoutError(26_000));
      jest
        .spyOn(service, 'leave')
        .mockRejectedValueOnce(new QueueTimeoutError(26_000));

      const join = await request(app.getHttpServer()).get(`/api/join/${A}`);
      const end = await request(app.getHttpServer()).get('/api/end');

      expect(join.status).toBe(503);
      expect(end.status).toBe(503);
    });

    it('GET /api/end leaves and returns the old string', async () => {
      await request(app.getHttpServer()).get(`/api/join/${A}`);

      const response = await request(app.getHttpServer()).get('/api/end');

      expect(response.status).toBe(200);
      expect(response.text).toBe('Shuting down meeting...');
      const client = await connect('anyone');
      expect((await call(client, 'status')).structuredContent).toEqual({
        state: 'idle',
      });
    });
  });

  describe('other HTTP endpoints', () => {
    it.each(['get', 'delete'] as const)(
      '%s /mcp returns 405',
      async (method) => {
        const response = await request(app.getHttpServer())[method]('/mcp');
        expect(response.status).toBe(405);
        expect(response.body).toEqual({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed.' },
          id: null,
        });
      },
    );

    it('GET /mcp/guide returns the guide as text/plain', async () => {
      const response = await request(app.getHttpServer()).get('/mcp/guide');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe(
        'text/plain; charset=utf-8',
      );
      expect(response.text).toContain('claude mcp add');
    });

    it('POST /mcp answers a plain JSON-RPC tools/list (curl check from the guide)', async () => {
      const response = await request(app.getHttpServer())
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      expect(response.status).toBe(200);
      expect(response.body.result.tools).toHaveLength(3);
    });
  });
});
