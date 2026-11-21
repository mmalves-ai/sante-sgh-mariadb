// Porta própria do envio agendado de relatório (M34, regra 5; lote F2.2 05-17) sobre o banco do cliente, pelo
// @sgh/nucleo. Leitura: agendamento_relatorio (os vencidos do estabelecimento), relatorio (o código do catálogo),
// agendamento_relatorio_destinatario, usuario, lista_distribuicao_email e lista_distribuicao_email_membro (os e-mails),
// envio_relatorio (as falhas seguidas) e estabelecimento. Gravação pelo Executor (trilha na mesma transação), em dois
// passos: `reservar` ANTES de mandar o e-mail (linha de envio_relatorio "nao_enviado" e o próximo envio andando, com o
// agendamento travado) e `concluir` DEPOIS (a mesma linha ganha o resultado). Quem perde a reserva não envia.
// As horas são do relógio de parede do estabelecimento (os campos UTC do Date carregam a hora local), como a regra do
// domínio (proximoEnvio) e a coluna proximo_envio_em.
// Melhoria: as falhas seguidas são derivadas do histórico (envio_relatorio depois do último "enviado"), sem contador
// paralelo que possa divergir.
// Melhoria: os destinatários vêm do cadastro do agendamento (usuário, lista de distribuição ou endereço), só de usuário
// ativo e não bloqueado, de lista e membro ativos; os repetidos saem.
// Melhoria: o motivo da falha é gravado com os endereços de e-mail mascarados (nada de dado pessoal no histórico).
// Melhoria: o "último envio" só anda com envio feito; a falha fica no histórico com o motivo.
// Melhoria: no máximo um envio por vencimento. A reserva trava o agendamento (FOR UPDATE), confere que o vencimento lido
// ainda é o atual e o faz andar na mesma transação; a chave de idempotência é determinística (agendamento + vencimento,
// ou o id do job da fila), então duas instâncias do worker, o ciclo seguinte ou a nova tentativa do job não repetem o
// e-mail. A reserva presa (o processo caiu entre o envio e a conclusão) fica visível como "nao_enviado" com o motivo.
// Melhoria: só sai o relatório liberado (relatorio.situacao), do catálogo do produto ou do próprio estabelecimento; o
// suspenso, o descontinuado e o em conferência não saem.
// Melhoria: a lista de distribuição só vale se for do cliente inteiro ou do estabelecimento do agendamento (fronteira).
// Melhoria: o agendamento com avisar_falha = falso não alerta o dono.
// Melhoria: dados do envio com os destinatários mascarados, a forma de cada um (para, cópia, cópia oculta), os
// parâmetros e o que o cadastro pediu e o worker não cumpre (entrega por anexo, formato, condição, "só com linhas"),
// para o dono ver; os pedidos de modelo e contrato estão no saida/05-17.json.
import { createHash } from 'node:crypto';
import { proximoEnvio } from '@sgh/dominio-relatorio';
import { definirOperacao, ErroOperacao, type Executor, type Leitor, type Linha, recusa } from '@sgh/nucleo';
import { z } from 'zod';
import { codigosDosEstabelecimentos } from '../clientes-worker.js';

type Agenda = Parameters<typeof proximoEnvio>[0];

export interface AgendamentoVencido {
  readonly id: number;
  readonly estabelecimento: string;
  /** Código do relatório no catálogo. */
  readonly relatorio: string;
  readonly titulo: string;
  readonly parametros: Readonly<Record<string, string | number>>;
  readonly dono: number;
  /** O vencimento lido (relógio de parede): a reserva só vale se ele ainda for o atual. */
  readonly proximoEnvioEm: Date;
}

/** Forma de envio de cada destinatário (o agendamento grava para/cc/cco; a lista, para/copia/copia_oculta). */
export type FormaEnvio = 'para' | 'copia' | 'copia_oculta';

export interface DestinatariosEnvio {
  readonly destinatarios: string[];
  readonly dono: string | null;
  /** agendamento_relatorio.avisar_falha (sem o cadastro: verdadeiro). */
  readonly avisarFalha?: boolean;
  /** Quantos destinatários de cada forma (cada um recebe a sua própria mensagem). */
  readonly formas?: Readonly<Record<FormaEnvio, number>>;
}

