// Leitura dos arquivos de uma carga: escolhe o leiaute pelo nome do arquivo oficial (ficha do M13, seção 3) e
// junta os itens de todos os arquivos enviados. Nome que não corresponde a nenhum arquivo do catálogo é erro do
// arquivo (nada é publicado).
import type { CodigoCatalogo } from '@sgh/contratos';
import type { ErroArquivo, ItemLido, LeituraArquivo } from './leiautes/comum.js';
import {
  LEIAUTE_ANS_CLASSIFICACAO_PRESTADOR,
  LEIAUTE_ANS_CLASSIFICACAO_PROCEDIMENTO,
  LEIAUTE_ANS_DISPONIBILIDADE,
  LEIAUTE_ANS_GRUPO_SIP,
  LEIAUTE_ANS_PROCEDIMENTO_SIP,
  LEIAUTE_ANS_REMUNERACAO,
  LEIAUTE_ANS_TPS,
  LEIAUTE_ATIVIDADE,
  LEIAUTE_BANCO,
  LEIAUTE_CBO,
  LEIAUTE_CIAP,
  LEIAUTE_CID10,
  LEIAUTE_CID_O,
  LEIAUTE_DCB,
  LEIAUTE_FABRICANTE,
  LEIAUTE_OCUPACAO,
  LEIAUTE_TUSS_19,
  LEIAUTE_TUSS_24,
  LEIAUTE_TUSS_38,
  LEIAUTES_AGRAVOS,
  LEIAUTES_DOMINIOS_SUS,
  LEIAUTES_SPED_CONTABIL,
  leiauteFiscal,
  lerCsv,
} from './leiautes/csv-oficiais.js';
import {
  lerBaseCep,
  lerBrasindice,
  lerRelacaoSigtap,
  lerSimpro,
  lerTbProcedimento,
  type SecaoLeiauteCep,
} from './leiautes/posicoes.js';

export interface ArquivoCarga {
  readonly nome: string;
  readonly conteudo: string;
}

export interface OpcoesLeitura {
  /** Leiaute de posições da base de CEP lido do banco (sem ele, o padrão do dia). */
  readonly leiauteCep?: readonly SecaoLeiauteCep[];
}

export interface LeituraCarga {
  readonly itens: readonly ItemLido[];
  readonly erros: readonly ErroArquivo[];
  readonly edicao: string | null;
}

export const ENTIDADES_FISCAIS = [
  'cfop',
  'itemServico',
  'genero',
  'tipoDocumento',
  'cstCofins',
  'cstPis',
  'naturezaCredito',
  'indicadorOperacao',
  'naturezaRetencao',
  'condicaoPj',
  'naturezaReceita',
  'imunidadeIssqn',
] as const;

const nome = (n: string) => n.split(/[\\/]/).pop()?.toLowerCase() ?? '';

