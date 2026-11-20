// W0-07 (programa CRUD completo, mercado M1): o alerta de deterioração e de sepse no PA pela HTTP, com a sessão real
// sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a banco). O servidor calcula NEWS2, qSOFA e SIRS; o quadro
// mostra o chip e a sugestão de sepse no limiar (padrão NEWS2 5 ou qSOFA 2); o escore errado se estorna com o motivo
// (nunca se apaga; o estornado continua no histórico, marcado) e se relança na mesma transação; a falha no meio do
// relançamento desfaz também o estorno. E o cálculo dos sinais da classificação (o piso parcial), em unidade.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CartaoPa, EscoresPaDoAtendimento, QuadroPa } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { PortaRecepcaoMemoria } from '../recepcao/porta-memoria.js';
import { alertaVigente } from './escore-pa.js';
import type { GravadorSghAtendimento } from './porta.js';
import { PortaAtendimentoMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const cadastro = new PortaCadastroMemoria();
const recepcao = new PortaRecepcaoMemoria({ estado: () => 'verde' });

/** A porta em memória com a falha simulada no relançamento (depois do estorno), ligada pelo teste. */
class PortaComFalha extends PortaAtendimentoMemoria {
  falharNoRelancamento = false;
  override gravarSgh<T>(
    c: Parameters<PortaAtendimentoMemoria['gravarSgh']>[0],
    t: unknown,
    fn: (g: GravadorSghAtendimento) => Promise<T>,
  ): Promise<T> {
    return super.gravarSgh(c, t, (g) =>
      fn({
        ...g,
        registrarEscorePa: async (x) => {
          if (this.falharNoRelancamento && x.origem === 'relancamento')
            throw new Error('Falha simulada no relançamento (queda da conexão)');
          return g.registrarEscorePa(x);
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
    cadastro,
    recepcao,
    atendimento,
    vigia: null,
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
  'idempotency-key': `teste-w007-escore-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

const NORMAL = { fr: 16, spo2: 98, o2: 0, pas: 120, fc: 72, consciencia: 'A', temperatura: 36.8 };
const SEPSE = { fr: 24, spo2: 95, o2: 0, pas: 98, fc: 112, consciencia: 'A', temperatura: 38.3 };

const cartao = async (s: Sessao, reg: number): Promise<CartaoPa | undefined> =>
  ((await get(s, '/pa/quadro')).json() as QuadroPa).colunas
    .flatMap((c) => c.cartoes)
    .find((k) => k.reg === reg);

describe('W0-07 (M1): alerta de deterioração e de sepse no PA', () => {
  it('registra, mostra o chip e a sugestão; estorna com motivo; relança; falha no meio desfaz tudo', async () => {
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
      matricula: '900000000778',
    });
    expect(aberto.statusCode, aberto.body).toBe(201);
    const reg = aberto.json().resultado.reg as number;
    const s = await entrar('SINT.MEDICO.PA');

    // Sem escore e sem sinais (a porta em memória não tem os sinais do prontuário): sem chip.
    expect((await cartao(s, reg))?.alertaEscore ?? null).toBeNull();
    const vazio = (await get(s, `/pa/${reg}/escores`)).json() as EscoresPaDoAtendimento;
    expect(vazio).toMatchObject({ reg, limiares: { news2: 5, qsofa: 2 }, alerta: null, historico: [] });

    // Entrada fora da faixa plausível: 400 (o Zod do contrato).
    expect((await post(s, `/pa/${reg}/escores`, { sinais: { ...NORMAL, fr: 400 } })).statusCode).toBe(400);

    // Estável: NEWS2 0, sem sugestão.
    const ok = await post(s, `/pa/${reg}/escores`, { origem: 'classificacao', sinais: NORMAL });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().resultado).toMatchObject({ news2: 0, qsofa: 0, nivel: 'baixo', sugereSepse: false });
    expect((await cartao(s, reg))?.alertaEscore).toMatchObject({ origem: 'classificacao', nivel: 'baixo' });

    // Reavaliação com sepse: NEWS2 8, qSOFA 2, SIRS 3 (parcial: sem leucograma); o chip sugere o protocolo.
    const piora = await post(s, `/pa/${reg}/escores`, { sinais: SEPSE });
    expect(piora.statusCode, piora.body).toBe(201);
    expect(piora.json().resultado).toMatchObject({
      news2: 8,
      qsofa: 2,
      sirs: 3,
      nivel: 'alto',
      sugereSepse: true,
    });
    const chip = (await cartao(s, reg))?.alertaEscore;
    expect(chip).toMatchObject({
      origem: 'reavaliacao',
      nivel: 'alto',
      sugereSepse: true,
      motivoSepse: ['news2', 'qsofa'],
      news2: { total: 8, completo: true },
      sirs: { total: 3, completo: false, faltando: ['leucocitos'] },
    });
    const idErrado = chip?.id as number;
    expect(trilha.eventos.some((x) => x.evento === 'enfermagem.escore.registrado')).toBe(true);

    // Estorno sem motivo: 400.
    expect((await post(s, `/pa/${reg}/escores/estornar`, { escore: idErrado })).statusCode).toBe(400);

    // Falha no relançamento (depois do estorno, na mesma transação): nada muda; o escore errado continua válido.
    atendimento.falharNoRelancamento = true;
    const queda = await post(s, `/pa/${reg}/escores/estornar`, {
      escore: idErrado,
      motivo: 'Pressão aferida com manguito errado',
      relancar: { ...SEPSE, pas: 128 },
    });
    atendimento.falharNoRelancamento = false;
    expect(queda.statusCode).toBeGreaterThanOrEqual(500);
    const depoisDaQueda = (await get(s, `/pa/${reg}/escores`)).json() as EscoresPaDoAtendimento;
    expect(depoisDaQueda.historico.find((x) => x.id === idErrado)?.estorno).toBeNull();
    expect(depoisDaQueda.historico).toHaveLength(2);

    // Estorno com o relançamento certo: o errado fica no histórico, marcado; o novo aponta o estornado.
    const est = await post(s, `/pa/${reg}/escores/estornar`, {
      escore: idErrado,
      motivo: 'Pressão aferida com manguito errado',
      relancar: { ...SEPSE, pas: 128 },
    });
    expect(est.statusCode, est.body).toBe(200);
    const novo = est.json().resultado.relancado as number;
    const hist = (await get(s, `/pa/${reg}/escores`)).json() as EscoresPaDoAtendimento;
    expect(hist.historico).toHaveLength(3);
    expect(hist.historico.find((x) => x.id === idErrado)?.estorno).toMatchObject({
      motivo: 'Pressão aferida com manguito errado',
      usuario: 'SINT.MEDICO.PA',
    });
    expect(hist.historico.find((x) => x.id === novo)).toMatchObject({
      origem: 'relancamento',
      substitui: idErrado,
      motivo: 'Pressão aferida com manguito errado',
    });
    // Sem a PAS baixa: NEWS2 6 (2 + 1 + 2 + 1), qSOFA 1; o NEWS2 ainda atinge o limiar 5.
    expect(hist.alerta).toMatchObject({
      id: novo,
      origem: 'relancamento',
      sugereSepse: true,
      motivoSepse: ['news2'],
    });
    expect(hist.alerta?.qsofa.total).toBe(1);
    expect(trilha.eventos.some((x) => x.evento === 'pa.escore.estornado')).toBe(true);

    // Estorno de estornado: 409; relançar de novo sobre ele também (um relançamento por estorno).
    const dup = await post(s, `/pa/${reg}/escores/estornar`, {
      escore: idErrado,
      motivo: 'De novo por engano',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('escore-ja-estornado');
    // Escore de outro atendimento (ou inexistente): 409.
    const outro = await post(s, `/pa/${reg}/escores/estornar`, {
      escore: 999_999,
      motivo: 'Não existe aqui',
    });
    expect(outro.statusCode).toBe(409);
    expect(outro.json().codigo).toBe('escore-desconhecido');

    // Só estornar (sem relançar) o vigente: o chip volta ao anterior válido (o estável da classificação).
    const so = await post(s, `/pa/${reg}/escores/estornar`, {
      escore: novo,
      motivo: 'Paciente trocado no leito',
    });
    expect(so.statusCode, so.body).toBe(200);
    expect((await cartao(s, reg))?.alertaEscore).toMatchObject({
      origem: 'classificacao',
      sugereSepse: false,
    });
  });
});

describe('W0-07 (M1): o alerta calculado dos sinais da classificação (sem escore registrado)', () => {
  const sinais = (x: Partial<Record<string, number | null>>) => ({
    pas: null,
    pad: null,
    fc: null,
    fr: null,
    temperatura: null,
    saturacao: null,
    glicemia: null,
    dor: null,
    glasgow: null,
    ...x,
  });
  const LIM = { news2: 5, qsofa: 2 };
  it('o piso parcial que já atinge o limiar sugere a sepse; abaixo dele fica indeterminado', () => {
    const a = alertaVigente(
      [],
      sinais({ fr: 25, pas: 88, fc: 100, temperatura: 38.5, saturacao: 96 }),
      LIM,
      'x',
    );
    expect(a).toMatchObject({ id: null, origem: 'sinais', sugereSepse: true, news2: { completo: false } });
    const b = alertaVigente(
      [],
      sinais({ fr: 16, pas: 120, fc: 72, temperatura: 36.8, saturacao: 98 }),
      LIM,
      'x',
    );
    expect(b).toMatchObject({ origem: 'sinais', nivel: 'indeterminado', sugereSepse: false });
  });
  it('o Glasgow da classificação entra como consciência; sem nenhum sinal que conte, sem chip', () => {
    const a = alertaVigente([], sinais({ fr: 23, glasgow: 13 }), LIM, 'x');
    expect(a?.qsofa.total).toBe(2);
    expect(a?.sugereSepse).toBe(true);
    expect(alertaVigente([], sinais({ glicemia: 90, dor: 3 }), LIM, 'x')).toBeNull();
    expect(alertaVigente([], null, LIM, 'x')).toBeNull();
  });
  it('o limiar do protocolo institucional (parâmetro) muda a sugestão do mesmo escore', () => {
    const s = sinais({ fr: 22, fc: 115, temperatura: 38.4, saturacao: 98, pas: 120 });
    expect(alertaVigente([], s, LIM, 'x')?.sugereSepse).toBe(true);
    expect(alertaVigente([], s, { news2: 7, qsofa: 3 }, 'x')?.sugereSepse).toBe(false);
  });
});
