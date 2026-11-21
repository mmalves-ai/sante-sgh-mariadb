// W0-07 (programa CRUD completo): a transferência de leito na observação do PA pela HTTP, com a sessão real sobre a
// fonte sintética e a porta EM MEMÓRIA (nada conecta a banco). Liberar e alocar numa operação só: o motivo é
// obrigatório; o destino ocupado recusa sem tirar o paciente da origem; a falha simulada ENTRE liberar e alocar desfaz
// tudo e o paciente fica no leito de origem; a entrada (a contagem das 24 horas) continua a da primeira alocação.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { moduloConfiguracaoDeTeste, registroDeTeste } from '../cadastro/teste.spec-util.js';
import { modulo as moduloAtendimento } from './modulo.js';
import { PortaRecepcaoMemoria } from '../recepcao/porta-memoria.js';
import type { GravadorSghAtendimento } from './porta.js';
import { PortaAtendimentoMemoria } from './porta-memoria.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'configuracao_teste,cadastro,atendimento',
};
const trilha = new RegistradorTrilhaMemoria();
const cadastro = new PortaCadastroMemoria();
const recepcao = new PortaRecepcaoMemoria({ estado: () => 'verde' });

/** A porta em memória com a "queda" simulada depois da saída e antes da alocação, ligada pelo teste. */
class PortaComFalha extends PortaAtendimentoMemoria {
  falharEntreLiberarEAlocar = false;
  override gravarSgh<T>(
    c: Parameters<PortaAtendimentoMemoria['gravarSgh']>[0],
    t: unknown,
    fn: (g: GravadorSghAtendimento) => Promise<T>,
  ): Promise<T> {
    return super.gravarSgh(c, t, (g) =>
      fn({
        ...g,
        liberarObservacao: async (x) => {
          const r = await g.liberarObservacao(x);
          if (this.falharEntreLiberarEAlocar && x.transferencia)
            throw new Error('Falha simulada entre liberar e alocar (queda da conexão)');
          return r;
        },
      }),
    );
  }
}
const atendimento = new PortaComFalha(
  { estado: () => 'verde' },
  { lerPacientes: (c, ids) => cadastro.lerPacientes(c, ids), recepcao },
);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: registroDeTeste(
      { cadastro },
      {
        configuracao_teste: (ctx) => moduloConfiguracaoDeTeste(ctx),
        atendimento: (ctx) => moduloAtendimento(ctx, { porta: atendimento }),
      },
    ),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
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
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-w007-pa-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

interface LeitoObs {
  id: number;
  ocupacao: { reg: number; entrada: string } | null;
}
const leitos = async (s: Sessao) =>
  ((await get(s, '/pa/observacao')).json() as { leitos: LeitoObs[] }).leitos;
const ondeEsta = async (s: Sessao, reg: number) =>
  (await leitos(s)).filter((l) => l.ocupacao?.reg === reg).map((l) => l.id);

describe('W0-07: transferência de leito na observação do PA', () => {
  it('motivo obrigatório; destino ocupado recusa; falha entre liberar e alocar desfaz tudo; a entrada continua', async () => {
    const recepcaoPa = await entrar('SINT.ATENDIMENTO');
    const aberto = await post(recepcaoPa, '/atendimento', {
      tipo: 'pa',
      paciente: 1004,
      convenio: 306,
      profissional: 7101,
      especialidade: 15,
      unidade: 3,
      centroCusto: 300400,
      procedimento: 10101039,
      carater: 'urgencia',
      cidPrincipal: 1,
      matricula: '900000000777',
    });
    expect(aberto.statusCode, aberto.body).toBe(201);
    const reg = aberto.json().resultado.reg as number;
    const s = await entrar('SINT.MEDICO.PA');
    const livres = (await leitos(s)).filter((l) => l.ocupacao === null);
    expect(livres.length).toBeGreaterThanOrEqual(2);
    const [origem, destino] = livres as [LeitoObs, LeitoObs];
    expect((await post(s, `/pa/${reg}/observacao`, { leito: origem.id })).statusCode).toBe(201);
    const entrada = (await leitos(s)).find((l) => l.id === origem.id)?.ocupacao?.entrada;
    expect(entrada).toBeTruthy();

    // Sem motivo: 400 (a tela pede o motivo).
    const semMotivo = await post(s, `/pa/${reg}/observacao/transferir`, { leito: destino.id });
    expect(semMotivo.statusCode).toBe(400);

    // Destino ocupado (outro paciente): recusa e o paciente continua na origem (a saída foi desfeita).
    const ocupado = (await leitos(s)).find((l) => l.ocupacao !== null && l.ocupacao.reg !== reg);
    expect(ocupado).toBeTruthy();
    const r409 = await post(s, `/pa/${reg}/observacao/transferir`, {
      leito: ocupado?.id,
      motivo: 'Necessidade de monitor',
    });
    expect(r409.statusCode).toBe(409);
    expect(r409.json().codigo).toBe('leito-ocupado');
    expect(await ondeEsta(s, reg)).toEqual([origem.id]);

    // Falha simulada ENTRE liberar e alocar: nada muda, o paciente fica no leito de origem.
    atendimento.falharEntreLiberarEAlocar = true;
    const queda = await post(s, `/pa/${reg}/observacao/transferir`, {
      leito: destino.id,
      motivo: 'Necessidade de monitor',
    });
    atendimento.falharEntreLiberarEAlocar = false;
    expect(queda.statusCode).toBeGreaterThanOrEqual(500);
    expect(await ondeEsta(s, reg)).toEqual([origem.id]);
    expect((await leitos(s)).find((l) => l.id === destino.id)?.ocupacao).toBeNull();

    // Transferência certa: uma operação só; a entrada (24 horas) continua a da primeira alocação.
    const ok = await post(s, `/pa/${reg}/observacao/transferir`, {
      leito: destino.id,
      motivo: 'Necessidade de monitor',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await ondeEsta(s, reg)).toEqual([destino.id]);
    expect((await leitos(s)).find((l) => l.id === destino.id)?.ocupacao?.entrada).toBe(entrada);
    expect((await leitos(s)).find((l) => l.id === origem.id)?.ocupacao).toBeNull();
    expect(trilha.eventos.some((x) => x.evento === 'pa.observacao.alterada')).toBe(true);
  });
});
