// Regra 3 do M48: prazos regulatórios (72 h do óbito, 15º dia útil do mês seguinte, 60 dias da análise de causa raiz)
// com o calendário de feriados configurado. Calendário sintético; as contas estão escritas no teste.
import { describe, expect, it } from 'vitest';
import {
  calendarioDeFeriados,
  diaUtil,
  enesimoDiaUtilDoMes,
  feriadosMoveis,
  feriadosMoveisAusentes,
  instanteDeMs,
  msLocal,
  pascoa,
  prazoAnaliseCausaRaiz,
  prazoNotivisaMensal,
  prazoNotivisaObito,
  prazosDaNotificacao,
  proximoPrazoAberto,
  situacaoDoPrazo,
  type EstadoParaPrazos,
} from './prazos.js';

// Recorrentes como o cadastro grava (ano 9999) e um feriado de data única.
const CADASTRO = [
  { data: '9999-01-01', nome: 'Confraternização' },
  { data: '9999-11-02', nome: 'Finados' },
  { data: '9999-11-15', nome: 'Proclamação' },
  { data: '9999-11-20', nome: 'Consciência Negra' },
  { data: '2025-03-04', nome: 'Carnaval 2025' },
];
const FERIADOS = calendarioDeFeriados(CADASTRO, [2026, 2027]);

describe('calendário', () => {
  it('expande os recorrentes nos anos pedidos e mantém os de data única', () => {
    expect([...FERIADOS].sort()).toEqual([
      '2025-03-04',
      '2026-01-01',
      '2026-11-02',
      '2026-11-15',
      '2026-11-20',
      '2027-01-01',
      '2027-11-02',
      '2027-11-15',
      '2027-11-20',
    ]);
  });

  it('dia útil: segunda a sexta fora dos feriados', () => {
    expect(diaUtil('2026-11-02', FERIADOS)).toBe(false); // segunda, Finados
    expect(diaUtil('2026-11-03', FERIADOS)).toBe(true); // terça
    expect(diaUtil('2026-11-07', FERIADOS)).toBe(false); // sábado
    expect(diaUtil('2026-11-08T10:00:00', FERIADOS)).toBe(false); // domingo, com hora
  });

  it('o n-ésimo dia útil e os limites', () => {
    expect(enesimoDiaUtilDoMes(2026, 11, 1, FERIADOS)).toBe('2026-11-03');
    expect(() => enesimoDiaUtilDoMes(2026, 11, 0, FERIADOS)).toThrow();
    expect(() => enesimoDiaUtilDoMes(2026, 11, 23, FERIADOS)).toThrow('O mês não tem tantos dias úteis.');
  });

  it('instantes locais: com e sem segundos, só a data, e o inválido', () => {
    expect(instanteDeMs(msLocal('2026-10-18T03:40'))).toBe('2026-10-18T03:40:00');
    expect(instanteDeMs(msLocal('2026-10-18'))).toBe('2026-10-18T00:00:00');
    expect(() => msLocal('ontem')).toThrow('Instante inválido');
  });
});

describe('prazos de cada regra', () => {
  it('óbito: 72 h depois da ocorrência (18/10 03:40 → 21/10 03:40)', () => {
    expect(prazoNotivisaObito('2026-10-18T03:40:00')).toBe('2026-10-21T03:40:00');
  });

  it('mensal: 15º dia útil de novembro de 2026 com os feriados = 24/11 (sem eles, 20/11)', () => {
    // Novembro de 2026: 2 (Finados) não conta; 3–6 = 4; 9–13 = 9; 16–19 = 13 (20 é feriado); 23 = 14; 24 = 15.
    expect(prazoNotivisaMensal('2026-10-18T03:40:00', FERIADOS)).toBe('2026-11-24T23:59:59');
    // Sem feriados: 2–6 = 5; 9–13 = 10; 16–20 = 15.
    expect(prazoNotivisaMensal('2026-10-18T03:40:00', new Set())).toBe('2026-11-20T23:59:59');
  });

  it('mensal: dezembro vai para janeiro do ano seguinte (1º/1 é feriado: 4–8, 11–15, 18–22 → 22/01/2027)', () => {
    expect(prazoNotivisaMensal('2026-12-10T08:00:00', FERIADOS)).toBe('2027-01-22T23:59:59');
  });

  it('análise de causa raiz: 60 dias corridos da ocorrência (18/10 + 13 = 31/10; + 30 = 30/11; + 17 = 17/12)', () => {
    expect(prazoAnaliseCausaRaiz('2026-10-18T03:40:00')).toBe('2026-12-17T23:59:59');
  });
});

