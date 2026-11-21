// Porta da agência transfusional, etapa 1 (M47), sobre o banco do cliente pelo @sgh/nucleo. Leituras somente leitura
// (prescricao_item_hemocomponente com o item e a prescrição vigente, horario_administracao, paciente, termo de
// consentimento, requisicao_transfusao e o item, amostra_pre_transfusional, ato_transfusional com o
// monitoramento_transfusao e a bolsa_hemocomponente, reacao_transfusional); toda gravação é uma operação do Executor
// (trilha, outbox e idempotência pela chave do pedido na mesma transação). Toda leitura filtra o estabelecimento da
// sessão e os registros excluídos; os catálogos (hemocomponente, tipo de transfusão, tipo de reação) são da rede.
// Melhoria: a bolsa transfundida tem de estar no estoque da agência (bolsa_hemocomponente), com a tipagem conferida
// contra a digitada; os profissionais do ato saem do vínculo da conta (o segundo profissional por login) e o banco
// recusa executor igual ao conferente (CHECK); o prazo da requisição sai do tipo de transfusão (não é digitado); a
// repetição do pedido é reconhecida pela idempotência do núcleo (sem coluna de chave em cada tabela).
// Melhoria: urgência, situação, destino da bolsa e anamnese transfusional em vocabulário de negócio (sem os ids de
// tipo do sistema de origem no banco: os ids 1 a 4 da tela viram o código do tipo de transfusão).
// Melhoria: a bolsa reservada pela agência só é transfundida na requisição para a qual foi reservada, e a bolsa vencida
// no estoque é recusada (além da validade digitada); o horário pendente do hemocomponente é checado (administrado, com o
// evento do horário) na mesma operação do início do ato; a bolsa devolvida ou descartada pela reação fica com esse
// destino (não "transfundida"); o volume transfundido entra como ganho no balanço hídrico da janela na mesma transação.
// Melhoria: os atestados de segurança (etiqueta do receptor, inspeção visual, identificadores e rótulo da amostra) são
// gravados como a tela informou (sem informação: falso, o padrão do banco), nunca afirmados pela porta.
// Melhoria: a linha da trilha da tela (evento auditável, recurso, paciente, estação) vai na trilha da operação, mesmo
// quando montada pelo resultado; o bloqueio da transfusão (regra 11) grava a trilha numa operação sem escrita.
// Pendências de modelo (pedidos do lote 02-05): as versões anteriores da requisição alterada e o adendo dos sinais do
// ato (alterar e adendo respondem 409 modelo-pendente; as leituras devolvem vazio); os alertas da dupla checagem vão à
// trilha da operação (sem coluna no ato).
import { randomUUID } from 'node:crypto';
import {
  type AdendoAtoLido,
  type AtoTransfusionalLido,
  type CondutaReacao,
  type CorrelacaoReacao,
  classeDoHemocomponente,
  type DestinoBolsaReacao,
  type EstadoAtoTransfusional,
  type EstadoRequisicaoTransfusao,
  fatorRhPorId,
  type FatorRh,
  type GrauReacao,
  type GrupoAbo,
  grupoAboPorId,
  HEMOCOMPONENTES_VISTOS,
  type ItemHemoterapiaAAtender,
  type MomentoSinaisTransfusao,
  type ReacaoTransfusionalLida,
  type RequisicaoTransfusionalLida,
  type SinaisRegistrados,
  type SinaisTransfusao,
  type TipagemSanguinea,
  type TipoReacaoTransfusional,
  URGENCIAS_TRANSFUSAO,
  type UrgenciaTransfusao,
  urgenciaPorId,
  type VersaoRequisicaoLida,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import {
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../exames/public-api.js';
import {
  booleano,
  civilDe,
  dataDe,
  estabelecimentoDe,
  exigirProfissional,
  fusoDe,
  instanteDe,
  type Linha,
  LOGIN_DE,
  LOGIN_DO_PROFISSIONAL,
  marcadores,
  num,
  numOuNulo,
  profissionalDoLogin,
  texto,
  textoOuNulo,
} from './banco-apoio.js';
import {
  type ContextoTransfusao,
  type FiltroRequisicoesPorta,
  type GravadorTransfusao,
  METODOS_PORTA_TRANSFUSAO,
  type PortaTransfusao,
} from './transfusao-porta.js';
import type { HorarioHemoterapia, TermoConsentimentoLido } from './transfusao-tipos.js';
import { extrasDaTrilha, gravarSoTrilha, resolverTrilha, type TrilhaDaTela } from './trilha-da-tela.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoTransfusao = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export const TETO_REQUISICOES = 500;
export const TETO_ITENS_HEMOTERAPIA = 300;

/** Nomes das operações da porta (a idempotência e a trilha os guardam). */
export const OPERACOES_TRANSFUSAO = {
  requisitar: 'transfusao.requisitar',
  cancelar: 'transfusao.cancelar-requisicao',
  amostra: 'transfusao.registrar-amostra',
  iniciar: 'transfusao.iniciar',
  sinais: 'transfusao.registrar-sinais',
  concluir: 'transfusao.concluir',
  reacao: 'transfusao.registrar-reacao',
  notificada: 'transfusao.notificacao-enviada',
  trilha: 'transfusao.registrar-trilha',
} as const;

// ── Vocabulário: contrato das telas ↔ códigos do banco ────────────────────────────────────────────────────────

const ESTADO_REQUISICAO: Readonly<Record<string, EstadoRequisicaoTransfusao>> = {
  requisitada: 'requisitada',
  amostra_coletada: 'amostraColetada',
  em_atendimento: 'emAtendimento',
  atendida: 'atendida',
  cancelada: 'cancelada',
};
const SITUACAO_REQUISICAO: Readonly<Record<EstadoRequisicaoTransfusao, string>> = {
  requisitada: 'requisitada',
  amostraColetada: 'amostra_coletada',
  emAtendimento: 'em_atendimento',
  atendida: 'atendida',
  cancelada: 'cancelada',
};
const ESTADO_ATO: Readonly<Record<string, EstadoAtoTransfusional>> = {
  em_andamento: 'emCurso',
  concluido: 'concluido',
  interrompido: 'interrompido',
};
/** camelCase do contrato → snake_case do código no banco. */
export const codigoDoBanco = (c: string): string => c.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
/** snake_case do banco → camelCase do contrato. */
export const codigoDoContrato = (c: string): string => c.replace(/_([a-z])/g, (_m, l: string) => l.toUpperCase());

const RH_DO_SINAL: Readonly<Record<string, FatorRh>> = { '+': 'positivo', '-': 'negativo' };

const tipagemDe = (abo: unknown, rh: unknown): TipagemSanguinea => ({
  abo: (['A', 'B', 'AB', 'O'].includes(texto(abo)) ? texto(abo) : null) as GrupoAbo | null,
  rh: (texto(rh) === 'positivo' || texto(rh) === 'negativo' ? texto(rh) : (RH_DO_SINAL[texto(rh)] ?? null)) as
    | FatorRh
    | null,
});

/**
 * A situação do horário no vocabulário da grade da enfermagem (a mesma da porta da enfermagem: P pendente, A
 * administrado, N não administrado, S suspenso), pela categoria da situação de checagem do modelo.
 */
const SITUACAO_HORARIO: Readonly<Record<string, string>> = {
  pendente: 'P',
  atrasado: 'P',
  adiado: 'P',
  administrado: 'A',
  administrado_parcial: 'A',
  nao_administrado: 'N',
  recusado_paciente: 'N',
  suspenso: 'S',
};

const PACIENTE_SQL = `(SELECT COALESCE(NULLIF(pa.nome_social, ''), pf.nome) FROM paciente pa
   JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id WHERE pa.id = %s)`;
const nomeDoPaciente = (coluna: string) => PACIENTE_SQL.replace('%s', coluna);

const SQL_ITENS = `
  SELECT pi.id AS item, p.id AS prescricao, p.atendimento_id, p.paciente_id, pa.numero_prontuario,
         ${nomeDoPaciente('p.paciente_id')} AS nome, h.sigla, h.descricao AS hemocomponente_nome,
         pih.quantidade, up.sigla AS unidade, pih.indicacao_clinica, pih.iniciar_agora, p.prescrito_em,
         p.vigencia_fim_em, pi.situacao AS situacao_item, p.situacao AS situacao_prescricao,
         (SELECT COUNT(*) FROM horario_administracao ha
           WHERE ha.prescricao_item_id = pi.id AND ha.excluido_em IS NULL) AS horarios
    FROM prescricao_item_hemocomponente pih
    JOIN prescricao_item pi ON pi.id = pih.prescricao_item_id
    JOIN prescricao p ON p.id = pi.prescricao_id
    JOIN paciente pa ON pa.id = p.paciente_id
    JOIN hemocomponente h ON h.id = pih.hemocomponente_id
    LEFT JOIN unidade_prescricao up ON up.id = pih.unidade_prescricao_id
   WHERE p.estabelecimento_id = ? AND pih.excluido_em IS NULL AND pi.excluido_em IS NULL AND p.excluido_em IS NULL`;

const SQL_REQUISICOES = `
  SELECT r.id, r.atendimento_id, r.paciente_id, pa.numero_prontuario, ${nomeDoPaciente('r.paciente_id')} AS nome,
         pa.tipo_sanguineo, pa.fator_rh, r.situacao, r.programada_para, r.solicitado_em, r.indicacao, r.exames_apoio,
         r.termo_consentimento_paciente_id, r.justificativa_urgencia, r.transfusao_anterior, r.reacao_anterior,
         r.gestacao_anterior, r.observacao_cancelamento, r.criado_por, ${LOGIN_DE('r.criado_por')} AS login,
         tt.codigo AS urgencia, tt.prazo_atendimento_horas, ri.quantidade_bolsas, ri.volume_ml, ri.quantidade_atendida,
         h.sigla, h.descricao AS hemocomponente_nome, pih.prescricao_item_id AS item, pi.prescricao_id,
         (SELECT JSON_OBJECT('codigo', a.codigo_barras, 'coletada', a.coletada_em, 'valida', a.valida_ate)
            FROM amostra_pre_transfusional a
           WHERE a.requisicao_transfusao_id = r.id AND a.excluido_em IS NULL
           ORDER BY a.coletada_em DESC, a.id DESC LIMIT 1) AS amostra
    FROM requisicao_transfusao r
    JOIN paciente pa ON pa.id = r.paciente_id
    JOIN tipo_transfusao tt ON tt.id = r.tipo_transfusao_id
    JOIN requisicao_transfusao_item ri ON ri.requisicao_transfusao_id = r.id AND ri.sequencia = 1 AND ri.excluido_em IS NULL
    JOIN hemocomponente h ON h.id = ri.hemocomponente_id
    LEFT JOIN prescricao_item_hemocomponente pih ON pih.id = r.prescricao_item_hemocomponente_id
    LEFT JOIN prescricao_item pi ON pi.id = pih.prescricao_item_id
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL`;

const SQL_ATOS = `
  SELECT t.id, t.requisicao_transfusao_id, t.paciente_id, t.situacao, t.inicio_em, t.termino_em,
         t.volume_transfundido_ml, t.pulseira_conferida, t.motivo_interrupcao, t.horario_administracao_id,
         b.numero, b.volume_ml, h.sigla, g.sigla AS abo, f.sinal AS rh,
         ${LOGIN_DO_PROFISSIONAL('t.executor_profissional_id', 't.estabelecimento_id')} AS executor,
         ${LOGIN_DO_PROFISSIONAL('t.conferente_profissional_id', 't.estabelecimento_id')} AS conferente,
         (SELECT MIN(x.id) FROM reacao_transfusional x WHERE x.ato_transfusional_id = t.id AND x.excluido_em IS NULL) AS reacao
    FROM ato_transfusional t
    JOIN bolsa_hemocomponente b ON b.id = t.bolsa_hemocomponente_id
    JOIN hemocomponente h ON h.id = b.hemocomponente_id
    JOIN grupo_sanguineo g ON g.id = b.grupo_sanguineo_id
    JOIN fator_rh f ON f.id = b.fator_rh_id
   WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL`;

const SQL_REACOES = `
  SELECT x.id, x.ato_transfusional_id, x.paciente_id, pa.numero_prontuario, ${nomeDoPaciente('x.paciente_id')} AS nome,
         tr.codigo AS tipo, x.descricao_outra, x.grau, x.correlacao, x.inicio_em, x.sinais_sintomas, x.condutas,
         x.conduta_outra, x.destino_bolsa, x.notificacao_sugerida, x.notificacao_prioridade, x.notificacao_enviada_em,
         x.registrado_em, ${LOGIN_DE('x.registrado_por_usuario_id')} AS login, b.numero, h.sigla, t.inicio_em AS ato_inicio,
         t.requisicao_transfusao_id
    FROM reacao_transfusional x
    JOIN tipo_reacao_transfusional tr ON tr.id = x.tipo_reacao_transfusional_id
    JOIN ato_transfusional t ON t.id = x.ato_transfusional_id
    JOIN bolsa_hemocomponente b ON b.id = t.bolsa_hemocomponente_id
    JOIN hemocomponente h ON h.id = b.hemocomponente_id
    JOIN paciente pa ON pa.id = x.paciente_id
   WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL`;

const modeloPendente = (o: string) =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Recurso aguardando o modelo do banco',
    `${o} aguarda a tabela no modelo do banco: nada foi gravado.`,
  );

/** Uma escrita da porta: o que grava, nas tabelas declaradas, com a chave do pedido. */
interface Escrita<R extends ResultadoOperacao> {
  readonly nome: string;
  readonly tabelas: readonly string[];
  readonly chave: string | null;
  readonly entrada: Record<string, unknown>;
  readonly gravar: (tx: TxOperacao, est: number, fuso: string) => Promise<R>;
  readonly alvo: (r: R) => { tabela: string; id: number | null };
  /** O que a tela recebe do gravador (para a trilha montada pelo resultado); padrão: o resultado da operação. */
  readonly saida?: (r: R) => unknown;
}

/** A tabela própria da entidade que a tela põe na trilha (a linha só de trilha, sem escrita). */
const TABELA_DA_ENTIDADE: Readonly<Record<string, string>> = {
  SGH_SADT_HEMO_REQ: 'requisicao_transfusao',
  SGH_SADT_HEMO_AMOSTRA: 'amostra_pre_transfusional',
  SGH_SADT_HEMO_ATO: 'ato_transfusional',
  SGH_SADT_HEMO_REACAO: 'reacao_transfusional',
};

export class PortaTransfusaoPropria implements PortaTransfusao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoTransfusao,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoTransfusao, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    let est: number;
    try {
      est = estabelecimentoDe(c);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.nucleo.lerSomente(contexto(c), async (l) => fn(l, est, await fusoDe(l, est)));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(c: ContextoTransfusao, op: string): Promise<LiberacaoGravacao> {
    void c;
    void op;
    return { pode: true, codigo: null, motivo: null };
  }

  /** A checagem do horário vai pela porta da enfermagem; esta porta não tem operação do executor pela tela. */
  async executar(c: ContextoTransfusao, op: string, entrada: unknown, ctx: ContextoOperacao): Promise<never> {
    void [c, entrada, ctx];
    throw recusa('operacao-desconhecida', `Operação ${op} não é da agência transfusional.`);
  }

  private async escrever<R extends ResultadoOperacao>(
    c: ContextoTransfusao,
    trilha: TrilhaDaTela<unknown>,
    w: Escrita<R>,
  ): Promise<{ resultado: R; repetida: boolean }> {
    const est = estabelecimentoDe(c);
    let fuso = '';
    const op = definirOperacao<Record<string, unknown>, R>({
      nome: w.nome,
      tabelas: w.tabelas,
      entrada: z.record(z.string(), z.unknown()),
      async gravar(tx) {
        fuso = await fusoDe(tx, est);
        return w.gravar(tx, est, fuso);
      },
      alvo: (_e, r) => w.alvo(r),
      // A linha da tela, resolvida com o resultado da gravação, dentro da transação.
      trilha: (_e, r) => extrasDaTrilha(resolverTrilha(trilha, w.saida ? w.saida(r) : r)),
    });
    const chave = w.chave ?? `direta:${randomUUID()}`;
    const r = await this.executor.executar(op, c.cliente, w.entrada, {
      ...contexto(c),
      estabelecimento: est,
      chaveIdempotencia: chave,
    });
    return { resultado: r.resultado, repetida: r.repetida };
  }

  async gravarSgh<T>(
    c: ContextoTransfusao,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao) | null,
    fn: (g: GravadorTransfusao) => Promise<T>,
  ): Promise<T> {
    // A linha da trilha da tela vai em cada operação (a função é resolvida com o resultado, dentro da transação).
    // Sem nenhuma escrita (ex.: o bloqueio da transfusão), a linha vai numa operação só de trilha.
    const linha = trilha as TrilhaDaTela<unknown>;
    let escritas = 0;
    const r = await fn(this.gravador(c, linha, () => escritas++));
    if (escritas === 0 && linha) {
      const l = resolverTrilha(linha, r);
      const tabela = (l?.entidade && TABELA_DA_ENTIDADE[l.entidade]) || 'requisicao_transfusao';
      await gravarSoTrilha(
        this.executor,
        { ...contexto(c), estabelecimento: estabelecimentoDe(c) },
        OPERACOES_TRANSFUSAO.trilha,
        { tabela, id: l?.entidadeId ?? null },
        l,
      );
    }
    return r;
  }

  private gravador(c: ContextoTransfusao, linha: TrilhaDaTela<unknown>, marcar: () => void): GravadorTransfusao {
    const esc = <R extends ResultadoOperacao>(w: Escrita<R>) => {
      marcar();
      return this.escrever(c, linha, w);
    };
    const concluirNa = (tx: TxOperacao, est: number, fuso: string, x: Parameters<GravadorTransfusao['concluir']>[0]) =>
      concluirAto(tx, est, fuso, x);
    return {
      requisitar: async (r) => {
        const s = await esc({
          nome: OPERACOES_TRANSFUSAO.requisitar,
          tabelas: ['requisicao_transfusao', 'requisicao_transfusao_item', 'sequencia_negocio'],
          chave: r.chave,
          entrada: { ...r },
          alvo: (x) => ({ tabela: 'requisicao_transfusao', id: Number(x['id']) }),
          gravar: async (tx, est, fuso) => {
            const prof = await exigirProfissional(tx, c, est);
            const pih = await tx.uma<{ id: number; hemocomponente_id: number }>(
              `SELECT pih.id, pih.hemocomponente_id FROM prescricao_item_hemocomponente pih
                 JOIN prescricao_item pi ON pi.id = pih.prescricao_item_id
                 JOIN prescricao p ON p.id = pi.prescricao_id
                WHERE pih.prescricao_item_id = ? AND p.estabelecimento_id = ? AND p.atendimento_id = ?
                  AND pih.excluido_em IS NULL AND pi.excluido_em IS NULL`,
              [r.item, est, r.atendimento],
            );
            if (!pih)
              throw recusa('item-nao-encontrado', 'O item de hemoterapia não foi encontrado neste atendimento.');
            const aberta = await tx.consultarParaAtualizar(
              `SELECT r.id FROM requisicao_transfusao r WHERE r.prescricao_item_hemocomponente_id = ?
                  AND r.situacao IN ('requisitada','amostra_coletada','em_atendimento') AND r.excluido_em IS NULL`,
              [pih.id],
            );
            if (aberta.length > 0)
              throw recusa('requisicao-em-aberto', 'Já há uma requisição em aberto para este item.');
            const hemo = await idPorSigla(tx, r.hemocomponente);
            const tipo = await tipoTransfusao(tx, r.urgencia);
            const numero = await tx.proximoNumero('requisicao_transfusao');
            const id = await tx.incluir('requisicao_transfusao', {
              estabelecimento_id: est,
              numero: numero.formatado,
              paciente_id: r.paciente,
              atendimento_id: r.atendimento,
              prescricao_item_hemocomponente_id: pih.id,
              solicitante_profissional_id: prof,
              tipo_transfusao_id: tipo,
              programada_para: r.programadaPara ? instanteDe(r.programadaPara, fuso) : null,
              indicacao: r.indicacao,
              exames_apoio: r.examesDeApoio,
              termo_consentimento_paciente_id: r.termo,
              justificativa_urgencia: r.justificativaUrgencia,
              transfusao_anterior: codigoDoBanco(r.transfusaoAnterior),
              reacao_anterior: codigoDoBanco(r.reacaoAnterior),
              gestacao_anterior: codigoDoBanco(r.gestacaoAnterior),
              situacao: 'requisitada',
              solicitado_em: new Date(),
            });
            await tx.incluir('requisicao_transfusao_item', {
              requisicao_transfusao_id: id,
              sequencia: 1,
              hemocomponente_id: hemo,
              prescricao_item_hemocomponente_id: pih.id,
              quantidade_bolsas: r.quantidadeBolsas,
              volume_ml: r.volumeMl,
            });
            return { id };
          },
        });
        return { id: Number(s.resultado['id']), repetida: s.repetida };
      },

      cancelar: async (x) => {
        const s = await esc({
          nome: OPERACOES_TRANSFUSAO.cancelar,
          tabelas: ['requisicao_transfusao', 'requisicao_transfusao_item'],
          chave: x.chave ?? null,
          entrada: { ...x },
          alvo: (r) => ({ tabela: 'requisicao_transfusao', id: Number(r['id']) }),
          gravar: async (tx, est) => {
            const q = await requisicaoTravada(tx, est, x.requisicao);
            if (q.situacao === 'cancelada') throw recusa('ja-cancelada', 'A requisição já foi cancelada.');
            if (q.situacao !== 'requisitada' && q.situacao !== 'amostra_coletada')
              throw recusa('nao-cancelavel', 'A transfusão já começou: a requisição não é mais cancelável.');
            const motivo = await tx.uma<{ id: number }>(
              `SELECT id FROM motivo_cancelamento_requisicao_transfusao
                WHERE ativo = TRUE AND aplica_a IN ('requisicao','ambos') ORDER BY codigo = 'outro' DESC, id LIMIT 1`,
            );
            if (!motivo)
              throw recusa(
                'motivo-nao-cadastrado',
                'Cadastre ao menos um motivo de cancelamento de requisição transfusional.',
              );
            const agora = new Date();
            await tx.alterar('requisicao_transfusao', q.id, q.versao, {
              situacao: 'cancelada',
              cancelado_em: agora,
              cancelado_por_usuario_id: c.usuario,
              motivo_cancelamento_requisicao_transfusao_id: motivo.id,
              observacao_cancelamento: x.motivo,
            });
            for (const i of await tx.consultarParaAtualizar<{ id: number; versao: number }>(
              `SELECT id, versao FROM requisicao_transfusao_item
                WHERE requisicao_transfusao_id = ? AND situacao <> 'cancelado' AND excluido_em IS NULL`,
              [q.id],
            ))
              await tx.alterar('requisicao_transfusao_item', i.id, i.versao, {
                situacao: 'cancelado',
                cancelado_em: agora,
                cancelado_por_usuario_id: c.usuario,
                motivo_cancelamento_requisicao_transfusao_id: motivo.id,
              });
            return { id: q.id };
          },
        });
        return { id: Number(s.resultado['id']) };
      },

      amostra: async (a) => {
        const s = await esc({
          nome: OPERACOES_TRANSFUSAO.amostra,
          tabelas: ['amostra_pre_transfusional', 'requisicao_transfusao'],
          chave: a.chave,
          entrada: { ...a },
          alvo: (r) => ({ tabela: 'amostra_pre_transfusional', id: Number(r['id']) }),
          gravar: async (tx, est, fuso) => {
            const q = await requisicaoTravada(tx, est, a.requisicao);
            if (!['requisitada', 'amostra_coletada', 'em_atendimento'].includes(q.situacao))
              throw recusa('requisicao-fechada', 'A requisição não está aberta: a amostra não é registrada.');
            const prof = await exigirProfissional(tx, c, est);
            const coletada = instanteDe(a.coletadaEm, fuso);
            const id = await tx.incluir('amostra_pre_transfusional', {
              estabelecimento_id: est,
              codigo_barras: `P${randomUUID().replace(/-/g, '').slice(0, 20)}`,
              requisicao_transfusao_id: q.id,
              paciente_id: q.paciente_id,
              coletada_em: coletada,
              coletor_profissional_id: prof,
              identificadores_conferidos: a.identificadoresConferidos === true,
              rotulada_no_leito: a.rotuladaNoLeito === true,
              valida_ate: instanteDe(a.validaAte, fuso),
              situacao: 'coletada',
            });
            // O código da etiqueta: HT + ano (2 dígitos) + id (8 dígitos), único no estabelecimento.
            const codigo = `HT${a.coletadaEm.slice(2, 4)}${String(id).padStart(8, '0')}`;
            await tx.executar('UPDATE amostra_pre_transfusional SET codigo_barras = ? WHERE id = ?', [codigo, id]);
            if (q.situacao === 'requisitada')
              await tx.alterar('requisicao_transfusao', q.id, q.versao, { situacao: 'amostra_coletada' });
            return { id, codigo };
          },
        });
        return { id: Number(s.resultado['id']), codigo: String(s.resultado['codigo']), repetida: s.repetida };
      },

      iniciar: async (t) => {
        const s = await esc({
          nome: OPERACOES_TRANSFUSAO.iniciar,
          tabelas: [
            'ato_transfusional',
            'monitoramento_transfusao',
            'requisicao_transfusao',
            'horario_administracao',
            'horario_administracao_evento',
          ],
          chave: t.chave,
          entrada: { ...t },
          alvo: (r) => ({ tabela: 'ato_transfusional', id: Number(r['id']) }),
          gravar: async (tx, est, fuso) => {
            const q = await requisicaoTravada(tx, est, t.requisicao);
            if (!['requisitada', 'amostra_coletada', 'em_atendimento'].includes(q.situacao))
              throw recusa('requisicao-fechada', 'A requisição não está aberta para transfusão.');
            const emCurso = await tx.uma(
              `SELECT id FROM ato_transfusional WHERE requisicao_transfusao_id = ? AND situacao = 'em_andamento'
                  AND excluido_em IS NULL`,
              [q.id],
            );
            if (emCurso)
              throw recusa(
                'ato-em-curso',
                'Há uma transfusão em curso nesta requisição: conclua-a antes de iniciar outra bolsa.',
              );
            if (q.quantidade_atendida >= q.quantidade_bolsas)
              throw recusa('requisicao-fechada', 'Todas as bolsas da requisição já foram transfundidas.');
            const executor = await exigirProfissional(tx, c, est);
            const conferente = await profissionalDoLogin(tx, t.conferente, est);
            if (conferente === null)
              throw recusa(
                'segundo-profissional-sem-vinculo',
                'O segundo profissional não tem cadastro de profissional neste estabelecimento.',
              );
            if (conferente === executor)
              throw recusa('segundo-profissional-igual', 'O segundo profissional tem de ser outra pessoa.');
            const numero = t.bolsa.numero.trim().toUpperCase();
            const [bolsa] = await tx.consultarParaAtualizar<Linha & { id: number }>(
              `SELECT b.id, b.situacao, b.reservada_requisicao_transfusao_id, b.validade_em, g.sigla AS abo, f.sinal AS rh
                 FROM bolsa_hemocomponente b
                 JOIN hemocomponente h ON h.id = b.hemocomponente_id
                 JOIN grupo_sanguineo g ON g.id = b.grupo_sanguineo_id
                 JOIN fator_rh f ON f.id = b.fator_rh_id
                WHERE b.estabelecimento_id = ? AND b.numero = ? AND h.sigla = ? AND b.excluido_em IS NULL`,
              [est, numero, t.bolsa.hemocomponente.trim().toUpperCase()],
            );
            if (!bolsa)
              throw recusa(
                'bolsa-nao-recebida',
                'A bolsa não está no estoque da agência transfusional deste estabelecimento: confira o número.',
              );
            const usada = await tx.uma(
              `SELECT id FROM ato_transfusional WHERE bolsa_hemocomponente_id = ? AND situacao <> 'cancelado'
                  AND excluido_em IS NULL`,
              [bolsa.id],
            );
            if (usada) throw recusa('bolsa-ja-usada', 'Esta bolsa já foi usada em outra transfusão.');
            if (!['liberada', 'reservada'].includes(texto(bolsa['situacao'])))
              throw recusa('bolsa-indisponivel', 'A bolsa não está liberada pela agência transfusional.');
            if (
              texto(bolsa['situacao']) === 'reservada' &&
              numOuNulo(bolsa['reservada_requisicao_transfusao_id']) !== q.id
            )
              throw recusa(
                'bolsa-reservada-outra-requisicao',
                'A bolsa está reservada pela agência para outra requisição: confira a bolsa do paciente.',
              );
            const validade = bolsa['validade_em'] instanceof Date ? bolsa['validade_em'] : new Date(String(bolsa['validade_em']));
            const inicio = instanteDe(t.inicioEm, fuso);
            if (!(validade.getTime() > inicio.getTime()))
              throw recusa('bolsa-vencida', 'A bolsa está vencida no estoque da agência transfusional.');
            if (
              texto(bolsa['abo']) !== grupoAboPorId(t.bolsa.abo) ||
              RH_DO_SINAL[texto(bolsa['rh'])] !== fatorRhPorId(t.bolsa.rh)
            )
              throw recusa('tipagem-da-bolsa-diverge', 'A tipagem digitada não confere com a da bolsa no estoque.');
            const s0 = t.sinaisAntes;
            const id = await tx.incluir('ato_transfusional', {
              estabelecimento_id: est,
              requisicao_transfusao_id: q.id,
              requisicao_transfusao_item_id: q.item_id,
              bolsa_hemocomponente_id: bolsa.id,
              paciente_id: q.paciente_id,
              atendimento_id: q.atendimento_id,
              prescricao_item_hemocomponente_id: q.prescricao_item_hemocomponente_id,
              horario_administracao_id: t.horario,
              executor_profissional_id: executor,
              conferente_profissional_id: conferente,
              pulseira_conferida: t.pulseiraLida,
              etiqueta_receptor_conferida: t.etiquetaReceptorConferida === true,
              inspecao_visual_aprovada: t.inspecaoVisualAprovada === true,
              justificativa_rh: t.justificativaRh,
              pressao_sistolica_antes: s0.pas,
              pressao_diastolica_antes: s0.pad,
              frequencia_cardiaca_antes: s0.fc,
              frequencia_respiratoria_antes: s0.fr ?? null,
              temperatura_antes: s0.temperatura,
              saturacao_oxigenio_antes: s0.spo2 ?? null,
              inicio_em: inicio,
              situacao: 'em_andamento',
            });
            if (t.horario !== null)
              await checarHorarioDoAto(tx, est, {
                horario: t.horario,
                prescricaoItemHemocomponente: q.prescricao_item_hemocomponente_id,
                ocorrido: inicio,
                profissional: executor,
                ato: id,
                pulseiraLida: t.pulseiraLida,
                motivoSemPulseira: t.motivoSemPulseira,
                conferente: t.conferente,
                bolsa: numero,
                alertas: t.alertas,
              });
            await incluirSinais(tx, id, 'antes', s0, instanteDe(t.sinaisAntesEm, fuso), executor);
            if (q.situacao !== 'em_atendimento')
              await tx.alterar('requisicao_transfusao', q.id, q.versao, { situacao: 'em_atendimento' });
            return { id };
          },
        });
        return { id: Number(s.resultado['id']), repetida: s.repetida };
      },

      sinais: async (x) => {
        const s = await esc({
          nome: OPERACOES_TRANSFUSAO.sinais,
          tabelas: ['monitoramento_transfusao'],
          chave: x.chave,
          entrada: { ...x },
          alvo: (r) => ({ tabela: 'monitoramento_transfusao', id: Number(r['id']) }),
          gravar: async (tx, est, fuso) => {
            const a = await atoTravado(tx, est, x.ato);
            if (x.momento === 'durante' && a.situacao !== 'em_andamento')
              throw recusa('ato-encerrado', 'A transfusão já terminou: registre os sinais do término.');
            if (x.momento === 'depois' && a.situacao === 'em_andamento')
              throw recusa('ato-em-curso', 'Os sinais do término são registrados depois de concluir a transfusão.');
            const ja = await tx.uma(
              'SELECT id FROM monitoramento_transfusao WHERE ato_transfusional_id = ? AND momento = ? AND excluido_em IS NULL',
              [a.id, x.momento],
            );
            if (ja) throw recusa('sinais-ja-registrados', 'Os sinais deste momento da transfusão já foram registrados.');
            const prof = await exigirProfissional(tx, c, est);
            const id = await incluirSinais(tx, a.id, x.momento, x.sinais, instanteDe(x.medidoEm, fuso), prof);
            return { id };
          },
        });
        return { id: Number(s.resultado['id']), repetida: s.repetida };
      },

      concluir: async (x) => {
        const s = await esc({
          nome: OPERACOES_TRANSFUSAO.concluir,
          tabelas: [
            'ato_transfusional',
            'requisicao_transfusao',
            'requisicao_transfusao_item',
            'bolsa_hemocomponente',
            'balanco_hidrico_paciente',
            'balanco_lancamento',
          ],
          chave: x.chave ?? null,
          entrada: { ...x },
          alvo: (r) => ({ tabela: 'ato_transfusional', id: Number(r['id']) }),
          gravar: (tx, est, fuso) => concluirNa(tx, est, fuso, x),
        });
        return {
          id: Number(s.resultado['id']),
          estadoRequisicao: String(s.resultado['estadoRequisicao']),
          ganho: s.resultado['ganho'] === null || s.resultado['ganho'] === undefined ? null : Number(s.resultado['ganho']),
        };
      },

      reacao: async (r) => {
        const s = await esc({
          nome: OPERACOES_TRANSFUSAO.reacao,
          tabelas: [
            'reacao_transfusional',
            'monitoramento_transfusao',
            'ato_transfusional',
            'requisicao_transfusao',
            'requisicao_transfusao_item',
            'bolsa_hemocomponente',
            'balanco_hidrico_paciente',
            'balanco_lancamento',
            'sequencia_negocio',
          ],
          chave: r.chave,
          entrada: { ...r },
          alvo: (x) => ({ tabela: 'reacao_transfusional', id: Number(x['id']) }),
          gravar: async (tx, est, fuso) => {
            const a = await atoTravado(tx, est, r.ato);
            let interrompeu = false;
            if (a.situacao === 'em_andamento') {
              if (!r.interromper)
                throw recusa('em-curso-sem-interromper', 'Com a transfusão em curso, a primeira conduta é interrompê-la.');
              await concluirAto(
                tx,
                est,
                fuso,
                { ato: a.id, usuario: r.usuario, interrompida: true, ...r.interromper },
                DESTINO_DA_BOLSA[r.destinoBolsa] ?? 'transfundida',
              );
              interrompeu = true;
            }
            const tipo = await tx.uma<{ id: number }>(
              'SELECT id FROM tipo_reacao_transfusional WHERE codigo = ? AND ativo = TRUE',
              [codigoDoBanco(r.tipo)],
            );
            if (!tipo) throw recusa('tipo-reacao-nao-cadastrado', 'O tipo de reação não está cadastrado.');
            const numero = await tx.proximoNumero('reacao_transfusional');
            const id = await tx.incluir('reacao_transfusional', {
              estabelecimento_id: est,
              numero: numero.formatado,
              ato_transfusional_id: a.id,
              paciente_id: a.paciente_id,
              bolsa_hemocomponente_id: a.bolsa_hemocomponente_id,
              tipo_reacao_transfusional_id: tipo.id,
              descricao_outra: r.descricaoOutra,
              grau: r.grau,
              correlacao: r.correlacao,
              inicio_em: instanteDe(r.inicioEm, fuso),
              sinais_sintomas: r.sinaisESintomas,
              sinais_vitais: r.sinais ? JSON.stringify(r.sinais) : null,
              condutas: JSON.stringify(r.condutas),
              conduta_outra: r.condutaOutra,
              destino_bolsa: codigoDoBanco(r.destinoBolsa),
              notificacao_sugerida: true,
              notificacao_prioridade: r.prioridade,
              registrado_por_usuario_id: c.usuario,
              registrado_em: new Date(),
            });
            if (r.sinais) {
              const prof = await exigirProfissional(tx, c, est);
              await incluirSinais(tx, a.id, 'reacao', r.sinais, instanteDe(r.inicioEm, fuso), prof);
            }
            return { id, interrompeu };
          },
        });
        return {
          id: Number(s.resultado['id']),
          repetida: s.repetida,
          interrompeu: s.repetida ? false : s.resultado['interrompeu'] === true,
        };
      },

      notificada: async (m) => {
        const s = await esc({
          nome: OPERACOES_TRANSFUSAO.notificada,
          tabelas: ['reacao_transfusional'],
          chave: m.chave ?? null,
          entrada: { ...m },
          alvo: (r) => ({ tabela: 'reacao_transfusional', id: Number(r['id']) }),
          gravar: async (tx, est, fuso) => {
            const [x] = await tx.consultarParaAtualizar<{ id: number; versao: number; notificacao_enviada_em: unknown }>(
              `SELECT id, versao, notificacao_enviada_em FROM reacao_transfusional
                WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
              [m.reacao, est],
            );
            if (!x) throw recusa('nao-encontrada', 'A reação não foi encontrada neste estabelecimento.');
            if (x.notificacao_enviada_em !== null)
              throw recusa('ja-notificada', 'A notificação desta reação já foi registrada como enviada.');
            await tx.alterar('reacao_transfusional', x.id, x.versao, {
              notificacao_enviada_em: instanteDe(m.enviadaEm, fuso),
            });
            return { id: x.id };
          },
        });
        return { id: Number(s.resultado['id']) };
      },

      alterar: async () => {
        throw modeloPendente('A alteração da requisição com a versão anterior guardada');
      },
      adendo: async () => {
        throw modeloPendente('O adendo dos sinais do ato transfusional');
      },
    };
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  itensAAtender(c: ContextoTransfusao, o: { readonly agora: string; readonly atendimento?: number }) {
    return this.ler(c, async (l, est, fuso) => {
      const agora = instanteDe(o.agora, fuso);
      const p: unknown[] = [est, agora, agora];
      let sql = `${SQL_ITENS} AND p.situacao = 'vigente' AND p.vigencia_inicio_em <= ? AND p.vigencia_fim_em >= ?
          AND pi.situacao = 'ativo'
          AND NOT EXISTS (SELECT 1 FROM requisicao_transfusao r WHERE r.prescricao_item_hemocomponente_id = pih.id
                             AND r.situacao <> 'cancelada' AND r.excluido_em IS NULL)`;
      if (o.atendimento !== undefined) {
        sql += ' AND p.atendimento_id = ?';
        p.push(o.atendimento);
      }
      const rs = await l.consultar(`${sql} ORDER BY p.prescrito_em, pi.id LIMIT ${TETO_ITENS_HEMOTERAPIA + 1}`, p);
      return {
        itens: rs.slice(0, TETO_ITENS_HEMOTERAPIA).map((x) => itemDe(x, fuso)),
        cortada: rs.length > TETO_ITENS_HEMOTERAPIA,
      };
    });
  }

  item(c: ContextoTransfusao, item: number, agora: string) {
    void agora;
    return this.ler(c, async (l, est, fuso) => {
      const x = await l.uma(`${SQL_ITENS} AND pi.id = ?`, [est, item]);
      return x ? itemDe(x, fuso) : null;
    });
  }

  horarios(c: ContextoTransfusao, item: number): Promise<HorarioHemoterapia[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT ha.id, ha.previsto_em, ha.suspenso, sc.categoria, ha.situacao_checagem_em,
                  (SELECT COUNT(*) FROM horario_administracao_evento ev WHERE ev.horario_administracao_id = ha.id) AS historico
             FROM horario_administracao ha JOIN situacao_checagem sc ON sc.id = ha.situacao_checagem_id
            WHERE ha.prescricao_item_id = ? AND ha.estabelecimento_id = ? AND ha.excluido_em IS NULL
            ORDER BY ha.previsto_em, ha.id`,
          [item, est],
        )
      ).map((h) => ({
        id: num(h['id']),
        previsto: civilDe(h['previsto_em'], fuso),
        situacao: booleano(h['suspenso']) ? 'S' : (SITUACAO_HORARIO[texto(h['categoria'])] ?? 'P'),
        situacaoEm: civilDe(h['situacao_checagem_em'], fuso),
        historico: num(h['historico']),
      })),
    );
  }

  tipagem(c: ContextoTransfusao, paciente: number): Promise<TipagemSanguinea> {
    // A tipagem do cadastro do paciente é da rede inteira (o paciente não tem estabelecimento).
    return this.ler(c, async (l) => {
      const p = await l.uma('SELECT tipo_sanguineo, fator_rh FROM paciente WHERE id = ? AND excluido_em IS NULL', [
        paciente,
      ]);
      return p ? tipagemDe(p['tipo_sanguineo'], p['fator_rh']) : { abo: null, rh: null };
    });
  }

  termos(c: ContextoTransfusao, paciente: number): Promise<TermoConsentimentoLido[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `SELECT t.id, t.atendimento_id, t.termo_consentimento_modelo_id, t.procedimento_descricao, s.etapa,
                  COALESCE(t.motivo_revogacao, t.motivo_recusa) AS motivo, t.documento_prontuario_id, t.emitido_em,
                  ${LOGIN_DE('t.criado_por')} AS login
             FROM termo_consentimento_paciente t
             JOIN situacao_termo_consentimento s ON s.id = t.situacao_termo_consentimento_id
            WHERE t.paciente_id = ? AND t.estabelecimento_id = ? AND t.excluido_em IS NULL
            ORDER BY t.emitido_em DESC, t.id DESC LIMIT 200`,
          [paciente, est],
        )
      ).map((t) => ({
        id: num(t['id']),
        anterior: null,
        atendimento: num(t['atendimento_id']),
        tipo: numOuNulo(t['termo_consentimento_modelo_id']),
        procedimento: texto(t['procedimento_descricao']),
        situacao:
          t['etapa'] === 'assinado'
            ? 'assinado'
            : ['revogado', 'recusado', 'cancelado'].includes(texto(t['etapa']))
              ? 'revogado'
              : 'pendente',
        motivo: textoOuNulo(t['motivo']),
        documento: numOuNulo(t['documento_prontuario_id']),
        usuario: texto(t['login']),
        em: (civilDe(t['emitido_em'], fuso) ?? '').slice(0, 10),
      })),
    );
  }

  requisicoes(c: ContextoTransfusao, f: FiltroRequisicoesPorta) {
    return this.ler(c, async (l, est, fuso) => {
      const p: unknown[] = [est];
      let sql = SQL_REQUISICOES;
      if (f.estado) {
        sql += ' AND r.situacao = ?';
        p.push(SITUACAO_REQUISICAO[f.estado as EstadoRequisicaoTransfusao] ?? f.estado);
      }
      if (f.urgencia) {
        sql += ' AND tt.codigo = ?';
        p.push(codigoDoBanco(urgenciaPorId(f.urgencia) ?? ''));
      }
      if (f.de) {
        sql += ' AND r.solicitado_em >= ?';
        p.push(instanteDe(`${f.de}T00:00`, fuso));
      }
      if (f.ate) {
        sql += ' AND r.solicitado_em < ?';
        p.push(new Date(instanteDe(`${f.ate}T00:00`, fuso).getTime() + 86_400_000));
      }
      if (f.atendimento !== undefined) {
        sql += ' AND r.atendimento_id = ?';
        p.push(f.atendimento);
      }
      const termo = (f.termo ?? '').trim();
      if (termo) {
        sql += ` AND (pa.numero_prontuario = ? OR ${nomeDoPaciente('r.paciente_id')} LIKE ?)`;
        p.push(/^\d+$/.test(termo) ? Number(termo) : -1, `%${termo.replace(/[%_\\]/g, '\\$&')}%`);
      }
      const rs = await l.consultar(`${sql} ORDER BY r.solicitado_em DESC, r.id DESC LIMIT ${TETO_REQUISICOES + 1}`, p);
      return {
        itens: rs.slice(0, TETO_REQUISICOES).map((x) => requisicaoDe(x, fuso, f.agora)),
        cortada: rs.length > TETO_REQUISICOES,
      };
    });
  }

  requisicao(c: ContextoTransfusao, id: number, agora: string) {
    return this.ler(c, async (l, est, fuso) => {
      const x = await l.uma(`${SQL_REQUISICOES} AND r.id = ?`, [est, id]);
      return x ? requisicaoDe(x, fuso, agora) : null;
    });
  }

  atos(
    c: ContextoTransfusao,
    f: {
      readonly requisicao?: number;
      readonly ato?: number;
      readonly paciente?: number;
      readonly de?: string;
      readonly ate?: string;
    },
  ): Promise<AtoTransfusionalLido[]> {
    return this.ler(c, async (l, est, fuso) => {
      const p: unknown[] = [est];
      let sql = SQL_ATOS;
      for (const [campo, coluna] of [
        ['requisicao', 't.requisicao_transfusao_id'],
        ['ato', 't.id'],
        ['paciente', 't.paciente_id'],
      ] as const) {
        const v = f[campo];
        if (v !== undefined) {
          sql += ` AND ${coluna} = ?`;
          p.push(v);
        }
      }
      if (f.de) {
        sql += ' AND t.inicio_em >= ?';
        p.push(instanteDe(`${f.de}T00:00`, fuso));
      }
      if (f.ate) {
        sql += ' AND t.inicio_em < ?';
        p.push(new Date(instanteDe(`${f.ate}T00:00`, fuso).getTime() + 86_400_000));
      }
      const atos = await l.consultar(`${sql} ORDER BY t.inicio_em DESC, t.id DESC LIMIT 500`, p);
      const ids = atos.map((a) => num(a['id']));
      const sinais = ids.length
        ? await l.consultar(
            `SELECT ato_transfusional_id, momento, medido_em, pressao_sistolica, pressao_diastolica, frequencia_cardiaca,
                    temperatura, frequencia_respiratoria, saturacao_oxigenio
               FROM monitoramento_transfusao
              WHERE ato_transfusional_id IN (${marcadores(ids.length)}) AND momento <> 'reacao' AND excluido_em IS NULL
              ORDER BY sequencia`,
            ids,
          )
        : [];
      return atos.map((a): AtoTransfusionalLido => ({
        id: num(a['id']),
        requisicao: num(a['requisicao_transfusao_id']),
        bolsa: {
          numero: texto(a['numero']),
          hemocomponente: texto(a['sigla']),
          tipagem: tipagemDe(a['abo'], a['rh']),
          volumeMl: num(a['volume_ml']),
        },
        estado: ESTADO_ATO[texto(a['situacao'])] ?? 'interrompido',
        inicioEm: civilDe(a['inicio_em'], fuso) ?? '',
        terminoEm: civilDe(a['termino_em'], fuso),
        volumeTransfundidoMl: numOuNulo(a['volume_transfundido_ml']),
        profissional: texto(a['executor']),
        segundoProfissional: texto(a['conferente']),
        sinais: sinais
          .filter((s) => num(s['ato_transfusional_id']) === num(a['id']))
          .map((s) => sinaisDe(s, fuso)),
        reacao: numOuNulo(a['reacao']),
        horario: numOuNulo(a['horario_administracao_id']),
        pulseiraLida: booleano(a['pulseira_conferida']),
        alertas: [],
        motivoInterrupcao: textoOuNulo(a['motivo_interrupcao']),
        ganhoLancado: false,
      }));
    });
  }

  reacoes(
    c: ContextoTransfusao,
    f: { readonly de?: string; readonly ate?: string; readonly reacao?: number },
  ): Promise<ReacaoTransfusionalLida[]> {
    return this.ler(c, async (l, est, fuso) => {
      const p: unknown[] = [est];
      let sql = SQL_REACOES;
      if (f.reacao !== undefined) {
        sql += ' AND x.id = ?';
        p.push(f.reacao);
      }
      if (f.de) {
        sql += ' AND x.inicio_em >= ?';
        p.push(instanteDe(`${f.de}T00:00`, fuso));
      }
      if (f.ate) {
        sql += ' AND x.inicio_em < ?';
        p.push(new Date(instanteDe(`${f.ate}T00:00`, fuso).getTime() + 86_400_000));
      }
      return (await l.consultar(`${sql} ORDER BY x.inicio_em DESC, x.id DESC LIMIT 500`, p)).map(
        (x): ReacaoTransfusionalLida => ({
          id: num(x['id']),
          ato: num(x['ato_transfusional_id']),
          tipo: codigoDoContrato(texto(x['tipo'])) as TipoReacaoTransfusional,
          grau: num(x['grau']) as GrauReacao,
          correlacao: texto(x['correlacao']) as CorrelacaoReacao,
          inicioEm: civilDe(x['inicio_em'], fuso) ?? '',
          destinoBolsa: codigoDoContrato(texto(x['destino_bolsa'])) as DestinoBolsaReacao,
          condutas: json<CondutaReacao[]>(x['condutas']) ?? [],
          notificacao: {
            sugerida: booleano(x['notificacao_sugerida']),
            prioridade: x['notificacao_prioridade'] === 'imediata' ? 'imediata' : 'rotina',
            enviadaEm: civilDe(x['notificacao_enviada_em'], fuso),
          },
          registradaEm: civilDe(x['registrado_em'], fuso) ?? '',
          registradaPor: texto(x['login']),
          descricaoOutra: textoOuNulo(x['descricao_outra']),
          sinaisESintomas: texto(x['sinais_sintomas']),
          condutaOutra: textoOuNulo(x['conduta_outra']),
          paciente: {
            id: num(x['paciente_id']),
            nome: texto(x['nome']),
            prontuario: numOuNulo(x['numero_prontuario']),
          },
          bolsa: { numero: texto(x['numero']), hemocomponente: texto(x['sigla']) },
          transfusaoIniciadaEm: civilDe(x['ato_inicio'], fuso) ?? '',
          requisicao: num(x['requisicao_transfusao_id']),
        }),
      );
    });
  }

  bolsaUsada(c: ContextoTransfusao, numero: string): Promise<boolean> {
    return this.ler(c, async (l, est) =>
      Boolean(
        await l.uma(
          `SELECT t.id FROM ato_transfusional t JOIN bolsa_hemocomponente b ON b.id = t.bolsa_hemocomponente_id
            WHERE b.estabelecimento_id = ? AND b.numero = ? AND t.situacao <> 'cancelado' AND t.excluido_em IS NULL`,
          [est, numero.trim().toUpperCase()],
        ),
      ),
    );
  }

  /** Pendência de modelo: a versão anterior da requisição alterada ainda não tem tabela. */
  async versoesRequisicao(c: ContextoTransfusao, requisicao: number): Promise<VersaoRequisicaoLida[]> {
    void [c, requisicao];
    return [];
  }

  /** Pendência de modelo: o adendo dos sinais do ato ainda não tem tabela. */
  async adendos(c: ContextoTransfusao, atos: readonly number[]): Promise<AdendoAtoLido[]> {
    void [c, atos];
    return [];
  }

  gravadoPorChave(
    c: ContextoTransfusao,
    o: { readonly tipo: 'requisicao' | 'ato'; readonly chave: string; readonly usuario: string },
  ): Promise<number | null> {
    // A repetição do pedido pela idempotência do núcleo: a mesma chave, da mesma conta, na operação do tipo.
    return this.ler(c, async (l, est) => {
      const r = await l.uma<{ resultado: unknown }>(
        `SELECT i.resultado FROM idempotencia_operacao i JOIN usuario u ON u.id = i.usuario_id
          WHERE i.operacao = ? AND i.chave = ? AND i.estabelecimento_id = ? AND u.login = ?`,
        [
          o.tipo === 'ato' ? OPERACOES_TRANSFUSAO.iniciar : OPERACOES_TRANSFUSAO.requisitar,
          o.chave,
          est,
          o.usuario.trim().toLowerCase(),
        ],
      );
      const v = r ? json<{ id?: number }>(r.resultado) : null;
      return v?.id ? Number(v.id) : null;
    });
  }

  pessoa(c: ContextoTransfusao, paciente: number) {
    // O cadastro da pessoa é da rede inteira.
    return this.ler(c, async (l) => {
      const p = await l.uma(
        `SELECT COALESCE(NULLIF(pa.nome_social, ''), pf.nome) AS nome, pf.data_nascimento, s.sigla
           FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
           LEFT JOIN sexo s ON s.id = pf.sexo_id
          WHERE pa.id = ? AND pa.excluido_em IS NULL`,
        [paciente],
      );
      const sigla = texto(p?.['sigla']);
      return {
        sexo: (sigla === 'F' || sigla === 'M' ? sigla : 'I') as 'F' | 'M' | 'I',
        nascimento: dataDe(p?.['data_nascimento']),
        nome: texto(p?.['nome']),
      };
    });
  }
}

