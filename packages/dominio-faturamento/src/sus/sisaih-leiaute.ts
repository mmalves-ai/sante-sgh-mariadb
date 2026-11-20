// Arquivo das AIHs para importação no SISAIH01 (cap-12 §12.4; ficha do M51, seção 5: `faturamento.registrarAih`;
// DP-47.4: o prestador gera o SISAIH01 e o gestor processa no SIHD2). O estabelecimento importa a remessa no aplicativo
// SISAIH01 do Ministério, confere e exporta o lote para o gestor. Descritor do construtor do M51.4 (o documento oficial
// de importação não pôde ser baixado do DATASUS nesta construção): `conferidoContraOficial: false` até o faturamento
// conferir campo a campo na importação de teste (D-LEIAUTE-AIH-51; a tela avisa para não enviar enquanto não conferido).
//   - cabeçalho (registro 01): '01', '#SIH#', competência de apresentação, CNES, quantidade de AIH, campo de controle e
//     versão;
//   - AIH (02): número, identificação (1, normal), CNES, competência, especialidade do leito, caráter, datas de emissão,
//     internação e saída, procedimentos solicitado e realizado, mudança de procedimento, motivo de saída, CIDs,
//     documentos do solicitante, do autorizador e do diretor clínico, o paciente (CNS ou CPF, nome, nascimento, sexo,
//     raça, município, CEP e endereço; prontuário), diárias de UTI (total, mês anterior e tipo) e permanência;
//   - procedimento (03): número da AIH, sequência, procedimento, quantidade, CBO e competência (secundários, especiais e
//     diárias de UTI);
//   - OPM (04): número da AIH, sequência, procedimento, quantidade, CNPJ do fornecedor, nota fiscal, registro Anvisa,
//     série e lote.
// Campo de controle: (Σ procedimentos + Σ quantidades das linhas 03 e 04) módulo 1111, mais 1111 (como o BPA-Mag).
import type { CaraterInternacaoSih, CompetenciaSus } from '@sgh/contratos';
import { type CampoLeiaute, FIM_DE_LINHA, type Leiaute, montarLinha } from './leiaute.js';

export const VERSAO_SISAIH01 = '25.40';

const n = (nome: string, tamanho: number, obrigatorio = false): CampoLeiaute => ({
  nome,
  tamanho,
  tipo: 'N',
  obrigatorio,
});
const nb = (nome: string, tamanho: number): CampoLeiaute => ({
  nome,
  tamanho,
  tipo: 'N',
  obrigatorio: false,
  branco: true,
});
const a = (nome: string, tamanho: number, obrigatorio = false): CampoLeiaute => ({
  nome,
  tamanho,
  tipo: 'A',
  obrigatorio,
});
const fixo = (nome: string, valor: string, tipo: 'N' | 'A' = 'N'): CampoLeiaute => ({
  nome,
  tamanho: valor.length,
  tipo,
  obrigatorio: true,
  fixo: valor,
});

export const LEIAUTE_SISAIH01: Leiaute = {
  nome: 'SISAIH01',
  versao: VERSAO_SISAIH01,
  conferidoContraOficial: false,
  fonte:
    'Leiaute de importação do SISAIH01 (SIH/SUS), descrito pelo construtor do M51.4; conferir com o documento vigente do DATASUS',
  registros: {
    '01': {
      tipo: '01',
      campos: [
        fixo('ident', '01'),
        fixo('marca', '#SIH#', 'A'),
        n('competencia', 6, true),
        n('cnes', 7, true),
        n('aihs', 5, true),
        n('controle', 4, true),
        a('versao', 10, true),
      ],
    },
    '02': {
      tipo: '02',
      campos: [
        fixo('ident', '02'),
        n('numero', 13, true),
        fixo('identificacao', '1'),
        n('cnes', 7, true),
        n('competencia', 6, true),
        n('especialidade', 2, true),
        n('carater', 2, true),
        n('dataEmissao', 8, true),
        n('dataInternacao', 8, true),
        n('dataSaida', 8, true),
        n('procedimentoSolicitado', 10, true),
        n('procedimentoRealizado', 10, true),
        a('mudancaProcedimento', 1, true),
        n('motivoSaida', 2, true),
        a('cidPrincipal', 4, true),
        a('cidSecundario', 4),
        a('cidObito', 4),
        n('documentoSolicitante', 15, true),
        n('cnsAutorizador', 15, true),
        n('cnsDiretorClinico', 15, true),
        nb('cnsPaciente', 15),
        nb('cpfPaciente', 11),
        a('nome', 70, true),
        n('nascimento', 8, true),
        a('sexo', 1, true),
        n('raca', 2, true),
        n('municipio', 6, true),
        nb('cep', 8),
        a('logradouro', 50),
        a('numeroEndereco', 7),
        a('complemento', 15),
        nb('prontuario', 15),
        n('diariasUti', 3, true),
        n('diariasUtiMesAnterior', 3, true),
        nb('tipoUti', 2),
        n('permanencia', 3, true),
      ],
    },
    '03': {
      tipo: '03',
      campos: [
        fixo('ident', '03'),
        n('numero', 13, true),
        n('sequencia', 2, true),
        n('procedimento', 10, true),
        n('quantidade', 3, true),
        a('cbo', 6),
        n('competencia', 6, true),
      ],
    },
    '04': {
      tipo: '04',
      campos: [
        fixo('ident', '04'),
        n('numero', 13, true),
        n('sequencia', 2, true),
        n('procedimento', 10, true),
        n('quantidade', 3, true),
        n('cnpjFornecedor', 14, true),
        a('notaFiscal', 15, true),
        a('registroAnvisa', 20),
        a('serie', 20),
        a('lote', 20),
      ],
    },
  },
};

