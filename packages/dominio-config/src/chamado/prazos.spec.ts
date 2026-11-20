// Regra 7 do M37: vencimento dos prazos com dia útil, S1 com comandante e atualização a cada 30 min.
import { describe, expect, it } from 'vitest';
import {
  chamadoVencido,
  conferirTriagem,
  diaUtil,
  PRAZOS_PROPOSTOS,
  prazosDoChamado,
  proximaAtualizacaoS1,
  somarDiasUteis,
} from './prazos.js';

// Quarta-feira, 04/11/2026, 10:00 em São Paulo (13:00 UTC).
const quarta = new Date('2026-11-04T13:00:00Z');
// Sexta-feira, 06/11/2026, 17:00 em São Paulo.
const sexta = new Date('2026-11-06T20:00:00Z');
// Sábado, 07/11/2026, 10:00.
const sabado = new Date('2026-11-07T13:00:00Z');

describe('prazos do chamado (regra 7)', () => {
  it('S1 e S2 em minutos corridos', () => {
    const s1 = prazosDoChamado('S1', sabado);
    expect(s1.resposta.toISOString()).toBe('2026-11-07T13:15:00.000Z');
    expect(s1.contorno.toISOString()).toBe('2026-11-07T14:00:00.000Z');
    expect(prazosDoChamado('S2', quarta).contorno.toISOString()).toBe('2026-11-04T21:00:00.000Z');
  });

  it('S3 e S4 em dias úteis: a sexta passa o fim de semana; o feriado não conta', () => {
    expect(prazosDoChamado('S3', sexta).resposta.toISOString()).toBe('2026-11-09T20:00:00.000Z');
    expect(prazosDoChamado('S4', sexta).resposta.toISOString()).toBe('2026-11-10T20:00:00.000Z');
    // 15/11/2026 é domingo; 20/11 (sexta) como feriado local.
    const feriados = new Set(['2026-11-20']);
    expect(somarDiasUteis(new Date('2026-11-19T13:00:00Z'), 1, feriados).toISOString()).toBe(
      '2026-11-23T13:00:00.000Z',
    );
    expect(diaUtil(new Date('2026-11-20T13:00:00Z'), feriados)).toBe(false);
  });

  it('aberto no sábado: a contagem começa na segunda às 08:00', () => {
    expect(prazosDoChamado('S3', sabado).resposta.toISOString()).toBe('2026-11-10T11:00:00.000Z');
    expect(somarDiasUteis(sabado, 0).toISOString()).toBe('2026-11-09T11:00:00.000Z');
  });

  it('severidade sem prazo é erro; os prazos propostos são parâmetros', () => {
    expect(() => prazosDoChamado('S1', quarta, [])).toThrow(/sem prazo/);
    expect(PRAZOS_PROPOSTOS.map((p) => p.severidade)).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(
      prazosDoChamado('S1', quarta, [
        { severidade: 'S1', resposta: 30, contorno: 30, diaUtil: false },
      ]).resposta.toISOString(),
    ).toBe('2026-11-04T13:30:00.000Z');
  });

  it('vencido antes da resposta pelo prazo de resposta; depois, pelo de contorno; resolvido nunca vence', () => {
    const c = {
      situacao: 'aberto',
      prazoResposta: new Date('2026-11-04T13:15:00Z'),
      prazoContorno: new Date('2026-11-04T14:00:00Z'),
      respondidoEm: null,
    };
    expect(chamadoVencido(c, new Date('2026-11-04T13:16:00Z'))).toBe(true);
    expect(chamadoVencido({ ...c, respondidoEm: new Date() }, new Date('2026-11-04T13:16:00Z'))).toBe(false);
    expect(chamadoVencido({ ...c, situacao: 'resolvido' }, new Date('2026-11-05T00:00:00Z'))).toBe(false);
  });

  it('S1: comandante obrigatório fora de "aberto" e atualização a cada 30 min', () => {
    expect(conferirTriagem({ severidade: 'S1', situacao: 'em-atendimento', comandante: ' ' })).toMatch(
      /comandante/,
    );
    expect(conferirTriagem({ severidade: 'S1', situacao: 'aberto', comandante: null })).toBeNull();
    expect(conferirTriagem({ severidade: 'S2', situacao: 'em-atendimento', comandante: null })).toBeNull();
    const aberto = { severidade: 'S1' as const, situacao: 'aberto', abertoEm: quarta, atualizadoEm: null };
    expect(proximaAtualizacaoS1(aberto)?.toISOString()).toBe('2026-11-04T13:30:00.000Z');
    expect(
      proximaAtualizacaoS1({ ...aberto, atualizadoEm: new Date('2026-11-04T14:00:00Z') })?.toISOString(),
    ).toBe('2026-11-04T14:30:00.000Z');
    expect(proximaAtualizacaoS1({ ...aberto, situacao: 'resolvido' })).toBeNull();
    expect(proximaAtualizacaoS1({ ...aberto, severidade: 'S2' })).toBeNull();
  });
});
