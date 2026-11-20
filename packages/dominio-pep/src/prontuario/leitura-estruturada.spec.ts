// Regra 5 da ficha do M15: respostas pelo layout, com os 24 tipos de pergunta: o índice da escolha resolvido
// pela lista do formulário, pelo ID da resposta ou pela resposta cadastrada; SEQ como linha da grade; CID do
// retrato; unidade; sentinela vira vazio; hora HHMM vira HH:MM. Corpus sintético.
import { describe, expect, it } from 'vitest';
import type { ItemFormulario, RepresentacaoFormulario } from '../formulario/dfm/mapeamento.js';
import {
  type LinhaResposta,
  lerRespostas,
  numeroBr,
  respostasPlanas,
  type RespostaCadastrada,
  TIPOS_PERGUNTA,
  type VinculoDefinicao,
} from './respostas.js';

function linha(ordem: string, x: Partial<LinhaResposta>): LinhaResposta {
  return {
    ordem,
    seq: 0,
    idResposta: null,
    data: null,
    hora: null,
    indice: null,
    valor: null,
    alfa: null,
    texto: null,
    unidade: null,
    cid: null,
    procedimento: null,
    observacao: null,
    autopreenchido: false,
    ...x,
  };
}

function item(ordem: string, texto: string, opcoes?: ItemFormulario['opcoes']): ItemFormulario {
  return {
    linkId: ordem,
    tipo: 'choice',
    widget: null,
    texto,
    ativo: true,
    obrigatorio: false,
    unidade: null,
    tamanhoMaximo: null,
    layout: null,
    ...(opcoes ? { opcoes } : {}),
    'x-legacy': {
      vinculo: 1,
      pergunta: 1,
      codPergunta: 1,
      ordem,
      tipo: null,
      classe: null,
      componente: null,
      componentePai: null,
      idResposta: null,
      obrigatorio: null,
      ativo: 'T',
      manterHist: null,
    },
    itens: [],
  };
}

const REP = {
  itens: [
    item('04', 'Dor (formulário)', [
      { indice: 1, texto: 'Não', idResposta: 401, codigo: null, valor: false, origem: 'sim-nao' },
      { indice: 2, texto: 'Sim', idResposta: 402, codigo: null, valor: true, origem: 'sim-nao' },
    ]),
    item('08', 'Escala', [{ indice: 3, texto: 'Moderada', idResposta: 803, codigo: null, origem: 'ordem' }]),
    item('12', 'Sintomas', [
      { indice: 0, texto: 'Febre', idResposta: 1201, codigo: null, origem: 'id-resposta' },
      { indice: 1, texto: 'Tosse', idResposta: 1202, codigo: null, origem: 'id-resposta' },
    ]),
  ],
} as unknown as RepresentacaoFormulario;

const tipos = Object.keys(TIPOS_PERGUNTA);
const VINCULOS: VinculoDefinicao[] = tipos.map((t) => ({
  ordem: t.padStart(2, '0'),
  tipo: t,
  titulo: `Pergunta tipo ${TIPOS_PERGUNTA[t]}`,
  ativo: true,
  unidade: t === '6' ? 'kg' : null,
}));
const RESPOSTAS = new Map<number, RespostaCadastrada>([
  [1301, { id: 1301, ordem: 1, descricao: 'Ausente' }],
  [901, { id: 901, ordem: 1, descricao: 'Hora' }],
  [902, { id: 902, ordem: 2, descricao: 'Valor' }],
  [1901, { id: 1901, ordem: 1, descricao: null }],
]);

const LINHAS: LinhaResposta[] = [
  linha('01', { alfa: 'título com valor' }),
  linha('02', { data: '2024-05-01' }),
  linha('03', { hora: '0930' }),
  linha('04', { indice: '2', idResposta: 402 }),
  linha('05', { texto: String.raw`{\rtf1 texto cl\'ednico\par}` }),
  linha('06', { valor: 72.5 }),
  linha('07', { valor: 3, unidade: 'mmHg' }),
  linha('08', { indice: '3', texto: 'complemento' }),
  linha('09', { seq: 1, idResposta: 901, hora: '0800' }),
  linha('09', { seq: 1, idResposta: 902, valor: 12 }),
  linha('09', { seq: 2, idResposta: 901, hora: '1400' }),
  linha('09', { seq: 2, idResposta: 902, valor: 13.25 }),
  linha('10', { cid: 'I10 Hipertensão essencial' }),
  linha('11', { alfa: 'ABC123', unidade: 'mg' }),
  linha('12', { indice: '0', idResposta: 1201 }),
  linha('12', { indice: '1', idResposta: 1202 }),
  linha('13', { indice: '1', idResposta: 1301 }),
  linha('14', { procedimento: '0301010072 Consulta' }),
  linha('15', { alfa: '05/2024' }),
  linha('16', { alfa: 'pesquisado' }),
  linha('17', { alfa: '(21) 0000-0000' }),
  linha('18', { alfa: 'J18, J96' }),
  linha('19', { idResposta: 1901 }),
  linha('20', { alfa: '000.000.001-91' }),
  linha('21', { alfa: 'diagnóstico sintético' }),
  linha('22', { texto: 'problema sintético' }),
  linha('23', { alfa: 'alergia sintética' }),
  linha('24', { alfa: 'medicamento sintético', observacao: 'uso contínuo', autopreenchido: true }),
];

