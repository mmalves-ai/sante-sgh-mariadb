import { describe, expect, it } from 'vitest';
import {
  BYTES_INDEFINIDOS,
  analisarCp1252,
  byteDoCaractere,
  caractereDoByte,
  codificarCp1252,
  decodificarCp1252,
  esquemaTextoCp1252,
  falhaCp1252,
  mensagemCp1252,
} from './cp1252.js';
import { CORPUS_CP1252 } from './corpus-cp1252.js';

const TODOS_OS_BYTES = Array.from({ length: 256 }, (_, b) => b);

describe('CP1252: os 256 bytes', () => {
  it('exatamente 5 bytes indefinidos (0x81, 0x8D, 0x8F, 0x90, 0x9D)', () => {
    expect(BYTES_INDEFINIDOS).toEqual([0x81, 0x8d, 0x8f, 0x90, 0x9d]);
    expect(TODOS_OS_BYTES.filter((b) => caractereDoByte(b) === null)).toEqual([...BYTES_INDEFINIDOS]);
  });

  it.each(TODOS_OS_BYTES.filter((b) => !BYTES_INDEFINIDOS.includes(b)))(
    'byte 0x%s: ida e volta sem perda',
    (b) => {
      const c = caractereDoByte(b)!;
      expect(byteDoCaractere(c)).toBe(b);
      expect(codificarCp1252(decodificarCp1252(Uint8Array.of(b)))).toEqual(Uint8Array.of(b));
    },
  );

  it('ida e volta do bloco inteiro de 251 bytes definidos', () => {
    const definidos = Uint8Array.from(TODOS_OS_BYTES.filter((b) => !BYTES_INDEFINIDOS.includes(b)));
    const texto = decodificarCp1252(definidos);
    expect([...texto]).toHaveLength(251);
    expect(texto).not.toContain('�');
    expect(codificarCp1252(texto)).toEqual(definidos);
  });

  it('byte indefinido não é decodificado em silêncio', () => {
    for (const b of BYTES_INDEFINIDOS)
      expect(() => decodificarCp1252(Uint8Array.of(b))).toThrow(/não é definido/);
  });

  it('entrada: 221 dos 256 aceitos (sem controles, exceto tabulação e quebras de linha)', () => {
    const aceitos = TODOS_OS_BYTES.filter((b) => {
      const c = caractereDoByte(b);
      return c !== null && analisarCp1252(c).recusados.length === 0;
    });
    expect(aceitos).toHaveLength(221);
    expect(aceitos).toContain(0x09);
    expect(aceitos).toContain(0x0a);
    expect(aceitos).toContain(0x0d);
    expect(aceitos).not.toContain(0x00);
    expect(aceitos).not.toContain(0x7f);
  });
});

describe('CP1252: corpus de nomes e termos clínicos', () => {
  it.each(CORPUS_CP1252.filter((t) => !t.includes('₂')))('"%s" é aceito e faz ida e volta', (t) => {
    const a = analisarCp1252(t);
    expect(a.recusados).toEqual([]);
    expect(decodificarCp1252(codificarCp1252(a.normalizado))).toBe(a.normalizado);
  });

  it('aspas curvas, travessão e reticências são mantidos (estão no CP1252)', () => {
    const t = '“curvas” ‘simples’ — travessão – meia-risca …';
    expect(analisarCp1252(t).normalizado).toBe(t);
    expect(analisarCp1252(t).recusados).toEqual([]);
  });

  it('subscrito fora do CP1252 é recusado sem troca automática', () => {
    const a = analisarCp1252('SpO₂');
    expect(a.recusados.map((r) => r.codigo)).toEqual(['U+2082']);
    expect(a.proposta).toBeNull();
  });
});

describe('CP1252: recusas, trocas e normalização', () => {
  it('emoji é recusado com mensagem clara', () => {
    const a = analisarCp1252('Bom dia 😀');
    expect(a.recusados[0]?.motivo).toBe('emoji');
    expect(mensagemCp1252(a)).toMatch(/^Emoji não pode ser gravado/);
  });

  it('emoji composto (com modificador e junção) é recusado por inteiro', () => {
    const a = analisarCp1252('ok 👍🏽');
    expect(a.recusados.length).toBeGreaterThan(0);
    expect(a.recusados.every((r) => r.motivo === 'emoji')).toBe(true);
  });

  it('letra de outro alfabeto é recusada', () => {
    expect(analisarCp1252('Ωmega ж').recusados.map((r) => r.caractere)).toEqual(['Ω', 'ж']);
  });

  it('propõe troca para símbolos fora do CP1252 ("≥" → ">=") antes de salvar', () => {
    const a = analisarCp1252('PA ≥ 140 e FC ≤ 60, Δ−2');
    expect(a.proposta).toBe('PA >= 140 e FC <= 60, delta-2');
    expect(mensagemCp1252(a)).toMatch(/troca proposta/);
  });

  it('espaço especial colado vira espaço comum; invisíveis somem; acentos combinados viram NFC', () => {
    const a = analisarCp1252('a\u00a0b\u202fc\u200bd é');
    expect(a.normalizado).toBe('a b cd é');
    expect(a.recusados).toEqual([]);
  });

  it('limite em bytes = tamanho da coluna legada (1 byte por caractere)', () => {
    const esquema = esquemaTextoCp1252({ maxBytes: 10 });
    expect(esquema.safeParse('Conceição!').success).toBe(true);
    const longo = esquema.safeParse('Conceição!!');
    expect(longo.success).toBe(false);
    expect(longo.error?.issues[0]?.message).toBe('O texto tem 11 caracteres; o limite deste campo é 10.');
  });

  it('o schema (tela e servidor) devolve o texto normalizado e recusa emoji', () => {
    const esquema = esquemaTextoCp1252({ maxBytes: 60 });
    expect(esquema.parse('Observação\u00a0livre')).toBe('Observação livre');
    const r = esquema.safeParse('febre 🤒');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/Emoji/);
  });

  it('a falha sai como código e parâmetros (a tela traduz), também no issue do schema', () => {
    expect(falhaCp1252(analisarCp1252('Bom dia 😀'))).toEqual({
      codigo: 'cp1252.emoji',
      parametros: { caractere: '😀', mais: 0, comTroca: false },
    });
    expect(falhaCp1252(analisarCp1252('abc'), 2)).toEqual({
      codigo: 'texto.tamanho',
      parametros: { bytes: 3, maxBytes: 2 },
    });
    const r = esquemaTextoCp1252({ maxBytes: 60 }).safeParse('PA ≥ 140');
    const issue = r.error?.issues[0] as { params?: { codigo?: string } } | undefined;
    expect(issue?.params?.codigo).toBe('cp1252.caractere');
  });

  it('codificar recusa caractere fora da tabela em vez de gravar "?"', () => {
    expect(() => codificarCp1252('≥')).toThrow(/U\+2265/);
  });
});