/** De onde vem o envio: o vencimento do agendamento ou o job "enviar agora" da fila. */
export type OrigemEnvio =
  | { readonly tipo: 'vencido'; readonly previsto: Date }
  | { readonly tipo: 'fila'; readonly job: string };

export interface ReservaEnvio {
  readonly envio: number;
  readonly proximoEnvio: Date;
}

export interface ResultadoRegistroEnvio {
  readonly situacao: 'enviado' | 'falhou';
  readonly falha: string | null;
  readonly falhasSeguidas: number;
  readonly destinatarios?: number;
  /** Endereços do envio (vão mascarados aos dados do envio). */
  readonly enderecos?: readonly string[];
  readonly formas?: Readonly<Record<FormaEnvio, number>>;
}

export interface PortaEnvioRelatorio {
  estabelecimentos(): Promise<string[]>;
  nomeEstabelecimento(estabelecimento: string): Promise<string | null>;
  vencidos(estabelecimento: string, agoraParede: Date, teto?: number): Promise<AgendamentoVencido[]>;
  destinatarios(estabelecimento: string, agendamento: number): Promise<DestinatariosEnvio>;
  falhasSeguidas(estabelecimento: string, agendamento: number): Promise<number>;
  /** Reserva o envio antes de mandar o e-mail; null quando outro (instância, ciclo ou tentativa) já o reservou. */
  reservar(estabelecimento: string, agendamento: number, origem: OrigemEnvio, agoraParede: Date): Promise<ReservaEnvio | null>;
  /** Grava o resultado na linha reservada (e o último envio do agendamento, se enviado). */
  concluir(estabelecimento: string, envio: number, r: ResultadoRegistroEnvio): Promise<void>;
}

export interface NucleoEnvioRelatorio {
  lerSomente<T>(contexto: { readonly cliente: string; readonly correlacao: string }, fn: (l: Leitor) => Promise<T>): Promise<T>;
  criarExecutor(): Executor;
}

/** O relógio de parede do fuso (os campos UTC do Date carregam a hora local). */
export function agoraParede(agora: Date = new Date(), fuso = 'America/Sao_Paulo'): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  return new Date(
    Date.UTC(Number(p['year']), Number(p['month']) - 1, Number(p['day']), Number(p['hour']), Number(p['minute']), Number(p['second']), agora.getMilliseconds()),
  );
}

/** Dia da semana do banco (1 = domingo a 7 = sábado) para o do domínio (1 = segunda a 7 = domingo). */
export function diaSemanaDoDominio(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const d = Number(v);
  if (!Number.isInteger(d) || d < 1 || d > 7) throw new Error('Dia da semana do agendamento inválido.');
  return d === 1 ? 7 : d - 1;
}

/** Hora do banco (TIME, "HH:MM[:SS]") no formato numérico que a regra do domínio usa. */
export function horaDoDominio(v: unknown): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? ''));
  if (!m) throw new Error('Hora do envio inválida.');
  return Number(m[1]) * 100 + Number(m[2]);
}

/**
 * Dia do mês para o domínio, que aceita até 28 (o banco aceita 31 como "último dia"): acima de 28 vai a 28, para o
 * envio não pular o mês curto. Pedido no saida/05-17.json: a regra do domínio passar a aceitar o último dia.
 */
export function diaMesDoDominio(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Math.min(28, Math.max(1, Number(v)));
}

export function agendaDaLinha(x: Record<string, unknown>): Agenda {
  return {
    periodicidade: String(x['periodicidade']) as Agenda['periodicidade'],
    hora: horaDoDominio(x['hora_envio']),
    diaSemana: diaSemanaDoDominio(x['dia_semana']),
    diaMes: diaMesDoDominio(x['dia_mes']),
  };
}

/** O próximo envio depois deste: o vencido (ou sem data) anda pela agenda; o futuro (já remarcado) fica. */
export function proximoDepoisDoEnvio(agenda: Agenda, atual: Date | null, agora: Date): Date {
  return !atual || atual.getTime() <= agora.getTime() ? proximoEnvio(agenda, agora) : atual;
}

