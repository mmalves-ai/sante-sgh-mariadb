// W0-10 (11d2c): o provedor SIMULADO devolve só às voltas conhecidas (a do hospital e a do portal do médico externo).
import { PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { voltaDoSimuladorAceita } from './assinatura.controller.js';

describe('volta do provedor simulado', () => {
  it('aceita a volta do hospital e a tela de retorno do portal do médico', () => {
    expect(voltaDoSimuladorAceita('/api/documento/assinatura/retorno?state=a&code=b')).toBe(true);
    expect(voltaDoSimuladorAceita(`${PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA}?state=a&code=b`)).toBe(true);
    expect(
      voltaDoSimuladorAceita(`${PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA}?state=a&error=access_denied`),
    ).toBe(true);
  });

  it('recusa qualquer outro destino (nada de redirecionamento aberto)', () => {
    expect(voltaDoSimuladorAceita('https://outro.invalid/medico-externo/assinaturas/retorno?state=a')).toBe(
      false,
    );
    expect(voltaDoSimuladorAceita('//outro.invalid/api/documento/assinatura/retorno')).toBe(false);
    expect(voltaDoSimuladorAceita(`${PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA}x?state=a`)).toBe(false);
    expect(voltaDoSimuladorAceita('/medico-externo/assinaturas')).toBe(false);
  });
});
