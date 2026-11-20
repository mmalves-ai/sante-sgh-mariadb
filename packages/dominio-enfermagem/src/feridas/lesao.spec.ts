// W0-03, mercado M4: as regras das feridas e da LPP (sem banco): a ficha conferida (estágio NPUAP, profundidade,
// tecidos, janela da admissão), a versão do autor, a área e a evolução, a sugestão ao NSP e a incidência com o numerador
// e o denominador. Dados sintéticos.
import { esquemaCurativo, esquemaDadosLesao, esquemaVersaoLesao, type DadosLesao } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  areaLesao,
  conferirCurativo,
  conferirLesao,
  conferirVersaoLesao,
  evolucaoLesao,
  incidenciaLpp,
  origemDaLesao,
  sugestaoNotificacaoLpp,
  type LesaoParaIncidencia,
} from './lesao.js';

const LEITO = {
  granulacao: 70,
  epitelizacao: 10,
  esfacelo: 20,
  necrose: 0,
  exsudato: 'escasso' as const,
  odor: false,
  sinaisInfeccao: false,
  dor: 3,
};
const D: DadosLesao = {
  tipo: 'lpp',
  regiao: 'sacral',
  estagio: 'estagio2',
  relacionadaDispositivo: false,
  presenteNaAdmissao: false,
  identificadaEm: '2031-01-08T09:00',
  medidas: { comprimento: 3.5, largura: 2, profundidade: 0.2 },
  leito: LEITO,
  cobertura: 'hidrocoloide',
};
const ADM = '2031-01-05T14:00';
const AGORA = '2031-01-08T10:00';

describe('W0-03, M4: o contrato da lesão', () => {
  it('aceita a ficha completa e as medidas com uma casa; recusa medida com duas casas e região fora do mapa', () => {
    expect(esquemaDadosLesao.safeParse(D).success).toBe(true);
    expect(
      esquemaDadosLesao.safeParse({ ...D, medidas: { comprimento: 0.3, largura: 1.7, profundidade: null } })
        .success,
    ).toBe(true);
    expect(
      esquemaDadosLesao.safeParse({ ...D, medidas: { comprimento: 3.55, largura: 2, profundidade: null } })
        .success,
    ).toBe(false);
    expect(esquemaDadosLesao.safeParse({ ...D, regiao: 'joelho' }).success).toBe(false);
  });
  it('a versão aceita o motivo de 10 caracteres ou mais; o curativo exige leito e cobertura', () => {
    expect(esquemaVersaoLesao.safeParse({ dados: D, finalizar: true, motivo: 'curto' }).success).toBe(false);
    expect(
      esquemaVersaoLesao.safeParse({ dados: D, finalizar: true, motivo: 'medida trocada no lançamento' })
        .success,
    ).toBe(true);
    expect(
      esquemaCurativo.safeParse({ realizadoEm: AGORA, estagio: 'estagio2', medidas: null, leito: LEITO })
        .success,
    ).toBe(false);
  });
});

