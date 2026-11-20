// Regra 3 do M49 (SBIS-32 a SBIS-34, SBIS-40, ICP-04): validação no servidor com certificados sintéticos.
import { describe, expect, it } from 'vitest';
import { lerCertificado } from './certificado.js';
import { CPF_TESTE_A, CPF_TESTE_B, certificadoTeste } from './certificados-teste.spec-util.js';
import { decidirValidacao, type FatosValidacao } from './validacao.js';

const agora = new Date('2026-10-24T12:00:00Z');
const base = (x: Partial<FatosValidacao> = {}): FatosValidacao => ({
  agora,
  certificado: lerCertificado(certificadoTeste()),
  cadeia: 'ok',
  revogacao: 'boa',
  politicaAssinatura: 'AD-RT',
  ...x,
});

describe('validação da assinatura', () => {
  it('tudo em ordem: válida', () => {
    const v = decidirValidacao(base({ cpfDoUsuario: CPF_TESTE_A }));
    expect(v).toMatchObject({
      resultado: 'valida',
      motivos: [],
      cadeia: true,
      vigencia: true,
      revogacao: true,
      cpf: true,
    });
    expect(v.falhaTransitoria).toBeNull();
  });

  it('cadeia que não chega à raiz ICP-Brasil: inválida', () => {
    expect(decidirValidacao(base({ cadeia: 'invalida' }))).toMatchObject({
      resultado: 'invalida',
      motivos: ['cadeia-invalida'],
      cadeia: false,
    });
  });

  it('fora da vigência: inválida; com carimbo dentro da vigência: válida (AD-RT)', () => {
    const vencido = lerCertificado(certificadoTeste({ validoAte: new Date('2026-06-30T00:00:00Z') }));
    expect(decidirValidacao(base({ certificado: vencido })).motivos).toEqual(['fora-da-vigencia']);
    expect(
      decidirValidacao(base({ certificado: vencido, carimboEm: new Date('2026-06-01T10:00:00Z') })).resultado,
    ).toBe('valida');
  });

  it('revogado antes do carimbo (ou sem data): inválida; revogado depois do carimbo: válida', () => {
    expect(decidirValidacao(base({ revogacao: 'revogado' })).motivos).toEqual(['revogado']);
    expect(
      decidirValidacao(
        base({
          revogacao: 'revogado',
          revogadoEm: new Date('2026-09-01T00:00:00Z'),
          carimboEm: new Date('2026-10-01T00:00:00Z'),
        }),
      ).resultado,
    ).toBe('invalida');
    const depois = decidirValidacao(
      base({
        revogacao: 'revogado',
        revogadoEm: new Date('2026-10-20T00:00:00Z'),
        carimboEm: new Date('2026-10-01T00:00:00Z'),
      }),
    );
    expect(depois).toMatchObject({ resultado: 'valida', revogacao: true });
  });

  it('LCR ou OCSP fora do ar: indeterminada, com a falha transitória para o reprocessamento', () => {
    expect(decidirValidacao(base({ revogacao: 'ocsp-indisponivel' }))).toMatchObject({
      resultado: 'indeterminada',
      revogacao: null,
      falhaTransitoria: 'ocsp-indisponivel',
    });
    expect(decidirValidacao(base({ cadeia: 'indisponivel' }))).toMatchObject({
      resultado: 'indeterminada',
      cadeia: null,
      falhaTransitoria: 'lcr-indisponivel',
    });
  });

  it('inválida vence indeterminada (e então não há reprocessamento)', () => {
    const v = decidirValidacao(base({ revogacao: 'lcr-indisponivel', cadeia: 'invalida' }));
    expect(v.resultado).toBe('invalida');
    expect(v.falhaTransitoria).toBeNull();
    expect(v.motivos).toEqual(['cadeia-invalida', 'revogacao-indisponivel']);
  });

  it('KeyUsage sem não repúdio, certificado fora da ICP e assinatura sem política: inválida', () => {
    expect(
      decidirValidacao(base({ certificado: lerCertificado(certificadoTeste({ usoDaChave: 0x80 })) })).motivos,
    ).toEqual(['uso-da-chave']);
    expect(
      decidirValidacao(base({ certificado: lerCertificado(certificadoTeste({ usoDaChave: null })) })).motivos,
    ).toEqual(['uso-da-chave']);
    expect(
      decidirValidacao(base({ certificado: lerCertificado(certificadoTeste({ politicas: ['1.2.3.4'] })) }))
        .motivos,
    ).toEqual(['fora-da-icp']);
    expect(decidirValidacao(base({ politicaAssinatura: null })).motivos).toEqual(['sem-politica']);
  });

  it('ao assinar, CPF divergente ou ausente invalida; fora do assinar, o CPF não é conferido', () => {
    expect(decidirValidacao(base({ cpfDoUsuario: CPF_TESTE_B })).motivos).toEqual(['cpf-divergente']);
    expect(decidirValidacao(base({ cpfDoUsuario: null })).motivos).toEqual(['cpf-ausente']);
    expect(decidirValidacao(base()).cpf).toBeNull();
  });
});