describe('situação do prazo', () => {
  it('no prazo, vence em breve (24 h), vencido e cumprido', () => {
    expect(situacaoDoPrazo('2026-10-21T03:40:00', '2026-10-19T03:39:00', null)).toEqual({
      situacao: 'noPrazo',
      minutosRestantes: 2 * 1440 + 1,
    });
    expect(situacaoDoPrazo('2026-10-21T03:40:00', '2026-10-20T03:40:00', null)).toEqual({
      situacao: 'venceEmBreve',
      minutosRestantes: 1440,
    });
    expect(situacaoDoPrazo('2026-10-21T03:40:00', '2026-10-21T04:40:00', null)).toEqual({
      situacao: 'vencido',
      minutosRestantes: -60,
    });
    expect(situacaoDoPrazo('2026-10-21T03:40:00', '2026-10-25T00:00:00', '2026-10-20T10:00:00')).toEqual({
      situacao: 'cumprido',
      minutosRestantes: null,
    });
    expect(situacaoDoPrazo('2026-10-21T03:40:00', '2026-10-20T23:00:00', null, 60).situacao).toBe('noPrazo');
  });
});

describe('prazos da notificação', () => {
  const base: EstadoParaPrazos = {
    ocorridoEm: '2026-10-18T03:40:00',
    classificacao: 'eventoAdverso',
    dano: 'leve',
    neverEvent: false,
    notivisaTranscritaEm: null,
    analiseConcluidaEm: null,
    descartada: false,
  };
  const agora = '2026-10-19T10:00:00';

  it('evento adverso leve: só o mensal', () => {
    const p = prazosDaNotificacao(base, agora, FERIADOS);
    expect(p.map((x) => [x.tipo, x.venceEm, x.situacao])).toEqual([
      ['notivisaMensal', '2026-11-24T23:59:59', 'noPrazo'],
    ]);
  });

  it('óbito: 72 h e a análise de 60 dias (aviso da análise com 7 dias)', () => {
    const p = prazosDaNotificacao({ ...base, dano: 'obito' }, '2026-12-11T00:00:00', FERIADOS);
    expect(p.map((x) => [x.tipo, x.venceEm, x.situacao])).toEqual([
      ['notivisaObito', '2026-10-21T03:40:00', 'vencido'],
      ['analiseCausaRaiz', '2026-12-17T23:59:59', 'venceEmBreve'],
    ]);
    expect(proximoPrazoAberto(p)?.tipo).toBe('notivisaObito');
  });

  it('never event sem óbito: mensal e análise; transcrita cumpre o Notivisa', () => {
    const p = prazosDaNotificacao(
      { ...base, dano: 'grave', neverEvent: true, notivisaTranscritaEm: '2026-10-20T09:00:00' },
      agora,
      FERIADOS,
    );
    expect(p.map((x) => [x.tipo, x.situacao])).toEqual([
      ['notivisaMensal', 'cumprido'],
      ['analiseCausaRaiz', 'noPrazo'],
    ]);
    expect(proximoPrazoAberto(p)?.tipo).toBe('analiseCausaRaiz');
  });

  it('quase erro, incidente sem dano e descartada: nenhum prazo obrigatório', () => {
    expect(
      prazosDaNotificacao({ ...base, classificacao: 'quaseErro', dano: 'nenhum' }, agora, FERIADOS),
    ).toEqual([]);
    expect(
      prazosDaNotificacao({ ...base, classificacao: 'incidenteSemDano', dano: 'nenhum' }, agora, FERIADOS),
    ).toEqual([]);
    expect(prazosDaNotificacao({ ...base, descartada: true }, agora, FERIADOS)).toEqual([]);
    expect(proximoPrazoAberto([])).toBeNull();
  });
});

describe('feriados móveis', () => {
  it('Páscoa e os móveis de 2026 e 2027', () => {
    expect(pascoa(2026)).toBe('2026-04-05');
    expect(pascoa(2027)).toBe('2027-03-28');
    expect(feriadosMoveis(2026).map((f) => f.data)).toEqual([
      '2026-02-16',
      '2026-02-17',
      '2026-04-03',
      '2026-06-04',
    ]);
  });

  it('avisa os móveis que não estão no cadastro do ano', () => {
    const com = new Set([...FERIADOS, '2026-04-03']);
    expect(feriadosMoveisAusentes(2026, com).map((f) => f.nome)).toEqual([
      'Carnaval (segunda-feira)',
      'Carnaval (terça-feira)',
      'Corpus Christi',
    ]);
  });
});
