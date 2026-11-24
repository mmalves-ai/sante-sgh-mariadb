// Unidade das leituras próprias do cálculo da folha (sem banco): o resumo por vínculo, o tipo do processamento no banco,
// os filtros que viram SQL (a empresa de fora não consulta) e a tradução das situações do banco para o contrato.
import { describe, expect, it } from 'vitest';
import {
  competenciaNoBanco,
  lerFerias,
  lerLinhas,
  lerProcessos,
  lerRescisoes,
  resumirLinhas,
  tipoProcessoNoBanco,
} from './folha-porta-propria-calculo.js';
import type { LinhaCalculoDoVinculo } from './tipos-folha.js';

type Consulta = { sql: string; p: readonly unknown[] };
function leitor(linhas: Record<string, unknown>[] = []) {
  const feitas: Consulta[] = [];
  return {
    feitas,
    consultar: async (sql: string, p: readonly unknown[] = []) => {
      feitas.push({ sql, p });
      return linhas;
    },
    uma: async (sql: string, p: readonly unknown[] = []) => {
      feitas.push({ sql, p });
      return linhas[0] ?? null;
    },
  } as never as Parameters<typeof lerProcessos>[0] & { feitas: Consulta[] };
}

const linha = (x: Partial<LinhaCalculoDoVinculo>): LinhaCalculoDoVinculo => ({
  papel: 'salario',
  tipo: 'provento',
  rubrica: null,
  codigoRubrica: null,
  quantidade: 0,
  unidade: 'valor',
  valor: 0,
  memoria: '',
  vinculo: 1,
  centroCusto: 9,
  diasPagos: 30,
  ...x,
});

describe('resumo por vínculo', () => {
  it('soma proventos, descontos e cada papel do resumo em centavos, na ordem do vínculo', () => {
    const r = resumirLinhas([
      linha({ vinculo: 2, valor: 0.1 }),
      linha({ vinculo: 2, valor: 0.2 }),
      linha({ vinculo: 2, papel: 'inss', tipo: 'desconto', valor: 10.05 }),
      linha({ vinculo: 1, papel: 'baseInss', tipo: 'base', valor: 100 }),
    ]);
    expect(r.map((x) => x.vinculo)).toEqual([1, 2]);
    expect(r[1]).toMatchObject({ proventos: 0.3, descontos: 10.05, centroCusto: 9, diasPagos: 30 });
    expect(r[1]!.porPapel).toMatchObject({ inss: 10.05, baseInss: 0, multaFgts: 0 });
    expect(r[0]).toMatchObject({ proventos: 0, descontos: 0 });
    expect(r[0]!.porPapel.baseInss).toBe(100);
    expect(resumirLinhas([])).toEqual([]);
  });
});

describe('formato do banco', () => {
  it('tipo do processamento e competência', () => {
    expect(tipoProcessoNoBanco('decimo1')).toBe('decimo_terceiro_1');
    expect(tipoProcessoNoBanco('decimo2')).toBe('decimo_terceiro_2');
    expect(tipoProcessoNoBanco('mensal')).toBe('mensal');
    expect(competenciaNoBanco('2026-09')).toBe('2026-09-01');
  });
});

describe('filtros dos processamentos', () => {
  it('empresa de fora não consulta; os filtros viram parâmetros no formato do banco', async () => {
    const l = leitor();
    expect(await lerProcessos(l, 5, { empresa: 6 })).toEqual([]);
    expect(l.feitas).toHaveLength(0);
    await lerProcessos(l, 5, {
      competencia: '2026-09',
      tipo: 'decimo1',
      semTipo: 'ferias',
      semTipos: ['decimo2'],
      competenciaDe: '2026-01',
      competenciaAte: '2026-12',
    });
    expect(l.feitas[0]!.p).toEqual([
      5,
      '2026-09-01',
      'decimo_terceiro_1',
      'ferias',
      'decimo_terceiro_2',
      '2026-01-01',
      '2026-12-01',
    ]);
    expect(l.feitas[0]!.sql).toMatch(/ORDER BY p\.competencia DESC, p\.numero DESC/);
  });

  it('lê o processamento com o tipo do contrato, as datas da tabela e dos parâmetros e a situação por/em', async () => {
    const l = leitor([
      {
        id: 7,
        estabelecimento_id: 5,
        competencia: new Date(2026, 8, 1),
        tipo: 'decimo_terceiro_2',
        numero: 1,
        situacao: 'calculada',
        pagamento_em: '2026-12-20',
        totais: '{"colaboradores":3}',
        quantidade_fora_da_folha: 1,
        tabela_legal_inicio: '2026-01-01',
        parametros_inicio: null,
        resumo: null,
        motivo: null,
        criado_em: new Date('2026-09-30T10:00:00Z'),
        alterado_em: new Date('2026-10-01T10:00:00Z'),
        versao: 2,
        calculado_login: 'a',
        situacao_login: 'b',
      },
    ]);
    const [p] = await lerProcessos(l, 5, {});
    expect(p).toEqual({
      id: 7,
      empresa: 5,
      competencia: '2026-09',
      tipo: 'decimo2',
      numero: 1,
      situacao: 'calculada',
      pagamento: '2026-12-20',
      totais: { colaboradores: 3 },
      foraDaFolha: 1,
      tabelaLegal: '2026-01-01',
      parametros: '',
      resumo: '',
      calculadoPor: 'a',
      calculadoEm: '2026-09-30T10:00:00.000Z',
      situacaoPor: null,
      situacaoEm: null,
      motivo: null,
      versao: 2,
    });
  });

  it('código da rubrica só quando numérico', async () => {
    const l = leitor([
      { vinculo_trabalho_id: 1, papel: 'salario', tipo: 'provento', rubrica_id: 3, codigo_rubrica: 'A1', valor: '10.50' },
    ]);
    const [x] = await lerLinhas(l, 5, 9, 1);
    expect(x).toMatchObject({ rubrica: 3, codigoRubrica: null, valor: 10.5, quantidade: 0 });
    expect(l.feitas[0]!.p).toEqual([5, 9, 1]);
  });
});

describe('situações do banco no contrato', () => {
  it('férias: programada inclui a aprovada; calculada inclui o gozo', async () => {
    const l = leitor([{ id: 1, situacao: 'em_gozo', adianta_decimo_terceiro: 1, processo: 4 }]);
    const [f] = await lerFerias(l, 5, { situacao: 'programada' });
    expect(l.feitas[0]!.p).toEqual([5, 'programada', 'aprovada']);
    expect(f).toMatchObject({ situacao: 'calculada', adiantarDecimo: true, processo: 4 });
    expect(await lerFerias(l, 5, { empresa: 6 })).toEqual([]);
  });

  it('rescisão: a paga de outra origem lê como calculada; modalidade e aviso com hífen; projeção padrão', async () => {
    const l = leitor([
      {
        id: 1,
        situacao: 'paga',
        modalidade: 'culpa_reciproca',
        aviso_previo: null,
        data_desligamento: '2026-11-10',
        data_projetada_aviso: null,
        processamento_folha_id: 8,
        saldo_fgts_informado: 0,
      },
    ]);
    const [r] = await lerRescisoes(l, 5, { situacao: 'calculada', vinculo: 3 });
    expect(l.feitas[0]!.p).toEqual([5, 3, 'calculada', 'conferida', 'paga', 'homologada']);
    expect(r).toMatchObject({
      situacao: 'calculada',
      modalidade: 'culpa-reciproca',
      aviso: 'nenhum',
      projecao: '2026-11-10',
      processo: 8,
      saldoFgtsInformado: false,
      situacaoPor: null,
    });
  });
});
