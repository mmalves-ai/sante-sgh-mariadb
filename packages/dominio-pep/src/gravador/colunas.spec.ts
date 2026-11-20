// Regras 2, 3, 4 e 7 da ficha do M22 (teste nomeado na ficha: gravador/colunas): um caso por classe do DFM, a
// grade com SEQ, a recusa do vínculo desligado e as do valor. Representações sintéticas (só estrutura).
import type { RespostaRegistro, ValorResposta } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import type { ItemFormulario } from '../formulario/dfm/mapeamento.js';
import { pareceRtf, rtfParaTexto, textoCorrido } from '../prontuario/rtf.js';
import {
  ErroGravacao,
  horaLegado,
  type LinhaGravada,
  linhasDasRespostas,
  numeroFormulario,
  paragrafosDoValor,
  perguntaAmbigua,
  valorVazio,
} from './colunas.js';

let seq = 1;
function item(p: {
  tipo: string;
  classe: string;
  tipoItem?: ItemFormulario['tipo'];
  ordem?: string;
  opcoes?: { indice: number; texto: string; idResposta: number | null }[];
  colunasGrade?: ItemFormulario['colunasGrade'];
  ativo?: boolean;
  idResposta?: number | null;
  unidade?: string | null;
  tamanhoMaximo?: number | null;
  itens?: ItemFormulario[];
}): ItemFormulario {
  const vinculo = seq++;
  const ordem = p.ordem ?? `01${String(vinculo).padStart(2, '0')}`;
  return {
    linkId: ordem.match(/\d{2}/g)!.join('.'),
    tipo: p.tipoItem ?? 'string',
    widget: null,
    texto: `Pergunta ${vinculo}`,
    ativo: p.ativo ?? true,
    obrigatorio: false,
    unidade: p.unidade ?? null,
    tamanhoMaximo: p.tamanhoMaximo ?? null,
    layout: { colunas: 12, largura: 700, altura: 40, topo: 10, esquerda: 5, negrito: false, tamanhoFonte: 8 },
    ...(p.opcoes
      ? { opcoes: p.opcoes.map((o) => ({ ...o, codigo: null, origem: 'id-resposta' as const })) }
      : {}),
    ...(p.colunasGrade ? { colunasGrade: p.colunasGrade } : {}),
    'x-legacy': {
      vinculo,
      pergunta: 1000 + vinculo,
      codPergunta: 1000 + vinculo,
      ordem,
      tipo: p.tipo,
      classe: p.classe,
      componente: `cmp${vinculo}`,
      componentePai: 'jvsBox',
      idResposta: p.idResposta === undefined ? 5000 + vinculo : p.idResposta,
      obrigatorio: 'F',
      ativo: p.ativo === false ? 'F' : 'T',
      manterHist: 1,
    },
    itens: p.itens ?? [],
  };
}

function secao(itens: ItemFormulario[], negrito = true): ItemFormulario {
  const s = item({ tipo: '1', classe: 'TGroupBoxPep', tipoItem: 'group', ordem: '01', itens });
  return { ...s, layout: { ...s.layout!, negrito } };
}

const r = (
  vinculo: number,
  valor: ValorResposta,
  extra: Partial<RespostaRegistro> = {},
): RespostaRegistro => ({
  vinculo,
  valor,
  autopreenchido: false,
  confirmado: false,
  ...extra,
});

function gravar(
  i: ItemFormulario,
  valor: ValorResposta,
  extra: Partial<RespostaRegistro> = {},
): LinhaGravada[] {
  const s = secao([i]);
  const g = linhasDasRespostas({ itens: [s] }, [r(i['x-legacy'].vinculo, valor, extra)]);
  expect(g.linhas[0]).toMatchObject({
    ordem: '01',
    seq: 0,
    idResposta: s['x-legacy'].idResposta,
    alfa: null,
  });
  expect(g.secoes.has(s['x-legacy'].vinculo)).toBe(true);
  return g.linhas.slice(1);
}

const ops = [
  { indice: 1, texto: 'Não', idResposta: 801 },
  { indice: 2, texto: 'Sim', idResposta: 802 },
];