describe('leitura estruturada (24 tipos de pergunta)', () => {
  const r = lerRespostas({ linhas: LINHAS, vinculos: VINCULOS, respostas: RESPOSTAS, representacao: REP });
  const por = new Map(respostasPlanas(r.itens).map((x) => [x.titulo, x.valor]));
  const titulo = (t: string) => `Pergunta tipo ${TIPOS_PERGUNTA[t]}`;

  it('tem os 24 tipos no cadastro', () => {
    expect(tipos).toHaveLength(24);
  });

  it('data, hora, texto formatado, número com unidade', () => {
    expect(por.get(titulo('2'))).toBe('01/05/2024');
    expect(por.get(titulo('3'))).toBe('09:30');
    expect(por.get(titulo('5'))).toBe('texto clínico');
    expect(por.get(titulo('6'))).toBe('72,5 kg');
    expect(por.get(titulo('7'))).toBe('3 mmHg');
    expect(por.get(titulo('11'))).toBe('ABC123 mg');
  });

  it('escolhas: pelo ID da resposta, pelo índice do formulário e pela resposta cadastrada', () => {
    expect(por.get('Dor (formulário)')).toBe('Sim');
    expect(por.get('Escala')).toBe('complemento');
    expect(por.get('Sintomas')).toBe('Febre; Tosse');
    expect(por.get(titulo('13'))).toBe('Ausente');
  });

  it('grade: SEQ é a linha, a resposta cadastrada é a coluna', () => {
    const g = r.itens.find((i) => i.ordem === '09')!.grade!;
    expect(g.colunas).toEqual(['Hora', 'Valor']);
    expect(g.linhas).toEqual([
      ['08:00', '12'],
      ['14:00', '13,25'],
    ]);
  });

  it('CID, procedimento, alfanuméricos e listas', () => {
    expect(por.get(titulo('10'))).toBe('I10 Hipertensão essencial');
    expect(por.get(titulo('14'))).toBe('0301010072 Consulta');
    for (const t of ['15', '16', '17', '18', '20']) expect(por.get(titulo(t)), t).toBeTruthy();
    expect(por.get(titulo('22'))).toBe('problema sintético');
    expect(por.get(titulo('24'))).toBe('medicamento sintético; Observação: uso contínuo');
    expect(r.itens.find((i) => i.ordem === '24')!.autopreenchido).toBe(true);
  });

  it('pergunta sem valor (alergias sem coluna) não aparece; o tipo sem coluna conhecida fica "a confirmar"', () => {
    expect(por.has(titulo('19'))).toBe(false);
    const diag = r.itens.find((i) => i.ordem === '21')!;
    expect(diag.aConfirmar).toMatch(/sem coluna conhecida/);
    expect(r.aConfirmar).toBeGreaterThan(0);
    expect(r.total).toBe(23);
  });

  it('sentinela vira vazio; índice sem rótulo fica "a confirmar"; vínculo inativo e sem vínculo', () => {
    const x = lerRespostas({
      linhas: [
        linha('02', { data: '1899-12-30' }),
        linha('13', { indice: '7' }),
        linha('0101', { alfa: 'filho' }),
        linha('99', { alfa: 'órfã' }),
      ],
      vinculos: [
        { ordem: '02', tipo: '2', titulo: 'Data', ativo: true, unidade: null },
        { ordem: '13', tipo: '13', titulo: 'Escolha', ativo: false, unidade: null },
        { ordem: '01', tipo: '1', titulo: 'Seção', ativo: true, unidade: null },
        { ordem: '0101', tipo: '11', titulo: 'Campo', ativo: true, unidade: null },
      ],
      respostas: new Map(),
      representacao: null,
    });
    const planas = respostasPlanas(x.itens);
    expect(planas.find((p) => p.titulo === 'Data')).toBeUndefined();
    expect(x.itens.find((i) => i.ordem === '13')).toMatchObject({ valores: ['opção 7'] });
    expect(x.itens.find((i) => i.ordem === '13')!.aConfirmar).toMatch(/índice/);
    // A seção acima da resposta aparece como título.
    const secao = x.itens.find((i) => i.ordem === '01')!;
    expect(secao).toMatchObject({ titulo: 'Seção', tipo: 'Título' });
    expect(secao.itens[0]).toMatchObject({ titulo: 'Campo', valores: ['filho'] });
    expect(x.itens.find((i) => i.ordem === '99')!.aConfirmar).toMatch(/sem vínculo/);
  });

  it('Sim/Não sem lista: 1 é Não e 2 é Sim', () => {
    const x = lerRespostas({
      linhas: [linha('01', { indice: '1' }), linha('02', { indice: '2' })],
      vinculos: [
        { ordem: '01', tipo: '4', titulo: 'A', ativo: true, unidade: null },
        { ordem: '02', tipo: '4', titulo: 'B', ativo: true, unidade: null },
      ],
      respostas: new Map(),
      representacao: null,
    });
    expect(respostasPlanas(x.itens)).toEqual([
      { titulo: 'A', valor: 'Não' },
      { titulo: 'B', valor: 'Sim' },
    ]);
    expect(numeroBr(1234.5)).toBe('1234,5');
  });
});
