// Regra 8 (M34) pela HTTP: a entrada do parceiro com a credencial do cliente de integração (o segredo sai uma vez no
// cadastro; no banco, só o resumo), deduplicada pela chave do parceiro (MSH-10, ID do recurso, Idempotency-Key): a
// repetida devolve a primeira e não grava de novo; credencial errada, parceiro inativo e escopo de fora são recusados;
// o conteúdo vai ao armazém (nunca à resposta, ao banco nem à trilha). Mais o monitor (regras 9 e 10) e o tratamento
// da fila de mortos com o motivo. Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { moduloIntegracao } from '../modulo.js';
import { ArmazemConteudoMemoria } from '../infra/armazem-conteudo.js';
import { PortaIntegracaoMemoria } from '../porta-memoria.js';
import { chaveDoParceiro, escopoDoTipo } from './receber.js';
import { lerAutorizacaoBasica, novaCredencial, resumoDoSegredo, segredoConfere } from './credencial.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'integracao' };
const trilha = new RegistradorTrilhaMemoria();
const armazem = new ArmazemConteudoMemoria();
const integracao = new PortaIntegracaoMemoria(armazem, trilha);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      integracao: async () => ({ modulo: (ctx) => moduloIntegracao(ctx, { porta: integracao, armazem }) }),
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

async function entrar(login: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  const set = r.headers['set-cookie'] as string[];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
type S = Awaited<ReturnType<typeof entrar>>;
const get = (s: S, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: S, url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: {
      cookie: s.cookie,
      'x-csrf': s.csrf,
      'idempotency-key': `teste-m34-int-${++chave}-${Date.now()}`,
    },
    payload: payload as object,
  });
const basica = (c: { clienteId: string; segredo: string }) =>
  `Basic ${Buffer.from(`${c.clienteId}:${c.segredo}`).toString('base64')}`;
const entrada = (autorizacao: string, payload: unknown, idem?: string) =>
  app.inject({
    method: 'POST',
    url: '/api/integracoes/entrada/aa',
    headers: { authorization: autorizacao, ...(idem ? { 'idempotency-key': idem } : {}) },
    payload: payload as object,
  });

const ORU = (controle: string) =>
  [
    `MSH|^~\\&|LAB|LABX|SANTE|AA|20261022080000||ORU^R01^ORU_R01|${controle}|T|2.5`,
    'OBR|1|777|AP-1|GLI^GLICOSE',
    'OBX|1|NM|GLI^GLICOSE||92|mg/dL|70-99||||F',
  ].join('\r');

describe('credencial do cliente (seção 6: segredo só como resumo)', () => {
  it('o resumo confere o segredo e só ele; o Basic fora do formato é recusado', () => {
    const c = novaCredencial('lab-x');
    const r = resumoDoSegredo(c.segredo);
    expect(r).toMatch(/^[0-9a-f]{64}$/);
    expect(r).not.toContain(c.segredo);
    expect(segredoConfere(c.segredo, r)).toBe(true);
    expect(segredoConfere(`${c.segredo}x`, r)).toBe(false);
    expect(lerAutorizacaoBasica(basica(c))).toEqual(c);
    expect(lerAutorizacaoBasica('Bearer x')).toBeNull();
    expect(escopoDoTipo('ORU^R01')).toBe('resultado.enviar');
    expect(chaveDoParceiro('ORU^R01', ORU('M-1'), null)).toBe('M-1');
    expect(chaveDoParceiro('Patient', '{"resourceType":"Patient","id":"p-1"}', null)).toBe('Patient/p-1');
    expect(chaveDoParceiro('outro', 'x', 'chave-do-parceiro-1')).toBe('chave-do-parceiro-1');
  });
});

