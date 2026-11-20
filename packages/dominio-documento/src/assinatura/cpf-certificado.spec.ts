// Regra 2 do M49 (SBIS-31): o CPF do certificado (otherName 2.16.76.1.3.1) é o do usuário a cada uso; diferente,
// recusa. Certificados e CPFs sintéticos (certificados-teste.spec-util.ts).
import { describe, expect, it } from 'vitest';
import { conferirCpf, cpfDoCertificado, cpfValido, lerCertificado, normalizarCpf } from './certificado.js';
import { CPF_TESTE_A, CPF_TESTE_B, certificadoTeste, cpfSintetico } from './certificados-teste.spec-util.js';
import { ErroDer } from './der.js';
import { OID_PF_DADOS_TITULAR, RAIZ_POLITICA_POR_TIPO, tipoPelaPolitica } from './oids.js';

describe('leitura do certificado', () => {
  it('lê série, vigência, KeyUsage, políticas e o otherName do titular', () => {
    const c = lerCertificado(certificadoTeste({ serie: Uint8Array.of(0x00, 0x8a, 0x01) }));
    expect(c.serie).toBe('8a01');
    expect(c.validoDe.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(c.validoAte.toISOString()).toBe('2028-01-01T00:00:00.000Z');
    expect(c.usoDaChave).toEqual({ assinaturaDigital: true, naoRepudio: true });
    expect(c.politicas).toEqual([`${RAIZ_POLITICA_POR_TIPO.A3}.12`]);
    expect(Object.keys(c.outrosNomes)).toEqual([OID_PF_DADOS_TITULAR]);
    expect(tipoPelaPolitica(c.politicas)).toBe('A3');
  });

  it('sem KeyUsage fica null; só assinatura digital não traz não repúdio', () => {
    expect(lerCertificado(certificadoTeste({ usoDaChave: null })).usoDaChave).toBeNull();
    expect(lerCertificado(certificadoTeste({ usoDaChave: 0x80 })).usoDaChave).toEqual({
      assinaturaDigital: true,
      naoRepudio: false,
    });
  });

  it('data em GeneralizedTime (depois de 2049) também é lida', () => {
    const c = lerCertificado(certificadoTeste({ validoAte: new Date('2049-12-31T23:59:59Z') }));
    expect(c.validoAte.getUTCFullYear()).toBe(2049);
  });

  it('DER truncado ou sem estrutura de certificado é recusado', () => {
    const der = certificadoTeste();
    expect(() => lerCertificado(der.subarray(0, der.length - 3))).toThrow(ErroDer);
    expect(() => lerCertificado(Uint8Array.of(0x02, 0x01, 0x01))).toThrow(ErroDer);
  });

  it('política fora da ICP-Brasil não tem tipo', () => {
    expect(tipoPelaPolitica(['1.2.3.4'])).toBeNull();
    expect(tipoPelaPolitica([RAIZ_POLITICA_POR_TIPO.A1])).toBe('A1');
  });
});

describe('CPF do certificado contra o do usuário (regra 2)', () => {
  it('o CPF sintético tem dígitos válidos; repetidos e curtos não', () => {
    expect(cpfValido(CPF_TESTE_A)).toBe(true);
    expect(cpfValido(cpfSintetico('123123123'))).toBe(true);
    expect(cpfValido('11111111111')).toBe(false);
    expect(cpfValido('123')).toBe(false);
    expect(cpfValido(`${CPF_TESTE_A.slice(0, 10)}${(Number(CPF_TESTE_A[10]) + 1) % 10}`)).toBe(false);
  });

  it('normaliza o número do cadastro (zeros à esquerda; zero e vazio são ausência)', () => {
    expect(normalizarCpf(Number(CPF_TESTE_A))).toBe(CPF_TESTE_A);
    expect(normalizarCpf(0)).toBeNull();
    expect(normalizarCpf(null)).toBeNull();
    expect(normalizarCpf('')).toBeNull();
    expect(normalizarCpf('1'.repeat(12))).toBeNull();
    expect(normalizarCpf(BigInt(CPF_TESTE_A))).toBe(CPF_TESTE_A);
  });

  it('igual: aceita', () => {
    const c = lerCertificado(certificadoTeste({ cpf: CPF_TESTE_A }));
    expect(cpfDoCertificado(c)).toBe(CPF_TESTE_A);
    expect(conferirCpf(c, Number(CPF_TESTE_A))).toEqual({ ok: true });
  });

  it('diferente: recusa com cpf-divergente', () => {
    const c = lerCertificado(certificadoTeste({ cpf: CPF_TESTE_A }));
    expect(conferirCpf(c, CPF_TESTE_B)).toEqual({ ok: false, motivo: 'cpf-divergente' });
  });

  it('certificado sem o otherName, com CPF zerado ou inválido: recusa', () => {
    expect(conferirCpf(lerCertificado(certificadoTeste({ cpf: null })), CPF_TESTE_A)).toEqual({
      ok: false,
      motivo: 'certificado-sem-cpf',
    });
    expect(conferirCpf({ outrosNomes: { [OID_PF_DADOS_TITULAR]: '0'.repeat(51) } }, CPF_TESTE_A)).toEqual({
      ok: false,
      motivo: 'certificado-sem-cpf',
    });
    expect(conferirCpf({ outrosNomes: { [OID_PF_DADOS_TITULAR]: '0101' } }, CPF_TESTE_A).ok).toBe(false);
  });

  it('usuário sem CPF no cadastro: recusa (nunca assina "sem conferir")', () => {
    const c = lerCertificado(certificadoTeste());
    expect(conferirCpf(c, null)).toEqual({ ok: false, motivo: 'usuario-sem-cpf' });
    expect(conferirCpf(c, '11111111111')).toEqual({ ok: false, motivo: 'usuario-sem-cpf' });
  });
});
