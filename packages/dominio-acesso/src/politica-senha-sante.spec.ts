// W1-01 (parte 5): a política do Sante por estabelecimento soma-se a TBCFGLOGIN (só aperta) e recusa a senha
// derivada do nome, da data de nascimento e as comuns/proibidas.
import { describe, expect, it } from 'vitest';
import {
  avaliarSenhaNova,
  derivaDoNascimento,
  derivaDoNome,
  gerarSenhaProvisoria,
  politicaEfetiva,
  type PoliticaSenhaLegado,
  type PoliticaSenhaSante,
  senhaComum,
} from './politica-senha.js';

const legado: PoliticaSenhaLegado = {
  minimoCaracteres: 10,
  exigeLetra: false,
  exigeNumero: false,
  exigeEspecial: true,
  exigeMinuscula: false,
  exigeMaiuscula: false,
  periodoTrocaDias: 90,
  periodoReutilizacaoDias: 365,
};

const sante: PoliticaSenhaSante = {
  versao: 2,
  minimoCaracteres: 8,
  exigeEspecial: false,
  exigeMinuscula: true,
  exigeMaiuscula: true,
  trocaDias: 60,
  reusoDias: 180,
  recusaNome: true,
  recusaNascimento: true,
  recusaComuns: true,
  senhasProibidas: ['Redesante', 'hospitalx'],
};

describe('política do Sante (W1-01, parte 5)', () => {
  it('só aperta: tamanho e reuso pelo maior, classes por "ou", expiração pelo menor prazo positivo', () => {
    const p = politicaEfetiva(legado, sante);
    expect(p).toMatchObject({
      minimoCaracteres: 10,
      exigeEspecial: true,
      exigeMinuscula: true,
      exigeMaiuscula: true,
      periodoTrocaDias: 60,
      periodoReutilizacaoDias: 365,
      recusaNome: true,
      recusaNascimento: true,
      recusaComuns: true,
    });
    expect(
      politicaEfetiva({ ...legado, periodoTrocaDias: 0 }, { ...sante, trocaDias: 0 }).periodoTrocaDias,
    ).toBe(0);
    expect(politicaEfetiva({ ...legado, periodoTrocaDias: null }, sante).periodoTrocaDias).toBe(60);
    expect(politicaEfetiva(legado, { ...sante, trocaDias: 0 }).periodoTrocaDias).toBe(90);
    expect(politicaEfetiva(legado, { ...sante, minimoCaracteres: 14 }).minimoCaracteres).toBe(14);
  });

  it('sem a política do Sante nada muda (as recusas novas ficam desligadas)', () => {
    const p = politicaEfetiva(legado, null);
    expect(p.recusaComuns).toBeUndefined();
    expect(avaliarSenhaNova('Brasil@20241', 'SINT_X', p, { nome: 'Fulano Brasil' })).toEqual([]);
  });

  it('recusa a senha derivada do nome e da data de nascimento', () => {
    expect(derivaDoNome('Joao#Silva77', 'João da Silva')).toBe(true);
    expect(derivaDoNome('Xy#da77qwerty', 'João da Silva')).toBe(false); // "da" é curto
    expect(derivaDoNome('qualquer', null)).toBe(false);
    expect(derivaDoNascimento('Ab#15031980', '1980-03-15')).toBe(true);
    expect(derivaDoNascimento('Ab#19800315', '1980-03-15')).toBe(true);
    expect(derivaDoNascimento('Ab#150380x', '1980-03-15')).toBe(true);
    expect(derivaDoNascimento('Ab#03151980', '1980-03-15')).toBe(true);
    expect(derivaDoNascimento('Ab#1980xx', '1980-03-15')).toBe(false);
    expect(derivaDoNascimento('Ab#15031980', null)).toBe(false);
    const p = politicaEfetiva(legado, sante);
    expect(
      avaliarSenhaNova('Silva#2026xyz', 'SINT_X', p, { nome: 'Maria Silva', nascimento: '1980-03-15' }),
    ).toEqual(['deriva-do-nome']);
    expect(
      avaliarSenhaNova('Kq#15031980zz', 'SINT_X', p, { nome: 'Maria Silva', nascimento: '1980-03-15' }),
    ).toEqual(['deriva-do-nascimento']);
  });

  it('recusa a senha comum (lista embutida, também com dígitos no fim) e a da lista local', () => {
    expect(senhaComum('Brasil@2024', [], true)).toBe(true);
    expect(senhaComum('SENHA123', [], true)).toBe(true);
    expect(senhaComum('RedeSante!99', ['Redesante'], false)).toBe(true);
    expect(senhaComum('Brasil@2024', [], false)).toBe(false);
    expect(senhaComum('Kq7#mWz2pLx', ['Redesante'], true)).toBe(false);
    const p = politicaEfetiva(legado, sante);
    expect(avaliarSenhaNova('Hospitalx#123', 'SINT_X', p)).toEqual(['comum']);
    expect(avaliarSenhaNova('Kq7#mWz2pLx', 'SINT_X', p, { nome: 'Maria Silva' })).toEqual([]);
  });

  it('a senha provisória cumpre a política do Sante', () => {
    const p = politicaEfetiva(legado, { ...sante, minimoCaracteres: 16 });
    let i = 7;
    const s = gerarSenhaProvisoria(p, 'SINT_X', (n) => (i = (i * 31 + 11) % 9973) % n);
    expect(s).toHaveLength(16);
    expect(avaliarSenhaNova(s, 'SINT_X', p)).toEqual([]);
  });
});