// ── Apoio das gravações ─────────────────────────────────────────────────────────────────────────────────────────

const contexto = (c: ContextoNucleo): ContextoNucleo => ({
  cliente: c.cliente,
  estabelecimento: c.estabelecimento,
  usuario: c.usuario,
  correlacao: c.correlacao || 'transfusao',
});

function json<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}

async function idPorSigla(tx: TxOperacao, sigla: string): Promise<number> {
  const h = await tx.uma<{ id: number }>('SELECT id FROM hemocomponente WHERE sigla = ? AND ativo = TRUE', [
    sigla.trim().toUpperCase(),
  ]);
  if (!h) throw recusa('hemocomponente-nao-cadastrado', 'O hemocomponente não está cadastrado.');
  return Number(h.id);
}

/** O tipo de transfusão pela urgência da tela (id 1 a 4 do contrato → código do tipo no banco). */
async function tipoTransfusao(tx: TxOperacao, urgencia: number): Promise<number> {
  const codigo = urgenciaPorId(urgencia);
  if (!codigo) throw recusa('urgencia-invalida', 'Urgência da transfusão inválida.');
  const t = await tx.uma<{ id: number }>('SELECT id FROM tipo_transfusao WHERE codigo = ? AND ativo = TRUE', [
    codigoDoBanco(codigo),
  ]);
  if (!t) throw recusa('tipo-transfusao-nao-cadastrado', 'O tipo de transfusão não está cadastrado.');
  return Number(t.id);
}

