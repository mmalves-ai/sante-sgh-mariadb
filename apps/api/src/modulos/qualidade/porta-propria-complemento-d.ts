// Complemento D da porta PRÓPRIA da gestão da qualidade (modulos-proprios-2, família qualidade-d): as leituras da
// segunda metade (ordem alfabética) dos métodos que ainda falhavam fechados e que o modelo próprio já cobre, com o mesmo
// contrato da porta de memória (filtros, ordenação, teto e nulo para o inexistente). Classe auxiliar: a porta própria
// completa delega a ela (a ligação fica com o integrador).
// - Pesquisa de satisfação ligada à agenda (resposta_pesquisa_satisfacao com a marcação avaliada): as respostas do
//   período pelo dia do atendimento (`de` e `ate` inclusivos), com a agenda, a natureza (consulta ou exame), a nota de
//   recomendação e a manifestação aberta a partir dela; a resposta pelo id. A resposta anônima ou sem nota não entra
//   (o contrato exige o paciente e a nota). Teto de linhas: o excedente marca `cortada`, nunca erro nem corte mudo.
// - Versões anteriores de um registro corrigido: lidas da trilha_auditoria (dados.versaoAnterior gravado na operação
//   da correção), da mais nova para a mais antiga, como a CCIH faz; registro sem correção devolve lista vazia.
// - Protocolos gerenciados: as versões publicadas (do estabelecimento e as da rede) e as inclusões de pacientes do
//   período (`fim` exclusivo, pela hora da inclusão), com os critérios e os eventos (meta, checklist, encerramento).
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
import type { ContextoGestao } from './porta-gestao.js';
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
const TETO_VERSOES = 500;
const TETO_PROTOCOLOS = 2000;

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
      const r = await l.consultar(
        `SELECT t.ocorrido_em, u.login, JSON_EXTRACT(t.dados_depois, '$.dados.versaoAnterior') AS va
           FROM trilha_auditoria t LEFT JOIN usuario u ON u.id = t.usuario_id
          WHERE t.estabelecimento_id = ? AND ${campoVersao('tabela')} = ? AND ${campoVersao('id')} = ?
          ORDER BY t.id DESC`,
        [est, tabela, String(id)],
        { teto: TETO_VERSOES },
      );
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
      const vs = await l.consultar(
        `SELECT v.id, p.tipo, p.nome, v.numero_versao, v.motivo, v.dados, v.vigencia_inicio, ua.login AS autor
           FROM protocolo_gerenciado_versao v JOIN protocolo_gerenciado p ON p.id = v.protocolo_gerenciado_id
           LEFT JOIN usuario ua ON ua.id = v.usuario_id
          WHERE (p.estabelecimento_id = ? OR p.estabelecimento_id IS NULL) AND p.excluido_em IS NULL
          ORDER BY v.id DESC`,
        [est],
        { teto: TETO_PROTOCOLOS },
      );
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
      const ps = await l.consultar(
        `SELECT i.id, i.atendimento_id, i.paciente_id, i.protocolo_gerenciado_id, i.forma_inclusao, i.horario_zero_em,
                i.criado_em, pg.tipo, ui.login AS incluido_por
           FROM inclusao_protocolo_paciente i JOIN protocolo_gerenciado pg ON pg.id = i.protocolo_gerenciado_id
           LEFT JOIN usuario ui ON ui.id = i.criado_por
          WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.criado_em >= ? AND i.criado_em < ?
          ORDER BY i.criado_em, i.id`,
        [est, paraBanco(inicio), paraBanco(fim)],
        { teto: TETO_PROTOCOLOS },
      );
      if (ps.length === 0) return { versoes, protocolos: [] };
      const ids = ps.map((x) => n(x['id']));
      const criterios = await l.consultar(
        `SELECT inclusao_protocolo_paciente_id, identificador FROM inclusao_protocolo_criterio
          WHERE inclusao_protocolo_paciente_id IN (${marcas(ids.length)}) AND excluido_em IS NULL
          ORDER BY inclusao_protocolo_paciente_id, sequencia`,
        ids,
        { teto: TETO_PROTOCOLOS * 10 },
      );
      const registros = await l.consultar(
        `SELECT r.id, r.inclusao_protocolo_paciente_id, r.tipo, r.codigo, r.situacao, r.ocorrido_em, r.prazo_em,
                r.motivo, r.criado_em, u.login
           FROM inclusao_protocolo_registro r LEFT JOIN usuario u ON u.id = r.usuario_id
          WHERE r.inclusao_protocolo_paciente_id IN (${marcas(ids.length)}) AND r.excluido_em IS NULL
          ORDER BY r.inclusao_protocolo_paciente_id, r.id`,
        ids,
        { teto: TETO_PROTOCOLOS * 10 },
      );
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