describe('gravador: uma coluna por classe do DFM (regra 2)', () => {
  it('TfRespTexto (5): texto formatado em CONTEVOL, no RTF do formulário de origem', () => {
    const [l] = gravar(item({ tipo: '5', classe: 'TfRespTexto', tipoItem: 'text' }), {
      tipo: 'texto',
      texto: 'Sem queixas\nDieta aceita',
    });
    expect(l!.texto && pareceRtf(l!.texto)).toBe(true);
    expect(l!.texto).toContain('\\ansicpg1252');
    expect(textoCorrido(rtfParaTexto(l!.texto!))).toBe('Sem queixas\nDieta aceita');
    expect(l).toMatchObject({ seq: 0, unidade: '', alfa: null, indice: null, autopreenchido: false });
  });
  it('TfRespData (2): data em RESPDATA', () => {
    expect(
      gravar(item({ tipo: '2', classe: 'TfRespData', tipoItem: 'date' }), {
        tipo: 'data',
        data: '2026-07-04',
      })[0],
    ).toMatchObject({
      data: '2026-07-04',
      hora: null,
    });
  });
  it('TfRespHora (3): hora HHMM em RESPHORA', () => {
    expect(
      gravar(item({ tipo: '3', classe: 'TfRespHora', tipoItem: 'time' }), { tipo: 'hora', hora: '07:05' })[0]!
        .hora,
    ).toBe('0705');
    expect(horaLegado('23:59')).toBe('2359');
  });
  it('TfRespComboBox Sim/Não (4): índice em RESPSNAO, ID da resposta da pergunta, texto em RESPALFA; complemento em SEQ 1', () => {
    const i = item({
      tipo: '4',
      classe: 'TfRespComboBox',
      tipoItem: 'choice',
      opcoes: [
        { ...ops[0]!, idResposta: null },
        { ...ops[1]!, idResposta: null },
      ],
    });
    const ls = gravar(i, { tipo: 'escolha', indice: 2, complemento: 'há 2 dias' });
    expect(ls).toHaveLength(2);
    expect(ls[0]).toMatchObject({ indice: '2', alfa: 'Sim', idResposta: i['x-legacy'].idResposta, seq: 0 });
    expect(ls[1]).toMatchObject({ indice: null, alfa: 'há 2 dias', seq: 1 });
  });
  it('TfRespComboBox resposta sem texto (13): índice, ID da opção e o texto dela', () => {
    const ls = gravar(item({ tipo: '13', classe: 'TfRespComboBox', tipoItem: 'choice', opcoes: ops }), {
      tipo: 'escolha',
      indice: 1,
    });
    expect(ls).toEqual([expect.objectContaining({ indice: '1', idResposta: 801, alfa: 'Não', texto: null })]);
  });
  it('TfRespComboTexto (8): índice, opção e texto formatado (o digitado; sem ele, a opção)', () => {
    const i = item({ tipo: '8', classe: 'TfRespComboTexto', tipoItem: 'open-choice', opcoes: ops });
    const [a] = gravar(i, { tipo: 'escolha', indice: 2 });
    expect(a).toMatchObject({ indice: '2', idResposta: 802, alfa: 'Sim' });
    expect(textoCorrido(rtfParaTexto(a!.texto!))).toBe('Sim');
    const [b] = gravar(i, { tipo: 'escolha', indice: 2, complemento: 'Dipirona' });
    expect(textoCorrido(rtfParaTexto(b!.texto!))).toBe('Dipirona');
  });
  it('TfRespCheckListBox (12): uma linha por item marcado, a lista inteira no texto formatado', () => {
    const i = item({
      tipo: '12',
      classe: 'TfRespCheckListBox',
      tipoItem: 'multi-choice',
      opcoes: [0, 1, 2].map((k) => ({ indice: k, texto: `Item ${k}`, idResposta: 900 + k })),
    });
    const ls = gravar(i, { tipo: 'multipla', indices: [2, 0, 2] });
    expect(ls.map((l) => [l.indice, l.idResposta, l.alfa, l.seq])).toEqual([
      ['0', 900, 'Item 0', 0],
      ['2', 902, 'Item 2', 0],
    ]);
    expect(textoCorrido(rtfParaTexto(ls[0]!.texto!))).toBe('Item 0\nItem 2');
    expect(ls[1]!.texto).toBe(ls[0]!.texto);
  });
  it('TfRespEdit alfanumérico (11) e TfRespEditUnidade (7 e 6): texto ou número, com a unidade', () => {
    expect(
      gravar(item({ tipo: '11', classe: 'TfRespEdit', unidade: 'cm' }), {
        tipo: 'texto',
        texto: '  12/8 ',
      })[0],
    ).toMatchObject({ alfa: '12/8', unidade: 'cm', valor: null });
    expect(
      gravar(item({ tipo: '7', classe: 'TfRespEditUnidade', tipoItem: 'quantity', unidade: 'bpm' }), {
        tipo: 'numero',
        valor: 80,
      })[0],
    ).toMatchObject({ valor: 80, unidade: 'bpm' });
    expect(
      gravar(item({ tipo: '6', classe: 'TfRespEdit' }), { tipo: 'numero', valor: 36.7 })[0],
    ).toMatchObject({ valor: 36.7, unidade: '' });
    expect(numeroFormulario(36.7)).toBe('36,7');
    expect(() => gravar(item({ tipo: '7', classe: 'TfRespEdit' }), { tipo: 'numero', valor: 1.5 })).toThrow(
      'inteiro',
    );
  });
  it('TfRespColunas (9): linha da grade vazia e uma por célula, na resposta da coluna, SEQ = linha (regra 3)', () => {
    const i = item({
      tipo: '9',
      classe: 'TfRespColunas',
      tipoItem: 'grid',
      colunasGrade: [
        { coluna: 1, pergunta: 75, idResposta: 130, titulo: 'Hora', tipo: '2', unidade: null },
        { coluna: 2, pergunta: 76, idResposta: 132, titulo: 'PA (mmHg)', tipo: '4', unidade: null },
        { coluna: 3, pergunta: 77, idResposta: 133, titulo: 'FC', tipo: '6', unidade: 'bpm' },
      ],
    });
    const ls = gravar(i, {
      tipo: 'grade',
      linhas: [
        ['08:00', '120/80', '72'],
        ['14:00', null, '80,5'],
      ],
    });
    expect(ls.map((l) => [l.seq, l.idResposta, l.hora, l.alfa, l.valor])).toEqual([
      [0, i['x-legacy'].idResposta, null, null, null],
      [0, 130, '0800', null, null],
      [0, 132, null, '120/80', null],
      [0, 133, null, null, 72],
      [1, 130, '1400', null, null],
      [1, 133, null, null, 80.5],
    ]);
    expect(() => gravar(i, { tipo: 'grade', linhas: [['8h', null, null]] })).toThrow('Hora inválida');
    expect(() => gravar(i, { tipo: 'grade', linhas: [[null, null, 'muito']] })).toThrow('Número inválido');
    expect(() =>
      gravar(item({ tipo: '9', classe: 'TfRespColunas', tipoItem: 'grid' }), {
        tipo: 'grade',
        linhas: [['1']],
      }),
    ).toThrow('sem colunas');
  });
  it('TfRespCid (10): o CID vai ao adaptador (retrato do catálogo)', () => {
    expect(
      gravar(item({ tipo: '10', classe: 'TfRespCid', tipoItem: 'coding' }), {
        tipo: 'cid',
        codigos: ['I20.0'],
      })[0],
    ).toMatchObject({
      cid: 'I20.0',
    });
  });
  it('TfRespMultiploCid (18) e TfRespAlergia (19): ainda não gravados (ficam no outro sistema)', () => {
    expect(() =>
      gravar(item({ tipo: '18', classe: 'TfRespMultiploCid', tipoItem: 'multi-coding' }), {
        tipo: 'cid',
        codigos: ['I10'],
      }),
    ).toThrow(ErroGravacao);
    expect(() =>
      gravar(item({ tipo: '19', classe: 'TfRespAlergia', tipoItem: 'reference' }), {
        tipo: 'texto',
        texto: 'x',
      }),
    ).toThrow('não é gravado');
  });
  it('pré-preenchido vai com AUTOPREENCHIDO; na finalização exige confirmação (regra 7)', () => {
    const i = item({ tipo: '11', classe: 'TfRespEdit' });
    expect(
      gravar(i, { tipo: 'texto', texto: 'x' }, { autopreenchido: true, confirmado: true })[0]!.autopreenchido,
    ).toBe(true);
    expect(() =>
      linhasDasRespostas(
        { itens: [i] },
        [r(i['x-legacy'].vinculo, { tipo: 'texto', texto: 'x' }, { autopreenchido: true })],
        {
          exigirConfirmacao: true,
        },
      ),
    ).toThrow('Confirme');
  });
});