interface RequisicaoTravada {
  readonly id: number;
  readonly versao: number;
  readonly situacao: string;
  readonly paciente_id: number;
  readonly atendimento_id: number;
  readonly prescricao_item_hemocomponente_id: number | null;
  readonly item_id: number;
  readonly item_versao: number;
  readonly quantidade_bolsas: number;
  readonly quantidade_atendida: number;
}

async function requisicaoTravada(tx: TxOperacao, est: number, id: number): Promise<RequisicaoTravada> {
  const [q] = await tx.consultarParaAtualizar<Linha>(
    `SELECT r.id, r.versao, r.situacao, r.paciente_id, r.atendimento_id, r.prescricao_item_hemocomponente_id,
            ri.id AS item_id, ri.versao AS item_versao, ri.quantidade_bolsas, ri.quantidade_atendida
       FROM requisicao_transfusao r
       JOIN requisicao_transfusao_item ri ON ri.requisicao_transfusao_id = r.id AND ri.sequencia = 1
      WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`,
    [id, est],
  );
  if (!q) throw recusa('nao-encontrada', 'A requisição transfusional não foi encontrada neste estabelecimento.');
  return {
    id: num(q['id']),
    versao: num(q['versao']),
    situacao: texto(q['situacao']),
    paciente_id: num(q['paciente_id']),
    atendimento_id: num(q['atendimento_id']),
    prescricao_item_hemocomponente_id: numOuNulo(q['prescricao_item_hemocomponente_id']),
    item_id: num(q['item_id']),
    item_versao: num(q['item_versao']),
    quantidade_bolsas: num(q['quantidade_bolsas']),
    quantidade_atendida: num(q['quantidade_atendida']),
  };
}

