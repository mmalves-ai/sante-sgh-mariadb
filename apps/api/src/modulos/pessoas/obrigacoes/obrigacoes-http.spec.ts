// M53.8 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): as rotas
// das obrigações legais, cada uma pela permissão da opção do outro sistema. O departamento pessoal (exportações das
// obrigações 525 a 528) consulta, simula e é recusado na chave `pessoas.folha` (nasce desligada) ao gravar; quem só tem
// o relatório do FGTS (415) consulta e não gera nem baixa; quem só consulta a folha (351) não vê; entrada inválida é 400.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { REGIMES_SUGERIDOS_OBRIGACOES } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAppPessoas, PESSOAS_REGISTRADO } from '../opcoes-teste.spec-util.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { CifraCpf } from '../cifra-cpf.js';

// As rotas de pessoas só existem com o módulo "pessoas" registrado (REGISTRO_MODULOS): até lá, a bateria fica pulada
// (pendência registrada na saída do lote 03-08) e volta sozinha quando o módulo entrar no registro. As portas de teste
// vão tipadas (OpcoesTestePessoas) e são conferidas ao subir a app: opção que o módulo ignorar falha o teste.
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
let app: NestFastifyApplication;

beforeAll(async () => {
  if (!PESSOAS_REGISTRADO) return;
  app = await criarAppPessoas(env, {
    trilha: new RegistradorTrilhaMemoria(),
    cifraCpf: new CifraCpf(Buffer.alloc(32, 7)),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
afterAll(async () => {
  await app?.close();
});

const csrfDe = new Map<string, string>();
async function entrar(login: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  const cookie = set.map((c) => c.split(';')[0]).join('; ');
  csrfDe.set(
    cookie,
    set
      .find((c) => c.startsWith('sgh_csrf='))
      ?.split(';')[0]
      ?.slice(9) ?? '',
  );
  return cookie;
}
const post = (cookie: string, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie, 'x-csrf': csrfDe.get(cookie) ?? '', 'idempotency-key': `m53-8-${Math.random()}` },
    payload: payload as Record<string, unknown>,
  });
const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

const O = '/api/pessoas/obrigacoes';
const GERAR = { empresa: 1, tipo: 'fgts-digital', periodo: '2026-09' };
const PARAMETROS = {
  empresa: 1,
  inicio: '2020-01',
  razaoSocial: 'Hospital Sintético Ltda',
  endereco: {
    logradouro: 'Avenida Central, 1000',
    bairro: 'Centro',
    cep: '30110000',
    cidade: 'Belo Horizonte',
    uf: 'MG',
    municipio: '3106200',
  },
  contato: { nome: 'Setor Pessoal', telefone: '3133334444', email: 'dp@exemplo.com.br' },
  naturezaJuridica: '2062',
  codigoRecolhimentoSefip: '115',
  codigoPagamentoGps: '2100',
  regimes: REGIMES_SUGERIDOS_OBRIGACOES,
};

describe.skipIf(!PESSOAS_REGISTRADO)(
  'obrigações legais: cada rota pela sua permissão',
  { timeout: 180_000 },
  () => {
    it('leituras por usuário', async () => {
      const dp = await entrar('SINT.DP.FOLHA');
      const consulta = await entrar('SINT.OBRIGACAO.CONSULTA');
      const folha = await entrar('SINT.FOLHA.CONSULTA');
      for (const u of [dp, consulta]) {
        expect((await get(u, `${O}/apoio`)).statusCode).toBe(200);
        expect((await get(u, O)).statusCode).toBe(200);
        expect((await get(u, `${O}/parametros?empresa=1`)).statusCode).toBe(200);
        expect((await get(u, `${O}/fgts-digital?empresa=1&competencia=2026-09`)).statusCode).toBe(200);
        expect((await get(u, `${O}/999999`)).statusCode).toBe(404);
      }
      expect((await get(folha, O)).statusCode).toBe(403);
      expect((await get(folha, `${O}/apoio`)).statusCode).toBe(403);
      const apoio = (await get(dp, `${O}/apoio`)).json();
      expect(apoio.tipos).toEqual(['fgts-digital', 'sefip', 'caged', 'rais']);
      const fgts = (await get(consulta, `${O}/fgts-digital?empresa=1&competencia=2026-09`)).json();
      expect(fgts.pendencias.map((p: { codigo: string }) => p.codigo)).toContain('sem-parametros');
      expect(fgts.totais).toBeNull();
    });

    it('prévia sai com a chave desligada; gravar é recusado na chave; sem permissão é 403; inválido é 400', async () => {
      const dp = await entrar('SINT.DP.FOLHA');
      const previa = await post(dp, O, { ...GERAR, simular: true });
      expect(previa.statusCode, previa.body).toBe(200);
      expect(previa.json()).toMatchObject({ simulado: true, gerado: false });
      expect((await post(dp, O, { ...GERAR, simular: false })).json()).toMatchObject({
        codigo: 'recurso-desligado',
      });
      expect((await post(dp, `${O}/parametros`, PARAMETROS)).json()).toMatchObject({
        codigo: 'recurso-desligado',
      });
      expect((await get(dp, `${O}/1/arquivo`)).statusCode).toBe(404);
      expect(
        (await post(dp, `${O}/1/entrega`, { versao: 0, protocolo: 'P', data: '2026-10-20' })).statusCode,
      ).toBe(404);
      expect(
        (await post(dp, `${O}/1/cancelamento`, { versao: 0, motivo: 'Gerada por engano' })).statusCode,
      ).toBe(404);
      const consulta = await entrar('SINT.OBRIGACAO.CONSULTA');
      expect((await post(consulta, O, { ...GERAR, simular: true })).statusCode).toBe(403);
      expect((await post(consulta, `${O}/parametros`, PARAMETROS)).statusCode).toBe(403);
      expect((await get(consulta, `${O}/1/arquivo`)).statusCode).toBe(403);
      expect(
        (await post(consulta, `${O}/1/entrega`, { versao: 0, protocolo: 'P', data: '2026-10-20' }))
          .statusCode,
      ).toBe(403);
      expect((await post(dp, O, { ...GERAR, periodo: '2026', simular: true })).statusCode).toBe(400);
      expect(
        (await post(dp, O, { ...GERAR, tipo: 'rais', periodo: '2026-09', simular: true })).statusCode,
      ).toBe(400);
      expect((await post(dp, O, { ...GERAR, tipo: 'dirf', simular: true })).statusCode).toBe(400);
      expect((await get(dp, `${O}/fgts-digital?empresa=1&competencia=2026-13`)).statusCode).toBe(400);
      expect((await post(dp, `${O}/parametros`, { ...PARAMETROS, naturezaJuridica: '20' })).statusCode).toBe(
        400,
      );
    });
  },
);