describe('W0-03, M4: a ficha conferida', () => {
  it('aceita a LPP adquirida (rascunho e finalizada) e a ferida sem estágio', () => {
    expect(conferirLesao(D, true, AGORA, ADM)).toBeNull();
    expect(conferirLesao({ ...D, medidas: null }, false, AGORA, ADM)).toBeNull();
    expect(conferirLesao({ ...D, tipo: 'cirurgica', estagio: null }, true, AGORA, ADM)).toBeNull();
  });
  it('o estágio NPUAP: obrigatório na LPP, proibido fora dela; sem profundidade no estágio 1 e na tissular profunda', () => {
    expect(conferirLesao({ ...D, estagio: null }, false, AGORA, ADM)?.codigo).toBe('lpp-sem-estagio');
    expect(conferirLesao({ ...D, tipo: 'venosa' }, false, AGORA, ADM)?.codigo).toBe('estagio-fora-da-lpp');
    expect(conferirLesao({ ...D, estagio: 'estagio1' }, false, AGORA, ADM)?.codigo).toBe(
      'profundidade-sem-perda-de-pele',
    );
    expect(conferirLesao({ ...D, estagio: 'tissularProfunda' }, false, AGORA, ADM)?.codigo).toBe(
      'profundidade-sem-perda-de-pele',
    );
    // O estágio 1 finaliza sem medida (eritema); os demais exigem.
    expect(conferirLesao({ ...D, estagio: 'estagio1', medidas: null }, true, AGORA, ADM)).toBeNull();
    expect(conferirLesao({ ...D, medidas: null }, true, AGORA, ADM)?.codigo).toBe('finalizada-sem-medidas');
  });
  it('os tecidos somam 100%; "outra" exige a descrição', () => {
    expect(conferirLesao({ ...D, leito: { ...LEITO, necrose: 10 } }, false, AGORA, ADM)?.codigo).toBe(
      'tecidos-sem-somar-100',
    );
    expect(conferirLesao({ ...D, regiao: 'outra' }, false, AGORA, ADM)?.codigo).toBe('regiao-sem-descricao');
    expect(conferirLesao({ ...D, cobertura: 'outra' }, false, AGORA, ADM)?.codigo).toBe(
      'cobertura-sem-descricao',
    );
  });
  it('a hora: nem do futuro nem antes da admissão; presente na admissão só até 24 horas', () => {
    expect(conferirLesao({ ...D, identificadaEm: '2031-01-08T10:01' }, false, AGORA, ADM)?.codigo).toBe(
      'identificada-no-futuro',
    );
    expect(conferirLesao({ ...D, identificadaEm: '2031-01-05T13:59' }, false, AGORA, ADM)?.codigo).toBe(
      'identificada-antes-da-admissao',
    );
    const naAdm = { ...D, presenteNaAdmissao: true };
    expect(conferirLesao({ ...naAdm, identificadaEm: '2031-01-06T14:00' }, false, AGORA, ADM)).toBeNull();
    expect(conferirLesao({ ...naAdm, identificadaEm: '2031-01-06T14:01' }, false, AGORA, ADM)?.codigo).toBe(
      'admissao-fora-da-janela',
    );
    expect(origemDaLesao(naAdm)).toBe('admitida');
    expect(origemDaLesao(D)).toBe('adquirida');
  });
  it('o curativo: não antes da lesão, estágio pela regra do tipo, leito somando 100%', () => {
    const c = {
      realizadoEm: AGORA,
      estagio: 'estagio2' as const,
      medidas: null,
      leito: LEITO,
      cobertura: 'espuma',
    };
    expect(conferirCurativo(c, 'lpp', D.identificadaEm, AGORA)).toBeNull();
    expect(
      conferirCurativo({ ...c, realizadoEm: '2031-01-08T08:59' }, 'lpp', D.identificadaEm, AGORA)?.codigo,
    ).toBe('curativo-antes-da-lesao');
    expect(conferirCurativo({ ...c, estagio: null }, 'lpp', D.identificadaEm, AGORA)?.codigo).toBe(
      'lpp-sem-estagio',
    );
    expect(conferirCurativo(c, 'cirurgica', D.identificadaEm, AGORA)?.codigo).toBe('estagio-fora-da-lpp');
    expect(
      conferirCurativo({ ...c, leito: { ...LEITO, granulacao: 60 } }, 'lpp', D.identificadaEm, AGORA)?.codigo,
    ).toBe('tecidos-sem-somar-100');
  });
});

describe('W0-03, M4: a versão da ficha (rascunho livre do autor; finalizada só por correção com justificativa)', () => {
  const r = { autor: 'ENF1', situacao: 'rascunho' as const, inativada: false, encerrada: false };
  const f = { ...r, situacao: 'finalizada' as const };
  it('o rascunho: o autor altera sem motivo; o motivo no rascunho é recusado', () => {
    expect(conferirVersaoLesao(r, 'enf1', { finalizar: false })).toBeNull();
    expect(conferirVersaoLesao(r, 'ENF1', { finalizar: true })).toBeNull();
    expect(conferirVersaoLesao(r, 'ENF1', { finalizar: false, motivo: 'qualquer motivo' })?.codigo).toBe(
      'rascunho-com-motivo',
    );
  });
  it('a finalizada: só o autor, com o motivo e finalizada; inativada e encerrada não recebem versão', () => {
    expect(conferirVersaoLesao(f, 'ENF2', { finalizar: true, motivo: 'medida trocada' })?.codigo).toBe(
      'so-o-autor',
    );
    expect(conferirVersaoLesao(f, 'ENF1', { finalizar: true })?.codigo).toBe('correcao-sem-motivo');
    expect(conferirVersaoLesao(f, 'ENF1', { finalizar: false, motivo: 'medida trocada' })?.codigo).toBe(
      'correcao-sem-motivo',
    );
    expect(conferirVersaoLesao(f, 'ENF1', { finalizar: true, motivo: 'medida trocada' })).toBeNull();
    expect(
      conferirVersaoLesao({ ...f, inativada: true }, 'ENF1', { finalizar: true, motivo: 'x'.repeat(10) })
        ?.codigo,
    ).toBe('inativada');
    expect(
      conferirVersaoLesao({ ...f, encerrada: true }, 'ENF1', { finalizar: true, motivo: 'x'.repeat(10) })
        ?.codigo,
    ).toBe('encerrada');
  });
});