async function atoTravado(tx: TxOperacao, est: number, id: number) {
  const [a] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, situacao, paciente_id, atendimento_id, requisicao_transfusao_id, bolsa_hemocomponente_id
       FROM ato_transfusional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!a) throw recusa('nao-encontrado', 'A transfusão não foi encontrada neste estabelecimento.');
  return {
    id: num(a['id']),
    versao: num(a['versao']),
    situacao: texto(a['situacao']),
    paciente_id: num(a['paciente_id']),
    atendimento_id: num(a['atendimento_id']),
    requisicao: num(a['requisicao_transfusao_id']),
    bolsa_hemocomponente_id: num(a['bolsa_hemocomponente_id']),
  };
}

async function incluirSinais(
  tx: TxOperacao,
  ato: number,
  momento: MomentoSinaisTransfusao | 'reacao',
  s: SinaisTransfusao,
  medidoEm: Date,
  profissional: number,
): Promise<number> {
  const seq = await tx.uma<{ s: number }>(
    'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM monitoramento_transfusao WHERE ato_transfusional_id = ?',
    [ato],
  );
  return tx.incluir('monitoramento_transfusao', {
    ato_transfusional_id: ato,
    sequencia: num(seq?.s ?? 1),
    momento,
    medido_em: medidoEm,
    pressao_sistolica: s.pas,
    pressao_diastolica: s.pad,
    frequencia_cardiaca: s.fc,
    temperatura: s.temperatura,
    frequencia_respiratoria: s.fr ?? null,
    saturacao_oxigenio: s.spo2 ?? null,
    profissional_id: profissional,
  });
}

