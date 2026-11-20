import { describe, expect, it } from 'vitest';
import { SITUACOES_CREDENCIAL } from '@sgh/contratos';
import {
  algoritmoDoPhc,
  caminhoDoLogin,
  contarEmFaixa,
  faixaContagemCredencial,
  MENSAGENS_RECUSA_RETIRADA,
  recusaRetiradaSenha,
  legadoMudouDepoisDaForte,
  situacaoCredencial,
  type SenhaLegadoLida,
} from './credencial-forte.js';
import { cifrarSenha, conferirSenha } from '../cifra-plataforma.js';

const forte = { criadaEm: new Date('2026-11-10T12:00:00Z'), algoritmo: 'argon2id' };
const legado = (p: Partial<SenhaLegadoLida> = {}): SenhaLegadoLida => ({
  presente: true,
  criptografada: true,
  comSalt: true,
  alteradaEm: new Date('2026-01-01T00:00:00Z'),
  ...p,
});

describe('credencial forte no login (M59-F2, regra 2)', () => {
  it('sem forte: confere a do legado e regrava', () => {
    expect(caminhoDoLogin(null, legado())).toBe('legado-e-regravar');
  });
  it('com forte: só a forte', () => {
    expect(caminhoDoLogin(forte, legado())).toBe('forte');
    expect(caminhoDoLogin(forte, legado({ presente: false, alteradaEm: null }))).toBe('forte');
    expect(caminhoDoLogin(forte, legado({ alteradaEm: null }))).toBe('forte');
  });
  it('senha antiga trocada depois da forte: volta ao legado (coexistência)', () => {
    expect(caminhoDoLogin(forte, legado({ alteradaEm: new Date('2026-11-11T00:00:00Z') }))).toBe(
      'legado-e-regravar',
    );
  });
  it('senha antiga trocada no MESMO dia da forte (a coluna é DATE, meia-noite): volta ao legado', () => {
    // forte às 12:00 de 10/11; a troca no outro sistema às 15:00 grava só o dia 10/11 (00:00).
    const mesmoDia = legado({ alteradaEm: new Date('2026-11-10T00:00:00Z') });
    expect(caminhoDoLogin(forte, mesmoDia)).toBe('legado-e-regravar');
    expect(situacaoCredencial(forte, mesmoDia)).not.toBe('forte');
    expect(legadoMudouDepoisDaForte(new Date('2026-11-10T00:00:00Z'), forte.criadaEm)).toBe(true);
    // véspera da forte: a forte vale.
    expect(caminhoDoLogin(forte, legado({ alteradaEm: new Date('2026-11-09T00:00:00Z') }))).toBe('forte');
    expect(legadoMudouDepoisDaForte(null, forte.criadaEm)).toBe(false);
  });
  it('senha antiga já retirada: a forte vale mesmo com data mais nova', () => {
    expect(
      caminhoDoLogin(forte, legado({ presente: false, alteradaEm: new Date('2027-01-01T00:00:00Z') })),
    ).toBe('forte');
  });
  it('algoritmo desconhecido não é forte', () => {
    expect(caminhoDoLogin({ ...forte, algoritmo: 'sha1' }, legado())).toBe('legado-e-regravar');
  });
  it('o esquema forte é Argon2id com sal individual (duas cifras da mesma senha diferem)', async () => {
    const p = { memoria: 8_192, passes: 1, paralelismo: 1 };
    const a = await cifrarSenha('Senha-Sintetica-1', p);
    const b = await cifrarSenha('Senha-Sintetica-1', p);
    expect(a).not.toBe(b);
    expect(algoritmoDoPhc(a)).toBe('argon2id');
    expect(await conferirSenha('Senha-Sintetica-1', a)).toBe(true);
    expect(await conferirSenha('senha-sintetica-1', a)).toBe(false);
    expect(algoritmoDoPhc('texto')).toBeNull();
  });
});

describe('situação da senha e faixas', () => {
  it('classes', () => {
    expect(situacaoCredencial(forte, legado())).toBe('forte');
    expect(situacaoCredencial(null, legado())).toBe('legado-cifrada');
    expect(situacaoCredencial(null, legado({ comSalt: false }))).toBe('legado-sem-salt');
    expect(situacaoCredencial(null, legado({ criptografada: false }))).toBe('legado-texto-puro');
    expect(situacaoCredencial(null, legado({ presente: false }))).toBe('sem-senha');
    expect(situacaoCredencial(forte, legado({ alteradaEm: new Date('2027-01-01T00:00:00Z') }))).toBe(
      'legado-cifrada',
    );
  });
  it('faixas: nada abaixo de 5 sai', () => {
    expect(faixaContagemCredencial(0)).toBe(0);
    expect(faixaContagemCredencial(-1)).toBe(0);
    expect(faixaContagemCredencial(Number.NaN)).toBe(0);
    expect(faixaContagemCredencial(4)).toBe('<5');
    expect(faixaContagemCredencial(5)).toBe(5);
    const r = contarEmFaixa(SITUACOES_CREDENCIAL, [
      'forte',
      'forte',
      'sem-senha',
      ...Array(6).fill('legado-cifrada'),
    ]);
    expect(r).toEqual({
      forte: '<5',
      'legado-cifrada': 6,
      'legado-sem-salt': 0,
      'legado-texto-puro': 0,
      'sem-senha': '<5',
    });
  });
});

describe('retirada da senha antiga (regra 1; acesso.retirarSenhaLegado)', () => {
  const base = { contingencia: false, integracao: false, forte, legado: legado() };
  it('pode com contingência desligada e credencial forte', () => {
    expect(recusaRetiradaSenha(base)).toBeNull();
  });
  it('recusa com a contingência ligada, antes de tudo', () => {
    expect(recusaRetiradaSenha({ ...base, contingencia: true, forte: null })).toBe('contingencia-ativa');
  });
  it('recusas', () => {
    expect(recusaRetiradaSenha({ ...base, integracao: true })).toBe('usuario-integracao');
    expect(recusaRetiradaSenha({ ...base, forte: null })).toBe('sem-credencial-forte');
    expect(recusaRetiradaSenha({ ...base, legado: legado({ presente: false }) })).toBe('sem-senha-legado');
    expect(
      recusaRetiradaSenha({ ...base, legado: legado({ alteradaEm: new Date('2027-01-01T00:00:00Z') }) }),
    ).toBe('credencial-forte-desatualizada');
  });
  it('toda recusa tem mensagem sem citar o sistema anterior pelo nome', () => {
    for (const m of Object.values(MENSAGENS_RECUSA_RETIRADA)) expect(m).not.toMatch(/SPDATA|legado/i);
  });
});
