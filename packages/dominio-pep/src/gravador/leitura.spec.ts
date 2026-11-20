// Linhas gravadas (inclusive as do outro sistema, com as formas dele) → respostas: rascunho reaberto, último
// valor do paciente e visualização. Casos de cada tipo e o que não se reconhece.
import { describe, expect, it } from 'vitest';
import type { ItemFormulario } from '../formulario/dfm/mapeamento.js';
import type { LinhaResposta } from '../prontuario/respostas.js';
import { respostasDasLinhas } from './leitura.js';
import { rtfDoCampo, paragrafosDoTexto } from './rtf.js';

function it_(
  tipo: string,
  ordem: string,
  id: number,
  extra: Partial<ItemFormulario> = {},
  ativo = true,
): ItemFormulario {
  return {
    linkId: ordem.match(/\d{2}/g)!.join('.'),
    tipo: 'string',
    widget: null,
    texto: `P${ordem}`,
    ativo,
    obrigatorio: false,
    unidade: null,
    tamanhoMaximo: null,
    layout: null,
    'x-legacy': {
      vinculo: Number(ordem),
      pergunta: id,
      codPergunta: id,
      ordem,
      tipo,
      classe: null,
      componente: null,
      componentePai: null,
      idResposta: id,
      obrigatorio: null,
      ativo: ativo ? 'T' : 'F',
      manterHist: null,
    },
    itens: [],
    ...extra,
  };
}
const l = (ordem: string, idResposta: number, p: Partial<LinhaResposta> = {}): LinhaResposta => ({
  ordem,
  seq: 0,
  idResposta,
  data: null,
  hora: null,
  indice: null,
  valor: null,
  alfa: null,
  texto: null,
  unidade: '',
  cid: null,
  procedimento: null,
  observacao: null,
  autopreenchido: false,
  ...p,
});

describe('linhas → respostas', () => {
  const ops = [
    { indice: 1, texto: 'Não', idResposta: 21, codigo: null, origem: 'id-resposta' as const },
    { indice: 2, texto: 'Sim', idResposta: 22, codigo: null, origem: 'id-resposta' as const },
  ];
  const itens: ItemFormulario[] = [
    it_('1', '01', 1, {
      itens: [
        it_('5', '0101', 11),
        it_('2', '0102', 12),
        it_('3', '0103', 13),
        it_('7', '0104', 14),
        it_('11', '0105', 15),
        it_('4', '0106', 16, { opcoes: ops }),
        it_('8', '0107', 17, { opcoes: ops }),
        it_('12', '0108', 18, { opcoes: ops }),
        it_('9', '0109', 19, {
          colunasGrade: [
            { coluna: 1, pergunta: 91, idResposta: 191, titulo: 'Hora', tipo: '2', unidade: null },
            { coluna: 2, pergunta: 92, idResposta: 192, titulo: 'FC', tipo: '6', unidade: null },
            { coluna: 3, pergunta: 93, idResposta: 193, titulo: 'PA', tipo: '4', unidade: null },
          ],
        }),
        it_('10', '0110', 20),
        it_('5', '0111', 30, {}, false),
        it_('13', '0112', 31, { opcoes: ops }),
        it_('19', '0113', 32),
      ],
    }),
  ];
  const linhas: LinhaResposta[] = [
    l('01', 1),
    l('0101', 11, { texto: rtfDoCampo(paragrafosDoTexto('linha 1\nlinha 2')) }),
    l('0102', 12, { data: '2026-07-04' }),
    l('0103', 13, { hora: '0705' }),
    l('0104', 14, { valor: 80, unidade: 'bpm' }),
    l('0105', 15, { alfa: ' 12/8 ', autopreenchido: true }),
    l('0106', 16, { indice: '2', alfa: 'Sim' }),
    l('0106', 16, { seq: 1, alfa: 'há 2 dias' }),
    l('0107', 21, { indice: '1', alfa: 'Não', texto: rtfDoCampo(paragrafosDoTexto('Dipirona')) }),
    l('0108', 21, { indice: '1' }),
    l('0108', 22, { indice: '2' }),
    l('0109', 19),
    l('0109', 191, { hora: '0800' }),
    l('0109', 192, { valor: 72.5 }),
    l('0109', 193, { seq: 1, alfa: '120/80' }),
    l('0110', 20, { cid: 'I20.0 ANGINA' }),
    l('0111', 30, { texto: 'antigo' }),
    l('0112', 31, { indice: 'x' }),
    l('0113', 32),
    l('9999', 99, { alfa: 'sem pergunta' }),
  ];
  it('cada tipo volta ao valor do formulário', () => {
    const { respostas, ignoradas } = respostasDasLinhas({ itens }, linhas);
    const por = new Map(respostas.map((r) => [r.vinculo, r]));
    expect(por.get(101)!.valor).toMatchObject({ tipo: 'formatado' });
    expect(por.get(102)!.valor).toEqual({ tipo: 'data', data: '2026-07-04' });
    expect(por.get(103)!.valor).toEqual({ tipo: 'hora', hora: '07:05' });
    expect(por.get(104)!.valor).toEqual({ tipo: 'numero', valor: 80 });
    expect(por.get(105)).toMatchObject({ valor: { tipo: 'texto', texto: '12/8' }, autopreenchido: true });
    expect(por.get(106)!.valor).toEqual({ tipo: 'escolha', indice: 2, complemento: 'há 2 dias' });
    expect(por.get(107)!.valor).toEqual({ tipo: 'escolha', indice: 1, complemento: 'Dipirona' });
    expect(por.get(108)!.valor).toEqual({ tipo: 'multipla', indices: [1, 2] });
    expect(por.get(109)!.valor).toEqual({
      tipo: 'grade',
      linhas: [
        ['08:00', '72,5', null],
        [null, null, '120/80'],
      ],
    });
    expect(por.get(110)!.valor).toEqual({ tipo: 'cid', codigos: ['I20.0'] });
    expect(por.get(111)!.valor).toMatchObject({ tipo: 'formatado' });
    expect(por.has(112)).toBe(false);
    expect(ignoradas).toBe(3);
  });
  it('só os ativos (rascunho e pré-preenchimento)', () => {
    const { respostas } = respostasDasLinhas({ itens }, linhas, { soAtivos: true });
    expect(respostas.some((r) => r.vinculo === 111)).toBe(false);
  });
  it('linhas vazias e formas vazias não viram resposta', () => {
    const vazias = [
      l('0101', 11, { alfa: '  ' }),
      l('0102', 12, { data: '1899-12-30' }),
      l('0103', 13, { hora: '99' }),
      l('0104', 14),
      l('0105', 15, { alfa: '' }),
      l('0106', 16),
      l('0107', 21),
      l('0108', 21),
      l('0109', 19),
      l('0110', 20, { cid: 'xyz' }),
    ];
    expect(respostasDasLinhas({ itens }, vazias).respostas).toEqual([]);
    const texto = respostasDasLinhas({ itens }, [
      l('0101', 11, { texto: 'texto puro' }),
      l('0107', 21, { indice: '1', alfa: 'Não' }),
    ]);
    expect(texto.respostas.map((r) => r.valor)).toEqual([
      {
        tipo: 'formatado',
        paragrafos: [
          expect.objectContaining({ trechos: [expect.objectContaining({ texto: 'texto puro' })] }),
        ],
      },
      { tipo: 'escolha', indice: 1 },
    ]);
  });
});
