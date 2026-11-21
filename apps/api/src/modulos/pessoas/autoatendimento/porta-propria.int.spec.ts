// Integração da porta PRÓPRIA das solicitações do autoatendimento (F2.2, lote 03-02) contra o MariaDB do cliente de
// teste da onda 3 (f22_o3), com massa SINTÉTICA: o contrato de efeito do pedido, da decisão e da desistência (a linha, o
// detalhe, a versão, quem pediu e quem decidiu, e a trilha), as recusas (decisão do próprio solicitante, desistência de
// outra pessoa, versão desatualizada) e o que aguarda o modelo (atestado; efeito no ponto sem o gravador ligado), que
// desfaz a operação inteira.
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  ctxO3,
  encerrarMassaO3,
  type MassaPessoasO3,
  prepararMassaO3,
  SEM_BANCO_O3,
} from '../avaliacao/massa.spec-util.js';
import type { ContextoAutoatendimento } from './porta-autoatendimento.js';
import { PortaAutoatendimentoPropria } from './porta-propria.js';
import type { DadosSolicitacao } from './tipos.js';

const trilha = (id: number | null = null): TrilhaDaGravacao => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'solicitacao_colaborador',
  entidadeId: id,
  dadosDepois: { evento: 'teste' },
  correlacao: 'teste-l0302',
});
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};
const abono: DadosSolicitacao = {
  tipo: 'abono',
  inicio: '2026-10-20',
  fim: '2026-10-21',
  diasGozo: null,
  diasAbono: null,
  adiantaDecimo: null,
  movimento: 7,
  justificativa: 1,
  campo: null,
  valorAnterior: null,
  valorNovo: null,
  observacao: 'Pedido sintético da integração',
};

