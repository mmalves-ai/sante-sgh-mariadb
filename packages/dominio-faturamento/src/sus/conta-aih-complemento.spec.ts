// Complemento da conta da AIH (F7, 06-SUS linha 58): conferência da equipe, dos diagnósticos secundários e dos
// incrementos, valor do incremento e as linhas 05, 06 e 07 do arquivo. Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  type ComplementoAihEntrada,
  conferirComplementoAih,
  type ContextoComplementoAih,
  tipoDocumentoCredor,
  valorDoIncrementoAih,
} from './conta-aih-complemento.js';
import { cnsSintetico } from './massa.spec-util.js';
import { type AihParaArquivo, gerarArquivoSisaih } from './sisaih-leiaute.js';

const CNS = cnsSintetico(42);
const ctx: ContextoComplementoAih = {
  situacaoConta: 'fechada',
  cidPrincipal: 'K35.8',
  procedimentos: [
    { sequencia: 1, tipo: 'principal' },
    { sequencia: 2, tipo: 'secundario' },
    { sequencia: 3, tipo: 'opm' },
  ],
  habilitacoes: new Set(['2601']),
};
const bom: ComplementoAihEntrada = {
  diagnosticos: [
    { cid: 'E11.9', tipo: 'secundario', classificacao: 'preexistente' },
    { cid: 'T81.4', tipo: 'secundario', classificacao: 'adquirido' },
  ],
  equipe: [
    { procedimento: 1, cns: CNS, cbo: '225225', atividade: '01', credor: null, documentoCredor: null },
    {
      procedimento: 1,
      cns: CNS,
      cbo: '225151',
      atividade: '06',
      credor: '45',
      documentoCredor: '12345678000190',
    },
  ],
  incrementos: [{ habilitacao: '2601', procedimento: null, percentual: 20 }],
};

describe('conferirComplementoAih', () => {
  it('aceita equipe, diagnósticos e incrementos coerentes', () => {
    expect(conferirComplementoAih(bom, ctx)).toEqual([]);
  });

  it('recusa a conta que não está fechada (apresentada ou reaberta)', () => {
    for (const s of ['apresentada', 'reaberta', 'aprovada'])
      expect(conferirComplementoAih(bom, { ...ctx, situacaoConta: s }).map((p) => p.campo)).toEqual([
        'conta',
      ]);
  });

  it('recusa CID repetido, igual ao principal, sem classificação e acima de nove', () => {
    const p = conferirComplementoAih(
      {
        ...bom,
        diagnosticos: [
          { cid: 'K358', tipo: 'secundario', classificacao: 'adquirido' },
          { cid: 'E119', tipo: 'secundario', classificacao: null },
          { cid: 'E11.9', tipo: 'secundario', classificacao: 'adquirido' },
          { cid: 'R99', tipo: 'causa_morte', classificacao: null },
          { cid: 'I46', tipo: 'causa_morte', classificacao: null },
        ],
      },
      ctx,
    );
    expect(p.map((x) => x.campo)).toEqual([
      'diagnosticos.0',
      'diagnosticos.1',
      'diagnosticos.2',
      'diagnosticos',
    ]);
    const dez = Array.from({ length: 10 }, (_, i) => ({
      cid: `A${String(i + 10)}`,
      tipo: 'secundario' as const,
      classificacao: 'adquirido' as const,
    }));
    expect(conferirComplementoAih({ ...bom, diagnosticos: dez }, ctx).map((x) => x.campo)).toEqual([
      'diagnosticos',
    ]);
  });

  it('recusa equipe em OPM, CNS inválido, CBO fora da forma, documento sem credor e ato repetido', () => {
    const p = conferirComplementoAih(
      {
        ...bom,
        equipe: [
          { procedimento: 3, cns: CNS, cbo: '225225', atividade: '01', credor: null, documentoCredor: null },
          { procedimento: 1, cns: '123', cbo: '22', atividade: '', credor: null, documentoCredor: '999' },
          { procedimento: 2, cns: CNS, cbo: '225225', atividade: '01', credor: null, documentoCredor: null },
          { procedimento: 2, cns: CNS, cbo: '225225', atividade: '01', credor: null, documentoCredor: null },
        ],
      },
      ctx,
    );
    expect(p.map((x) => x.campo)).toEqual([
      'equipe.0',
      'equipe.1',
      'equipe.1',
      'equipe.1',
      'equipe.1',
      'equipe.1',
      'equipe.3',
    ]);
  });

  it('recusa habilitação fora do hospital, percentual fora da faixa e alvo repetido', () => {
    const p = conferirComplementoAih(
      {
        ...bom,
        incrementos: [
          { habilitacao: '1234', procedimento: null, percentual: 20 },
          { habilitacao: '2601', procedimento: 3, percentual: 0 },
          { habilitacao: '2601', procedimento: 2, percentual: 10 },
          { habilitacao: '2601', procedimento: 2, percentual: 301 },
        ],
      },
      ctx,
    );
    expect(p.map((x) => x.campo)).toEqual([
      'incrementos.0',
      'incrementos.1',
      'incrementos.1',
      'incrementos.3',
      'incrementos.3',
    ]);
  });
});

