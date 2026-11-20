// Arquivo da APAC para importação no APAC-Mag / SIA (cap-12 §12.4; ficha do M51, seção 5: `faturamento.registrarApac`,
// APAC-Mag). O estabelecimento importa a remessa no aplicativo do Ministério e a entrega ao gestor, que a processa no SIA.
// Descritor pelo leiaute de exportação da APAC conhecido do construtor (o documento oficial não pôde ser baixado do
// DATASUS nesta construção): `conferidoContraOficial: false` até o faturamento conferir campo a campo na importação de
// teste (D-LEIAUTE-APAC-51; a tela avisa para não enviar enquanto não conferido). Registros:
//   - cabeçalho (01): '01', '#APAC', competência, quantidade de APACs, campo de controle, órgão de origem, sigla, CNPJ do
//     prestador, órgão de destino, indicador M/E e versão;
//   - APAC (14): competência, número, UF, CNES, datas de processamento e da validade, tipo (1, 2 ou 3), paciente (nome,
//     mãe, endereço, município, nascimento, sexo, CNS, raça, nacionalidade), médico solicitante e autorizador (CNS), os
//     três CID, o motivo de saída ou de permanência e a data da saída;
//   - procedimento (13): competência, número, procedimento, CBO e CNS do executante, quantidade, CID principal e
//     secundário (os campos de OPM, serviço e equipe em branco);
//   - laudo de nefrologia (06): competência, número, início do tratamento e os quatro domínios FAHEMO*.
// Campo de controle: (Σ códigos dos procedimentos + Σ quantidades) módulo 1111, mais 1111, como no BPA-Mag.
import type { CompetenciaSus } from '@sgh/contratos';
import type { ApacNoArquivo } from './apac.js';
import { controleBpa } from './bpa-leiaute.js';
import { type CampoLeiaute, FIM_DE_LINHA, type Leiaute, montarLinha } from './leiaute.js';

export const VERSAO_APAC = '03.20';

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

export const LEIAUTE_APAC_MAG: Leiaute = {
  nome: 'APAC-MAG',
  versao: VERSAO_APAC,
  conferidoContraOficial: false,
  fonte:
    'Leiaute de exportação da APAC (SIA/SUS), descrito pelo construtor do M51.3; conferir com o documento vigente do DATASUS',
  registros: {
    '01': {
      tipo: '01',
      campos: [
        fixo('ident', '01'),
        fixo('marca', '#APAC', 'A'),
        n('competencia', 6, true),
        n('apacs', 6, true),
        n('controle', 4, true),
        a('orgaoOrigem', 30, true),
        a('siglaOrigem', 6),
        n('cnpj', 14, true),
        a('orgaoDestino', 40, true),
        a('indicadorDestino', 1, true),
        a('versao', 10, true),
      ],
    },
    '14': {
      tipo: '14',
      campos: [
        fixo('ident', '14'),
        n('competencia', 6, true),
        n('numero', 13, true),
        n('uf', 2, true),
        n('cnes', 7, true),
        n('dataProcessamento', 8, true),
        n('inicioValidade', 8, true),
        n('fimValidade', 8, true),
        nb('tipoAtendimento', 2),
        n('tipoApac', 1, true),
        a('nomePaciente', 30, true),
        a('nomeMae', 30, true),
        a('logradouro', 30),
        a('numeroEndereco', 5),
        a('complemento', 10),
        nb('cep', 8),
        n('municipio', 7, true),
        n('nascimento', 8, true),
        a('sexo', 1, true),
        a('nomeResponsavel', 30, true),
        n('cnsPaciente', 15, true),
        n('cnsResponsavel', 15, true),
        n('cnsAutorizador', 15, true),
        a('cidPrincipal', 4, true),
        a('cidSecundario', 4),
        a('cidAssociado', 4),
        n('motivoSaida', 2, true),
        nb('dataSaida', 8),
        n('raca', 2, true),
        nb('etnia', 4),
        n('nacionalidade', 3, true),
        nb('tipoLogradouro', 3),
        a('bairro', 30),
        nb('cpfPaciente', 11),
        fixo('origem', 'APA', 'A'),
      ],
    },
    '13': {
      tipo: '13',
      campos: [
        fixo('ident', '13'),
        n('competencia', 6, true),
        n('numero', 13, true),
        n('procedimento', 10, true),
        a('cbo', 6, true),
        n('cnsExecutante', 15, true),
        n('quantidade', 7, true),
        nb('cnpjFornecedor', 14),
        a('notaFiscal', 10),
        a('cidPrincipal', 4, true),
        a('cidSecundario', 4),
        nb('servico', 3),
        nb('classificacao', 3),
        nb('ine', 10),
      ],
    },
    '06': {
      tipo: '06',
      campos: [
        fixo('ident', '06'),
        n('competencia', 6, true),
        n('numero', 13, true),
        n('inicioTratamento', 8, true),
        n('caracteristicaTratamento', 2, true),
        n('acessoVascular', 2, true),
        n('situacaoTransplante', 2, true),
        n('contraindicacaoTransplante', 2, true),
      ],
    },
  },
};

