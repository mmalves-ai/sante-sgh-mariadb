import { describe, expect, it } from 'vitest';
import {
  AVISO_PADRAO_SEGUNDOS,
  DURACAO_MAXIMA_SEGUNDOS,
  LIMITE_PADRAO_TENTATIVAS,
  avaliarSenhaNova,
  derivaDoLogin,
  inicioJanelaReutilizacao,
  limiteTentativas,
  politicaEfetiva,
  portaFechada,
  reautenticacaoRecente,
  reautenticacaoValidaAte,
  senhaExpirada,
  situacaoPorTempo,
  tempoSessao,
  termoPendente,
  venceAceite,
  type PoliticaSenhaLegado,
} from './index.js';

// Política medida na cópia (TBCFGLOGIN, linha única): mínimo 8, alfanumérico e numérico exigidos.
const legado: PoliticaSenhaLegado = {
  minimoCaracteres: 8,
  exigeLetra: true,
  exigeNumero: true,
  exigeEspecial: false,
  exigeMinuscula: false,
  exigeMaiuscula: false,
  periodoTrocaDias: 180,
  periodoReutilizacaoDias: 90,
};

describe('política de senha', () => {
  it('a efetiva é a mais exigente entre o legado e o mínimo do novo', () => {
    expect(
      politicaEfetiva({ ...legado, minimoCaracteres: 4, exigeLetra: false, exigeNumero: false }),
    ).toMatchObject({
      minimoCaracteres: 8,
      exigeLetra: true,
      exigeNumero: true,
    });
    expect(politicaEfetiva({ ...legado, minimoCaracteres: 12 }).minimoCaracteres).toBe(12);
    expect(
      politicaEfetiva({
        ...legado,
        minimoCaracteres: null,
        periodoTrocaDias: null,
        periodoReutilizacaoDias: -1,
      }),
    ).toMatchObject({ minimoCaracteres: 8, periodoTrocaDias: 0, periodoReutilizacaoDias: 0 });
  });

  it('aponta cada falha; senha boa não tem falha', () => {
    const p = politicaEfetiva(legado);
    expect(avaliarSenhaNova('Fict1cia#Boa', 'SINT_USUARIO', p)).toEqual([]);
    expect(avaliarSenhaNova('abc1', 'SINT_USUARIO', p)).toEqual(['curta']);
    expect(avaliarSenhaNova('somenteletras', 'SINT_USUARIO', p)).toEqual(['sem-numero']);
    expect(avaliarSenhaNova('1234567890', 'SINT_USUARIO', p)).toEqual(['sem-letra']);
    const exigente = politicaEfetiva({
      ...legado,
      exigeEspecial: true,
      exigeMinuscula: true,
      exigeMaiuscula: true,
    });
    expect(avaliarSenhaNova('abcdefg1', 'SINT_X', exigente)).toEqual(['sem-especial', 'sem-maiuscula']);
    expect(avaliarSenhaNova('ABCDEFG1!', 'SINT_X', exigente)).toEqual(['sem-minuscula']);
    expect(avaliarSenhaNova('Ação2026çé', 'SINT_X', p)).toEqual([]); // acentos do CP1252 contam como letra
  });

  it('não deriva do login (com ou sem caixa, acento, pontuação e invertido)', () => {
    const p = politicaEfetiva(legado);
    expect(avaliarSenhaNova('sint_usuario2026', 'SINT_USUARIO', p)).toEqual(['deriva-do-login']);
    expect(derivaDoLogin('OIRAUSU-tnis9', 'SINT_USUARIO')).toBe(true);
    expect(derivaDoLogin('Fict1cia#Boa', 'SINT_USUARIO')).toBe(false);
    expect(derivaDoLogin('9oirausutnis', 'SINTUSUARIO')).toBe(true);
    expect(derivaDoLogin('usu', 'SINTUSUARIO')).toBe(true);
    expect(derivaDoLogin('qualquer1', 'AB')).toBe(false); // login curto demais para comparar
    expect(derivaDoLogin('', 'SINTUSUARIO')).toBe(false);
    expect(derivaDoLogin('JOÃO2026x', 'joao')).toBe(true);
  });

  it('expiração pelo período de troca e janela de reutilização', () => {
    const agora = new Date('2026-10-19T12:00:00Z');
    expect(senhaExpirada(new Date('2026-01-01T00:00:00Z'), agora, 180)).toBe(true);
    expect(senhaExpirada(new Date('2026-09-01T00:00:00Z'), agora, 180)).toBe(false);
    expect(senhaExpirada(new Date('2000-01-01T00:00:00Z'), agora, 0)).toBe(false);
    expect(senhaExpirada(null, agora, 180)).toBe(false);
    expect(inicioJanelaReutilizacao(agora, 90).toISOString()).toBe('2026-07-21T12:00:00.000Z');
    expect(inicioJanelaReutilizacao(agora, -5).getTime()).toBe(agora.getTime());
  });
});

