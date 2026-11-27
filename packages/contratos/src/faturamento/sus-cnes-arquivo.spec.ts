import { describe, expect, it } from 'vitest';
import { lerHabilitacoesDoArquivoCnes, ONDE_BAIXAR_CNES } from './sus-cnes-arquivo.js';

const CAB =
  '"CO_UNIDADE";"CO_HABILITACAO";"NU_COMPETENCIA_INICIAL";"NU_COMPETENCIA_FINAL";"NU_PORTARIA";"QT_LEITOS"';

describe('arquivo das habilitações do cadastro nacional', () => {
  it('guarda só as linhas do estabelecimento, pelo fim do código da unidade', () => {
    const texto = [
      CAB,
      '"3550301234567";"0802";"201901";"";"PT 10";"8"',
      '"3550301234567";"1712";"202001";"202512";"";""',
      '"3304557654321";"0802";"201901";"";"";""',
      '"3550301234567";"x";"";"";"";""',
    ].join('\r\n');
    const r = lerHabilitacoesDoArquivoCnes(texto, '1234567');
    expect(r.problemas).toEqual([]);
    expect(r.linhas).toBe(4);
    expect(r.habilitacoes).toEqual([
      {
        codigo: '0802',
        competenciaInicio: '201901',
        competenciaFim: null,
        numeroPortaria: 'PT 10',
        leitosHabilitados: 8,
      },
      {
        codigo: '1712',
        competenciaInicio: '202001',
        competenciaFim: '202512',
        numeroPortaria: null,
        leitosHabilitados: null,
      },
    ]);
  });

  it('aceita a coluna do número nacional e recusa arquivo sem as colunas', () => {
    const r = lerHabilitacoesDoArquivoCnes(
      'CO_CNES;CO_CODIGO_GRUPO\n1234567;2601\n7654321;2602\n',
      '1234567',
    );
    expect(r.habilitacoes.map((h) => h.codigo)).toEqual(['2601']);
    expect(lerHabilitacoesDoArquivoCnes('A;B\n1;2', '1234567').problemas[0]).toMatch(/não reconhecido/);
    expect(lerHabilitacoesDoArquivoCnes(CAB, '12').problemas[0]).toMatch(/7 dígitos/);
    expect(ONDE_BAIXAR_CNES).toMatch(/ftp\.datasus\.gov\.br\/cnes/);
  });
});
