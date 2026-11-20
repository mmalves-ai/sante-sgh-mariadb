import { CORPUS_CP1252 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { lerTexto, prepararTexto } from '../codec.js';
import { BYTES_INDEFINIDOS_CP1252, codificarCp1252, decodificarCp1252 } from '../cp1252.js';
import {
  analisarFontePsql,
  classeConversao,
  converterValor,
  idaEVoltaFecha,
  ResumoColuna,
  resumoDaLista,
  revisarFontePsqlUtf8,
  voltarValor,
} from './conversao.js';

const TODOS = Uint8Array.from({ length: 256 }, (_, i) => i);

describe('conversão para UTF-8 (M58-F3, regra 7): classe de cada coluna', () => {
  it('CHAR/VARCHAR em CP1252; catalogada como UTF-8; BLOB em bytes', () => {
    expect(classeConversao({ tabela: 'TBPACIEN', coluna: 'NOME', tipo: 'VARCHAR' })).toBe('cp1252');
    expect(classeConversao({ tabela: 'prcontevol', coluna: 'evolucao_xml', tipo: 'VARCHAR' })).toBe(
      'utf8-catalogada',
    );
    expect(classeConversao({ tabela: 'PRCONTEVOL', coluna: 'EVOLUCAO', tipo: 'BLOB' })).toBe('bytes');
    expect(() => converterValor(Uint8Array.of(0x41), 'bytes')).toThrow(/bytes/);
    expect(() => voltarValor('A', 'bytes')).toThrow(/bytes/);
  });
});

describe('conversão para UTF-8: valor', () => {
  it('os 256 bytes vão e voltam iguais pela tabela sem perda (corpus do codec)', () => {
    expect(idaEVoltaFecha(TODOS, 'cp1252')).toBe(true);
    const v = converterValor(TODOS, 'cp1252');
    expect(v.byteIndefinido).toBe(true);
    // o motor troca os 5 indefinidos por U+0000; aqui viram o C1 de mesmo número
    for (const b of BYTES_INDEFINIDOS_CP1252) expect(v.texto.codePointAt(b)).toBe(b);
    expect(converterValor(Uint8Array.of(0x80), 'cp1252').texto).toBe('€');
  });

  it('o corpus CP1252 do M02 fecha a ida e volta', () => {
    for (const t of CORPUS_CP1252.filter((x) => !x.includes('₂'))) {
      expect(idaEVoltaFecha(codificarCp1252(t), 'cp1252'), t).toBe(true);
      expect(converterValor(codificarCp1252(t), 'cp1252').texto).toBe(t);
    }
  });

  it('texto misto (UTF-8 de integração em coluna CP1252) é transliterado como está e marcado', () => {
    const misto = Buffer.from('Ação', 'utf8');
    const v = converterValor(misto, 'cp1252');
    expect(v.misto).toBe(true);
    expect(v.texto).toBe('AÃ§Ã£o');
    expect(idaEVoltaFecha(misto, 'cp1252')).toBe(true);
    expect(converterValor(codificarCp1252('Ação'), 'cp1252').misto).toBe(false);
  });

  it('catalogada como UTF-8: sem nova transliteração; inválida vai como CP1252, marcada', () => {
    const xml = Buffer.from('<x>Evolução → ok</x>', 'utf8');
    const v = converterValor(xml, 'utf8-catalogada');
    expect(v).toMatchObject({ texto: '<x>Evolução → ok</x>', misto: false, utf8Invalido: false });
    expect(idaEVoltaFecha(xml, 'utf8-catalogada')).toBe(true);
    const ruim = Uint8Array.of(0x41, 0xe7, 0xe3);
    const r = converterValor(ruim, 'utf8-catalogada');
    expect(r).toMatchObject({ texto: 'Açã', utf8Invalido: true, misto: true });
    expect(idaEVoltaFecha(ruim, 'utf8-catalogada')).toBe(true);
  });
});

describe('conversão para UTF-8 (§9 codec): amostras sintéticas de BLOB RTF e de EVOLUCAO_XML', () => {
  it('BLOB RTF com acento (bytes altos e escapes) fica em bytes: nada o transforma', () => {
    // RTF sintético: escape \\'e7 e também bytes CP1252 crus (ç = 0xE7, ã = 0xE3, € = 0x80)
    const cabecalho = Buffer.from("{\\rtf1\\ansi\\ansicpg1252 Evolu\\'e7\\'e3o: ", 'latin1');
    const rtf = Uint8Array.from([...cabecalho, 0x41, 0xe7, 0xe3, 0x6f, 0x20, 0x80, 0x7d]);
    const copia = Uint8Array.from(rtf);
    expect(classeConversao({ tabela: 'PRCONTEVOL', coluna: 'EVOLUCAO', tipo: 'BLOB' })).toBe('bytes');
    expect(() => converterValor(rtf, 'bytes')).toThrow(/bytes/);
    expect(() => idaEVoltaFecha(rtf, 'bytes')).toThrow(/bytes/);
    expect(Buffer.from(rtf).equals(Buffer.from(copia))).toBe(true);
    // por que não pode virar texto: recodificar em UTF-8 mudaria os bytes que o leitor de RTF lê
    const comoTexto = Buffer.from(converterValor(rtf, 'cp1252').texto, 'utf8');
    expect(comoTexto.equals(Buffer.from(rtf))).toBe(false);
  });

  it('EVOLUCAO_XML (catalogada UTF-8): o XML vai e volta igual, sem nova transliteração', () => {
    const classe = classeConversao({ tabela: 'PRCONTEVOL', coluna: 'EVOLUCAO_XML', tipo: 'VARCHAR' });
    expect(classe).toBe('utf8-catalogada');
    const texto =
      '<?xml version="1.0" encoding="UTF-8"?><evolucao><t>Paciente sintético: dispneia, SpO₂ 95%, ação €</t></evolucao>';
    const xml = Buffer.from(texto, 'utf8');
    const v = converterValor(xml, classe);
    expect(v).toMatchObject({ texto, misto: false, utf8Invalido: false });
    expect(voltarValor(v.texto, classe, v.utf8Invalido).equals(xml)).toBe(true);
    expect(idaEVoltaFecha(xml, classe)).toBe(true);
    // transliterar de novo (como se fosse CP1252) estragaria o XML: é o que a classe evita
    expect(converterValor(xml, 'cp1252').texto).not.toBe(texto);
  });
});

describe('conversão para UTF-8: equivalência sem levar o texto', () => {
  const resumo = (vs: (string | null)[], ch = false) => {
    const r = new ResumoColuna(ch);
    for (const v of vs) r.somar(v);
    return r.resumo();
  };

  it('independe da ordem; muda com uma letra, com um nulo ou com uma linha', () => {
    expect(resumo(['a', 'b', null])).toBe(resumo([null, 'b', 'a']));
    expect(resumo(['a', 'b'])).not.toBe(resumo(['a', 'c']));
    expect(resumo(['a', null])).not.toBe(resumo(['a', '']));
    expect(resumo(['a'])).not.toBe(resumo(['a', 'a']));
    expect(resumo(['ação'])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('CHAR sem o preenchimento; a lista ordenada', () => {
    expect(resumo(['ab  '], true)).toBe(resumo(['ab'], true));
    expect(resumo(['ab  '])).not.toBe(resumo(['ab']));
    expect(resumoDaLista({ 'T.B': 'x', 'T.A': 'y' })).toBe(resumoDaLista({ 'T.A': 'y', 'T.B': 'x' }));
  });
});

describe('ResumoColuna: a soma em partes de 32 bits é a mesma do BigInt (M58.3)', () => {
  it('mil valores sintéticos, com e sem nulos e preenchimento', async () => {
    const { createHash } = await import('node:crypto');
    const valores = Array.from({ length: 1000 }, (_, i) =>
      i % 97 === 0 ? null : `valor ${i} ${'ç'.repeat(i % 3)}  `,
    );
    for (const semPreenchimento of [false, true]) {
      const r = new ResumoColuna(semPreenchimento);
      let soma = 0n;
      let nulos = 0;
      for (const v of valores) {
        r.somar(v);
        if (v === null) {
          nulos++;
          continue;
        }
        const h = createHash('sha256')
          .update(semPreenchimento ? v.replace(/ +$/, '') : v, 'utf8')
          .digest();
        soma = (soma + BigInt(`0x${h.subarray(0, 16).toString('hex')}`)) % (1n << 128n);
      }
      const esperado = createHash('sha256')
        .update(`${valores.length}|${nulos}|${soma.toString(16)}`)
        .digest('hex');
      expect(r.resumo()).toBe(esperado);
    }
  });
});

describe('conversão para UTF-8: fontes PSQL', () => {
  const f = (s: string) => codificarCp1252(s);

  it('separa comentário, literal e código', () => {
    const a = analisarFontePsql(
      f("AS BEGIN -- só comentário\n /* também é */ NEW.A = 'Ação'; NEW.B = 'it''s ã'; END"),
    );
    expect(a.emComentario).toBe(4);
    expect(a.emLiteral).toBe(3);
    expect(a.emCodigo).toBe(0);
    expect(a.aRever).toBe(false);
    expect(a.idaEVolta).toBe(true);
  });

  it('literal com sequência UTF-8 ou byte indefinido pede revisão', () => {
    const utf8 = Buffer.concat([f("NEW.A = '"), Buffer.from('ç', 'utf8'), f("';")]);
    expect(analisarFontePsql(utf8).aRever).toBe(true);
    expect(analisarFontePsql(Uint8Array.of(0x27, 0x41, 0x81, 0x27)).aRever).toBe(true);
    expect(analisarFontePsql(f('SELECT 1 FROM "TABELAÇ"')).emCodigo).toBe(1);
  });
});

describe('conversão para UTF-8: revisão um a um dos literais (ficha §5 passo 3)', () => {
  const cp = (s: string) => codificarCp1252(s);
  // O convertido guarda a fonte da base lida em CP1252, em UTF-8 (a mesma transliteração das linhas).
  const convertido = (base: Uint8Array) => Buffer.from(decodificarCp1252(base), 'utf8');

  it('literal escrito em UTF-8 pelo fornecedor: motivo, e a mesma letra quando o convertido o leu em CP1252', () => {
    const base = Buffer.concat([cp("NEW.A = '"), Buffer.from('FÉRIAS', 'utf8'), cp("';")]);
    expect(revisarFontePsqlUtf8(base, convertido(base))).toEqual({
      motivos: ['utf8-no-literal'],
      mesmaLetra: true,
    });
    // Se o convertido tivesse lido o literal como UTF-8 (a letra "certa"), o objeto deixaria de casar com as linhas.
    expect(revisarFontePsqlUtf8(base, Buffer.from("NEW.A = 'FÉRIAS';", 'utf8')).mesmaLetra).toBe(false);
  });

  it('UTF-8 duplo, byte indefinido e byte alto no código', () => {
    const base = Buffer.concat([
      cp("A = '"),
      Buffer.from('Ã³', 'utf8'),
      cp("' || "),
      Uint8Array.of(0x27, 0xc3, 0x81, 0x27),
      cp(' FROM "TABELAÇ"'),
    ]);
    expect(revisarFontePsqlUtf8(base, convertido(base))).toEqual({
      motivos: ['utf8-no-literal', 'utf8-duplo', 'byte-indefinido', 'byte-alto-no-codigo'],
      mesmaLetra: true,
    });
  });

  it('número de literais diferente: letra diferente', () => {
    expect(revisarFontePsqlUtf8(cp("A = 'x'; B = 'y'"), Buffer.from("A = 'x'", 'utf8')).mesmaLetra).toBe(
      false,
    );
  });
});

describe('codec em modo UTF-8 (banco convertido)', () => {
  const u = { tipo: 'VARCHAR', charsetBanco: 'UTF8' } as const;

  it('leitura: o texto vem pronto; catalogada não é relida; misto da coexistência continua marcado', () => {
    expect(lerTexto('Ação → ok', u)).toEqual({ texto: 'Ação → ok', misto: false });
    expect(lerTexto('Evolução', { ...u, utf8: true })).toEqual({ texto: 'Evolução', misto: false });
    expect(lerTexto('AÃ§Ã£o', u)?.misto).toBe(true);
    expect(lerTexto('ab  ', { ...u, tipo: 'CHAR' })?.texto).toBe('ab');
  });

  it('gravação: CP1252 até a chave; livre depois; limite em caracteres', () => {
    expect(() => prepararTexto('seta →', u)).toThrow(/U\+2192/);
    expect(prepararTexto('seta →', { ...u, restricao: 'livre' })).toBe('seta →');
    expect(prepararTexto('Ação', { ...u, tamanhoBytes: 4 })).toBe('Ação');
    expect(() => prepararTexto('Ações', { ...u, tamanhoBytes: 4 })).toThrow(/5 caracteres/);
    expect(prepararTexto('→', { ...u, utf8: true })).toBe('→');
    // CP1252 (padrão) segue como antes: a catalogada vai como bytes UTF-8 relidos em CP1252
    expect(prepararTexto('ç', { tipo: 'VARCHAR', utf8: true })).toBe('Ã§');
  });
});
