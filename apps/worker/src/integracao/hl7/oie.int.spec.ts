// Regra 12 (M34): o HL7 v2 novo pelo motor de integração (Open Integration Engine) com o canal VERSIONADO do
// repositório. Como o Testcontainers: sobe o motor num contêiner descartável (sgh-oie-teste-*, portas só em
// 127.0.0.1, a imagem pela tag e o digest), implanta `infra/oie/canais/oie-apoio-orm.xml` pela API do motor, sobe o
// simulador MLLP do laboratório de apoio (na ponte local do Docker), manda o pedido pelo enviador do worker e confere:
// o laboratório recebe o ORM^O01 pelo motor, o ACK AA volta ao Sante (recibo); o AE do laboratório vira falha com o
// motivo (a retentativa). Sem o Docker ou a imagem, o teste é pulado (registrado). Dados sintéticos; o contêiner é
// apagado no fim.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Agent as AgenteHttps, request as requisitarHttps } from 'node:https';
import { createServer, type Server } from 'node:net';
import { resolve } from 'node:path';
import { deMllp, emMllp, lerMensagem, montarAck } from '@sgh/dominio-integracao';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroEntrega } from '../entrega.js';
import { criarEnviador } from '../enviadores.js';
import type { EnvioEntrega, ParceiroEntrega } from '../porta-propria.js';

const raiz = resolve(import.meta.dirname, '../../../../..');
const IMAGEM =
  'openintegrationengine/engine:4.5.2-alpine-jre@sha256:1981539a81253861a965aeadd3bbf37ae3980088e7351abb6cf7d3f9971dfb78';
const NOME = `sgh-oie-teste-${randomBytes(3).toString('hex')}`;
const PONTE = '172.17.0.1';

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function disponivel(): boolean {
  try {
    docker('image', 'inspect', IMAGEM.split('@')[0]!);
    return true;
  } catch {
    return false;
  }
}
const DISPONIVEL = disponivel();

let portaApi = 0;
let portaCanal = 0;
let portaLab = 0;
let lab: Server | null = null;
const recebidas: string[] = [];

async function livre(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
}

