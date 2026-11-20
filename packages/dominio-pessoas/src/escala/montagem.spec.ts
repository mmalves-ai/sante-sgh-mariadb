// Montagem (M52.2): a conferência completa do plantão na ordem da ficha (regras 3 e 5 a 8).
import { describe, expect, it } from 'vitest';
import { conferirPlantaoNaEscala, type ContextoMontagem } from './montagem.js';
import type { PlantaoProposto } from './plantao.js';

const novo: PlantaoProposto = {
  tipo: 'presencial',
  inicio: '2026-11-10T07:00',
  fim: '2026-11-10T19:00',
  chegadaMin: null,
};
const coren = (validade: string | null) => ({ registro: 7, conselho: 'COREN', ativo: true, validade });
const ctx = (x: Partial<ContextoMontagem> = {}): ContextoMontagem => ({
  escala: { competencia: '2026-11', tipo: 'enfermagem', estado: 'rascunho' },
  vinculo: { tipo: 'clt', admissao: '2026-10-01', desligamento: null },
  registros: [coren('2027-12-31')],
  regime: null,
  doVinculo: [],
  daPessoa: [],
  rede: { intervalos: [], semResposta: 0 },
  motivo: null,
  ...x,
});
const codigo = (c: ContextoMontagem, p: PlantaoProposto = novo) => {
  const r = conferirPlantaoNaEscala(p, c);
  return r.ok ? 'ok' : r.codigo;
};

describe('montagem da escala', () => {
  it('plantão válido grava com o registro usado e sem alerta', () => {
    expect(conferirPlantaoNaEscala(novo, ctx())).toEqual({
      ok: true,
      registro: 7,
      alertaConselho: null,
      redeNaoConferida: false,
      limiteSemanalHoras: 44,
    });
  });

  it('forma, motivo na publicada, admissão e desligamento', () => {
    expect(codigo(ctx(), { ...novo, fim: novo.inicio })).toBe('fim-antes-do-inicio');
    expect(codigo(ctx({ escala: { competencia: '2026-11', tipo: 'enfermagem', estado: 'publicada' } }))).toBe(
      'sem-motivo',
    );
    expect(codigo(ctx({ vinculo: { tipo: 'clt', admissao: '2026-11-11', desligamento: null } }))).toBe(
      'antes-da-admissao',
    );
    expect(
      codigo(ctx({ vinculo: { tipo: 'clt', admissao: '2026-10-01', desligamento: '2026-11-09' } })),
    ).toBe('depois-do-desligamento');
    expect(
      codigo(ctx({ vinculo: { tipo: 'clt', admissao: '2026-10-01', desligamento: '2026-11-10' } })),
    ).toBe('ok');
  });

  it('regra 3: conselho exigido pelo tipo da escala, vencido no dia recusa, sem validade entra com alerta', () => {
    expect(codigo(ctx({ registros: [coren('2026-11-09')] }))).toBe('conselho-vencido');
    expect(codigo(ctx({ escala: { competencia: '2026-11', tipo: 'medica', estado: 'rascunho' } }))).toBe(
      'conselho-sem-registro',
    );
    expect(
      codigo(ctx({ registros: [], escala: { competencia: '2026-11', tipo: 'apoio', estado: 'rascunho' } })),
    ).toBe('ok');
    expect(
      codigo(
        ctx({
          registros: [{ registro: 8, conselho: 'CREFITO', ativo: true, validade: null }],
          escala: { competencia: '2026-11', tipo: 'multiprofissional', estado: 'rascunho' },
        }),
      ),
    ).toBe('ok');
    const r = conferirPlantaoNaEscala(novo, ctx({ registros: [coren(null)], janelaDias: 30 }));
    expect(r).toMatchObject({ ok: true, alertaConselho: 'semValidade' });
  });

  it('sobreposição local, interjornada, limite do contrato e Rede, nesta ordem', () => {
    const noite = {
      tipo: 'presencial' as const,
      inicio: '2026-11-09T19:00',
      fim: '2026-11-10T07:00',
      chegadaMin: null,
    };
    expect(codigo(ctx({ daPessoa: [{ inicio: '2026-11-10T18:00', fim: '2026-11-10T23:00' }] }))).toBe(
      'sobreposicao',
    );
    expect(codigo(ctx({ doVinculo: [{ ...noite, fim: '2026-11-09T21:00' }] }))).toBe('interjornada');
    const regime = {
      descansoMinimoMin: 660,
      acordo: null,
      contratoParcial: 1,
      limiteParcialDominio: 25,
      limiteSemanalHoras: 44,
    };
    const semana = [
      { ...noite, inicio: '2026-11-11T07:00', fim: '2026-11-11T19:00' },
      { ...noite, inicio: '2026-11-13T07:00', fim: '2026-11-13T19:00' },
    ];
    expect(codigo(ctx({ regime, doVinculo: semana }))).toBe('limite-do-contrato');
    expect(
      codigo(
        ctx({
          rede: { intervalos: [{ inicio: '2026-11-10T08:00', fim: '2026-11-10T09:00' }], semResposta: 0 },
        }),
      ),
    ).toBe('sobreposicao-rede');
  });

  it('Rede não consultada ou sem resposta: grava com o alerta', () => {
    expect(conferirPlantaoNaEscala(novo, ctx({ rede: null }))).toMatchObject({
      ok: true,
      redeNaoConferida: true,
    });
    expect(conferirPlantaoNaEscala(novo, ctx({ rede: { intervalos: [], semResposta: 1 } }))).toMatchObject({
      ok: true,
      redeNaoConferida: true,
    });
  });
});
