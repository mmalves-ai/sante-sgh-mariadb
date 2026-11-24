import { describe, expect, it } from 'vitest';
import {
  avaliarValor,
  conferirDigitacao,
  conferirLiberacao,
  conferirRetificacao,
  type FaixaDoAnalito,
  liberacaoPrivativaDeMedico,
} from './ciclo.js';

const faixa: FaixaDoAnalito = {
  faixa: 1,
  minimo: 10,
  maximo: 20,
  criticoMinimo: 5,
  criticoMaximo: 30,
  absurdoMinimo: 0,
  absurdoMaximo: 100,
  texto: '10 a 20',
};
const faixas = new Map([[7, faixa]]);
const base = {
  situacaoExame: 'em_analise',
  retido: false,
  situacaoResultado: null,
  analitosDoExame: [7],
  faixas,
};

describe('ciclo do resultado', () => {
  it('interpreta o valor pela faixa congelada: crítico vence anormal; sem faixa, sem interpretação', () => {
    expect(avaliarValor(15, faixa)).toMatchObject({
      interpretacao: 'normal',
      anormal: false,
      critico: false,
    });
    expect(avaliarValor(9, faixa)).toMatchObject({ interpretacao: 'baixo', anormal: true, critico: false });
    expect(avaliarValor(21, faixa)).toMatchObject({ interpretacao: 'alto', anormal: true });
    expect(avaliarValor(4, faixa)).toMatchObject({ interpretacao: 'critico_baixo', critico: true });
    expect(avaliarValor(31, faixa)).toMatchObject({ interpretacao: 'critico_alto', critico: true });
    expect(avaliarValor(101, faixa).absurdo).toBe(true);
    expect(avaliarValor(15, null)).toMatchObject({ interpretacao: null, anormal: false });
  });

  it('digitação: exame na bancada, não retido, ainda não liberado, valores do exame e plausíveis', () => {
    expect(conferirDigitacao({ ...base, valores: [{ analito: 7, numero: 15, texto: null }] })).toBeNull();
    expect(conferirDigitacao({ ...base, valores: [] })).toBe('sem-valor');
    expect(conferirDigitacao({ ...base, valores: [{ analito: 7, numero: null, texto: ' ' }] })).toBe(
      'sem-valor',
    );
    expect(conferirDigitacao({ ...base, valores: [{ analito: 8, numero: 1, texto: null }] })).toBe(
      'analito-fora-do-exame',
    );
    const dois = [
      { analito: 7, numero: 1, texto: null },
      { analito: 7, numero: 2, texto: null },
    ];
    expect(conferirDigitacao({ ...base, valores: dois })).toBe('analito-repetido');
    expect(conferirDigitacao({ ...base, valores: [{ analito: 7, numero: 500, texto: null }] })).toBe(
      'valor-absurdo',
    );
    const v = [{ analito: 7, numero: 15, texto: null }];
    expect(conferirDigitacao({ ...base, retido: true, valores: v })).toBe('exame-retido');
    expect(conferirDigitacao({ ...base, situacaoExame: 'solicitado', valores: v })).toBe('exame-fechado');
    expect(conferirDigitacao({ ...base, situacaoResultado: 'liberado', valores: v })).toBe('ja-liberado');
    expect(conferirDigitacao({ ...base, situacaoResultado: 'digitado', valores: v })).toBeNull();
  });

  it('liberação: só o digitado, não retido e por quem é habilitado', () => {
    expect(conferirLiberacao({ situacaoResultado: 'digitado', retido: false, habilitado: true })).toBeNull();
    expect(conferirLiberacao({ situacaoResultado: 'digitado', retido: true, habilitado: true })).toBe(
      'exame-retido',
    );
    expect(conferirLiberacao({ situacaoResultado: null, retido: false, habilitado: true })).toBe(
      'nao-digitado',
    );
    expect(conferirLiberacao({ situacaoResultado: 'liberado', retido: false, habilitado: true })).toBe(
      'ja-liberado',
    );
    expect(conferirLiberacao({ situacaoResultado: 'digitado', retido: false, habilitado: false })).toBe(
      'nao-habilitado',
    );
    expect(liberacaoPrivativaDeMedico('imagem')).toBe(true);
    expect(liberacaoPrivativaDeMedico('laboratorio')).toBe(false);
  });

  it('retificação: só do liberado, com motivo, habilitação e mudança', () => {
    const r = { situacaoResultado: 'liberado', motivo: 'Erro de transcrição', habilitado: true, mudou: true };
    expect(conferirRetificacao(r)).toBeNull();
    expect(conferirRetificacao({ ...r, situacaoResultado: 'retificado' })).toBeNull();
    expect(conferirRetificacao({ ...r, situacaoResultado: 'digitado' })).toBe('nao-liberado');
    expect(conferirRetificacao({ ...r, motivo: 'curto' })).toBe('motivo-curto');
    expect(conferirRetificacao({ ...r, habilitado: false })).toBe('nao-habilitado');
    expect(conferirRetificacao({ ...r, mudou: false })).toBe('sem-mudanca');
  });
});