describe('gravador: recusas (regra 4 e valores)', () => {
  const ativo = item({ tipo: '13', classe: 'TfRespComboBox', tipoItem: 'choice', opcoes: ops });
  const inativo = item({ tipo: '11', classe: 'TfRespEdit', ativo: false });
  const rep = { itens: [secao([ativo, inativo])] };
  const codigo = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return (e as ErroGravacao).codigo;
    }
    return null;
  };
  it('vínculo desligado não é gravado; vínculo de outro modelo, repetido', () => {
    expect(
      codigo(() => linhasDasRespostas(rep, [r(inativo['x-legacy'].vinculo, { tipo: 'texto', texto: 'x' })])),
    ).toBe('vinculo-inativo');
    expect(codigo(() => linhasDasRespostas(rep, [r(99_999, { tipo: 'texto', texto: 'x' })]))).toBe(
      'vinculo-inexistente',
    );
    const v = ativo['x-legacy'].vinculo;
    expect(
      codigo(() =>
        linhasDasRespostas(rep, [r(v, { tipo: 'escolha', indice: 1 }), r(v, { tipo: 'escolha', indice: 2 })]),
      ),
    ).toBe('resposta-repetida');
  });
  it('opção fora da lista, tipo incompatível, título com resposta', () => {
    const v = ativo['x-legacy'].vinculo;
    expect(codigo(() => linhasDasRespostas(rep, [r(v, { tipo: 'escolha', indice: 7 })]))).toBe(
      'opcao-inexistente',
    );
    expect(codigo(() => linhasDasRespostas(rep, [r(v, { tipo: 'texto', texto: 'x' })]))).toBe(
      'tipo-incompativel',
    );
    expect(
      codigo(() =>
        linhasDasRespostas(rep, [r(rep.itens[0]!['x-legacy'].vinculo, { tipo: 'texto', texto: 'x' })]),
      ),
    ).toBe('tipo-incompativel');
  });
  it('pergunta ambígua (lista não resolvida, DP-28), sem resposta cadastrada, texto longo', () => {
    const amb = item({ tipo: '13', classe: 'TfRespComboBox', tipoItem: 'choice', opcoes: [] });
    expect(perguntaAmbigua(amb)).toBe(true);
    expect(
      codigo(() =>
        linhasDasRespostas({ itens: [amb] }, [r(amb['x-legacy'].vinculo, { tipo: 'escolha', indice: 1 })]),
      ),
    ).toBe('pergunta-ambigua');
    const semId = item({ tipo: '11', classe: 'TfRespEdit', idResposta: null });
    expect(
      codigo(() =>
        linhasDasRespostas({ itens: [semId] }, [r(semId['x-legacy'].vinculo, { tipo: 'texto', texto: 'x' })]),
      ),
    ).toBe('sem-resposta-cadastrada');
    const curto = item({ tipo: '11', classe: 'TfRespEdit', tamanhoMaximo: 3 });
    expect(
      codigo(() =>
        linhasDasRespostas({ itens: [curto] }, [
          r(curto['x-legacy'].vinculo, { tipo: 'texto', texto: 'abcd' }),
        ]),
      ),
    ).toBe('texto-longo');
    const semIdSecao = { ...secao([item({ tipo: '11', classe: 'TfRespEdit' })]) };
    const quebrada = { ...semIdSecao, 'x-legacy': { ...semIdSecao['x-legacy'], idResposta: null } };
    expect(
      codigo(() =>
        linhasDasRespostas({ itens: [quebrada] }, [
          r(quebrada.itens[0]!['x-legacy'].vinculo, { tipo: 'texto', texto: 'x' }),
        ]),
      ),
    ).toBe('sem-resposta-cadastrada');
  });
  it('valor vazio não grava linha (rascunho aceita incompleto)', () => {
    expect(valorVazio({ tipo: 'texto', texto: '  ' })).toBe(true);
    expect(valorVazio({ tipo: 'multipla', indices: [] })).toBe(true);
    expect(valorVazio({ tipo: 'grade', linhas: [[null, ' ']] })).toBe(true);
    expect(valorVazio({ tipo: 'formatado', paragrafos: [] })).toBe(true);
    expect(valorVazio({ tipo: 'numero', valor: 0 })).toBe(false);
    expect(
      linhasDasRespostas(rep, [r(ativo['x-legacy'].vinculo, { tipo: 'multipla', indices: [] })]).linhas,
    ).toEqual([]);
    expect(paragrafosDoValor({ tipo: 'numero', valor: 1 })).toEqual([]);
  });
});
