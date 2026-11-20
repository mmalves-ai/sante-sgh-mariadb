// Leiaute do APAC-Mag (ficha do M51, seção 10: "testes de layout ... com arquivo sintético de referência"). Massa SINTÉTICA.
import { describe, expect, it } from 'vitest';
import { type ApacNoArquivo, digitoApac } from './apac.js';
import { camposAusentesCabecalhoApac, gerarArquivoApac, LEIAUTE_APAC_MAG } from './apac-leiaute.js';
import { conferirEstrutura, FIM_DE_LINHA, lerLinha, tamanhoDoRegistro } from './leiaute.js';
import { cnsSintetico } from './massa.spec-util.js';

const CAB = {
  orgaoOrigem: 'HOSPITAL SINTETICO',
  siglaOrigem: 'HSINT',
  cnpj: '11222333000181',
  orgaoDestino: 'SECRETARIA MUNICIPAL DE SAUDE',
  indicadorDestino: 'M' as const,
  uf: '33',
};

const numero = (k: number) => {
  const b = `33125000000${k}`;
  return `${b}${digitoApac(b)}`;
};

const A = (k: number, extra: Partial<ApacNoArquivo> = {}): ApacNoArquivo => ({
  apac: k,
  numero: numero(k),
  tipoNoArquivo: '1',
  competenciaInicial: '202509',
  competenciaFinal: '202511',
  cidPrincipal: 'C50',
  cidSecundario: null,
  cidAssociado: null,
  motivoSaida: '21',
  dataSaida: null,
  autorizador: cnsSintetico(81),
  solicitante: { cns: cnsSintetico(82), nome: 'MEDICO SOLICITANTE SINTETICO COM NOME LONGO DEMAIS' },
  paciente: {
    cns: cnsSintetico(k),
    cpf: null,
    nome: `PACIENTE SINTÉTICA ${k}`,
    mae: `MÃE SINTÉTICA ${k}`,
    sexo: 'F',
    nascimento: '1970-05-20',
    municipio: 330455,
    raca: '03',
    idade: 55,
    cep: '20000000',
    logradouro: 'RUA SINTETICA',
    numero: '10',
    complemento: null,
    bairro: 'CENTRO',
  },
  nefrologia: null,
  procedimentos: [
    {
      codigo: '0211020036',
      principal: false,
      cbo: '225125',
      cnsExecutante: cnsSintetico(91),
      quantidade: 1,
      conta: 1000 + k,
      item: 1,
    },
    {
      codigo: '0304010014',
      principal: true,
      cbo: '225121',
      cnsExecutante: cnsSintetico(91),
      quantidade: 2,
      conta: 1000 + k,
      item: 2,
    },
  ],
  ...extra,
});

describe('leiaute do APAC-Mag (D-LEIAUTE-APAC-51)', () => {
  it('os registros têm o tamanho do descritor e o descritor não está conferido contra o oficial', () => {
    const t = (r: string) => tamanhoDoRegistro(LEIAUTE_APAC_MAG.registros[r]!);
    expect([t('01'), t('14'), t('13'), t('06')]).toEqual([124, 339, 107, 37]);
    expect(LEIAUTE_APAC_MAG.conferidoContraOficial).toBe(false);
  });

  it('arquivo sintético de referência: cabeçalho, APAC, laudo de nefrologia e procedimentos (o principal primeiro)', () => {
    const neo = {
      caracteristicaTratamento: 1,
      contraindicacaoTransplante: 2,
      situacaoTransplante: 1,
      acessoVascular: 3,
      inicioTratamento: '2025-01-10',
    };
    const g = gerarArquivoApac(
      '202509',
      '3132471',
      CAB,
      [A(2, { nefrologia: neo, motivoSaida: '12', dataSaida: '2025-09-20' }), A(1)],
      '2025-10-02',
    );
    expect(conferirEstrutura(LEIAUTE_APAC_MAG, g.conteudo)).toEqual([]);
    const linhas = g.conteudo.split(FIM_DE_LINHA).filter(Boolean);
    expect(linhas.map((l) => l.slice(0, 2))).toEqual(['01', '14', '13', '13', '14', '06', '13', '13']);
    expect(g.nomeArquivo).toBe('AP3132471202509.SET');
    expect([g.registros, g.procedimentos, g.linhas, g.semMovimento]).toEqual([2, 4, 8, false]);
    // Controle: (Σ códigos + Σ quantidades) mod 1111 + 1111.
    const soma = 2n * (304010014n + 211020036n) + 2n * 3n;
    expect(g.controle).toBe(Number((soma % 1111n) + 1111n));
    const cab = lerLinha(LEIAUTE_APAC_MAG, '01', linhas[0]!);
    expect([cab['marca'], cab['competencia'], cab['apacs'], cab['controle']]).toEqual([
      '#APAC',
      '202509',
      '000002',
      String(g.controle),
    ]);
    const a1 = lerLinha(LEIAUTE_APAC_MAG, '14', linhas[1]!);
    expect([a1['numero'], a1['tipoApac'], a1['inicioValidade'], a1['fimValidade'], a1['uf']]).toEqual([
      numero(1),
      '1',
      '20250901',
      '20251130',
      '33',
    ]);
    expect(a1['nomePaciente']?.trimEnd()).toBe('PACIENTE SINTETICA 1');
    expect(a1['nomeMae']?.trimEnd()).toBe('MAE SINTETICA 1');
    expect(a1['nomeResponsavel']).toHaveLength(30);
    expect([a1['motivoSaida'], a1['dataSaida']]).toEqual(['21', '        ']);
    const p1 = lerLinha(LEIAUTE_APAC_MAG, '13', linhas[2]!);
    expect([p1['procedimento'], p1['cbo'], p1['quantidade']]).toEqual(['0304010014', '225121', '0000002']);
    const a2 = lerLinha(LEIAUTE_APAC_MAG, '14', linhas[4]!);
    expect([a2['motivoSaida'], a2['dataSaida']]).toEqual(['12', '20250920']);
    const n2 = lerLinha(LEIAUTE_APAC_MAG, '06', linhas[5]!);
    expect([n2['inicioTratamento'], n2['acessoVascular']]).toEqual(['20250110', '03']);
    expect(g.numeradas.map((x) => [x.apac, x.principal])).toEqual([
      [1, true],
      [1, false],
      [2, true],
      [2, false],
    ]);
    // O mesmo conjunto, em outra ordem, dá o mesmo arquivo.
    expect(
      gerarArquivoApac(
        '202509',
        '3132471',
        CAB,
        [A(1), A(2, { nefrologia: neo, motivoSaida: '12', dataSaida: '2025-09-20' })],
        '2025-10-02',
      ).conteudo,
    ).toBe(g.conteudo);
  });

  it('sem APAC, o arquivo é só o cabeçalho (sem movimento)', () => {
    const g = gerarArquivoApac('202509', '3132471', CAB, [], '2025-10-02');
    expect([g.linhas, g.semMovimento, g.controle]).toEqual([1, true, 1111]);
  });

  it('os campos do cabeçalho que faltam (a UF pelo código do IBGE)', () => {
    expect(camposAusentesCabecalhoApac(CAB)).toEqual([]);
    expect(camposAusentesCabecalhoApac({ ...CAB, uf: '99', cnpj: '1' })).toEqual(['cnpjPrestador', 'uf']);
    expect(camposAusentesCabecalhoApac({})).toEqual([
      'orgaoOrigem',
      'cnpjPrestador',
      'orgaoDestino',
      'indicadorDestino',
      'uf',
    ]);
  });
});
