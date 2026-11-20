// Regra 6 do M49 (e o carimbo da regra 3): política por tipo de documento, conselho e destino, com o piso legal que
// nenhum cadastro rebaixa.
import { describe, expect, it } from 'vitest';
import {
  atendeExigencia,
  conferirRegraPolitica,
  pisoLegal,
  regraQueVale,
  resolverExigencia,
  type RegraPoliticaAssinatura,
} from './politica.js';

const r = (
  x: Partial<RegraPoliticaAssinatura> & Pick<RegraPoliticaAssinatura, 'id'>,
): RegraPoliticaAssinatura => ({
  tipoDocumento: 'registro-clinico',
  conselho: null,
  destino: 'interno',
  nivel: 'eletronica-avancada',
  politicaIcp: null,
  formato: 'pades',
  ...x,
});

describe('piso legal', () => {
  it('receita de controle especial: ICP AD-RT em qualquer destino', () => {
    expect(pisoLegal({ tipo: 'receita-controlada', destino: 'interno' })).toEqual({
      nivel: 'icp-brasil',
      politicaIcp: 'AD-RT',
    });
    expect(pisoLegal({ tipo: 'receita-controlada', destino: 'externo' }).nivel).toBe('icp-brasil');
  });
  it('atestado que sai do hospital: ICP AD-RT; o que fica, avançada', () => {
    expect(pisoLegal({ tipo: 'atestado', destino: 'externo' }).nivel).toBe('icp-brasil');
    expect(pisoLegal({ tipo: 'atestado', destino: 'interno' }).nivel).toBe('eletronica-avancada');
  });
  it('o resto: avançada', () => {
    expect(pisoLegal({ tipo: 'registro-clinico', destino: 'interno' })).toEqual({
      nivel: 'eletronica-avancada',
      politicaIcp: null,
    });
  });
});

describe('resolver a exigência', () => {
  it('sem política cadastrada vale o piso legal', () => {
    const e = resolverExigencia([], { tipo: 'atestado', conselho: 'CRM', destino: 'externo' });
    expect(e).toEqual({
      nivel: 'icp-brasil',
      politicaIcp: 'AD-RT',
      formato: 'pades',
      carimboDoTempo: true,
      origem: 'piso-legal',
    });
    expect(resolverExigencia([], { tipo: 'laudo', conselho: 'CRM', destino: 'interno' }).nivel).toBe(
      'eletronica-avancada',
    );
  });

  it('a regra do conselho exato vence a de qualquer conselho', () => {
    const regras = [
      r({ id: 1, nivel: 'eletronica-avancada' }),
      r({ id: 2, conselho: 'CRM', nivel: 'icp-brasil', politicaIcp: 'AD-RB' }),
    ];
    expect(regraQueVale(regras, { tipo: 'registro-clinico', conselho: 'CRM', destino: 'interno' })?.id).toBe(
      2,
    );
    expect(
      regraQueVale(regras, { tipo: 'registro-clinico', conselho: 'COREN', destino: 'interno' })?.id,
    ).toBe(1);
    expect(regraQueVale(regras, { tipo: 'registro-clinico', conselho: null, destino: 'interno' })?.id).toBe(
      1,
    );
    expect(
      regraQueVale(regras, { tipo: 'registro-clinico', conselho: 'CRM', destino: 'externo' }),
    ).toBeNull();
    const e = resolverExigencia(regras, { tipo: 'registro-clinico', conselho: 'CRM', destino: 'interno' });
    expect(e).toMatchObject({
      nivel: 'icp-brasil',
      politicaIcp: 'AD-RB',
      carimboDoTempo: false,
      origem: { politica: 2 },
    });
  });

  it('cadastro abaixo do piso não rebaixa: atestado externo segue ICP AD-RT', () => {
    const regras = [r({ id: 7, tipoDocumento: 'atestado', destino: 'externo', nivel: 'eletronica-simples' })];
    expect(
      resolverExigencia(regras, { tipo: 'atestado', conselho: 'CRM', destino: 'externo' }),
    ).toMatchObject({
      nivel: 'icp-brasil',
      politicaIcp: 'AD-RT',
      origem: { politica: 7 },
    });
  });

  it('ICP em prescrição e atestado sobe para AD-RT (carimbo do tempo, regra 3)', () => {
    const regras = [
      r({ id: 3, tipoDocumento: 'prescricao', nivel: 'icp-brasil', politicaIcp: 'AD-RB', formato: 'cades' }),
    ];
    expect(resolverExigencia(regras, { tipo: 'prescricao', conselho: 'CRM', destino: 'interno' })).toEqual({
      nivel: 'icp-brasil',
      politicaIcp: 'AD-RT',
      formato: 'cades',
      carimboDoTempo: true,
      origem: { politica: 3 },
    });
  });

  it('regra acima do piso vale como está', () => {
    const regras = [r({ id: 4, tipoDocumento: 'laudo', nivel: 'icp-brasil', politicaIcp: 'AD-RT' })];
    expect(resolverExigencia(regras, { tipo: 'laudo', conselho: null, destino: 'interno' }).politicaIcp).toBe(
      'AD-RT',
    );
  });
});

describe('a assinatura feita atende?', () => {
  const icpRt = { nivel: 'icp-brasil', politicaIcp: 'AD-RT' } as const;
  it('nível menor recusa; política menor recusa; igual ou maior aceita', () => {
    expect(atendeExigencia({ nivel: 'eletronica-avancada', politicaIcp: null }, icpRt)).toEqual({
      ok: false,
      motivo: 'nivel-insuficiente',
    });
    expect(atendeExigencia({ nivel: 'icp-brasil', politicaIcp: 'AD-RB' }, icpRt)).toEqual({
      ok: false,
      motivo: 'politica-insuficiente',
    });
    expect(atendeExigencia(icpRt, icpRt)).toEqual({ ok: true });
    expect(atendeExigencia(icpRt, { nivel: 'eletronica-avancada', politicaIcp: null })).toEqual({ ok: true });
  });
});

describe('conferir a regra antes de gravar', () => {
  it('recusa abaixo do piso e diz o mínimo', () => {
    expect(
      conferirRegraPolitica({
        ...r({ id: 0 }),
        tipoDocumento: 'receita-controlada',
        nivel: 'eletronica-avancada',
      }),
    ).toEqual({
      ok: false,
      minimo: { nivel: 'icp-brasil', politicaIcp: 'AD-RT' },
    });
    expect(
      conferirRegraPolitica({
        ...r({ id: 0 }),
        tipoDocumento: 'atestado',
        nivel: 'icp-brasil',
        politicaIcp: 'AD-RB',
      }).ok,
    ).toBe(false);
    expect(
      conferirRegraPolitica({ ...r({ id: 0 }), tipoDocumento: 'atestado', nivel: 'eletronica-avancada' }).ok,
    ).toBe(true);
    expect(conferirRegraPolitica({ ...r({ id: 0 }), nivel: 'eletronica-simples' }).ok).toBe(false);
    expect(conferirRegraPolitica({ ...r({ id: 0 }), nivel: 'icp-brasil', politicaIcp: 'AD-RB' }).ok).toBe(
      true,
    );
  });
});
