// Clientes HTTP do provedor (PSC, OAuth 2.0 + PKCE, API v0), da ACT (RFC 3161) e da LCR contra o SIMULADOR servido
// num HTTP local (127.0.0.1, porta livre): o mesmo contrato do provedor de verdade, só com hashes no corpo; 5xx, recusa
// de conexão e tempo esgotado viram "indisponível" (regra 5); a resposta 4xx volta para a conferência recusar.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  conferirAssinaturaHash,
  conferirAssinaturas,
  conferirCarimbo,
  conferirToken,
  CPF_SINTETICO_SESSAO,
  conferirLcr,
  desafioDe,
  gerarPkce,
  lerRespostaCarimbo,
  pedidoCarimbo,
} from '@sgh/dominio-documento';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buscadorLcrHttp, clienteActHttp, clientePscHttp, ErroIndisponivel } from './clientes.js';
import { CLIENT_ID_SIMULADOR, LCR_SIMULADOR, SimuladorIcp } from './simulador.js';

const SEGREDO = 'segredo-sintetico-do-cofre';
const RETORNO = '/api/documento/assinatura/retorno';
const sim = new SimuladorIcp(async () => SEGREDO);
let servidor: Server;
let base = '';
const recebidos: string[] = [];

const corpo = (req: import('node:http').IncomingMessage) =>
  new Promise<Buffer>((ok) => {
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => partes.push(c));
    req.on('end', () => ok(Buffer.concat(partes)));
  });