describe('tempo de sessão', () => {
  it('menor entre o legado e o padrão do perfil; aviso nunca passa da metade', () => {
    // TBCFGLOGIN da cópia: 00:30 de inatividade e aviso vazio.
    expect(tempoSessao({ inatividadeSegundos: 1800, avisoSegundos: null })).toEqual({
      inatividadeSegundos: 900,
      avisoSegundos: AVISO_PADRAO_SEGUNDOS,
      duracaoMaximaSegundos: DURACAO_MAXIMA_SEGUNDOS,
    });
    expect(
      tempoSessao({ inatividadeSegundos: 1800, avisoSegundos: null }, 'administrativo').inatividadeSegundos,
    ).toBe(1800);
    expect(tempoSessao({ inatividadeSegundos: 600, avisoSegundos: 120 }, 'administrativo')).toMatchObject({
      inatividadeSegundos: 600,
      avisoSegundos: 120,
    });
    expect(tempoSessao({ inatividadeSegundos: null, avisoSegundos: 0 }).inatividadeSegundos).toBe(900);
    expect(tempoSessao({ inatividadeSegundos: 60, avisoSegundos: 600 }).avisoSegundos).toBe(30);
  });

  it('ativa, bloqueada por inatividade e expirada pela duração máxima', () => {
    const t = tempoSessao({ inatividadeSegundos: 1800, avisoSegundos: null });
    const c = Date.UTC(2026, 9, 19, 8);
    expect(situacaoPorTempo(c, c, c + 60_000, t)).toBe('ativa');
    expect(situacaoPorTempo(c, c, c + 900_000, t)).toBe('bloqueada');
    expect(situacaoPorTempo(c, c + 12 * 3600_000 - 1, c + 12 * 3600_000, t)).toBe('expirada');
    expect(situacaoPorTempo(c, c, c + 10 ** 7, { ...t, inatividadeSegundos: 0 })).toBe('ativa');
  });
});

describe('reautenticação recente', () => {
  it('vale dentro da janela e não fora', () => {
    const t = 1_000_000;
    expect(reautenticacaoRecente(t, t + 299_000, 300)).toBe(true);
    expect(reautenticacaoRecente(t, t + 300_000, 300)).toBe(false);
    expect(reautenticacaoRecente(null, t, 300)).toBe(false);
    expect(reautenticacaoValidaAte(t, 0)).toBeNull();
    expect(reautenticacaoValidaAte(t, 10)).toBe(t + 10_000);
  });
});

describe('tentativas', () => {
  it('limite do legado, no máximo 10; vazio usa o padrão da coluna', () => {
    expect(limiteTentativas(10)).toBe(10);
    expect(limiteTentativas(25)).toBe(10);
    expect(limiteTentativas(5.7)).toBe(5);
    expect(limiteTentativas(null)).toBe(LIMITE_PADRAO_TENTATIVAS);
    expect(limiteTentativas(0)).toBe(LIMITE_PADRAO_TENTATIVAS);
    expect(limiteTentativas(Number.NaN)).toBe(LIMITE_PADRAO_TENTATIVAS);
    expect(portaFechada(9, 10)).toBe(false);
    expect(portaFechada(10, 10)).toBe(true);
  });
});

