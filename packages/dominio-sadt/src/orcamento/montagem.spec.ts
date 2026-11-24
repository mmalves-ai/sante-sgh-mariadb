// 05-SADT linha 26: montagem do orçamento de exames, destino da conversão e divisão por setor executante.
import { describe, expect, it } from 'vitest';
import {
  conferirDestinoDaConversao,
  conferirInteressado,
  montarOrcamentoExames,
  RecusaOrcamento,
  setoresDaConversao,
} from './montagem.js';

const codigo = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof RecusaOrcamento) return { codigo: e.codigo, campos: e.campos };
    throw e;
  }
  return null;
};

describe('montagem do orçamento de exames', () => {
  it('preço da tabela ou informado, quantidade e total com desconto', () => {
    const m = montarOrcamentoExames(
      [
        { exame: 1, nome: 'A', quantidade: 2, precoTabela: 10.005, valorInformado: null },
        { exame: 2, nome: 'B', quantidade: 1, precoTabela: 50, valorInformado: 40.1 },
      ],
      5.1,
    );
    expect(m.itens).toEqual([
      { exame: 1, quantidade: 2, unitario: 10.01, total: 20.02, origemPreco: 'tabela' },
      { exame: 2, quantidade: 1, unitario: 40.1, total: 40.1, origemPreco: 'informado' },
    ]);
    expect(m).toMatchObject({ bruto: 60.12, desconto: 5.1, total: 55.02 });
  });

  it('recusa sem exame, repetido, sem preço, quantidade e desconto fora', () => {
    const i = { exame: 1, nome: 'A', quantidade: 1, precoTabela: 10, valorInformado: null };
    expect(codigo(() => montarOrcamentoExames([], 0))?.codigo).toBe('orcamento-sem-exames');
    expect(codigo(() => montarOrcamentoExames([i, i], 0))).toEqual({
      codigo: 'exame-repetido',
      campos: ['exames.1'],
    });
    expect(codigo(() => montarOrcamentoExames([{ ...i, precoTabela: null }], 0))).toEqual({
      codigo: 'exame-sem-preco',
      campos: ['exames.0.valor'],
    });
    expect(codigo(() => montarOrcamentoExames([{ ...i, quantidade: 0 }], 0))?.codigo).toBe(
      'quantidade-invalida',
    );
    expect(codigo(() => montarOrcamentoExames([{ ...i, valorInformado: -1 }], 0))?.codigo).toBe(
      'valor-invalido',
    );
    expect(codigo(() => montarOrcamentoExames([i], 10.01))?.codigo).toBe('desconto-acima-do-total');
    expect(codigo(() => montarOrcamentoExames([i], -1))?.codigo).toBe('desconto-invalido');
    expect(montarOrcamentoExames([i], 10).total).toBe(0);
  });

  it('interessado: paciente ou nome; CPF com 11 dígitos', () => {
    expect(codigo(() => conferirInteressado({ paciente: null, nome: 'Jo', cpf: null }))?.codigo).toBe(
      'interessado-obrigatorio',
    );
    expect(codigo(() => conferirInteressado({ paciente: 3, nome: null, cpf: '123' }))?.codigo).toBe(
      'cpf-invalido',
    );
    expect(
      codigo(() => conferirInteressado({ paciente: null, nome: 'Fulano', cpf: '12345678901' })),
    ).toBeNull();
  });
});

describe('destino da conversão', () => {
  it('o atendimento tem de ser do paciente do orçamento', () => {
    expect(
      conferirDestinoDaConversao({ paciente: 7, cpfInteressado: null }, { paciente: 7, cpfPaciente: null }),
    ).toEqual({ vinculaPaciente: false });
    expect(
      codigo(() =>
        conferirDestinoDaConversao({ paciente: 7, cpfInteressado: null }, { paciente: 8, cpfPaciente: null }),
      )?.codigo,
    ).toBe('paciente-diferente');
  });

  it('interessado sem cadastro vincula o paciente do atendimento, salvo CPF diferente', () => {
    expect(
      conferirDestinoDaConversao(
        { paciente: null, cpfInteressado: '1'.repeat(11) },
        { paciente: 8, cpfPaciente: null },
      ),
    ).toEqual({ vinculaPaciente: true });
    expect(
      codigo(() =>
        conferirDestinoDaConversao(
          { paciente: null, cpfInteressado: '1'.repeat(11) },
          { paciente: 8, cpfPaciente: '2'.repeat(11) },
        ),
      )?.codigo,
    ).toBe('paciente-diferente');
  });
});

describe('setores da conversão', () => {
  it('padrão, único, sem setor e ambíguo', () => {
    const r = setoresDaConversao([
      {
        exame: 1,
        nome: 'A',
        quantidade: 1,
        setores: [
          { setor: 10, padrao: true },
          { setor: 11, padrao: false },
        ],
      },
      { exame: 2, nome: 'B', quantidade: 2, setores: [{ setor: 11, padrao: false }] },
      { exame: 3, nome: 'C', quantidade: 1, setores: [{ setor: 10, padrao: false }] },
    ]);
    expect([...r.entries()]).toEqual([
      [
        10,
        [
          { exame: 1, quantidade: 1 },
          { exame: 3, quantidade: 1 },
        ],
      ],
      [11, [{ exame: 2, quantidade: 2 }]],
    ]);
    expect(
      codigo(() => setoresDaConversao([{ exame: 1, nome: 'A', quantidade: 1, setores: [] }]))?.codigo,
    ).toBe('exame-sem-setor');
    expect(
      codigo(() =>
        setoresDaConversao([
          {
            exame: 1,
            nome: 'A',
            quantidade: 1,
            setores: [
              { setor: 1, padrao: false },
              { setor: 2, padrao: false },
            ],
          },
        ]),
      )?.codigo,
    ).toBe('exame-setor-ambiguo');
  });
});
