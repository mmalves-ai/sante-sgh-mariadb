// Leiaute do SISAIH01 (ficha do M51, seção 10: "testes de layout contra os leiautes oficiais com arquivo sintético de
// referência"): tamanhos e posições dos registros, controle, ordem estável e a conferência de estrutura. O descritor é
// o do construtor (D-LEIAUTE-AIH-51, não conferido). Massa SINTÉTICA.
import { describe, expect, it } from 'vitest';
import { numeroAih } from './aih.js';
import { conferirEstrutura, FIM_DE_LINHA, lerLinha, tamanhoDoRegistro } from './leiaute.js';
import { cnsSintetico } from './massa.spec-util.js';
import {
  type AihParaArquivo,
  controleSisaih,
  gerarArquivoSisaih,
  LEIAUTE_SISAIH01,
  VERSAO_SISAIH01,
} from './sisaih-leiaute.js';

const aih = (seq: string, extra: Partial<AihParaArquivo> = {}): AihParaArquivo => ({
  numero: numeroAih(`3325100000${seq}`),
  especialidade: 3,
  carater: '02',
  dataAutorizacao: '2025-09-03',
  entrada: '2025-09-02',
  alta: '2025-09-12',
  procedimentoSolicitado: '0406010811',
  procedimentoRealizado: '0406010811',
  motivoSaida: 12,
  cidPrincipal: 'I219',
  cidSecundario: null,
  cidObito: null,
  documentoSolicitante: '00012345678',
  cnsAutorizador: cnsSintetico(7),
  paciente: {
    cns: cnsSintetico(8),
    cpf: null,
    nome: 'PACIENTE SINTÉTICO DA AIH',
    nascimento: '1960-01-01',
    sexo: 'M',
    raca: '99',
    municipio: 330100,
    cep: '25600000',
    logradouro: 'RUA DO TESTE',
    numero: '10',
    complemento: null,
    prontuario: 500001,
  },
  diariasUti: 3,
  diariasUtiMesAnterior: 0,
  tipoUti: 2,
  permanencia: 10,
  linhas: [
    { tipo: 'secundario', procedimento: '0211020036', quantidade: 2, cbo: '225125', opm: null },
    { tipo: 'diaria-uti', procedimento: '0802010083', quantidade: 3, cbo: null, opm: null },
    {
      tipo: 'opm',
      procedimento: '0702040061',
      quantidade: 1,
      cbo: null,
      opm: {
        cnpjFornecedor: '00000000000191',
        notaFiscal: 'NF123',
        registroAnvisa: '10000000001',
        serie: '',
        lote: 'L-SINT-1',
      },
    },
  ],
  ...extra,
});

describe('leiaute do SISAIH01 (D-LEIAUTE-AIH-51)', () => {
  it('descritor: versão, não conferido, tamanhos fixos dos quatro registros', () => {
    expect(LEIAUTE_SISAIH01.versao).toBe(VERSAO_SISAIH01);
    expect(LEIAUTE_SISAIH01.conferidoContraOficial).toBe(false);
    const t = (k: string) => tamanhoDoRegistro(LEIAUTE_SISAIH01.registros[k]!);
    expect([t('01'), t('02'), t('03'), t('04')]).toEqual([39, 356, 42, 119]);
  });

  it('arquivo sintético de referência: cabeçalho, AIH, procedimentos e OPM nas posições; 0 erro de estrutura', () => {
    const a = gerarArquivoSisaih('202509', '3132471', cnsSintetico(9), [aih('02'), aih('01')]);
    const linhas = a.conteudo.split(FIM_DE_LINHA).filter(Boolean);
    expect(a.nomeArquivo).toBe('AIH3132471202509.TXT');
    expect(a.registros).toBe(2);
    expect(a.procedimentos).toBe(6);
    expect(a.linhas).toBe(9);
    expect(conferirEstrutura(LEIAUTE_SISAIH01, a.conteudo)).toEqual([]);
    const cab = lerLinha(LEIAUTE_SISAIH01, '01', linhas[0]!);
    expect(cab['marca']).toBe('#SIH#');
    expect(cab['aihs']).toBe('00002');
    expect(Number(cab['controle'])).toBe(a.controle);
    // Ordem pelo número: a AIH ...01 vem antes da ...02.
    const primeira = lerLinha(LEIAUTE_SISAIH01, '02', linhas[1]!);
    expect(primeira['numero']).toBe(numeroAih('332510000001'));
    expect(primeira['mudancaProcedimento']).toBe('N');
    expect(primeira['nome']?.trim()).toBe('PACIENTE SINTETICO DA AIH');
    expect(primeira['cpfPaciente']).toBe(' '.repeat(11));
    expect(primeira['dataSaida']).toBe('20250912');
    const p1 = lerLinha(LEIAUTE_SISAIH01, '03', linhas[2]!);
    expect([p1['sequencia'], p1['procedimento'], p1['quantidade'], p1['cbo']]).toEqual([
      '01',
      '0211020036',
      '002',
      '225125',
    ]);
    const o = lerLinha(LEIAUTE_SISAIH01, '04', linhas[4]!);
    expect([o['sequencia'], o['cnpjFornecedor'], o['lote']?.trim()]).toEqual([
      '03',
      '00000000000191',
      'L-SINT-1',
    ]);
  });

  it('controle: (Σ procedimentos + Σ quantidades) mod 1111 + 1111; mesmo conjunto, mesmo conteúdo', () => {
    expect(controleSisaih([{ procedimento: '0000001110', quantidade: 2 }])).toBe(1112);
    const x = gerarArquivoSisaih('202509', 3132471, cnsSintetico(9), [aih('01'), aih('02')]);
    const y = gerarArquivoSisaih('202509', 3132471, cnsSintetico(9), [aih('02'), aih('01')]);
    expect(x.conteudo).toBe(y.conteudo);
  });

  it('mudança de procedimento, CPF sem CNS e o vazio sem movimento', () => {
    const a = gerarArquivoSisaih('202509', '3132471', cnsSintetico(9), [
      aih('01', {
        procedimentoRealizado: '0406010820',
        paciente: { ...aih('01').paciente, cns: null, cpf: '00012345678' },
      }),
    ]);
    const l = lerLinha(LEIAUTE_SISAIH01, '02', a.conteudo.split(FIM_DE_LINHA)[1]!);
    expect(l['mudancaProcedimento']).toBe('S');
    expect(l['cpfPaciente']).toBe('00012345678');
    expect(gerarArquivoSisaih('202509', '3132471', cnsSintetico(9), []).semMovimento).toBe(true);
  });

  it('mais de 99 linhas numa AIH é recusado (a sequência tem 2 dígitos)', () => {
    const muitas = Array.from({ length: 100 }, () => ({
      tipo: 'secundario' as const,
      procedimento: '0211020036',
      quantidade: 1,
      cbo: null,
      opm: null,
    }));
    expect(() =>
      gerarArquivoSisaih('202509', '3132471', cnsSintetico(9), [aih('01', { linhas: muitas })]),
    ).toThrow(/mais de 99/);
  });
});
