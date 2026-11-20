// Casos de sante-api: test/fonetica.test.js (as grafias erradas medidas e as famílias perigosas), reescritos;
// nomes de exemplo genéricos, nenhum cadastro real.
import { describe, expect, it } from 'vitest';
import {
  casaFoneticamente,
  casaPalavras,
  chaveFonetica,
  palavraMaisSeletiva,
  palavrasDoCadastro,
  palavrasDoTermo,
  sugerirFoneticos,
  telefoneDoTermo,
  termoIdentifica,
} from './fonetica.js';

const mesma = (a: string, b: string) => chaveFonetica(a) === chaveFonetica(b);

describe('chave fonética em português (regra 5)', () => {
  it('as grafias que o paciente fala colapsam na grafia do cadastro', () => {
    for (const [dito, cadastrado] of [
      ['RALF', 'RALPH'],
      ['LANES', 'LANNES'],
      ['BENEDITO', 'BENEDICTO'],
      ['POL', 'POHL'],
      ['VIANA', 'VIANNA'],
      ['BAUBI', 'BALBI'],
      ['RAMOM', 'RAMON'],
      ['ERNANI', 'ERNANE'],
      ['CASCELI', 'CASCELLI'],
      ['GABRIELA', 'GABRIELLA'],
      ['BITENCOURTT', 'BITTENCOURT'],
      ['CINTIA', 'CINTHYA'],
    ] as const)
      expect(mesma(dito, cadastrado), `${dito} ~ ${cadastrado}`).toBe(true);
  });
  it('Y vem antes do C e do G brandos', () => {
    expect(mesma('LETICYA', 'LETICIA')).toBe(true);
    expect(mesma('CYNTHIA', 'CINTIA')).toBe(true);
    expect(mesma('GYSELE', 'GISELE')).toBe(true);
    expect(mesma('MAURICYO', 'MAURICIO')).toBe(true);
  });
  it('o CH que é /k/ não vira chiado; o Q sem U sobrevive; ROCHA e ROSA fundem', () => {
    expect(mesma('MAKHLUF', 'MACHLUF')).toBe(true);
    expect(mesma('CHRISTINA', 'CRISTINA')).toBe(true);
    expect(mesma('PASCHOAL', 'PASCOAL')).toBe(true);
    expect(mesma('QEIROZ', 'QUEIROZ')).toBe(true);
    expect(mesma('ROCHA', 'ROSA')).toBe(true);
  });
  it('entrada degenerada devolve texto', () => {
    for (const x of ['', null, undefined, '   ']) expect(typeof chaveFonetica(x)).toBe('string');
  });
});

describe('casamento por palavra e fonético', () => {
  const nome = palavrasDoCadastro('JOSÉ CARLOS DA SILVA JÚNIOR');
  it('palavras sem acento e sem caixa; conjuntivo; inicial; prefixo a partir de 4 letras', () => {
    expect(nome).toEqual(['JOSE', 'CARLOS', 'DA', 'SILVA', 'JUNIOR']);
    expect(casaPalavras(palavrasDoTermo('jose silva'), nome)).toBe(true);
    expect(casaPalavras(palavrasDoTermo('José C. Silva'), nome)).toBe(true);
    expect(casaPalavras(palavrasDoTermo('JOSE SOUZA'), nome)).toBe(false);
    expect(casaPalavras(palavrasDoTermo('SILV'), nome)).toBe(true);
    expect(casaPalavras(palavrasDoTermo('SIL'), nome)).toBe(false);
  });
  it('termo só de iniciais ou títulos não casa nada (verdade vacuosa)', () => {
    for (const t of ['J', 'J K', 'DR J C', 'DRA', '']) {
      expect(casaPalavras(palavrasDoTermo(t), nome)).toBe(false);
      expect(casaFoneticamente(palavrasDoTermo(t), nome)).toBe(false);
    }
    expect(termoIdentifica([])).toBe(false);
  });
  it('fonético: grafia errada casa; a inicial compara com a palavra crua', () => {
    expect(casaFoneticamente(palavrasDoTermo('JOZE CARLLOS SILVA'), nome)).toBe(true);
    const outro = palavrasDoCadastro('CARLOS EDUARDO SOUZA');
    expect(casaFoneticamente(palavrasDoTermo('C EDUARDO SOUSA'), outro)).toBe(true);
    expect(casaFoneticamente(palavrasDoTermo('K EDUARDO SOUSA'), outro)).toBe(false);
  });
  it('sugestões fonéticas só quando a palavra não casa, até 5', () => {
    const cands = [
      'CINTHYA GABRIELLA VIANNA',
      'CINTIA GABRIELA VIANA',
      ...Array.from({ length: 8 }, () => 'SINTIA GABRIELA BIANCA'),
    ];
    const s = sugerirFoneticos('CINTIA GABRIELA VIANA', cands, (x) => x);
    expect(s).toEqual(['CINTHYA GABRIELLA VIANNA']);
    const muitos = Array.from({ length: 9 }, () => 'CINTHYA VIANNA');
    expect(sugerirFoneticos('CINTIA VIANA', muitos, (x) => x)).toHaveLength(5);
    expect(sugerirFoneticos('DR', muitos, (x) => x)).toEqual([]);
  });
  it('palavra mais seletiva e telefone pelos 8 últimos dígitos', () => {
    expect(palavraMaisSeletiva(['JOSE', 'BITTENCOURT', 'A'])).toBe('BITTENCOURT');
    expect(palavraMaisSeletiva(['A'])).toBeNull();
    expect(telefoneDoTermo('(31) 99876-5432')).toBe('98765432');
    expect(telefoneDoTermo('1234')).toBeNull();
  });
});
