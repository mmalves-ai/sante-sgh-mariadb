// Etapa 2 do M47 (regra 3): estoque de bolsas — recebimento com a quarentena, máquina de situações, vencidas,
// transfundida pelo ato e o painel por tipo.
import { describe, expect, it } from 'vitest';
import {
  acoesPossiveis,
  conferirMovimento,
  temperaturaNaFaixaDoHemocomponente,
  MENSAGENS_ESTOQUE,
  resumoEstoque,
  situacaoEfetiva,
  situacaoNoRecebimento,
  temperaturaNaFaixa,
  TIPO_DO_MOVIMENTO,
  venceEm,
  vencida,
} from './estoque.js';

const agora = '2026-10-25T10:00';

describe('recebimento', () => {
  const base = {
    classe: 'hemacias' as const,
    temperaturaC: 4,
    inspecaoOk: true,
    liberarNaEntrada: true,
    validade: '2026-11-20T00:00',
    agora,
  };
  it('liberada na entrada só com a inspeção e a temperatura boas', () => {
    expect(situacaoNoRecebimento(base)).toEqual({ situacao: 'liberada', bloqueios: [], alertas: [] });
    expect(situacaoNoRecebimento({ ...base, liberarNaEntrada: false }).situacao).toBe('quarentena');
  });
  it('temperatura fora da faixa ou inspeção reprovada: quarentena com o alerta', () => {
    expect(situacaoNoRecebimento({ ...base, temperaturaC: 12 })).toEqual({
      situacao: 'quarentena',
      bloqueios: [],
      alertas: ['temperatura-fora-da-faixa'],
    });
    expect(situacaoNoRecebimento({ ...base, inspecaoOk: false }).alertas).toEqual(['inspecao-reprovada']);
  });
  it('vencida não entra', () => {
    expect(situacaoNoRecebimento({ ...base, validade: '2026-10-25T09:59' }).bloqueios).toEqual([
      'bolsa-vencida-no-recebimento',
    ]);
  });
  it('faixas por classe', () => {
    expect(temperaturaNaFaixa('plaquetas', 22)).toBe(true);
    expect(temperaturaNaFaixa('plaquetas', 4)).toBe(false);
    expect(temperaturaNaFaixa('plasma', -25)).toBe(true);
    expect(temperaturaNaFaixa('crioprecipitado', -10)).toBe(false);
  });
});

