import { describe, expect, it } from 'vitest';
import {
  conferirEntregaNoCalendario,
  entregasAFrente,
  type JanelaEntrega,
  pagamentoPrevistoDaJanela,
  proximaEntrega,
  situacaoDaJanela,
  validarJanelaEntrega,
} from './calendario-entrega.js';

const j = (x: Partial<JanelaEntrega> = {}): JanelaEntrega => ({
  competencia: '2026-10-01',
  entregaInicio: '2026-11-05',
  entregaFim: '2026-11-10',
  pagamentoPrevisto: null,
  prazoPagamentoDias: null,
  restritivo: false,
  ...x,
});

describe('calendário de entrega da fatura', () => {
  it('valida a janela: competência no dia 1, fim depois do início, pagamento depois da entrega, prazo positivo', () => {
    expect(validarJanelaEntrega(j())).toBeNull();
    expect(validarJanelaEntrega(j({ competencia: '2026-10-15' }))?.codigo).toBe('competencia-invalida');
    expect(validarJanelaEntrega(j({ entregaFim: '2026-11-04' }))?.codigo).toBe('janela-invertida');
    expect(validarJanelaEntrega(j({ pagamentoPrevisto: '2026-11-01' }))?.codigo).toBe(
      'pagamento-antes-da-entrega',
    );
    expect(validarJanelaEntrega(j({ prazoPagamentoDias: 0 }))?.codigo).toBe('prazo-invalido');
    expect(validarJanelaEntrega(j({ entregaInicio: '05/11/2026' }))).toMatchObject({
      codigo: 'data-invalida',
      campos: ['entregaInicio'],
    });
  });

  it('situação da janela e pagamento previsto (data fixa ou fim mais o prazo)', () => {
    expect(situacaoDaJanela(j(), '2026-11-04')).toBe('futura');
    expect(situacaoDaJanela(j(), '2026-11-10')).toBe('aberta');
    expect(situacaoDaJanela(j(), '2026-11-11')).toBe('encerrada');
    expect(pagamentoPrevistoDaJanela(j({ pagamentoPrevisto: '2026-12-20', prazoPagamentoDias: 30 }))).toBe(
      '2026-12-20',
    );
    expect(pagamentoPrevistoDaJanela(j({ prazoPagamentoDias: 30 }))).toBe('2026-12-10');
    expect(pagamentoPrevistoDaJanela(j())).toBeNull();
  });

  it('próxima entrega: a aberta antes da futura; dias até o fim ou até o início; nada à frente dá nulo', () => {
    const aberta = j({ competencia: '2026-10-01', entregaInicio: '2026-11-01', entregaFim: '2026-11-30' });
    const futura = j({ competencia: '2026-11-01', entregaInicio: '2026-12-05', entregaFim: '2026-12-10' });
    const velha = j({ competencia: '2026-09-01', entregaInicio: '2026-10-05', entregaFim: '2026-10-10' });
    expect(proximaEntrega([futura, velha, aberta], '2026-11-25')).toMatchObject({
      janela: aberta,
      situacao: 'aberta',
      dias: 5,
    });
    expect(proximaEntrega([futura, velha], '2026-11-25')).toMatchObject({
      janela: futura,
      situacao: 'futura',
      dias: 10,
    });
    expect(proximaEntrega([velha], '2026-11-25')).toBeNull();
    expect(entregasAFrente([futura, velha, aberta, futura], '2026-11-25')).toEqual([
      '2026-11-01',
      '2026-12-05',
    ]);
  });

  it('entrega fora da janela: só a competência restritiva recusa; dentro de qualquer janela dela passa', () => {
    const r1 = j({ restritivo: true });
    const r2 = j({ restritivo: true, entregaInicio: '2026-11-20', entregaFim: '2026-11-22' });
    const livre = j({ competencia: '2026-09-01' });
    expect(conferirEntregaNoCalendario([r1, r2], ['2026-10-01'], '2026-11-07')).toBeNull();
    expect(conferirEntregaNoCalendario([r1, r2], ['2026-10-01'], '2026-11-21')).toBeNull();
    const recusa = conferirEntregaNoCalendario([r1, r2, livre], ['2026-09-01', '2026-10-01'], '2026-11-15');
    expect(recusa).toMatchObject({ codigo: 'entrega-fora-da-janela', campos: ['data'] });
    expect(recusa?.mensagem).toContain('2026-10');
    expect(recusa?.mensagem).toContain('2026-11-05 a 2026-11-10; 2026-11-20 a 2026-11-22');
    // Sem janela restritiva (ou sem calendário da competência), a entrega passa: o painel só avisa.
    expect(conferirEntregaNoCalendario([livre], ['2026-09-01'], '2027-01-01')).toBeNull();
    expect(conferirEntregaNoCalendario([r1], ['2026-08-01'], '2027-01-01')).toBeNull();
  });
});
