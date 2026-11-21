// Regra 21 do M52 (cap-07 §7.1.1; F2.2 lote 03-02): o autosserviço vê SÓ o próprio. Prova contra o MariaDB do cliente
// de teste da onda 3 (f22_o3), com massa SINTÉTICA, sobre a porta própria das solicitações e da avaliação:
//   1. a lista das solicitações filtra pelos vínculos do login (o vínculo de outra pessoa não traz nada) e pelo
//      estabelecimento da sessão (o de outro estabelecimento não aparece, nem pelo id);
//   2. o pedido em vínculo de outro estabelecimento é recusado (`vinculo-inexistente`) e nada é gravado;
//   3. o cargo e os vínculos em experiência só saem do estabelecimento da sessão.
// Só contagens e ids sintéticos.
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ctxO3,
  encerrarMassaO3,
  type MassaPessoasO3,
  prepararMassaO3,
  SEM_BANCO_O3,
} from '../avaliacao/massa.spec-util.js';
import { PortaAvaliacaoPropria } from '../avaliacao/porta-propria.js';
import { PortaAutoatendimentoPropria } from '../autoatendimento/porta-propria.js';

const trilha = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'solicitacao_colaborador',
  entidadeId: null,
  dadosDepois: null,
  correlacao: 'teste-l0302-escopo',
} as const;

describe.skipIf(SEM_BANCO_O3)('autosserviço: só o próprio (regra 21), no MariaDB (f22_o3)', () => {
  let m: MassaPessoasO3;
  beforeAll(async () => {
    m = await prepararMassaO3('E');
  }, 60_000);
  afterAll(() => encerrarMassaO3(m));

  it('as solicitações filtram pelos vínculos do login e pelo estabelecimento da sessão', async () => {
    const porta = new PortaAutoatendimentoPropria(m.nucleo);
    const eu = ctxO3(m.est, m.usuario);
    const id = await porta.gravarSgh(eu, trilha, (g) =>
      g.incluirSolicitacao({
        tipo: 'alteracao_cadastral',
        inicio: null,
        fim: null,
        diasGozo: null,
        diasAbono: null,
        adiantaDecimo: null,
        movimento: null,
        justificativa: null,
        campo: 'nome',
        valorAnterior: 'COLABORADOR SINTETICO L0302',
        valorNovo: 'COLABORADOR SINTETICO L0302 SILVA',
        observacao: 'Mudança sintética de sobrenome',
        vinculo: m.vinculo,
        por: m.login,
      } as never),
    );
    expect((await porta.solicitacoes(eu, { vinculos: [m.vinculo] })).map((x) => x.id)).toEqual([id]);
    expect(await porta.solicitacoes(eu, { vinculos: [m.vinculo + 100000] })).toEqual([]);
    const fora = ctxO3(m.outro, m.usuario);
    expect(await porta.solicitacao(fora, id)).toBeNull();
    expect(await porta.solicitacoes(fora, { vinculos: [m.vinculo] })).toEqual([]);
    const recusa = await porta
      .gravarSgh(fora, trilha, (g) =>
        g.incluirSolicitacao({
          tipo: 'abono',
          inicio: '2026-10-20',
          fim: '2026-10-20',
          vinculo: m.vinculo,
          por: m.login,
        } as never),
      )
      .then(
        () => 'ok',
        (e: unknown) => (e instanceof ErroOperacao ? e.problema.codigo : String(e)),
      );
    expect(recusa).toBe('vinculo-inexistente');
    expect(await porta.solicitacoes(fora, {})).toEqual([]);
  });

  it('o cargo e os vínculos em experiência só do estabelecimento da sessão', async () => {
    const av = new PortaAvaliacaoPropria(m.nucleo);
    expect(await av.cargoDoVinculo(ctxO3(m.est, m.usuario), m.vinculo)).toBe(m.cargo);
    expect(await av.cargoDoVinculo(ctxO3(m.outro, m.usuario), m.vinculo)).toBeNull();
    expect(
      (await av.vinculosEmExperiencia(ctxO3(m.outro, m.usuario), '2026-01-01')).map((x) => x.vinculo),
    ).not.toContain(m.vinculo);
  });
});
