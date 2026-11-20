// Ficha de IRAS: critérios mínimos por sítio, janela da ISC, 3º dia de internação e associação ao dispositivo.
import { describe, expect, it } from 'vitest';
import { conferirCriterios, conferirDataInfeccao, conferirJanelaIsc, dispositivoAssociado } from './iras.js';

describe('critérios por sítio (Anvisa)', () => {
  it('IPCS: patógeno em hemocultura, ou comensal em duas amostras com um sinal', () => {
    expect(conferirCriterios('ipcs', ['hemoculturaPatogeno'])).toBeNull();
    expect(conferirCriterios('ipcs', ['comensalDuasAmostras', 'febre'])).toBeNull();
    expect(conferirCriterios('ipcs', ['comensalDuasAmostras'])).toBe('criterios-insuficientes');
    expect(conferirCriterios('ipcs', ['febre'])).toBe('criterios-insuficientes');
    expect(conferirCriterios('ipcs', ['hemoculturaPatogeno', 'uroculturaPositiva'])).toBe(
      'criterio-de-outro-sitio',
    );
  });
  it('PAV e pneumonia: imagem, um sistêmico e dois pulmonares', () => {
    const ok = ['imagemPulmonar', 'febre', 'secrecaoPurulenta', 'estertores'] as const;
    expect(conferirCriterios('pav', [...ok])).toBeNull();
    expect(conferirCriterios('pneumonia', [...ok])).toBeNull();
    expect(conferirCriterios('pav', ['imagemPulmonar', 'febre', 'secrecaoPurulenta'])).toBe(
      'criterios-insuficientes',
    );
    expect(conferirCriterios('pav', ['febre', 'secrecaoPurulenta', 'estertores'])).toBe(
      'criterios-insuficientes',
    );
  });
  it('ITU, ISC e outra', () => {
    expect(conferirCriterios('itu', ['uroculturaPositiva', 'dorLombar'])).toBeNull();
    expect(conferirCriterios('itu', ['uroculturaPositiva'])).toBe('criterios-insuficientes');
    expect(conferirCriterios('isc', ['drenagemPurulenta'])).toBeNull();
    expect(conferirCriterios('outra', ['diagnosticoMedico'])).toBeNull();
    expect(conferirCriterios('outra', ['febre'])).toBe('criterio-de-outro-sitio');
  });
});

describe('datas', () => {
  it('ISC até 30 dias (90 com implante), nunca antes da cirurgia', () => {
    expect(conferirJanelaIsc('2026-10-01', '2026-10-31', false)).toBeNull();
    expect(conferirJanelaIsc('2026-10-01', '2026-11-01', false)).toBe('fora-da-janela-isc');
    expect(conferirJanelaIsc('2026-10-01', '2026-12-20', true)).toBeNull();
    expect(conferirJanelaIsc('2026-10-01', '2026-09-30', true)).toBe('antes-da-cirurgia');
  });
  it('a partir do 3º dia da internação (salvo ISC); não no futuro', () => {
    expect(conferirDataInfeccao('ipcs', '2026-10-12', '2026-10-10', '2026-10-20')).toBeNull();
    expect(conferirDataInfeccao('ipcs', '2026-10-11', '2026-10-10', '2026-10-20')).toBe(
      'antes-do-terceiro-dia',
    );
    expect(conferirDataInfeccao('isc', '2026-10-10', '2026-10-10', '2026-10-20')).toBeNull();
    expect(conferirDataInfeccao('itu', '2026-10-21', '2026-10-10', '2026-10-20')).toBe('data-futura');
  });
});

describe('associação ao dispositivo', () => {
  const ds = [
    { id: 1, tipo: 'cvc' as const, inseridoEm: '2026-10-10T08:00', retiradoEm: '2026-10-14T08:00' },
    { id: 2, tipo: 'cvc' as const, inseridoEm: '2026-10-05T08:00', retiradoEm: null },
    { id: 3, tipo: 'sondaVesical' as const, inseridoEm: '2026-10-11T08:00', retiradoEm: null },
  ];
  it('mais de 2 dias no dia do evento; a de inserção mais antiga primeiro', () => {
    expect(dispositivoAssociado('ipcs', ds, '2026-10-12')).toBe(2);
    expect(dispositivoAssociado('ipcs', [ds[0]!], '2026-10-12')).toBe(1);
    expect(dispositivoAssociado('ipcs', [ds[0]!], '2026-10-11')).toBeNull();
  });
  it('retirado na véspera ainda associa; dois dias depois, não', () => {
    expect(dispositivoAssociado('ipcs', [ds[0]!], '2026-10-15')).toBe(1);
    expect(dispositivoAssociado('ipcs', [ds[0]!], '2026-10-16')).toBeNull();
  });
  it('sítio pelo seu dispositivo; sem dispositivo, nulo', () => {
    expect(dispositivoAssociado('itu', ds, '2026-10-13')).toBe(3);
    expect(dispositivoAssociado('pav', ds, '2026-10-13')).toBeNull();
    expect(dispositivoAssociado('isc', ds, '2026-10-13')).toBeNull();
  });
});
