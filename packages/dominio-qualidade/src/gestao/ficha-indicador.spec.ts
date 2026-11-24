// Ficha técnica, meta e análise crítica dos indicadores (ficha do M48, regra 9). Contas escritas no teste.
import { type FichaIndicador, INDICADORES_QUALIDADE } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  analisePendente,
  contaDoIndicador,
  faltasDaFicha,
  FICHAS_INDICADOR_QUALIDADE,
  fichaDoCenso,
  recusaAnaliseIndicador,
  situacaoMetaQualidade,
  valorPelasParcelas,
} from './ficha-indicador.js';

const AGORA = '2026-10-27T10:00:00';
const base: {
  analise: number | null;
  versao: number | null;
  competencia: string;
  causas: string | null;
  plano: string | null;
  responsavel: string | null;
  prazo: string | null;
} = {
  analise: null,
  versao: null,
  competencia: '2026-09',
  causas: null,
  plano: null,
  responsavel: null,
  prazo: null,
};

describe('fichas dos indicadores da qualidade', () => {
  it('toda ficha completa (nome, fórmula, numerador, denominador, fonte, responsável, referência, programas)', () => {
    for (const f of FICHAS_INDICADOR_QUALIDADE) expect(faltasDaFicha(f), f.codigo).toEqual([]);
    expect(new Set(FICHAS_INDICADOR_QUALIDADE.map((f) => f.codigo)).size).toBe(
      FICHAS_INDICADOR_QUALIDADE.length,
    );
  });
  it('os códigos das fichas são os dos parâmetros de meta (qualidade.meta.<codigo>), na mesma ordem', () => {
    expect(FICHAS_INDICADOR_QUALIDADE.map((f) => f.codigo)).toEqual(
      INDICADORES_QUALIDADE.map((i) => i.codigo),
    );
  });
  it('as densidades das IRAS vão ao PM-QUALISS; a utilização de dispositivo não tem meta de um lado só', () => {
    const qualiss = FICHAS_INDICADOR_QUALIDADE.filter((f) => f.programas.includes('pmQualiss')).map(
      (f) => f.codigo,
    );
    expect(qualiss).toEqual(['densidadeIpcsCvc', 'densidadeItuSvd', 'densidadePavVm']);
    expect(FICHAS_INDICADOR_QUALIDADE.find((f) => f.codigo === 'utilizacaoCvc')?.polaridade).toBe('neutra');
  });
  it('aponta o que falta numa ficha incompleta', () => {
    const f = { ...FICHAS_INDICADOR_QUALIDADE[0]!, fonte: '', denominador: null, fator: 0, programas: [] };
    expect(faltasDaFicha(f)).toEqual(['denominador', 'fonte', 'fator', 'programas']);
    // Indicador de contagem não tem denominador.
    expect(
      faltasDaFicha({ ...FICHAS_INDICADOR_QUALIDADE[0]!, denominador: null, unidade: 'quantidade' }),
    ).toEqual([]);
  });
  it('converte a ficha do censo com os programas (o PM-QUALISS nos quatro do conjunto)', () => {
    const censo = {
      codigo: 'taxaReinternacao30',
      nome: 'Taxa de reinternação em até 30 dias',
      formula: 'reinternações ÷ saídas × 100',
      numerador: { grandeza: 'reinternacoes30', descricao: 'Reinternações em até 30 dias' },
      denominador: { grandeza: 'saidas', descricao: 'Saídas' },
      fator: 100,
      unidade: 'percentual',
      fonte: 'Censo',
      referencia: 'ANAHP',
      periodicidade: 'mensal',
      polaridade: 'menor-melhor',
      responsavel: 'Direção técnica',
      versao: 1,
      limitacoes: [],
      recortes: [],
    } as FichaIndicador;
    const f = fichaDoCenso(censo);
    expect(f).toMatchObject({
      origem: 'censo',
      denominador: 'Saídas',
      programas: ['anahp', 'ona', 'pmQualiss'],
    });
    expect(faltasDaFicha(f)).toEqual([]);
    expect(fichaDoCenso({ ...censo, codigo: 'giroLeito', denominador: null }).programas).toEqual([
      'anahp',
      'ona',
    ]);
  });
});

