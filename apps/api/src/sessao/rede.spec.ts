// Resolvedor da rede (F2-L, sem o pacote do banco de origem): REDE_PADRAO, cadastro explícito e subdomínio.
import { describe, expect, it } from 'vitest';
import { lerRedePadrao, nomeDoHost, ResolvedorRedeConfigurado } from './rede.js';

describe('rede pelo endereço', () => {
  it('REDE_PADRAO: ausente é null; formato inválido recusa', () => {
    expect(lerRedePadrao({})).toBeNull();
    expect(lerRedePadrao({ REDE_PADRAO: ' rede-a ' })).toBe('rede-a');
    expect(() => lerRedePadrao({ REDE_PADRAO: 'Rede_A' })).toThrow(/REDE_PADRAO/);
  });

  it('loopback e endereços do dev só em dev/ci; cadastro e subdomínio em qualquer ambiente', () => {
    const dev = new ResolvedorRedeConfigurado({
      AMBIENTE: 'dev',
      REDE_PADRAO: 'rede-a',
      DEV_ENDERECOS: '192.168.0.104',
      REDE_ENDERECOS: 'hosp.exemplo=rede-b',
      DOMINIO_BASE: 'sgh.exemplo',
    });
    expect(dev.resolver('localhost:5310')).toBe('rede-a');
    expect(dev.resolver('192.168.0.104:5310')).toBe('rede-a');
    expect(dev.resolver('hosp.exemplo')).toBe('rede-b');
    expect(dev.resolver('rede-c.sgh.exemplo')).toBe('rede-c');
    expect(dev.resolver('outro.exemplo')).toBeNull();
    const prod = new ResolvedorRedeConfigurado({ AMBIENTE: 'producao', REDE_PADRAO: 'rede-a' });
    expect(prod.resolver('localhost')).toBeNull();
    expect(nomeDoHost('[::1]:3310')).toBe('::1');
    expect(() => new ResolvedorRedeConfigurado({ REDE_ENDERECOS: 'h=Rede_X' })).toThrow(/REDE_ENDERECOS/);
  });
});