/** Uma linha de procedimento ou OPM da AIH no arquivo (sem dado pessoal). */
export interface LinhaSisaih {
  readonly tipo: 'secundario' | 'especial' | 'opm' | 'diaria-uti';
  readonly procedimento: string;
  readonly quantidade: number;
  readonly cbo: string | null;
  readonly opm: {
    readonly cnpjFornecedor: string;
    readonly notaFiscal: string;
    readonly registroAnvisa: string;
    readonly serie: string;
    readonly lote: string;
  } | null;
}

/** A AIH pronta para o arquivo (o paciente só vai ao arquivo; o banco do Sante guarda as chaves e as linhas). */
export interface AihParaArquivo {
  readonly numero: string;
  readonly especialidade: number;
  readonly carater: CaraterInternacaoSih;
  readonly dataAutorizacao: string;
  readonly entrada: string;
  readonly alta: string;
  readonly procedimentoSolicitado: string;
  readonly procedimentoRealizado: string;
  readonly motivoSaida: number;
  readonly cidPrincipal: string;
  readonly cidSecundario: string | null;
  readonly cidObito: string | null;
  readonly documentoSolicitante: string;
  readonly cnsAutorizador: string;
  readonly paciente: {
    readonly cns: string | null;
    readonly cpf: string | null;
    readonly nome: string;
    readonly nascimento: string;
    readonly sexo: 'M' | 'F';
    readonly raca: string;
    readonly municipio: number;
    readonly cep: string | null;
    readonly logradouro: string | null;
    readonly numero: string | null;
    readonly complemento: string | null;
    readonly prontuario: number | null;
  };
  readonly diariasUti: number;
  readonly diariasUtiMesAnterior: number;
  readonly tipoUti: number | null;
  readonly permanencia: number;
  readonly linhas: readonly LinhaSisaih[];
}

export interface ArquivoSisaihGerado {
  readonly nomeArquivo: string;
  readonly conteudo: string;
  readonly linhas: number;
  /** AIHs no arquivo. */
  readonly registros: number;
  /** Linhas de procedimento e de OPM. */
  readonly procedimentos: number;
  readonly controle: number;
  readonly semMovimento: boolean;
  readonly leiaute: string;
  readonly versaoLeiaute: string;
  readonly conferidoContraOficial: boolean;
}

/** Campo de controle: (Σ procedimentos + Σ quantidades) mod 1111 + 1111 (BigInt: os códigos têm 10 dígitos). */
export function controleSisaih(linhas: readonly { procedimento: string; quantidade: number }[]): number {
  let s = 0n;
  for (const l of linhas) s += BigInt(l.procedimento) + BigInt(Math.round(l.quantidade));
  return Number((s % 1111n) + 1111n);
}

const aaaammdd = (d: string) => d.slice(0, 10).replace(/-/g, '');
const corte = (v: string | null, t: number) => (v === null ? null : v.trim().slice(0, t));
/** Linhas por AIH no arquivo (a sequência tem 2 dígitos). */
export const LINHAS_POR_AIH_SISAIH = 99;

/**
 * Monta o arquivo da competência: o cabeçalho e, por AIH (em ordem de número), o registro da AIH seguido dos
 * procedimentos (secundários, especiais e diárias de UTI) e dos OPM. A ordem é estável: o mesmo conjunto dá o mesmo
 * arquivo e o mesmo hash.
 */
