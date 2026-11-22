// Integração do painel da segurança do paciente (F2.2, lote 04-03) contra o MariaDB do cliente de teste da onda 4
// (f22_o4): as contagens de notificações por tipo, classificação, dano, situação e anonimato no período, só do
// estabelecimento da sessão; o painel das análises pelos prazos gravados; as leituras de outro módulo ainda sem
// mapeamento falham fechadas (503); os fluxos da etapa 2 (análise, plano 5W2H, queixa técnica) ficam pendentes nomeados.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { ErroOperacao } from '@sgh/nucleo';
import {
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import { PortaQualidadePropria } from './porta-propria.js';

const T: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'notificacao_incidente',
  entidadeId: null,
  correlacao: 't',
};

describe.skipIf(SEM_BANCO_QUA)('painel da segurança do paciente no MariaDB (f22_o4)', () => {
  let m: MassaQualidade;
  let porta: PortaQualidadePropria;

  beforeAll(async () => {
    m = await prepararMassaQualidade('S');
    porta = new PortaQualidadePropria(m.nucleo);
  }, 60_000);
  afterAll(() => encerrarMassaQualidade(m));

  it('conta as notificações do período no estabelecimento da sessão', async () => {
    const c = ctxBanco(m.est, m.codigoEst, m.usuario);
    for (const [tipo, anonima] of [
      ['queda', false],
      ['queda', false],
      ['medicacao', true],
    ] as const)
      await porta.gravarSgh(anonima ? { ...c, usuario: null } : c, T, (g) =>
        g.notificar({
          agora: '2026-11-20T10:00:00',
          protocoloDe: (a, s) => `NSP-${a}-${String(s).padStart(6, '0')}`,
          codigoResumo: randomBytes(32).toString('hex'),
          chaveResumo: null,
          ocorridoEm: '2026-11-20T09:00',
          atendimento: null,
          paciente: null,
          unidade: m.setor,
          leito: null,
          local: null,
          tipo,
          tipoOutro: null,
          chegouAoPaciente: true,
          danoPercebido: 'leve',
          classificacao: 'eventoAdverso',
          descricao: 'Ocorrência sintética do painel.',
          anonima,
          notificador: m.login,
          origemTela: null,
          origemSugestao: null,
        }),
      );
    const p = await porta.painelNotificacoes(c, '2026-11-01', '2026-12-01');
    const total = (t: string) => p.filter((x) => x.tipo === t).reduce((s, x) => s + x.quantidade, 0);
    expect(total('queda')).toBe(2);
    expect(total('medicacao')).toBe(1);
    expect(p.find((x) => x.tipo === 'medicacao')?.anonima).toBe(true);
    expect(
      await porta.painelNotificacoes(ctxBanco(m.outro, m.codigoOutro, m.usuario), '2026-11-01', '2026-12-01'),
    ).toEqual([]);
    expect(await porta.painelNotificacoes(c, '2026-12-01', '2027-01-01')).toEqual([]);
  });

  it('o painel das análises conta pelos prazos da notificação (vencida, concluída e descartada fora)', async () => {
    const c = ctxBanco(m.est, m.codigoEst, m.usuario);
    const { id } = await porta.gravarSgh(c, T, (g) =>
      g.notificar({
        agora: '2026-11-20T10:00:00',
        protocoloDe: (a, s) => `NSP-${a}-${String(s).padStart(6, '0')}`,
        codigoResumo: randomBytes(32).toString('hex'),
        chaveResumo: null,
        ocorridoEm: '2026-11-05T09:00',
        atendimento: null,
        paciente: null,
        unidade: m.setor,
        leito: null,
        local: null,
        tipo: 'queda',
        tipoOutro: null,
        chegouAoPaciente: true,
        danoPercebido: 'leve',
        classificacao: 'eventoAdverso',
        descricao: 'Ocorrência sintética do painel das análises.',
        anonima: false,
        notificador: m.login,
        origemTela: null,
        origemSugestao: null,
      }),
    );
    await porta.gravarSgh(c, T, (g) =>
      g.distribuir({
        id,
        versao: 1,
        usuario: m.login,
        agora: '2026-11-20T10:05:00',
        gestor: m.loginGestor,
        unidade: m.setor,
        prazoAnalise: '2026-11-10',
        orientacao: null,
      }),
    );
    expect(await porta.painelAnalises(c, '2026-11-01', '2026-12-01', '2026-11-21')).toEqual({
      comPrazo: 1,
      concluidas: 0,
      noPrazo: 0,
      vencidas: 1,
    });
    expect(await porta.painelAnalises(c, '2026-11-01', '2026-12-01', '2026-11-09')).toEqual({
      comPrazo: 1,
      concluidas: 0,
      noPrazo: 0,
      vencidas: 0,
    });
    expect(
      await porta.painelAnalises(
        ctxBanco(m.outro, m.codigoOutro, m.usuario),
        '2026-11-01',
        '2026-12-01',
        '2026-11-21',
      ),
    ).toEqual({ comPrazo: 0, concluidas: 0, noPrazo: 0, vencidas: 0 });
  });

  it('as leituras de outro módulo ainda sem mapeamento falham fechadas (503 modelo-pendente)', async () => {
    const c = ctxBanco(m.est, m.codigoEst, m.usuario);
    for (const p of [
      porta.candidatos(c, m.login, '2026-11-01'),
      porta.painelAdesao(c, '2026-11-01', '2026-12-01', '2026-11-20T10:00:00'),
      porta.itens(c, 'luva'),
    ]) {
      const e = await p.then(
        () => null,
        (x: unknown) => x,
      );
      expect(e).toBeInstanceOf(ErroOperacao);
      expect((e as ErroOperacao).problema).toMatchObject({ status: 503, codigo: 'modelo-pendente' });
    }
  });

  // O fluxo da etapa 2 que o sistema anterior fazia aguarda o mapeamento (pedido em saida/04-03.json): pendente nomeado.
  it.todo(
    'notificação → análise → plano 5W2H → conclusão (analise_incidente, plano_acao_qualidade, acao_plano_qualidade)',
  );
  it.todo('a sugestão de notificação resolvida pelo resumo (sugestao_notificacao_incidente)');
  it.todo('a vigilância de produto com os expostos (queixa_tecnica_produto)');
});
