// A apuração do mês inteira, pura (M54-F5): mapeamento do código do movimento para o centro, absorção, custo por conta,
// completude, linhas atípicas, conservação e a forma canônica que a impressão assina. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import type { MatrizEstatisticas } from '@sgh/contratos';
import {
  apurarCompetencia,
  conservacaoConfere,
  estatisticasDaMatriz,
  formaCanonica,
  type EntradaApuracao,
} from './apuracao.js';
import type { CentroParaApuracao } from './absorcao.js';

const c = (
  id: number,
  codigo: number,
  classe: 'produtivo' | 'auxiliar' | null,
  ordem: number | null = null,
  criterio: string | null = null,
): CentroParaApuracao => ({
  id,
  codigo,
  nome: `CENTRO ${id}`,
  ativo: true,
  classificacao: classe === null ? null : { classe, ordemRateio: ordem, criterio },
});

const v = (quantidade: number) => ({ quantidade }) as never;
const matriz: Pick<MatrizEstatisticas, 'linhas'> = {
  linhas: [
    { centro: 2, valores: { pacienteDia: v(100) } },
    { centro: 3, valores: { pacienteDia: v(300) } },
  ],
};

const entrada: EntradaApuracao = {
  centros: [
    c(1, 9001, 'auxiliar', 1, 'pacienteDia'),
    c(2, 9002, 'produtivo'),
    c(3, 9003, 'produtivo'),
    c(4, 9004, null),
  ],
  matriz,
  fontes: {
    materiais: [
      { cdc: 9002, centavos: 10_000, linhas: 40 },
      { cdc: 9004, centavos: 77, linhas: 1 },
      { cdc: 123456, centavos: 23, linhas: 1 },
    ],
    atipicas: [{ cdc: 9002, centavos: 500_000_000, linhas: 2 }],
    despesas: [
      { cdc: 0, centavos: 2_000, linhas: 3 },
      { cdc: 9001, centavos: 8_000, linhas: 5 },
    ],
    pessoal: [],
    itensConta: [
      {
        conta: 50,
        numero: 1,
        tipoConta: 'I',
        convenio: 7,
        procedimento: 'P1',
        cdc: 9002,
        bruta: 4_000,
        glosa: 0,
        recurso: 0,
      },
      {
        conta: 51,
        numero: 2,
        tipoConta: 'E',
        convenio: 8,
        procedimento: 'P2',
        cdc: 9003,
        bruta: 6_000,
        glosa: 100,
        recurso: 0,
      },
      {
        conta: 51,
        numero: 2,
        tipoConta: 'E',
        convenio: 8,
        procedimento: 'P2',
        cdc: 777,
        bruta: 10,
        glosa: 0,
        recurso: 0,
      },
    ],
    contasFechadas: 2,
  },
};

