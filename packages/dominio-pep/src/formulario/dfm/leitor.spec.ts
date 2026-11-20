import { describe, expect, it } from 'vitest';
import {
  ErroDfm,
  filhoPorNome,
  lerDfm,
  listaTextos,
  logicoDe,
  numeroDe,
  textoDe,
  tokenizar,
} from './leitor.js';

describe('leitor do DFM', () => {
  it('lê objeto herdado com propriedades, texto com #NNN e concatenação, lista, conjunto e binário', () => {
    const o = lerDfm(
      [
        'inherited cmp7: TfRespData',
        '  Tag = 3',
        '  Left = -4',
        "  Description = 'Admiss'#227'o' +",
        "    ' na unidade'",
        '  Font.Style = [fsBold, fsItalic]',
        '  Anchors = []',
        '  CampoObrigatorio = True',
        "  Fonte = 'name=Arial'#13#10'size=8'",
        '  DesignSize = (',
        '    737',
        '    83)',
        '  Glyph.Data = {',
        '    0A0B0C',
        '    0D}',
        '  Fator = 1.5',
        '  Hexa = $1F',
        "  Aspas = 'it''s'",
        '  inherited edtResp: TJvDateEdit',
        '    Width = 90',
        '  end',
        'end',
      ].join('\r\n'),
    );
    expect(o).toMatchObject({ especie: 'inherited', nome: 'cmp7', classe: 'TfRespData' });
    expect(textoDe(o.propriedades['Description'])).toBe('Admissão na unidade');
    expect(numeroDe(o.propriedades['Left'])).toBe(-4);
    expect(o.propriedades['Font.Style']).toEqual({ tipo: 'conjunto', valor: ['fsBold', 'fsItalic'] });
    expect(o.propriedades['Anchors']).toEqual({ tipo: 'conjunto', valor: [] });
    expect(logicoDe(o.propriedades['CampoObrigatorio'])).toBe(true);
    expect(textoDe(o.propriedades['Fonte'])).toBe('name=Arial\r\nsize=8');
    expect(o.propriedades['Glyph.Data']).toEqual({ tipo: 'binario', bytes: 4 });
    expect(numeroDe(o.propriedades['Fator'])).toBe(1.5);
    expect(numeroDe(o.propriedades['Hexa'])).toBe(31);
    expect(textoDe(o.propriedades['Aspas'])).toBe("it's");
    expect(textoDe(o.propriedades['Hexa'])).toBe('31');
    expect(o.propriedades['DesignSize']).toEqual({
      tipo: 'lista',
      valor: [
        { tipo: 'numero', valor: 737 },
        { tipo: 'numero', valor: 83 },
      ],
    });
    expect(filhoPorNome(o, 'edtResp')?.classe).toBe('TJvDateEdit');
    expect(filhoPorNome(o, 'inexistente')).toBeUndefined();
  });

  it('lê coleção < item … end > e objeto sem nome', () => {
    const o = lerDfm(
      [
        'object TPaintedDBGrid',
        '  Columns = <',
        '    item',
        "      FieldName = 'Fld0'",
        '      Width = 165',
        '    end',
        '    item',
        "      FieldName = 'Rsp2'",
        '    end>',
        "  Items.Strings = ('a' 'b'#231)",
        'end',
      ].join('\n'),
    );
    expect(o.nome).toBe('');
    const col = o.propriedades['Columns'];
    expect(col?.tipo).toBe('colecao');
    if (col?.tipo === 'colecao')
      expect(col.valor.map((c) => textoDe(c['FieldName']))).toEqual(['Fld0', 'Rsp2']);
    expect(listaTextos(o.propriedades['Items.Strings'])).toEqual(['a', 'bç']);
  });

  it('auxiliares devolvem undefined para tipo diferente', () => {
    expect(textoDe(undefined)).toBeUndefined();
    expect(textoDe({ tipo: 'binario', bytes: 1 })).toBeUndefined();
    expect(numeroDe({ tipo: 'texto', valor: ' 12 ' })).toBe(12);
    expect(numeroDe({ tipo: 'texto', valor: 'x' })).toBeUndefined();
    expect(logicoDe({ tipo: 'identificador', valor: 'clRed' })).toBeUndefined();
    expect(logicoDe({ tipo: 'identificador', valor: 'FALSE' })).toBe(false);
    expect(logicoDe(undefined)).toBeUndefined();
    expect(listaTextos({ tipo: 'texto', valor: 'x' })).toBeUndefined();
  });

  it.each([
    ['texto sem fechar', "object A: B\n  X = 'abc\nend"],
    ['sem end', 'object A: B\n  X = 1'],
    ['binário sem fechar', 'object A: B\n  X = {0A'],
    ['binário inválido', 'object A: B\n  X = {0G}\nend'],
    ['caractere estranho', 'object A: B\n  X = ;\nend'],
    ['espécie errada', 'objeto A: B\nend'],
    ['conteúdo depois do fim', 'object A: B\nend\nobject C: D\nend'],
    ['coleção sem item', 'object A: B\n  X = <\n  coisa\n  end>\nend'],
    ['valor inesperado', 'object A: B\n  X = )\nend'],
    ['código de caractere inválido', 'object A: B\n  X = #\nend'],
    ['conjunto inválido', 'object A: B\n  X = [(]\nend'],
    ['fim inesperado', 'object A: B\n  X ='],
    ['símbolo esperado', 'object A: B\n  X 1\nend'],
  ])('recusa DFM inválido: %s', (_, fonte) => {
    expect(() => lerDfm(fonte)).toThrow(ErroDfm);
  });

  it('tokeniza números negativos, hexadecimais e identificadores com ponto', () => {
    expect(tokenizar('Font.Height = -11').map((t) => t.v)).toEqual(['Font.Height', '=', -11]);
  });
});
