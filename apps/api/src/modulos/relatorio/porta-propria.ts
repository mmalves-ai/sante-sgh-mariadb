// Porta do catálogo e da gestão dos relatórios sobre o banco do cliente (M34; F2.2 lote 04-04), pelo @sgh/nucleo.
// Leituras em transação só de leitura, sempre do estabelecimento da sessão; gravações numa operação do Executor (a
// trilha, o outbox e a idempotência na mesma transação), com a trava otimista pela versão.
//   - catálogo: as consultas revisadas de infra/consultas-catalogo.ts, com teto de linhas e tempo;
//   - triagem: triagem_relatorio_legado (o destino de cada relatório do sistema de origem, com o papel dono);
//   - envio agendado: agendamento_relatorio, os destinatários em agendamento_relatorio_destinatario (lista de
//     distribuição pelo código, ou endereço) e cada envio em envio_relatorio;
//   - execução, exportação e envio: execucao_relatorio (só o resumo SHA-256 dos parâmetros);
//   - pedido de relatório novo: pedido_relatorio (tabela pedida ao modelo; ver a saída do lote 04-04);
//   - histórico do pedido e do envio: a própria trilha de auditoria da operação (o evento, o motivo e o valor anterior).
// Melhoria: a última situação, a última falha e as falhas seguidas do envio saem do histórico (envio_relatorio), nunca
// de contadores gravados à parte; o grupo do envio é uma lista de distribuição cadastrada (recusa o desconhecido); o
// acesso herdado do relatório de origem vem da permissão do relatório (usuário ou perfil); o papel dono é o papel de
// segurança cadastrado; o valor anterior que vai à trilha leva os endereços só mascarados.
// Melhoria: todo DATETIME gravado em UTC (ADR 0002); o fuso do estabelecimento só acha o dia e a hora local (hoje,
// próximo envio a partir da hora do envio) e converte na leitura para a tela (infra/fuso.ts).
// Melhoria: trava otimista com a versão que a tela leu (conflito-versao quando outra pessoa gravou antes).
// Melhoria: a triagem separa a decisão do destino (quem decidiu e quando) do aceite da área (quem aceitou e quando):
// a área que só aceita o destino proposto não vira a autora da decisão.
// Recusa explícita (pedido-indisponivel) enquanto a tabela pedido_relatorio não existir no banco do cliente.
import { createHash, randomUUID } from 'node:crypto';
import { FORMATO_HORA, mascararEnderecoEmail } from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  erroConflitoVersao,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { PAPEIS_TRIAGEM } from '@sgh/dominio-relatorio';
import { z } from 'zod';
import { portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import { executarConsultaCatalogo } from './infra/consultas-catalogo.js';
import { lidoNoFuso, localParaUtc, paraBanco, relogioNoFuso, textoNoFuso } from './infra/fuso.js';
import {
  type AcessoDeOrigem,
  type AgendamentoRelatorio,
  type AlvoDependenciaRelatorio,
  type AlvoEventoRelatorio,
  type ContextoRelatorio,
  type DadosAgendamento,
  type DadosPedido,
  type EventoRelatorio,
  type ExecucaoRelatorio,
  type FiltroTriagem,
  type GravadorRelatorio,
  type ItemTriagem,
  METODOS_PORTA_RELATORIO,
  type NovaExecucao,
  type PedidoRelatorio,
  type PortaRelatorio,
  type PropostaTriagem,
  type RegistroEventoRelatorio,
  type RelatorioDeOrigem,
  type ResumoTriagem,
  type VinculoRelatorio,
} from './porta.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoRelatorio = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoN = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const ISO = (coluna: string) => `DATE_FORMAT(${coluna}, '%Y-%m-%dT%H:%i:%s')`;
const json = <T>(v: unknown, padrao: T): T => {
  if (v === null || v === undefined) return padrao;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return padrao;
  }
};

const FUSO_PADRAO = 'America/Sao_Paulo';
const ID = /^\d{1,15}$/;

/** As tabelas que as gravações da gestão podem tocar. */
const TABELAS = [
  'triagem_relatorio_legado',
  'agendamento_relatorio',
  'agendamento_relatorio_destinatario',
  'envio_relatorio',
  'execucao_relatorio',
  'pedido_relatorio',
];

/** Situação do pedido: tela (com hífen) ↔ banco (com sublinhado). */
const situacaoPedidoNoBanco = (s: string) => s.replace(/-/g, '_');
const situacaoPedidoNaTela = (s: unknown) => texto(s).replace(/_/g, '-');

/** Situação do envio no banco → código da tela do histórico (1 enviado, 2 não gerado, 3 não conectado, 4 não enviado). */
const SITUACAO_ENVIO_HISTORICO: Readonly<Record<string, number>> = {
  enviado: 1,
  sem_linhas: 2,
  sem_conexao: 3,
  nao_enviado: 4,
  falhou: 4,
};

/** Formato da execução: tela ↔ banco. */
const FORMATO_NO_BANCO: Readonly<Record<NovaExecucao['formato'], string>> = {
  grade: 'tela',
  pdf: 'pdf',
  xlsx: 'xlsx',
  csv: 'csv',
  link: 'html',
};

export { relogioNoFuso } from './infra/fuso.js';

async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}

/** Hora do dia "HH:MM" → TIME do banco (recusa hora inválida). */
export function horaNoBanco(hora: string): string {
  if (!FORMATO_HORA.test(hora)) throw recusa('hora-invalida', 'Hora do envio inválida: use de 00:00 a 23:59.');
  return `${hora}:00`;
}

export const resumoDosParametros = (texto: string) => createHash('sha256').update(texto).digest('hex');

function contextoDe(c: ContextoNucleo): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'relatorio').slice(0, 64),
  };
}

// ── Leituras comuns ──────────────────────────────────────────────────────────────────────────────────────

const SQL_TRIAGEM = `SELECT t.id, t.nome, t.modulo_sistema_id, t.destino, t.marco, t.artefato, p.codigo AS papel, t.onda,
       t.situacao, t.regra, t.motivo, u.login AS decidido_por, ${ISO('t.decidido_em')} AS decidido_em,
       ua.login AS aceito_por, ${ISO('t.aceito_em')} AS aceito_em, t.quantidade_parametros, t.acesso_restrito
  FROM triagem_relatorio_legado t
  LEFT JOIN papel_seguranca p ON p.id = t.dono_papel_seguranca_id
  LEFT JOIN usuario u ON u.id = t.decidido_por_usuario_id
  LEFT JOIN usuario ua ON ua.id = t.aceito_por_usuario_id
 WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL`;

