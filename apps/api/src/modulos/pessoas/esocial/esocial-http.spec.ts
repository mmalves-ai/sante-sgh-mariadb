// M53.6 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): cada rota do
// eSocial pela permissão da opção do outro sistema. O departamento pessoal (módulo do eSocial, tabelas, envio) abre
// tudo; quem só acompanha as pendências (5109) consulta eventos, lotes, pendências e conciliação, sem ficha, sem gerar
// e sem transmitir; quem só consulta a folha (351) não abre o eSocial. A chave `pessoas.folha` nasce desligada: gravar
// é recusado na chave; a prévia sai; a entrada inválida é 400.
//
// F2.2 (lote 03-05): o módulo pessoas ainda não está em REGISTRO_MODULOS (é registrado num lote seguinte); o teste monta
// o EsocialController num módulo de teste, com as portas em memória, pelo `registro` da base. Assim a prova da HTTP do
// eSocial não depende da ordem dos lotes.
import { type DynamicModule, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { moduloConfiguracaoDeTeste, registroDeTeste } from '../../cadastro/teste.spec-util.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PORTA_CALCULO_FOLHA } from '../folha/porta-calculo.js';
import { PortaCalculoFolhaMemoria } from '../folha/porta-calculo-memoria.js';
import { PORTA_FOLHA } from '../folha/porta-folha.js';
import { PortaFolhaMemoria } from '../folha/porta-folha-memoria.js';
import { CIFRA_CPF_PESSOAS } from '../pessoas.controller.js';
import { PORTA_PESSOAS } from '../porta.js';
import { PortaPessoasMemoria } from '../porta-memoria.js';
import { PORTA_RUBRICAS } from '../rubricas/porta-rubricas.js';
import { PortaRubricasMemoria } from '../rubricas/porta-rubricas-memoria.js';
import { EsocialController } from './esocial.controller.js';
import { PORTA_ESOCIAL } from './porta-esocial.js';
import { PortaEsocialMemoria } from './porta-esocial-memoria.js';
import { TRANSMISSOR_ESOCIAL, transmissorEsocialDoAmbiente } from './transmissor/transmissor-esocial.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'configuracao_teste,esocial_teste',
};
let app: NestFastifyApplication;

@Module({})
class EsocialDeTeste {}

function moduloEsocialDeTeste(): DynamicModule {
  const pessoas = new PortaPessoasMemoria();
  return {
    module: EsocialDeTeste,
    controllers: [EsocialController],
    providers: [
      { provide: PORTA_ESOCIAL, useValue: new PortaEsocialMemoria() },
      { provide: PORTA_PESSOAS, useValue: pessoas },
      { provide: PORTA_FOLHA, useValue: new PortaFolhaMemoria(pessoas) },
      { provide: PORTA_CALCULO_FOLHA, useValue: new PortaCalculoFolhaMemoria(pessoas) },
      { provide: PORTA_RUBRICAS, useValue: new PortaRubricasMemoria() },
      { provide: TRANSMISSOR_ESOCIAL, useValue: transmissorEsocialDoAmbiente(env) },
      { provide: CIFRA_CPF_PESSOAS, useValue: new CifraCpf(Buffer.alloc(32, 7)) },
    ],
  };
}

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha: new RegistradorTrilhaMemoria(),
    registro: registroDeTeste(
      {},
      {
        configuracao_teste: (ctx) => moduloConfiguracaoDeTeste(ctx),
        esocial_teste: () => moduloEsocialDeTeste(),
      },
    ),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
