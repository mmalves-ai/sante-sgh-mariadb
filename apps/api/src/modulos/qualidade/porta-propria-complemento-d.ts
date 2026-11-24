// Complemento D da porta PRÓPRIA da gestão da qualidade (modulos-proprios-2, família qualidade-d): as leituras da
// segunda metade (ordem alfabética) dos métodos que ainda falhavam fechados e que o modelo próprio já cobre, com o mesmo
// contrato da porta de memória (filtros, ordenação, teto e nulo para o inexistente). Classe auxiliar: a porta própria
// completa delega a ela (a ligação fica com o integrador).
// - Pesquisa de satisfação ligada à agenda (resposta_pesquisa_satisfacao com a marcação avaliada): as respostas do
//   período pelo dia do atendimento (`de` e `ate` inclusivos), com a agenda, a natureza (consulta ou exame), a nota de
//   recomendação e a manifestação aberta a partir dela; a resposta pelo id. A resposta anônima ou sem nota não entra
//   (o contrato exige o paciente e a nota). Teto de linhas: o excedente marca `cortada`, nunca erro nem corte mudo.
// - Versões anteriores de um registro corrigido: lidas da trilha_auditoria (dados.versaoAnterior), da mais nova para a
//   mais antiga, como a CCIH faz; registro sem correção devolve lista vazia. Quem grava a versão anterior é o
//   `comVersoesAnteriores` abaixo: embrulha o gravador da gestão e, na correção e no cancelamento da manifestação, lê a
//   linha antes do UPDATE (travada, SELECT ... FOR UPDATE) e a põe na anotação da trilha da mesma operação (histórico só de acréscimo; a
//   memória faz o mesmo com `versionar`). A ligação no gravarSgh da porta completa é do integrador.
// - Protocolos gerenciados: as versões publicadas (do estabelecimento e as da rede) e as inclusões de pacientes do
//   período (`fim` exclusivo, pela hora da inclusão), com os critérios e os eventos (meta, checklist, encerramento).
//   O contrato não tem marca de corte e a memória não tem teto: as leituras vão em páginas pela chave (id), sem teto
//   que vire erro nem corte mudo; o mesmo vale para as versões da trilha.
import type { TxOperacao } from '@sgh/nucleo';
import type { AnotacaoGravacao } from '../enfermagem/gravacao-direta.js';
import type { L, Linha, NucleoQualidade } from './apoio-propria.js';
import {
  dataIso,
  instante,
  instanteN,
  json,
  lerNoEstabelecimento,
  marcas,
  n,
  nn,
  paraBanco,
  texto,
  textoN,
} from './apoio-propria.js';
import type { ContextoGestao, GravadorGestao, MudancaGestao } from './porta-gestao.js';
import type {
  AcaoVersao,
  PesquisaSatisfacaoRespondida,
  ProtocoloDoPaciente,
  TabelaCorrigivel,
  VersaoProtocoloGerenciado,
  VersaoRegistro,
} from './tipos.js';
import { tipoGerenciadoDoBanco } from '../recepcao/classificacao-operacoes.js';
import { impressaoGerenciado } from '../recepcao/protocolo-gerenciado-servico.js';

/** Os métodos da porta da gestão que este complemento cobre (a ligação na porta completa é do integrador). */
export const METODOS_COMPLEMENTO_D = ['pesquisas', 'pesquisa', 'versoes', 'protocolosGerenciados'] as const;

/** Teto das respostas de pesquisa por período (o excedente marca `cortada`). */
export const TETO_PESQUISAS = 5000;
/** Linhas por página nas leituras sem teto no contrato (versões e protocolos). */
export const PAGINA_LEITURA = 1000;

/**
 * Lê todas as páginas de uma consulta ordenada pela chave `id` (crescente ou decrescente): `montar` recebe o último id
 * lido (nulo na primeira página) e devolve o SQL com o filtro da chave, a ordem e o `LIMIT` da página.
 */
async function todasAsPaginas(
  l: L,
  montar: (apos: number | null) => readonly [string, readonly unknown[]],
  pagina = PAGINA_LEITURA,
): Promise<Linha[]> {
  const todas: Linha[] = [];
  let apos: number | null = null;
  for (;;) {
    const [sql, params] = montar(apos);
    const r = await l.consultar(`${sql} LIMIT ${pagina}`, params, { teto: pagina });
    todas.push(...r);
    if (r.length < pagina) return todas;
    apos = n(r[r.length - 1]?.['id']);
  }
}