/** Endereços de e-mail mascarados (o motivo da falha pode trazer o endereço recusado). */
export function mascararEmails(texto: string): string {
  return texto.replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, '***@***');
}

/** Um endereço mascarado para os dados do envio: a primeira letra e o domínio. */
export function mascararEndereco(email: string): string {
  const i = email.lastIndexOf('@');
  return i <= 0 ? '***' : `${email[0]}***@${email.slice(i + 1)}`;
}

/** Forma de envio do banco no vocabulário único do worker. */
export function formaDe(v: unknown): FormaEnvio {
  const x = String(v ?? 'para');
  return x === 'cc' || x === 'copia' ? 'copia' : x === 'cco' || x === 'copia_oculta' ? 'copia_oculta' : 'para';
}

/** A chave de idempotência da reserva: determinística por agendamento e origem (vencimento ou job da fila). */
export function chaveDaReserva(agendamento: number, origem: OrigemEnvio): string {
  const o = origem.tipo === 'vencido' ? `vencido:${origem.previsto.toISOString()}` : `fila:${origem.job}`;
  return `rel.envio.${agendamento}.${createHash('sha256').update(o, 'utf8').digest('hex').slice(0, 40)}`;
}

/** Os parâmetros guardados (JSON) só com texto e número. */
export function parametrosDe(v: unknown): Record<string, string | number> {
  let o: unknown = v;
  if (typeof v === 'string') {
    try {
      o = JSON.parse(v);
    } catch {
      return {};
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const r: Record<string, string | number> = {};
  for (const [k, x] of Object.entries(o as Record<string, unknown>))
    if (typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))) r[k] = x;
  return r;
}

const data = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

const ENTRADA_RESERVA = z.object({
  estabelecimento: z.number().int().positive(),
  agendamento: z.number().int().positive(),
  /** O vencimento lido (ISO), no envio de vencido; nulo no "enviar agora" da fila. */
  previsto: z.string().min(10).max(40).nullable(),
  origem: z.enum(['vencido', 'fila']),
});
type EntradaReserva = z.infer<typeof ENTRADA_RESERVA>;

const ENTRADA_CONCLUSAO = z.object({
  estabelecimento: z.number().int().positive(),
  envio: z.number().int().positive(),
  situacao: z.enum(['enviado', 'falhou']),
  falha: z.string().min(1).max(1000).nullable(),
  destinatarios: z.number().int().nonnegative().max(65_535),
  dados: z.string().max(60_000),
});
type EntradaConclusao = z.infer<typeof ENTRADA_CONCLUSAO>;

