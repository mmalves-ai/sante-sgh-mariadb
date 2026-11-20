// Regra 7 do M24: um caso-limite por alerta (renal, via × forma, alta vigilância, antimicrobiano, controlado,
// cobertura).
import { describe, expect, it } from 'vitest';
import { contexto, item, produto } from './fabrica.spec-util.js';
import { alertasAltoAlerta, ehAltaVigilancia } from './alto-alerta.js';
import { alertasAntimicrobiano } from './antimicrobiano.js';
import { alertasCobertura } from './cobertura.js';
import { alertasControlado, receituarioDaLista } from './controlado.js';
import { alertasRenal } from './renal.js';
import { alertasViaForma } from './via-forma.js';

describe('ajuste renal', () => {
  const p = produto({ produto: 1, ajusteRenal: { clearanceAbaixoDe: 30, doseMaxima: 500 } });
  it('clearance abaixo do limite com dose acima do ajuste alerta; no limite não', () => {
    expect(
      alertasRenal(
        item('i', [{ produto: p, dose: 750 }]),
        contexto({ paciente: { clearance: 29.9, pesoKg: 70 } }),
      ),
    ).toHaveLength(1);
    expect(
      alertasRenal(
        item('i', [{ produto: p, dose: 750 }]),
        contexto({ paciente: { clearance: 30, pesoKg: 70 } }),
      ),
    ).toEqual([]);
    expect(
      alertasRenal(
        item('i', [{ produto: p, dose: 500 }]),
        contexto({ paciente: { clearance: 10, pesoKg: 70 } }),
      ),
    ).toEqual([]);
    expect(alertasRenal(item('i', [{ produto: p, dose: 750 }]), contexto())).toEqual([]);
    expect(
      alertasRenal(
        item('i', [{ produto: produto({ produto: 2 }), dose: 750 }]),
        contexto({ paciente: { clearance: 10, pesoKg: 1 } }),
      ),
    ).toEqual([]);
  });
});

describe('via × forma', () => {
  it('via fora do cadastro alerta; cadastro sem via ou item sem via não', () => {
    const p = produto({ produto: 1, viasPermitidas: ['EV ', 'IM'] });
    expect(alertasViaForma(item('i', [{ produto: p }], { via: 'vo' }))).toHaveLength(1);
    expect(alertasViaForma(item('i', [{ produto: p }], { via: 'ev' }))).toEqual([]);
    expect(alertasViaForma(item('i', [{ produto: produto({ produto: 2 }) }], { via: 'VO' }))).toEqual([]);
    expect(alertasViaForma(item('i', [{ produto: p }], { via: null }))).toEqual([]);
  });
});

describe('alta vigilância', () => {
  it('pela marca do cadastro ou pela lista do hospital', () => {
    const ctx = contexto({ altaVigilancia: new Set([7]) });
    expect(ehAltaVigilancia(7, false, ctx)).toBe(true);
    expect(ehAltaVigilancia(8, false, ctx)).toBe(false);
    expect(
      alertasAltoAlerta(item('i', [{ produto: produto({ produto: 8, altoAlerta: true }) }]), ctx),
    ).toHaveLength(1);
  });
});

describe('antimicrobiano', () => {
  it('sem ficha alerta; com ficha, não', () => {
    const p = produto({ produto: 1, antimicrobiano: true });
    expect(alertasAntimicrobiano(item('i', [{ produto: p }]))).toHaveLength(1);
    expect(alertasAntimicrobiano(item('i', [{ produto: p }], { fichaAntimicrobiano: true }))).toEqual([]);
  });
});

describe('controlado (Portaria 344/98)', () => {
  it('internado: prescrição diária; alta e externo: o receituário da lista', () => {
    const p = produto({ produto: 1, controlado: 'B1' });
    expect(alertasControlado(item('i', [{ produto: p }]), contexto())[0]?.detalhe).toContain(
      'prescrição diária',
    );
    expect(alertasControlado(item('i', [{ produto: p }]), contexto({ alta: true }))[0]?.detalhe).toContain(
      'azul',
    );
    expect(
      alertasControlado(
        item('i', [{ produto: produto({ produto: 2, controlado: '' }) }]),
        contexto({ tipoAtendimento: 'E' }),
      )[0]?.titulo,
    ).toContain('controle especial');
  });
  it('receituário por lista', () => {
    expect(receituarioDaLista('a1')).toContain('amarela');
    expect(receituarioDaLista('C2')).toContain('especial (branca)');
    expect(receituarioDaLista('C1')).toContain('duas vias');
    expect(receituarioDaLista('X9')).toBe('Receita de controle especial');
  });
});

describe('cobertura do convênio', () => {
  it('só quando a cobertura é conhecida e negativa', () => {
    const p = produto({ produto: 1 });
    expect(alertasCobertura(item('i', [{ produto: p }]), contexto())).toEqual([]);
    expect(
      alertasCobertura(item('i', [{ produto: p }]), contexto({ cobertura: new Map([[1, true]]) })),
    ).toEqual([]);
    expect(
      alertasCobertura(item('i', [{ produto: p }]), contexto({ cobertura: new Map([[1, false]]) })),
    ).toHaveLength(1);
  });
});