// ── Pesquisa de satisfação ──────────────────────────────────────────────────────────────────────────────────────

const SQL_PESQUISA = `
  SELECT r.id, r.paciente_id, r.nota_recomendacao, r.comentario, r.respondida_em, r.manifestacao_ouvidoria_id,
         ca.natureza, a.nome AS nome_agenda, h.data_referencia
    FROM resposta_pesquisa_satisfacao r
    JOIN marcacao_horario m ON m.id = r.marcacao_horario_id
    JOIN horario_agenda h ON h.id = m.horario_agenda_id
    JOIN agenda_servico a ON a.id = h.agenda_servico_id
    JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL
     AND r.paciente_id IS NOT NULL AND r.nota_recomendacao IS NOT NULL`;

/** A natureza da agenda no vocabulário da pesquisa (exame ou consulta, como o portal grava). */
const tipoDaNatureza = (v: unknown): string => (texto(v) === 'exame' ? 'exame' : 'consulta');

function pesquisaDaLinha(r: Linha): PesquisaSatisfacaoRespondida {
  return {
    id: n(r['id']),
    paciente: n(r['paciente_id']),
    tipo: tipoDaNatureza(r['natureza']),
    agenda: texto(r['nome_agenda']),
    dataAtendimento: dataIso(r['data_referencia']) ?? '',
    nota: n(r['nota_recomendacao']),
    comentario: textoN(r['comentario']),
    respondidaEm: instante(r['respondida_em']),
    manifestacao: nn(r['manifestacao_ouvidoria_id']),
  };
}

// ── Versões anteriores ──────────────────────────────────────────────────────────────────────────────────────────

const campoVersao = (campo: string) => `JSON_VALUE(t.dados_depois, '$.dados.versaoAnterior.${campo}')`;

/** A linha como estava (datas no formato local), para a versão anterior na trilha (como a CCIH). */
function retrato(r: Linha): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? instante(v) : v]));
}

/**
 * Embrulha o gravador da gestão para guardar a versão anterior na trilha da operação: na correção e no cancelamento
 * da manifestação, a linha é lida (travada, do estabelecimento) antes do UPDATE e, se a gravação passar, vai a
 * `anotacao.dados.versaoAnterior` = { tabela, id, versao, acao, motivo, dados }, que `versoes` lê. Se a gravação
 * recusar, nada é anotado (e a transação desfaz).
 */
export function comVersoesAnteriores(
  base: GravadorGestao,
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao,
): GravadorGestao {
  const versionado =
    <M extends MudancaGestao>(
      tabela: TabelaCorrigivel,
      acao: AcaoVersao,
      fn: (m: M) => Promise<{ versao: number }>,
    ) =>
    async (m: M): Promise<{ versao: number }> => {
      const [antes] = await tx.consultarParaAtualizar<Linha>(
        `SELECT * FROM ${tabela} WHERE id = ? AND estabelecimento_id = ?`,
        [m.id, est],
      );
      const feito = await fn(m);
      if (antes) {
        const motivo = m.justificativa;
        anotacao.motivo = motivo;
        anotacao.dados = {
          ...(anotacao.dados ?? {}),
          versaoAnterior: {
            tabela,
            id: n(antes['id']),
            versao: n(antes['versao']),
            acao,
            motivo,
            dados: retrato(antes),
          },
        };
      }
      return feito;
    };
  return {
    ...base,
    corrigirManifestacao: versionado('manifestacao_ouvidoria', 'correcao', (m) =>
      base.corrigirManifestacao(m),
    ),
    cancelarManifestacao: versionado('manifestacao_ouvidoria', 'cancelamento', (m) =>
      base.cancelarManifestacao(m),
    ),
  };
}

// ── Protocolos gerenciados ──────────────────────────────────────────────────────────────────────────────────────

/** A forma da inclusão no vocabulário do contrato (o alerta automático é a sugestão; o resto, a equipe). */
const origemDaInclusao = (forma: string): ProtocoloDoPaciente['origem'] =>
  forma === 'alerta_automatico' ? 'sugerido' : forma === 'prescricao' ? 'medico' : 'enfermeiro';

export class LeiturasGestaoComplementoD {
  constructor(private readonly nucleo: NucleoQualidade) {}