/** Leitor do arquivo pelo nome, dentro do catálogo (null: o arquivo não é deste catálogo). */
export function leitorDoArquivo(
  catalogo: CodigoCatalogo,
  arquivo: string,
  o: OpcoesLeitura = {},
): ((texto: string) => LeituraArquivo) | null {
  const n = nome(arquivo);
  switch (catalogo) {
    case 'cid':
      if (n.includes('ciap')) return (t) => lerCsv(t, LEIAUTE_CIAP);
      if (n.includes('cid-o') || n.includes('cido') || n.includes('morfolog'))
        return (t) => lerCsv(t, LEIAUTE_CID_O);
      if (n.includes('cid')) return (t) => lerCsv(t, LEIAUTE_CID10);
      return null;
    case 'sigtap':
      if (n.startsWith('tb_procedimento')) return lerTbProcedimento;
      if (n.startsWith('rl_procedimento_cid')) return (t) => lerRelacaoSigtap(t, 'cid');
      if (n.startsWith('rl_procedimento_ocupacao')) return (t) => lerRelacaoSigtap(t, 'cbo');
      return null;
    case 'tuss':
      if (n.startsWith('tuss38')) return (t) => lerCsv(t, LEIAUTE_TUSS_38);
      if (n.startsWith('tuss24')) return (t) => lerCsv(t, LEIAUTE_TUSS_24);
      if (n.startsWith('tuss19') || n.startsWith('tuss20')) return (t) => lerCsv(t, LEIAUTE_TUSS_19);
      return null;
    case 'cep':
      return n.endsWith('.txt') ? (t) => lerBaseCep(t, o.leiauteCep) : null;
    case 'cbo':
      if (n.startsWith('cbo')) return (t) => lerCsv(t, LEIAUTE_CBO);
      if (n.startsWith('ocupac')) return (t) => lerCsv(t, LEIAUTE_OCUPACAO);
      return null;
    case 'listas':
      if (n.startsWith('dcb')) return (t) => lerCsv(t, LEIAUTE_DCB);
      if (n.startsWith('fabricante')) return (t) => lerCsv(t, LEIAUTE_FABRICANTE);
      if (n.startsWith('banco')) return (t) => lerCsv(t, LEIAUTE_BANCO);
      if (n.startsWith('atividade')) return (t) => lerCsv(t, LEIAUTE_ATIVIDADE);
      return null;
    case 'fiscal': {
      const e = ENTIDADES_FISCAIS.find((x) => n === `${x.toLowerCase()}.txt`);
      return e ? (t) => lerCsv(t, leiauteFiscal(e)) : null;
    }
    case 'brasindice':
      return n.startsWith('brasindice') ? lerBrasindice : null;
    case 'simpro':
      return n.startsWith('simpro') ? lerSimpro : null;
    case 'ans': {
      const l = [
        ['sip_grupos', LEIAUTE_ANS_GRUPO_SIP],
        ['sip_procedimentos', LEIAUTE_ANS_PROCEDIMENTO_SIP],
        ['classificacao_procedimentos', LEIAUTE_ANS_CLASSIFICACAO_PROCEDIMENTO],
        ['tps', LEIAUTE_ANS_TPS],
        ['classificacao_prestador', LEIAUTE_ANS_CLASSIFICACAO_PRESTADOR],
        ['disponibilidade', LEIAUTE_ANS_DISPONIBILIDADE],
        ['remuneracao', LEIAUTE_ANS_REMUNERACAO],
      ] as const;
      const x = l.find(([p]) => n.startsWith(p));
      return x ? (t) => lerCsv(t, x[1]) : null;
    }
    case 'dominiosSus': {
      const k = Object.keys(LEIAUTES_DOMINIOS_SUS).find((x) => n.startsWith(x));
      const l = k ? LEIAUTES_DOMINIOS_SUS[k] : undefined;
      return l ? (t) => lerCsv(t, l) : null;
    }
    case 'spedContabil': {
      const k = Object.keys(LEIAUTES_SPED_CONTABIL).find((x) => n.startsWith(x));
      const l = k ? LEIAUTES_SPED_CONTABIL[k] : undefined;
      return l ? (t) => lerCsv(t, l) : null;
    }
    case 'agravos': {
      const k = Object.keys(LEIAUTES_AGRAVOS).find((x) => n.startsWith(x));
      const l = k ? LEIAUTES_AGRAVOS[k] : undefined;
      return l ? (t) => lerCsv(t, l) : null;
    }
  }
}

/** Lê todos os arquivos da carga; a edição é a do arquivo (ou a informada pela tela). */
export function lerArquivosDaCarga(
  catalogo: CodigoCatalogo,
  arquivos: readonly ArquivoCarga[],
  edicaoInformada: string | null,
  o: OpcoesLeitura = {},
): LeituraCarga {
  const itens: ItemLido[] = [];
  const erros: ErroArquivo[] = [];
  const edicoes = new Set<string>();
  let base = 0;
  for (const a of arquivos) {
    const ler = leitorDoArquivo(catalogo, a.nome, o);
    if (!ler) {
      erros.push({ linha: null, mensagem: `arquivo ${a.nome}: não é um arquivo oficial deste catálogo` });
      continue;
    }
    const r = ler(a.conteudo);
    // Linha global: os arquivos seguidos (o detalhe mostra a linha de cada um com o nome).
    for (const i of r.itens) itens.push({ ...i, linha: base + i.linha });
    for (const e of r.erros)
      erros.push({ linha: e.linha === null ? null : base + e.linha, mensagem: `${a.nome}: ${e.mensagem}` });
    if (r.edicao) edicoes.add(r.edicao);
    base += 1_000_000;
  }
  if (edicoes.size > 1)
    erros.push({
      linha: null,
      mensagem: `os arquivos trazem edições diferentes (${[...edicoes].sort().join(', ')})`,
    });
  const doArquivo = edicoes.size === 1 ? ([...edicoes][0] as string) : null;
  if (doArquivo && edicaoInformada && doArquivo !== edicaoInformada)
    erros.push({
      linha: null,
      mensagem: `a edição informada (${edicaoInformada}) difere da do arquivo (${doArquivo})`,
    });
  return { itens, erros, edicao: doArquivo ?? edicaoInformada };
}
