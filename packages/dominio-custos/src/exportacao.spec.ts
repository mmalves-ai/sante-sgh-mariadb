// Regra 10 (ficha do M54): exportação pelos destinos dos grupos de exportação (Próprio, ApuraSUS, Federassantas);
// nenhum envio fora de `producao`; leiaute provisório (D-LEIAUTE-545).
import { describe, expect, it } from 'vitest';
import type { LinhaApuracaoCentro } from '@sgh/contratos';
import { campo, envioPermitido, gerarArquivoExportacao, reais } from './exportacao.js';

const L = (
  centro: number,
  classe: LinhaApuracaoCentro['classe'],
  extra: Partial<LinhaApuracaoCentro> = {},
): LinhaApuracaoCentro => ({
  centro,
  codigo: 100 + centro,
  nome: `CENTRO; "${centro}"`,
  classe,
  ordemRateio: classe === 'produtivo' ? null : 1,
  criterio: classe === 'produtivo' ? null : 'colaboradores',
  direto: { pessoal: 10_000, materiais: 2_050, despesas: 1 },
  despesasGerais: 99,
  diretoTotal: 12_150,
  recebidos: [],
  recebidoTotal: classe === 'produtivo' ? 5_000 : 0,
  repassado: classe === 'produtivo' ? 0 : 12_150,
  naoRateado: 0,
  custoFinal: classe === 'produtivo' ? 17_150 : 0,
  baseCriterioCent: null,
  producao: classe === 'produtivo' ? { codigo: 'pacienteDia', quantidadeCent: 1_050 } : null,
  custoUnitario: classe === 'produtivo' ? 1_633 : null,
  receita: 0,
  ...extra,
});
const linhas = [L(1, 'administrativo'), L(2, 'produtivo')];
const centros = new Map([[2, { id: 2, codigoApurasus: '2.01', unidadeApurasus: 'PD' }]]);

describe('exportação', () => {
  it('envio só em produção', () => {
    expect(envioPermitido('producao')).toBe(true);
    for (const a of ['dev', 'ci', 'homolog', 'treino']) expect(envioPermitido(a)).toBe(false);
  });
  it('reais e campo seguros', () => {
    expect(reais(123_456)).toBe('1234,56');
    expect(reais(-5)).toBe('-0,05');
    expect(campo('a;b"c\nd')).toBe('a b c d');
    expect(campo(null)).toBe('');
  });
  it('ApuraSUS: competência AAAAMM, código do centro, custo direto, indireto e total; centro sem código avisado', () => {
    const a = gerarArquivoExportacao({
      destino: 'apurasus',
      competencia: '2026-03',
      hospital: 'pc',
      rotuloParcial: 'parcial (sem pessoal)',
      linhas,
      centros,
    });
    const ls = a.conteudo.split('\r\n');
    expect(ls[0]).toBe(
      'COMPETENCIA;COD_CENTRO_APURASUS;CENTRO;TIPO_CENTRO;PESSOAL;MATERIAIS;SERVICOS_E_GERAIS;CUSTO_DIRETO;CUSTO_INDIRETO;CUSTO_TOTAL;QUANTIDADE_PRODUCAO;UNIDADE_PRODUCAO',
    );
    expect(ls[2]).toBe('202603;2.01;CENTRO 2;PRODUTIVO;100,00;20,50;1,00;121,50;50,00;171,50;10,50;PD');
    expect(ls[1]?.split(';')[1]).toBe('');
    expect(a.linhas).toBe(2);
    expect(a.semCodigo).toEqual([1]);
    expect(a.nomeArquivo).toBe('custos-apurasus-pc-2026-03-parcial.csv');
    expect(a.avisos.join(' ')).toContain('parcial (sem pessoal)');
    expect(a.conteudo.endsWith('\r\n')).toBe(true);
  });
  it('Federassantas e próprio: cabeçalho e colunas', () => {
    const f = gerarArquivoExportacao({
      destino: 'federassantas',
      competencia: '2026-03',
      hospital: 'pc',
      rotuloParcial: null,
      linhas,
      centros,
    });
    expect(f.conteudo.split('\r\n')[2]).toBe(
      '2026-03;102;CENTRO 2;produtivo;121,50;50,00;171,50;pacienteDia;10,50;16,33',
    );
    expect(f.conteudo.split('\r\n')[1]).toBe('2026-03;101;CENTRO 1;administrativo;121,50;0,00;121,50;;;');
    expect(f.semCodigo).toEqual([]);
    expect(f.nomeArquivo).toBe('custos-federassantas-pc-2026-03.csv');
    const p = gerarArquivoExportacao({
      destino: 'proprio',
      competencia: '2026-03',
      hospital: 'pc',
      rotuloParcial: null,
      linhas,
      centros,
    });
    expect(p.conteudo.split('\r\n')[0]?.split(';')).toHaveLength(17);
    expect(p.conteudo.split('\r\n')[1]).toBe(
      '2026-03;101;CENTRO 1;ADMINISTRATIVO;1;100,00;20,50;0,01;0,99;121,50;0,00;121,50;0,00;0,00;;;',
    );
    expect(p.conteudo.split('\r\n')[2]?.endsWith(';pacienteDia;10,50;16,33')).toBe(true);
  });
});