export interface CabecalhoApac {
  readonly orgaoOrigem: string;
  readonly siglaOrigem: string;
  readonly cnpj: string;
  readonly orgaoDestino: string;
  readonly indicadorDestino: 'M' | 'E';
  /** Código IBGE da UF do gestor (2 dígitos; parâmetro `faturamento.sus.apac.uf`). */
  readonly uf: string;
}

/** Os campos do cabeçalho que faltam (a crítica da APAC os acusa antes de gerar). */
export function camposAusentesCabecalhoApac(c: Partial<CabecalhoApac>): string[] {
  const f: string[] = [];
  if (!(c.orgaoOrigem ?? '').trim()) f.push('orgaoOrigem');
  if (!/^\d{14}$/.test(c.cnpj ?? '')) f.push('cnpjPrestador');
  if (!(c.orgaoDestino ?? '').trim()) f.push('orgaoDestino');
  if (c.indicadorDestino !== 'M' && c.indicadorDestino !== 'E') f.push('indicadorDestino');
  if (!/^(1[1-7]|2[1-9]|3[1235]|4[1-3]|5[0-3])$/.test(c.uf ?? '')) f.push('uf');
  return f;
}

const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'] as const;
const aaaammdd = (d: string) => d.slice(0, 10).replace(/-/g, '');
const corte = (v: string | null, t: number) => (v === null ? null : v.trim().slice(0, t));
const primeiroDia = (c: string) => `${c}01`;
const ultimoDia = (c: string) => {
  const ano = Number(c.slice(0, 4));
  const mes = Number(c.slice(4, 6));
  return `${c}${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** Uma linha de procedimento numerada como o banco do Sante a guarda (sem documento). */
export interface LinhaApacNumerada {
  readonly apac: number;
  readonly numero: string;
  readonly tipoNoArquivo: '1' | '2' | '3';
  readonly procedimento: string;
  readonly principal: boolean;
  readonly cbo: string;
  readonly quantidade: number;
  readonly conta: number;
}

export interface ArquivoApacGerado {
  readonly nomeArquivo: string;
  readonly conteudo: string;
  readonly linhas: number;
  /** APACs no arquivo. */
  readonly registros: number;
  /** Linhas de procedimento (registro 13). */
  readonly procedimentos: number;
  readonly controle: number;
  readonly semMovimento: boolean;
  readonly leiaute: string;
  readonly versaoLeiaute: string;
  readonly conferidoContraOficial: boolean;
  readonly numeradas: readonly LinhaApacNumerada[];
}

/**
 * O arquivo APAC-Mag da competência: o cabeçalho, e por APAC (em ordem de número) o registro 14, o laudo de nefrologia
 * quando houver e um registro 13 por procedimento (o principal primeiro). A ordem é estável: o mesmo conjunto dá o mesmo
 * arquivo e o mesmo hash. `dataProcessamento`: AAAA-MM-DD da geração.
 */
export function gerarArquivoApac(
  competencia: CompetenciaSus,
  cnes: string | number,
  cabecalho: CabecalhoApac,
  apacs: readonly ApacNoArquivo[],
  dataProcessamento: string,
  l: Leiaute = LEIAUTE_APAC_MAG,
): ArquivoApacGerado {
  const ordenadas = [...apacs].sort((x, y) => x.numero.localeCompare(y.numero));
  const corpo: string[] = [];
  const numeradas: LinhaApacNumerada[] = [];
  for (const x of ordenadas) {
    const p = x.paciente;
    corpo.push(
      montarLinha(l, '14', {
        competencia,
        numero: x.numero,
        uf: cabecalho.uf,
        cnes,
        dataProcessamento: aaaammdd(dataProcessamento),
        inicioValidade: primeiroDia(x.competenciaInicial),
        fimValidade: ultimoDia(x.competenciaFinal),
        tipoApac: x.tipoNoArquivo,
        nomePaciente: corte(p.nome, 30),
        nomeMae: corte(p.mae, 30),
        logradouro: corte(p.logradouro, 30),
        numeroEndereco: corte(p.numero, 5),
        complemento: corte(p.complemento, 10),
        cep: p.cep?.slice(0, 8) ?? null,
        municipio: String(p.municipio).slice(0, 7),
        nascimento: aaaammdd(p.nascimento),
        sexo: p.sexo,
        nomeResponsavel: corte(x.solicitante.nome, 30),
        cnsPaciente: p.cns,
        cnsResponsavel: x.solicitante.cns,
        cnsAutorizador: x.autorizador,
        cidPrincipal: x.cidPrincipal.slice(0, 4),
        cidSecundario: x.cidSecundario?.slice(0, 4) ?? null,
        cidAssociado: x.cidAssociado?.slice(0, 4) ?? null,
        motivoSaida: x.motivoSaida,
        dataSaida: x.dataSaida ? aaaammdd(x.dataSaida) : null,
        raca: p.raca,
        nacionalidade: '010',
        bairro: corte(p.bairro, 30),
        cpfPaciente: p.cpf,
      }),
    );
    if (x.nefrologia)
      corpo.push(
        montarLinha(l, '06', {
          competencia,
          numero: x.numero,
          inicioTratamento: aaaammdd(x.nefrologia.inicioTratamento),
          caracteristicaTratamento: x.nefrologia.caracteristicaTratamento,
          acessoVascular: x.nefrologia.acessoVascular,
          situacaoTransplante: x.nefrologia.situacaoTransplante,
          contraindicacaoTransplante: x.nefrologia.contraindicacaoTransplante,
        }),
      );
    const procs = [...x.procedimentos].sort(
      (u, v) => Number(v.principal) - Number(u.principal) || u.codigo.localeCompare(v.codigo),
    );
    for (const q of procs) {
      corpo.push(
        montarLinha(l, '13', {
          competencia,
          numero: x.numero,
          procedimento: q.codigo,
          cbo: q.cbo,
          cnsExecutante: q.cnsExecutante,
          quantidade: q.quantidade,
          cidPrincipal: x.cidPrincipal.slice(0, 4),
          cidSecundario: x.cidSecundario?.slice(0, 4) ?? null,
        }),
      );
      numeradas.push({
        apac: x.apac,
        numero: x.numero,
        tipoNoArquivo: x.tipoNoArquivo,
        procedimento: q.codigo,
        principal: q.principal,
        cbo: q.cbo,
        quantidade: q.quantidade,
        conta: q.conta,
      });
    }
  }
  const controle = controleBpa(
    numeradas.map((x) => ({ procedimento: x.procedimento, quantidade: x.quantidade })),
  );
  const cab = montarLinha(l, '01', {
    competencia,
    apacs: ordenadas.length,
    controle,
    orgaoOrigem: corte(cabecalho.orgaoOrigem, 30),
    siglaOrigem: corte(cabecalho.siglaOrigem, 6),
    cnpj: cabecalho.cnpj,
    orgaoDestino: corte(cabecalho.orgaoDestino, 40),
    indicadorDestino: cabecalho.indicadorDestino,
    versao: `V${l.versao}`,
  });
  const linhas = [cab, ...corpo];
  const mes = MESES[Number(competencia.slice(4, 6)) - 1] as string;
  return {
    nomeArquivo: `AP${String(cnes).padStart(7, '0')}${competencia}.${mes}`,
    conteudo: linhas.join(FIM_DE_LINHA) + FIM_DE_LINHA,
    linhas: linhas.length,
    registros: ordenadas.length,
    procedimentos: numeradas.length,
    controle,
    semMovimento: ordenadas.length === 0,
    leiaute: l.nome,
    versaoLeiaute: l.versao,
    conferidoContraOficial: l.conferidoContraOficial,
    numeradas,
  };
}
