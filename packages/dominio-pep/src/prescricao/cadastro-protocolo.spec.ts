import { describe, expect, it } from 'vitest';
import {
  planoDosItens,
  problemasDaReceitaPadrao,
  problemasDoKit,
  problemasDoProtocolo,
  protocolosAplicados,
  type ProtocoloEntrada,
  type KitEntrada,
  type ReceitaPadraoEntrada,
} from './cadastro-protocolo.js';

const codigos = (ps: readonly { codigo: string }[]) => ps.map((p) => p.codigo);

const protocolo: ProtocoloEntrada = {
  codigo: 'PO1',
  nome: 'Pós-operatório sintético',
  idadeMin: 18,
  idadeMax: null,
  pesoMin: null,
  pesoMax: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  itens: [
    { sequencia: 1, tipoItem: 'medicamento', item: 10, descricao: null, dose: 1, quantidade: null },
    {
      sequencia: 2,
      tipoItem: 'cuidado',
      item: null,
      descricao: 'Cabeceira a 30 graus',
      dose: null,
      quantidade: null,
    },
  ],
};
const kit: KitEntrada = {
  codigo: 'K1',
  nome: 'Kit sintético',
  tipoKit: 'solucao',
  doseInicial: null,
  doseFinal: null,
  velocidade: 20,
  unidadeInfusao: 3,
  itens: [
    { sequencia: 1, item: 10, papel: 'principal', quantidade: 1, unidade: 2 },
    { sequencia: 2, item: 11, papel: 'diluente', quantidade: 100, unidade: 4 },
  ],
};
const receita: ReceitaPadraoEntrada = {
  nome: 'Alta de pneumonia',
  abrangencia: 'profissional',
  especialidade: null,
  profissional: 7,
  formato: 'estruturada',
  texto: null,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  itens: [
    {
      sequencia: 1,
      item: 10,
      descricaoLivre: null,
      dose: 500,
      quantidade: 21,
      duracao: 7,
      unidadeDuracao: 1,
    },
  ],
};

describe('protocolo de prescrição', () => {
  it('aceita o protocolo completo', () => {
    expect(problemasDoProtocolo(protocolo)).toEqual([]);
  });
  it('recusa faixa invertida, vigência invertida, item sem conteúdo e medicamento fora do catálogo', () => {
    const ps = problemasDoProtocolo({
      ...protocolo,
      idadeMin: 60,
      idadeMax: 18,
      pesoMin: 80,
      pesoMax: 40,
      vigenciaInicio: '2026-05-01',
      vigenciaFim: '2026-04-01',
      itens: [
        {
          sequencia: 1,
          tipoItem: 'medicamento',
          item: null,
          descricao: 'Dipirona',
          dose: 0,
          quantidade: null,
        },
        { sequencia: 2, tipoItem: 'cuidado', item: null, descricao: ' ', dose: null, quantidade: null },
      ],
    });
    expect(codigos(ps)).toEqual([
      'idade-invertida',
      'peso-invertido',
      'vigencia-invertida',
      'item-do-catalogo',
      'valor-nao-positivo',
      'item-sem-conteudo',
    ]);
  });
  it('exige ao menos um item ativo e sequência sem repetir', () => {
    const it1 = protocolo.itens[0]!;
    expect(codigos(problemasDoProtocolo({ ...protocolo, itens: [{ ...it1, ativo: false }] }))).toEqual([
      'sem-itens',
    ]);
    expect(codigos(problemasDoProtocolo({ ...protocolo, itens: [it1, { ...it1 }] }))).toEqual([
      'sequencia-repetida',
    ]);
    expect(codigos(problemasDoProtocolo({ ...protocolo, codigo: ' ', nome: '' }))).toEqual([
      'codigo-obrigatorio',
      'nome-obrigatorio',
    ]);
  });
});

describe('kit de medicamentos e de soluções', () => {
  it('aceita o kit de solução com o diluente', () => {
    expect(problemasDoKit(kit)).toEqual([]);
  });
  it('recusa solução sem diluente, dois principais, quantidade zero, sem unidade e velocidade sem unidade', () => {
    const ps = problemasDoKit({
      ...kit,
      unidadeInfusao: null,
      itens: [
        { sequencia: 1, item: 10, papel: 'principal', quantidade: 0, unidade: 2 },
        { sequencia: 2, item: 11, papel: 'principal', quantidade: 1, unidade: null },
      ],
    });
    expect(codigos(ps)).toEqual([
      'velocidade-sem-unidade',
      'valor-nao-positivo',
      'unidade-obrigatoria',
      'principal-repetido',
      'solucao-sem-diluente',
    ]);
  });
  it('recusa kit vazio e faixa de dose invertida', () => {
    expect(
      codigos(problemasDoKit({ ...kit, tipoKit: 'medicamento', doseInicial: 10, doseFinal: 5, itens: [] })),
    ).toEqual(['faixa-dose-invertida', 'sem-itens']);
  });
});

describe('receita padrão', () => {
  it('aceita a estruturada pessoal e a livre geral', () => {
    expect(problemasDaReceitaPadrao(receita)).toEqual([]);
    expect(
      problemasDaReceitaPadrao({
        ...receita,
        abrangencia: 'geral',
        profissional: null,
        formato: 'livre',
        texto: 'Repouso.',
        itens: [],
      }),
    ).toEqual([]);
  });
  it('recusa a da especialidade sem especialidade, a livre sem texto e a duração sem unidade', () => {
    expect(codigos(problemasDaReceitaPadrao({ ...receita, abrangencia: 'especialidade' }))).toEqual([
      'abrangencia-sem-dono',
    ]);
    expect(codigos(problemasDaReceitaPadrao({ ...receita, formato: 'livre', texto: null }))).toEqual([
      'texto-obrigatorio',
    ]);
    expect(
      codigos(
        problemasDaReceitaPadrao({
          ...receita,
          vigenciaFim: '2026-01-01',
          itens: [{ ...receita.itens[0]!, item: null, unidadeDuracao: null }],
        }),
      ),
    ).toEqual(['vigencia-invertida', 'item-sem-conteudo', 'duracao-sem-unidade']);
  });
});

describe('acerto dos itens e protocolos aplicados', () => {
  it('inclui o novo, altera e revive o da mesma sequência e retira o que saiu (sem apagar)', () => {
    const p = planoDosItens(
      [
        { id: 1, sequencia: 1, vivo: true },
        { id: 2, sequencia: 2, vivo: true },
        { id: 3, sequencia: 3, vivo: false },
        { id: 4, sequencia: 4, vivo: false },
      ],
      [1, 3, 5],
    );
    expect(p).toEqual({
      incluir: [5],
      alterar: [
        { sequencia: 1, id: 1 },
        { sequencia: 3, id: 3 },
      ],
      retirar: [2],
    });
  });
  it('lista os protocolos aplicados sem repetir', () => {
    expect(
      protocolosAplicados([{ protocolo: 4 }, {}, { protocolo: 4 }, { protocolo: 2 }, { protocolo: null }]),
    ).toEqual([4, 2]);
  });
});
