// M49, etapa 3 (regra 9): as regras puras do verificador público (formato do código, máscara da origem, chave do limite
// de taxa e a situação mostrada).
import { describe, expect, it } from 'vitest';
import {
  chaveTaxaVerificador,
  chaveTetoGlobalVerificador,
  dentroDoLimite,
  formatoCodigoVerificador,
  mascararOrigem,
  origemDaTaxa,
  primeiraBarrada,
  resultadoParaGravar,
  situacaoDaVerificacao,
} from './verificador.js';

describe('verificador público: código e origem', () => {
  it('aceita só o código opaco do QR (base64url, 16 a 64)', () => {
    expect(formatoCodigoVerificador('abcDEF0123456789_-')).toBe(true);
    expect(formatoCodigoVerificador('curto')).toBe(false);
    expect(formatoCodigoVerificador('a'.repeat(65))).toBe(false);
    expect(formatoCodigoVerificador("abc' OR 1=1 --aaaaaaaaaa")).toBe(false);
  });

  it('mascara a origem: IPv4 /24, IPv6 /48, IPv4 mapeado; nunca o endereço completo', () => {
    expect(mascararOrigem('203.0.113.77')).toBe('203.0.113.0');
    expect(mascararOrigem('::ffff:198.51.100.9')).toBe('198.51.100.0');
    expect(mascararOrigem('2001:db8:abcd:12:34::1')).toBe('2001:db8:abcd::');
    expect(mascararOrigem('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8:0::');
    expect(mascararOrigem('::1')).toBe('0:0:0::');
    expect(mascararOrigem('999.1.1.1')).toBe('desconhecida');
    expect(mascararOrigem('1:2:3')).toBe('desconhecida');
    expect(mascararOrigem('1::2::3')).toBe('desconhecida');
    expect(mascararOrigem('1:2:3:4:5:6:7:8:9::')).toBe('desconhecida');
    expect(mascararOrigem('não é ip')).toBe('desconhecida');
    expect(mascararOrigem(undefined)).toBe('desconhecida');
  });

  it('a chave do limite é por endereço completo e minuto, sem o endereço em claro', () => {
    const t = new Date('2026-10-24T12:00:10Z');
    const a = chaveTaxaVerificador('203.0.113.77', t);
    expect(a).not.toContain('203.0.113');
    expect(chaveTaxaVerificador('203.0.113.77', new Date('2026-10-24T12:00:59Z'))).toBe(a);
    expect(chaveTaxaVerificador('203.0.113.77', new Date('2026-10-24T12:01:00Z'))).not.toBe(a);
    expect(chaveTaxaVerificador('203.0.113.78', t)).not.toBe(a);
    expect(chaveTaxaVerificador(null, t)).toMatch(/^[0-9a-f]{32}:\d+$/);
  });

  it('a taxa conta o IPv6 pelo /64 (trocar de endereço na mesma sub-rede não zera) e o IPv4 inteiro', () => {
    const t = new Date('2026-10-24T12:00:00Z');
    expect(origemDaTaxa('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(origemDaTaxa('2001:0db8:0001:0002:ffff:1:2:3')).toBe('2001:db8:1:2::/64');
    expect(origemDaTaxa('::ffff:203.0.113.5')).toBe('203.0.113.5');
    const a = chaveTaxaVerificador('2001:db8:1:2::1', t);
    expect(chaveTaxaVerificador('2001:db8:1:2:dead:beef:0:7', t)).toBe(a);
    expect(chaveTaxaVerificador('2001:db8:1:3::1', t)).not.toBe(a);
    expect(chaveTaxaVerificador('::ffff:203.0.113.77', t)).toBe(chaveTaxaVerificador('203.0.113.77', t));
    expect(chaveTetoGlobalVerificador(t)).toBe(chaveTetoGlobalVerificador(new Date('2026-10-24T12:00:59Z')));
    expect(chaveTetoGlobalVerificador(t)).not.toBe(
      chaveTetoGlobalVerificador(new Date('2026-10-24T12:01:00Z')),
    );
  });

  it('limite por minuto e a primeira barrada (uma linha só por minuto)', () => {
    expect(dentroDoLimite(20, 20)).toBe(true);
    expect(dentroDoLimite(21, 20)).toBe(false);
    expect(dentroDoLimite(1, 0)).toBe(true);
    expect(primeiraBarrada(21, 20)).toBe(true);
    expect(primeiraBarrada(22, 20)).toBe(false);
    expect(primeiraBarrada(20, 20)).toBe(false);
  });
});

describe('verificador público: a situação mostrada', () => {
  const assinada = { estado: 'assinada' as const };
  it('sem documento ou sem assinatura: não encontrado (a prévia nunca assinada não aparece)', () => {
    expect(situacaoDaVerificacao(null)).toBe('nao-encontrado');
    expect(situacaoDaVerificacao({ suspenso: false, assinatura: null, validacao: null })).toBe(
      'nao-encontrado',
    );
  });
  it('suspenso, pendente (regra 5), falha e o resultado da validação mais recente', () => {
    expect(
      situacaoDaVerificacao({ suspenso: true, assinatura: assinada, validacao: { resultado: 'valida' } }),
    ).toBe('suspenso');
    expect(
      situacaoDaVerificacao({ suspenso: false, assinatura: { estado: 'pendente' }, validacao: null }),
    ).toBe('pendente');
    expect(situacaoDaVerificacao({ suspenso: false, assinatura: { estado: 'falha' }, validacao: null })).toBe(
      'invalida',
    );
    expect(
      situacaoDaVerificacao({ suspenso: false, assinatura: assinada, validacao: { resultado: 'valida' } }),
    ).toBe('valida');
    expect(situacaoDaVerificacao({ suspenso: false, assinatura: assinada, validacao: null })).toBe(
      'indeterminada',
    );
  });
  it('o resultado gravado: o suspenso grava a validação do documento achado', () => {
    const d = { suspenso: true, assinatura: assinada, validacao: { resultado: 'valida' as const } };
    expect(resultadoParaGravar('suspenso', d)).toBe('valida');
    expect(resultadoParaGravar('suspenso', { ...d, validacao: null })).toBe('indeterminada');
    expect(resultadoParaGravar('pendente', d)).toBe('pendente');
  });
});