async function api(
  caminho: string,
  metodo: string,
  corpo?: string,
): Promise<{ status: number; texto: string }> {
  // Certificado autoassinado do motor (só o contêiner local em 127.0.0.1): a conferência do certificado é dispensada
  // SÓ neste pedido (o agente do pedido), nunca no processo inteiro (M35: a varredura de segurança limpa; antes, a
  // variável de ambiente do Node valia para o processo todo enquanto o pedido durava).
  const url = new URL(`https://127.0.0.1:${portaApi}/api${caminho}`);
  return await new Promise((ok, falha) => {
    const pedido = requisitarHttps(
      url,
      {
        method: metodo,
        agent: new AgenteHttps({ rejectUnauthorized: false, keepAlive: false }),
        headers: {
          authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`,
          'x-requested-with': 'OpenAPI',
          accept: metodo === 'GET' ? 'application/xml' : 'application/json',
          ...(corpo ? { 'content-type': 'application/xml' } : {}),
        },
        timeout: 10_000,
      },
      (r) => {
        const partes: Buffer[] = [];
        r.on('data', (c: Buffer) => partes.push(c));
        r.on('end', () => ok({ status: r.statusCode ?? 0, texto: Buffer.concat(partes).toString('utf8') }));
        r.on('error', falha);
      },
    );
    pedido.on('timeout', () => pedido.destroy(new Error('motor sem resposta em 10 s')));
    pedido.on('error', falha);
    if (corpo) pedido.write(corpo);
    pedido.end();
  });
}

beforeAll(async () => {
  if (!DISPONIVEL) return;
  [portaApi, portaCanal, portaLab] = [await livre(), await livre(), await livre()];
  // O simulador do laboratório de apoio: recebe o ORM e responde AA (ou AE quando o MSH-10 termina em "AE").
  lab = createServer((s) => {
    let buf: Uint8Array = new Uint8Array(0);
    s.on('data', (d: Buffer) => {
      const j = new Uint8Array(buf.length + d.length);
      j.set(buf);
      j.set(d, buf.length);
      const r = deMllp(j);
      buf = r.resto;
      for (const m of r.mensagens) {
        recebidas.push(m);
        if (process.env['OIE_DEPURAR']) console.error('laboratório recebeu:', JSON.stringify(m.slice(0, 60)));
        const lida = lerMensagem(m);
        const codigo = lida.controle.endsWith('AE') ? 'AE' : 'AA';
        s.write(
          emMllp(
            montarAck(lida, codigo, codigo === 'AA' ? 'Recebido' : 'Exame sem de-para no laboratório', {
              aplicacaoOrigem: 'LAB-SIMULADOR',
              instituicaoOrigem: 'LAB',
              aplicacaoDestino: 'SANTE',
              instituicaoDestino: 'PC',
              dataHora: new Date(),
              controle: `ACK${Date.now() % 1_000_000}`,
              processamento: 'T',
            }),
          ),
        );
      }
    });
  });
  await new Promise<void>((ok) => lab!.listen(portaLab, PONTE, ok));
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    NOME,
    '-p',
    `127.0.0.1:${portaApi}:8443`,
    '-p',
    `127.0.0.1:${portaCanal}:6661`,
    '--add-host=host.docker.internal:host-gateway',
    IMAGEM,
  );
  for (let i = 0; i < 60; i++) {
    const r = await api('/server/version', 'GET').catch(() => ({ status: 0, texto: '' }));
    if (r.status === 200) break;
    await new Promise((ok) => setTimeout(ok, 2_000));
  }
  const xml = readFileSync(resolve(raiz, 'infra/oie/canais/oie-apoio-orm.xml'), 'utf8')
    .replace('${LAB_APOIO_HOST}', 'host.docker.internal')
    .replace('${LAB_APOIO_PORTA}', String(portaLab));
  const criado = await api('/channels', 'POST', xml);
  expect(criado.status).toBe(200);
  const id = /<id>([^<]+)<\/id>/.exec(xml)![1]!;
  expect((await api(`/channels/${id}/_deploy`, 'POST')).status).toBe(204);
  for (let i = 0; i < 30; i++) {
    const s = await api('/channels/statuses', 'GET');
    if (s.texto.includes('<state>STARTED</state>')) break;
    await new Promise((ok) => setTimeout(ok, 1_000));
  }
}, 240_000);

afterAll(async () => {
  if (!DISPONIVEL) return;
  if (process.env['OIE_DEPURAR']) {
    const m = await api(
      '/channels/5d1c0f0e-0b34-4d34-8e34-000000000001/messages?limit=2&includeContent=true',
      'GET',
    );
    console.error('mensagens no motor:', m.texto.slice(0, 4000));
  }
  try {
    docker('rm', '-f', NOME);
  } catch {
    // já parado
  }
  await new Promise<void>((ok) => (lab ? lab.close(() => ok()) : ok()));
});

const parceiro: ParceiroEntrega = {
  id: '1',
  codigo: 'lab-simulador',
  nome: 'Laboratório simulado',
  tipo: 'apoio',
  canal: 'oie-apoio-orm',
  eventos: ['integracao.teste'],
  limiteTentativas: 3,
  ativo: true,
};
const envio = (id: string): EnvioEntrega => ({
  id,
  versao: 1,
  reservadaEm: null,
  idOutbox: '1',
  chaveEvento: 'c'.repeat(64),
  tipoEvento: 'integracao.teste',
  parceiro: 'lab-simulador',
  chaveOrdem: 'estabelecimento:pc',
  entidade: null,
  objeto: null,
  situacao: 'pendente',
  tentativas: 0,
  proximaTentativaEm: null,
  enviadoEm: null,
  recibo: null,
  resposta: null,
  hashConteudo: null,
  mortoEm: null,
  tratamento: null,
  criadoEm: new Date(),
});

describe.skipIf(!DISPONIVEL)('HL7 v2 pelo motor de integração com o canal versionado (regra 12)', () => {
  it('o pedido chega ao laboratório pelo motor e o ACK AA volta como recibo; o AE vira falha com o motivo', async () => {
    // A porta MLLP do canal mapeada no host (o enviador usa a do canal; aqui, a porta do contêiner descartável).
    const enviador = criarEnviador({
      ambiente: 'dev',
      produto: 'Produto Teste',
      hostMllp: '127.0.0.1',
      simuladorRnds: null,
      destinoApi: () => null,
      ler: () => Promise.reject(new Error('sem banco neste teste')),
      agora: () => new Date('2026-10-22T10:00:00Z'),
      portaDoCanal: () => portaCanal,
    });
    const r = await enviador(parceiro, envio('101'), 'pc');
    expect(r.resposta).toBe('AA');
    expect(r.recibo).toMatch(/^AA-/);
    expect(recebidas.some((m) => m.includes('|SGH101|'))).toBe(true);
    const falha = await enviador(parceiro, { ...envio('1AE'), id: '1AE' }, 'pc').catch((e: unknown) => e);
    expect(falha).toBeInstanceOf(ErroEntrega);
    expect((falha as Error).message).toMatch(/^AE: Exame sem de-para/);
    console.log(`motor de integração: ${recebidas.length} mensagem(ns) entregue(s) ao laboratório simulado`);
  });
});
