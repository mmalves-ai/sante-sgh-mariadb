import { describe, expect, it } from 'vitest';
import {
  conferirAlteracaoCenarioEmUso,
  premissaEditavel,
  projetarCenarioOrcamento,
  validarCenarioOrcamento,
  validarPremissaOrcamento,
  type PremissaOrcamentoEntrada,
} from './orcamento-premissas.js';

const premissa = (p: Partial<PremissaOrcamentoEntrada>): PremissaOrcamentoEntrada => ({
  tipo: 'inflacao',
  descricao: 'IPCA projetado',
  percentualCentesimos: 450,
  valorNumerico: null,
  valorTexto: null,
  unidade: null,
  justificativa: null,
  ...p,
});
const campos = (f: { campo: string }[]) => f.map((x) => x.campo);

describe('premissa do orçamento', () => {
  it('inflação com percentual passa', () => {
    expect(validarPremissaOrcamento(premissa({}))).toEqual([]);
  });
  it('tipo percentual sem percentual é recusado', () => {
    expect(campos(validarPremissaOrcamento(premissa({ percentualCentesimos: null })))).toEqual([
      'percentual',
    ]);
  });
  it('reajuste salarial negativo e ocupação acima de 100% são recusados', () => {
    expect(
      campos(validarPremissaOrcamento(premissa({ tipo: 'reajuste_salarial', percentualCentesimos: -100 }))),
    ).toEqual(['percentual']);
    expect(
      campos(
        validarPremissaOrcamento(
          premissa({ tipo: 'ocupacao', percentualCentesimos: 10_500, justificativa: 'leitos extras' }),
        ),
      ),
    ).toEqual(['percentual']);
  });
  it('volume exige número e unidade', () => {
    expect(
      campos(validarPremissaOrcamento(premissa({ tipo: 'volume', percentualCentesimos: null }))).sort(),
    ).toEqual(['unidade', 'valorNumerico']);
    expect(
      validarPremissaOrcamento(
        premissa({ tipo: 'volume', percentualCentesimos: null, valorNumerico: 1200, unidade: 'diárias' }),
      ),
    ).toEqual([]);
  });
  it('outro exige algum valor', () => {
    expect(campos(validarPremissaOrcamento(premissa({ tipo: 'outro', percentualCentesimos: null })))).toEqual(
      ['valorTexto'],
    );
    expect(
      validarPremissaOrcamento(
        premissa({ tipo: 'outro', percentualCentesimos: null, valorTexto: 'sem obra' }),
      ),
    ).toEqual([]);
  });
  it('acima de 20% pede justificativa', () => {
    expect(
      campos(validarPremissaOrcamento(premissa({ tipo: 'reajuste_tabela', percentualCentesimos: 2_500 }))),
    ).toEqual(['justificativa']);
    expect(
      validarPremissaOrcamento(
        premissa({
          tipo: 'reajuste_tabela',
          percentualCentesimos: 2_500,
          justificativa: 'Renegociação da tabela própria',
        }),
      ),
    ).toEqual([]);
  });
  it('descrição curta e percentual fora da faixa', () => {
    expect(
      campos(validarPremissaOrcamento(premissa({ descricao: 'ab', percentualCentesimos: 100_000 }))),
    ).toEqual(['descricao', 'percentual', 'justificativa']);
  });
  it('só o rascunho é editável', () => {
    expect(premissaEditavel('rascunho')).toBe(true);
    expect(premissaEditavel('aprovado')).toBe(false);
    expect(premissaEditavel('descartado')).toBe(false);
  });
});

describe('cenário do orçamento', () => {
  const c = { codigo: 'OTIMISTA', descricao: 'Cenário otimista', tendencia: 'otimista' as const };
  it('coerência da tendência com o ajuste', () => {
    expect(validarCenarioOrcamento({ ...c, ajusteCentesimos: 500 })).toEqual([]);
    expect(campos(validarCenarioOrcamento({ ...c, ajusteCentesimos: -500 }))).toEqual(['ajuste']);
    expect(campos(validarCenarioOrcamento({ ...c, tendencia: 'base', ajusteCentesimos: 1 }))).toEqual([
      'ajuste',
    ]);
    expect(validarCenarioOrcamento({ ...c, tendencia: 'conservador', ajusteCentesimos: 0 })).toEqual([]);
    expect(campos(validarCenarioOrcamento({ ...c, tendencia: 'pessimista', ajusteCentesimos: 0 }))).toEqual([
      'ajuste',
    ]);
    expect(validarCenarioOrcamento({ ...c, tendencia: 'personalizado', ajusteCentesimos: -300 })).toEqual([]);
  });
  it('código e faixa do ajuste', () => {
    expect(campos(validarCenarioOrcamento({ ...c, codigo: 'com espaço', ajusteCentesimos: 10_001 }))).toEqual(
      ['codigo', 'ajuste'],
    );
  });
  it('projeção: ajuste na receita, parcelas na conta, arredondamento em centavos', () => {
    const p = projetarCenarioOrcamento({ receita: 1_000_001, despesa: 600_000, consumo: 100_000 }, 550);
    expect(p.receitaProjetada).toBe(1_055_001); // 1.000.001 × 1,055 = 1.055.001,055 → 1.055.001
    expect(p.resultadoBase).toBe(300_001);
    expect(p.resultadoProjetado).toBe(355_001);
    expect(p.conta).toBe(
      'receita 1000001 +5.50% = 1055001; 1055001 - despesa 600000 - consumo 100000 = 355001',
    );
    const n = projetarCenarioOrcamento({ receita: 333, despesa: 0, consumo: 0 }, -1_000);
    expect(n.receitaProjetada).toBe(300); // 299,7 → 300
  });
});

describe('cenário usado por versão fechada', () => {
  const otim = { tendencia: 'otimista' as const, ajusteCentesimos: 500 };
  it('sem versão fechada, o ajuste muda livre', () => {
    expect(conferirAlteracaoCenarioEmUso(otim, { ...otim, ajusteCentesimos: 1000 }, 0)).toEqual([]);
  });
  it('com versão fechada, ajuste ou tendência diferente é recusado', () => {
    expect(campos(conferirAlteracaoCenarioEmUso(otim, { ...otim, ajusteCentesimos: 1000 }, 1))).toEqual([
      'ajuste',
    ]);
    expect(
      campos(conferirAlteracaoCenarioEmUso(otim, { tendencia: 'personalizado', ajusteCentesimos: 500 }, 2)),
    ).toEqual(['ajuste']);
  });
  it('com versão fechada, manter ajuste e tendência passa (descrição e ativo livres)', () => {
    expect(conferirAlteracaoCenarioEmUso(otim, { ...otim }, 3)).toEqual([]);
  });
});