describe('W0-03, M4: a área e a evolução pelos curativos', () => {
  it('área = comprimento × largura (duas casas)', () => {
    expect(areaLesao({ comprimento: 3.5, largura: 2, profundidade: null })).toBe(7);
    expect(areaLesao({ comprimento: 1.3, largura: 0.7, profundidade: 0.1 })).toBe(0.91);
    expect(areaLesao(null)).toBeNull();
  });
  it('a evolução usa só os vigentes, na ordem da hora; ±10% é estável', () => {
    const c = (realizadoEm: string, areaCm2: number | null, vigente = true) => ({
      realizadoEm,
      areaCm2,
      vigente,
    });
    expect(evolucaoLesao([c('2031-01-08T10:00', 7)])).toBeNull();
    expect(
      evolucaoLesao([c('2031-01-12T10:00', 3.5), c('2031-01-08T10:00', 7), c('2031-01-10T10:00', 99, false)]),
    ).toEqual({ primeira: 7, ultima: 3.5, variacaoPercentual: -50, tendencia: 'melhora' });
    expect(evolucaoLesao([c('2031-01-08T10:00', 10), c('2031-01-09T10:00', 10.9)])?.tendencia).toBe(
      'estavel',
    );
    expect(evolucaoLesao([c('2031-01-08T10:00', 10), c('2031-01-09T10:00', 12)])?.tendencia).toBe('piora');
  });
});

describe('W0-03, M4: a sugestão ao NSP e a incidência de LPP', () => {
  const base = {
    tipo: 'lpp' as const,
    estagio: 'estagio2' as const,
    presenteNaAdmissao: false,
    situacao: 'finalizada' as const,
    inativada: false,
  };
  it('sugere só a LPP adquirida, finalizada e não inativada; grave nos estágios 3, 4, não classificável e tissular profunda', () => {
    expect(sugestaoNotificacaoLpp(base)).toEqual({ sugerir: true, grave: false });
    expect(sugestaoNotificacaoLpp({ ...base, estagio: 'estagio3' })).toEqual({ sugerir: true, grave: true });
    expect(sugestaoNotificacaoLpp({ ...base, estagio: 'tissularProfunda' }).grave).toBe(true);
    expect(sugestaoNotificacaoLpp({ ...base, presenteNaAdmissao: true }).sugerir).toBe(false);
    expect(sugestaoNotificacaoLpp({ ...base, situacao: 'rascunho' }).sugerir).toBe(false);
    expect(sugestaoNotificacaoLpp({ ...base, inativada: true }).sugerir).toBe(false);
    expect(sugestaoNotificacaoLpp({ ...base, tipo: 'cirurgica', estagio: null }).sugerir).toBe(false);
  });
  it('a incidência: adquiridas do período por 1.000 pacientes-dia e pacientes com LPP sobre internados, com a impressão', () => {
    const l = (
      paciente: number,
      identificadaEm: string,
      extra: Partial<LesaoParaIncidencia> = {},
    ): LesaoParaIncidencia => ({
      ...base,
      paciente,
      identificadaEm,
      ...extra,
    });
    const r = incidenciaLpp(
      [
        l(1, '2031-01-03T10:00'),
        l(1, '2031-01-04T10:00', { estagio: 'estagio3' }),
        l(2, '2031-01-20T10:00'),
        l(3, '2031-01-05T10:00', { presenteNaAdmissao: true }), // admitida: fora
        l(4, '2031-01-06T10:00', { inativada: true }), // lançada errada: fora
        l(5, '2031-01-06T10:00', { situacao: 'rascunho' }), // rascunho: fora
        l(6, '2031-02-01T10:00'), // fora do período
      ],
      400,
      50,
      '2031-01-01',
      '2031-01-31',
    );
    expect(r.densidade).toEqual({ numerador: 3, denominador: 400, por1000: 7.5 });
    expect(r.pacientes).toEqual({ numerador: 2, denominador: 50, percentual: 4 });
    expect(r.porEstagio).toEqual({ estagio2: 2, estagio3: 1 });
    expect(r.impressao).toContain('3 / 400 pacientes-dia');
    expect(r.impressao).toContain('2 / 50 internados');
    expect(incidenciaLpp([], 0, 0, '2031-01-01', '2031-01-31').densidade.por1000).toBeNull();
  });
});