/** Conclui (ou interrompe) o ato: a bolsa transfundida, a contagem do item e a situação da requisição. */
/** O destino da bolsa no estoque pela reação que interrompeu o ato (a devolvida para investigação não é transfundida). */
const DESTINO_DA_BOLSA: Readonly<Record<string, 'devolvida' | 'descartada'>> = {
  devolvida: 'devolvida',
  descartada: 'descartada',
};

/** Os códigos do grupo de ganho do balanço hídrico para o hemocomponente (o primeiro ativo, nesta ordem). */
const GRUPOS_GANHO_HEMOCOMPONENTE = ['hemocomponente', 'hemoterapia', 'transfusao'] as const;

async function concluirAto(
  tx: TxOperacao,
  est: number,
  fuso: string,
  x: Parameters<GravadorTransfusao['concluir']>[0],
  destinoBolsa: 'transfundida' | 'devolvida' | 'descartada' = 'transfundida',
): Promise<{ id: number; estadoRequisicao: string; ganho: number | null }> {
  const a = await atoTravado(tx, est, x.ato);
  if (a.situacao !== 'em_andamento') throw recusa('ato-encerrado', 'A transfusão já foi concluída ou interrompida.');
  const termino = instanteDe(x.terminoEm, fuso);
  await tx.alterar('ato_transfusional', a.id, a.versao, {
    termino_em: termino,
    volume_transfundido_ml: x.volumeTransfundidoMl,
    interrompida: x.interrompida,
    motivo_interrupcao: x.interrompida ? (x.motivoInterrupcao ?? 'Interrompida') : null,
    situacao: x.interrompida ? 'interrompido' : 'concluido',
  });
  const q = await requisicaoTravada(tx, est, a.requisicao);
  const atendida = Math.min(q.quantidade_bolsas, q.quantidade_atendida + 1);
  const fim = atendida >= q.quantidade_bolsas;
  await tx.alterar('requisicao_transfusao_item', q.item_id, q.item_versao, {
    quantidade_atendida: atendida,
    situacao: fim ? 'atendido' : 'parcial',
  });
  const estado = fim ? 'atendida' : 'em_atendimento';
  if (q.situacao !== estado) await tx.alterar('requisicao_transfusao', q.id, q.versao, { situacao: estado });
  const [b] = await tx.consultarParaAtualizar<{ id: number; versao: number }>(
    'SELECT id, versao FROM bolsa_hemocomponente WHERE id = ? AND estabelecimento_id = ?',
    [a.bolsa_hemocomponente_id, est],
  );
  // A conclusão normal (ou a interrupção sem destino da reação) dá a bolsa por transfundida; a reação que a devolve
  // ou descarta grava esse destino.
  if (b)
    await tx.alterar('bolsa_hemocomponente', b.id, b.versao, {
      situacao: destinoBolsa,
      destino_em: termino,
      reservada_requisicao_transfusao_id: null,
    });
  const ganho =
    x.volumeTransfundidoMl > 0 && x.janelaBalanco !== null
      ? await lancarGanhoNoBalanco(tx, est, fuso, {
          atendimento: a.atendimento_id,
          paciente: a.paciente_id,
          janelaInicio: x.janelaBalanco,
          volumeMl: x.volumeTransfundidoMl,
          ocorrido: termino,
          ato: a.id,
        })
      : null;
  return { id: a.id, estadoRequisicao: ESTADO_REQUISICAO[estado] ?? estado, ganho };
}

