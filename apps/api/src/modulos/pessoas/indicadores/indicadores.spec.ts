// W0-06, parte 7b: o painel de indicadores de pessoas pela HTTP (permissão pessoas.indicadores.ler, filtro pela query,
// 400 do filtro inválido, 403 de outro estabelecimento). Porta em memória com dados sintéticos; nada conecta a banco.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { esquemaApoioIndicadoresPessoas, esquemaPainelIndicadoresPessoas } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAppPessoas, PESSOAS_REGISTRADO } from '../opcoes-teste.spec-util.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { PortaPessoasMemoria } from '../porta-memoria.js';
import { filtroDaQuery } from './indicadores.controller.js';
import { PortaIndicadoresPessoasMemoria } from './porta-indicadores-memoria.js';

// As rotas de pessoas só existem com o módulo "pessoas" registrado (REGISTRO_MODULOS): até lá, a bateria fica pulada
// (pendência registrada na saída do lote 03-08) e volta sozinha quando o módulo entrar no registro. As portas de teste
// vão tipadas (OpcoesTestePessoas) e são conferidas ao subir a app: opção que o módulo ignorar falha o teste.
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
let app: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();
const porta = new PortaIndicadoresPessoasMemoria();
const UTI = { setor: 20, nomeSetor: 'UTI' };
porta.semear('aa', {
  vinculos: [
    { ...UTI, admissao: '2020-01-01', desligamento: null },
    { ...UTI, admissao: '2020-01-01', desligamento: '2026-03-31' },
  ],
  ponto: [
    {
      ...UTI,
      data: '2026-02-01',
      horasPrevistas: 200,
      horasTrabalhadas: 190,
      horasAusencia: 10,
      horasExtras: 0,
      horasEnfermagem: 150,
    },
  ],
});

beforeAll(async () => {
  if (!PESSOAS_REGISTRADO) return;
  app = await criarAppPessoas(env, {
    trilha,
    pessoas: new PortaPessoasMemoria(),
    indicadoresPessoas: porta,
    configuracao: fonteConfiguracaoMemoria(trilha, {}),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
afterAll(async () => {
  await app?.close();
});

async function entrar(login: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  return ((r.headers['set-cookie'] as string[] | undefined) ?? []).map((c) => c.split(';')[0]).join('; ');
}
const P = '/api/pessoas/indicadores';
const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

describe.skipIf(!PESSOAS_REGISTRADO)('W0-06 parte 7b: painel de indicadores de pessoas pela HTTP', () => {
  it('o RH lê o apoio e o painel do trimestre, com o setor pela query', async () => {
    const rh = await entrar('SINT.RH');
    const a = await get(rh, `${P}/apoio`);
    expect(a.statusCode).toBe(200);
    const apoio = esquemaApoioIndicadoresPessoas.parse(a.json());
    expect(apoio.setores).toEqual([{ codigo: 20, rotulo: 'UTI' }]);
    expect(apoio.horasCofen).toHaveLength(5);
    const r = await get(rh, `${P}?inicio=2026-01-01&fim=2026-03-31&setor=20`);
    expect(r.statusCode).toBe(200);
    const p = esquemaPainelIndicadoresPessoas.parse(r.json());
    expect([p.hospital, p.setor]).toEqual(['aa', 20]);
    const abs = p.indicadores.find((i) => i.ficha.codigo === 'absenteismo')!;
    expect([abs.numerador, abs.denominador, abs.valor]).toEqual([10, 200, 5]);
    expect(abs.parcelas[0]!.conta).toBe('10 h ÷ 200 h × 100 = 5%');
  });

  it('filtro inválido é 400; outro estabelecimento é 403', async () => {
    const rh = await entrar('SINT.RH');
    expect((await get(rh, `${P}?inicio=2026-03-31&fim=2026-01-01`)).statusCode).toBe(400);
    expect((await get(rh, `${P}?inicio=2026-01-01&fim=2026-03-31&setor=x`)).statusCode).toBe(400);
    expect((await get(rh, `${P}?fim=2026-03-31`)).statusCode).toBe(400);
    const outro = await get(rh, `${P}?inicio=2026-01-01&fim=2026-03-31&hospital=zz`);
    expect(outro.statusCode).toBe(403);
    expect(outro.json().codigo).toBe('fora-do-estabelecimento');
  });

  it('quem não tem pessoas.indicadores.ler não lê (403)', async () => {
    for (const login of ['SINT.RH.CONSULTA', 'SINT.MEDICO']) {
      const c = await entrar(login);
      expect((await get(c, `${P}/apoio`)).statusCode).toBe(403);
      expect((await get(c, `${P}?inicio=2026-01-01&fim=2026-03-31`)).statusCode).toBe(403);
    }
  });

  it('a query vira o filtro (setor numérico, vazio = nulo)', () => {
    expect(filtroDaQuery({ inicio: 'a', fim: 'b', setor: '7', hospital: '' })).toEqual({
      inicio: 'a',
      fim: 'b',
      hospital: null,
      setor: 7,
    });
    expect(filtroDaQuery({ setor: ' ' }).setor).toBeNull();
    expect(filtroDaQuery({ setor: 'x', hospital: 'aa' })).toMatchObject({ setor: 'x', hospital: 'aa' });
  });
});