describe('valor, conta e meta', () => {
  it('valor pelas parcelas: 3 IPCS em 1.250 CVC-dia = 2,4 por mil', () => {
    expect(valorPelasParcelas(3, 1250, 1000)).toBe(2.4);
    expect(contaDoIndicador(3, 1250, 1000)).toBe('3 ÷ 1.250 × 1.000 = 2,4');
    // 2 ÷ 3 × 100 = 66,666… → 66,67.
    expect(contaDoIndicador(2, 3, 100)).toBe('2 ÷ 3 × 100 = 66,67');
  });
  it('sem denominador positivo não há valor; o de contagem é o numerador', () => {
    expect(valorPelasParcelas(1, 0, 1000)).toBeNull();
    expect(contaDoIndicador(1, 0, 1000)).toBeNull();
    expect(valorPelasParcelas(12, null, 1)).toBe(12);
    expect(contaDoIndicador(12, null, 1)).toBe('12 = 12');
  });
  it('situação pela polaridade', () => {
    expect(situacaoMetaQualidade('menor-melhor', 2, 2.4)).toBe('fora-da-meta');
    expect(situacaoMetaQualidade('menor-melhor', 2, 2)).toBe('na-meta');
    expect(situacaoMetaQualidade('maior-melhor', 80, 79.9)).toBe('fora-da-meta');
    expect(situacaoMetaQualidade('maior-melhor', 80, 80)).toBe('na-meta');
    expect(situacaoMetaQualidade('neutra', 10, 5)).toBe('sem-meta');
    expect(situacaoMetaQualidade('faixa', 10, 5)).toBe('sem-meta');
    expect(situacaoMetaQualidade('menor-melhor', null, 5)).toBe('sem-meta');
    expect(situacaoMetaQualidade('menor-melhor', 2, null)).toBe('sem-valor');
  });
});

describe('análise crítica', () => {
  const r = (
    entrada: Partial<typeof base>,
    situacaoMeta = 'na-meta' as const,
    existente = null as null | { id: number; versao: number },
  ) => recusaAnaliseIndicador({ entrada: { ...base, ...entrada }, situacaoMeta, existente, agora: AGORA });
  it('competência fechada na meta: aceita sem plano', () => {
    expect(r({})).toBeNull();
  });
  it('competência corrente ou futura: recusa', () => {
    expect(r({ competencia: '2026-10' })).toBe('competencia-aberta');
    expect(r({ competencia: '2026-11' })).toBe('competencia-aberta');
  });
  it('sem valor apurado: recusa', () => {
    expect(
      recusaAnaliseIndicador({ entrada: base, situacaoMeta: 'sem-valor', existente: null, agora: AGORA }),
    ).toBe('sem-valor');
  });
  it('uma por indicador e competência; a alteração confere o ID e a versão', () => {
    expect(r({}, 'na-meta', { id: 5, versao: 1 })).toBe('analise-ja-registrada');
    expect(r({ analise: 5, versao: 1 }, 'na-meta', null)).toBe('analise-inexistente');
    expect(r({ analise: 6, versao: 1 }, 'na-meta', { id: 5, versao: 1 })).toBe('analise-inexistente');
    expect(r({ analise: 5, versao: 1 }, 'na-meta', { id: 5, versao: 2 })).toBe('versao-desatualizada');
    expect(r({ analise: 5, versao: 2 }, 'na-meta', { id: 5, versao: 2 })).toBeNull();
  });
  it('fora da meta: causas, plano, responsável e prazo depois da competência', () => {
    expect(
      recusaAnaliseIndicador({ entrada: base, situacaoMeta: 'fora-da-meta', existente: null, agora: AGORA }),
    ).toBe('plano-obrigatorio');
    const completo = {
      ...base,
      causas: 'Troca de equipe e falha no bundle de inserção.',
      plano: 'Retreinar o bundle de CVC e auditar semanalmente.',
      responsavel: 'Enfermeira da CCIH',
      prazo: '2026-12-15',
    };
    expect(
      recusaAnaliseIndicador({
        entrada: completo,
        situacaoMeta: 'fora-da-meta',
        existente: null,
        agora: AGORA,
      }),
    ).toBeNull();
    expect(
      recusaAnaliseIndicador({
        entrada: { ...completo, prazo: '2026-09-30' },
        situacaoMeta: 'fora-da-meta',
        existente: null,
        agora: AGORA,
      }),
    ).toBe('prazo-antes-da-competencia');
  });
  it('responsável e prazo juntos: um sem o outro recusa, mesmo na meta', () => {
    expect(r({ responsavel: 'Enfermeira da CCIH', prazo: null })).toBe('plano-incompleto');
    expect(r({ responsavel: '   ', prazo: '2026-12-15' })).toBe('plano-incompleto');
    expect(r({ plano: 'Só a ação proposta, sem dono.', responsavel: null, prazo: null })).toBeNull();
    expect(r({ responsavel: 'Enfermeira da CCIH', prazo: '2026-12-15' })).toBeNull();
  });
  it('pendência: fechada sem análise, ou fora da meta sem plano', () => {
    const p = (
      competencia: string,
      situacaoMeta: 'na-meta' | 'fora-da-meta' | 'sem-valor',
      analise: { plano: string | null } | null,
    ) => analisePendente({ competencia, agora: AGORA, situacaoMeta, analise });
    expect(p('2026-09', 'na-meta', null)).toBe(true);
    expect(p('2026-09', 'na-meta', { plano: null })).toBe(false);
    expect(p('2026-09', 'fora-da-meta', { plano: null })).toBe(true);
    expect(p('2026-09', 'fora-da-meta', { plano: 'Plano' })).toBe(false);
    expect(p('2026-10', 'na-meta', null)).toBe(false);
    expect(p('2026-09', 'sem-valor', null)).toBe(false);
  });
});