  private ler<T>(c: ContextoGestao, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, c, fn);
  }

  /** As respostas do período pelo dia do atendimento (`de` e `ate` inclusivos, AAAA-MM-DD). */
  pesquisas(
    c: ContextoGestao,
    de: string,
    ate: string,
  ): Promise<{ itens: PesquisaSatisfacaoRespondida[]; cortada: boolean }> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `${SQL_PESQUISA} AND h.data_referencia >= ? AND h.data_referencia <= ?
          ORDER BY h.data_referencia, r.id LIMIT ${TETO_PESQUISAS + 1}`,
        [est, de.slice(0, 10), ate.slice(0, 10)],
        { teto: TETO_PESQUISAS + 1 },
      );
      return { itens: r.slice(0, TETO_PESQUISAS).map(pesquisaDaLinha), cortada: r.length > TETO_PESQUISAS };
    });
  }

  /** A resposta pelo id no estabelecimento da sessão (nulo quando não existe ou não é da agenda). */
  pesquisa(c: ContextoGestao, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_PESQUISA} AND r.id = ?`, [est, id]);
      if (!r) return null;
      const p = pesquisaDaLinha(r);
      return {
        id: p.id,
        paciente: p.paciente,
        nota: p.nota,
        comentario: p.comentario,
        respondidaEm: p.respondidaEm,
      };
    });
  }

  /** As versões anteriores do registro (da trilha), da mais nova para a mais antiga. */
  versoes(c: ContextoGestao, tabela: TabelaCorrigivel, id: number): Promise<VersaoRegistro[]> {
    return this.ler(c, async (l, est) => {
      const r = await todasAsPaginas(l, (apos) => [
        `SELECT t.id, t.ocorrido_em, u.login, JSON_EXTRACT(t.dados_depois, '$.dados.versaoAnterior') AS va
           FROM trilha_auditoria t LEFT JOIN usuario u ON u.id = t.usuario_id
          WHERE t.estabelecimento_id = ? AND ${campoVersao('tabela')} = ? AND ${campoVersao('id')} = ?
            ${apos === null ? '' : 'AND t.id < ?'}
          ORDER BY t.id DESC`,
        apos === null ? [est, tabela, String(id)] : [est, tabela, String(id), apos],
      ]);
      return r.map((x) => {
        const va = json<{
          versao?: number;
          acao?: AcaoVersao;
          motivo?: string;
          dados?: Record<string, unknown>;
        }>(x['va'], {});
        return {
          versao: n(va.versao),
          acao: va.acao ?? 'correcao',
          motivo: texto(va.motivo),
          alteradoPor: texto(x['login']),
          alteradoEm: instante(x['ocorrido_em']),
          dados: va.dados ?? {},
        };
      });
    });
  }

  /** As versões publicadas dos protocolos gerenciados e as inclusões do período (`fim` exclusivo). */
  protocolosGerenciados(
    c: ContextoGestao,
    inicio: string,
    fim: string,
  ): Promise<{ versoes: VersaoProtocoloGerenciado[]; protocolos: ProtocoloDoPaciente[] }> {
    return this.ler(c, async (l, est) => {
      const vs = await todasAsPaginas(l, (apos) => [
        `SELECT v.id, p.tipo, p.nome, v.numero_versao, v.motivo, v.dados, v.vigencia_inicio, ua.login AS autor
           FROM protocolo_gerenciado_versao v JOIN protocolo_gerenciado p ON p.id = v.protocolo_gerenciado_id
           LEFT JOIN usuario ua ON ua.id = v.usuario_id
          WHERE (p.estabelecimento_id = ? OR p.estabelecimento_id IS NULL) AND p.excluido_em IS NULL
            ${apos === null ? '' : 'AND v.id < ?'}
          ORDER BY v.id DESC`,
        apos === null ? [est] : [est, apos],
      ]);
      const versoes = vs.map((x): VersaoProtocoloGerenciado => {
        const conteudo = json<unknown>(x['dados'], {});
        return {
          id: n(x['id']),
          tipo: tipoGerenciadoDoBanco(texto(x['tipo'])),
          versao: n(x['numero_versao']),
          nome: texto(x['nome']),
          notas: texto(x['motivo']),
          autor: texto(x['autor']),
          aprovador: texto(x['autor']),
          publicadoEm: instante(x['vigencia_inicio']),
          impressao: impressaoGerenciado(conteudo as never),
          conteudo,
        };
      });
      const periodo = [est, paraBanco(inicio), paraBanco(fim)];
      const ps = await todasAsPaginas(l, (apos) => [
        `SELECT i.id, i.atendimento_id, i.paciente_id, i.protocolo_gerenciado_id, i.forma_inclusao, i.horario_zero_em,
                i.criado_em, pg.tipo, ui.login AS incluido_por
           FROM inclusao_protocolo_paciente i JOIN protocolo_gerenciado pg ON pg.id = i.protocolo_gerenciado_id
           LEFT JOIN usuario ui ON ui.id = i.criado_por
          WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.criado_em >= ? AND i.criado_em < ?
            ${apos === null ? '' : 'AND i.id > ?'}
          ORDER BY i.id`,
        apos === null ? periodo : [...periodo, apos],
      ]);
      if (ps.length === 0) return { versoes, protocolos: [] };
      // A ordem do contrato é a da hora da inclusão (empate pelo id); as páginas vêm pela chave.
      ps.sort(
        (a, b) => instante(a['criado_em']).localeCompare(instante(b['criado_em'])) || n(a['id']) - n(b['id']),
      );
      const criterios: Linha[] = [];
      const registros: Linha[] = [];
      // Os critérios e os eventos por lote de inclusões (o IN fica do tamanho da página), também em páginas.
      for (let k = 0; k < ps.length; k += PAGINA_LEITURA) {
        const ids = ps.slice(k, k + PAGINA_LEITURA).map((x) => n(x['id']));
        criterios.push(
          ...(await todasAsPaginas(l, (apos) => [
            `SELECT id, inclusao_protocolo_paciente_id, sequencia, identificador FROM inclusao_protocolo_criterio
              WHERE inclusao_protocolo_paciente_id IN (${marcas(ids.length)}) AND excluido_em IS NULL
                ${apos === null ? '' : 'AND id > ?'}
              ORDER BY id`,
            apos === null ? ids : [...ids, apos],
          ])),
        );
        registros.push(
          ...(await todasAsPaginas(l, (apos) => [
            `SELECT r.id, r.inclusao_protocolo_paciente_id, r.tipo, r.codigo, r.situacao, r.ocorrido_em, r.prazo_em,
                    r.motivo, r.criado_em, u.login
               FROM inclusao_protocolo_registro r LEFT JOIN usuario u ON u.id = r.usuario_id
              WHERE r.inclusao_protocolo_paciente_id IN (${marcas(ids.length)}) AND r.excluido_em IS NULL
                ${apos === null ? '' : 'AND r.id > ?'}
              ORDER BY r.id`,
            apos === null ? ids : [...ids, apos],
          ])),
        );
      }
      criterios.sort((a, b) => n(a['sequencia']) - n(b['sequencia']));
      const protocolos = ps.map((x): ProtocoloDoPaciente => {
        const id = n(x['id']);
        return {
          id,
          cabecalho: String(n(x['atendimento_id'])),
          reg: n(x['atendimento_id']),
          paciente: n(x['paciente_id']),
          tipo: tipoGerenciadoDoBanco(texto(x['tipo'])),
          gerenciado: n(x['protocolo_gerenciado_id']),
          origem: origemDaInclusao(texto(x['forma_inclusao'])),
          sugeridoPor: null,
          criterios: criterios
            .filter((k) => n(k['inclusao_protocolo_paciente_id']) === id)
            .map((k) => texto(k['identificador'])),
          chegadaEm: instante(x['horario_zero_em']),
          incluidoEm: instante(x['criado_em']),
          incluidoPor: texto(x['incluido_por']),
          eventos: registros
            .filter((r) => n(r['inclusao_protocolo_paciente_id']) === id)
            .map((r) => ({
              id: n(r['id']),
              tipo: texto(r['tipo']) as 'meta' | 'checklist' | 'encerramento',
              codigo: texto(r['codigo']),
              situacao: texto(r['situacao']),
              quando: instanteN(r['ocorrido_em']),
              prazoEm: instanteN(r['prazo_em']),
              motivo: textoN(r['motivo']),
              por: texto(r['login']),
              em: instante(r['criado_em']),
            })),
        };
      });
      return { versoes, protocolos };
    });
  }
}
