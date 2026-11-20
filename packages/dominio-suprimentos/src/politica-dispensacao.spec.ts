// Regra 3 (ficha do M29): "dispensar só depois de validar" é parâmetro SGH_ por classe, com exceção para "agora" e
// urgente; nada em PRPARAM.
import { describe, expect, it } from 'vitest';
import { conferirPoliticaDispensacao, lerPolitica, POLITICA_PADRAO } from '@sgh/contratos/regras-suprimentos';

describe('política de dispensação (regra 3)', () => {
  it('padrão: alto risco e antimicrobiano só depois da validação; os demais livres', () => {
    expect(POLITICA_PADRAO['alto-risco']).toBe('validar-antes');
    expect(POLITICA_PADRAO.antimicrobiano).toBe('validar-antes');
    const sem = { validada: false, urgente: false, agora: false };
    expect(conferirPoliticaDispensacao({ ...sem, classe: 'alto-risco' })?.codigo).toBe('aguarda-validacao');
    expect(conferirPoliticaDispensacao({ ...sem, classe: 'antimicrobiano' })?.codigo).toBe(
      'aguarda-validacao',
    );
    expect(conferirPoliticaDispensacao({ ...sem, classe: 'comum' })).toBeNull();
    expect(conferirPoliticaDispensacao({ ...sem, classe: 'material' })).toBeNull();
  });
  it('validada, urgente ou "agora": sai', () => {
    const b = { classe: 'alto-risco' as const, validada: false, urgente: false, agora: false };
    expect(conferirPoliticaDispensacao({ ...b, validada: true })).toBeNull();
    expect(conferirPoliticaDispensacao({ ...b, urgente: true })).toBeNull();
    expect(conferirPoliticaDispensacao({ ...b, agora: true })).toBeNull();
  });
  it('lê o parâmetro por classe; item inválido cai no padrão', () => {
    const p = lerPolitica('comum=validar-antes; alto-risco=livre;lixo=x;controlado=talvez');
    expect(p.comum).toBe('validar-antes');
    expect(p['alto-risco']).toBe('livre');
    expect(p.controlado).toBe('livre');
    expect(p.antimicrobiano).toBe('validar-antes');
    expect(lerPolitica(null)).toEqual(POLITICA_PADRAO);
    const b = { validada: false, urgente: false, agora: false };
    expect(conferirPoliticaDispensacao({ ...b, classe: 'comum' }, p)?.codigo).toBe('aguarda-validacao');
    expect(conferirPoliticaDispensacao({ ...b, classe: 'alto-risco' }, p)).toBeNull();
    // Política parcial: a classe ausente cai no padrão.
    expect(conferirPoliticaDispensacao({ ...b, classe: 'antimicrobiano' }, {})?.codigo).toBe(
      'aguarda-validacao',
    );
  });
});
