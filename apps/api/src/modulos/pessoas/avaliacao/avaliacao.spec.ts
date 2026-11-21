// W0-06, parte 5b: avaliação de desempenho pela HTTP (permissões pessoas.avaliacao.*, Zod com motivo, 409 com a
// contagem e a oferta da inativação, ciência só da própria avaliação). Portas em memória; dados sintéticos; nada
// conecta a banco.
import { criarAppPessoas, type OpcoesTestePessoas } from '../opcoes-teste.spec-util.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTRO_MODULOS } from '../../registro.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { PortaCargosMemoria } from '../cargos/porta-cargos-memoria.js';
import { PortaPessoasMemoria } from '../porta-memoria.js';
import { PortaAvaliacaoMemoria } from './porta-avaliacao-memoria.js';

type OpcoesConfiguracao = NonNullable<Parameters<typeof fonteConfiguracaoMemoria>[1]>;
type ChaveGravada = ReturnType<NonNullable<OpcoesConfiguracao['chavesIniciais']>>[number];
type PrerequisitoGravado = ReturnType<NonNullable<OpcoesConfiguracao['prerequisitosIniciais']>>[number];

/**
 * As portas sintéticas que a bateria HTTP dá ao módulo "pessoas". O OpcoesAppBase não as leva: o lote que registra a
 * unidade liga estas portas pelo `registro` (o padrão de app-administracao.spec-util). Com o módulo registrado e sem
 * essa ligação, a bateria recusa rodar, em vez de passar sobre outras portas.
 */
interface PortasPessoasTeste {
  readonly trilha: RegistradorTrilhaMemoria;
  readonly pessoas: PortaPessoasMemoria;
  readonly cargos: PortaCargosMemoria;
  readonly avaliacao: PortaAvaliacaoMemoria;
  readonly configuracao: ReturnType<typeof fonteConfiguracaoMemoria>;
}
function opcoesPessoas(p: PortasPessoasTeste): OpcoesTestePessoas {
  return p;
}
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const chave: ChaveGravada = {
  id: 'pessoas.colaborador',
  tipo: 'recurso',
  chave: 'pessoas.colaborador',
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
};
const conferencia: PrerequisitoGravado = {
  recurso: 'pessoas.colaborador',
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
};

let app: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();
const pessoas = new PortaPessoasMemoria();
const cargos = new PortaCargosMemoria();
const avaliacao = new PortaAvaliacaoMemoria(pessoas);
avaliacao.agoraFixo = '2026-11-18T10:00';

beforeAll(async () => {
  app = await criarAppPessoas(
    env,
    opcoesPessoas({
      trilha,
      pessoas,
      cargos,
      avaliacao,
      configuracao: fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => [chave],
        prerequisitosIniciais: () => [conferencia],
      }),
    }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
let n = 0;
const pedir = (s: Sessao) => {
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `w006-aval-http-${++n}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: h() }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
  };
};
const P = '/api/pessoas/avaliacoes';
const MOTIVO = 'Lançado com o dado errado na implantação';

// As rotas só existem com o módulo "pessoas" no registro da API (lote que registra a unidade; F2.2): até lá a
// bateria HTTP fica de fora, explicitamente, e liga sozinha quando o módulo entrar em REGISTRO_MODULOS.
const PESSOAS_REGISTRADO = 'pessoas' in REGISTRO_MODULOS;

describe.skipIf(!PESSOAS_REGISTRADO)('W0-06 parte 5b: avaliação de desempenho pela HTTP', () => {
  it('o RH mantém competência e ciclo com motivo; a usada recusa a exclusão com a contagem', async () => {
    const rh = pedir(await entrar('SINT.RH'));
    const ap = await rh.get(`${P}/apoio`);
    expect(ap.statusCode).toBe(200);
    expect(ap.json().acoes.gerir).toBe(true);
    const cargo = (
      await rh.post('/api/pessoas/cargos', {
        nome: 'Técnico de enfermagem',
        cbo: '322205',
        descricao: null,
        requisitos: null,
        conselho: 'COREN',
      })
    ).json().id as number;
    const k = await rh.post(`${P}/competencias`, { nome: 'Comunicação', descricao: null });
    expect(k.statusCode).toBe(200);
    const id = k.json().id as number;
    // Sem motivo: 400 do Zod (o mesmo esquema da tela).
    expect(
      (
        await rh.post(`${P}/competencias/${id}/alteracao`, {
          nome: 'Comunicação efetiva',
          descricao: null,
          versao: 0,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await rh.post(`${P}/competencias/${id}/alteracao`, {
          nome: 'Comunicação efetiva',
          descricao: null,
          versao: 0,
          motivo: MOTIVO,
        })
      ).statusCode,
    ).toBe(200);
    expect((await rh.post(`${P}/cargos/${cargo}/competencias`, { competencia: id })).statusCode).toBe(200);
    expect((await rh.get(`${P}/cargos/${cargo}/competencias`)).json()).toHaveLength(1);
    const l = (await rh.get(`${P}/competencias`)).json();
    expect(l.correcoes[0].motivo).toBe(MOTIVO);
    const x = await rh.post(`${P}/competencias/${id}/exclusao`, { versao: 1, motivo: MOTIVO });
    expect(x.statusCode).toBe(409);
    expect(x.json().codigo).toBe('competencia-com-vinculos');
    expect(x.json().detail ?? x.json().detalhe).toMatch(/inative/);
    const c = await rh.post(`${P}/ciclos`, {
      nome: 'Ciclo 2026',
      tipo: 'periodico',
      inicio: '2026-01-01',
      fim: '2026-12-31',
      prazo: '2027-01-31',
      notaMax: 5,
    });
    expect(c.statusCode).toBe(200);
    // Fim antes do início: 400.
    expect(
      (
        await rh.post(`${P}/ciclos`, {
          nome: 'Ciclo errado',
          tipo: 'periodico',
          inicio: '2026-06-01',
          fim: '2026-01-01',
          prazo: '2026-07-01',
          notaMax: 5,
        })
      ).statusCode,
    ).toBe(400);
    const ciclos = (await rh.get(`${P}/ciclos`)).json();
    expect(ciclos).toHaveLength(1);
    expect((await rh.get(`${P}/ciclos/${c.json().id}`)).statusCode).toBe(200);
    expect((await rh.get(`${P}/alertas-experiencia`)).statusCode).toBe(200);
    expect(
      (await rh.post(`${P}/ciclos/${c.json().id}/exclusao`, { versao: 0, motivo: MOTIVO })).statusCode,
    ).toBe(200);
  });

  it('a ciência é de toda pessoa e só da própria avaliação; quem não tem pessoas.avaliacao.* não lê nem grava', async () => {
    const med = pedir(await entrar('SINT.MEDICO'));
    expect((await med.get(`${P}/minhas`)).statusCode).toBe(200);
    expect((await med.get(`${P}/minhas`)).json()).toEqual([]);
    expect((await med.get(`${P}/minhas/999999`)).statusCode).toBe(404);
    expect((await med.get(`${P}/apoio`)).statusCode).toBe(403);
    expect((await med.post(`${P}/competencias`, { nome: 'Qualquer', descricao: null })).statusCode).toBe(403);
    expect(
      (await med.post(`${P}/999999/ciencia`, { versao: 0, observacao: 'Colhida em papel hoje' })).statusCode,
    ).toBe(403);
  });
});
