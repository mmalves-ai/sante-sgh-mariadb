// Gestão documental (revisão, aprovação por outra pessoa, vigência e ciência) e as utilidades de data e número.
import { describe, expect, it } from 'vitest';
import {
  competenciaAnterior,
  competenciaDe,
  competenciaFechada,
  diasDaCompetenciaQualidade,
  noFuturo,
  numeroBr,
  somarDiasData,
  somarMeses,
} from './comum.js';
import {
  conferirPublicacao,
  recusaCiencia,
  recusaRetirada,
  revisaoVencida,
  textoParaResumoDocumento,
  vigenciaPadraoDocumento,
} from './documentos.js';

const HOJE = '2026-10-27';
const entrada = {
  codigo: 'POP-ENF-001',
  elaboradoPor: 'ENF.ANA',
  revisadoPor: null,
  vigenciaAte: '2028-10-27',
  substitui: null,
};

describe('publicação do documento', () => {
  it('primeira revisão de um código novo', () => {
    expect(conferirPublicacao({ entrada, aprovador: 'qual.bia', hoje: HOJE, doCodigo: [] })).toEqual({
      revisao: 1,
    });
  });
  it('quem aprova não elabora; o revisor também é outra pessoa', () => {
    expect(conferirPublicacao({ entrada, aprovador: 'enf.ana', hoje: HOJE, doCodigo: [] })).toEqual({
      recusa: 'aprovador-e-elaborador',
    });
    expect(
      conferirPublicacao({
        entrada: { ...entrada, revisadoPor: 'ENF.ANA' },
        aprovador: 'QUAL.BIA',
        hoje: HOJE,
        doCodigo: [],
      }),
    ).toEqual({ recusa: 'revisor-e-elaborador' });
  });
  it('vigência futura e de até cinco anos', () => {
    expect(
      conferirPublicacao({
        entrada: { ...entrada, vigenciaAte: HOJE },
        aprovador: 'QUAL.BIA',
        hoje: HOJE,
        doCodigo: [],
      }),
    ).toEqual({ recusa: 'vigencia-no-passado' });
    expect(
      conferirPublicacao({
        entrada: { ...entrada, vigenciaAte: '2031-10-28' },
        aprovador: 'QUAL.BIA',
        hoje: HOJE,
        doCodigo: [],
      }),
    ).toEqual({ recusa: 'vigencia-longa' });
    expect(
      conferirPublicacao({
        entrada: { ...entrada, vigenciaAte: '2031-10-27' },
        aprovador: 'QUAL.BIA',
        hoje: HOJE,
        doCodigo: [],
      }),
    ).toEqual({ revisao: 1 });
  });
  it('código com revisão vigente: só como revisão que substitui a vigente, na versão lida', () => {
    const doCodigo = [
      { id: 10, versao: 1, codigo: 'POP-ENF-001', revisao: 1, situacao: 'obsoleto' as const },
      { id: 11, versao: 2, codigo: 'POP-ENF-001', revisao: 2, situacao: 'vigente' as const },
    ];
    const p = (substitui: { id: number; versao: number } | null) =>
      conferirPublicacao({ entrada: { ...entrada, substitui }, aprovador: 'QUAL.BIA', hoje: HOJE, doCodigo });
    expect(p(null)).toEqual({ recusa: 'codigo-ja-vigente' });
    expect(p({ id: 99, versao: 1 })).toEqual({ recusa: 'substituta-de-outro-codigo' });
    expect(p({ id: 10, versao: 1 })).toEqual({ recusa: 'substituta-nao-vigente' });
    expect(p({ id: 11, versao: 1 })).toEqual({ recusa: 'versao-desatualizada' });
    expect(p({ id: 11, versao: 2 })).toEqual({ revisao: 3 });
  });
  it('código só com revisões fora de uso: nova revisão numerada depois da última', () => {
    const doCodigo = [
      { id: 10, versao: 3, codigo: 'POP-ENF-001', revisao: 4, situacao: 'retirado' as const },
    ];
    expect(conferirPublicacao({ entrada, aprovador: 'QUAL.BIA', hoje: HOJE, doCodigo })).toEqual({
      revisao: 5,
    });
  });
});

describe('retirada, ciência e revisão vencida', () => {
  it('retira só a vigente, na versão lida', () => {
    expect(recusaRetirada({ versao: 2, situacao: 'vigente' }, 2)).toBeNull();
    expect(recusaRetirada({ versao: 2, situacao: 'vigente' }, 1)).toBe('versao-desatualizada');
    expect(recusaRetirada({ versao: 2, situacao: 'obsoleto' }, 2)).toBe('documento-nao-vigente');
  });
  it('ciência uma vez, da vigente', () => {
    expect(recusaCiencia({ situacao: 'vigente' }, false)).toBeNull();
    expect(recusaCiencia({ situacao: 'vigente' }, true)).toBe('ciencia-ja-registrada');
    expect(recusaCiencia({ situacao: 'retirado' }, false)).toBe('documento-nao-vigente');
  });
  it('revisão vencida só na vigente com a data de revisão passada', () => {
    expect(revisaoVencida({ situacao: 'vigente', vigenciaAte: '2026-10-26' }, HOJE)).toBe(true);
    expect(revisaoVencida({ situacao: 'vigente', vigenciaAte: HOJE }, HOJE)).toBe(false);
    expect(revisaoVencida({ situacao: 'obsoleto', vigenciaAte: '2020-01-01' }, HOJE)).toBe(false);
  });
  it('vigência padrão de dois anos e o texto do resumo normalizado', () => {
    expect(vigenciaPadraoDocumento('2026-10-27T09:00:00')).toBe('2028-10-27');
    expect(
      textoParaResumoDocumento({ codigo: 'POP-1', revisao: 2, titulo: ' Título ', conteudo: 'a\r\nb \n' }),
    ).toBe('POP-1\n2\nTítulo\na\nb');
  });
});

describe('utilidades', () => {
  it('número no formato brasileiro', () => {
    expect(numeroBr(1234567.891)).toBe('1.234.567,89');
    expect(numeroBr(1000, 0)).toBe('1.000');
    expect(numeroBr(2.4)).toBe('2,4');
    expect(numeroBr(-3.5)).toBe('-3,5');
    expect(numeroBr(0)).toBe('0');
  });
  it('datas, meses e competência', () => {
    expect(somarDiasData('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2026-03-15', -3)).toBe('2025-12-15');
    expect(competenciaDe('2026-10-27T10:00')).toBe('2026-10');
    expect(competenciaAnterior('2026-01')).toBe('2025-12');
    expect(competenciaFechada('2026-09', '2026-10-01T00:00')).toBe(true);
    expect(competenciaFechada('2026-10', '2026-10-31T23:59')).toBe(false);
    expect(diasDaCompetenciaQualidade('2028-02')).toEqual({ de: '2028-02-01', ate: '2028-02-29' });
  });
  it('futuro com a tolerância de 5 minutos', () => {
    expect(noFuturo('2026-10-27T10:04', '2026-10-27T10:00')).toBe(false);
    expect(noFuturo('2026-10-27T10:06', '2026-10-27T10:00')).toBe(true);
  });
});
