// Regra 5 (domínio): o próximo envio diário, semanal e mensal; o link autenticado (nunca o arquivo); o alerta ao dono
// em toda falha.
import { describe, expect, it } from 'vitest';
import {
  depoisDoEnvio,
  linkDoRelatorio,
  mensagemDeFalha,
  mensagemDoEnvio,
  proximoEnvio,
} from './agendamento.js';

const T = (s: string) => new Date(`${s}Z`);

describe('envio agendado (regra 5)', () => {
  it('diário: hoje se ainda não passou, senão amanhã', () => {
    expect(
      proximoEnvio(
        { periodicidade: 'diaria', hora: 700, diaSemana: null, diaMes: null },
        T('2026-10-22T06:00:00'),
      ),
    ).toEqual(T('2026-10-22T07:00:00'));
    expect(
      proximoEnvio(
        { periodicidade: 'diaria', hora: 700, diaSemana: null, diaMes: null },
        T('2026-10-22T07:00:00'),
      ),
    ).toEqual(T('2026-10-23T07:00:00'));
    expect(() =>
      proximoEnvio(
        { periodicidade: 'diaria', hora: 2460, diaSemana: null, diaMes: null },
        T('2026-10-22T06:00:00'),
      ),
    ).toThrow();
  });
  it('semanal: o próximo dia da semana (1 segunda … 7 domingo)', () => {
    // 2026-10-22 é quinta-feira.
    expect(
      proximoEnvio(
        { periodicidade: 'semanal', hora: 800, diaSemana: 1, diaMes: null },
        T('2026-10-22T10:00:00'),
      ),
    ).toEqual(T('2026-10-26T08:00:00'));
    expect(
      proximoEnvio(
        { periodicidade: 'semanal', hora: 1100, diaSemana: 4, diaMes: null },
        T('2026-10-22T10:00:00'),
      ),
    ).toEqual(T('2026-10-22T11:00:00'));
    expect(
      proximoEnvio(
        { periodicidade: 'semanal', hora: 900, diaSemana: 4, diaMes: null },
        T('2026-10-22T10:00:00'),
      ),
    ).toEqual(T('2026-10-29T09:00:00'));
    expect(() =>
      proximoEnvio(
        { periodicidade: 'semanal', hora: 800, diaSemana: null, diaMes: null },
        T('2026-10-22T10:00:00'),
      ),
    ).toThrow();
  });
  it('mensal: o dia do mês (1 a 28) deste mês ou do seguinte', () => {
    expect(
      proximoEnvio(
        { periodicidade: 'mensal', hora: 600, diaSemana: null, diaMes: 5 },
        T('2026-10-22T10:00:00'),
      ),
    ).toEqual(T('2026-11-05T06:00:00'));
    expect(
      proximoEnvio(
        { periodicidade: 'mensal', hora: 600, diaSemana: null, diaMes: 25 },
        T('2026-10-22T10:00:00'),
      ),
    ).toEqual(T('2026-10-25T06:00:00'));
    expect(() =>
      proximoEnvio(
        { periodicidade: 'mensal', hora: 600, diaSemana: null, diaMes: 31 },
        T('2026-10-22T10:00:00'),
      ),
    ).toThrow();
  });
  it('o link leva o relatório e os parâmetros, e o e-mail não leva arquivo nem dados', () => {
    const link = linkDoRelatorio('http://127.0.0.1:5300', 'glosasPorConvenio', {
      regua: 'competencia',
      mesFim: '2026-06',
    });
    expect(link).toBe(
      'http://127.0.0.1:5300/relatorios?relatorio=glosasPorConvenio&p.mesFim=2026-06&p.regua=competencia',
    );
    const m = mensagemDoEnvio({
      titulo: 'Glosas',
      relatorio: 'Glosas por convênio',
      link,
      produto: 'Sante SGH',
      estabelecimento: 'pc',
    });
    expect(m.assunto).toBe('Glosas (pc)');
    expect(m.texto).toContain(link);
    expect(m.texto).toMatch(/não leva o arquivo/);
    expect(
      mensagemDeFalha({ titulo: 'Glosas', falhasSeguidas: 3, motivo: 'SMTP fora', estabelecimento: 'pc' })
        .texto,
    ).toMatch(/3 vezes seguidas/);
    expect(
      mensagemDeFalha({ titulo: 'Glosas', falhasSeguidas: 1, motivo: 'x', estabelecimento: 'pc' }).texto,
    ).toMatch(/uma vez/);
  });
  it('toda falha alerta o dono e soma; o sucesso zera', () => {
    expect(depoisDoEnvio(2, false)).toEqual({ falhasSeguidas: 3, situacao: 'falhou', alertarDono: true });
    expect(depoisDoEnvio(2, true)).toEqual({ falhasSeguidas: 0, situacao: 'enviado', alertarDono: false });
  });
});