describe('apuração da competência', () => {
  const r = apurarCompetencia(entrada);
  const linha = (id: number) => r.linhas.find((l) => l.centro === id)!;

  it('estatísticas da matriz em centésimos (valor ausente ignorado)', () => {
    expect(estatisticasDaMatriz(matriz).get(3)).toEqual({ pacienteDia: 30_000 });
  });

  it('código do movimento vira o centro; CDC 0 é despesa sem centro; código desconhecido fica fora do custeio', () => {
    expect(linha(2).direto.materiais).toBe(10_000);
    expect(linha(1).direto.despesas).toBe(8_000);
    expect(r.totais.despesasSemCentro).toBe(2_000);
    expect(r.totais.foraDoCusteio).toBe(100);
    expect(r.totais.diretoTotal).toBe(20_000);
  });

  it('despesas gerais pela proporção do direto, rateio do auxiliar pelo paciente-dia, custo final com as parcelas', () => {
    expect(linha(1).despesasGerais).toBe(889);
    expect(linha(2).despesasGerais).toBe(1_111);
    expect(linha(1).repassado).toBe(8_889);
    expect(linha(2).custoFinal).toBe(10_000 + 1_111 + 2_222);
    expect(linha(3).custoFinal).toBe(6_667);
  });

  it('custo chega às contas pela receita do centro; a receita do centro vai na linha', () => {
    expect(r.contas.map((x) => [x.conta, x.custo, x.receitaLiquida])).toEqual([
      [50, 13_333, 4_000],
      [51, 6_667, 5_910],
    ]);
    expect(linha(2).receita).toBe(4_000);
    expect(r.totais).toMatchObject({
      custoNasContas: 20_000,
      custoSemConta: 0,
      receitaBruta: 10_010,
      receitaLiquida: 9_910,
      contas: 2,
    });
  });

  it('conservação: direto = produtivos + parado + não distribuído; produtivos = contas + sem conta', () => {
    expect(conservacaoConfere(r.totais)).toBe(true);
    expect(conservacaoConfere({ ...r.totais, custoNasContas: 1 })).toBe(false);
  });

  it('linhas atípicas fora do custo direto, impressas; sem a folha: parcial (sem pessoal)', () => {
    expect(r.totais.atipicas).toEqual({ linhas: 2, centavos: 500_000_000 });
    expect(r.completude.rotulo).toBe('parcial (sem pessoal)');
    expect(r.pendencias.map((p) => p.tipo)).toEqual(
      expect.arrayContaining(['linhas-atipicas', 'parcial', 'despesas-sem-centro', 'centro-fora-do-custeio']),
    );
    expect(r.pendencias.find((p) => p.tipo === 'linhas-atipicas')?.mensagem).toContain('2 linha(s)');
  });

  it('com a folha e sem atípicas: completa e sem as pendências correspondentes', () => {
    const x = apurarCompetencia({
      ...entrada,
      fontes: { ...entrada.fontes, atipicas: [], pessoal: [{ centro: 3, centavos: 1_000, linhas: 4 }] },
    });
    expect(x.completude.parcial).toBe(false);
    expect(x.pendencias.some((p) => p.tipo === 'parcial' || p.tipo === 'linhas-atipicas')).toBe(false);
    expect(x.linhas.find((l) => l.centro === 3)?.direto.pessoal).toBe(1_000);
  });

  it('devoluções ao estoque descontadas dos materiais do centro; as das saídas atípicas ficam fora; a conta fecha', () => {
    const x = apurarCompetencia({
      ...entrada,
      fontes: {
        ...entrada.fontes,
        devolucoes: [{ cdc: 9002, centavos: 4_000, linhas: 3 }],
        devolucoesAtipicas: [{ cdc: 9002, centavos: 100_000_000, linhas: 1 }],
      },
    });
    const antes = r.linhas.find((l) => l.centro === 2)!.direto.materiais;
    expect(x.linhas.find((l) => l.centro === 2)?.direto.materiais).toBe(antes - 4_000);
    expect(x.totais.direto.materiais).toBe(r.totais.direto.materiais - 4_000);
    expect(x.totais.devolucoes).toEqual({
      linhas: 3,
      centavos: 4_000,
      linhasAtipicas: 1,
      centavosAtipicas: 100_000_000,
    });
    expect(x.totais.atipicas).toEqual(r.totais.atipicas);
    expect(conservacaoConfere(x.totais)).toBe(true);
    expect(r.totais.devolucoes).toEqual({ linhas: 0, centavos: 0, linhasAtipicas: 0, centavosAtipicas: 0 });
  });

  it('forma canônica: mesma entrada, mesmo texto; ordem das chaves não importa', () => {
    expect(formaCanonica(apurarCompetencia(entrada))).toBe(formaCanonica(r));
    expect(formaCanonica({ linhas: [], contas: [], totais: { b: 1, a: [2] } as never })).toBe(
      '{"contas":[],"linhas":[],"totais":{"a":[2],"b":1}}',
    );
  });
});
