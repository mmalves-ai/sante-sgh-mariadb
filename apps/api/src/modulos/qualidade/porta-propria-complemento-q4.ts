// Complemento Q4 da porta PRÓPRIA da gestão da qualidade (modulos-proprios-3, família qualidade-q4): as reuniões das
// comissões (a leitura da reunião, as reuniões da comissão e a retificação da ata), com o mesmo contrato da porta de
// memória (ordem, nulo para o inexistente, versão conferida e a versão anterior no histórico).
// - Modelo: reuniao_comissao, com as colunas do retrato da ata de 18_QUA/99_reuniao_ata (os nomes dos presentes como
//   registrados, o total de membros na data, os convidados em texto, a assinatura da ata e a da versão anterior, o
//   instante do cancelamento). A reunião é do estabelecimento pela comissão (comissao_hospitalar.estabelecimento_id).
// - Retificação: a linha é travada (SELECT ... FOR UPDATE) e conferida pela versão; a reunião cancelada e a assinatura
//   lida pela tela diferente da gravada recusam `versao-desatualizada` (nada é gravado). Retificar a ata assinada limpa a
//   assinatura (o texto novo aguarda nova assinatura) e guarda a assinatura anterior. A versão anterior inteira vai à
//   trilha da mesma operação (dados.versaoAnterior, ação `retificacao`), que `versoes` lê: histórico só de acréscimo.
// - Quem grava a reunião, a assinatura e o cancelamento (outras famílias) usa as mesmas colunas: presentes_registrados
//   (JSON), membros_quantidade, presentes_quantidade, convidados, ata_assinada_em/_por_usuario_id e cancelada_em com a
//   situação 'cancelada' e o motivo_cancelamento; a realização em realizada_em com a situação 'realizada'.
// Ligação (integrador): a porta própria completa delega `reuniao` e `reunioes` às leituras e põe `retificarAta` no
// gravador (texto exato no relatório da família).
import type { TxOperacao } from '@sgh/nucleo';
import type { AnotacaoGravacao } from '../enfermagem/gravacao-direta.js';
import {
  exigirUsuario,
  instante,
  instanteN,
  type L,
  type Linha,
  lerNoEstabelecimento,
  n,
  type NucleoQualidade,
  paraBanco,
  texto,
  textoN,
} from './apoio-propria.js';
import type { ContextoGestao, GravadorGestao } from './porta-gestao.js';
import { type ReuniaoComissaoRegistrada, recusaVersaoGestao } from './tipos.js';

/** Os métodos da porta da gestão que este complemento cobre (a ligação na porta completa é do integrador). */
export const METODOS_COMPLEMENTO_Q4 = ['reuniao', 'reunioes', 'retificarAta'] as const;

/** As tabelas que as gravações deste complemento escrevem (o integrador as soma às declaradas na porta completa). */
export const TABELAS_COMPLEMENTO_Q4 = ['reuniao_comissao'] as const;

/** Teto das reuniões de uma comissão (a reunião é mensal ou menos: o teto nunca é alcançado no uso real). */
export const TETO_REUNIOES = 5000;

/** A leitura da reunião no contrato (do estabelecimento pela comissão; a excluída não aparece). */
export const SQL_REUNIAO = `
  SELECT r.id, r.comissao_hospitalar_id, r.tipo, r.situacao, r.agendada_para, r.realizada_em, r.pauta, r.ata,
         r.deliberacoes, r.presentes_registrados, r.membros_quantidade, r.presentes_quantidade, r.convidados,
         r.criado_em, uc.login AS registrada_por, r.versao, r.ata_assinada_em, ua.login AS assinada_por,
         r.cancelada_em, r.motivo_cancelamento, r.assinatura_anterior_em, uaa.login AS assinatura_anterior_por
    FROM reuniao_comissao r
    JOIN comissao_hospitalar c ON c.id = r.comissao_hospitalar_id
    LEFT JOIN usuario uc ON uc.id = r.criado_por
    LEFT JOIN usuario ua ON ua.id = r.ata_assinada_por_usuario_id
    LEFT JOIN usuario uaa ON uaa.id = r.assinatura_anterior_por_usuario_id
   WHERE c.estabelecimento_id = ? AND r.excluido_em IS NULL`;

