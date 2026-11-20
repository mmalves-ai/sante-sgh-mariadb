// Leiaute do BPA-Mag (ficha do M51, seção 10: "testes de layout ... com arquivo sintético de referência"). Massa SINTÉTICA.
import { describe, expect, it } from 'vitest';
import type { LinhaBpaC, LinhaBpaI } from './bpa.js';
import {
  camposAusentesCabecalhoBpa,
  controleBpa,
  folhaESequencia,
  gerarArquivoBpa,
  LEIAUTE_BPA_MAG,
} from './bpa-leiaute.js';
import { conferirEstrutura, FIM_DE_LINHA, lerLinha, tamanhoDoRegistro } from './leiaute.js';
import { cnsSintetico } from './massa.spec-util.js';

const CAB = {
  orgaoOrigem: 'HOSPITAL SINTETICO',
  siglaOrigem: 'HSINT',
  cnpj: '11222333000181',
  orgaoDestino: 'SECRETARIA MUNICIPAL DE SAUDE',
  indicadorDestino: 'M' as const,
};

const C = (k: number): LinhaBpaC => ({ cbo: '225125', procedimento: '0202010295', idade: k, quantidade: 2 });
const I = (k: number): LinhaBpaI => ({
  conta: 1000 + k,
  atendimento: 2000 + k,
  data: '2025-09-10',
  cnsProfissional: cnsSintetico(90),
  cbo: '225125',
  procedimento: '0301010072',
  cnsPaciente: cnsSintetico(k),
  sexo: 'F',
  municipio: 330390,
  cid: 'I10',
  idade: 45,
  quantidade: 1,
  nome: `PACIENTE SINTÉTICO ${k}`,
  nascimento: '1980-03-15',
  raca: '03',
  cep: '25600000',
  logradouro: 'RUA SINTETICA COM UM NOME MUITO MAIS LONGO QUE O CAMPO',
  numero: '10',
  complemento: null,
  bairro: 'CENTRO',
});

describe('leiaute do BPA-Mag', () => {
  it('os tamanhos dos registros (cabeçalho 130, consolidado 48, individualizado 338)', () => {
    expect(tamanhoDoRegistro(LEIAUTE_BPA_MAG.registros['01']!)).toBe(130);
    expect(tamanhoDoRegistro(LEIAUTE_BPA_MAG.registros['02']!)).toBe(48);
    expect(tamanhoDoRegistro(LEIAUTE_BPA_MAG.registros['03']!)).toBe(338);
    expect(LEIAUTE_BPA_MAG.conferidoContraOficial).toBe(false);
  });

  it('controle: (Σ procedimentos + Σ quantidades) mod 1111 + 1111', () => {
    expect(controleBpa([{ procedimento: '0000000001', quantidade: 1 }])).toBe(1113);
    const linhas = [
      { procedimento: '0301010072', quantidade: 3 },
      { procedimento: '0202010295', quantidade: 5 },
    ];
    expect(controleBpa(linhas)).toBe(Number((301010072n + 202010295n + 8n) % 1111n) + 1111);
  });

  it('folha e sequência', () => {
    expect(folhaESequencia(0, 20)).toEqual({ folha: 1, sequencia: 1 });
    expect(folhaESequencia(19, 20)).toEqual({ folha: 1, sequencia: 20 });
    expect(folhaESequencia(20, 20)).toEqual({ folha: 2, sequencia: 1 });
  });

  it('arquivo sintético de referência: 0 erro de estrutura, campos nas posições e numeração das folhas', () => {
    const consolidado = Array.from({ length: 21 }, (_, k) => C(k));
    const individualizado = [I(1), I(2)];
    const a = gerarArquivoBpa('202509', '3132471', CAB, consolidado, individualizado, 23);
    expect(conferirEstrutura(LEIAUTE_BPA_MAG, a.conteudo)).toEqual([]);
    const linhas = a.conteudo.split(FIM_DE_LINHA).filter(Boolean);
    expect(linhas).toHaveLength(24);
    expect(a.linhas).toBe(24);
    expect(a.procedimentos).toBe(23);
    expect(a.folhas).toBe(3);
    expect(a.nomeArquivo).toBe('PA3132471202509.SET');
    const cab = lerLinha(LEIAUTE_BPA_MAG, '01', linhas[0]!);
    expect(cab['marca']).toBe('#BPA#');
    expect(cab['competencia']).toBe('202509');
    expect(cab['linhas']).toBe('000023');
    expect(cab['folhas']).toBe('000003');
    expect(Number(cab['controle'])).toBe(a.controle);
    expect(cab['indicadorDestino']).toBe('M');
    const c21 = lerLinha(LEIAUTE_BPA_MAG, '02', linhas[21]!);
    expect([c21['folha'], c21['sequencia'], c21['idade'], c21['origem']]).toEqual([
      '002',
      '01',
      '020',
      'BPA',
    ]);
    const i1 = lerLinha(LEIAUTE_BPA_MAG, '03', linhas[22]!);
    expect(i1['data']).toBe('20250910');
    expect(i1['nascimento']).toBe('19800315');
    expect(i1['cnsPaciente']).toBe(cnsSintetico(1));
    expect(i1['nome']!.trimEnd()).toBe('PACIENTE SINTETICO 1');
    expect(i1['endereco']).toHaveLength(30);
    expect(i1['nacionalidade']).toBe('010');
    expect(i1['servico']).toBe('   ');
    expect([i1['folha'], i1['sequencia']]).toEqual(['001', '01']);
    // O que a tela e o banco do Sante guardam: sem documento nem nome.
    expect(a.numeradas[22]).toMatchObject({ tipo: 'i', conta: 1002, folha: 1, sequencia: 2 });
    expect(JSON.stringify(a.numeradas)).not.toContain('PACIENTE');
  });

  it('o mesmo conjunto dá o mesmo arquivo', () => {
    const x = gerarArquivoBpa('202509', '3132471', CAB, [C(1)], [I(1)], 2);
    const y = gerarArquivoBpa('202509', '3132471', CAB, [C(1)], [I(1)], 2);
    expect(x.conteudo).toBe(y.conteudo);
  });

  it('cabeçalho: os campos que faltam', () => {
    expect(camposAusentesCabecalhoBpa(CAB)).toEqual([]);
    expect(camposAusentesCabecalhoBpa({ cnpj: '1', orgaoDestino: '' })).toEqual([
      'orgaoOrigem',
      'cnpjPrestador',
      'orgaoDestino',
      'indicadorDestino',
    ]);
  });
});
