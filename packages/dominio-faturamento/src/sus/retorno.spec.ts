// Retorno do gestor (ficha do M51, seção 5: `faturamento.importarRetornoSus`; D-RETORNO-51): leitura do CSV, a
// identificação da AIH (dígito) e da linha do BPA, a situação, os valores e a glosa. Massa SINTÉTICA.
import { COLUNAS_RETORNO_SUS } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { numeroAih } from './aih.js';
import { identificacaoDoRetorno, lerRetornoSus, resumoRetornoSus, valorDoRetorno } from './retorno.js';

const CAB = COLUNAS_RETORNO_SUS.join(';');
const N1 = numeroAih('332510000001');
const N2 = numeroAih('332510000002');

describe('retorno do gestor (D-RETORNO-51)', () => {
  it('valores com vírgula ou ponto; vazio; inválido', () => {
    expect(valorDoRetorno('1.234,56')).toBe(1234.56);
    expect(valorDoRetorno('1234.5')).toBe(1234.5);
    expect(valorDoRetorno('')).toBeNull();
    expect(valorDoRetorno('12a')).toBe('invalido');
  });

  it('identificação: AIH pelo dígito; BPA pelo tipo, folha e sequência', () => {
    expect(identificacaoDoRetorno('aih', N1)?.id).toBe(N1);
    expect(identificacaoDoRetorno('aih', `${N1.slice(0, 12)}${(Number(N1[12]) + 1) % 10}`)).toBeNull();
    expect(identificacaoDoRetorno('bpa', 'c-1-2')).toEqual({
      id: 'C-001-02',
      bpa: { tipo: 'c', folha: 1, sequencia: 2 },
    });
    expect(identificacaoDoRetorno('bpa', 'X-1-2')).toBeNull();
  });

  it('AIH: aprovada, glosada (apresentado − aprovado) e rejeitada (todo o apresentado); erros por linha', () => {
    const r = lerRetornoSus(
      [
        CAB,
        `aih;202509;${N1};0406010811;A;;1500,00;1500,00`,
        `aih;202509;${N2};0406010811;glosada;Diária acima;1500,00;1200,50`,
        `aih;202509;${numeroAih('332510000003')};;R;Rejeitada: CNS;900;`,
        `aih;202508;${N1};;A;;1;1`,
        `bpa;202509;${N1};;A;;1;1`,
        `aih;202509;123;;A;;1;1`,
        `aih;202509;${N1};0406010811;A;;1;1`,
        `aih;202509;${numeroAih('332510000004')};;X;;1;1`,
        `aih;202509;${numeroAih('332510000005')};;A;;1x;1`,
        'aih;202509',
        '',
      ].join('\r\n'),
      'aih',
      '202509',
    );
    expect(r.linhas.map((l) => [l.situacao, l.valorGlosado])).toEqual([
      ['aprovada', 0],
      ['glosada', 299.5],
      ['rejeitada', 900],
    ]);
    expect(r.erros.map((e) => e.problema)).toEqual([
      'competencia-diferente',
      'instrumento-diferente',
      'identificacao-invalida',
      'identificacao-repetida',
      'situacao-invalida',
      'valor-invalido',
      'colunas-a-menos',
    ]);
    expect(resumoRetornoSus(r.linhas)).toEqual({
      porSituacao: { aprovada: 1, glosada: 1, rejeitada: 1 },
      valorGlosado: 1199.5,
    });
  });

  it('cabeçalho diferente: nada é lido', () => {
    const r = lerRetornoSus('numero;situacao\n1;A', 'aih', '202509');
    expect(r.linhas).toEqual([]);
    expect(r.erros).toEqual([{ linha: 1, problema: 'cabecalho-invalido' }]);
  });

  it('BPA: a linha do arquivo pelo tipo, folha e sequência', () => {
    const r = lerRetornoSus(
      `${CAB}\nbpa;202509;I-001-03;0301010072;G;Qtde acima;20,00;10,00`,
      'bpa',
      '202509',
    );
    expect(r.linhas[0]).toMatchObject({
      identificacao: 'I-001-03',
      procedimento: '0301010072',
      bpa: { tipo: 'i', folha: 1, sequencia: 3 },
      valorGlosado: 10,
    });
  });

  it('linha em branco, BOM, situação por extenso, sem valores e folha zero', () => {
    const r = lerRetornoSus(
      [
        `\uFEFF${CAB}`,
        '',
        `aih;202509;${N1};;aprovado;;;`,
        `aih;202509;${N2};;rejeitado;;;`,
        `aih;202509;${numeroAih('332510000003')};;glosado;;;10`,
      ].join('\n'),
      'aih',
      '202509',
    );
    expect(r.erros).toEqual([]);
    expect(
      r.linhas.map((l) => [l.situacao, l.valorApresentado, l.valorAprovado, l.valorGlosado, l.motivo]),
    ).toEqual([
      ['aprovada', null, null, 0, null],
      ['rejeitada', null, 0, 0, null],
      ['glosada', null, 10, 0, null],
    ]);
    expect(identificacaoDoRetorno('bpa', 'C-000-01')).toBeNull();
    expect(lerRetornoSus('', 'bpa', '202509').erros[0]?.problema).toBe('cabecalho-invalido');
  });
});
