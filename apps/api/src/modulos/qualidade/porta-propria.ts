// Porta PRÓPRIA da notificação de incidentes (M48, etapa 1) sobre o MariaDB do cliente, pelo @sgh/nucleo:
// notificacao_incidente, notificacao_incidente_evento (a linha do tempo) e notificacao_incidente_envio (o Notivisa), com
// os cadastros tipo_incidente, classificacao_incidente e grau_dano (pelo código) e as leituras de estabelecimento,
// setor_funcional, dia_nao_util, usuario, atendimento, paciente e pessoa_fisica. Leituras somente leitura no estabelecimento da
// sessão; gravações diretas numa operação do Executor (gravacaoDireta: trilha, outbox e idempotência na mesma
// transação), com a notificação travada (FOR UPDATE) e conferida pela versão vista.
// Melhoria: o protocolo vem da sequencia_negocio do estabelecimento por ano (uma sequência por ano), não de tabela à parte.
// Melhoria: o tipo, a classificação e o grau de dano são cadastros (FK pelo código), conferidos antes de gravar; o
// cadastro que faltar recusa com `cadastro-pendente` (nada é gravado pela metade).
// Melhoria: a anônima é gravada sem notificador (CHECK do banco) e a trilha dela vai sem usuário (o contexto da gravação
// sai sem a conta), como a regra de anonimato pede.
// Melhoria: o envio ao Notivisa é uma linha própria (notificacao_incidente_envio: exportada = pendente; transcrita com o
// número e o instante), não colunas soltas na notificação.
// Melhoria: o reenvio do mesmo pedido (a chave resumida da tela) devolve a notificação já gravada (`repetida`), conferido
// pela linha do tempo da própria notificação.
// Melhoria: o leito da notificação vem do modelo (a ocupação de leito da internação do atendimento no instante do
// incidente, por FK), não de texto solto copiado na notificação; o "registro" da origem (o número do atendimento) saiu.
// Melhoria: a internação é reconhecida pelo tipo-base da categoria do atendimento (CHECK do banco), não pelo nome dela.
// Melhoria: na sessão "como" (suporte técnico, ADR 0021 R1), cada evento da linha do tempo leva a marca `suporte` em
// `dados`, como na memória: a tela mostra "Suporte técnico" no autor, não o usuário-alvo.
// Melhoria: a sequência anual do protocolo nasce por INSERT ... ON DUPLICATE KEY (a segunda notificação simultânea espera
// a trava da primeira e segue com o número seguinte), sem SELECT-depois-INSERT nem impasse. Como o banco recusa a leitura
// travada de uma linha que outra transação mudou depois do instantâneo (isolamento por instantâneo: erro 1020) ou a trava
// ocupada, a gravação inteira é desfeita e refeita (até 3 vezes) — nada fica pela metade.
// Melhoria: o painel das análises conta pelos prazos e conclusões gravados na própria notificação.
// Etapa 2 (a análise, o plano de ação, a queixa técnica e a sugestão resolvida): porta-propria-etapa2.ts, na mesma
// transação da notificação. As leituras que dependem de dado de OUTRO módulo (candidatos à
// sugestão, adesão aos protocolos, protocolos gerenciados e expostos ao lote) vêm de porta-propria-complemento-c.ts; o
// histórico de riscos segue fechado (503 `modelo-pendente`) até a decisão do marcador do formulário.
import type { ContextoNotificacaoLido } from '@sgh/contratos';
import {
  ehTravaOcupada,
  type Executor,
  ErroOperacao,
  marcaComoAtual,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { GravacaoFeita, TrilhaDaGravacao } from '../exames/public-api.js';
import {
  camelo,
  cobra,
  dataIso,
  exigirUsuario,
  feriadosDoEstabelecimento,
  instante,
  instanteN,
  json,
  type L,
  lerNoEstabelecimento,
  type Linha,
  marcas,
  n,
  nn,
  paraBanco,
  relogioDoEstabelecimento,
  setoresDoEstabelecimento,
  texto,
  textoN,
  usuarioPeloLogin,
  verdadeiro,
} from './apoio-propria.js';
import type { ContextoQualidade, GravadorQualidade, PortaQualidade } from './porta.js';
import { ComplementoQualidadeC, type NucleoComplementoC } from './porta-propria-complemento-c.js';
import {
  gravadorEtapa2,
  lerAcoes,
  lerAnalise,
  lerEventosQueixa,
  lerItens,
  lerNomesDosItens,
  lerQueixa,
  lerQueixas,
  lerResolvidas,
  SQL_ACAO,
  acaoPlano,
  TABELAS_ETAPA2,
} from './porta-propria-etapa2.js';
import type {
  EventoNotificacaoNovo,
  EventoNotificacaoRegistrado,
  FiltroNotificacoes,
  NotificacaoRegistrada,
} from './tipos.js';
import { recusaVersaoNotificacao } from './tipos.js';

/** As tabelas que a gravação da notificação escreve (a transação recusa as outras). */
export const TABELAS_NOTIFICACAO = [
  'notificacao_incidente',
  'notificacao_incidente_evento',
  'notificacao_incidente_envio',
  'sequencia_negocio',
] as const;

const TETO_PRAZOS = 500;
const TENTATIVAS = 3;
/** Leitura travada de linha mudada depois do instantâneo da transação (isolamento por instantâneo do MariaDB). */
const ERRNO_LINHA_MUDOU = 1020;

const GRAVACAO_CONCORRENTE = 'gravacao-concorrente';
function concorrencia(e: unknown): boolean {
  return (e as { errno?: unknown } | null)?.errno === ERRNO_LINHA_MUDOU || ehTravaOcupada(e);
}

const SQL_NOTIFICACAO = `
  SELECT n.id, n.numero, n.hash_codigo_acompanhamento, n.registrada_em, n.ocorrido_em, n.atendimento_id, n.paciente_id,
         n.setor_funcional_id, n.local_descricao, ti.codigo AS tipo, n.tipo_outro, n.chegou_ao_paciente,
         gp.codigo AS dano_percebido, ci.codigo AS classificacao, gd.codigo AS dano, n.evento_nunca, n.descricao,
         n.anonima, un.login AS notificador, n.situacao, n.versao, ur.login AS gestor, n.responsavel_setor_funcional_id,
         n.prazo_analise, n.motivo_descarte, n.concluida_em,
         (SELECT lh.codigo FROM internacao i
            JOIN ocupacao_leito o ON o.internacao_id = i.id AND o.excluido_em IS NULL AND o.situacao <> 'cancelada'
             AND o.data_hora_inicio <= n.ocorrido_em AND (o.data_hora_fim IS NULL OR o.data_hora_fim > n.ocorrido_em)
            JOIN leito_hospitalar lh ON lh.id = o.leito_hospitalar_id
           WHERE i.atendimento_id = n.atendimento_id AND i.excluido_em IS NULL
           ORDER BY o.data_hora_inicio DESC LIMIT 1) AS leito,
         (SELECT e.dados FROM notificacao_incidente_evento e
           WHERE e.notificacao_incidente_id = n.id AND JSON_VALUE(e.dados, '$.tipo') = 'recebida'
           ORDER BY e.id LIMIT 1) AS dados_recebida,
         (SELECT JSON_VALUE(e.dados, '$.duplicadaDe') FROM notificacao_incidente_evento e
           WHERE e.notificacao_incidente_id = n.id AND e.situacao_nova = 'descartada'
           ORDER BY e.id DESC LIMIT 1) AS duplicada_de,
         EXISTS (SELECT 1 FROM notificacao_incidente_evento e
           WHERE e.notificacao_incidente_id = n.id AND JSON_VALUE(e.dados, '$.tipo') IN ('triada', 'reclassificada'))
           AS triada,
         (SELECT MIN(v.ocorrido_em) FROM notificacao_incidente_envio v WHERE v.notificacao_incidente_id = n.id)
           AS notivisa_exportada_em,
         (SELECT v.protocolo FROM notificacao_incidente_envio v
           WHERE v.notificacao_incidente_id = n.id AND v.situacao = 'transcrita' ORDER BY v.id DESC LIMIT 1)
           AS notivisa_numero,
         (SELECT v.enviado_em FROM notificacao_incidente_envio v
           WHERE v.notificacao_incidente_id = n.id AND v.situacao = 'transcrita' ORDER BY v.id DESC LIMIT 1)
           AS notivisa_transcrita_em
    FROM notificacao_incidente n
    JOIN tipo_incidente ti ON ti.id = n.tipo_incidente_id
    JOIN grau_dano gp ON gp.id = n.percebido_grau_dano_id
    LEFT JOIN classificacao_incidente ci ON ci.id = n.classificacao_incidente_id
    LEFT JOIN grau_dano gd ON gd.id = n.grau_dano_id
    LEFT JOIN usuario un ON un.id = n.notificador_usuario_id
    LEFT JOIN usuario ur ON ur.id = n.responsavel_usuario_id
   WHERE n.estabelecimento_id = ? AND n.excluido_em IS NULL`;

interface DadosRecebida {
  readonly origemTela?: string | null;
  readonly origemSugestao?: string | null;
}

function notificacaoDe(r: Linha): NotificacaoRegistrada {
  const d = json<DadosRecebida>(r['dados_recebida'], {});
  const percebido = camelo(r['dano_percebido']);
  return {
    id: n(r['id']),
    protocolo: texto(r['numero']),
    codigoResumo: texto(r['hash_codigo_acompanhamento']),
    notificadaEm: instante(r['registrada_em']),
    ocorridoEm: instante(r['ocorrido_em']),
    atendimento: nn(r['atendimento_id']),
    paciente: nn(r['paciente_id']),
    unidade: nn(r['setor_funcional_id']),
    leito: textoN(r['leito']),
    local: textoN(r['local_descricao']),
    tipo: camelo(r['tipo']),
    tipoOutro: textoN(r['tipo_outro']),
    chegouAoPaciente: verdadeiro(r['chegou_ao_paciente']),
    danoPercebido: percebido,
    classificacao: r['classificacao'] ? camelo(r['classificacao']) : '',
    dano: r['dano'] ? camelo(r['dano']) : percebido,
    neverEvent: verdadeiro(r['evento_nunca']),
    descricao: texto(r['descricao']),
    anonima: verdadeiro(r['anonima']),
    notificador: textoN(r['notificador']),
    origemTela: d.origemTela ?? null,
    origemSugestao: d.origemSugestao ?? null,
    situacao: camelo(r['situacao']),
    triada: verdadeiro(r['triada']),
    versao: n(r['versao']),
    gestor: textoN(r['gestor']),
    unidadeAnalise: nn(r['responsavel_setor_funcional_id']),
    prazoAnalise: dataIso(r['prazo_analise']),
    motivoDescarte: r['motivo_descarte'] ? camelo(r['motivo_descarte']) : null,
    duplicadaDe: textoN(r['duplicada_de']),
    notivisaExportadaEm: instanteN(r['notivisa_exportada_em']),
    notivisaNumero: textoN(r['notivisa_numero']),
    notivisaTranscritaEm: instanteN(r['notivisa_transcrita_em']),
    analiseConcluidaEm: instanteN(r['concluida_em']),
  };
}

/** O id do cadastro pelo código (o vocabulário do contrato em snake_case), ou recusa `cadastro-pendente`. */
async function idDoCadastro(
  l: L,
  tabela: 'tipo_incidente' | 'classificacao_incidente' | 'grau_dano',
  codigo: string,
  nome: string,
): Promise<number> {
  const r = await l.uma<{ id: number }>(`SELECT id FROM ${tabela} WHERE codigo = ? AND ativo = TRUE`, [
    cobra(codigo),
  ]);
  if (!r)
    throw recusa(
      'cadastro-pendente',
      `O cadastro de ${nome} não tem o código "${codigo}": peça ao administrador que carregue o cadastro da qualidade.`,
    );
  return Number(r.id);
}

/** Uma linha da linha do tempo da notificação (o tipo do evento e o antes/depois vão em `dados`). */
async function evento(
  tx: TxOperacao,
  notificacao: number,
  agora: string,
  situacaoAnterior: string | null,
  situacaoNova: string,
  usuario: number | null,
  e: EventoNotificacaoNovo,
  extra: Record<string, unknown> = {},
): Promise<void> {
  // Sessão "como" (ADR 0021, R1): a marca do suporte técnico em `dados`, como na memória (a tela mostra o autor real).
  const suporte = marcaComoAtual() !== null ? { suporte: true } : {};
  await tx.incluir('notificacao_incidente_evento', {
    notificacao_incidente_id: notificacao,
    operacao: e.tipo === 'recebida' ? 'inclusao' : 'alteracao',
    dados: JSON.stringify({ tipo: e.tipo, ...(e.dados ?? {}), ...extra, ...suporte }),
    ocorrido_em: paraBanco(agora),
    usuario_id: usuario,
    situacao_anterior: situacaoAnterior,
    situacao_nova: situacaoNova,
    motivo: situacaoNova === 'descartada' ? (e.texto ?? '').slice(0, 1000) || null : null,
    comentario: e.texto ?? null,
  });
}

export class PortaQualidadePropria implements PortaQualidade {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;
  private readonly complementoC: ComplementoQualidadeC;

  constructor(
    private readonly nucleo: NucleoComplementoC,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
    this.complementoC = new ComplementoQualidadeC(nucleo);
  }

  private ler<T>(c: ContextoQualidade, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, c, fn);
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  /** A notificação não usa receita do executor: as gravações são diretas, pela própria tela (a liberação é a da chave). */
  podeGravar() {
    return Promise.resolve({ pode: true, codigo: null, motivo: null });
  }

  executar(_c: ContextoQualidade, op: string): Promise<GravacaoFeita> {
    return Promise.reject(
      recusa('operacao-desconhecida', `Operação ${op} sem receita do executor na qualidade.`),
    );
  }

  gravarSgh<T>(
    c: ContextoQualidade,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorQualidade) => Promise<T>,
  ): Promise<T> {
    const tentar = async (tentativa: number): Promise<T> => {
      try {
        return await gravacaoDireta(this.executor, c, {
          nome: 'qualidade.notificacao',
          tabelas: [...TABELAS_NOTIFICACAO, ...TABELAS_ETAPA2],
          trilha,
          gravador: (tx, est) => this.gravador(tx, est),
          fn: async (g) => {
            try {
              return await fn(g);
            } catch (e) {
              if (!concorrencia(e)) throw e;
              throw new ErroOperacao(
                409,
                GRAVACAO_CONCORRENTE,
                'Gravação simultânea',
                'Outra gravação mexeu no mesmo registro ao mesmo tempo: tente de novo.',
              );
            }
          },
        });
      } catch (e) {
        // A transação foi desfeita inteira: refazer é seguro (a idempotência do pedido vale igual).
        if (tentativa < TENTATIVAS && e instanceof ErroOperacao && e.problema.codigo === GRAVACAO_CONCORRENTE)
          return tentar(tentativa + 1);
        throw e;
      }
    };
    return tentar(1);
  }

  private async travarLinha(tx: TxOperacao, est: number, id: number): Promise<NotificacaoRegistrada> {
    const [t] = await tx.consultarParaAtualizar(
      'SELECT id FROM notificacao_incidente WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
      { teto: 1 },
    );
    if (!t)
      throw new ErroOperacao(
        404,
        'nao-encontrado',
        'Notificação não encontrada',
        'A notificação não existe neste estabelecimento.',
      );
    const r = await tx.uma(`${SQL_NOTIFICACAO} AND n.id = ?`, [est, id]);
    if (!r)
      throw new ErroOperacao(
        404,
        'nao-encontrado',
        'Notificação não encontrada',
        'A notificação não existe neste estabelecimento.',
      );
    return notificacaoDe(r);
  }

  /** Muda a notificação travada, conferida pela versão vista (a mudança de versão no meio é recusada). */
  private async mudar(
    tx: TxOperacao,
    est: number,
    id: number,
    versao: number,
    valores: Record<string, unknown>,
  ): Promise<{ antes: NotificacaoRegistrada; versao: number }> {
    const antes = await this.travarLinha(tx, est, id);
    if (antes.versao !== versao) throw recusaVersaoNotificacao();
    // O núcleo carimba alterado_em, alterado_por e a versão (colunas reservadas: nunca vão nos valores).
    const nova = await tx.alterar('notificacao_incidente', id, versao, valores);
    return { antes, versao: nova };
  }

  private gravador(tx: TxOperacao, est: number): GravadorQualidade {
    const quem = (login: string) => exigirUsuario(tx, login);
    return {
      notificar: async (x) => {
        if (x.chaveResumo) {
          const ja = await tx.uma(
            `SELECT n.id, n.numero FROM notificacao_incidente n
               JOIN notificacao_incidente_evento e ON e.notificacao_incidente_id = n.id
              WHERE n.estabelecimento_id = ? AND JSON_VALUE(e.dados, '$.tipo') = 'recebida'
                AND JSON_VALUE(e.dados, '$.chave') = ?
              LIMIT 1`,
            [est, x.chaveResumo],
          );
          if (ja) return { id: n(ja['id']), protocolo: texto(ja['numero']), repetida: true };
        }
        const tipo = await idDoCadastro(tx, 'tipo_incidente', x.tipo, 'tipos de incidente');
        const percebido = await idDoCadastro(tx, 'grau_dano', x.danoPercebido, 'graus de dano');
        const classificacao = await idDoCadastro(
          tx,
          'classificacao_incidente',
          x.classificacao,
          'classificações de incidente',
        );
        if (x.unidade !== null) {
          const s = await tx.uma(
            'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [x.unidade, est],
          );
          if (!s) throw recusa('unidade-invalida', 'A unidade informada não é deste estabelecimento.');
        }
        if (x.atendimento !== null) {
          const a = await tx.uma(
            'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [x.atendimento, est],
          );
          if (!a) throw recusa('atendimento-inexistente', 'O atendimento não é deste estabelecimento.');
        }
        const notificador = x.anonima ? null : await quem(x.notificador);
        const ano = Number(x.agora.slice(0, 4));
        const seq = `notificacao_incidente_${ano}`;
        // A sequência do ano nasce na primeira notificação do ano: o INSERT ... ON DUPLICATE KEY trava a chave única, e
        // a notificação simultânea espera e segue com o número seguinte (sem SELECT-depois-INSERT, sem impasse).
        await tx.executar(
          `INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, incremento, valor_maximo, ativo,
                                          criado_em, criado_por, versao)
           VALUES (?, ?, NULL, 1, 1, 999999, TRUE, ?, ?, 1)
           ON DUPLICATE KEY UPDATE id = id`,
          [est, seq, new Date(), notificador],
        );
        const numero = await tx.proximoNumero(seq);
        const protocolo = x.protocoloDe(ano, numero.valor);
        const ocorrido = x.ocorridoEm.length === 16 ? `${x.ocorridoEm}:00` : x.ocorridoEm.slice(0, 19);
        const id = await tx.incluir('notificacao_incidente', {
          estabelecimento_id: est,
          numero: protocolo,
          hash_codigo_acompanhamento: x.codigoResumo,
          anonima: x.anonima,
          notificador_usuario_id: notificador,
          registrada_em: paraBanco(x.agora),
          ocorrido_em: paraBanco(ocorrido),
          setor_funcional_id: x.unidade,
          local_descricao: x.local ? x.local.slice(0, 80) : null,
          paciente_id: x.paciente,
          atendimento_id: x.atendimento,
          tipo_incidente_id: tipo,
          tipo_outro: x.tipoOutro,
          chegou_ao_paciente: x.chegouAoPaciente,
          percebido_grau_dano_id: percebido,
          classificacao_incidente_id: classificacao,
          grau_dano_id: percebido,
          descricao: x.descricao,
          situacao: 'recebida',
        });
        await evento(
          tx,
          id,
          x.agora,
          null,
          'recebida',
          notificador,
          { tipo: 'recebida', por: '' },
          {
            chave: x.chaveResumo,
            origemTela: x.origemTela,
            origemSugestao: x.origemSugestao,
          },
        );
        return { id, protocolo, repetida: false };
      },
      travar: (id) => this.travarLinha(tx, est, id),
      triar: async (t) => {
        const tipo = await idDoCadastro(tx, 'tipo_incidente', t.tipo, 'tipos de incidente');
        const classificacao = await idDoCadastro(
          tx,
          'classificacao_incidente',
          t.classificacao,
          'classificações de incidente',
        );
        const dano = await idDoCadastro(tx, 'grau_dano', t.dano, 'graus de dano');
        const antes = await this.travarLinha(tx, est, t.id);
        const situacao = antes.situacao === 'recebida' ? 'triada' : cobra(antes.situacao);
        const r = await this.mudar(tx, est, t.id, t.versao, {
          tipo_incidente_id: tipo,
          tipo_outro: t.tipo === 'outro' ? t.tipoOutro : null,
          classificacao_incidente_id: classificacao,
          grau_dano_id: dano,
          evento_nunca: t.neverEvent,
          situacao,
        });
        const usuario = await quem(t.usuario);
        for (const e of t.eventos)
          await evento(tx, t.id, t.agora, cobra(antes.situacao), situacao, usuario, {
            tipo: e,
            por: t.usuario,
            texto: e === 'reclassificada' ? t.justificativa : null,
            dados: e === 'reclassificada' ? { antes: t.antes } : null,
          });
        return { versao: r.versao };
      },
      descartar: async (d) => {
        const r = await this.mudar(tx, est, d.id, d.versao, {
          situacao: 'descartada',
          motivo_descarte: cobra(d.motivo),
        });
        await evento(tx, d.id, d.agora, cobra(r.antes.situacao), 'descartada', await quem(d.usuario), {
          tipo: 'descartada',
          por: d.usuario,
          texto: d.justificativa,
          dados: { duplicadaDe: d.duplicadaDe },
        });
        return { versao: r.versao };
      },
      distribuir: async (d) => {
        const gestor = await quem(d.gestor);
        const setor = await tx.uma(
          'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [d.unidade, est],
        );
        if (!setor) throw recusa('unidade-invalida', 'A unidade da análise não é deste estabelecimento.');
        const r = await this.mudar(tx, est, d.id, d.versao, {
          situacao: 'distribuida',
          responsavel_usuario_id: gestor,
          responsavel_setor_funcional_id: d.unidade,
          prazo_analise: d.prazoAnalise.slice(0, 10),
        });
        await evento(tx, d.id, d.agora, cobra(r.antes.situacao), 'distribuida', await quem(d.usuario), {
          tipo: 'distribuida',
          por: d.usuario,
          texto: d.orientacao,
        });
        return { versao: r.versao };
      },
      devolver: async (d) => {
        const antes = await this.travarLinha(tx, est, d.id);
        const r = await this.mudar(tx, est, d.id, d.versao, { situacao: cobra(antes.situacao) });
        await evento(tx, d.id, d.agora, cobra(antes.situacao), cobra(antes.situacao), await quem(d.usuario), {
          tipo: 'devolutiva',
          por: d.usuario,
          texto: d.texto,
        });
        return { versao: r.versao };
      },
      notivisaExportada: async (m) => {
        const atual = await this.travarLinha(tx, est, m.id);
        if (atual.notivisaExportadaEm !== null) return { marcou: false };
        const usuario = await quem(m.usuario);
        await tx.incluir('notificacao_incidente_envio', {
          notificacao_incidente_id: m.id,
          operacao: 'inclusao',
          ocorrido_em: paraBanco(m.agora),
          usuario_id: usuario,
          tipo_envio: 'inicial',
          situacao: 'pendente',
        });
        await evento(tx, m.id, m.agora, cobra(atual.situacao), cobra(atual.situacao), usuario, {
          tipo: 'notivisaExportada',
          por: m.usuario,
        });
        return { marcou: true };
      },
      transcricao: async (t) => {
        const antes = await this.travarLinha(tx, est, t.id);
        const r = await this.mudar(tx, est, t.id, t.versao, { situacao: cobra(antes.situacao) });
        const usuario = await quem(t.usuario);
        await tx.incluir('notificacao_incidente_envio', {
          notificacao_incidente_id: t.id,
          operacao: 'inclusao',
          ocorrido_em: paraBanco(t.agora),
          usuario_id: usuario,
          tipo_envio: antes.notivisaNumero ? 'retificacao' : 'inicial',
          situacao: 'transcrita',
          enviado_em: paraBanco(t.transcritaEm.length === 16 ? `${t.transcritaEm}:00` : t.transcritaEm),
          protocolo: t.numeroNotivisa.slice(0, 40),
          motivo_retificacao: antes.notivisaNumero ? 'Nova transcrição do número do Notivisa.' : null,
        });
        await evento(tx, t.id, t.agora, cobra(antes.situacao), cobra(antes.situacao), usuario, {
          tipo: 'notivisaTranscrita',
          por: t.usuario,
          dados: { numero: t.numeroNotivisa },
        });
        return { versao: r.versao };
      },
      ...gravadorEtapa2(tx, est, {
        travarNotificacao: (id) => this.travarLinha(tx, est, id),
        mudarNotificacao: (id, versao, valores) => this.mudar(tx, est, id, versao, valores),
        eventoNotificacao: (id, agora, antes, depois, usuario, e) =>
          evento(tx, id, agora, antes, depois, usuario, e),
      }),
    };
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoQualidade) {
    return this.ler(c, (l, est) => relogioDoEstabelecimento(l, est));
  }

  contexto(c: ContextoQualidade, atendimento: number): Promise<ContextoNotificacaoLido | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT a.id, a.paciente_id, a.situacao, a.entrada_em, a.setor_funcional_id, sf.nome AS nome_setor,
                COALESCE(pf.nome, '') AS nome, p.numero_prontuario, pf.data_nascimento, sx.sigla AS sexo, ca.tipo_base,
                lh.codigo AS leito, ac.nome AS acomodacao
           FROM atendimento a
           JOIN paciente p ON p.id = a.paciente_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN sexo sx ON sx.id = pf.sexo_id
           LEFT JOIN setor_funcional sf ON sf.id = a.setor_funcional_id
           LEFT JOIN categoria_atendimento ca ON ca.id = a.categoria_atendimento_id
           LEFT JOIN internacao i ON i.atendimento_id = a.id AND i.excluido_em IS NULL
           LEFT JOIN leito_hospitalar lh ON lh.id = i.leito_hospitalar_id
           LEFT JOIN acomodacao ac ON ac.id = lh.acomodacao_id
          WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [atendimento, est],
      );
      if (!r) return null;
      const sexo = texto(r['sexo']);
      const internacao = texto(r['tipo_base']) === 'internacao';
      return {
        atendimento: n(r['id']),
        paciente: n(r['paciente_id']),
        nomePaciente: texto(r['nome']),
        prontuario: nn(r['numero_prontuario']),
        sexo: sexo === 'F' || sexo === 'M' ? sexo : 'I',
        nascimento: dataIso(r['data_nascimento']),
        tipoAtendimento: internacao ? 'internacao' : 'externo',
        // O "registro" da origem não existe no modelo próprio (o atendimento já identifica); o campo sai do contrato
        // (pedido em saida/04-03.json) e, até lá, vai nulo.
        registro: null,
        unidade: nn(r['setor_funcional_id']),
        nomeUnidade: textoN(r['nome_setor']),
        leito: textoN(r['leito']),
        acomodacao: textoN(r['acomodacao']),
        entradaEm: instanteN(r['entrada_em']),
        encerrado: ['encerrado', 'cancelado'].includes(texto(r['situacao'])),
      };
    });
  }

  unidades(c: ContextoQualidade) {
    return this.ler(c, (l, est) => setoresDoEstabelecimento(l, est));
  }

  feriados(c: ContextoQualidade, de: string, ate: string) {
    return this.ler(c, (l, est) => feriadosDoEstabelecimento(l, est, de, ate));
  }

  usuarioAtivo(c: ContextoQualidade, login: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT u.id FROM usuario u
           JOIN usuario_estabelecimento ue ON ue.usuario_id = u.id AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL
            AND ue.vigencia_inicio <= CURRENT_DATE AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURRENT_DATE)
          WHERE u.login = ? AND u.situacao = 'ativo' AND u.excluido_em IS NULL
          LIMIT 1`,
        [est, login.trim()],
      );
      return r !== null;
    });
  }

  gestores(c: ContextoQualidade, termo: string) {
    return this.ler(c, async (l, est) => {
      const t = `%${termo.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const linhas = await l.consultar(
        `SELECT DISTINCT u.login, u.nome FROM usuario u
           JOIN usuario_estabelecimento ue ON ue.usuario_id = u.id AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL
            AND ue.vigencia_inicio <= CURRENT_DATE AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURRENT_DATE)
          WHERE u.situacao = 'ativo' AND u.tipo_conta = 'pessoa' AND u.excluido_em IS NULL
            AND (u.login LIKE ? OR u.nome LIKE ?)
          ORDER BY u.nome, u.login
          LIMIT 20`,
        [est, t, t],
      );
      return linhas.map((r) => ({ login: texto(r['login']), nome: texto(r['nome']) }));
    });
  }

  notificacao(c: ContextoQualidade, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_NOTIFICACAO} AND n.id = ?`, [est, id]);
      return r ? notificacaoDe(r) : null;
    });
  }

  porProtocolo(c: ContextoQualidade, protocolo: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_NOTIFICACAO} AND n.numero = ?`, [est, protocolo]);
      return r ? notificacaoDe(r) : null;
    });
  }

  eventos(c: ContextoQualidade, id: number): Promise<EventoNotificacaoRegistrado[]> {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT e.ocorrido_em, e.dados, e.comentario, u.login
           FROM notificacao_incidente_evento e
           JOIN notificacao_incidente n ON n.id = e.notificacao_incidente_id
           LEFT JOIN usuario u ON u.id = e.usuario_id
          WHERE e.notificacao_incidente_id = ? AND n.estabelecimento_id = ? AND n.excluido_em IS NULL
          ORDER BY e.ocorrido_em, e.id`,
        [id, est],
        { teto: 1000 },
      );
      return linhas.map((r) => {
        const d = json<Record<string, unknown>>(r['dados'], {});
        const {
          tipo,
          chave: _chave,
          registro: _registro,
          leito: _leito,
          origemTela: _o,
          origemSugestao: _s,
          ...resto
        } = d;
        void [_chave, _registro, _leito, _o, _s];
        return {
          tipo: texto(tipo),
          em: instante(r['ocorrido_em']),
          por: textoN(r['login']) ?? 'anonimo',
          texto: textoN(r['comentario']),
          dados: Object.keys(resto).length ? JSON.stringify(resto) : null,
        };
      });
    });
  }

  lista(c: ContextoQualidade, f: FiltroNotificacoes) {
    return this.ler(c, async (l, est) => {
      const onde: string[] = [];
      const p: unknown[] = [est];
      if (f.situacao) {
        onde.push('n.situacao = ?');
        p.push(cobra(f.situacao));
      }
      if (f.situacoes?.length) {
        onde.push(`n.situacao IN (${marcas(f.situacoes.length)})`);
        p.push(...f.situacoes.map(cobra));
      }
      if (f.tipo) {
        onde.push('ti.codigo = ?');
        p.push(cobra(f.tipo));
      }
      if (f.classificacao) {
        onde.push('ci.codigo = ?');
        p.push(cobra(f.classificacao));
      }
      if (f.unidade !== undefined) {
        onde.push('n.setor_funcional_id = ?');
        p.push(f.unidade);
      }
      if (f.de) {
        onde.push('n.registrada_em >= ?');
        p.push(`${f.de.slice(0, 10)} 00:00:00`);
      }
      if (f.ate) {
        onde.push('n.registrada_em < DATE_ADD(?, INTERVAL 1 DAY)');
        p.push(f.ate.slice(0, 10));
      }
      if (f.protocolo) {
        onde.push('n.numero = ?');
        p.push(f.protocolo);
      }
      if (f.gestor) {
        onde.push('ur.login = ?');
        p.push(f.gestor);
      }
      if (f.ids) {
        if (!f.ids.length) return { itens: [], temMais: false };
        onde.push(`n.id IN (${marcas(f.ids.length)})`);
        p.push(...f.ids);
      }
      const porPagina = Math.max(1, Math.min(f.porPagina, 200));
      const pagina = Math.max(1, f.pagina);
      const linhas = await l.consultar(
        `${SQL_NOTIFICACAO}${onde.map((o) => ` AND ${o}`).join('')}
          ORDER BY n.registrada_em DESC, n.id DESC LIMIT ? OFFSET ?`,
        [...p, porPagina + 1, (pagina - 1) * porPagina],
        { teto: porPagina + 1 },
      );
      return { itens: linhas.slice(0, porPagina).map(notificacaoDe), temMais: linhas.length > porPagina };
    });
  }

  comPrazo(c: ContextoQualidade) {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `${SQL_NOTIFICACAO} AND n.situacao NOT IN ('concluida', 'descartada')
          ORDER BY n.registrada_em, n.id LIMIT ?`,
        [est, TETO_PRAZOS + 1],
        { teto: TETO_PRAZOS + 1 },
      );
      return { itens: linhas.slice(0, TETO_PRAZOS).map(notificacaoDe), cortada: linhas.length > TETO_PRAZOS };
    });
  }

  painelNotificacoes(c: ContextoQualidade, de: string, fimExclusivo: string) {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT ti.codigo AS tipo, ci.codigo AS classificacao, COALESCE(gd.codigo, gp.codigo) AS dano, n.evento_nunca,
                n.situacao, n.anonima, COUNT(*) AS quantidade
           FROM notificacao_incidente n
           JOIN tipo_incidente ti ON ti.id = n.tipo_incidente_id
           JOIN grau_dano gp ON gp.id = n.percebido_grau_dano_id
           LEFT JOIN classificacao_incidente ci ON ci.id = n.classificacao_incidente_id
           LEFT JOIN grau_dano gd ON gd.id = n.grau_dano_id
          WHERE n.estabelecimento_id = ? AND n.excluido_em IS NULL AND n.registrada_em >= ? AND n.registrada_em < ?
          GROUP BY ti.codigo, ci.codigo, COALESCE(gd.codigo, gp.codigo), n.evento_nunca, n.situacao, n.anonima`,
        [
          est,
          paraBanco(de.length === 10 ? `${de}T00:00:00` : de),
          paraBanco(fimExclusivo.length === 10 ? `${fimExclusivo}T00:00:00` : fimExclusivo),
        ],
        { teto: 5000 },
      );
      return linhas.map((r) => ({
        tipo: camelo(r['tipo']),
        classificacao: r['classificacao'] ? camelo(r['classificacao']) : '',
        dano: camelo(r['dano']),
        neverEvent: verdadeiro(r['evento_nunca']),
        situacao: camelo(r['situacao']),
        anonima: verdadeiro(r['anonima']),
        quantidade: n(r['quantidade']),
      }));
    });
  }

  /** O login do usuário da sessão (para a conferência de quem notificou). */
  async loginDaSessao(c: ContextoQualidade): Promise<string | null> {
    if (c.usuario === null) return null;
    return this.ler(c, async (l) =>
      textoN((await l.uma('SELECT login FROM usuario WHERE id = ?', [c.usuario]))?.['login']),
    );
  }

  /** O id da conta pelo login (para os testes e as telas que só têm o login). */
  usuarioPeloLogin(c: ContextoQualidade, login: string) {
    return this.ler(c, (l) => usuarioPeloLogin(l, login));
  }

  // ── Etapa 2 (leitura sobre o modelo próprio): a análise (analise_incidente e as causas com o fator contribuinte) e as
  // ações do plano (acao_plano_qualidade do plano da notificação ou da análise dela). Os registros podem vir do conector
  // ou de outra tela, então a leitura é a do banco, nunca um vazio presumido. A queixa técnica e a sugestão resolvida
  // ainda não têm o mapeamento do contrato (área de vigilância, conduta, alerta, série e registro do produto; o resumo
  // da sugestão): falham fechadas (503 `modelo-pendente`). ──

  analise(c: ContextoQualidade, notificacao: number) {
    return this.ler(c, (l, est) => lerAnalise(l, est, notificacao));
  }

  acoes(c: ContextoQualidade, notificacao: number) {
    return this.ler(c, (l, est) => lerAcoes(l, est, notificacao));
  }

  /** As ações abertas de que o login é o responsável (teto 200). */
  acoesDoResponsavel(c: ContextoQualidade, login: string) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_ACAO} AND ru.login = ? AND ap.situacao IN ('planejada', 'em_andamento') ORDER BY ap.prazo, ap.id LIMIT 200`,
          [est, login.trim()],
          { teto: 200 },
        )
      ).map(acaoPlano),
    );
  }

  queixas(
    c: ContextoQualidade,
    f: {
      readonly situacao?: string;
      readonly area?: string;
      readonly pagina: number;
      readonly porPagina: number;
    },
  ) {
    return this.ler(c, (l, est) => lerQueixas(l, est, f));
  }

  queixa(c: ContextoQualidade, id: number) {
    return this.ler(c, (l, est) => lerQueixa(l, est, id));
  }

  eventosQueixa(c: ContextoQualidade, id: number) {
    return this.ler(c, (l, est) => lerEventosQueixa(l, est, id));
  }

  resolvidas(c: ContextoQualidade, resumos: readonly string[]) {
    return this.ler(c, (l, est) => lerResolvidas(l, est, resumos));
  }

  /** As ações dos planos das notificações por situação, eficácia e prazo vencido (aberta com prazo antes de hoje). */
  painelAcoes(c: ContextoQualidade, hoje: string) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT ap.situacao, ap.eficacia,
                  (ap.situacao IN ('planejada', 'em_andamento') AND ap.prazo < ?) AS vencida, COUNT(*) AS quantidade
             FROM acao_plano_qualidade ap
             JOIN plano_acao_qualidade pa ON pa.id = ap.plano_acao_qualidade_id AND pa.excluido_em IS NULL
             LEFT JOIN analise_incidente ai ON ai.id = pa.analise_incidente_id
            WHERE pa.estabelecimento_id = ? AND ap.excluido_em IS NULL
              AND COALESCE(pa.notificacao_incidente_id, ai.notificacao_incidente_id) IS NOT NULL
            GROUP BY ap.situacao, ap.eficacia, vencida
            ORDER BY ap.situacao, ap.eficacia, vencida`,
          [hoje.slice(0, 10), est],
          { teto: 100 },
        )
      ).map((r) => ({
        situacao: camelo(r['situacao']),
        eficacia: textoN(r['eficacia']),
        vencida: verdadeiro(r['vencida']),
        quantidade: n(r['quantidade']),
      })),
    );
  }

  /** As análises do período (pela data do incidente): com prazo, concluídas, no prazo e vencidas (sem as descartadas). */
  painelAnalises(c: ContextoQualidade, de: string, fim: string, hoje: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT COUNT(*) AS com_prazo,
                COALESCE(SUM(n.concluida_em IS NOT NULL), 0) AS concluidas,
                COALESCE(SUM(n.concluida_em IS NOT NULL AND DATE(n.concluida_em) <= n.prazo_analise), 0) AS no_prazo,
                COALESCE(SUM(n.concluida_em IS NULL AND n.prazo_analise < ?), 0) AS vencidas
           FROM notificacao_incidente n
          WHERE n.estabelecimento_id = ? AND n.excluido_em IS NULL AND n.prazo_analise IS NOT NULL
            AND n.situacao <> 'descartada' AND n.ocorrido_em >= ? AND n.ocorrido_em < ?`,
        [hoje.slice(0, 10), est, `${de.slice(0, 10)} 00:00:00`, `${fim.slice(0, 10)} 00:00:00`],
      );
      return {
        comPrazo: n(r?.['com_prazo']),
        concluidas: n(r?.['concluidas']),
        noPrazo: n(r?.['no_prazo']),
        vencidas: n(r?.['vencidas']),
      };
    });
  }

  // As leituras de outro módulo (checagens, checklists, protocolos gerenciados e itens): porta-propria-complemento-c.ts.
  candidatos(c: ContextoQualidade, login: string, desde: string) {
    return this.complementoC.candidatos(c, login, desde);
  }

  painelAdesao(c: ContextoQualidade, de: string, fim: string, agora: string) {
    return this.complementoC.painelAdesao(c, de, fim, agora);
  }

  historicoRiscos(c: ContextoQualidade) {
    return this.complementoC.historicoRiscos(c);
  }

  protocolosGerenciados(c: ContextoQualidade, inicio: string, fim: string) {
    return this.complementoC.protocolosGerenciados(c, inicio, fim);
  }

  expostos(c: ContextoQualidade, item: number, lote: string) {
    return this.complementoC.expostos(c, item, lote);
  }

  itens(c: ContextoQualidade, termo: string) {
    return this.ler(c, (l) => lerItens(l, termo));
  }

  nomesDosItens(c: ContextoQualidade, codigos: readonly number[]) {
    return this.ler(c, (l) => lerNomesDosItens(l, codigos));
  }
}
