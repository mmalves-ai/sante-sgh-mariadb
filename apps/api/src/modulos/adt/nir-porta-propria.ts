// Porta do NIR (M44) sobre o banco do cliente, pelo @sgh/nucleo: a solicitação de leito é o pedido de leito
// (pedido_leito, com a situação do cadastro situacao_pedido_leito), a reserva é a reserva de leito (reserva_leito), a
// alta prevista é a previsão de alta (previsao_alta), as barreiras são as barreiras de alta (barreira_alta) e a
// regulação é a solicitação à central (solicitacao_regulacao). Leituras somente leitura filtradas pelo
// estabelecimento da sessão e pelos excluídos; gravações numa operação do Executor (trilha, outbox e idempotência na
// mesma transação).
// Melhoria: o estado da solicitação vem do cadastro de situações do pedido de leito (cada situação aponta o estado do
// NIR): o "de-para" aprovado é a própria coluna `estado`, sem tabela à parte; a reserva vigente única por leito é
// garantida pelo banco (coluna vigente); a exclusão é lógica, com o retrato na trilha.
// Os limites de permanência por clínica, CID ou procedimento ficam em limite_permanencia (um por chave e
// estabelecimento; a remoção volta ao padrão, com o retrato na trilha).
// Pendências: a calibragem pelos histogramas e as cirurgias que pedem UTI aguardam o vínculo do agendamento cirúrgico ao
// pedido de leito (por ora, sem linhas).
// Melhoria: o responsável da barreira de alta é o usuário (login) ou o setor do estabelecimento, nas colunas próprias,
// e a descrição fica limpa; as gravações das barreiras travam a linha pela internação do estabelecimento da sessão.
// Melhoria: a gravação direta leva a chave de idempotência da requisição (apoio-idempotente.ts).
import { randomUUID } from 'node:crypto';
import type {
  ChaveLeito,
  EscopoLimitePermanencia,
  EstadoSolicitacaoNir,
  OrigemSolicitacaoNir,
  PrioridadeNir,
  SituacaoReserva,
  TipoBarreiraAlta,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  gravarTrilha,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { DestinoPorta, LiberacaoGravacao, TrilhaDaGravacao } from '../exames/public-api.js';
import { FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import type { ContextoNir, GravadorNir, PortaNir } from './nir-porta.js';
import { apoio, leitoDaChave, n, nn, texto } from './operacoes.js';
import type {
  AltaPrevistaRegistrada,
  BarreiraDaAlta,
  ConfiguracaoRegulacaoNir,
  EventoSolicitacaoNir,
  HistogramasPermanencia,
  InternadoDoQuadro,
  RegistroRegulacaoNir,
  ReservaLeitoNir,
  SolicitacaoLeitoNir,
} from './tipos.js';
import { chaveDaGravacaoDireta, type ComIdempotencia } from './apoio-idempotente.js';

export type NucleoNir = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;
type Linha = Record<string, unknown>;
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const TETO = 500;

const ORIGEM_DO_SETOR: Readonly<Record<string, OrigemSolicitacaoNir>> = {
  pronto_atendimento: 'pa',
  bloco_cirurgico: 'cirurgia',
  internacao: 'internado',
  ambulatorio: 'eletiva',
  externo: 'externa',
  regulacao: 'externa',
};
const SETOR_DA_ORIGEM: Readonly<Record<OrigemSolicitacaoNir, string>> = {
  pa: 'pronto_atendimento',
  cirurgia: 'bloco_cirurgico',
  internado: 'internacao',
  eletiva: 'ambulatorio',
  externa: 'externo',
};
const PRIORIDADE_DO_BANCO: Readonly<Record<string, PrioridadeNir>> = {
  emergencia: 'emergencia',
  alta: 'urgente',
  media: 'prioritario',
  baixa: 'eletivo' as PrioridadeNir,
};
const PRIORIDADE_DA_TELA: Readonly<Record<string, string>> = {
  emergencia: 'emergencia',
  urgente: 'alta',
  prioritario: 'media',
  eletivo: 'baixa',
};

const TABELAS_NIR = [
  'pedido_leito',
  'reserva_leito',
  'previsao_alta',
  'barreira_alta',
  'situacao_pedido_leito',
  'solicitacao_regulacao',
  'internacao',
  'limite_permanencia',
];

const SQL_PEDIDO = `
  SELECT pl.id, pl.versao, pl.setor_origem, pl.paciente_id, p.numero_prontuario, COALESCE(p.nome_social, pf.nome) AS nome,
         sx.sigla AS sexo, pf.data_nascimento, pl.atendimento_id, a.numero AS cabecalho, pl.internacao_id, pl.prioridade,
         pl.data_hora_prevista, pl.nivel_cuidado, tp.codigo AS precaucao, pl.categoria_acomodacao_id, pl.especialidade_medica_id,
         pl.cid_termo_terminologia_id, pl.justificativa, sp.estado, pl.solicitante_profissional_id, u.login,
         pl.data_hora_pedido, pl.data_hora_atendido, pl.data_hora_cancelamento, pl.motivo_cancelamento, mi.classificacao
    FROM pedido_leito pl
    JOIN paciente p ON p.id = pl.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN sexo sx ON sx.id = pf.sexo_id
    LEFT JOIN atendimento a ON a.id = pl.atendimento_id
    LEFT JOIN tipo_precaucao tp ON tp.id = pl.tipo_precaucao_id
    JOIN situacao_pedido_leito sp ON sp.id = pl.situacao_pedido_leito_id
    LEFT JOIN usuario u ON u.id = pl.criado_por
    LEFT JOIN internacao i ON i.id = pl.internacao_id
    LEFT JOIN modalidade_internacao mi ON mi.id = i.modalidade_internacao_id
   WHERE pl.estabelecimento_id = ? AND pl.excluido_em IS NULL`;

function solicitacaoDe(r: Linha): SolicitacaoLeitoNir {
  return {
    id: n(r['id']),
    origem: ORIGEM_DO_SETOR[texto(r['setor_origem'])] ?? 'externa',
    paciente: n(r['paciente_id']),
    prontuario: nn(r['numero_prontuario']),
    nome: texto(r['nome']),
    sexo: r['sexo'] === null ? null : texto(r['sexo']),
    nascimento: r['data_nascimento'] instanceof Date ? r['data_nascimento'].toISOString().slice(0, 10) : null,
    atendimento: nn(r['atendimento_id']),
    cabecalho: r['cabecalho'] === null ? null : texto(r['cabecalho']),
    internacao: nn(r['internacao_id']),
    cirurgia: null,
    prioridade: PRIORIDADE_DO_BANCO[texto(r['prioridade'])] ?? 'prioritario',
    prazoEm: iso(r['data_hora_prevista']) ?? iso(r['data_hora_pedido']) ?? '',
    intensiva: r['nivel_cuidado'] === 'intensivo' || r['nivel_cuidado'] === 'semi_intensivo',
    precaucao: (r['precaucao'] as SolicitacaoLeitoNir['precaucao']) ?? null,
    tiposAcomodacao: r['categoria_acomodacao_id'] === null ? [] : [n(r['categoria_acomodacao_id'])],
    clinica: r['classificacao'] === 'cirurgica' ? 'C' : 'M',
    especialidade: nn(r['especialidade_medica_id']),
    cid: nn(r['cid_termo_terminologia_id']),
    justificativa: texto(r['justificativa']),
    estado: texto(r['estado']) as EstadoSolicitacaoNir,
    versao: n(r['versao']),
    vinculo: n(r['solicitante_profissional_id']),
    solicitadoPor: texto(r['login']),
    solicitadoEm: iso(r['data_hora_pedido']) ?? '',
    regGerado: nn(r['internacao_id']),
    concluidoEm: iso(r['data_hora_atendido']) ?? iso(r['data_hora_cancelamento']),
  };
}

const SQL_RESERVA = `
  SELECT r.id, r.pedido_leito_id, COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao, lh.codigo AS leito, r.situacao,
         r.valida_ate, r.excecao_perfil, u.login, r.reservado_em, r.confirmada_em, r.encerrada_em, r.motivo_encerramento,
         r.conflito_em, r.conflito_internacao_id
    FROM reserva_leito r
    JOIN leito_hospitalar lh ON lh.id = r.leito_hospitalar_id
    JOIN acomodacao ac ON ac.id = lh.acomodacao_id
    LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
    LEFT JOIN usuario u ON u.id = r.criado_por
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.pedido_leito_id IS NOT NULL`;

const reservaDe = (r: Linha): ReservaLeitoNir => ({
  id: n(r['id']),
  solicitacao: n(r['pedido_leito_id']),
  bloco: texto(r['bloco']),
  acomodacao: texto(r['acomodacao']),
  leito: texto(r['leito']),
  situacao: texto(r['situacao']) as SituacaoReserva,
  validaAte: iso(r['valida_ate']) ?? '',
  excecao: r['excecao_perfil'] === null ? null : texto(r['excecao_perfil']),
  criadaPor: texto(r['login']),
  criadaEm: iso(r['reservado_em']) ?? '',
  confirmadaEm: iso(r['confirmada_em']),
  encerradaEm: iso(r['encerrada_em']),
  motivoEncerramento: r['motivo_encerramento'] === null ? null : texto(r['motivo_encerramento']),
  conflitoEm: iso(r['conflito_em']),
  conflitoReg: nn(r['conflito_internacao_id']),
});

export class PortaNirPropria implements PortaNir {
  readonly destino: DestinoPorta = 'banco';
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoNir,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoNir): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao,
    };
  }

  private ler<T>(c: ContextoNir, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(this.contexto(c), async (l) => {
      const f = await l.uma<{ fuso_horario: string | null }>(
        'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
        [est],
      );
      return fn(l, est, f?.fuso_horario || FUSO_PADRAO);
    });
  }

  async podeGravar(c: ContextoNir): Promise<LiberacaoGravacao> {
    return c.estabelecimento === null
      ? { pode: false, codigo: 'sem-estabelecimento', motivo: 'Escolha o estabelecimento da sessão.' }
      : { pode: true, codigo: null, motivo: null };
  }

  /** O NIR grava pelas gravações diretas (gravarSgh); a admissão e a transferência vindas dele são da porta da internação. */
  async executar(): Promise<never> {
    throw recusa('operacao-desconhecida', 'O NIR grava pelas ações próprias; a admissão é pela internação.');
  }

  async gravarSgh<T>(
    c: ContextoNir,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorNir) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: 'nir.gravacao-direta',
      tabelas: TABELAS_NIR,
      entrada: z.object({ chave: z.string() }),
      gravar: async (tx) => {
        saida = { valor: await fn(gravadorNir(tx, est)) };
        return { valor: saida.valor } as unknown as ResultadoOperacao;
      },
      alvo: () => ({ tabela: linha()?.entidade ?? 'pedido_leito', id: linha()?.entidadeId ?? null }),
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = chaveDaGravacaoDireta(c as ComIdempotencia, 'nir', randomUUID);
    const ctx: ContextoOperacao = {
      ...this.contexto(c),
      correlacao: c.correlacao || 'nir',
      chaveIdempotencia: chave,
    };
    const r = await this.executor.executar(op, c.cliente, { chave }, ctx);
    return (r.resultado as unknown as { valor: T }).valor;
  }

  relogio(c: ContextoNir) {
    return this.ler(c, async (_l, _e, fuso) => {
      const r = relogioNoFuso(fuso);
      const hms = new Intl.DateTimeFormat('en-GB', {
        timeZone: fuso,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
      return { hoje: r.hoje, agora: `${r.hoje}T${hms}` };
    });
  }

  abertas(c: ContextoNir) {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `${SQL_PEDIDO} AND sp.estado IN ('solicitado','em_analise','reservado','em_transito') ORDER BY pl.data_hora_pedido LIMIT ${TETO + 1}`,
        [est],
      );
      return { itens: ls.slice(0, TETO).map(solicitacaoDe), cortada: ls.length > TETO };
    });
  }

  solicitacao(c: ContextoNir, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_PEDIDO} AND pl.id = ?`, [est, id]);
      return r ? solicitacaoDe(r) : null;
    });
  }

  /** Os eventos da solicitação pelos marcos do pedido (pedido, atendimento e cancelamento). */
  eventos(c: ContextoNir, ids: readonly number[]): Promise<EventoSolicitacaoNir[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(`${SQL_PEDIDO} AND pl.id IN (${lista(ids.length)})`, [est, ...ids]);
      return ls.flatMap((r) => {
        const s = solicitacaoDe(r);
        const ev: EventoSolicitacaoNir[] = [
          {
            solicitacao: s.id,
            acao: 'solicitar',
            de: null,
            para: 'solicitado',
            motivo: null,
            por: s.solicitadoPor,
            em: s.solicitadoEm,
          },
        ];
        if (r['data_hora_atendido'])
          ev.push({
            solicitacao: s.id,
            acao: 'internar',
            de: null,
            para: 'internado',
            motivo: null,
            por: '',
            em: iso(r['data_hora_atendido']) ?? '',
          });
        if (r['data_hora_cancelamento'])
          ev.push({
            solicitacao: s.id,
            acao: 'cancelar',
            de: null,
            para: s.estado,
            motivo: r['motivo_cancelamento'] === null ? null : texto(r['motivo_cancelamento']),
            por: '',
            em: iso(r['data_hora_cancelamento']) ?? '',
          });
        return ev;
      });
    });
  }

  concluidas(c: ContextoNir, desde: string) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT data_hora_pedido, data_hora_atendido, data_hora_prevista FROM pedido_leito
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND data_hora_atendido >= ? LIMIT 20000`,
          [est, `${desde} 00:00:00`],
        )
      ).map((r) => ({
        solicitadoEm: iso(r['data_hora_pedido']) ?? '',
        internadoEm: iso(r['data_hora_atendido']) ?? '',
        prazoEm: iso(r['data_hora_prevista']) ?? iso(r['data_hora_pedido']) ?? '',
      })),
    );
  }

  reservasVigentes(c: ContextoNir) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(`${SQL_RESERVA} AND r.situacao IN ('ativa','confirmada') ORDER BY r.reservado_em`, [
          est,
        ])
      ).map(reservaDe),
    );
  }

  reservasEncerradas(c: ContextoNir) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_RESERVA} AND r.situacao NOT IN ('ativa','confirmada') ORDER BY r.encerrada_em DESC LIMIT ${TETO}`,
          [est],
        )
      ).map(reservaDe),
    );
  }

  /** Pendente: o agendamento cirúrgico que pede UTI ainda não se liga ao pedido de leito. */
  async cirurgiasUti() {
    return [];
  }

  async cirurgiasComSolicitacao() {
    return new Set<number>();
  }

  internados(c: ContextoNir) {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT i.id, p.numero_prontuario, i.paciente_id, COALESCE(p.nome_social, pf.nome) AS nome, COALESCE(b.codigo, '') AS bloco,
                ac.codigo AS acomodacao, lh.codigo AS leito, mi.classificacao, i.data_hora_entrada, t.codigo_termo AS cid,
                COALESCE(i.procedimento_solicitado_procedimento_sigtap_id, i.procedimento_solicitado_item_faturavel_id) AS proc
           FROM internacao i
           JOIN paciente p ON p.id = i.paciente_id JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           JOIN modalidade_internacao mi ON mi.id = i.modalidade_internacao_id
           LEFT JOIN leito_hospitalar lh ON lh.id = i.leito_hospitalar_id
           LEFT JOIN acomodacao ac ON ac.id = COALESCE(lh.acomodacao_id, i.acomodacao_id)
           LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
           LEFT JOIN termo_terminologia t ON t.id = i.cid_principal_termo_terminologia_id
          WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.situacao IN ('ativa','alta_medica')
          ORDER BY i.data_hora_entrada LIMIT ${TETO + 1}`,
        [est],
      );
      const ids = ls.slice(0, TETO).map((r) => n(r['id']));
      const trechos = ids.length
        ? await l.consultar(
            `SELECT o.internacao_id, ac.categoria_acomodacao_id, o.data_hora_inicio, o.data_hora_fim FROM ocupacao_leito o
               JOIN acomodacao ac ON ac.id = o.acomodacao_id
              WHERE o.internacao_id IN (${lista(ids.length)}) AND o.situacao <> 'cancelada' AND o.excluido_em IS NULL ORDER BY o.data_hora_inicio`,
            ids,
          )
        : [];
      const itens: InternadoDoQuadro[] = ls.slice(0, TETO).map((r) => ({
        reg: n(r['id']),
        pront: n(r['numero_prontuario']),
        paciente: n(r['paciente_id']),
        nome: texto(r['nome']),
        bloco: texto(r['bloco']),
        acomodacao: texto(r['acomodacao']),
        leito: texto(r['leito']),
        clinica: r['classificacao'] === 'cirurgica' ? 'C' : r['classificacao'] === 'pediatrica' ? 'N' : 'M',
        entrada: iso(r['data_hora_entrada']) ?? '',
        procedimento: r['proc'] === null ? null : texto(r['proc']),
        cid: r['cid'] === null ? null : texto(r['cid']),
        trechos: trechos
          .filter((t) => n(t['internacao_id']) === n(r['id']))
          .map((t) => ({
            tipo: n(t['categoria_acomodacao_id']),
            entrada: iso(t['data_hora_inicio']) ?? '',
            saida: iso(t['data_hora_fim']),
          })),
      }));
      return { itens, cortada: ls.length > TETO };
    });
  }

  internacao(c: ContextoNir, reg: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        'SELECT i.id, p.numero_prontuario, i.situacao FROM internacao i JOIN paciente p ON p.id = i.paciente_id WHERE i.id = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL',
        [reg, est],
      );
      return r
        ? {
            reg: n(r['id']),
            pront: n(r['numero_prontuario']),
            internado: ['ativa', 'alta_medica'].includes(texto(r['situacao'])),
          }
        : null;
    });
  }

  dpas(c: ContextoNir, regs: readonly number[]): Promise<AltaPrevistaRegistrada[]> {
    if (regs.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT pa.id, pa.internacao_id, pa.data_prevista, pa.motivo_mudanca, pa.operacao, pa.ocorrido_em, u.login
             FROM previsao_alta pa JOIN internacao i ON i.id = pa.internacao_id LEFT JOIN usuario u ON u.id = pa.usuario_id
            WHERE i.estabelecimento_id = ? AND pa.internacao_id IN (${lista(regs.length)}) ORDER BY pa.ocorrido_em, pa.id`,
          [est, ...regs],
        )
      ).map((r) => ({
        id: n(r['id']),
        reg: n(r['internacao_id']),
        data:
          r['data_prevista'] instanceof Date
            ? r['data_prevista'].toISOString().slice(0, 10)
            : texto(r['data_prevista']),
        motivo: r['motivo_mudanca'] === null ? null : texto(r['motivo_mudanca']),
        por: texto(r['login']),
        em: iso(r['ocorrido_em']) ?? '',
        retirada: r['operacao'] === 'exclusao',
      })),
    );
  }

  barreiras(c: ContextoNir, regs: readonly number[]): Promise<BarreiraDaAlta[]> {
    if (regs.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT ba.id, ba.internacao_id, tb.codigo AS tipo, ba.descricao, COALESCE(ur.login, sr.nome) AS responsavel, ba.prazo_em, ba.situacao,
                  uc.login AS criada_por, ba.identificada_em, ba.resolvida_em
             FROM barreira_alta ba JOIN internacao i ON i.id = ba.internacao_id
             JOIN tipo_barreira_alta tb ON tb.id = ba.tipo_barreira_alta_id
             LEFT JOIN usuario ur ON ur.id = ba.responsavel_usuario_id LEFT JOIN usuario uc ON uc.id = ba.criado_por
             LEFT JOIN setor_funcional sr ON sr.id = ba.responsavel_setor_funcional_id
            WHERE i.estabelecimento_id = ? AND ba.excluido_em IS NULL AND ba.internacao_id IN (${lista(regs.length)}) ORDER BY ba.identificada_em`,
          [est, ...regs],
        )
      ).map((r) => ({
        id: n(r['id']),
        reg: n(r['internacao_id']),
        tipo: texto(r['tipo']) as TipoBarreiraAlta,
        descricao: texto(r['descricao']),
        responsavel: texto(r['responsavel']),
        prazo: iso(r['prazo_em']) ?? '',
        situacao:
          r['situacao'] === 'em_tratamento' ? 'aberta' : (texto(r['situacao']) as BarreiraDaAlta['situacao']),
        criadaPor: texto(r['criada_por']),
        criadaEm: iso(r['identificada_em']) ?? '',
        resolvidaEm: iso(r['resolvida_em']),
      })),
    );
  }

  barreira(c: ContextoNir, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        'SELECT ba.id, ba.internacao_id, ba.situacao FROM barreira_alta ba JOIN internacao i ON i.id = ba.internacao_id WHERE ba.id = ? AND i.estabelecimento_id = ? AND ba.excluido_em IS NULL',
        [id, est],
      );
      return r ? { id: n(r['id']), reg: n(r['internacao_id']), situacao: texto(r['situacao']) } : null;
    });
  }

  /** Os limites próprios do estabelecimento; a chave sem limite próprio segue o padrão dos parâmetros. */
  limites(c: ContextoNir) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT escopo, chave, amarelo_dias, vermelho_dias, forma, amostra FROM limite_permanencia
            WHERE estabelecimento_id = ? AND ativo = TRUE ORDER BY escopo, chave`,
          [est],
        )
      ).map((r) => ({
        escopo: texto(r['escopo']) as EscopoLimitePermanencia,
        chave: texto(r['chave']),
        amareloDias: n(r['amarelo_dias']),
        vermelhoDias: n(r['vermelho_dias']),
        origem: texto(r['forma']),
        amostra: nn(r['amostra']),
      })),
    );
  }

  depara(c: ContextoNir) {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT s.id, s.estado, COALESCE(u.login, '') AS login, COALESCE(s.alterado_em, s.criado_em) AS em
             FROM situacao_pedido_leito s LEFT JOIN usuario u ON u.id = COALESCE(s.alterado_por, s.criado_por)
            WHERE s.ativo = TRUE ORDER BY s.ordem_exibicao, s.id`,
        )
      ).map((r) => ({
        situacao: n(r['id']),
        estado: texto(r['estado']) as EstadoSolicitacaoNir,
        aprovadoPor: texto(r['login']),
        aprovadoEm: iso(r['em']) ?? '',
      })),
    );
  }

  situacoes(c: ContextoNir) {
    return this.ler(c, async (l) => {
      const ls = await l.consultar(
        'SELECT id, descricao FROM situacao_pedido_leito ORDER BY ordem_exibicao, id',
      );
      return new Map(ls.map((r) => [n(r['id']), texto(r['descricao'])]));
    });
  }

  /** Pendente: a calibragem pelos histogramas acompanha os limites de permanência (pedido de DDL). */
  async histogramas(): Promise<HistogramasPermanencia> {
    return { portaria312: [], diariasFaturaveis: [], uti: [], nomes: new Map() };
  }

  regulacoes(c: ContextoNir, solicitacoes: readonly number[]): Promise<RegistroRegulacaoNir[]> {
    if (solicitacoes.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT r.id, r.pedido_leito_id, cr.sigla, r.sentido, r.numero, r.situacao, r.origem, r.observacao,
                  r.solicitacao_anterior_id, r.mensagem_hash, u.login, r.solicitado_em
             FROM solicitacao_regulacao r JOIN central_reguladora cr ON cr.id = r.central_reguladora_id
             LEFT JOIN usuario u ON u.id = r.criado_por
            WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.pedido_leito_id IN (${lista(solicitacoes.length)})
            ORDER BY r.solicitado_em, r.id`,
          [est, ...solicitacoes],
        )
      ).map((r) => ({
        id: n(r['id']),
        solicitacao: n(r['pedido_leito_id']),
        central: texto(r['sigla']),
        sentido: texto(r['sentido']) as 'entrada' | 'saida',
        numero: texto(r['numero']),
        situacao: texto(r['situacao']),
        origem: r['origem'] === 'integracao' ? 'conector' : 'manual',
        observacao: r['observacao'] === null ? null : texto(r['observacao']),
        anterior: nn(r['solicitacao_anterior_id']),
        mensagemHash: r['mensagem_hash'] === null ? null : texto(r['mensagem_hash']),
        por: texto(r['login']),
        em: iso(r['solicitado_em']) ?? '',
      })),
    );
  }

  configuracaoRegulacao(c: ContextoNir): Promise<ConfiguracaoRegulacaoNir> {
    return this.ler(c, async (l, est) => {
      const sistemas = await l.consultar(
        `SELECT cr.id, cr.sigla, cr.ativo,
                (SELECT COUNT(*) FROM servico_regulacao s WHERE s.central_reguladora_id = cr.id AND s.estabelecimento_id = ? AND s.excluido_em IS NULL) AS servicos,
                (SELECT COUNT(*) FROM servico_regulacao s WHERE s.central_reguladora_id = cr.id AND s.estabelecimento_id = ? AND s.excluido_em IS NULL AND s.ativo) AS ativos
           FROM central_reguladora cr WHERE cr.excluido_em IS NULL ORDER BY cr.sigla`,
        [est, est],
      );
      const servicos = await l.consultar(
        'SELECT id, descricao, codigo_central FROM servico_regulacao WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY descricao',
        [est],
      );
      return {
        sistemas: sistemas.map((r) => ({
          id: n(r['id']),
          sigla: texto(r['sigla']),
          ativo: r['ativo'] === true || r['ativo'] === 1,
          servicos: n(r['servicos']),
          servicosAtivos: n(r['ativos']),
        })),
        endpoints: servicos.map((r) => ({
          id: n(r['id']),
          servico: n(r['id']),
          descricao: texto(r['descricao']),
          metodo: texto(r['codigo_central']) || null,
        })),
        tabelas: [],
      };
    });
  }
}

// ── Gravações do NIR (na transação da operação "nir.gravacao-direta") ─────────────────────────────

function gravadorNir(tx: TxOperacao, est: number): GravadorNir {
  const usuario = () => {
    if (tx.contexto.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
    return tx.contexto.usuario;
  };
  const situacaoDoEstado = (estado: string) =>
    apoio(
      tx,
      'SELECT id FROM situacao_pedido_leito WHERE estado = ? AND ativo = TRUE ORDER BY ordem_exibicao, id LIMIT 1',
      [estado],
      `a situação de pedido de leito "${estado}"`,
    );
  // A cópia do estado na linha (estado_situacao), presa à situação pela chave composta (07_INT/24).
  const situacaoEEstado = async (id: number) => ({
    situacao_pedido_leito_id: id,
    estado_situacao: texto(
      (await tx.uma('SELECT estado FROM situacao_pedido_leito WHERE id = ?', [id]))?.['estado'],
    ),
  });
  const pedido = async (id: number) => {
    const [p] = await tx.consultarParaAtualizar(
      'SELECT pl.id, pl.versao, pl.data_hora_pedido, sp.estado FROM pedido_leito pl JOIN situacao_pedido_leito sp ON sp.id = pl.situacao_pedido_leito_id WHERE pl.id = ? AND pl.estabelecimento_id = ? AND pl.excluido_em IS NULL',
      [id, est],
    );
    if (!p)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Solicitação não encontrada',
        'A solicitação de leito não existe.',
      );
    return p;
  };
  const reserva = async (id: number) => {
    const [r] = await tx.consultarParaAtualizar(
      'SELECT id, versao, situacao, pedido_leito_id, leito_hospitalar_id, internacao_id FROM reserva_leito WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
    );
    if (!r)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Reserva não encontrada',
        'A reserva de leito não existe.',
      );
    return r;
  };
  const internacaoDe = async (reg: number) => {
    const i = await tx.uma(
      'SELECT id, paciente_id FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [reg, est],
    );
    if (!i)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Internação não encontrada',
        'A internação não existe neste estabelecimento.',
      );
    return i;
  };
  const precaucao = async (codigo: string | null | undefined) =>
    codigo ? nn((await tx.uma('SELECT id FROM tipo_precaucao WHERE codigo = ?', [codigo]))?.['id']) : null;
  const minutos = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
  /** A barreira de uma internação do estabelecimento da sessão, travada (outro estabelecimento: não existe). */
  const barreiraTravada = async (id: number) => {
    const [x] = await tx.consultarParaAtualizar(
      `SELECT ba.id, ba.versao, ba.situacao FROM barreira_alta ba JOIN internacao i ON i.id = ba.internacao_id
        WHERE ba.id = ? AND i.estabelecimento_id = ? AND ba.excluido_em IS NULL`,
      [id, est],
    );
    if (!x)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Barreira não encontrada',
        'A barreira de alta não existe neste estabelecimento.',
      );
    return x;
  };
  /** O responsável da barreira: o login de um usuário ou o código (ou nome) de um setor do estabelecimento. */
  const responsavelDe = async (quem: string) => {
    const u = await tx.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [quem]);
    if (u) return { responsavel_usuario_id: n(u['id']), responsavel_setor_funcional_id: null };
    const porCodigo = await tx.uma(
      'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ? AND ativo = TRUE AND excluido_em IS NULL',
      [est, quem],
    );
    const setores = porCodigo
      ? [porCodigo]
      : await tx.consultar(
          'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND UPPER(nome) = UPPER(?) AND ativo = TRUE AND excluido_em IS NULL LIMIT 2',
          [est, quem],
        );
    if (setores.length > 1)
      throw recusa('responsavel-ambiguo', 'Mais de um setor com esse nome: informe o código do setor.', {
        campos: ['responsavel'],
      });
    if (setores.length === 0)
      throw recusa(
        'responsavel-inexistente',
        'Informe o login de um usuário ou o código ou o nome de um setor do estabelecimento.',
        { campos: ['responsavel'] },
      );
    return { responsavel_usuario_id: null, responsavel_setor_funcional_id: n(setores[0]?.['id']) };
  };
  return {
    async solicitar(s) {
      const agora = new Date();
      const numero = await tx.proximoNumero('pedido_leito');
      return tx.incluir('pedido_leito', {
        estabelecimento_id: est,
        numero: numero.formatado,
        paciente_id: s.paciente,
        atendimento_id: s.atendimento,
        setor_origem: SETOR_DA_ORIGEM[s.origem] ?? 'externo',
        solicitante_profissional_id: s.vinculo,
        especialidade_medica_id: s.especialidade,
        categoria_acomodacao_id: s.perfil.tiposAcomodacao[0] ?? null,
        tipo_precaucao_id: await precaucao(s.perfil.precaucao),
        exige_isolamento: s.perfil.precaucao !== null,
        nivel_cuidado: s.perfil.intensiva ? 'intensivo' : 'intermediario',
        prioridade: PRIORIDADE_DA_TELA[s.prioridade] ?? 'media',
        cid_termo_terminologia_id: s.cid,
        justificativa: s.justificativa,
        data_hora_pedido: agora,
        data_hora_prevista: minutos(agora, s.prazoMin),
        ...(await situacaoEEstado(s.situacaoCodigo ?? (await situacaoDoEstado('solicitado')))),
        internacao_id: s.internacao,
      });
    },
    async transicionar(t) {
      const p = await pedido(t.solicitacao);
      if (texto(p['estado']) !== t.de)
        throw new ErroOperacao(
          409,
          'conflito-versao',
          'Solicitação alterada',
          'A solicitação mudou de estado desde a leitura.',
          { colunas: ['situacao'] },
        );
      const muda: Record<string, unknown> = {
        ...(await situacaoEEstado(t.situacaoCodigo ?? (await situacaoDoEstado(t.para)))),
      };
      if (t.prioridade) muda['prioridade'] = PRIORIDADE_DA_TELA[t.prioridade] ?? 'media';
      if (t.prazoMinDesdeOPedido !== undefined && t.prazoMinDesdeOPedido !== null)
        muda['data_hora_prevista'] = minutos(p['data_hora_pedido'] as Date, t.prazoMinDesdeOPedido);
      if (t.para === 'cancelado' || t.para === 'rejeitado')
        Object.assign(muda, {
          data_hora_cancelamento: new Date(),
          motivo_cancelamento: (t.motivo?.trim() || t.para).slice(0, 500),
          cancelado_por_usuario_id: usuario(),
        });
      if (t.reserva) muda['reserva_leito_id'] = t.reserva;
      if (t.reg) muda['internacao_id'] = t.reg;
      await tx.alterar('pedido_leito', t.solicitacao, n(p['versao']), muda);
      return t.solicitacao;
    },
    async reservar(r) {
      const p = await tx.uma(
        'SELECT paciente_id, categoria_acomodacao_id FROM pedido_leito WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [r.solicitacao, est],
      );
      if (!p)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Solicitação não encontrada',
          'A solicitação de leito não existe.',
        );
      const leito = await leitoDaChave(tx, est, r.leito);
      const agora = new Date();
      return tx.incluir('reserva_leito', {
        estabelecimento_id: est,
        leito_hospitalar_id: n(leito['id']),
        pedido_leito_id: r.solicitacao,
        paciente_id: n(p['paciente_id']),
        categoria_acomodacao_id: nn(leito['categoria_acomodacao_id']),
        reservado_em: agora,
        valida_ate: minutos(agora, Math.max(1, r.validadeMin)),
        situacao: 'ativa',
        excecao_perfil: r.excecao,
        excecao_autorizada_por_usuario_id: r.excecao ? usuario() : null,
      });
    },
    async confirmarReserva(r) {
      const x = await reserva(r.reserva);
      if (x['situacao'] !== 'ativa')
        throw recusa('reserva-nao-ativa', 'A reserva não está aguardando confirmação.');
      const agora = new Date();
      return tx.alterar('reserva_leito', r.reserva, n(x['versao']), {
        situacao: 'confirmada',
        confirmada_em: agora,
        confirmada_por_usuario_id: usuario(),
        valida_ate: minutos(agora, Math.max(1, r.validadeMin)),
      });
    },
    async encerrarReserva(r) {
      const x = await reserva(r.reserva);
      if (!['ativa', 'confirmada'].includes(texto(x['situacao'])))
        throw recusa('reserva-encerrada', 'A reserva já foi encerrada.');
      if (r.situacao === 'consumida' && x['internacao_id'] === null)
        throw recusa('reserva-sem-internacao', 'A reserva só é consumida pela internação.');
      return tx.alterar('reserva_leito', r.reserva, n(x['versao']), {
        situacao: r.situacao,
        encerrada_em: r.vencidaEm ? new Date(r.vencidaEm) : new Date(),
        encerrada_por_usuario_id: usuario(),
        motivo_encerramento: r.motivo ?? null,
      });
    },
    async registrarDpa(d) {
      await internacaoDe(d.reg);
      const agora = new Date();
      return tx.incluir('previsao_alta', {
        internacao_id: d.reg,
        data_prevista: d.data,
        motivo_mudanca: d.motivo,
        informante_profissional_id: d.vinculo,
        operacao: d.anterior === null ? 'inclusao' : 'alteracao',
        ocorrido_em: agora,
        usuario_id: usuario(),
      });
    },
    async registrarBarreira(b) {
      await internacaoDe(b.reg);
      const tipo = await apoio(
        tx,
        'SELECT id FROM tipo_barreira_alta WHERE codigo = ?',
        [b.tipo],
        `o tipo de barreira de alta "${b.tipo}"`,
      );
      return tx.incluir('barreira_alta', {
        internacao_id: b.reg,
        tipo_barreira_alta_id: tipo,
        descricao: b.descricao,
        ...(b.responsavel ? await responsavelDe(b.responsavel) : {}),
        identificada_em: new Date(),
        prazo_em: b.prazo ? new Date(b.prazo) : null,
        situacao: 'aberta',
      });
    },
    async resolverBarreira(b) {
      const x = await barreiraTravada(b.barreira);
      if (!['aberta', 'em_tratamento'].includes(texto(x['situacao'])))
        throw recusa('barreira-encerrada', 'A barreira já foi resolvida ou cancelada.');
      const agora = new Date();
      return tx.alterar('barreira_alta', b.barreira, n(x['versao']), {
        situacao: b.cancelar ? 'cancelada' : 'resolvida',
        resolvida_em: agora,
        resolvida_por_usuario_id: usuario(),
        resolucao: b.observacao,
      });
    },
    async gravarLimite(lim) {
      const [atual] = await tx.consultarParaAtualizar(
        'SELECT id, versao, amarelo_dias, vermelho_dias, forma, amostra, ativo FROM limite_permanencia WHERE estabelecimento_id = ? AND escopo = ? AND chave = ?',
        [est, lim.escopo, lim.chave],
      );
      const novo = {
        amarelo_dias: lim.amareloDias,
        vermelho_dias: lim.vermelhoDias,
        forma: lim.origem,
        amostra: lim.amostra,
      };
      if (!atual) {
        await tx.incluir('limite_permanencia', {
          estabelecimento_id: est,
          escopo: lim.escopo,
          chave: lim.chave,
          ...novo,
          ativo: true,
        });
        return;
      }
      const muda =
        n(atual['amarelo_dias']) !== novo.amarelo_dias ||
        n(atual['vermelho_dias']) !== novo.vermelho_dias ||
        texto(atual['forma']) !== novo.forma ||
        nn(atual['amostra']) !== novo.amostra ||
        !verdadeiro(atual['ativo']);
      if (!muda) return;
      // A alteração leva o motivo; o valor anterior fica na trilha da operação.
      if (verdadeiro(atual['ativo']) && !lim.motivo?.trim())
        throw recusa(
          'motivo-obrigatorio',
          'Informe o motivo da alteração: o valor anterior fica no histórico, com quem o definiu.',
        );
      await tx.alterar('limite_permanencia', n(atual['id']), n(atual['versao']), { ...novo, ativo: true });
    },
    async aprovarDepara(d) {
      const [s] = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM situacao_pedido_leito WHERE id = ?',
        [d.situacao],
      );
      if (!s)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Situação não encontrada',
          'A situação de pedido de leito não existe.',
        );
      await tx.alterar('situacao_pedido_leito', d.situacao, n(s['versao']), { estado: d.estado });
    },
    async registrarEvento(linha) {
      await gravarTrilha(tx, linha);
    },
    async corrigirSolicitacao(c) {
      const p = await pedido(c.solicitacao);
      if (n(p['versao']) !== c.versaoVista)
        throw new ErroOperacao(
          409,
          'conflito-versao',
          'Solicitação alterada',
          'A solicitação mudou desde a leitura.',
          { colunas: ['versao'] },
        );
      return tx.alterar('pedido_leito', c.solicitacao, c.versaoVista, {
        nivel_cuidado: c.perfil.intensiva ? 'intensivo' : 'intermediario',
        tipo_precaucao_id: await precaucao(c.perfil.precaucao),
        exige_isolamento: c.perfil.precaucao !== null,
        categoria_acomodacao_id: c.perfil.tiposAcomodacao[0] ?? null,
      });
    },
    async alterarReserva(r) {
      const x = await reserva(r.reserva);
      if (!['ativa', 'confirmada'].includes(texto(x['situacao'])))
        throw recusa('reserva-encerrada', 'A reserva já foi encerrada.');
      const atual = await tx.uma(
        `SELECT COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao, lh.codigo AS leito FROM leito_hospitalar lh JOIN acomodacao ac ON ac.id = lh.acomodacao_id
          LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id) WHERE lh.id = ?`,
        [n(x['leito_hospitalar_id'])],
      );
      const anterior: ChaveLeito = {
        bloco: texto(atual?.['bloco']),
        acomodacao: texto(atual?.['acomodacao']),
        leito: texto(atual?.['leito']),
      };
      const muda: Record<string, unknown> = {};
      let desfeita = false;
      if (r.leito) {
        const novo = await leitoDaChave(tx, est, r.leito);
        if (n(novo['id']) !== n(x['leito_hospitalar_id'])) {
          muda['leito_hospitalar_id'] = n(novo['id']);
          if (x['situacao'] === 'confirmada') {
            Object.assign(muda, { situacao: 'ativa', confirmada_em: null, confirmada_por_usuario_id: null });
            desfeita = true;
          }
        }
      }
      if (r.validadeMin !== null) muda['valida_ate'] = minutos(new Date(), Math.max(1, r.validadeMin));
      muda['observacao'] = r.motivo;
      await tx.alterar('reserva_leito', r.reserva, n(x['versao']), muda);
      return { solicitacao: n(x['pedido_leito_id']), leitoAnterior: anterior, confirmacaoDesfeita: desfeita };
    },
    async retirarDpa(d) {
      await internacaoDe(d.reg);
      return tx.incluir('previsao_alta', {
        internacao_id: d.reg,
        data_prevista: new Date().toISOString().slice(0, 10),
        motivo_mudanca: d.motivo,
        informante_profissional_id: d.vinculo,
        operacao: 'exclusao',
        dados: JSON.stringify({ anterior: d.anterior }),
        ocorrido_em: new Date(),
        usuario_id: usuario(),
      });
    },
    async alterarBarreira(b) {
      const x = await barreiraTravada(b.barreira);
      if (!['aberta', 'em_tratamento'].includes(texto(x['situacao'])))
        throw recusa('barreira-encerrada', 'A barreira já foi resolvida ou cancelada.');
      return tx.alterar('barreira_alta', b.barreira, n(x['versao']), {
        ...(b.descricao !== null ? { descricao: b.descricao } : {}),
        ...(b.responsavel !== null ? await responsavelDe(b.responsavel) : {}),
        ...(b.prazo !== null ? { prazo_em: new Date(b.prazo) } : {}),
      });
    },
    async removerLimite(lim) {
      const [atual] = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM limite_permanencia WHERE estabelecimento_id = ? AND escopo = ? AND chave = ? AND ativo = TRUE',
        [est, lim.escopo, lim.chave],
      );
      if (!atual)
        throw recusa('limite-inexistente', 'Não há limite próprio para esta chave: já vale o padrão.');
      await tx.excluir('limite_permanencia', n(atual['id']), n(atual['versao']));
      return 1;
    },
    async registrarRegulacao(r) {
      const p = await tx.uma(
        'SELECT paciente_id, internacao_id FROM pedido_leito WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [r.solicitacao, est],
      );
      if (!p)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Solicitação não encontrada',
          'A solicitação de leito não existe.',
        );
      const central = await apoio(
        tx,
        'SELECT id FROM central_reguladora WHERE sigla = ? AND excluido_em IS NULL',
        [r.central],
        `a central reguladora "${r.central}"`,
      );
      const id = await tx.incluir('solicitacao_regulacao', {
        estabelecimento_id: est,
        central_reguladora_id: central,
        numero: r.numero,
        sentido: r.sentido,
        solicitacao_anterior_id: r.anterior,
        pedido_leito_id: r.solicitacao,
        situacao: r.situacao,
        solicitado_em: new Date(),
        paciente_id: n(p['paciente_id']),
        internacao_id: nn(p['internacao_id']),
        mensagem_hash: r.mensagemHash,
        observacao: r.observacao,
        origem: r.origem === 'conector' ? 'integracao' : 'sistema',
      });
      return { id, outbox: null };
    },
  };
}