function itemTriagem(x: Linha, fuso: string): ItemTriagem {
  return {
    id: n(x['id']),
    nome: texto(x['nome']),
    modulo: nn(x['modulo_sistema_id']),
    destino: textoN(x['destino']),
    marco: textoN(x['marco']),
    artefato: texto(x['artefato']),
    papelDono: texto(x['papel']),
    onda: nn(x['onda']),
    situacao: texto(x['situacao']),
    regra: textoN(x['regra']),
    motivo: textoN(x['motivo']),
    decididoPor: textoN(x['decidido_por']),
    decididoEm: textoNoFuso(x['decidido_em'], fuso),
    aceitoPor: textoN(x['aceito_por']),
    aceitoEm: textoNoFuso(x['aceito_em'], fuso),
    parametros: n(x['quantidade_parametros']),
    acessoRestrito: verdadeiro(x['acesso_restrito']),
  };
}

const SQL_AGENDAMENTO = `SELECT a.id, r.codigo AS relatorio, a.nome, a.parametros, a.periodicidade,
       TIME_FORMAT(a.hora_envio, '%H:%i') AS hora, a.dia_semana, a.dia_mes, a.ativo, a.versao,
       u.login AS dono, ${ISO('a.proximo_envio_em')} AS proximo, ${ISO('a.ultimo_envio_em')} AS ultimo,
       (SELECT e.situacao FROM envio_relatorio e WHERE e.agendamento_relatorio_id = a.id
         ORDER BY e.ocorrido_em DESC, e.id DESC LIMIT 1) AS ultima_situacao,
       (SELECT e.mensagem_erro FROM envio_relatorio e WHERE e.agendamento_relatorio_id = a.id
         ORDER BY e.ocorrido_em DESC, e.id DESC LIMIT 1) AS ultima_falha,
       (SELECT COUNT(*) FROM envio_relatorio e WHERE e.agendamento_relatorio_id = a.id
           AND e.situacao IN ('falhou', 'sem_conexao')
           AND NOT EXISTS (SELECT 1 FROM envio_relatorio k WHERE k.agendamento_relatorio_id = a.id
                             AND k.situacao = 'enviado'
                             AND (k.ocorrido_em > e.ocorrido_em OR (k.ocorrido_em = e.ocorrido_em AND k.id > e.id)))
       ) AS falhas
  FROM agendamento_relatorio a
  JOIN relatorio r ON r.id = a.relatorio_id
  JOIN usuario u ON u.id = a.dono_usuario_id
 WHERE a.estabelecimento_id = ?`;

async function agendamentosDe(
  l: Leitor,
  linhas: Linha[],
  fuso: string,
): Promise<(AgendamentoRelatorio & { versao: number })[]> {
  if (linhas.length === 0) return [];
  const ids = linhas.map((x) => n(x['id']));
  const dest = await l.consultar(
    `SELECT d.agendamento_relatorio_id AS agendamento, d.tipo_destinatario, l.codigo, d.email
       FROM agendamento_relatorio_destinatario d
       LEFT JOIN lista_distribuicao_email l ON l.id = d.lista_distribuicao_email_id
      WHERE d.agendamento_relatorio_id IN (${lista(ids.length)}) AND d.excluido_em IS NULL AND d.ativo
      ORDER BY d.agendamento_relatorio_id, d.sequencia`,
    ids,
  );
  return linhas.map((x) => {
    const id = n(x['id']);
    const meus = dest.filter((d) => n(d['agendamento']) === id);
    const situacao = textoN(x['ultima_situacao']);
    const falhou = situacao === 'falhou' || situacao === 'sem_conexao';
    return {
      id: String(id),
      relatorio: texto(x['relatorio']),
      titulo: texto(x['nome']),
      parametros: json<Record<string, string | number>>(x['parametros'], {}),
      grupos: meus
        .filter((d) => d['tipo_destinatario'] === 'lista_distribuicao')
        .map((d) => texto(d['codigo'])),
      enderecos: meus.filter((d) => d['tipo_destinatario'] === 'endereco').map((d) => texto(d['email'])),
      periodicidade: texto(x['periodicidade']),
      hora: texto(x['hora']),
      diaSemana: nn(x['dia_semana']),
      diaMes: nn(x['dia_mes']),
      ativo: verdadeiro(x['ativo']),
      dono: texto(x['dono']),
      proximoEnvio: lidoNoFuso(x['proximo'], fuso),
      ultimoEnvio: lidoNoFuso(x['ultimo'], fuso),
      ultimaSituacao: situacao === 'enviado' ? 'enviado' : falhou ? 'falhou' : null,
      ultimaFalha: falhou ? textoN(x['ultima_falha']) : null,
      falhasSeguidas: n(x['falhas']),
      versao: n(x['versao']),
    };
  });
}

const SQL_PEDIDO = `SELECT p.id, p.titulo, p.descricao, p.finalidade, p.area, DATE_FORMAT(p.prazo, '%Y-%m-%d') AS prazo,
       s.login AS solicitante, p.situacao, r.codigo AS relatorio, p.resposta, rp.login AS respondido_por,
       ${ISO('p.respondido_em')} AS respondido_em, ${ISO('p.criado_em')} AS criado_em,
       ${ISO('p.cancelado_em')} AS cancelado_em, cp.login AS cancelado_por, p.motivo_cancelamento, p.versao
  FROM pedido_relatorio p
  JOIN usuario s ON s.id = p.solicitante_usuario_id
  LEFT JOIN relatorio r ON r.id = p.relatorio_id
  LEFT JOIN usuario rp ON rp.id = p.respondido_por_usuario_id
  LEFT JOIN usuario cp ON cp.id = p.cancelado_por_usuario_id
 WHERE p.estabelecimento_id = ?`;

function pedidoDe(x: Linha, fuso: string): PedidoRelatorio & { versao: number } {
  return {
    id: String(n(x['id'])),
    titulo: texto(x['titulo']),
    descricao: texto(x['descricao']),
    finalidade: texto(x['finalidade']),
    area: texto(x['area']),
    prazo: texto(x['prazo']),
    solicitante: texto(x['solicitante']),
    situacao: situacaoPedidoNaTela(x['situacao']),
    relatorio: textoN(x['relatorio']),
    resposta: textoN(x['resposta']),
    respondidoPor: textoN(x['respondido_por']),
    respondidoEm: lidoNoFuso(x['respondido_em'], fuso),
    criadoEm: lidoNoFuso(x['criado_em'], fuso) ?? new Date(0),
    canceladoEm: lidoNoFuso(x['cancelado_em'], fuso),
    canceladoPor: textoN(x['cancelado_por']),
    motivoCancelamento: textoN(x['motivo_cancelamento']),
    versao: n(x['versao']),
  };
}

