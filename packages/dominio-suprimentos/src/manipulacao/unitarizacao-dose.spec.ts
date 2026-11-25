// C2-092 (05-SUP linha 11): a ordem de fracionamento e unitarização pela regra do insumo, a validade da dose pela
// RDC 67/2007 da ANVISA e o rótulo de cada dose com o lote de origem.
import { describe, expect, it } from 'vitest';
import {
  conferirRegraFracionamento,
  conferirUnitarizacao,
  identificadorEtiqueta,
  rendimentoPrevisto,
  rotuloDaDose,
  type UnitarizacaoParaConferir,
  validadeDaDose,
} from '../index.js';

const base: UnitarizacaoParaConferir = {
  regra: { ativa: true, quantidadeOrigem: 1, rendimento: 4, validadeHoras: null, exigeCapela: false },
  tipo: 'fracionamento',
  quantidadeOrigem: 2,
  doses: 7,
  perda: 1,
  capela: null,
  lote: { validade: '2027-06-30', situacao: 'liberado', bloqueado: false, saldo: 10 },
  hoje: '2026-11-25',
  percentualEstabilidade: null,
  observacao: null,
};
const codigos = (x: Partial<UnitarizacaoParaConferir>) =>
  conferirUnitarizacao({ ...base, ...x }).map((r) => r.codigo);

describe('ordem de unitarização pela regra de fracionamento', () => {
  it('o rendimento previsto é proporcional à quantidade de origem aberta', () => {
    expect(rendimentoPrevisto({ quantidadeOrigem: 1, rendimento: 4 }, 2)).toBe(8);
    expect(rendimentoPrevisto({ quantidadeOrigem: 10, rendimento: 2 }, 5)).toBe(1);
    expect(rendimentoPrevisto({ quantidadeOrigem: 1, rendimento: 4 }, 0)).toBe(0);
  });

  it('aceita a ordem dentro do rendimento, com o lote liberado e no prazo', () => {
    expect(conferirUnitarizacao(base)).toEqual([]);
    expect(codigos({ doses: 8, perda: 0 })).toEqual([]);
  });

  it('recusa sem regra, regra inativa e tipo fora da lista', () => {
    expect(codigos({ regra: null })).toEqual(['regra-inexistente']);
    expect(codigos({ regra: { ...base.regra!, ativa: false } })).toContain('regra-inativa');
    expect(codigos({ tipo: 'mistura' })).toContain('tipo-invalido');
  });

  it('exige o lote de origem liberado, no prazo e com saldo (rastreio da dose até o lote)', () => {
    expect(codigos({ lote: null })).toEqual(['lote-origem-obrigatorio']);
    expect(codigos({ lote: { ...base.lote!, situacao: 'bloqueado' } })).toContain('lote-bloqueado');
    expect(codigos({ lote: { ...base.lote!, bloqueado: true } })).toContain('lote-bloqueado');
    expect(codigos({ lote: { ...base.lote!, validade: '2026-11-24' } })).toContain('lote-vencido');
    expect(codigos({ lote: { ...base.lote!, saldo: 1 } })).toContain('saldo-insuficiente');
  });

  it('recusa doses acima do rendimento, doses fracionárias, perda negativa e capela que falta', () => {
    expect(codigos({ doses: 8, perda: 1 })).toEqual(['rendimento-acima']);
    expect(codigos({ doses: 2.5 })).toContain('doses-invalidas');
    expect(codigos({ doses: 0 })).toContain('doses-invalidas');
    expect(codigos({ perda: -1 })).toContain('perda-invalida');
    expect(codigos({ quantidadeOrigem: 0 })).toContain('quantidade-origem-invalida');
    expect(codigos({ regra: { ...base.regra!, exigeCapela: true } })).toEqual(['capela-obrigatoria']);
    expect(codigos({ regra: { ...base.regra!, exigeCapela: true }, capela: 3 })).toEqual([]);
  });

  it('percentual de estabilidade acima de 25% só com justificativa; fora de 0 a 100 recusa', () => {
    expect(codigos({ percentualEstabilidade: 50 })).toEqual(['estabilidade-sem-justificativa']);
    expect(
      codigos({ percentualEstabilidade: 50, observacao: 'Estudo de estabilidade do fabricante' }),
    ).toEqual([]);
    expect(codigos({ percentualEstabilidade: 120 })).toEqual(['estabilidade-invalida']);
    expect(codigos({ percentualEstabilidade: 20 })).toEqual([]);
  });
});