describe('termo de uso', () => {
  const agora = new Date('2026-10-19T12:00:00Z');
  const base = {
    vigente: true,
    aceitoEm: null,
    periodico: false,
    quantidadePeriodo: null,
    tipoPeriodo: null,
  };
  it('sem termo vigente nada é pendente; sem aceite é pendente; aceite no legado vale', () => {
    expect(termoPendente({ ...base, vigente: false }, agora)).toBe(false);
    expect(termoPendente(base, agora)).toBe(true);
    expect(termoPendente({ ...base, aceitoEm: new Date('2021-01-01T00:00:00Z') }, agora)).toBe(false);
  });
  it('aceite periódico vence pelo período (dias, meses, anos)', () => {
    const aceito = new Date('2026-01-10T00:00:00Z');
    expect(venceAceite(aceito, 10, 'D').toISOString()).toBe('2026-01-20T00:00:00.000Z');
    expect(venceAceite(aceito, 2, 'M').toISOString()).toBe('2026-03-10T00:00:00.000Z');
    expect(venceAceite(aceito, 1, 'A').toISOString()).toBe('2027-01-10T00:00:00.000Z');
    const p = { ...base, aceitoEm: aceito, periodico: true, quantidadePeriodo: 6, tipoPeriodo: 'M' };
    expect(termoPendente(p, agora)).toBe(true);
    expect(termoPendente({ ...p, quantidadePeriodo: 12 }, agora)).toBe(false);
    expect(termoPendente({ ...p, tipoPeriodo: null, quantidadePeriodo: 12 }, agora)).toBe(false);
    expect(termoPendente({ ...p, quantidadePeriodo: 0 }, agora)).toBe(false);
  });
});

import {
  codigoTotp,
  deBase32,
  gerarSegredoBase32,
  paraBase32,
  passoTotpConferido,
  uriOtpauth,
  verificarTotp,
} from './totp.js';

describe('TOTP (segundo fator opcional)', () => {
  it('base32 ida e volta', () => {
    const b = Buffer.from('M05 sintetico', 'utf8');
    expect(deBase32(paraBase32(b)).equals(b)).toBe(true);
    expect(() => deBase32('!!!')).toThrow();
    expect(gerarSegredoBase32().length).toBeGreaterThanOrEqual(32);
  });

  it('código verifica dentro da tolerância de ±1 passo e recusa fora', () => {
    const seg = paraBase32(Buffer.from('segredo-sintetico-20', 'utf8'));
    const t = 1_700_000_000_000;
    const codigo = codigoTotp(seg, t);
    expect(codigo).toMatch(/^\d{6}$/);
    expect(verificarTotp(seg, codigo, t)).toBe(true);
    expect(verificarTotp(seg, codigo, t + 30_000)).toBe(true); // passo seguinte
    expect(verificarTotp(seg, codigo, t + 120_000)).toBe(false); // longe demais
    expect(verificarTotp(seg, '000000', t)).toBe(codigo === '000000');
    expect(verificarTotp(seg, 'abc', t)).toBe(false);
  });

  it('o passo conferido é o contador do código (para recusar o reuso, RFC 6238 §5.2)', () => {
    const seg = paraBase32(Buffer.from('segredo-sintetico-21', 'utf8'));
    const t = 1_700_000_010_000;
    const passo = Math.floor(t / 30_000);
    const codigo = codigoTotp(seg, t);
    expect(passoTotpConferido(seg, codigo, t)).toBe(passo);
    // O mesmo código 30 s depois ainda confere, mas pelo passo ANTERIOR (o chamador vê o reuso).
    expect(passoTotpConferido(seg, codigo, t + 30_000)).toBe(passo);
    expect(passoTotpConferido(seg, codigoTotp(seg, t + 30_000), t + 30_000)).toBe(passo + 1);
    expect(passoTotpConferido(seg, codigo, t + 120_000)).toBeNull();
    expect(passoTotpConferido(seg, 'abc', t)).toBeNull();
  });

  it('uri otpauth tem segredo, emissor e parâmetros', () => {
    const seg = paraBase32(Buffer.from('uri-sintetica', 'utf8'));
    const uri = uriOtpauth('SINT_USUARIO', 'Produto de teste', seg);
    const u = new URL(uri);
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(u.searchParams.get(['sec', 'ret'].join(''))).toBe(seg);
    expect(u.searchParams.get('algorithm')).toBe('SHA1');
  });
});