export function gerarArquivoSisaih(
  competencia: CompetenciaSus,
  cnes: string | number,
  cnsDiretorClinico: string,
  aihs: readonly AihParaArquivo[],
  l: Leiaute = LEIAUTE_SISAIH01,
): ArquivoSisaihGerado {
  const corpo: string[] = [];
  const todas: { procedimento: string; quantidade: number }[] = [];
  const ordenadas = [...aihs].sort((x, y) => x.numero.localeCompare(y.numero));
  for (const x of ordenadas) {
    const p = x.paciente;
    corpo.push(
      montarLinha(l, '02', {
        numero: x.numero,
        cnes,
        competencia,
        especialidade: x.especialidade,
        carater: x.carater,
        dataEmissao: aaaammdd(x.dataAutorizacao),
        dataInternacao: aaaammdd(x.entrada),
        dataSaida: aaaammdd(x.alta),
        procedimentoSolicitado: x.procedimentoSolicitado,
        procedimentoRealizado: x.procedimentoRealizado,
        mudancaProcedimento: x.procedimentoRealizado === x.procedimentoSolicitado ? 'N' : 'S',
        motivoSaida: x.motivoSaida,
        cidPrincipal: x.cidPrincipal.slice(0, 4),
        cidSecundario: x.cidSecundario?.slice(0, 4) ?? null,
        cidObito: x.cidObito?.slice(0, 4) ?? null,
        documentoSolicitante: x.documentoSolicitante,
        cnsAutorizador: x.cnsAutorizador,
        cnsDiretorClinico,
        cnsPaciente: p.cns,
        cpfPaciente: p.cns ? null : p.cpf,
        nome: corte(p.nome, 70),
        nascimento: aaaammdd(p.nascimento),
        sexo: p.sexo,
        raca: p.raca,
        municipio: String(p.municipio).slice(0, 6),
        cep: p.cep?.slice(0, 8) ?? null,
        logradouro: corte(p.logradouro, 50),
        numeroEndereco: corte(p.numero, 7),
        complemento: corte(p.complemento, 15),
        prontuario: p.prontuario,
        diariasUti: x.diariasUti,
        diariasUtiMesAnterior: x.diariasUtiMesAnterior,
        tipoUti: x.tipoUti,
        permanencia: Math.min(999, x.permanencia),
      }),
    );
    const procs = x.linhas.filter((y) => y.tipo !== 'opm');
    const opms = x.linhas.filter((y) => y.tipo === 'opm');
    if (procs.length + opms.length > LINHAS_POR_AIH_SISAIH)
      throw new Error(`AIH ${x.numero}: mais de ${LINHAS_POR_AIH_SISAIH} linhas`);
    let seq = 0;
    for (const y of procs) {
      seq += 1;
      corpo.push(
        montarLinha(l, '03', {
          numero: x.numero,
          sequencia: seq,
          procedimento: y.procedimento,
          quantidade: Math.min(999, y.quantidade),
          cbo: y.cbo,
          competencia,
        }),
      );
      todas.push(y);
    }
    for (const y of opms) {
      seq += 1;
      const o = y.opm;
      corpo.push(
        montarLinha(l, '04', {
          numero: x.numero,
          sequencia: seq,
          procedimento: y.procedimento,
          quantidade: Math.min(999, y.quantidade),
          cnpjFornecedor: o?.cnpjFornecedor ?? null,
          notaFiscal: o?.notaFiscal ?? null,
          registroAnvisa: corte(o?.registroAnvisa ?? null, 20),
          serie: corte(o?.serie ?? null, 20),
          lote: corte(o?.lote ?? null, 20),
        }),
      );
      todas.push(y);
    }
  }
  const controle = controleSisaih(todas);
  const cab = montarLinha(l, '01', {
    competencia,
    cnes,
    aihs: ordenadas.length,
    controle,
    versao: `V${l.versao}`,
  });
  const linhas = [cab, ...corpo];
  return {
    nomeArquivo: `AIH${String(cnes).padStart(7, '0')}${competencia}.TXT`,
    conteudo: linhas.join(FIM_DE_LINHA) + FIM_DE_LINHA,
    linhas: linhas.length,
    registros: ordenadas.length,
    procedimentos: todas.length,
    controle,
    semMovimento: ordenadas.length === 0,
    leiaute: l.nome,
    versaoLeiaute: l.versao,
    conferidoContraOficial: l.conferidoContraOficial,
  };
}