describe.skipIf(SEM_BANCO_O3)('porta própria do autoatendimento contra o MariaDB (f22_o3)', () => {
  let m: MassaPessoasO3;
  let porta: PortaAutoatendimentoPropria;
  let eu: ContextoAutoatendimento;
  let gestor: ContextoAutoatendimento;
  const ler = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: 'f22_o3', correlacao: 't' }, (l) =>
      l.consultar<Record<string, unknown>>(sql, p),
    );
  const pedir = () =>
    porta.gravarSgh(
      eu,
      (x: number) => trilha(x),
      (g) => g.incluirSolicitacao({ ...abono, vinculo: m.vinculo, por: m.login }),
    );

  beforeAll(async () => {
    m = await prepararMassaO3('S');
    porta = new PortaAutoatendimentoPropria(m.nucleo);
    eu = ctxO3(m.est, m.usuario);
    gestor = ctxO3(m.est, m.gestor);
  }, 60_000);
  afterAll(() => encerrarMassaO3(m));

  it('pedir: a linha pendente com o colaborador do vínculo, o detalhe, quem pediu e a trilha', async () => {
    const id = await pedir();
    const [l] = await ler(
      'SELECT colaborador_id, situacao, versao, criado_por, justificativa, data_inicio IS NOT NULL AS com_inicio FROM solicitacao_colaborador WHERE id = ?',
      [id],
    );
    expect(l).toMatchObject({
      colaborador_id: m.colaborador,
      situacao: 'pendente',
      versao: 1,
      criado_por: m.usuario,
      justificativa: abono.observacao,
    });
    const tr = await ler(
      "SELECT id FROM trilha_auditoria WHERE entidade = 'solicitacao_colaborador' AND entidade_id = ?",
      [id],
    );
    expect(tr.length).toBeGreaterThanOrEqual(1);
    const lida = await porta.solicitacao(eu, id);
    expect(lida).toMatchObject({
      vinculo: m.vinculo,
      tipo: 'abono',
      movimento: 7,
      pedidoPor: m.login,
      situacao: 'pendente',
      inicio: '2026-10-20',
    });
    expect((await porta.solicitacoes(eu, { vinculos: [m.vinculo] })).map((x) => x.id)).toContain(id);
    expect(await porta.solicitacoes(eu, { vinculos: [] })).toEqual([]);
    expect(await porta.ajustesDaSolicitacao(eu, id)).toEqual([]);
  });

  it('escopo: a solicitação de outro estabelecimento não aparece', async () => {
    const id = await pedir();
    const fora = ctxO3(m.outro, m.gestor);
    expect(await porta.solicitacao(fora, id)).toBeNull();
    expect((await porta.solicitacoes(fora, {})).map((x) => x.id)).not.toContain(id);
    expect(
      await codigo(
        porta.gravarSgh(fora, trilha(id), (g) =>
          g.decidirSolicitacao({
            id,
            versao: 1,
            situacao: 'recusada',
            motivo: 'Fora',
            ferias: null,
            por: m.loginGestor,
          }),
        ),
      ),
    ).toBe('desatualizado');
  });

  it('decidir: nunca o solicitante; versão velha recusa; o gestor recusa com o motivo', async () => {
    const id = await pedir();
    expect(
      await codigo(
        porta.gravarSgh(eu, trilha(id), (g) =>
          g.decidirSolicitacao({
            id,
            versao: 1,
            situacao: 'aprovada',
            motivo: null,
            ferias: null,
            por: m.login,
          }),
        ),
      ),
    ).toBe('solicitacao-decisao-pelo-solicitante');
    expect(
      await codigo(
        porta.gravarSgh(gestor, trilha(id), (g) =>
          g.decidirSolicitacao({
            id,
            versao: 5,
            situacao: 'recusada',
            motivo: 'Velha',
            ferias: null,
            por: m.loginGestor,
          }),
        ),
      ),
    ).toBe('desatualizado');
    await porta.gravarSgh(gestor, trilha(id), (g) =>
      g.decidirSolicitacao({
        id,
        versao: 1,
        situacao: 'recusada',
        motivo: 'O dia já estava abonado',
        ferias: null,
        por: m.loginGestor,
      }),
    );
    const [l] = await ler(
      'SELECT situacao, versao, decidido_por_usuario_id, motivo_decisao FROM solicitacao_colaborador WHERE id = ?',
      [id],
    );
    expect(l).toMatchObject({
      situacao: 'recusada',
      versao: 2,
      decidido_por_usuario_id: m.gestor,
      motivo_decisao: 'O dia já estava abonado',
    });
    expect(await porta.solicitacao(eu, id)).toMatchObject({
      decididoPor: m.loginGestor,
      situacao: 'recusada',
    });
  });

  it('desistir: só quem pediu; a desistência guarda o instante próprio', async () => {
    const id = await pedir();
    expect(
      await codigo(
        porta.gravarSgh(gestor, trilha(id), (g) =>
          g.desistirSolicitacao({ id, versao: 1, motivo: 'Não fui eu', por: m.loginGestor }),
        ),
      ),
    ).toBe('solicitacao-desistencia-so-do-solicitante');
    await porta.gravarSgh(eu, trilha(id), (g) =>
      g.desistirSolicitacao({ id, versao: 1, motivo: 'Lancei o dia errado', por: m.login }),
    );
    const [l] = await ler(
      'SELECT situacao, desistido_em IS NOT NULL AS desistiu, versao FROM solicitacao_colaborador WHERE id = ?',
      [id],
    );
    expect(l).toMatchObject({ situacao: 'desistida', versao: 2 });
    expect(Number(l?.['desistiu'])).toBe(1);
  });

  it('o atestado e o efeito sem o gravador ligado recusam com modelo-pendente e desfazem o pedido inteiro', async () => {
    const antes = (
      await ler('SELECT COUNT(*) AS q FROM solicitacao_colaborador WHERE estabelecimento_id = ?', [m.est])
    )[0]?.['q'];
    expect(
      await codigo(
        porta.gravarSgh(eu, trilha(), async (g) => {
          const n = await g.incluirSolicitacao({
            ...abono,
            tipo: 'atestado',
            vinculo: m.vinculo,
            por: m.login,
          });
          await g.incluirAtestado({
            emitidoEm: '2026-10-20',
            dias: 2,
            cid: null,
            emitente: 'Médica sintética',
            registroConselho: null,
            arquivo: null,
            solicitacao: n,
            por: m.login,
          } as never);
          return n;
        }),
      ),
    ).toBe('modelo-pendente');
    expect(
      await codigo(
        porta.gravarSgh(eu, trilha(), async (g) => {
          await pedir();
          await g.ponto.travarPessoa(1 as never);
        }),
      ),
    ).toBe('modelo-pendente');
    const depois = (
      await ler('SELECT COUNT(*) AS q FROM solicitacao_colaborador WHERE estabelecimento_id = ?', [m.est])
    )[0]?.['q'];
    expect(Number(depois)).toBe(Number(antes) + 1);
    expect(await porta.acessosAtestado(eu, 1)).toEqual([]);
  });
});
