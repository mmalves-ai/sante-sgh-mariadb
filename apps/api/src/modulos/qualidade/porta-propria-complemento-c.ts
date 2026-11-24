// Complemento da porta PRÓPRIA da segurança do paciente (modulos-proprios-2, família qualidade-c): as leituras que vêm
// de outros módulos pelo banco do cliente, antes recusadas com 503 `modelo-pendente`.
//
// - candidatos: as origens de sugestão de notificação registradas pelo login desde o instante: o horário marcado como
//   não administrado (evento `nao_administrado` do horário, com o código do motivo), a reação transfusional que ele
//   registrou, o checklist de cirurgia segura dispensado por urgência (a exceção) e a avaliação de LPP finalizada e
//   vigente. A regra (dominio-qualidade, sugestao.ts) decide o que vira sugestão.
// - painelAdesao: as contagens do período: checagens (com a leitura à beira do leito, que confere a pulseira), checklists
//   de cirurgia segura (concluídos e com a pausa antes da incisão) e as reavaliações de Morse e Braden devidas e
//   cumpridas no prazo (as dispensadas fora; a pendente só conta depois de vencido o prazo).
// - protocolosGerenciados: as versões publicadas e as inclusões do período, pela leitura da classificação de risco
//   (recepção), que é a dona dos protocolos gerenciados.
// - expostos: os pacientes expostos ao item e ao lote pelo rastreio reverso da OPME (suprimentos): as saídas do lote no
//   estoque; sem saída, os consumos em sala.
// - historicoRiscos: continua 503 `modelo-pendente`. O histórico era a contagem por ano de um formulário de
//   gerenciamento de riscos descontinuado; no modelo próprio o registro existe (registro_assistencial), mas nada marca
//   qual modelo de documento é esse formulário, e fixar o código de um hospital no produto é proibido (ADR 0002). Pede a
//   decisão de um marcador do modelo (parâmetro do cliente ou finalidade do modelo de documento).
//
// Ligação (integrador): a PortaQualidadePropria delega os cinco métodos a esta classe (texto exato no relatório).
import type { EstagioLpp } from '@sgh/contratos';
import { ESTAGIOS_LPP } from '@sgh/contratos';
import type { ContextoClassificacao } from '../recepcao/classificacao-porta.js';
import { PortaClassificacaoPropria } from '../recepcao/classificacao-porta-propria.js';
import type { NucleoRecepcao } from '../recepcao/porta-propria.js';
import { PortaOpmePropria } from '../suprimentos/opme-porta-propria.js';
import {
  instante,
  type L,
  leituraPendente,
  lerNoEstabelecimento,
  n,
  nn,
  type NucleoQualidade,
  paraBanco,
  texto,
  textoN,
  usuarioPeloLogin,
  verdadeiro,
} from './apoio-propria.js';
import type { CandidatosSugestao, ContagensAdesaoLidas, ContextoQualidade } from './porta.js';
import type { ProtocoloDoPaciente, VersaoProtocoloGerenciado } from './tipos.js';

/** Teto de cada fonte de candidatos (o mesmo do legado: a regra corta em `TETO_SUGESTOES_POR_FONTE`). */
export const TETO_CANDIDATOS = 200;

const HISTORICO_RISCOS =
  'O histórico do formulário de gerenciamento de riscos assistenciais (nenhum marcador do modelo de documento no banco)';

const ESTAGIOS = new Set<string>(ESTAGIOS_LPP);
const estagioLpp = (v: unknown): EstagioLpp | null => {
  const s = textoN(v);
  return s !== null && ESTAGIOS.has(s) ? (s as EstagioLpp) : null;
};

/** A escala de risco pelo código ou pela sigla da escala clínica (só Morse e Braden entram no painel). */
const SQL_ESCALA = `CASE WHEN LOWER(CONCAT(e.codigo, ' ', COALESCE(e.sigla, ''))) LIKE '%morse%' THEN 'morse'
                        WHEN LOWER(CONCAT(e.codigo, ' ', COALESCE(e.sigla, ''))) LIKE '%braden%' THEN 'braden'
                        ELSE NULL END`;

/** O núcleo do cliente: a leitura da qualidade e a da classificação (que pede o núcleo da recepção inteiro). */
export type NucleoComplementoC = NucleoQualidade & NucleoRecepcao;

export class ComplementoQualidadeC {
  constructor(private readonly nucleo: NucleoComplementoC) {}