describe('entrada idempotente (regra 8)', () => {
  it('cadastro com o segredo uma vez; a mesma chave do parceiro devolve a primeira; recusas', async () => {
    const adm = await entrar('SINT.ADMIN');
    const r = await post(adm, '/integracoes/parceiros', {
      codigo: 'lab-teste',
      nome: 'Laboratório de teste',
      tipo: 'apoio',
      canal: 'oie-apoio-orm',
      escopos: ['resultado.enviar'],
      eventos: ['fato.exame.apoio'],
      limiteTentativas: 6,
      finalidade: 'Resultado de exame do laboratório de apoio.',
      baseLegal: 'tutela-da-saude',
    });
    expect(r.statusCode).toBe(201);
    const cred = r.json().credencial as { clienteId: string; segredo: string };
    expect(r.json().parceiro).toMatchObject({ codigo: 'lab-teste', temSegredo: true, ativo: false });
    expect(JSON.stringify((await get(adm, '/integracoes/parceiros')).json())).not.toContain(cred.segredo);
    const msg = { parceiro: 'lab-teste', tipo: 'ORU^R01', conteudo: ORU('LABT-1') };
    // Inativo: recusado. Ativado: aceito.
    expect((await entrada(basica(cred), msg)).statusCode).toBe(403);
    await post(adm, '/integracoes/parceiros/lab-teste', {
      nome: 'Laboratório de teste',
      canal: 'oie-apoio-orm',
      escopos: ['resultado.enviar'],
      eventos: ['fato.exame.apoio'],
      limiteTentativas: 6,
      finalidade: 'Resultado de exame do laboratório de apoio.',
      baseLegal: 'tutela-da-saude',
      ativo: true,
      motivo: 'Homologação com o simulador.',
    });
    const a = await entrada(basica(cred), msg);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ situacao: 'conferir', repetida: false, chaveParceiro: 'LABT-1' });
    const b = await entrada(basica(cred), msg);
    expect(b.json()).toMatchObject({ id: a.json().id, repetida: true });
    expect(JSON.stringify([a.json(), b.json()])).not.toContain('GLICOSE');
    expect([...armazem.objetos.values()].some((c) => c.includes('LABT-1'))).toBe(true);
    // Credencial errada, outro parceiro na mensagem, escopo de fora.
    expect((await entrada(basica({ ...cred, segredo: 'x'.repeat(30) }), msg)).statusCode).toBe(401);
    expect((await entrada('Basic eA==', msg)).statusCode).toBe(401);
    expect((await entrada(basica(cred), { ...msg, parceiro: 'lab-apoio-sintetico' })).statusCode).toBe(403);
    expect(
      (await entrada(basica(cred), { parceiro: 'lab-teste', tipo: 'ORM^O01', conteudo: ORU('X') }))
        .statusCode,
    ).toBe(403);
    // A trilha leva a chave e o resumo, nunca o conteúdo.
    expect(JSON.stringify(trilha.eventos)).not.toContain('GLICOSE');
  });
});

describe('monitor e fila de mortos (regras 9 e 10)', () => {
  it('a morta há mais de 4 h aparece no alerta; o tratamento exige o motivo e volta a pendente', async () => {
    const ti = await entrar('SINT.ADMIN');
    const m = (await get(ti, '/integracoes/monitor')).json();
    expect(m.mortos).toHaveLength(1);
    expect(m.alertas[0]).toMatchObject({ parceiro: 'lab-apoio-sintetico' });
    expect(m.alertas[0].minutos).toBeGreaterThan(240);
    expect(m.legado.filas.map((f: { fila: string }) => f.fila)).toContain('parceiro.lab-apoio-sintetico.saida');
    const id = m.mortos[0].id as string;
    expect(
      (await post(ti, `/integracoes/envios/${id}/tratar`, { acao: 'reprocessar', motivo: '' })).statusCode,
    ).toBe(400);
    const t = await post(ti, `/integracoes/envios/${id}/tratar`, {
      acao: 'reprocessar',
      motivo: 'De-para corrigido.',
    });
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({
      situacao: 'pendente',
      tentativas: 0,
      tratamento: 'reprocessar',
      tratadoPor: 'SINT.ADMIN',
    });
    expect(
      (await post(ti, `/integracoes/envios/${id}/tratar`, { acao: 'descartar', motivo: 'Duplicado.' }))
        .statusCode,
    ).toBe(409);
    expect((await get(ti, '/integracoes/monitor')).json().alertas).toHaveLength(0);
  });

  it('sem a permissão do monitor, 403', async () => {
    const s = await entrar('SINT.RECEPCAO');
    expect((await get(s, '/integracoes/monitor')).statusCode).toBe(403);
  });
});