describe('validade da dose fracionada (RDC 67/2007)', () => {
  const v = { executadaEm: '2026-11-25T10:00', validadeHoras: null, percentual: null };
  it('25% do prazo remanescente da embalagem original', () => {
    // 2026-11-25 → 2027-03-05 = 100 dias; 25% = 25 dias.
    expect(validadeDaDose({ ...v, validadeOriginal: '2027-03-05' })).toBe('2026-12-20');
  });
  it('nunca acima de 6 meses, nem depois da validade original', () => {
    expect(validadeDaDose({ ...v, validadeOriginal: '2036-11-25' })).toBe('2027-05-24');
    expect(validadeDaDose({ ...v, validadeOriginal: '2026-11-25' })).toBe('2026-11-25');
  });
  it('a validade depois da abertura da regra (horas) limita; o percentual justificado amplia', () => {
    expect(validadeDaDose({ ...v, validadeOriginal: '2027-03-05', validadeHoras: 24 })).toBe('2026-11-26');
    expect(validadeDaDose({ ...v, validadeOriginal: '2027-03-05', percentual: 50 })).toBe('2027-01-14');
  });
  it('lote vencido ou dado ilegível: sem validade', () => {
    expect(validadeDaDose({ ...v, validadeOriginal: '2026-11-24' })).toBeNull();
    expect(validadeDaDose({ ...v, executadaEm: '2026-11-25', validadeOriginal: '2027-01-01' })).toBeNull();
  });
});

describe('rótulo da dose', () => {
  it('leva o lote de origem, as duas validades, o farmacêutico e o código da etiqueta', () => {
    const id = identificadorEtiqueta(42);
    const r = rotuloDaDose({
      identificador: id,
      insumo: 'COMPRIMIDO SINTETICO 10 MG',
      quantidade: 1,
      unidade: 'CP',
      loteOrigem: 'L123',
      validadeOriginal: '2027-03-05',
      validadeNova: '2026-12-20',
      fracionadoEm: '2026-11-25T10:00',
      farmaceutico: 'FARMACEUTICO SINTETICO',
    });
    expect(r.identificador).toBe(id);
    expect(r.barras).toBe(id);
    expect(r.datamatrix).toContain('L123');
    expect(r.datamatrix).toContain('261220');
    expect(r.linhas).toEqual([
      'COMPRIMIDO SINTETICO 10 MG',
      '1 CP',
      'Lote de origem L123 · val. original 05/03/2027',
      'Fracionado em 25/11/2026 10:00 · validade 20/12/2026',
      'Farm. resp.: FARMACEUTICO SINTETICO',
    ]);
  });
});

describe('cadastro da regra de fracionamento', () => {
  const r = { origem: 1, resultante: 2, quantidadeOrigem: 1, rendimento: 4, validadeHoras: 24 };
  it('aceita a regra válida e recusa insumos iguais, quantidades e validade fora da faixa', () => {
    expect(conferirRegraFracionamento(r)).toEqual([]);
    expect(conferirRegraFracionamento({ ...r, validadeHoras: null })).toEqual([]);
    const c = (x: Partial<typeof r> & { validadeHoras?: number | null }) =>
      conferirRegraFracionamento({ ...r, ...x }).map((y) => y.codigo);
    expect(c({ resultante: 1 })).toEqual(['insumos-iguais']);
    expect(c({ quantidadeOrigem: 0 })).toEqual(['quantidade-origem-invalida']);
    expect(c({ rendimento: -1 })).toEqual(['rendimento-invalido']);
    expect(c({ validadeHoras: 0 })).toEqual(['validade-horas-invalida']);
    expect(c({ validadeHoras: 9000 })).toEqual(['validade-horas-invalida']);
  });
});