  private ler<T>(c: ContextoQualidade, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, c, fn);
  }

  /** Os candidatos à sugestão automática registrados pelo login desde o instante (das mais recentes às mais antigas). */
  candidatos(c: ContextoQualidade, login: string, desde: string): Promise<CandidatosSugestao> {
    return this.ler(c, async (l, est) => {
      const usuario = await usuarioPeloLogin(l, login);
      if (usuario === null) return { checagens: [], reacoes: [], checklists: [], horarios: [], lesoes: [] };
      const d = paraBanco(desde);
      const p = { teto: TETO_CANDIDATOS };
      const checagens = await l.consultar(
        `SELECT ev.id, ev.motivo AS texto_motivo, mna.codigo AS motivo, ev.ocorrido_em, h.atendimento_id
           FROM horario_administracao_evento ev
           JOIN horario_administracao h ON h.id = ev.horario_administracao_id
           LEFT JOIN motivo_nao_administracao mna ON mna.id = ev.motivo_nao_administracao_id
          WHERE h.estabelecimento_id = ? AND ev.evento = 'nao_administrado' AND ev.operacao <> 'exclusao'
            AND ev.usuario_id = ? AND ev.ocorrido_em >= ?
          ORDER BY ev.ocorrido_em DESC, ev.id DESC LIMIT ${TETO_CANDIDATOS}`,
        [est, usuario, d],
        p,
      );
      const reacoes = await l.consultar(
        `SELECT r.id, r.inicio_em, r.grau, r.notificacao_enviada_em, r.notificacao_incidente_id
           FROM reacao_transfusional r
          WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.registrado_por_usuario_id = ?
            AND r.inicio_em >= ?
          ORDER BY r.inicio_em DESC, r.id DESC LIMIT ${TETO_CANDIDATOS}`,
        [est, usuario, d],
        p,
      );
      // A exceção do checklist é a dispensa por urgência; quem a registrou é o último a gravar o checklist.
      const checklists = await l.consultar(
        `SELECT k.id, COALESCE(k.alterado_em, k.criado_em) AS excecao_em
           FROM checklist_cirurgia_segura k
           JOIN ato_cirurgico a ON a.id = k.ato_cirurgico_id
          WHERE a.estabelecimento_id = ? AND k.excluido_em IS NULL AND k.dispensado_urgencia = TRUE
            AND COALESCE(k.alterado_por, k.criado_por) = ? AND COALESCE(k.alterado_em, k.criado_em) >= ?
          ORDER BY excecao_em DESC, k.id DESC LIMIT ${TETO_CANDIDATOS}`,
        [est, usuario, d],
        p,
      );
      // A LPP com a avaliação vigente finalizada pelo login; a lesão excluída conta como inativada (a regra descarta).
      const lesoes = await l.consultar(
        `SELECT lp.id, COALESCE(ea.codigo, el.codigo) AS estagio, lp.presente_na_admissao, lp.identificada_em,
                lp.atendimento_id, (lp.excluido_em IS NOT NULL) AS inativada
           FROM lesao_pele_avaliacao av
           JOIN lesao_pele_paciente lp ON lp.id = av.lesao_pele_paciente_id
           JOIN tipo_lesao_pele t ON t.id = lp.tipo_lesao_pele_id AND t.categoria = 'lesao_pressao'
           LEFT JOIN estagio_lesao_pele ea ON ea.id = av.estagio_lesao_pele_id
           LEFT JOIN estagio_lesao_pele el ON el.id = lp.estagio_lesao_pele_id
          WHERE lp.estabelecimento_id = ? AND av.finalizada = TRUE AND av.vigente = TRUE AND av.excluido_em IS NULL
            AND av.criado_por = ? AND av.criado_em >= ?
          ORDER BY av.criado_em DESC, av.id DESC LIMIT ${TETO_CANDIDATOS}`,
        [est, usuario, d],
        p,
      );
      return {
        checagens: checagens.map((x) => ({
          id: n(x['id']),
          // O evento `nao_administrado` é a situação "não administrado" da checagem (a regra só olha esta).
          situacao: 'N',
          motivo: textoN(x['motivo']),
          avisos: null,
          horaReal: instante(x['ocorrido_em']),
          atendimento: nn(x['atendimento_id']),
        })),
        reacoes: reacoes.map((x) => ({
          id: n(x['id']),
          inicioEm: instante(x['inicio_em']),
          grau: n(x['grau']),
          enviada: x['notificacao_enviada_em'] != null || x['notificacao_incidente_id'] != null,
        })),
        checklists: checklists.map((x) => ({ id: n(x['id']), excecaoEm: instante(x['excecao_em']) })),
        // No modelo próprio todo horário não administrado tem o registro da checagem (vai em `checagens`).
        horarios: [],
        lesoes: lesoes.map((x) => ({
          id: n(x['id']),
          estagio: estagioLpp(x['estagio']),
          presenteNaAdmissao: verdadeiro(x['presente_na_admissao']),
          inativada: verdadeiro(x['inativada']),
          identificadaEm: instante(x['identificada_em']),
          atendimento: nn(x['atendimento_id']),
        })),
      };
    });
  }

  /** As contagens de adesão do período [de, fimExclusivo) no estabelecimento da sessão. */
  painelAdesao(c: ContextoQualidade, de: string, fimExclusivo: string, agora: string): Promise<ContagensAdesaoLidas> {
    const ini = `${de.slice(0, 10)} 00:00:00`;
    const fim = `${fimExclusivo.slice(0, 10)} 00:00:00`;
    const ag = paraBanco(agora);
    return this.ler(c, async (l, est) => {
      const ch = await l.uma(
        `SELECT COUNT(*) AS total, COALESCE(SUM(ev.canal_registro = 'beira_leito'), 0) AS pulseira
           FROM horario_administracao_evento ev
           JOIN horario_administracao h ON h.id = ev.horario_administracao_id
          WHERE h.estabelecimento_id = ? AND ev.evento = 'checagem' AND ev.operacao <> 'exclusao'
            AND ev.ocorrido_em >= ? AND ev.ocorrido_em < ?`,
        [est, ini, fim],
      );
      const k = await l.uma(
        `SELECT COUNT(*) AS total, COALESCE(SUM(k.situacao = 'concluido'), 0) AS concluidos,
                COALESCE(SUM(k.incisao_concluida_em IS NOT NULL), 0) AS pausa
           FROM checklist_cirurgia_segura k
           JOIN ato_cirurgico a ON a.id = k.ato_cirurgico_id
          WHERE a.estabelecimento_id = ? AND k.excluido_em IS NULL
            AND k.criado_em >= ? AND k.criado_em < ? AND k.criado_em < ?`,
        [est, ini, fim, ag],
      );
      const rs = await l.consultar(
        `SELECT x.escala, COUNT(*) AS devidas, COALESCE(SUM(x.no_prazo), 0) AS cumpridas
           FROM (SELECT ${SQL_ESCALA} AS escala,
                        (r.situacao = 'cumprida' AND r.cumprida_em <= r.prazo_em) AS no_prazo
                   FROM reavaliacao_escala r JOIN escala_clinica e ON e.id = r.escala_clinica_id
                  WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.situacao <> 'dispensada'
                    AND r.devida_em >= ? AND r.devida_em < ? AND (r.situacao = 'cumprida' OR r.prazo_em < ?)) x
          WHERE x.escala IS NOT NULL
          GROUP BY x.escala ORDER BY x.escala`,
        [est, ini, fim, ag],
        { teto: 10 },
      );
      return {
        checagens: n(ch?.['total']),
        checagensComPulseira: n(ch?.['pulseira']),
        checklists: n(k?.['total']),
        checklistsConcluidos: n(k?.['concluidos']),
        checklistsComPausa: n(k?.['pausa']),
        reavaliacoes: rs.map((x) => ({
          escala: texto(x['escala']) as 'morse' | 'braden',
          devidas: n(x['devidas']),
          cumpridasNoPrazo: n(x['cumpridas']),
        })),
      };
    });
  }

  /** Ver o cabeçalho: sem o marcador do modelo do formulário, falha fechada (nunca zero). */
  historicoRiscos(_c: ContextoQualidade): Promise<{ ano: number; registros: number }[]> {
    void _c;
    return Promise.reject(leituraPendente(HISTORICO_RISCOS));
  }

  /** As versões publicadas dos protocolos gerenciados e as inclusões do período (a leitura da classificação). */
  async protocolosGerenciados(
    c: ContextoQualidade,
    inicio: string,
    fim: string,
  ): Promise<{ versoes: VersaoProtocoloGerenciado[]; protocolos: ProtocoloDoPaciente[] }> {
    const codigo = await this.ler(c, async (l, est) =>
      texto((await l.uma('SELECT codigo FROM estabelecimento WHERE id = ?', [est]))?.['codigo']),
    );
    const classificacao = new PortaClassificacaoPropria(this.nucleo, this.nucleo.criarExecutor(), c.cliente);
    const cc: ContextoClassificacao = { rede: '', hospital: codigo };
    const versoes = await classificacao.versoesGerenciadas(cc);
    const protocolos = await classificacao.protocolosDoPeriodo(cc, inicio, fim);
    return { versoes, protocolos } as {
      versoes: VersaoProtocoloGerenciado[];
      protocolos: ProtocoloDoPaciente[];
    };
  }

  /** Os expostos ao lote (as saídas do lote no estoque; sem saída, os consumos em sala). */
  async expostos(
    c: ContextoQualidade,
    item: number,
    lote: string,
  ): Promise<{
    itemNome: string | null;
    expostos: { origem: 'consumo-em-sala' | 'estoque'; data: string | null; atendimento: number; paciente: number | null; quantidade: number }[];
    cortada: boolean;
  }> {
    const r = await new PortaOpmePropria(this.nucleo).rastreioReverso(c, {
      item,
      lote,
      serie: null,
      registroAnvisa: null,
    });
    const expostos =
      r.saidasEstoque.length > 0
        ? r.saidasEstoque.map((x) => ({
            origem: x.origem,
            data: x.data,
            atendimento: x.atendimento,
            paciente: x.paciente,
            quantidade: x.quantidade,
          }))
        : r.expostos.map((x) => ({
            origem: 'consumo-em-sala' as const,
            data: x.dataHora ? x.dataHora.slice(0, 10) : null,
            atendimento: x.atendimento,
            paciente: x.paciente,
            quantidade: x.quantidade,
          }));
    return { itemNome: r.itemNome, expostos, cortada: r.cortada };
  }
}
