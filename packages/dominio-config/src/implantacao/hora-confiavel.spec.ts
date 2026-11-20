import { describe, expect, it } from 'vitest';
import { compararRelogios, formatarHoraDeParede } from './fumaca.js';
import {
  conferirHoraConfiavel,
  exibirNoFuso,
  instanteParaGravar,
  itemHoraConfiavel,
} from './hora-confiavel.js';

const T = Date.UTC(2026, 10, 18, 12, 0, 0, 0);
// Banco em UTC-03:00, 300 ms adiantado em relação ao servidor da API.
const relogio = compararRelogios(T, formatarHoraDeParede(T - 3 * 3_600_000 + 300), 'UTC');
const entrada = { servidorNtp: 'a.st1.ntp.br', servidorMs: T, relogio, limiarMs: 1_000 };

describe('W0-09 (M2): hora confiável', () => {
  it('grava em UTC e exibe no fuso da instituição (parâmetro), qualquer que seja o fuso', () => {
    expect(instanteParaGravar(T)).toBe('2026-11-18T12:00:00.000Z');
    expect(exibirNoFuso(T, 'America/Sao_Paulo')).toBe('18/11/2026 09:00:00');
    expect(exibirNoFuso(T, 'America/Manaus')).toBe('18/11/2026 08:00:00');
    expect(exibirNoFuso(T, 'America/Noronha')).toBe('18/11/2026 10:00:00');
    expect(exibirNoFuso(T, 'America/Rio_Branco')).toBe('18/11/2026 07:00:00');
    // Virada de dia: 01:30 UTC é a noite anterior em São Paulo.
    expect(exibirNoFuso(Date.UTC(2026, 10, 18, 1, 30), 'America/Sao_Paulo')).toBe('17/11/2026 22:30:00');
    expect(exibirNoFuso(T, 'Fuso/Inexistente')).toBe('18/11/2026 12:00:00 UTC');
  });

  it('em dia: desvio do servidor e do banco contra o NTP dentro do limiar é ok', () => {
    const h = conferirHoraConfiavel({
      ...entrada,
      deslocamentoNtpMs: -200,
      fusoInstituicao: 'America/Sao_Paulo',
    });
    expect(h).toMatchObject({
      referencia: 'ntp',
      desvioServidorMs: 200,
      desvioBancoMs: 500,
      ntpEm: '2026-11-18T11:59:59.800Z',
      exibidoNoFuso: '18/11/2026 09:00:00',
    });
    const i = itemHoraConfiavel(h);
    expect(i).toMatchObject({ codigo: 'hora-confiavel', situacao: 'ok' });
    expect(i.detalhe).toContain('servidor da API 0,2 s adiantado');
    expect(i.detalhe).toContain('banco 0,5 s adiantado');
  });

  it('acima do limiar (servidor ou banco) alerta; o limiar é o do parâmetro', () => {
    const atrasado = conferirHoraConfiavel({ ...entrada, deslocamentoNtpMs: 1_500, fusoInstituicao: 'UTC' });
    expect(atrasado.desvioServidorMs).toBe(-1_500);
    expect(itemHoraConfiavel(atrasado).situacao).toBe('alerta');
    expect(itemHoraConfiavel(atrasado).detalhe).toContain('1,5 s atrasado');
    // Servidor em dia, mas o banco passa do limiar de 400 ms.
    const banco = conferirHoraConfiavel({
      ...entrada,
      limiarMs: 400,
      deslocamentoNtpMs: 0,
      fusoInstituicao: 'UTC',
    });
    expect(banco.desvioBancoMs).toBe(300);
    expect(itemHoraConfiavel(banco).situacao).toBe('ok');
    const bancoFora = conferirHoraConfiavel({
      ...entrada,
      limiarMs: 250,
      deslocamentoNtpMs: 0,
      fusoInstituicao: 'UTC',
    });
    expect(itemHoraConfiavel(bancoFora).situacao).toBe('alerta');
  });

  it("sem resposta do NTP: 'sem referência' (alerta), desvios nulos", () => {
    const h = conferirHoraConfiavel({
      ...entrada,
      deslocamentoNtpMs: null,
      fusoInstituicao: 'America/Sao_Paulo',
    });
    expect(h).toMatchObject({
      referencia: 'sem-referencia',
      ntpEm: null,
      desvioServidorMs: null,
      desvioBancoMs: null,
    });
    const i = itemHoraConfiavel(h);
    expect(i.situacao).toBe('alerta');
    expect(i.detalhe).toMatch(/^Sem referência: o servidor NTP a\.st1\.ntp\.br/);
  });
});