const objeto = (v: unknown): Record<string, unknown> => {
  if (typeof v === 'string') {
    try {
      return objeto(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};

/** O que o cadastro pede e o envio por link não cumpre (vai aos dados do envio; pedido no saida/05-17.json). */
export function pedidoDoCadastro(a: Linha): Record<string, unknown> {
  return {
    entregaPedida: String(a['entrega'] ?? 'link'),
    entregaFeita: 'link',
    formatoPedido: String(a['formato'] ?? 'pdf'),
    validadeLinkHoras: a['validade_link_horas'] === null || a['validade_link_horas'] === undefined ? null : Number(a['validade_link_horas']),
    enviarSemLinhas: Boolean(Number(a['enviar_sem_linhas'] ?? 0)),
    temCondicao: a['condicao_envio'] !== null && a['condicao_envio'] !== undefined && String(a['condicao_envio']).trim() !== '',
    linhasAvaliadas: false,
  };
}

const REJEICAO_DA_RESERVA = new Set(['envio-ja-reservado', 'idempotencia-divergente']);

export class PortaEnvioRelatorioPropria implements PortaEnvioRelatorio {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoEnvioRelatorio,
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'relatorio-envio' }, fn);
  }

  estabelecimentos(): Promise<string[]> {
    return this.ler(codigosDosEstabelecimentos);
  }

  async nomeEstabelecimento(estabelecimento: string): Promise<string | null> {
    const r = await this.ler((l) =>
      l.uma('SELECT nome_fantasia FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [estabelecimento]),
    );
    return r ? String(r['nome_fantasia']) : null;
  }

  async vencidos(estabelecimento: string, agora: Date, teto = 20): Promise<AgendamentoVencido[]> {
    const limite = Math.max(1, Math.min(200, Math.trunc(teto)));
    const linhas = await this.ler((l) =>
      l.consultar(
        `SELECT a.id, a.nome, a.parametros, a.dono_usuario_id, a.proximo_envio_em, r.codigo AS relatorio
           FROM agendamento_relatorio a
           JOIN estabelecimento e ON e.id = a.estabelecimento_id AND e.excluido_em IS NULL
           JOIN relatorio r ON r.id = a.relatorio_id AND r.excluido_em IS NULL AND r.situacao = 'liberado'
                AND (r.estabelecimento_id IS NULL OR r.estabelecimento_id = a.estabelecimento_id)
          WHERE e.codigo = ? AND a.ativo AND a.proximo_envio_em IS NOT NULL AND a.proximo_envio_em <= ?
          ORDER BY a.proximo_envio_em, a.id
          LIMIT ?`,
        [estabelecimento, agora, limite],
        { teto: limite },
      ),
    );
    return linhas.map((x) => ({
      id: Number(x['id']),
      estabelecimento,
      relatorio: String(x['relatorio']),
      titulo: String(x['nome']),
      parametros: parametrosDe(x['parametros']),
      dono: Number(x['dono_usuario_id']),
      proximoEnvioEm: data(x['proximo_envio_em']) ?? agora,
    }));
  }

  async destinatarios(estabelecimento: string, agendamento: number): Promise<DestinatariosEnvio> {
    return this.ler(async (l) => {
      const a = await l.uma(
        `SELECT a.id, a.dono_usuario_id, a.avisar_falha FROM agendamento_relatorio a
           JOIN estabelecimento e ON e.id = a.estabelecimento_id AND e.excluido_em IS NULL
          WHERE a.id = ? AND e.codigo = ?`,
        [agendamento, estabelecimento],
      );
      if (!a) return { destinatarios: [], dono: null, avisarFalha: true };
      const linhas = await l.consultar(
        `SELECT COALESCE(d.email, u.email) AS email, d.forma_envio AS forma
           FROM agendamento_relatorio_destinatario d
           LEFT JOIN usuario u ON u.id = d.usuario_id AND u.excluido_em IS NULL AND u.situacao = 'ativo'
                AND u.bloqueado_em IS NULL
          WHERE d.agendamento_relatorio_id = ? AND d.ativo AND d.excluido_em IS NULL
            AND d.tipo_destinatario IN ('usuario', 'endereco')
         UNION ALL
         SELECT COALESCE(u.email, m.email) AS email, m.tipo_envio AS forma
           FROM agendamento_relatorio_destinatario d
           JOIN agendamento_relatorio a ON a.id = d.agendamento_relatorio_id
           JOIN lista_distribuicao_email ld ON ld.id = d.lista_distribuicao_email_id AND ld.ativo AND ld.excluido_em IS NULL
                AND (ld.estabelecimento_id IS NULL OR ld.estabelecimento_id = a.estabelecimento_id)
           JOIN lista_distribuicao_email_membro m ON m.lista_distribuicao_email_id = ld.id AND m.ativo AND m.excluido_em IS NULL
           LEFT JOIN usuario u ON u.id = m.usuario_id AND u.excluido_em IS NULL AND u.situacao = 'ativo'
                AND u.bloqueado_em IS NULL
          WHERE d.agendamento_relatorio_id = ? AND d.ativo AND d.excluido_em IS NULL
            AND d.tipo_destinatario = 'lista_distribuicao'
            AND (m.usuario_id IS NULL OR u.id IS NOT NULL)`,
        [agendamento, agendamento],
        { teto: 5_000 },
      );
      const dono = await l.uma(
        "SELECT email FROM usuario WHERE id = ? AND excluido_em IS NULL AND situacao = 'ativo' AND bloqueado_em IS NULL",
        [a['dono_usuario_id']],
      );
      // O mesmo endereço em mais de uma forma fica com a primeira (a do cadastro direto vem antes da lista).
      const forma = new Map<string, FormaEnvio>();
      for (const x of linhas) {
        const email = x['email'] === null || x['email'] === undefined ? '' : String(x['email']).trim();
        if (email.includes('@') && !forma.has(email)) forma.set(email, formaDe(x['forma']));
      }
      const formas: Record<FormaEnvio, number> = { para: 0, copia: 0, copia_oculta: 0 };
      for (const f of forma.values()) formas[f]++;
      return {
        destinatarios: [...forma.keys()],
        dono: dono && dono['email'] ? String(dono['email']) : null,
        avisarFalha: Boolean(Number(a['avisar_falha'] ?? 1)),
        formas,
      };
    });
  }

  async falhasSeguidas(estabelecimento: string, agendamento: number): Promise<number> {
    const r = await this.ler((l) =>
      l.uma(
        `SELECT COUNT(*) AS n FROM envio_relatorio er
           JOIN agendamento_relatorio a ON a.id = er.agendamento_relatorio_id
           JOIN estabelecimento e ON e.id = a.estabelecimento_id AND e.codigo = ?
          WHERE er.agendamento_relatorio_id = ? AND er.situacao IN ('falhou', 'sem_conexao')
            AND er.id > COALESCE((SELECT MAX(x.id) FROM envio_relatorio x
                                   WHERE x.agendamento_relatorio_id = ? AND x.situacao = 'enviado'), 0)`,
        [estabelecimento, agendamento, agendamento],
      ),
    );
    return r ? Number(r['n']) : 0;
  }

  private async idDoEstabelecimento(estabelecimento: string): Promise<number> {
    const r = await this.ler((l) =>
      l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [estabelecimento]),
    );
    if (!r) throw recusa('estabelecimento-inexistente', 'Estabelecimento não encontrado no cliente.');
    return Number(r['id']);
  }

  async reservar(
    estabelecimento: string,
    agendamento: number,
    origem: OrigemEnvio,
    agora: Date,
  ): Promise<ReservaEnvio | null> {
    const est = await this.idDoEstabelecimento(estabelecimento);
    const op = definirOperacao<EntradaReserva, { envio: number; proximoEnvio: string }>({
      nome: 'relatorio.reservar_envio_agendado',
      tabelas: ['envio_relatorio', 'agendamento_relatorio'],
      entrada: ENTRADA_RESERVA,
      gravar: async (tx, e) => {
        const [a] = await tx.consultarParaAtualizar(
          `SELECT a.id, a.versao, a.ativo, a.periodicidade, a.hora_envio, a.dia_semana, a.dia_mes, a.proximo_envio_em,
                  a.parametros, a.entrega, a.formato, a.validade_link_horas, a.enviar_sem_linhas, a.condicao_envio,
                  r.situacao AS situacao_relatorio
             FROM agendamento_relatorio a
             JOIN relatorio r ON r.id = a.relatorio_id AND r.excluido_em IS NULL
                  AND (r.estabelecimento_id IS NULL OR r.estabelecimento_id = a.estabelecimento_id)
            WHERE a.id = ? AND a.estabelecimento_id = ?`,
          [e.agendamento, e.estabelecimento],
        );
        if (!a) throw recusa('agendamento-inexistente', 'Agendamento de relatório não encontrado no estabelecimento.');
        if (!Number(a['ativo'])) throw recusa('agendamento-inativo', 'O agendamento está desativado.');
        if (a['situacao_relatorio'] !== 'liberado')
          throw recusa('relatorio-nao-liberado', 'O relatório não está liberado (rascunho, em conferência, suspenso ou descontinuado).');
        const atual = data(a['proximo_envio_em']);
        if (e.previsto !== null && (!atual || atual.toISOString() !== e.previsto))
          throw recusa('envio-ja-reservado', 'Este vencimento já foi reservado por outro envio.');
        const proximo = proximoDepoisDoEnvio(agendaDaLinha(a), atual, agora);
        const envio = await tx.incluir('envio_relatorio', {
          agendamento_relatorio_id: e.agendamento,
          ocorrido_em: agora,
          situacao: 'nao_enviado',
          quantidade_destinatarios: 0,
          mensagem_erro: 'Envio reservado; aguardando o resultado do envio.',
          dados: JSON.stringify({ origem: e.origem, parametros: parametrosDe(a['parametros']), ...pedidoDoCadastro(a) }),
        });
        await tx.alterar('agendamento_relatorio', e.agendamento, Number(a['versao']), { proximo_envio_em: proximo });
        return { envio, proximoEnvio: proximo.toISOString() };
      },
      alvo: (_e, s) => ({ tabela: 'envio_relatorio', id: s.envio }),
    });
    try {
      const saida = await this.executor.executar(
        op,
        this.cliente,
        {
          estabelecimento: est,
          agendamento,
          previsto: origem.tipo === 'vencido' ? origem.previsto.toISOString() : null,
          origem: origem.tipo,
        },
        {
          cliente: this.cliente,
          estabelecimento: est,
          usuario: null,
          correlacao: `relatorio-envio-${agendamento}`.slice(0, 64),
          chaveIdempotencia: chaveDaReserva(agendamento, origem),
        },
      );
      // A mesma chave já gravada: este vencimento (ou este job) já tem o seu envio; não manda de novo.
      if (saida.repetida) return null;
      return { envio: saida.resultado.envio, proximoEnvio: new Date(saida.resultado.proximoEnvio) };
    } catch (erro) {
      if (erro instanceof ErroOperacao && REJEICAO_DA_RESERVA.has(String(erro.problema.codigo))) return null;
      throw erro;
    }
  }

  async concluir(estabelecimento: string, envio: number, r: ResultadoRegistroEnvio): Promise<void> {
    const est = await this.idDoEstabelecimento(estabelecimento);
    const falha =
      r.situacao === 'falhou'
        ? mascararEmails(r.falha ?? 'falha sem motivo').slice(0, 1000)
        : r.falha
          ? mascararEmails(r.falha).slice(0, 1000)
          : null;
    const dados = JSON.stringify({
      falhasSeguidas: r.falhasSeguidas,
      destinatarios: [...(r.enderecos ?? [])].slice(0, 200).map(mascararEndereco),
      ...(r.formas ? { formas: r.formas } : {}),
    });
    const op = definirOperacao<EntradaConclusao, { envio: number }>({
      nome: 'relatorio.concluir_envio_agendado',
      tabelas: ['envio_relatorio', 'agendamento_relatorio'],
      entrada: ENTRADA_CONCLUSAO,
      gravar: async (tx, e) => {
        const [x] = await tx.consultarParaAtualizar(
          `SELECT er.id, er.versao, er.situacao, er.ocorrido_em, er.dados, a.id AS agendamento, a.versao AS versao_agendamento
             FROM envio_relatorio er
             JOIN agendamento_relatorio a ON a.id = er.agendamento_relatorio_id
            WHERE er.id = ? AND a.estabelecimento_id = ?`,
          [e.envio, e.estabelecimento],
        );
        if (!x) throw recusa('envio-inexistente', 'Envio de relatório não encontrado no estabelecimento.');
        if (x['situacao'] !== 'nao_enviado') throw recusa('envio-ja-concluido', 'Este envio já tem resultado gravado.');
        await tx.alterar('envio_relatorio', e.envio, Number(x['versao']), {
          situacao: e.situacao,
          mensagem_erro: e.falha,
          quantidade_destinatarios: e.destinatarios,
          dados: JSON.stringify({ ...objeto(x['dados']), ...objeto(e.dados) }),
        });
        if (e.situacao === 'enviado')
          await tx.alterar('agendamento_relatorio', Number(x['agendamento']), Number(x['versao_agendamento']), {
            ultimo_envio_em: data(x['ocorrido_em']),
          });
        return { envio: e.envio };
      },
      alvo: (_e, s) => ({ tabela: 'envio_relatorio', id: s.envio }),
    });
    await this.executor.executar(
      op,
      this.cliente,
      {
        estabelecimento: est,
        envio,
        situacao: r.situacao,
        falha,
        destinatarios: Math.max(0, Math.trunc(r.destinatarios ?? 0)),
        dados,
      },
      {
        cliente: this.cliente,
        estabelecimento: est,
        usuario: null,
        correlacao: `relatorio-envio-${envio}`.slice(0, 64),
        chaveIdempotencia: `rel.concluir.${envio}`,
      },
    );
  }
}