describe('movimentos', () => {
  const m = (
    acao: Parameters<typeof conferirMovimento>[0]['acao'],
    situacao: Parameters<typeof conferirMovimento>[0]['situacao'],
    extra = {},
  ) =>
    conferirMovimento({
      acao,
      situacao,
      vencida: false,
      inspecaoOk: true,
      temperaturaNaFaixa: true,
      ...extra,
    });
  it('a máquina de situações', () => {
    expect(m('liberar', 'quarentena').para).toBe('liberada');
    expect(m('reservar', 'liberada').para).toBe('reservada');
    expect(m('cancelarReserva', 'reservada').para).toBe('liberada');
    expect(m('bloquear', 'reservada').para).toBe('quarentena');
    expect(m('descartar', 'quarentena').para).toBe('descartada');
    expect(m('devolver', 'liberada').para).toBe('devolvida');
  });
  it('as recusas: fora da máquina, vencida, inspeção pendente, transfundida', () => {
    expect(m('reservar', 'quarentena').bloqueios).toEqual(['movimento-invalido']);
    expect(m('liberar', 'descartada').bloqueios).toEqual(['movimento-invalido']);
    expect(m('reservar', 'liberada', { vencida: true }).bloqueios).toEqual(['bolsa-vencida']);
    expect(m('descartar', 'liberada', { vencida: true }).para).toBe('descartada');
    expect(m('liberar', 'quarentena', { inspecaoOk: false }).bloqueios).toEqual([
      'inspecao-pendente',
      'motivo-da-liberacao',
    ]);
    expect(m('devolver', 'transfundida').bloqueios).toEqual(['bolsa-transfundida']);
  });
  it('a quarentena da temperatura fora da faixa: a liberação pede o motivo', () => {
    expect(m('liberar', 'quarentena', { temperaturaNaFaixa: false }).bloqueios).toEqual([
      'motivo-da-liberacao',
    ]);
    expect(m('liberar', 'quarentena', { temperaturaNaFaixa: false, motivo: 'abc' }).bloqueios).toEqual([
      'motivo-da-liberacao',
    ]);
    const ok = m('liberar', 'quarentena', {
      temperaturaNaFaixa: false,
      motivo: 'Reaferida a 4 °C na geladeira',
    });
    expect(ok.para).toBe('liberada');
    expect(ok.reinspecao).toBe(false);
    // A bolsa boa em quarentena (sem liberar na entrada) sai sem motivo.
    expect(m('liberar', 'quarentena').bloqueios).toEqual([]);
  });
  it('a quarentena da inspeção reprovada: a saída é a reinspeção aprovada com o motivo, ou o descarte e a devolução', () => {
    expect(m('liberar', 'quarentena', { inspecaoOk: false, motivo: 'Rótulo reconferido' }).bloqueios).toEqual(
      ['inspecao-pendente'],
    );
    expect(m('liberar', 'quarentena', { inspecaoOk: false, inspecaoConferida: true }).bloqueios).toEqual([
      'motivo-da-liberacao',
    ]);
    const ok = m('liberar', 'quarentena', {
      inspecaoOk: false,
      inspecaoConferida: true,
      motivo: 'Reinspeção: rótulo legível, sem hemólise',
    });
    expect(ok.para).toBe('liberada');
    expect(ok.reinspecao).toBe(true);
    expect(m('descartar', 'quarentena', { inspecaoOk: false }).para).toBe('descartada');
    expect(m('devolver', 'quarentena', { inspecaoOk: false }).para).toBe('devolvida');
    expect(temperaturaNaFaixaDoHemocomponente('CH', 4)).toBe(true);
    expect(temperaturaNaFaixaDoHemocomponente('CH', 15)).toBe(false);
  });
  it('as ações que a tela oferece e o tipo do histórico', () => {
    expect(acoesPossiveis('liberada', false)).toEqual(['bloquear', 'reservar', 'descartar', 'devolver']);
    expect(acoesPossiveis('quarentena', true)).toEqual(['descartar', 'devolver']);
    expect(acoesPossiveis('transfundida', false)).toEqual([]);
    expect(TIPO_DO_MOVIMENTO.descartar).toBe('descarte');
  });
  it('a transfundida vem do ato', () => {
    expect(situacaoEfetiva('reservada', true)).toBe('transfundida');
    expect(situacaoEfetiva('reservada', false)).toBe('reservada');
  });
  it('toda recusa tem mensagem de produto', () => {
    for (const c of [
      'movimento-invalido',
      'bolsa-vencida',
      'inspecao-pendente',
      'motivo-da-liberacao',
      'bolsa-transfundida',
      'local-inexistente',
      'motivo-inexistente',
    ])
      expect(MENSAGENS_ESTOQUE[c]).toBeTruthy();
  });
});

describe('validade e painel', () => {
  it('vencida e vence em N dias', () => {
    expect(vencida('2026-10-25T10:00', agora)).toBe(true);
    expect(vencida('2026-10-25T10:01', agora)).toBe(false);
    expect(venceEm('2026-10-27T09:00', agora, 3)).toBe(true);
    expect(venceEm('2026-10-30T09:00', agora, 3)).toBe(false);
  });
  it('o painel conta as utilizáveis por tipo (fora as vencidas, as transfundidas e as descartadas)', () => {
    const b = (
      situacao: 'liberada' | 'reservada' | 'quarentena' | 'descartada',
      validade = '2026-11-20T00:00',
      abo: 'O' | 'A' = 'O',
    ) => ({
      hemocomponente: 'CH',
      abo,
      rh: 'positivo' as const,
      situacao,
      validade,
    });
    const r = resumoEstoque(
      [
        b('liberada'),
        b('liberada', '2026-10-26T00:00'),
        b('reservada'),
        b('quarentena'),
        b('descartada'),
        b('liberada', '2026-10-01T00:00'),
        b('liberada', '2026-11-20T00:00', 'A'),
      ],
      agora,
    );
    expect(r).toEqual([
      {
        hemocomponente: 'CH',
        abo: 'A',
        rh: 'positivo',
        liberadas: 1,
        reservadas: 0,
        quarentena: 0,
        vencendo: 0,
      },
      {
        hemocomponente: 'CH',
        abo: 'O',
        rh: 'positivo',
        liberadas: 2,
        reservadas: 1,
        quarentena: 1,
        vencendo: 1,
      },
    ]);
  });
});