/**
 * O volume transfundido como ganho no balanço hídrico da janela de 24 horas do atendimento (o balanço da janela é
 * criado no primeiro lançamento, como no lançamento manual). Sem o grupo de ganho do hemocomponente no cadastro, nada
 * é lançado e a tela mostra que o ganho não entrou (null).
 */
async function lancarGanhoNoBalanco(
  tx: TxOperacao,
  est: number,
  fuso: string,
  g: {
    readonly atendimento: number;
    readonly paciente: number;
    readonly janelaInicio: string;
    readonly volumeMl: number;
    readonly ocorrido: Date;
    readonly ato: number;
  },
): Promise<number | null> {
  const grupo = await tx.uma<{ id: number }>(
    `SELECT id FROM grupo_balanco_hidrico WHERE codigo IN (?, ?, ?) AND tipo = 'ganho' AND ativo = TRUE
      ORDER BY FIELD(codigo, ?, ?, ?) LIMIT 1`,
    [...GRUPOS_GANHO_HEMOCOMPONENTE, ...GRUPOS_GANHO_HEMOCOMPONENTE],
  );
  if (!grupo) return null;
  const inicio = instanteDe(g.janelaInicio, fuso);
  const [bal] = await tx.consultarParaAtualizar<{ id: number }>(
    `SELECT id FROM balanco_hidrico_paciente
      WHERE estabelecimento_id = ? AND atendimento_id = ? AND excluido_em IS NULL
        AND ((inicio_janela_em <= ? AND fim_janela_em > ?) OR data_referencia = ?)
      ORDER BY inicio_janela_em DESC LIMIT 1`,
    [est, g.atendimento, inicio, inicio, g.janelaInicio.slice(0, 10)],
  );
  let balanco = bal ? Number(bal.id) : 0;
  if (!balanco) {
    const setor = await tx.uma<{ s: number | null }>(
      `SELECT COALESCE(
         (SELECT u.setor_funcional_id FROM ocupacao_leito o JOIN internacao i ON i.id = o.internacao_id
            JOIN unidade_internacao u ON u.id = o.unidade_internacao_id
           WHERE i.atendimento_id = ? AND o.estabelecimento_id = ? AND o.excluido_em IS NULL
           ORDER BY o.data_hora_fim IS NULL DESC, o.data_hora_inicio DESC LIMIT 1),
         (SELECT setor_funcional_id FROM atendimento WHERE id = ? AND estabelecimento_id = ?)) AS s`,
      [g.atendimento, est, g.atendimento, est],
    );
    if (setor?.s === null || setor?.s === undefined) return null;
    balanco = await tx.incluir('balanco_hidrico_paciente', {
      estabelecimento_id: est,
      atendimento_id: g.atendimento,
      paciente_id: g.paciente,
      setor_funcional_id: Number(setor.s),
      data_referencia: g.janelaInicio.slice(0, 10),
      inicio_janela_em: inicio,
      fim_janela_em: new Date(inicio.getTime() + 24 * 3_600_000),
      hora_fechamento: `${g.janelaInicio.slice(11, 16)}:00`,
    });
  }
  const prof = await exigirProfissional(tx, tx.contexto, est);
  return tx.incluir('balanco_lancamento', {
    balanco_hidrico_paciente_id: balanco,
    sentido: 'ganho',
    grupo_balanco_hidrico_id: grupo.id,
    estimado: false,
    volume_ml: g.volumeMl,
    descricao: `Transfusão (ato ${g.ato})`,
    ocorrido_em: g.ocorrido,
    registrado_em: new Date(),
    fonte_lancamento: 'checagem',
    profissional_id: prof,
  });
}