/** O valor anterior que vai à trilha: os endereços de e-mail só mascarados. */
function retratoSeguro(antes: unknown): unknown {
  if (!antes || typeof antes !== 'object') return antes ?? null;
  const a = antes as Record<string, unknown>;
  return Array.isArray(a['enderecos'])
    ? { ...a, enderecos: (a['enderecos'] as unknown[]).map((e) => mascararEnderecoEmail(String(e))) }
    : a;
}

/**
 * O pedido de relatório novo precisa da tabela pedido_relatorio (pedida ao modelo pelo lote 04-04). Sem ela, a porta
 * recusa com um código de negócio, em vez do erro de tabela inexistente do banco.
 */
async function exigirPedido(l: Pick<Leitor, 'uma'>): Promise<void> {
  const t = await l.uma(
    "SELECT 1 AS x FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'pedido_relatorio'",
  );
  if (!t)
    throw recusa(
      'pedido-indisponivel',
      'O pedido de relatório novo ainda não está disponível neste banco: falta aplicar a migração do pedido.',
    );
}

// ── A porta ──────────────────────────────────────────────────────────────────────────────────────────────

interface EventoDaOperacao {
  evento: EventoRelatorio;
  antes: unknown;
  motivo: string;
}

export class PortaRelatorioPropria implements PortaRelatorio {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoRelatorio,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  /** Leitura do estabelecimento da sessão, com o fuso dele (a hora lida do banco, em UTC, volta à hora local). */
  private ler<T>(
    c: ContextoRelatorio,
    fn: (l: Leitor, est: number, fuso: string) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null || est === undefined)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), async (l) => fn(l, est, await fusoDe(l, est)));
  }

  relogio(c: ContextoRelatorio) {
    return this.ler(c, async (_l, _est, fuso) => {
      const r = relogioNoFuso(fuso);
      return { agora: new Date(`${r.agora}Z`), hoje: r.hoje };
    });
  }

  executar(
    c: ContextoRelatorio,
    codigo: string,
    valores: Readonly<Record<string, string | number>>,
    o: {
      teto: number;
      tempoMaximoMs: number;
    },
  ) {
    return this.ler(c, (l, est, fuso) =>
      executarConsultaCatalogo(l, { estabelecimento: est, hoje: relogioNoFuso(fuso).hoje, fuso }, codigo, valores, o),
    );
  }

  /**
   * O acesso herdado: sem relatório de origem ligado pela triagem, ou com algum sem restrição, não restringe; se todos
   * eram restritos, só quem tem a permissão de executar o relatório (o próprio usuário ou um perfil vigente dele).
   */
  acessoDeOrigem(c: ContextoRelatorio, codigo: string): Promise<AcessoDeOrigem> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT t.acesso_restrito, r.id AS relatorio FROM triagem_relatorio_legado t
           JOIN relatorio r ON r.id = t.relatorio_id
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.destino = 'catalogo' AND r.codigo = ?`,
        [est, codigo],
        { teto: 500 },
      );
      if (ls.length === 0) return { relatorios: 0, restrito: false, permitido: true };
      const restrito = ls.every((x) => verdadeiro(x['acesso_restrito']));
      if (!restrito) return { relatorios: ls.length, restrito, permitido: true };
      if (c.usuario === null || c.usuario === undefined)
        return { relatorios: ls.length, restrito, permitido: false };
      const p = await l.uma(
        `SELECT COUNT(*) AS n FROM relatorio_permissao p
          WHERE p.relatorio_id = ? AND p.excluido_em IS NULL AND p.pode_executar
            AND (p.usuario_id = ? OR p.perfil_acesso_id IN (
                  SELECT up.perfil_acesso_id FROM usuario_perfil up
                   WHERE up.usuario_id = ? AND up.excluido_em IS NULL
                     AND (up.estabelecimento_id IS NULL OR up.estabelecimento_id = ?)
                     AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE)))`,
        [n(ls[0]?.['relatorio']), c.usuario, c.usuario, est],
      );
      return { relatorios: ls.length, restrito, permitido: n(p?.['n']) > 0 };
    });
  }

  /** Os relatórios do sistema de origem, como o conector os trouxe à triagem (só metadado). */
  inventario(c: ContextoRelatorio): Promise<RelatorioDeOrigem[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT id, nome, modulo_sistema_id, quantidade_parametros, acesso_restrito
             FROM triagem_relatorio_legado WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id`,
          [est],
          { teto: 5_000 },
        )
      ).map((x) => ({
        id: n(x['id']),
        nome: texto(x['nome']).slice(0, 60),
        modulo: n(x['modulo_sistema_id']),
        tipo: 0,
        opcao: null,
        parametros: n(x['quantidade_parametros']),
        acessoRestrito: verdadeiro(x['acesso_restrito']),
      })),
    );
  }

  /** A página da triagem: só os itens com destino (proposto ou confirmado); os sem destino contam no resumo. */
  triagem(c: ContextoRelatorio, f: FiltroTriagem): Promise<{ itens: ItemTriagem[]; total: number }> {
    return this.ler(c, async (l, est, fuso) => {
      const cond = ['t.destino IS NOT NULL'];
      const p: unknown[] = [est];
      if (f.destino) {
        cond.push('t.destino = ?');
        p.push(f.destino);
      }
      if (f.situacao) {
        cond.push('t.situacao = ?');
        p.push(f.situacao);
      }
      if (f.marco) {
        cond.push('t.marco = ?');
        p.push(f.marco);
      }
      if (f.termo) {
        cond.push("t.nome LIKE CONCAT('%', ?, '%')");
        p.push(f.termo);
      }
      const filtro = ` AND ${cond.join(' AND ')}`;
      const tamanho = Math.max(1, Math.min(100, f.tamanho));
      const total = await l.uma(
        `SELECT COUNT(*) AS n FROM triagem_relatorio_legado t WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL${filtro}`,
        p,
      );
      const itens = await l.consultar(`${SQL_TRIAGEM}${filtro} ORDER BY t.id LIMIT ? OFFSET ?`, [
        ...p,
        tamanho,
        Math.max(0, f.pagina) * tamanho,
      ]);
      return { itens: itens.map((x) => itemTriagem(x, fuso)), total: n(total?.['n']) };
    });
  }

  umaTriagem(c: ContextoRelatorio, id: number): Promise<ItemTriagem | null> {
    return this.ler(c, async (l, est, fuso) => {
      const x = await l.uma(`${SQL_TRIAGEM} AND t.id = ?`, [est, id]);
      return x ? itemTriagem(x, fuso) : null;
    });
  }

  resumoTriagem(c: ContextoRelatorio): Promise<ResumoTriagem> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT destino, marco, situacao, dono_papel_seguranca_id IS NULL AS sem_dono, COUNT(*) AS n
           FROM triagem_relatorio_legado WHERE estabelecimento_id = ? AND excluido_em IS NULL
          GROUP BY destino, marco, situacao, dono_papel_seguranca_id IS NULL`,
        [est],
        { teto: 5_000 },
      );
      const porDestino: Record<string, number> = {};
      const porMarco: Record<string, number> = {};
      let total = 0;
      let semDestino = 0;
      let semDono = 0;
      let confirmadas = 0;
      for (const x of ls) {
        const k = n(x['n']);
        total += k;
        const destino = textoN(x['destino']);
        if (destino === null) semDestino += k;
        else porDestino[destino] = (porDestino[destino] ?? 0) + k;
        if (verdadeiro(x['sem_dono']) && destino !== 'descartado') semDono += k;
        if (x['situacao'] === 'confirmada') confirmadas += k;
        const marco = textoN(x['marco']);
        if (marco) porMarco[marco] = (porMarco[marco] ?? 0) + k;
      }
      return { total, semDestino, semDono, confirmadas, porDestino, porMarco };
    });
  }

  agendamentos(c: ContextoRelatorio): Promise<AgendamentoRelatorio[]> {
    return this.ler(c, async (l, est, fuso) =>
      agendamentosDe(
        l,
        await l.consultar(`${SQL_AGENDAMENTO} ORDER BY a.nome, a.id`, [est], { teto: 2_000 }),
        fuso,
      ),
    );
  }

  agendamento(c: ContextoRelatorio, id: string): Promise<AgendamentoRelatorio | null> {
    if (!ID.test(id)) return Promise.resolve(null);
    return this.ler(c, async (l, est, fuso) => {
      const [a] = await agendamentosDe(
        l,
        await l.consultar(`${SQL_AGENDAMENTO} AND a.id = ?`, [est, Number(id)]),
        fuso,
      );
      return a ?? null;
    });
  }

  /** Os envios ativos vencidos (o próximo envio, em UTC, até o instante atual), os mais antigos primeiro. */
  vencidos(c: ContextoRelatorio, lote: number): Promise<AgendamentoRelatorio[]> {
    return this.ler(c, async (l, est, fuso) => {
      return agendamentosDe(
        l,
        await l.consultar(
          `${SQL_AGENDAMENTO} AND a.ativo AND a.proximo_envio_em IS NOT NULL AND a.proximo_envio_em <= UTC_TIMESTAMP(3)
            ORDER BY a.proximo_envio_em, a.id LIMIT ?`,
          [est, Math.max(1, Math.min(500, lote))],
        ),
        fuso,
      );
    });
  }

  /** O histórico dos envios do estabelecimento (os importados do sistema de origem inclusive), por ano e situação. */
  historicoOrigem(c: ContextoRelatorio) {
    return this.ler(c, async (l, est, fuso) => {
      const a = await l.uma('SELECT COUNT(*) AS n FROM agendamento_relatorio WHERE estabelecimento_id = ?', [
        est,
      ]);
      const porAno = await l.consultar(
        `SELECT YEAR(e.ocorrido_em) AS ano, e.situacao, COUNT(*) AS n
           FROM envio_relatorio e JOIN agendamento_relatorio a ON a.id = e.agendamento_relatorio_id
          WHERE a.estabelecimento_id = ? GROUP BY YEAR(e.ocorrido_em), e.situacao ORDER BY 1, 2`,
        [est],
        { teto: 500 },
      );
      const u = await l.uma(
        `SELECT ${ISO('MAX(e.ocorrido_em)')} AS d FROM envio_relatorio e
           JOIN agendamento_relatorio a ON a.id = e.agendamento_relatorio_id
          WHERE a.estabelecimento_id = ? AND e.situacao = 'enviado'`,
        [est],
      );
      const somas = new Map<string, { ano: number; situacao: number; quantidade: number }>();
      for (const x of porAno) {
        const s = SITUACAO_ENVIO_HISTORICO[texto(x['situacao'])] ?? 4;
        const k = `${n(x['ano'])}:${s}`;
        const atual = somas.get(k) ?? { ano: n(x['ano']), situacao: s, quantidade: 0 };
        atual.quantidade += n(x['n']);
        somas.set(k, atual);
      }
      return {
        agendamentos: n(a?.['n']),
        porAno: [...somas.values()],
        ultimoEnviado: lidoNoFuso(u?.['d'], fuso),
      };
    });
  }

  execucoes(
    c: ContextoRelatorio,
    f: { readonly relatorio?: string; readonly usuario?: string; readonly limite: number },
  ): Promise<ExecucaoRelatorio[]> {
    return this.ler(c, async (l, est, fuso) => {
      const cond: string[] = [];
      const p: unknown[] = [est];
      if (f.relatorio) {
        cond.push('r.codigo = ?');
        p.push(f.relatorio);
      }
      if (f.usuario) {
        cond.push('u.login = ?');
        p.push(f.usuario);
      }
      p.push(Math.max(1, Math.min(1_000, f.limite)));
      const ls = await l.consultar(
        `SELECT x.id, r.codigo AS relatorio, x.tipo, x.formato, u.login, x.linhas, x.duracao_ms,
                x.contem_dado_pessoal, x.mascarado, x.motivo IS NOT NULL AS tem_motivo, x.situacao,
                ${ISO('x.ocorrido_em')} AS em
           FROM execucao_relatorio x JOIN relatorio r ON r.id = x.relatorio_id
           LEFT JOIN usuario u ON u.id = x.usuario_id
          WHERE x.estabelecimento_id = ? ${cond.map((k) => `AND ${k}`).join(' ')}
          ORDER BY x.ocorrido_em DESC, x.id DESC LIMIT ?`,
        p,
      );
      return ls.map((x) => {
        const tipo = texto(x['tipo']) as ExecucaoRelatorio['tipo'];
        const formato = texto(x['formato']);
        return {
          id: String(n(x['id'])),
          relatorio: texto(x['relatorio']),
          tipo,
          formato: formato === 'tela' ? 'grade' : tipo === 'envio' && formato === 'html' ? 'link' : formato,
          usuario: textoN(x['login']) ?? 'envio agendado',
          linhas: n(x['linhas']),
          duracaoMs: n(x['duracao_ms']),
          dadoPessoal: verdadeiro(x['contem_dado_pessoal']),
          mascarado: verdadeiro(x['mascarado']),
          temJustificativa: verdadeiro(x['tem_motivo']),
          situacao: texto(x['situacao']) as ExecucaoRelatorio['situacao'],
          criadoEm: lidoNoFuso(x['em'], fuso) ?? new Date(0),
        };
      });
    });
  }

  pedidos(c: ContextoRelatorio, f: { readonly solicitante?: string }): Promise<PedidoRelatorio[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await exigirPedido(l),
        await l.consultar(
          `${SQL_PEDIDO} ${f.solicitante ? 'AND s.login = ?' : ''} ORDER BY p.criado_em DESC, p.id DESC`,
          f.solicitante ? [est, f.solicitante] : [est],
          { teto: 2_000 },
        )
      ).map((x) => pedidoDe(x, fuso)),
    );
  }

  pedido(c: ContextoRelatorio, id: string): Promise<PedidoRelatorio | null> {
    if (!ID.test(id)) return Promise.resolve(null);
    return this.ler(c, async (l, est, fuso) => {
      await exigirPedido(l);
      const x = await l.uma(`${SQL_PEDIDO} AND p.id = ?`, [est, Number(id)]);
      return x ? pedidoDe(x, fuso) : null;
    });
  }

  /** O histórico do pedido ou do envio: as linhas da trilha das operações que levam o evento do ciclo. */
  eventos(c: ContextoRelatorio, alvo: AlvoEventoRelatorio, id: string): Promise<RegistroEventoRelatorio[]> {
    if (!ID.test(id)) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) =>
      (
        alvo === 'pedido' ? await exigirPedido(l) : undefined,
        await l.consultar(
          `SELECT JSON_UNQUOTE(JSON_EXTRACT(t.dados_depois, '$.dados.eventoRelatorio.evento')) AS evento,
                  JSON_EXTRACT(t.dados_depois, '$.dados.eventoRelatorio.antes') AS antes, t.motivo, u.login AS por,
                  ${ISO('t.ocorrido_em')} AS em
             FROM trilha_auditoria t LEFT JOIN usuario u ON u.id = t.usuario_id
            WHERE t.estabelecimento_id = ? AND t.entidade = ? AND t.entidade_id = ?
              AND JSON_EXTRACT(t.dados_depois, '$.dados.eventoRelatorio.evento') IS NOT NULL
            ORDER BY t.ocorrido_em, t.id`,
          [est, alvo === 'pedido' ? 'pedido_relatorio' : 'agendamento_relatorio', Number(id)],
          { teto: 1_000 },
        )
      ).map((x) => ({
        evento: texto(x['evento']) as EventoRelatorio,
        motivo: texto(x['motivo']),
        por: texto(x['por']),
        em: lidoNoFuso(x['em'], fuso) ?? new Date(0),
        antes: x['antes'] === null || x['antes'] === undefined ? null : texto(x['antes']),
      })),
    );
  }

  /** O que impede a exclusão física: as execuções e envios ligados e o desdobramento do próprio registro. */
  dependencias(
    c: ContextoRelatorio,
    alvo: AlvoDependenciaRelatorio,
    id: string,
  ): Promise<VinculoRelatorio[]> {
    if (!ID.test(id)) return Promise.reject(recusa('id-invalido', 'Identificador inválido.'));
    return this.ler(c, async (l, est) => {
      const r: VinculoRelatorio[] = [];
      if (alvo === 'agendamento') {
        const x = await l.uma(
          `SELECT (SELECT COUNT(*) FROM execucao_relatorio e WHERE e.agendamento_relatorio_id = a.id) AS execucoes,
                  (SELECT COUNT(*) FROM envio_relatorio e WHERE e.agendamento_relatorio_id = a.id) AS envios,
                  a.ultimo_envio_em IS NOT NULL AS enviado
             FROM agendamento_relatorio a WHERE a.estabelecimento_id = ? AND a.id = ?`,
          [est, Number(id)],
        );
        if (!x) return r;
        const k = n(x['execucoes']) + n(x['envios']);
        if (k > 0) r.push({ grupo: 'envios e execuções registrados', quantidade: k, origem: 'fk' });
        if (verdadeiro(x['enviado'])) r.push({ grupo: 'envio já feito', quantidade: 1, origem: 'logica' });
        return r;
      }
      await exigirPedido(l);
      const x = await l.uma(
        `SELECT p.respondido_em IS NOT NULL OR p.situacao <> 'aberto' AS respondido, p.cancelado_em IS NOT NULL AS cancelado
           FROM pedido_relatorio p WHERE p.estabelecimento_id = ? AND p.id = ?`,
        [est, Number(id)],
      );
      if (!x) return r;
      if (verdadeiro(x['respondido']))
        r.push({ grupo: 'resposta do curador', quantidade: 1, origem: 'logica' });
      if (verdadeiro(x['cancelado']))
        r.push({ grupo: 'cancelamento registrado', quantidade: 1, origem: 'logica' });
      return r;
    });
  }

  async gravarSgh<T>(
    c: ContextoRelatorio,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorRelatorio) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null || est === undefined)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const eventos: EventoDaOperacao[] = [];
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: 'relatorio.gestao',
      tabelas: TABELAS,
      entrada: z.object({ chave: z.string() }),
      gravar: async (tx) => {
        saida = { valor: await fn(gravador(tx, est, c, eventos)) };
        return { valor: saida.valor } as unknown as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'relatorio', id: l?.entidadeId ?? null };
      },
      trilha: () => {
        const l = linha();
        const ev = eventos[eventos.length - 1];
        const base = (l?.dadosDepois ?? {}) as Record<string, unknown>;
        return {
          dados: ev
            ? { ...base, eventoRelatorio: { evento: ev.evento, antes: retratoSeguro(ev.antes) } }
            : (l?.dadosDepois ?? null),
          motivo: ev ? ev.motivo.slice(0, 200) : (l?.motivo ?? null),
        };
      },
    });
    const chave = `relatorio:${randomUUID()}`;
    const ctx: ContextoOperacao = {
      ...contextoDe(c),
      correlacao: (c.correlacao || 'relatorio').slice(0, 64),
      chaveIdempotencia: chave,
    };
    const r = await this.executor.executar(op, c.cliente, { chave }, ctx);
    return (r.resultado as unknown as { valor: T }).valor;
  }
}

// ── As gravações ─────────────────────────────────────────────────────────────────────────────────────────

function gravador(
  tx: TxOperacao,
  est: number,
  c: ContextoRelatorio,
  eventos: EventoDaOperacao[],
): GravadorRelatorio {
  /** O instante da gravação, em UTC (ADR 0002). */
  const agora = async () => paraBanco(new Date());
  let fusoGuardado: string | null = null;
  const fuso = async () => (fusoGuardado ??= await fusoDe(tx, est));
  /** O próximo envio vem na hora local do estabelecimento (o domínio calcula sem fuso): vai ao banco em UTC. */
  const envioEmUtc = async (d: Date) => paraBanco(localParaUtc(d, await fuso()));
  const conferirVersao = (lida: number, daTela: number | undefined) => {
    if (daTela !== undefined && lida !== daTela) throw erroConflitoVersao(['versao']);
  };
  const usuario = () => {
    if (c.usuario === null || c.usuario === undefined)
      throw recusa('sem-usuario', 'A gravação precisa do usuário da sessão.');
    return c.usuario;
  };

  /** O relatório do catálogo do produto (sem estabelecimento) ou próprio deste estabelecimento; nunca o de outro. */
  async function relatorioIdOuNulo(codigo: string): Promise<number | null> {
    const r = await tx.uma(
      `SELECT id FROM relatorio WHERE codigo = ? AND excluido_em IS NULL AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
      [codigo, est],
    );
    return r ? n(r['id']) : null;
  }

  async function relatorioId(codigo: string): Promise<number> {
    const r = await relatorioIdOuNulo(codigo);
    if (r === null)
      throw recusa(
        'relatorio-nao-cadastrado',
        `O relatório ${codigo} não está cadastrado no catálogo deste banco: carregue o catálogo do produto.`,
      );
    return r;
  }

  /**
   * Área dona da triagem pela chave de negócio do domínio (PAPEIS_TRIAGEM): o rótulo do papel dono, ou o código ou o nome
   * do papel de segurança cadastrado, casa com a chave ou com o papel da área. Toda triagem decidida tem área (CHECK
   * ck_triagem_relatorio_legado_area_decidida): sem área no domínio nem na linha, a gravação é recusada.
   */
  async function areaDona(rotulo: string, papel: number | null, atual: string | null): Promise<string> {
    const candidatos = [rotulo];
    if (papel != null) {
      const r = await tx.uma('SELECT codigo, nome FROM papel_seguranca WHERE id = ?', [papel]);
      if (r) candidatos.push(texto(r['codigo']), texto(r['nome']));
    }
    for (const c of candidatos) {
      const k = c.trim().toLowerCase();
      const achada = Object.entries(PAPEIS_TRIAGEM).find(([chave, v]) => chave === k || v.toLowerCase() === k);
      if (achada) return achada[0];
    }
    if (atual) return atual;
    throw recusa(
      'triagem-sem-area',
      `O papel dono "${rotulo}" não é de nenhuma área da triagem, e o relatório ainda não tem área dona.`,
    );
  }

  async function papelId(codigo: string, obrigatorio: boolean): Promise<number | null> {
    const r = await tx.uma(
      'SELECT id FROM papel_seguranca WHERE (codigo = ? OR nome = ?) AND excluido_em IS NULL ORDER BY codigo = ? DESC LIMIT 1',
      [codigo, codigo, codigo],
    );
    if (!r && obrigatorio)
      throw recusa(
        'papel-desconhecido',
        `O papel dono "${codigo}" não está cadastrado nos papéis de segurança.`,
      );
    return r ? n(r['id']) : null;
  }

  async function listaId(codigo: string): Promise<number> {
    const r = await tx.uma(
      `SELECT id FROM lista_distribuicao_email WHERE codigo = ? AND ativo AND excluido_em IS NULL
          AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) ORDER BY estabelecimento_id IS NULL LIMIT 1`,
      [codigo, est],
    );
    if (!r)
      throw recusa('grupo-desconhecido', `O grupo "${codigo}" não é uma lista de distribuição cadastrada.`);
    return n(r['id']);
  }

  async function travarAgendamento(id: string, versao?: number) {
    if (!ID.test(id)) return null;
    const [x] = await tx.consultarParaAtualizar(
      'SELECT id, versao, ultimo_envio_em IS NOT NULL AS enviado FROM agendamento_relatorio WHERE estabelecimento_id = ? AND id = ?',
      [est, Number(id)],
      { teto: 1 },
    );
    if (!x) return null;
    conferirVersao(n(x['versao']), versao);
    return { id: n(x['id']), versao: n(x['versao']) };
  }

  async function travarPedido(id: string, versao?: number) {
    if (!ID.test(id)) return null;
    await exigirPedido(tx);
    const [x] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, cancelado_em IS NOT NULL AS cancelado, respondido_em IS NOT NULL AS respondido
         FROM pedido_relatorio WHERE estabelecimento_id = ? AND id = ?`,
      [est, Number(id)],
      { teto: 1 },
    );
    if (x) conferirVersao(n(x['versao']), versao);
    return x
      ? {
          id: n(x['id']),
          versao: n(x['versao']),
          situacao: texto(x['situacao']),
          cancelado: verdadeiro(x['cancelado']),
          respondido: verdadeiro(x['respondido']),
        }
      : null;
  }

  async function gravarDestinatarios(agendamento: number, a: DadosAgendamento) {
    const seq = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) AS s FROM agendamento_relatorio_destinatario WHERE agendamento_relatorio_id = ?',
      [agendamento],
    );
    let s = n(seq?.['s']);
    for (const g of a.grupos)
      await tx.incluir('agendamento_relatorio_destinatario', {
        agendamento_relatorio_id: agendamento,
        sequencia: ++s,
        tipo_destinatario: 'lista_distribuicao',
        lista_distribuicao_email_id: await listaId(g),
      });
    for (const e of a.enderecos)
      await tx.incluir('agendamento_relatorio_destinatario', {
        agendamento_relatorio_id: agendamento,
        sequencia: ++s,
        tipo_destinatario: 'endereco',
        email: e,
      });
  }

  const camposAgendamento = async (a: DadosAgendamento) => {
    const parametros = JSON.stringify(a.parametros);
    if (parametros.length > 4_000) throw recusa('parametros-grandes', 'Parâmetros acima do tamanho máximo.');
    return {
      relatorio_id: await relatorioId(a.relatorio),
      nome: a.titulo.slice(0, 150),
      periodicidade: a.periodicidade,
      hora_envio: horaNoBanco(a.hora),
      dia_semana: a.periodicidade === 'semanal' ? a.diaSemana : null,
      dia_mes: a.periodicidade === 'mensal' ? a.diaMes : null,
      parametros,
    };
  };

  async function lerAgendamento(id: string): Promise<AgendamentoRelatorio | null> {
    if (!ID.test(id)) return null;
    const [a] = await agendamentosDe(
      tx,
      await tx.consultar(`${SQL_AGENDAMENTO} AND a.id = ?`, [est, Number(id)]),
      await fuso(),
    );
    return a ?? null;
  }

  async function lerPedido(id: string): Promise<PedidoRelatorio | null> {
    if (!ID.test(id)) return null;
    const x = await tx.uma(`${SQL_PEDIDO} AND p.id = ?`, [est, Number(id)]);
    return x ? pedidoDe(x, await fuso()) : null;
  }

  const camposPedido = (p: DadosPedido) => ({
    titulo: p.titulo,
    descricao: p.descricao,
    finalidade: p.finalidade,
    area: p.area,
    prazo: p.prazo,
  });

  return {
    /**
     * Inclui o que falta e atualiza as propostas; a decisão já confirmada pela área fica (só o nome acompanha). A chave
     * de negócio é o código do relatório de origem no estabelecimento (o id da proposta), nunca o id da linha.
     */
    async gravarPropostas(propostas: readonly PropostaTriagem[]) {
      let incluidas = 0;
      let atualizadas = 0;
      let preservadas = 0;
      const quando = await agora();
      for (const p of propostas) {
        const [x] = await tx.consultarParaAtualizar(
          'SELECT id, versao, situacao, nome, area FROM triagem_relatorio_legado WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
          [est, String(p.id)],
          { teto: 1 },
        );
        const dono = await papelId(p.papelDono, false);
        const areaAtual = x ? textoN(x['area']) : null;
        const decisao = {
          destino: p.destino,
          marco: p.marco,
          artefato: p.artefato.slice(0, 120),
          dono_papel_seguranca_id: dono,
          area: x?.['situacao'] === 'confirmada' ? areaAtual : await areaDona(p.papelDono, dono, areaAtual),
          onda: p.onda,
          regra: p.regra.slice(0, 200),
          motivo: p.motivo.slice(0, 200),
          relatorio_id: p.destino === 'catalogo' ? await relatorioIdOuNulo(p.artefato) : null,
          situacao: 'proposta',
          decidido_em: quando,
        };
        if (!x) {
          await tx.incluir('triagem_relatorio_legado', {
            estabelecimento_id: est,
            codigo: String(p.id),
            nome: p.nome.slice(0, 150),
            ...decisao,
          });
          incluidas++;
        } else if (x['situacao'] === 'confirmada') {
          if (texto(x['nome']) !== p.nome)
            await tx.alterar('triagem_relatorio_legado', n(x['id']), n(x['versao']), {
              nome: p.nome.slice(0, 150),
            });
          preservadas++;
        } else {
          await tx.alterar('triagem_relatorio_legado', n(x['id']), n(x['versao']), {
            nome: p.nome.slice(0, 150),
            ...decisao,
          });
          atualizadas++;
        }
      }
      return { incluidas, atualizadas, preservadas };
    },

    /**
     * A área confirma o destino: quem confirma é quem aceita (aceito_*). Se a área só aceita o destino proposto, a
     * decisão continua a da proposta (decidido_* ficam); se muda o destino (ou o item não tinha proposta), a decisão
     * do novo destino também é dela, o mesmo ator de fato, e decidido_* passam a ser os dela.
     */
    async decidirTriagem(id, d) {
      const [x] = await tx.consultarParaAtualizar(
        `SELECT id, versao, destino, marco, artefato, area, decidido_em IS NULL AS sem_decisao
           FROM triagem_relatorio_legado WHERE estabelecimento_id = ? AND id = ? AND excluido_em IS NULL`,
        [est, id],
        { teto: 1 },
      );
      if (!x) return 0;
      const quando = await agora();
      const mudou =
        verdadeiro(x['sem_decisao']) ||
        textoN(x['destino']) !== d.destino ||
        textoN(x['marco']) !== d.marco ||
        texto(x['artefato']) !== d.artefato.slice(0, 120);
      const dono = d.destino === 'descartado' ? await papelId(d.papelDono, false) : await papelId(d.papelDono, true);
      await tx.alterar('triagem_relatorio_legado', n(x['id']), n(x['versao']), {
        destino: d.destino,
        marco: d.marco,
        artefato: d.artefato.slice(0, 120),
        dono_papel_seguranca_id: dono,
        area: await areaDona(d.papelDono, dono, textoN(x['area'])),
        onda: d.onda,
        motivo: d.motivo.slice(0, 200),
        relatorio_id: d.destino === 'catalogo' ? await relatorioId(d.artefato) : null,
        situacao: 'confirmada',
        ...(mudou ? { decidido_por_usuario_id: usuario(), decidido_em: quando } : {}),
        aceito_por_usuario_id: usuario(),
        aceito_em: quando,
      });
      return 1;
    },

    async criarAgendamento(a, _usuario, proximoEnvio) {
      const id = await tx.incluir('agendamento_relatorio', {
        estabelecimento_id: est,
        ...(await camposAgendamento(a)),
        formato: 'pdf',
        entrega: 'link',
        validade_link_horas: 72,
        dono_usuario_id: usuario(),
        avisar_falha: true,
        proximo_envio_em: await envioEmUtc(proximoEnvio),
        ativo: true,
      });
      await gravarDestinatarios(id, a);
      return String(id);
    },

    async alterarAgendamento(id, a, _usuario, proximoEnvio, versao) {
      const t = await travarAgendamento(id, versao);
      if (!t) return 0;
      await tx.alterar('agendamento_relatorio', t.id, t.versao, {
        ...(await camposAgendamento(a)),
        ativo: a.ativo,
        proximo_envio_em: proximoEnvio ? await envioEmUtc(proximoEnvio) : null,
      });
      await tx.executar(
        'UPDATE agendamento_relatorio_destinatario SET excluido_em = ?, excluido_por = ?, versao = versao + 1 WHERE agendamento_relatorio_id = ? AND excluido_em IS NULL',
        [await agora(), usuario(), t.id],
      );
      await gravarDestinatarios(t.id, a);
      return 1;
    },

    async registrarResultadoEnvio(id, r) {
      const t = await travarAgendamento(id);
      if (!t) return 0;
      const quando = await agora();
      const destinatarios = await tx.uma(
        'SELECT COUNT(*) AS n FROM agendamento_relatorio_destinatario WHERE agendamento_relatorio_id = ? AND excluido_em IS NULL AND ativo',
        [t.id],
      );
      await tx.incluir('envio_relatorio', {
        agendamento_relatorio_id: t.id,
        ocorrido_em: quando,
        situacao: r.situacao,
        quantidade_destinatarios: n(destinatarios?.['n']),
        mensagem_erro: r.situacao === 'falhou' ? (r.falha ?? 'Falha no envio.').slice(0, 1_000) : null,
      });
      await tx.alterar('agendamento_relatorio', t.id, t.versao, {
        ...(r.situacao === 'enviado' ? { ultimo_envio_em: quando } : {}),
        proximo_envio_em: await envioEmUtc(r.proximoEnvio),
      });
      return 1;
    },

    async registrarExecucao(x) {
      const parametros = JSON.stringify({ resumo: resumoDosParametros(x.parametros) });
      const agendamento = x.agendamento && ID.test(x.agendamento) ? Number(x.agendamento) : null;
      const id = await tx.incluir('execucao_relatorio', {
        estabelecimento_id: est,
        relatorio_id: await relatorioId(x.relatorio),
        agendamento_relatorio_id: agendamento,
        usuario_id: c.usuario ?? null,
        ocorrido_em: await agora(),
        tipo: x.tipo,
        formato: FORMATO_NO_BANCO[x.formato],
        parametros,
        linhas: Math.max(0, Math.round(x.linhas)),
        duracao_ms: Math.max(0, Math.round(x.duracaoMs)),
        situacao: x.situacao,
        contem_dado_pessoal: x.dadoPessoal,
        mascarado: x.mascarado,
        motivo: x.justificativa ? x.justificativa.slice(0, 500) : null,
      });
      return String(id);
    },

    async criarPedido(p) {
      await exigirPedido(tx);
      const id = await tx.incluir('pedido_relatorio', {
        estabelecimento_id: est,
        solicitante_usuario_id: usuario(),
        ...camposPedido(p),
        situacao: 'aberto',
      });
      return String(id);
    },

    async responderPedido(id, r, _usuario, versao) {
      const t = await travarPedido(id, versao);
      if (!t || t.cancelado) return 0;
      await tx.alterar('pedido_relatorio', t.id, t.versao, {
        situacao: situacaoPedidoNoBanco(r.situacao),
        relatorio_id: r.relatorio ? await relatorioId(r.relatorio) : null,
        resposta: r.resposta.slice(0, 2_000),
        respondido_por_usuario_id: usuario(),
        respondido_em: await agora(),
      });
      return 1;
    },

    lerPedidoTravado: async (id) => ((await travarPedido(id)) ? lerPedido(id) : null),
    lerAgendamentoTravado: async (id) => ((await travarAgendamento(id)) ? lerAgendamento(id) : null),

    /** Só o pedido ainda aberto e não cancelado se altera (0: recusa). */
    async alterarPedido(id, p, _usuario, versao) {
      const t = await travarPedido(id, versao);
      if (!t || t.cancelado || t.situacao !== 'aberto') return 0;
      await tx.alterar('pedido_relatorio', t.id, t.versao, camposPedido(p));
      return 1;
    },

    async cancelarPedido(id, motivo, _usuario, versao) {
      const t = await travarPedido(id, versao);
      if (!t || t.cancelado || t.situacao === 'publicado') return 0;
      await tx.alterar('pedido_relatorio', t.id, t.versao, {
        cancelado_em: await agora(),
        cancelado_por_usuario_id: usuario(),
        motivo_cancelamento: motivo.slice(0, 200),
      });
      return 1;
    },

    /** Exclusão física só do pedido nunca atendido (o histórico fica na trilha). */
    async excluirPedido(id) {
      const t = await travarPedido(id);
      if (!t || t.cancelado || t.respondido || t.situacao !== 'aberto') return 0;
      await tx.excluir('pedido_relatorio', t.id, t.versao);
      return 1;
    },

    /** Exclusão física só do envio que nunca rodou (nenhuma execução nem envio registrado). */
    async excluirAgendamento(id) {
      const t = await travarAgendamento(id);
      if (!t) return 0;
      const v = await tx.uma(
        `SELECT (SELECT COUNT(*) FROM execucao_relatorio WHERE agendamento_relatorio_id = ?) +
                (SELECT COUNT(*) FROM envio_relatorio WHERE agendamento_relatorio_id = ?) AS n,
                (SELECT ultimo_envio_em IS NOT NULL FROM agendamento_relatorio WHERE id = ?) AS enviado`,
        [t.id, t.id, t.id],
      );
      if (n(v?.['n']) > 0 || verdadeiro(v?.['enviado'])) return 0;
      await tx.executar('DELETE FROM agendamento_relatorio_destinatario WHERE agendamento_relatorio_id = ?', [
        t.id,
      ]);
      await tx.excluir('agendamento_relatorio', t.id, t.versao);
      return 1;
    },

    /** O evento do ciclo vai à trilha desta mesma operação (o valor anterior com os endereços mascarados). */
    async registrarEvento(ev) {
      eventos.push({ evento: ev.evento, antes: ev.antes, motivo: ev.motivo });
      return '';
    },
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaRelatorioIndisponivel(): PortaRelatorio {
  return portaIndisponivel<PortaRelatorio>(METODOS_PORTA_RELATORIO);
}

/** A recusa do Executor com código conhecido (os testes conferem). */
export const codigoDaRecusa = (e: unknown): string | null =>
  e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : null;