describe('valor e documento', () => {
  it('o incremento é o percentual sobre os serviços hospitalar e profissional, em centavos', () => {
    expect(valorDoIncrementoAih({ servicoHospitalar: 1000.55, servicoProfissional: 300.1 }, 20)).toEqual({
      servicoHospitalar: 200.11,
      servicoProfissional: 60.02,
      total: 260.13,
    });
  });

  it('o tipo do documento do credor pelos dígitos', () => {
    expect(tipoDocumentoCredor('123.456.789-01')).toBe('cpf');
    expect(tipoDocumentoCredor('12.345.678/0001-90')).toBe('cnpj');
    expect(tipoDocumentoCredor('12')).toBeNull();
  });
});

describe('arquivo SISAIH01 com o complemento', () => {
  const aih: AihParaArquivo = {
    numero: '3525100000019',
    especialidade: 1,
    carater: '01',
    dataAutorizacao: '2025-10-02',
    entrada: '2025-10-01',
    alta: '2025-10-05',
    procedimentoSolicitado: '0407020039',
    procedimentoRealizado: '0407020039',
    motivoSaida: 12,
    cidPrincipal: 'K358',
    cidSecundario: 'E119',
    cidObito: null,
    documentoSolicitante: CNS,
    cnsAutorizador: CNS,
    paciente: {
      cns: CNS,
      cpf: null,
      nome: 'PACIENTE FICTICIO',
      nascimento: '1980-01-01',
      sexo: 'F',
      raca: '01',
      municipio: 355030,
      cep: null,
      logradouro: null,
      numero: null,
      complemento: null,
      prontuario: null,
    },
    diariasUti: 0,
    diariasUtiMesAnterior: 0,
    tipoUti: null,
    permanencia: 4,
    linhas: [],
  };

  it('sem complemento o arquivo não muda; com ele saem as linhas 05, 06 e 07 sem mexer no controle', () => {
    const sem = gerarArquivoSisaih('202510', '1234567', CNS, [aih]);
    const com = gerarArquivoSisaih('202510', '1234567', CNS, [
      {
        ...aih,
        complemento: {
          equipe: [
            { procedimento: '0407020039', cns: CNS, cbo: '225225', atividade: '01', documentoCredor: null },
          ],
          diagnosticos: [
            { cid: 'E119', tipo: 'secundario', classificacao: 'preexistente' },
            { cid: 'T814', tipo: 'secundario', classificacao: 'adquirido' },
          ],
          incrementos: [{ habilitacao: '2601', procedimento: null, percentual: 20 }],
        },
      },
    ]);
    expect(com.controle).toBe(sem.controle);
    expect(com.linhas - sem.linhas).toBe(4);
    const linhas = com.conteudo.split('\r\n');
    expect(linhas.find((x) => x.startsWith('05'))).toBe(
      `053525100000019040702003${'9'}${CNS}22522501${' '.repeat(14)}`,
    );
    expect(linhas.filter((x) => x.startsWith('06'))).toEqual([
      '06352510000001901E119SP',
      '06352510000001902T814SA',
    ]);
    expect(linhas.find((x) => x.startsWith('07'))).toBe(`0735251000000192601${' '.repeat(10)}02000`);
  });
});