/**
 * O horário pendente do hemocomponente checado como administrado no início do ato, na mesma operação: o horário tem
 * de ser do item prescrito da requisição, deste estabelecimento e estar pendente.
 */
async function checarHorarioDoAto(
  tx: TxOperacao,
  est: number,
  h: {
    readonly horario: number;
    readonly prescricaoItemHemocomponente: number | null;
    readonly ocorrido: Date;
    readonly profissional: number;
    readonly ato: number;
    readonly pulseiraLida: boolean;
    readonly motivoSemPulseira: string | null;
    readonly conferente: string;
    readonly bolsa: string;
    readonly alertas: readonly string[];
  },
): Promise<void> {
  const [x] = await tx.consultarParaAtualizar<Linha>(
    `SELECT ha.id, ha.versao, ha.suspenso, sc.categoria
       FROM horario_administracao ha
       JOIN situacao_checagem sc ON sc.id = ha.situacao_checagem_id
       JOIN prescricao_item_hemocomponente pih ON pih.prescricao_item_id = ha.prescricao_item_id
      WHERE ha.id = ? AND ha.estabelecimento_id = ? AND pih.id = ? AND ha.excluido_em IS NULL`,
    [h.horario, est, h.prescricaoItemHemocomponente ?? 0],
  );
  if (!x) throw recusa('horario-inexistente', 'O horário não é do hemocomponente desta requisição.');
  if (booleano(x['suspenso'])) throw recusa('horario-suspenso', 'A prescrição está suspensa: nada foi gravado.');
  if (!['pendente', 'atrasado', 'adiado'].includes(texto(x['categoria'])))
    throw recusa('horario-ja-checado', 'O horário já foi checado em outro terminal: nada foi gravado.');
  const adm = await tx.uma<{ id: number }>(
    `SELECT id FROM situacao_checagem WHERE categoria = 'administrado' AND ativo AND processo_enfermagem = 'administracao'
      ORDER BY ordem IS NULL, ordem, id LIMIT 1`,
  );
  if (!adm)
    throw recusa(
      'cadastro-incompleto',
      'O cadastro das situações da checagem não tem a categoria "administrado": peça a carga ao administrador.',
    );
  await tx.alterar('horario_administracao', num(x['id']), num(x['versao']), {
    situacao_checagem_id: adm.id,
    situacao_checagem_em: h.ocorrido,
    quantidade_administrada: 1,
    administrado_por_profissional_id: h.profissional,
    administrado_em: h.ocorrido,
    canal_registro: 'estacao',
  });
  await tx.incluir('horario_administracao_evento', {
    horario_administracao_id: num(x['id']),
    operacao: 'alteracao',
    dados: JSON.stringify({
      ato: 'transfusao',
      atoTransfusional: h.ato,
      bolsa: h.bolsa,
      pulseiraLida: h.pulseiraLida,
      motivoSemPulseira: h.motivoSemPulseira,
      conferente: h.conferente,
      avisos: h.alertas.slice(0, 5),
    }),
    ocorrido_em: h.ocorrido,
    usuario_id: tx.contexto.usuario,
    evento: 'checagem',
    situacao_checagem_id: adm.id,
    quantidade_administrada: 1,
    profissional_id: h.profissional,
    canal_registro: 'estacao',
  });
}

