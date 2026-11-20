import { describe, expect, it } from 'vitest';
import {
  apurarLimpeza,
  csvIndicadoresGiro,
  type EtapaGravadaGiro,
  linhasIndicadoresGiro,
  type LimpezaDoPeriodo,
  valoresGiro,
} from './indicadores-giro.js';

const e = (
  etapa: EtapaGravadaGiro['etapa'],
  em: string,
  x: Partial<Omit<EtapaGravadaGiro, 'etapa' | 'em'>> = {},
): EtapaGravadaGiro => ({ etapa, em, prazo: null, tipoLimpeza: null, profissional: null, ...x });

/** Solicitada às 10:00, prazo 11:00; execução 10:10–10:30, pausa até 10:40, conclusão 10:50; liberada às 10:55. */
const NO_PRAZO: LimpezaDoPeriodo = {
  solicitacao: 1,
  solicitadaEm: '2026-07-10T10:00:00',
  area: '3',
  etapas: [
    e('atribuido', '2026-07-10T10:05:00', { prazo: '2026-07-10T11:00:00', tipoLimpeza: 4, profissional: 7 }),
    e('emExecucao', '2026-07-10T10:10:00'),
    e('pausado', '2026-07-10T10:30:00'),
    e('emExecucao', '2026-07-10T10:40:00'),
    e('concluido', '2026-07-10T10:50:00'),
    e('inspecionado', '2026-07-10T10:52:00'),
    e('liberado', '2026-07-10T10:55:00'),
  ],
};
/** Solicitada às 08:00, prazo 09:00, liberada às 09:30 (atrasada); execução 08:20–09:20. */
const ATRASADA: LimpezaDoPeriodo = {
  solicitacao: 2,
  solicitadaEm: '2026-07-11T08:00:00',
  area: '5',
  etapas: [
    e('atribuido', '2026-07-11T08:10:00', { prazo: '2026-07-11T09:00:00', tipoLimpeza: 1, profissional: 7 }),
    e('emExecucao', '2026-07-11T08:20:00'),
    e('concluido', '2026-07-11T09:20:00'),
    e('inspecionado', '2026-07-11T09:25:00'),
    e('liberado', '2026-07-11T09:30:00'),
  ],
};
/** Liberada sem prazo gravado: conta no giro, fica fora do denominador do percentual no prazo. */
const SEM_PRAZO: LimpezaDoPeriodo = {
  solicitacao: 3,
  solicitadaEm: '2026-07-12T12:00:00',
  area: '3',
  etapas: [
    e('emExecucao', '2026-07-12T12:30:00'),
    e('concluido', '2026-07-12T12:45:00'),
    e('liberado', '2026-07-12T13:00:00'),
  ],
};
const CANCELADA: LimpezaDoPeriodo = {
  solicitacao: 4,
  solicitadaEm: '2026-07-12T12:00:00',
  area: '3',
  etapas: [e('cancelado', '2026-07-12T12:10:00')],
};

describe('indicadores de higienização e giro de leito (W0-07, M3)', () => {
  it('apura giro, execução sem as pausas e prazo de cada limpeza liberada no período', () => {
    expect(apurarLimpeza(NO_PRAZO, '2026-07-01', '2026-07-31')).toEqual({
      solicitacao: 1,
      minutosGiro: 55,
      minutosExecucao: 30,
      noPrazo: true,
      tipo: 4,
      area: '3',
      profissional: 7,
    });
    expect(apurarLimpeza(ATRASADA, '2026-07-01', '2026-07-31')).toMatchObject({
      minutosGiro: 90,
      minutosExecucao: 60,
      noPrazo: false,
    });
    expect(apurarLimpeza(SEM_PRAZO, '2026-07-01', '2026-07-31')).toMatchObject({
      minutosGiro: 60,
      noPrazo: null,
      tipo: null,
    });
  });

  it('a cancelada, a não liberada e a liberada fora do período não entram', () => {
    expect(apurarLimpeza(CANCELADA, '2026-07-01', '2026-07-31')).toBeNull();
    expect(
      apurarLimpeza({ ...NO_PRAZO, etapas: NO_PRAZO.etapas.slice(0, 5) }, '2026-07-01', '2026-07-31'),
    ).toBeNull();
    expect(apurarLimpeza(NO_PRAZO, '2026-07-11', '2026-07-31')).toBeNull();
  });

  it('o valor de cada indicador sai do numerador e do denominador (casos de referência)', () => {
    const itens = [NO_PRAZO, ATRASADA, SEM_PRAZO, CANCELADA]
      .map((l) => apurarLimpeza(l, '2026-07-01', '2026-07-31'))
      .filter((x) => x !== null);
    expect(valoresGiro(itens)).toEqual({
      tempoGiroLeito: { numerador: 205, denominador: 3, valor: 68.3 },
      higienizacaoNoPrazo: { numerador: 1, denominador: 2, valor: 50 },
      tempoExecucaoLimpeza: { numerador: 105, denominador: 3, valor: 35 },
    });
    expect(valoresGiro([])).toEqual({
      tempoGiroLeito: { numerador: 0, denominador: 0, valor: null },
      higienizacaoNoPrazo: { numerador: 0, denominador: 0, valor: null },
      tempoExecucaoLimpeza: { numerador: 0, denominador: 0, valor: null },
    });
  });

  it('recorta por tipo, área e profissional, e exporta o CSV com numerador e denominador', () => {
    const itens = [NO_PRAZO, ATRASADA, SEM_PRAZO]
      .map((l) => apurarLimpeza(l, '2026-07-01', '2026-07-31'))
      .filter((x) => x !== null);
    const linhas = linhasIndicadoresGiro(itens, {
      tipo: (k) => (k === 4 ? 'Terminal' : 'Concorrente'),
      area: (k) => `Bloco ${k}`,
      profissional: () => 'Ana',
    });
    const prazo = linhas.filter((l) => l.codigo === 'higienizacaoNoPrazo');
    expect(prazo.map((l) => [l.recorte, l.rotulo, l.numerador, l.denominador, l.valor])).toEqual([
      ['total', 'Total', 1, 2, 50],
      ['tipo', 'Concorrente', 0, 1, 0],
      ['tipo', 'Não informado', 0, 0, null],
      ['tipo', 'Terminal', 1, 1, 100],
      ['area', 'Bloco 3', 1, 1, 100],
      ['area', 'Bloco 5', 0, 1, 0],
      ['profissional', 'Ana', 1, 2, 50],
      ['profissional', 'Não informado', 0, 0, null],
    ]);
    const giroArea3 = linhas.find(
      (l) => l.codigo === 'tempoGiroLeito' && l.recorte === 'area' && l.chave === '3',
    );
    expect(giroArea3).toMatchObject({ numerador: 115, denominador: 2, valor: 57.5, unidade: 'minutos' });
    const csv = csvIndicadoresGiro({ de: '2026-07-01', ate: '2026-07-31' }, linhas).split('\r\n');
    expect(csv[0]).toBe('Início;Fim;Indicador;Recorte;Grupo;Numerador;Denominador;Valor;Unidade');
    expect(csv).toContain(
      '2026-07-01;2026-07-31;Tempo médio de giro do leito (solicitação da limpeza até o leito liberado);Área;Bloco 3;115;2;57,5;minutos',
    );
    expect(csv).toContain(
      '2026-07-01;2026-07-31;Higienizações liberadas dentro do prazo;Total;Total;1;2;50;%',
    );
    expect(csv.length).toBe(linhas.length + 2);
  });
});