beforeAll(async () => {
  servidor = createServer(async (req, res) => {
    const b = await corpo(req);
    recebidos.push(`${req.method} ${req.url} ${b.toString('utf8')}`);
    const json = (x: unknown, s = 200) => {
      res.writeHead(s, { 'content-type': 'application/json' });
      res.end(JSON.stringify(x));
    };
    const cfg = { uriBase: `${base}/v0`, clientId: CLIENT_ID_SIMULADOR, retorno: RETORNO };
    const token = String(req.headers['authorization'] ?? '').replace(/^Bearer /, '');
    try {
      if (req.url === '/v0/oauth/token') {
        const f = new URLSearchParams(b.toString('utf8'));
        const r = await sim.psc.trocarCodigo(
          { ...cfg, clientId: f.get('client_id') ?? '' },
          {
            codigo: f.get('code') ?? '',
            verificador: f.get('code_verifier') ?? '',
            segredo: f.get('client_secret') ?? '',
          },
        );
        return json(r, 'error' in (r as object) ? 400 : 200);
      }
      if (req.url === '/v0/oauth/certificate-discovery')
        return json(await sim.psc.descobrirCertificados(cfg, token));
      if (req.url === '/v0/oauth/signature') {
        const x = JSON.parse(b.toString('utf8')) as {
          certificate_alias: string;
          hashes: { id: string; hash: string }[];
        };
        const itens = x.hashes.map((h) => ({
          id: h.id,
          alias: 'a',
          hashHex: Buffer.from(h.hash, 'base64').toString('hex'),
        }));
        return json(await sim.psc.assinar(cfg, token, itens, x.certificate_alias));
      }
      if (req.url === '/v0/oauth/authorize') return json({}, 200);
      if (req.url === '/act') {
        res.writeHead(200, { 'content-type': 'application/timestamp-reply' });
        return res.end(Buffer.from(await sim.carimbo.carimbar(new Uint8Array(b))));
      }
      if (req.url === '/lcr.crl') {
        res.writeHead(200);
        return res.end(Buffer.from(await sim.lcr.buscar(LCR_SIMULADOR)));
      }
      if (req.url?.startsWith('/quebrado')) return json({ erro: 'fora' }, 503);
      json({}, 404);
    } catch {
      json({}, 503);
    }
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

describe('provedor em nuvem pelo HTTP (DOC-ICP-17.01, item 6.4)', () => {
  it('troca o código (PKCE e o segredo), descobre o certificado e assina só o hash', async () => {
    const cfg = { uriBase: `${base}/v0`, clientId: CLIENT_ID_SIMULADOR, retorno: RETORNO };
    const pkce = gerarPkce();
    const volta = sim.autorizar(
      {
        response_type: 'code',
        client_id: CLIENT_ID_SIMULADOR,
        redirect_uri: RETORNO,
        scope: 'single_signature',
        state: 'e'.repeat(43),
        code_challenge: desafioDe(pkce.verificador),
        code_challenge_method: 'S256',
      },
      CPF_SINTETICO_SESSAO,
    );
    const codigo = new URL(volta, 'http://x').searchParams.get('code')!;
    // Verificador errado: o provedor recusa (4xx volta como veio).
    const errado = await clientePscHttp.trocarCodigo(cfg, {
      codigo: 'nao-existe',
      verificador: pkce.verificador,
      segredo: SEGREDO,
    });
    expect(
      conferirToken(errado, { escopo: 'single_signature', cpf: CPF_SINTETICO_SESSAO }, new Date()).ok,
    ).toBe(false);
    const t = conferirToken(
      await clientePscHttp.trocarCodigo(cfg, { codigo, verificador: pkce.verificador, segredo: SEGREDO }),
      { escopo: 'single_signature', cpf: CPF_SINTETICO_SESSAO },
      new Date(),
    );
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const d = (await clientePscHttp.descobrirCertificados(cfg, t.token)) as {
      certificates: { certificate: string }[];
    };
    const cert = Uint8Array.from(Buffer.from(d.certificates[0]!.certificate, 'base64'));
    const hash = 'ab'.repeat(32);
    const a = conferirAssinaturas(
      await clientePscHttp.assinar(cfg, t.token, [{ id: '1', alias: 'x', hashHex: hash }], 'principal'),
      ['1'],
    );
    expect(a.ok).toBe(true);
    if (a.ok)
      expect(conferirAssinaturaHash(cert, Buffer.from(hash, 'hex'), a.assinaturas.get('1')!)).toBe(true);
    // Só hashes no corpo da assinatura (nada de documento), o verificador e o segredo só na troca do código.
    const assinatura = recebidos.find((r) => r.startsWith('POST /v0/oauth/signature'))!;
    expect(assinatura).toContain('"hash_algorithm":"2.16.840.1.101.3.4.2.1"');
    expect(assinatura).toContain('"signature_format":"RAW"');
    expect(assinatura).not.toContain(SEGREDO);
    expect(
      recebidos.filter((r) => r.includes(SEGREDO)).every((r) => r.startsWith('POST /v0/oauth/token')),
    ).toBe(true);
    expect(await clientePscHttp.testar(cfg)).toBe(true);
  });

  it('5xx e conexão recusada: indisponível (pendente, regra 5)', async () => {
    await expect(
      clientePscHttp.descobrirCertificados(
        { uriBase: `${base}/quebrado`, clientId: 'x', retorno: RETORNO },
        't',
      ),
    ).rejects.toBeInstanceOf(ErroIndisponivel);
    const fechado = { uriBase: 'http://127.0.0.1:1/v0', clientId: 'x', retorno: RETORNO };
    await expect(
      clientePscHttp.trocarCodigo(fechado, { codigo: 'c', verificador: 'v', segredo: 's' }),
    ).rejects.toBeInstanceOf(ErroIndisponivel);
    expect(await clientePscHttp.testar(fechado)).toBe(false);
  });
});

describe('ACT e LCR pelo HTTP', () => {
  it('carimbo do tempo pelo HTTP confere; LCR baixada, assinada e com cache', async () => {
    const hash = Uint8Array.from(Buffer.from('cd'.repeat(32), 'hex'));
    const nonce = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const resp = await clienteActHttp(`${base}/act`).carimbar(pedidoCarimbo(hash, nonce));
    expect(conferirCarimbo(lerRespostaCarimbo(resp), { hash, nonce }, new Date()).ok).toBe(true);
    await expect(
      clienteActHttp(`${base}/quebrado`).carimbar(pedidoCarimbo(hash, nonce)),
    ).rejects.toBeInstanceOf(ErroIndisponivel);
    const b = buscadorLcrHttp();
    const lcr = await b.buscar(`${base}/lcr.crl`);
    expect(conferirLcr(lcr, sim.raiz.certificado, new Date()).ok).toBe(true);
    const n = recebidos.filter((r) => r.startsWith('GET /lcr.crl')).length;
    await b.buscar(`${base}/lcr.crl`);
    expect(recebidos.filter((r) => r.startsWith('GET /lcr.crl')).length).toBe(n);
    await expect(b.buscar('ftp://x')).rejects.toBeInstanceOf(ErroIndisponivel);
  });
});