// ── Montagem das leituras ───────────────────────────────────────────────────────────────────────────────────────

function itemDe(x: Linha, fuso: string): ItemHemoterapiaAAtender {
  const sigla = texto(x['sigla']);
  return {
    item: num(x['item']),
    prescricao: num(x['prescricao']),
    atendimento: num(x['atendimento_id']),
    paciente: { id: num(x['paciente_id']), nome: texto(x['nome']), prontuario: numOuNulo(x['numero_prontuario']) },
    hemocomponente: {
      codigo: sigla,
      rotulo: HEMOCOMPONENTES_VISTOS[sigla]?.rotulo ?? texto(x['hemocomponente_nome']),
      classe: classeDoHemocomponente(sigla),
    },
    dose: Number(x['quantidade'] ?? 1),
    unidadeDose: texto(x['unidade']) || 'UN',
    indicacao: textoOuNulo(x['indicacao_clinica']),
    iniciarAgora: booleano(x['iniciar_agora']),
    prescritoEm: civilDe(x['prescrito_em'], fuso) ?? '',
    vigenteAte: civilDe(x['vigencia_fim_em'], fuso),
    suspenso: texto(x['situacao_item']).startsWith('suspenso') || x['situacao_prescricao'] === 'suspensa',
    horarios: num(x['horarios']),
  };
}

/** O prazo da requisição: a data programada, ou o pedido mais o prazo de atendimento do tipo de transfusão. */
function prazoDe(x: Linha): Date | null {
  if (x['programada_para']) return new Date(x['programada_para'] as Date);
  const horas = numOuNulo(x['prazo_atendimento_horas']);
  const pedido = x['solicitado_em'] instanceof Date ? (x['solicitado_em'] as Date) : null;
  return horas === null || !pedido ? null : new Date(pedido.getTime() + horas * 3_600_000);
}

function requisicaoDe(x: Linha, fuso: string, agora: string): RequisicaoTransfusionalLida {
  const sigla = texto(x['sigla']);
  const estado = ESTADO_REQUISICAO[texto(x['situacao'])] ?? 'requisitada';
  const prazo = prazoDe(x);
  const prazoCivil = prazo ? localNoFusoSeguro(prazo, fuso) : null;
  const amostra = json<{ codigo: string; coletada: string; valida: string }>(x['amostra']);
  return {
    id: num(x['id']),
    item: num(x['item']),
    atendimento: num(x['atendimento_id']),
    paciente: { id: num(x['paciente_id']), nome: texto(x['nome']), prontuario: numOuNulo(x['numero_prontuario']) },
    hemocomponente: { codigo: sigla, rotulo: HEMOCOMPONENTES_VISTOS[sigla]?.rotulo ?? texto(x['hemocomponente_nome']) },
    quantidadeBolsas: num(x['quantidade_bolsas']),
    bolsasTransfundidas: num(x['quantidade_atendida']),
    volumeMl: numOuNulo(x['volume_ml']),
    urgencia: (codigoDoContrato(texto(x['urgencia'])) as UrgenciaTransfusao) ?? 'rotina',
    programadaPara: civilDe(x['programada_para'], fuso),
    prazo: prazoCivil,
    estado,
    indicacao: texto(x['indicacao']),
    termo: numOuNulo(x['termo_consentimento_paciente_id']),
    amostra: amostra
      ? {
          codigo: amostra.codigo,
          coletadaEm: civilDe(amostra.coletada, fuso) ?? '',
          validaAte: civilDe(amostra.valida, fuso) ?? '',
        }
      : null,
    tipagem: tipagemDe(x['tipo_sanguineo'], x['fator_rh']),
    requisitadaEm: civilDe(x['solicitado_em'], fuso) ?? '',
    requisitadaPor: texto(x['login']),
    prescricao: num(x['prescricao_id']),
    examesDeApoio: textoOuNulo(x['exames_apoio']),
    justificativaUrgencia: textoOuNulo(x['justificativa_urgencia']),
    transfusaoAnterior: codigoDoContrato(texto(x['transfusao_anterior'])),
    reacaoAnterior: codigoDoContrato(texto(x['reacao_anterior'])),
    gestacaoAnterior: codigoDoContrato(texto(x['gestacao_anterior'])),
    motivoCancelamento: textoOuNulo(x['observacao_cancelamento']),
    atrasada: estado !== 'atendida' && estado !== 'cancelada' && prazoCivil !== null && prazoCivil < agora,
  };
}

const localNoFusoSeguro = (d: Date, fuso: string) => civilDe(d, fuso);

function sinaisDe(s: Linha, fuso: string): SinaisRegistrados {
  const fr = numOuNulo(s['frequencia_respiratoria']);
  const spo2 = numOuNulo(s['saturacao_oxigenio']);
  return {
    momento: texto(s['momento']) as MomentoSinaisTransfusao,
    medidoEm: civilDe(s['medido_em'], fuso) ?? '',
    pas: num(s['pressao_sistolica']),
    pad: num(s['pressao_diastolica']),
    fc: num(s['frequencia_cardiaca']),
    temperatura: Number(s['temperatura']),
    ...(fr !== null ? { fr } : {}),
    ...(spo2 !== null ? { spo2 } : {}),
  };
}

/** Os códigos de urgência do contrato (para conferência dos catálogos do cliente). */
export const CODIGOS_TIPO_TRANSFUSAO = URGENCIAS_TRANSFUSAO.map((u) => codigoDoBanco(u.codigo));

/** Porta indisponível (fora de dev/ci sem o núcleo): 503 em tudo. */
export const portaTransfusaoIndisponivel = (): PortaTransfusao =>
  portaIndisponivel<PortaTransfusao>(METODOS_PORTA_TRANSFUSAO);
