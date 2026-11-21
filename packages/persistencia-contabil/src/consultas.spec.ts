// As conversões puras da persistência comum da contabilidade (linha do banco → forma do contrato), sem banco.
import { describe, expect, it } from 'vitest';
import { bloqueioDoLancamento } from './bloqueio.js';
import { chaveDoLancamento, fatoDe, periodoDe, SITUACAO_FATO_MODELO, situacaoFatoDe } from './consultas.js';

describe('persistência comum da contabilidade', () => {
  it('chave do lançamento: hash da chave do domínio no estabelecimento, na forma de UUID, estável', () => {
    const a = chaveDoLancamento(7, 'fato:1');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(chaveDoLancamento(7, 'fato:1')).toBe(a);
    expect(chaveDoLancamento(8, 'fato:1')).not.toBe(a);
  });

  it('situação do fato: ida e volta entre a tela e o modelo; desconhecida vira pendente', () => {
    for (const [tela, modelo] of Object.entries(SITUACAO_FATO_MODELO)) expect(situacaoFatoDe(modelo)).toBe(tela);
    expect(situacaoFatoDe('outra')).toBe('pendente');
  });

  it('fato lido: origem, valores em centavos, campos JSON e a situação do modelo', () => {
    const f = fatoDe({
      id: 10,
      estabelecimento_id: 3,
      entidade_origem: 'titulo_pagar',
      entidade_origem_id: 55,
      tipo: 'tituloPagar',
      data_fato: '2026-10-15',
      competencia: '2026-10',
      centavos: 1234,
      centro_custo_id: null,
      documento: 'NF 1',
      campos: '{"credor": 9}',
      impressao: 'abc',
      estorno: 0,
      referencia: null,
      situacao: 'sem_regra',
      motivo: 'sem regra',
      versao_regra_contabil_id: null,
      lido_em: '2026-10-15T10:00:00',
    });
    expect(f).toMatchObject({
      tabela: 'titulo_pagar',
      id: 55,
      idFato: 10,
      empresa: 3,
      valorCentavos: 1234,
      campos: { credor: 9 },
      estorno: false,
      situacao: 'semRegra',
      regraId: null,
    });
  });

  it('período lido: bloqueado aparece aberto com o aviso; o lançamento nele é recusado', () => {
    const p = periodoDe({ competencia: '2026-10', situacao: 'bloqueado', bloqueado_ate: null, versao: 2 }, 3);
    expect(p).toMatchObject({ empresa: 3, situacao: 'aberto', observacao: 'Período bloqueado para lançamentos.' });
    expect(bloqueioDoLancamento({ situacao: 'bloqueado', bloqueadoAte: null }, '2026-10-02', '2026-10')?.codigo).toBe(
      'periodo-bloqueado',
    );
  });
});
