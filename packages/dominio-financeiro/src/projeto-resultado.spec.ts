import { describe, expect, it } from 'vitest';
import {
  type ApropriacaoProposta,
  conferirApropriacao,
  conferirProjeto,
  naturezaDaOrigem,
  passagemProjetoPermitida,
  type ProjetoProposto,
  resultadoDoProjeto,
} from './projeto-resultado.js';

const base: ProjetoProposto = {
  codigo: 'OBRA-1',
  descricao: 'Reforma sintética da ala',
  tipo: 'obra',
  verba: 1000,
  inicioPrevisto: '2027-01-01',
  fimPrevisto: '2027-12-31',
  situacao: 'planejado',
  situacaoAnterior: null,
  etapas: [
    {
      sequencia: 1,
      descricao: 'Projeto executivo',
      centroCusto: null,
      inicioPrevisto: '2027-01-01',
      fimPrevisto: '2027-02-28',
      valorPrevisto: 300,
      percentualConcluido: 0,
      situacao: 'planejada',
    },
    {
      sequencia: 2,
      descricao: 'Execução',
      centroCusto: 7,
      inicioPrevisto: '2027-03-01',
      fimPrevisto: '2027-12-31',
      valorPrevisto: 700,
      percentualConcluido: 0,
      situacao: 'planejada',
    },
  ],
  centros: [
    { centroCusto: 7, percentual: 60 },
    { centroCusto: 8, percentual: 40 },
  ],
  produtos: [
    { insumo: 3, servico: null, quantidade: 10, valorPrevisto: 50 },
    { insumo: null, servico: 'Mão de obra', quantidade: 1, valorPrevisto: 500 },
  ],
};
const campos = (p: ProjetoProposto) => conferirProjeto(p).map((x) => x.campo);

describe('cadastro do projeto (C2-107)', () => {
  it('aceita o projeto completo dentro da verba', () => {
    expect(conferirProjeto(base)).toEqual([]);
  });

  it('recusa etapas acima da verba, mas não conta a cancelada', () => {
    const acima = { ...base, verba: 900 };
    expect(campos(acima)).toContain('etapas');
    const cancelada = {
      ...acima,
      etapas: [base.etapas[0]!, { ...base.etapas[1]!, situacao: 'cancelada' as const }],
    };
    expect(campos(cancelada)).not.toContain('etapas');
  });

  it('etapa fora do prazo do projeto, repetida ou com fim antes do início', () => {
    const p = {
      ...base,
      etapas: [
        { ...base.etapas[0]!, inicioPrevisto: '2026-12-01' },
        { ...base.etapas[1]!, sequencia: 1, fimPrevisto: '2027-02-01' },
      ],
    };
    const c = campos(p);
    expect(c).toContain('etapas.0.inicioPrevisto');
    expect(c).toContain('etapas.1.sequencia');
    expect(c).toContain('etapas.1.fimPrevisto');
  });

  it('etapa concluída exige 100%; etapa com apropriação não se cancela; gravada não some', () => {
    const p = {
      ...base,
      etapas: [
        { ...base.etapas[0]!, situacao: 'concluida' as const, percentualConcluido: 80 },
        { ...base.etapas[1]!, situacao: 'cancelada' as const },
      ],
      etapasComApropriacao: [2],
      etapasGravadas: [1, 2, 3],
    };
    const c = conferirProjeto(p);
    expect(c.map((x) => x.campo)).toEqual(
      expect.arrayContaining(['etapas.0.percentualConcluido', 'etapas.1.situacao', 'etapas']),
    );
    expect(c.find((x) => x.campo === 'etapas')!.mensagem).toContain('etapa 3');
  });

  it('centros repetidos ou acima de 100%; produto sem alvo ou com os dois', () => {
    const p = {
      ...base,
      centros: [
        { centroCusto: 7, percentual: 70 },
        { centroCusto: 7, percentual: 40 },
      ],
      produtos: [
        { insumo: 3, servico: 'x', quantidade: 1, valorPrevisto: null },
        { insumo: null, servico: ' ', quantidade: 0, valorPrevisto: null },
      ],
    };
    const c = campos(p);
    expect(c).toEqual(
      expect.arrayContaining([
        'centros.1.centroCusto',
        'centros',
        'produtos.0.insumo',
        'produtos.1.insumo',
        'produtos.1.quantidade',
      ]),
    );
  });

  it('cabeçalho: código, tipo, verba e datas', () => {
    const c = campos({
      ...base,
      codigo: ' ',
      tipo: 'qualquer',
      verba: -1,
      fimPrevisto: '2026-01-01',
      etapas: [],
    });
    expect(c).toEqual(expect.arrayContaining(['codigo', 'tipo', 'verba', 'fimPrevisto']));
  });

  it('passagens de situação: novo planejado ou em andamento; concluído e cancelado são finais', () => {
    expect(campos({ ...base, situacao: 'concluido' })).toContain('situacao');
    expect(passagemProjetoPermitida('planejado', 'em_andamento')).toBe(true);
    expect(passagemProjetoPermitida('em_andamento', 'suspenso')).toBe(true);
    expect(passagemProjetoPermitida('suspenso', 'em_andamento')).toBe(true);
    expect(passagemProjetoPermitida('concluido', 'em_andamento')).toBe(false);
    expect(passagemProjetoPermitida('cancelado', 'planejado')).toBe(false);
    expect(passagemProjetoPermitida('planejado', 'concluido')).toBe(false);
    expect(campos({ ...base, situacaoAnterior: 'concluido', situacao: 'em_andamento' })).toContain(
      'situacao',
    );
  });
});