/** A linha da reunião no contrato. */
export function reuniaoDaLinha(r: Linha): ReuniaoComissaoRegistrada {
  return {
    id: n(r['id']),
    comissao: n(r['comissao_hospitalar_id']),
    tipo: texto(r['tipo']),
    realizadaEm: instante(r['realizada_em'] ?? r['agendada_para']),
    pauta: texto(r['pauta']),
    ata: texto(r['ata']),
    presentes: textoN(r['presentes_registrados']) ?? '[]',
    membrosTotal: n(r['membros_quantidade']),
    presentesTotal: n(r['presentes_quantidade']),
    convidados: textoN(r['convidados']),
    deliberacoes: textoN(r['deliberacoes']),
    registradaPor: texto(r['registrada_por']),
    registradaEm: instante(r['criado_em']),
    versao: n(r['versao']),
    ataAssinadaEm: instanteN(r['ata_assinada_em']),
    ataAssinadaPor: textoN(r['assinada_por']),
    canceladaEm: instanteN(r['cancelada_em']),
    motivoCancelamento: textoN(r['motivo_cancelamento']),
    assinaturaAnteriorEm: instanteN(r['assinatura_anterior_em']),
    assinaturaAnteriorPor: textoN(r['assinatura_anterior_por']),
  };
}

export class LeiturasGestaoComplementoQ4 {
  constructor(private readonly nucleo: NucleoQualidade) {}

  private ler<T>(c: ContextoGestao, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, c, fn);
  }

  /** As reuniões da comissão, da mais recente para a mais antiga (pela realização; o empate pelo id). */
  reunioes(c: ContextoGestao, comissao: number): Promise<ReuniaoComissaoRegistrada[]> {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `${SQL_REUNIAO} AND r.comissao_hospitalar_id = ?
          ORDER BY COALESCE(r.realizada_em, r.agendada_para) DESC, r.id DESC`,
        [est, comissao],
        { teto: TETO_REUNIOES },
      );
      return linhas.map(reuniaoDaLinha);
    });
  }

  /** A reunião pelo id (nulo quando não existe no estabelecimento da sessão). */
  reuniao(c: ContextoGestao, id: number): Promise<ReuniaoComissaoRegistrada | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_REUNIAO} AND r.id = ?`, [est, id]);
      return r ? reuniaoDaLinha(r) : null;
    });
  }
}

/** A linha como estava (datas no formato local), para a versão anterior na trilha. */
function retrato(r: Linha): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? instante(v) : v]));
}

/** As gravações deste complemento, na transação da operação (o integrador as espalha no gravador da porta). */
export function gravadorComplementoQ4(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao,
): Pick<GravadorGestao, 'retificarAta'> {
  return {
    async retificarAta(r) {
      const [x] = await tx.consultarParaAtualizar<Linha>(
        `SELECT r.* FROM reuniao_comissao r JOIN comissao_hospitalar c ON c.id = r.comissao_hospitalar_id
          WHERE r.id = ? AND c.estabelecimento_id = ? AND r.excluido_em IS NULL`,
        [r.id, est],
        { teto: 1 },
      );
      if (!x || n(x['versao']) !== r.versao || texto(x['situacao']) === 'cancelada')
        throw recusaVersaoGestao('A reunião');
      // A tela leu a ata assinada (ou não) e decidiu pela senha: a assinatura gravada tem de ser a mesma.
      if (!!r.assinaturaAtual !== (x['ata_assinada_em'] !== null && x['ata_assinada_em'] !== undefined))
        throw recusaVersaoGestao('A reunião');
      const usuario = await exigirUsuario(tx, r.usuario);
      const assinada = r.assinaturaAtual !== null;
      await tx.executar(
        `UPDATE reuniao_comissao
            SET pauta = ?, ata = ?, presentes_registrados = ?, presentes_quantidade = ?, convidados = ?,
                deliberacoes = ?,
                ${
                  assinada
                    ? `assinatura_anterior_em = ata_assinada_em,
                       assinatura_anterior_por_usuario_id = ata_assinada_por_usuario_id,
                       ata_assinada_em = NULL, ata_assinada_por_usuario_id = NULL,`
                    : ''
                }
                alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE id = ? AND versao = ?`,
        [
          r.pauta,
          r.ata,
          r.presentes,
          r.presentesTotal,
          r.convidados,
          r.deliberacoes,
          paraBanco(r.agora),
          usuario,
          r.id,
          r.versao,
        ],
      );
      anotacao.motivo = r.justificativa;
      anotacao.dados = {
        ...(anotacao.dados ?? {}),
        versaoAnterior: {
          tabela: 'reuniao_comissao',
          id: n(x['id']),
          versao: n(x['versao']),
          acao: 'retificacao',
          motivo: r.justificativa,
          dados: retrato(x),
        },
      };
      return { versao: r.versao + 1 };
    },
  };
}