afterAll(async () => {
  await app.close();
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
const P = '/api/pessoas/esocial';
const LEITURAS = [
  `${P}/apoio`,
  `${P}/empregadores`,
  `${P}/eventos`,
  `${P}/eventos/999999`,
  `${P}/lotes`,
  `${P}/lotes/999999`,
  `${P}/pendencias`,
  `${P}/conciliacao?empresa=1&competencia=2026-11`,
  `${P}/fichas/999999`,
] as const;

async function situacoes(login: string): Promise<number[]> {
  const cookie = await entrar(login);
  const r: number[] = [];
  for (const url of LEITURAS)
    r.push((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode);
  return r;
}
const post = (cookie: string, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { cookie, 'x-csrf': csrfDe.get(cookie) ?? '', 'idempotency-key': `m53-6-${Math.random()}` },
    payload: payload as Record<string, unknown>,
  });

const PARAMETROS = {
  empresa: 1,
  inicio: '2026-01',
  transmissor: 'sante',
  leiaute: 'v_S_01_03_00',
  classTrib: '99',
  indCoop: null,
  indConstr: null,
  indDesFolha: 0,
  indOptRegEletron: 0,
  cnaePrep: '8610101',
  aliqRat: 3,
  fap: 10_000,
  codLotacao: 'LOT01',
  fpas: '515',
  codTercs: '0115',
  ideTabRubr: 'SGH',
  cnpjSindicato: null,
  motivosAfastamento: {},
};

describe('eSocial: cada rota pela sua permissão', { timeout: 180_000 }, () => {
  it('leituras por usuário (inexistente é 404 para quem pode ver; a ficha só para quem gera)', async () => {
    expect(await situacoes('SINT.DP.FOLHA')).toEqual([200, 200, 200, 404, 200, 404, 200, 200, 404]);
    expect(await situacoes('SINT.ESOCIAL.CONSULTA')).toEqual([200, 200, 200, 404, 200, 404, 200, 200, 403]);
    expect(await situacoes('SINT.FOLHA.CONSULTA')).toEqual([403, 403, 403, 403, 403, 403, 403, 403, 403]);
  });

  it('o apoio: coletor fora de produção; a chave da folha desligada tira as ações', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const r = await app.inject({ method: 'GET', url: `${P}/apoio`, headers: { cookie: dp } });
    expect(r.json()).toMatchObject({
      transmissao: { chaveLigada: false, ambiente: 'coletor', podeEnviar: false },
      acoes: { gerar: false, transmitir: false },
    });
    expect(r.json().eventos).toHaveLength(17);
    const p = await app.inject({ method: 'GET', url: `${P}/pendencias`, headers: { cookie: dp } });
    expect(p.json()).toMatchObject({ total: 87 });
  });

  it('gravar com a chave desligada é recusado; sem permissão é 403; entrada inválida é 400', async () => {
    const dp = await entrar('SINT.DP.FOLHA');
    const emp = await post(dp, `${P}/empregadores`, PARAMETROS);
    expect(emp.statusCode, emp.body).toBe(403);
    expect(emp.json()).toMatchObject({ codigo: 'recurso-desligado' });
    // Sem os parâmetros gravados, a prévia recusa pelo empregador (não pela chave).
    const previa = await post(dp, `${P}/eventos/tabela`, {
      empresa: 1,
      eventos: ['S-1000'],
      operacao: 'inclusao',
      inicio: '2026-11',
      gravar: false,
    });
    expect(previa.json()).toMatchObject({ codigo: 'empregador-sem-parametros' });
    const lote = await post(dp, `${P}/lotes`, { empresa: 1, eventos: [1] });
    expect(lote.json()).toMatchObject({ codigo: 'empregador-sem-parametros' });
    const consulta = await entrar('SINT.ESOCIAL.CONSULTA');
    for (const [url, corpo] of [
      [`${P}/empregadores`, PARAMETROS],
      [
        `${P}/eventos/tabela`,
        { empresa: 1, eventos: ['S-1000'], operacao: 'inclusao', inicio: '2026-11', gravar: false },
      ],
      [`${P}/lotes`, { empresa: 1, eventos: [1] }],
      [`${P}/conciliacao`, { empresa: 1, competencia: '2026-11' }],
    ] as const) {
      const r = await post(consulta, url, corpo);
      expect(r.statusCode, url).toBe(403);
      expect(r.json()).not.toMatchObject({ codigo: 'recurso-desligado' });
    }
    expect(
      (
        await post(dp, `${P}/eventos/tabela`, {
          empresa: 1,
          eventos: ['S-9999'],
          operacao: 'inclusao',
          inicio: '2026-11',
          gravar: false,
        })
      ).statusCode,
    ).toBe(400);
    expect((await post(dp, `${P}/empregadores`, { ...PARAMETROS, fap: 1 })).statusCode).toBe(400);
    expect(
      (
        await post(dp, `${P}/lotes/1/retorno`, {
          versao: 0,
          protocolo: null,
          eventos: [{ evento: 1, aceito: true, recibo: null, codigo: '201', descricao: 'ok' }],
        })
      ).statusCode,
    ).toBe(400);
    const comp = await app.inject({
      method: 'GET',
      url: `${P}/conciliacao?empresa=1&competencia=2026-13`,
      headers: { cookie: dp },
    });
    expect(comp.statusCode).toBe(400);
  });
});