const apr: ApropriacaoProposta = {
  origem: 'titulo',
  natureza: null,
  situacaoProjeto: 'em_andamento',
  valorOrigem: 500,
  jaApropriado: 0,
  percentual: 40,
  valor: null,
  data: '2027-03-10',
  etapa: 'em_andamento',
  origemCancelada: false,
};

describe('apropriação ao projeto (C2-107)', () => {
  it('rateio pelo percentual do documento, com a natureza imposta pela origem', () => {
    expect(conferirApropriacao(apr)).toEqual({
      problemas: [],
      aprovada: { natureza: 'despesa', valor: 200, percentual: 40 },
    });
    expect(naturezaDaOrigem('titulo_receber')).toBe('receita');
    expect(naturezaDaOrigem('lancamento')).toBeNull();
  });

  it('valor direto; o lançamento contábil exige a natureza', () => {
    const l = { ...apr, origem: 'lancamento' as const, percentual: null, valor: 120.5 };
    expect(conferirApropriacao(l).problemas.map((p) => p.campo)).toEqual(['natureza']);
    expect(conferirApropriacao({ ...l, natureza: 'receita' }).aprovada).toEqual({
      natureza: 'receita',
      valor: 120.5,
      percentual: null,
    });
  });

  it('não passa do que o documento tem livre (somando outros projetos)', () => {
    const r = conferirApropriacao({ ...apr, jaApropriado: 400 });
    expect(r.aprovada).toBeNull();
    expect(r.problemas[0]!.mensagem).toContain('100.00 livre');
    expect(conferirApropriacao({ ...apr, jaApropriado: 300 }).aprovada?.valor).toBe(200);
  });

  it('recusa projeto concluído, natureza contrária, documento cancelado, etapa alheia e percentual com valor', () => {
    const r = conferirApropriacao({
      ...apr,
      situacaoProjeto: 'concluido',
      natureza: 'receita',
      origemCancelada: true,
      etapa: 'inexistente',
      valor: 10,
    });
    expect(r.problemas.map((p) => p.campo)).toEqual(['projeto', 'natureza', 'documento', 'etapa', 'valor']);
    expect(conferirApropriacao({ ...apr, etapa: 'cancelada' }).problemas[0]!.campo).toBe('etapa');
    expect(conferirApropriacao({ ...apr, percentual: 120 }).problemas[0]!.campo).toBe('percentual');
  });
});

describe('resultado do projeto (C2-107)', () => {
  const etapas = [
    { sequencia: 1, descricao: 'A', valorPrevisto: 300, situacao: 'concluida' as const },
    { sequencia: 2, descricao: 'B', valorPrevisto: 700, situacao: 'em_andamento' as const },
  ];

  it('orçado × realizado, receita − despesa, etapas e centros pela participação', () => {
    const r = resultadoDoProjeto(
      1000,
      [
        { natureza: 'despesa', valor: 350, etapa: 1 },
        { natureza: 'despesa', valor: 200, etapa: 2 },
        { natureza: 'despesa', valor: 50, etapa: null },
        { natureza: 'receita', valor: 900, etapa: null },
      ],
      etapas,
      [
        { centroCusto: 7, percentual: 60 },
        { centroCusto: 8, percentual: 40 },
      ],
    );
    expect(r).toMatchObject({
      orcado: 1000,
      despesa: 600,
      receita: 900,
      resultado: 300,
      saldoVerba: 400,
      percentualConsumido: 60,
      estourado: false,
      semEtapa: 50,
    });
    expect(r.etapas).toEqual([
      { sequencia: 1, descricao: 'A', previsto: 300, realizado: 350, diferenca: -50, estourada: true },
      { sequencia: 2, descricao: 'B', previsto: 700, realizado: 200, diferenca: 500, estourada: false },
    ]);
    expect(r.centros).toEqual([
      { centroCusto: 7, percentual: 60, despesa: 360 },
      { centroCusto: 8, percentual: 40, despesa: 240 },
    ]);
  });

  it('estouro da verba; centros sem participação em partes iguais com a sobra no último', () => {
    const r = resultadoDoProjeto(
      100,
      [{ natureza: 'despesa', valor: 100.01, etapa: null }],
      [],
      [
        { centroCusto: 1, percentual: null },
        { centroCusto: 2, percentual: null },
        { centroCusto: 3, percentual: null },
      ],
    );
    expect(r.estourado).toBe(true);
    expect(r.saldoVerba).toBe(-0.01);
    expect(r.centros.map((c) => c.despesa)).toEqual([33.34, 33.34, 33.33]);
    expect(r.centros.reduce((s, c) => s + c.despesa, 0)).toBeCloseTo(100.01, 2);
  });

  it('verba zero não divide', () => {
    expect(resultadoDoProjeto(0, [], [], []).percentualConsumido).toBeNull();
  });
});
