// Gravações da farmácia hospitalar sobre o banco do cliente (M29), dentro da operação do Executor da porta própria
// (trilha, outbox e idempotência na mesma transação): a dispensação por horário, a entrega ao setor, a devolução e o
// cancelamento da dose, a perda e a dupla conferência do controlado, o fechamento do livro de controlados, a
// dispensação ambulatorial e a escrituração do envio nacional de controlados. As regras das telas ficam no domínio
// (@sgh/contratos/regras-suprimentos); aqui ficam as conferências sob a trava (horário do atendimento, saldo do local e
// do lote, situação da entrega e da dose) e as escritas.
// Modelo próprio:
//   - a dispensação (dispensacao) tem um item por insumo e lote (dispensacao_item) e uma dose por item
//     (dose_dispensada, ligada ao horário prescrito); o horário guarda a dispensação que o atendeu
//     (horario_administracao.dispensacao_id), o que impede a segunda dispensação do mesmo horário;
//   - a saída do estoque é um documento (documento_estoque 'saida_paciente', ligado à dispensação) com uma linha por
//     item e um lançamento no razão (movimento_estoque) que baixa o saldo do local (saldo_estoque) e do lote
//     (saldo_lote), relidos com trava e alterados pela versão relida;
//   - o controle da entrega é a entrega ao setor (entrega_setor + entrega_setor_item): em trânsito, entregue (com quem
//     recebeu, quando e o modo) ou estornada;
//   - a devolução é devolucao_dispensacao (+ item) com o documento de entrada (documento_estoque 'devolucao_interna'),
//     e o cancelamento antes da entrega é o estorno do lançamento de saída (estorno_movimento_estoque_id), que devolve o
//     horário à fila;
//   - a perda do controlado é o documento de baixa com a testemunha; a dupla conferência é conferencia_controlado, por
//     documento e lote;
//   - o livro fechado é livro_controlado encerrado, com o hash SHA-256 do conteúdo montado e a guarda legal; o
//     fechamento oficial exige o conteúdo no armazenamento de arquivos (ADR 0004), que esta porta ainda não recebe;
//   - a dispensação ambulatorial é dispensacao 'ambulatorial' com a receita retida (receita_controlada), e o envio
//     nacional é envio_controlado_nacional com um item por lançamento escriturado.
// Os números de negócio (dispensação, documento de estoque e devolução) vêm de sequencia_negocio; os tipos de movimento
// do estoque vêm do cadastro (tipo_movimento_estoque, pela natureza): sem a configuração, a gravação recusa sem gravar.
import { createHash } from 'node:crypto';
import {
  codigoEtiquetaDose,
  conferirAceiteEntrega,
  conferirDevolucaoDose,
  conferirDispensacaoAmbulatorial,
  conferirDuplaConferencia,
  conferirFechamentoLivro,
  conferirPerdaControlado,
  conferirPrescritorControlado,
  etiquetasAceitas,
  guardaAte,
  listaDoItem,
  montarEnvioSngpc,
  type PrescritorControlado,
  type RecusaSuprimentos,
} from '@sgh/contratos/regras-suprimentos';
import type {
  CancelarDispensacaoEntrada,
  ConfirmarEntregaEntrada,
  DevolverDoseEntrada,
  DispensarHorarioEntrada,
  RegistrarPerdaControladoEntrada,
} from '@sgh/contratos';
import { ErroOperacao, recusa, type ResultadoOperacao, type TxOperacao } from '@sgh/nucleo';
import { civil, FUSO_PADRAO } from '../exames/relogio.js';
import type { ExtrasGravacaoFarmacia } from './gravador-avaliacao.js';
import type { GravadorSghFarmacia } from './porta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const idOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const q4 = (x: number) => Math.round(x * 10_000) / 10_000;
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;

/** As tabelas que as gravações da farmácia hospitalar declaram ao Executor. */
export const TABELAS_DISPENSACAO = [
  'dispensacao',
  'dispensacao_item',
  'dose_dispensada',
  'documento_estoque',
  'documento_estoque_item',
  'movimento_estoque',
  'saldo_estoque',
  'saldo_lote',
  'horario_administracao',
  'entrega_setor',
  'entrega_setor_item',
  'devolucao_dispensacao',
  'devolucao_dispensacao_item',
  'conferencia_controlado',
  'livro_controlado',
  'receita_controlada',
  'envio_controlado_nacional',
  'envio_controlado_nacional_item',
] as const;

/** Situação da entrega ao setor (modelo) ↔ número do contrato das telas (7 dispensada, 8 entregue, 9 estornada). */
export const NUMERO_DA_ENTREGA: Readonly<Record<string, number>> = {
  em_transito: 7,
  entregue: 8,
  estornada: 9,
};
export const ENTREGA_DO_NUMERO: Readonly<Record<number, string>> = {
  7: 'em_transito',
  8: 'entregue',
  9: 'estornada',
};

/** Tipo do documento conferido (tela) → tipo do documento de estoque (modelo). */
const DOCUMENTO_CONFERIDO: Readonly<Record<'saida' | 'devolucao' | 'perda', string>> = {
  saida: 'saida_paciente',
  devolucao: 'devolucao_interna',
  perda: 'baixa',
};

/** Validade da receita retida, em dias, pela lista (antimicrobiano: 10 dias; demais: 30 dias). */
const VALIDADE_RECEITA_DIAS = { antimicrobiano: 10, controlado: 30 } as const;

/** A lista de controle especial → tipo da receita retida (receita_controlada.tipo_receita). */
function tipoReceita(lista: string | null, antimicrobiano: boolean): string | null {
  if (lista) {
    if (lista.startsWith('A')) return 'notificacao_a';
    if (lista === 'B1') return 'notificacao_b';
    if (lista === 'B2') return 'notificacao_b2';
    if (lista === 'C2') return 'notificacao_retinoide';
    if (lista === 'C3') return 'notificacao_talidomida';
    return 'receita_controle_especial';
  }
  return antimicrobiano ? 'receita_antimicrobiano' : null;
}

function recusar(r: RecusaSuprimentos | null | undefined): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}

/** A recusa do fechamento oficial do livro: o conteúdo vai ao armazenamento de arquivos (ADR 0004), não ligado aqui. */
export function armazenamentoIndisponivel(): ErroOperacao {
  return new ErroOperacao(
    503,
    'armazenamento-indisponivel',
    'Armazenamento de arquivos indisponível',
    'O fechamento oficial guarda o conteúdo do livro no armazenamento de arquivos, que ainda não está ligado à farmácia: feche no modo conferência. Nada foi gravado.',
  );
}

interface InsumoLido {
  readonly id: number;
  readonly nome: string;
  readonly unidade: number;
  readonly rastreavel: boolean;
  readonly lista: string | null;
  readonly listaId: number | null;
  readonly antimicrobiano: boolean;
  readonly barras: string | null;
}

interface LoteLido {
  readonly id: number;
  readonly numero: string;
  readonly validade: string;
  readonly situacao: string;
}

interface Movimento {
  readonly local: number;
  readonly insumo: InsumoLido;
  readonly lote: number | null;
  readonly quantidade: number;
  readonly sentido: 'entrada' | 'saida';
  /** A natureza do tipo de movimento no cadastro (consumo_paciente, devolucao, perda). */
  readonly natureza: string;
  readonly refs: Readonly<Record<string, unknown>>;
}

/** A gravação da farmácia hospitalar numa transação do Executor (estabelecimento e usuário da sessão). */
export function gravadorDispensacao(
  tx: TxOperacao,
  est: number,
  usuario: number,
  extras: ExtrasGravacaoFarmacia,
) {
  const agora = new Date();
  let fusoLido: string | null = null;
  const fuso = async () => {
    if (fusoLido === null) {
      const r = await tx.uma<Linha>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
      fusoLido = texto(r?.['fuso_horario']) || FUSO_PADRAO;
    }
    return fusoLido;
  };
  const hoje = async () => civil(agora, await fuso()).data;
  const competencia = async () => `${(await hoje()).slice(0, 7)}-01`;
  const anoMes = async (d: Date) => {
    const c = civil(d, await fuso()).data;
    return { ano: Number(c.slice(0, 4)), mes: Number(c.slice(5, 7)) };
  };

  const loginDe = async (u: unknown): Promise<string | null> => {
    if (u === null || u === undefined) return null;
    const r = await tx.uma<Linha>('SELECT login FROM usuario WHERE id = ?', [u]);
    return r ? texto(r['login']) : null;
  };

  const profissionalDe = async (u: number): Promise<number | null> => {
    const r = await tx.uma<Linha>(
      `SELECT profissional_id FROM usuario_vinculo_profissional
        WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND profissional_id IS NOT NULL
          AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
        ORDER BY vigencia_inicio DESC LIMIT 1`,
      [u, est],
    );
    return r ? n(r['profissional_id']) : null;
  };

  /** O registro no conselho do prescritor (a inscrição principal ativa), para a regra do controlado. */
  const prescritorControlado = async (prof: number | null): Promise<PrescritorControlado | null> => {
    if (prof === null) return null;
    const r = await tx.uma<Linha>(
      `SELECT ic.id, cc.sigla, ic.numero_inscricao, uf.sigla AS uf
         FROM inscricao_conselho ic
         JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
         LEFT JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
        WHERE ic.profissional_id = ? AND ic.excluido_em IS NULL AND ic.situacao IN ('ativa','provisoria')
        ORDER BY ic.principal DESC, ic.id LIMIT 1`,
      [prof],
    );
    if (!r) return { vinculo: null, conselho: null, registro: null, uf: null };
    return {
      vinculo: n(r['id']),
      conselho: texto(r['sigla']) || null,
      registro: Number(texto(r['numero_inscricao']).replace(/\D/g, '')) || null,
      uf: texto(r['uf']) || null,
    };
  };

  const insumoDe = async (id: number, campo = 'item'): Promise<InsumoLido> => {
    const r = await tx.uma<Linha>(
      `SELECT i.id, i.nome, i.estoque_unidade_medida_id, i.controla_lote, i.antimicrobiano, i.codigo_gtin,
              i.lista_controle_especial_id, lc.codigo_lista
         FROM insumo i LEFT JOIN lista_controle_especial lc ON lc.id = i.lista_controle_especial_id
        WHERE i.id = ? AND i.excluido_em IS NULL`,
      [id],
    );
    if (!r)
      throw recusa('item-inexistente', 'O item não existe no cadastro de insumos.', { campos: [campo] });
    return {
      id: n(r['id']),
      nome: texto(r['nome']),
      unidade: n(r['estoque_unidade_medida_id']),
      rastreavel: verdadeiro(r['controla_lote']),
      lista: listaDoItem(texto(r['codigo_lista'])) ?? (texto(r['codigo_lista']) || null),
      listaId: idOuNulo(r['lista_controle_especial_id']),
      antimicrobiano: verdadeiro(r['antimicrobiano']),
      barras: texto(r['codigo_gtin']) || null,
    };
  };

  const loteDe = async (insumo: number, numero: string, campo = 'lotes'): Promise<LoteLido> => {
    const r = await tx.uma<Linha>(
      `SELECT id, numero_lote, validade, situacao FROM lote_insumo
        WHERE estabelecimento_id = ? AND insumo_id = ? AND numero_lote = ? AND excluido_em IS NULL`,
      [est, insumo, numero.trim()],
    );
    if (!r) throw recusa('lote-inexistente', `O lote ${numero} não existe para o item.`, { campos: [campo] });
    return {
      id: n(r['id']),
      numero: texto(r['numero_lote']),
      validade: dataIso(r['validade']) ?? '',
      situacao: texto(r['situacao']),
    };
  };

  const conferirLocal = async (local: number, campo = 'local'): Promise<void> => {
    const r = await tx.uma(
      'SELECT id FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
      [local, est],
    );
    if (!r)
      throw recusa('local-inexistente', 'O local de estoque não existe neste estabelecimento.', {
        campos: [campo],
      });
  };

  const centroDoEstabelecimento = (id: number) =>
    tx.uma('SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL', [
      id,
      est,
    ]);

  const tipoMovimento = async (natureza: string, sentido: string): Promise<number> => {
    const r = await tx.uma<Linha>(
      `SELECT id FROM tipo_movimento_estoque WHERE natureza = ? AND sentido = ? AND ativo
        ORDER BY sistema DESC, id LIMIT 1`,
      [natureza, sentido],
    );
    if (!r)
      throw recusa(
        'dominio-nao-configurado',
        `O tipo de movimento de estoque "${natureza}" (${sentido}) não está cadastrado: configure os tipos de movimento.`,
      );
    return n(r['id']);
  };

  /** Lança no razão do estoque e anda com o saldo do local e do lote (relidos com trava, pela versão relida). */
  const movimentar = async (m: Movimento): Promise<{ id: number; custo: number; tipo: number }> => {
    const tipo = await tipoMovimento(m.natureza, m.sentido);
    const q = q4(m.quantidade);
    const [s] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, quantidade, custo_medio FROM saldo_estoque
        WHERE local_estoque_id = ? AND insumo_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [m.local, m.insumo.id, est],
    );
    const custo = n(s?.['custo_medio']);
    let saldoApos: number;
    if (m.sentido === 'saida') {
      if (!s || n(s['quantidade']) + 1e-9 < q)
        throw recusa(
          'saldo-insuficiente',
          `Saldo insuficiente de ${m.insumo.nome}: há ${n(s?.['quantidade'])} no local e a saída pede ${q}.`,
          { campos: ['quantidade'] },
        );
      saldoApos = q4(n(s['quantidade']) - q);
      await tx.alterar('saldo_estoque', n(s['id']), n(s['versao']), {
        quantidade: saldoApos,
        ultima_movimentacao_em: agora,
      });
    } else if (s) {
      saldoApos = q4(n(s['quantidade']) + q);
      await tx.alterar('saldo_estoque', n(s['id']), n(s['versao']), {
        quantidade: saldoApos,
        ultima_movimentacao_em: agora,
      });
    } else {
      saldoApos = q;
      await tx.incluir('saldo_estoque', {
        estabelecimento_id: est,
        local_estoque_id: m.local,
        insumo_id: m.insumo.id,
        quantidade: q,
        ultima_movimentacao_em: agora,
      });
    }
    if (m.lote !== null) {
      const [sl] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao, quantidade, bloqueado FROM saldo_lote
          WHERE local_estoque_id = ? AND lote_insumo_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [m.local, m.lote, est],
      );
      if (m.sentido === 'saida') {
        if (!sl || verdadeiro(sl['bloqueado']) || n(sl['quantidade']) + 1e-9 < q)
          throw recusa('lote-sem-saldo', 'O lote não tem saldo livre neste local para a quantidade pedida.', {
            campos: ['lotes'],
          });
        await tx.alterar('saldo_lote', n(sl['id']), n(sl['versao']), {
          quantidade: q4(n(sl['quantidade']) - q),
          ultima_movimentacao_em: agora,
        });
      } else if (sl)
        await tx.alterar('saldo_lote', n(sl['id']), n(sl['versao']), {
          quantidade: q4(n(sl['quantidade']) + q),
          ultima_movimentacao_em: agora,
        });
      else
        await tx.incluir('saldo_lote', {
          estabelecimento_id: est,
          local_estoque_id: m.local,
          lote_insumo_id: m.lote,
          quantidade: q,
          competencia: await competencia(),
          ultima_movimentacao_em: agora,
        });
    }
    const id = await tx.incluir('movimento_estoque', {
      estabelecimento_id: est,
      local_estoque_id: m.local,
      ocorrido_em: agora,
      competencia: await competencia(),
      tipo_movimento_estoque_id: tipo,
      natureza: m.sentido,
      insumo_id: m.insumo.id,
      unidade_medida_id: m.insumo.unidade,
      quantidade: q,
      quantidade_estoque: q,
      custo_unitario: custo,
      valor_total: Math.round(q * custo * 100) / 100,
      saldo_apos: saldoApos,
      custo_medio_apos: custo,
      usuario_id: usuario,
      faturavel: m.natureza === 'consumo_paciente',
      ...m.refs,
    });
    return { id, custo, tipo };
  };

  /** Uma linha do documento de estoque, com o lançamento que ela gerou. */
  const linhaDocumento = (
    documento: number,
    sequencia: number,
    insumo: InsumoLido,
    lote: { id: number; validade: string } | null,
    quantidade: number,
    mov: { id: number; custo: number },
    extra: Readonly<Record<string, unknown>>,
  ) =>
    tx.incluir('documento_estoque_item', {
      documento_estoque_id: documento,
      sequencia,
      insumo_id: insumo.id,
      unidade_medida_id: insumo.unidade,
      lote_insumo_id: lote?.id ?? null,
      data_validade: lote?.validade ?? null,
      quantidade,
      custo_unitario: mov.custo,
      valor_total: Math.round(quantidade * mov.custo * 100) / 100,
      movimento_estoque_id: mov.id,
      ...extra,
    });

  /** A dose dispensada com tudo o que a devolução e o cancelamento precisam (travada). */
  const doseTravada = async (dose: number): Promise<Linha> => {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      `SELECT dd.id, dd.versao, dd.quantidade, dd.situacao, dd.horario_administracao_id,
              di.id AS item_id, di.versao AS item_versao, di.quantidade AS item_quantidade, di.quantidade_devolvida,
              di.insumo_id, di.lote_insumo_id, di.data_validade, di.prescricao_item_id, li.numero_lote,
              d.id AS dispensacao_id, d.versao AS dispensacao_versao, d.situacao AS dispensacao_situacao, d.numero,
              d.atendimento_id, d.paciente_id, d.prescricao_id, d.setor_funcional_id, d.unidade_internacao_id,
              d.centro_custo_id, d.local_estoque_id
         FROM dose_dispensada dd
         JOIN dispensacao_item di ON di.id = dd.dispensacao_item_id AND di.excluido_em IS NULL
         JOIN dispensacao d ON d.id = di.dispensacao_id AND d.excluido_em IS NULL
         LEFT JOIN lote_insumo li ON li.id = di.lote_insumo_id
        WHERE dd.id = ? AND d.estabelecimento_id = ? AND dd.excluido_em IS NULL`,
      [dose, est],
    );
    if (!r)
      throw recusa('dose-inexistente', 'A dose dispensada não existe neste estabelecimento.', {
        campos: ['dose'],
      });
    return r;
  };

  /** A entrega ao setor da dose (travada), se houver. */
  const entregaDaDose = async (dose: number): Promise<Linha | null> => {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      `SELECT es.id, es.versao, es.situacao FROM entrega_setor_item esi
         JOIN entrega_setor es ON es.id = esi.entrega_setor_id AND es.excluido_em IS NULL
        WHERE esi.dose_dispensada_id = ? AND esi.excluido_em IS NULL AND es.estabelecimento_id = ?
        ORDER BY es.id DESC LIMIT 1`,
      [dose, est],
    );
    return r ?? null;
  };

  const documentoSaidaDa = async (dispensacao: number): Promise<Linha | null> =>
    (await tx.uma<Linha>(
      `SELECT id, versao, numero, movimentado_em, situacao FROM documento_estoque
        WHERE dispensacao_id = ? AND tipo = 'saida_paciente' AND estabelecimento_id = ? AND excluido_em IS NULL
        ORDER BY id LIMIT 1`,
      [dispensacao, est],
    )) ?? null;

  const evento = (tipo: string, carga: Record<string, number | string | null>) =>
    extras.eventos.push({ tipo, carga });

  // ── Dispensação por horário ─────────────────────────────────────────────────────────────────────────────────────

  async function dispensarHorario(e: DispensarHorarioEntrada): Promise<ResultadoOperacao> {
    await conferirLocal(e.local);
    if (!(await centroDoEstabelecimento(e.centroCusto)))
      throw recusa('centro-custo-inexistente', 'O centro de custo não existe.', { campos: ['centroCusto'] });
    const at = await tx.uma<Linha>(
      `SELECT a.id, a.paciente_id, a.fonte_pagadora_id, a.setor_funcional_id,
              i.unidade_internacao_id, ui.setor_funcional_id AS setor_unidade
         FROM atendimento a
         LEFT JOIN internacao i ON i.atendimento_id = a.id AND i.situacao IN ('ativa','alta_medica') AND i.excluido_em IS NULL
         LEFT JOIN unidade_internacao ui ON ui.id = i.unidade_internacao_id
        WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
      [e.atendimento, est],
    );
    if (!at)
      throw recusa('atendimento-inexistente', 'O atendimento não existe neste estabelecimento.', {
        campos: ['atendimento'],
      });
    const setor = idOuNulo(at['setor_unidade']) ?? idOuNulo(at['setor_funcional_id']);
    if (setor === null)
      throw recusa(
        'setor-indefinido',
        'A unidade do paciente não tem setor funcional: a dispensação vai ao setor que recebe e consome.',
        { campos: ['atendimento'] },
      );
    // Os horários pedidos, travados em ordem (as dispensações concorrentes do mesmo horário se enfileiram aqui).
    const pedidos = new Map(e.doses.map((d) => [d.horario, d]));
    const ids = [...pedidos.keys()].sort((a, b) => a - b);
    const linhas = await tx.consultarParaAtualizar<Linha>(
      `SELECT h.id, h.versao, h.atendimento_id, h.prescricao_id, h.prescricao_item_id, h.previsto_em, h.suspenso,
              h.dispensacao_id, h.quantidade_prevista, pi.quantidade AS item_quantidade, pi.situacao AS item_situacao,
              ip.insumo_id, p.prescritor_profissional_id, p.situacao AS prescricao_situacao
         FROM horario_administracao h
         JOIN prescricao_item pi ON pi.id = h.prescricao_item_id AND pi.excluido_em IS NULL
         JOIN prescricao p ON p.id = h.prescricao_id AND p.excluido_em IS NULL
         LEFT JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id
        WHERE h.id IN (${ids.map(() => '?').join(', ')}) AND h.estabelecimento_id = ? AND h.excluido_em IS NULL
        ORDER BY h.id`,
      [...ids, est],
    );
    const porId = new Map(linhas.map((l) => [n(l['id']), l]));
    let ja = 0;
    let susp = 0;
    const livres: { h: Linha; q: number; lotes: { lote: string; validade: string; quantidade: number }[] }[] =
      [];
    for (const id of ids) {
      const h = porId.get(id);
      if (!h || n(h['atendimento_id']) !== e.atendimento)
        throw recusa('horario-de-outro-paciente', 'Um dos horários não é deste atendimento.', {
          campos: ['doses'],
        });
      if (
        verdadeiro(h['suspenso']) ||
        ['suspenso', 'suspenso_correcao', 'cancelado'].includes(texto(h['item_situacao'])) ||
        ['suspensa', 'cancelada'].includes(texto(h['prescricao_situacao']))
      ) {
        susp += 1;
        continue;
      }
      if (h['dispensacao_id'] !== null) {
        ja += 1;
        continue;
      }
      if (h['insumo_id'] === null)
        throw recusa('item-sem-produto', 'O item prescrito não tem produto de estoque para dispensar.', {
          campos: ['doses'],
        });
      const d = pedidos.get(id)!;
      const q =
        d.quantidade ??
        (h['quantidade_prevista'] !== null ? n(h['quantidade_prevista']) : n(h['item_quantidade']));
      if (!(q > 0))
        throw recusa('quantidade-indefinida', 'A dose não tem quantidade prescrita: informe a quantidade.', {
          campos: ['doses'],
        });
      livres.push({ h, q: q4(q), lotes: d.lotes });
    }
    if (livres.length === 0) {
      if (susp > 0 && ja === 0)
        throw recusa('item-suspenso', 'O item foi suspenso na prescrição: não há dose a dispensar.', {
          campos: ['doses'],
        });
      throw recusa('dose-ja-dispensada', 'As doses já foram dispensadas (por outro terminal).', {
        campos: ['doses'],
      });
    }
    // Conferências de cada dose antes de gravar: lotes do item rastreável e o prescritor do controlado.
    const hojeIso = await hoje();
    const preparadas: { h: Linha; insumo: InsumoLido; partes: { lote: LoteLido | null; q: number }[] }[] = [];
    for (const x of livres) {
      const insumo = await insumoDe(n(x.h['insumo_id']), 'doses');
      if (insumo.rastreavel && x.lotes.length === 0)
        throw recusa('lote-obrigatorio', `${insumo.nome} é rastreável: informe o lote da dose.`, {
          campos: ['lotes'],
        });
      let partes: { lote: LoteLido | null; q: number }[] = [{ lote: null, q: x.q }];
      if (x.lotes.length > 0) {
        const soma = q4(x.lotes.reduce((t, l) => t + l.quantidade, 0));
        if (Math.abs(soma - x.q) > 1e-6)
          throw recusa('lotes-soma', 'A soma dos lotes tem de ser igual à quantidade da dose.', {
            campos: ['lotes'],
          });
        partes = [];
        for (const l of x.lotes) {
          const lote = await loteDe(insumo.id, l.lote);
          if (lote.situacao !== 'liberado' || lote.validade < hojeIso)
            throw recusa('lote-indisponivel', `O lote ${lote.numero} está vencido ou não liberado.`, {
              campos: ['lotes'],
            });
          partes.push({ lote, q: q4(l.quantidade) });
        }
      }
      if (insumo.lista)
        recusar(
          conferirPrescritorControlado({
            lista: listaDoItem(insumo.lista),
            internado: true,
            prescritor: await prescritorControlado(idOuNulo(x.h['prescritor_profissional_id'])),
            daPrescricao: true,
          }),
        );
      preparadas.push({ h: x.h, insumo, partes });
    }
    const numero = await tx.proximoNumero('dispensacao');
    const previstos = preparadas
      .map((x) => new Date(String(x.h['previsto_em'])))
      .sort((a, b) => a.getTime() - b.getTime());
    const dispensacao = await tx.incluir('dispensacao', {
      estabelecimento_id: est,
      numero: numero.valor,
      tipo: 'horario',
      atendimento_id: e.atendimento,
      paciente_id: n(at['paciente_id']),
      // A prescrição de referência é a da primeira dose; cada item aponta o seu item prescrito.
      prescricao_id: n(preparadas[0]!.h['prescricao_id']),
      local_estoque_id: e.local,
      setor_funcional_id: setor,
      unidade_internacao_id: idOuNulo(at['unidade_internacao_id']),
      centro_custo_id: e.centroCusto,
      fonte_pagadora_id: idOuNulo(at['fonte_pagadora_id']),
      periodo_inicio: previstos[0] ?? null,
      periodo_fim: previstos.at(-1) ?? null,
      dispensado_em: agora,
      dispensado_usuario_id: usuario,
      consolidada: true,
      situacao: 'dispensada',
    });
    const tipoSaida = await tipoMovimento('consumo_paciente', 'saida');
    const numeroDoc = await tx.proximoNumero('documento_estoque');
    const documento = await tx.incluir('documento_estoque', {
      estabelecimento_id: est,
      numero: numeroDoc.valor,
      tipo: 'saida_paciente',
      tipo_movimento_estoque_id: tipoSaida,
      origem_local_estoque_id: e.local,
      setor_funcional_id: setor,
      centro_custo_id: e.centroCusto,
      atendimento_id: e.atendimento,
      paciente_id: n(at['paciente_id']),
      dispensacao_id: dispensacao,
      movimentado_em: agora,
      concluido_em: agora,
      concluido_usuario_id: usuario,
      consolidado: true,
      situacao: 'concluido',
    });
    const entrega = await tx.incluir('entrega_setor', {
      estabelecimento_id: est,
      setor_funcional_id: setor,
      unidade_internacao_id: idOuNulo(at['unidade_internacao_id']),
      origem_local_estoque_id: e.local,
      entregador_usuario_id: usuario,
      saida_em: agora,
      situacao: 'em_transito',
    });
    const doses: number[] = [];
    let seq = 0;
    let valor = 0;
    for (const x of preparadas) {
      for (const p of x.partes) {
        seq += 1;
        const item = await tx.incluir('dispensacao_item', {
          dispensacao_id: dispensacao,
          sequencia: seq,
          prescricao_item_id: n(x.h['prescricao_item_id']),
          insumo_id: x.insumo.id,
          unidade_medida_id: x.insumo.unidade,
          lote_insumo_id: p.lote?.id ?? null,
          data_validade: p.lote?.validade ?? null,
          quantidade: p.q,
          situacao: 'dispensado',
        });
        const mov = await movimentar({
          local: e.local,
          insumo: x.insumo,
          lote: p.lote?.id ?? null,
          quantidade: p.q,
          sentido: 'saida',
          natureza: 'consumo_paciente',
          refs: {
            documento_estoque_id: documento,
            dispensacao_item_id: item,
            atendimento_id: e.atendimento,
            paciente_id: n(at['paciente_id']),
            setor_funcional_id: setor,
            centro_custo_id: e.centroCusto,
          },
        });
        valor += Math.round(p.q * mov.custo * 100) / 100;
        await linhaDocumento(documento, seq, x.insumo, p.lote, p.q, mov, {
          dispensacao_item_id: item,
          prescricao_item_id: n(x.h['prescricao_item_id']),
          cobravel: true,
        });
        const dose = await tx.incluir('dose_dispensada', {
          dispensacao_item_id: item,
          sequencia: 1,
          horario_administracao_id: n(x.h['id']),
          previsto_em: new Date(String(x.h['previsto_em'])),
          quantidade: p.q,
          etiqueta_emitida: true,
          etiqueta_emitida_em: agora,
          emissor_usuario_id: usuario,
          situacao: 'dispensada',
        });
        await tx.incluir('entrega_setor_item', {
          entrega_setor_id: entrega,
          sequencia: seq,
          dispensacao_id: dispensacao,
          dose_dispensada_id: dose,
        });
        doses.push(dose);
      }
      await tx.alterar('horario_administracao', n(x.h['id']), n(x.h['versao']), {
        dispensacao_id: dispensacao,
      });
    }
    if (valor > 0)
      await tx.alterar('documento_estoque', documento, 1, { valor_total: Math.round(valor * 100) / 100 });
    const { ano, mes } = await anoMes(agora);
    extras.alvo = { tabela: 'dispensacao', id: dispensacao };
    evento('farmacia.dispensacao.registrada', { dispensacao, documento, entrega, doses: doses.length });
    return {
      dispensacao,
      doc: numero.valor,
      saida: documento,
      ano,
      mes,
      docSaida: numeroDoc.valor,
      doses: doses.length,
      ocupadas: ja + susp,
      controle: entrega,
      idsDoses: doses.join(','),
    };
  }

  // ── Entrega ao setor ────────────────────────────────────────────────────────────────────────────────────────────

  async function confirmarEntrega(e: ConfirmarEntregaEntrada): Promise<ResultadoOperacao> {
    const [es] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, situacao, entregador_usuario_id FROM entrega_setor
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.controle, est],
    );
    if (!es) throw recusa('controle-inexistente', 'A entrega não existe.', { campos: ['controle'] });
    const itens = await tx.consultar<Linha>(
      `SELECT esi.id AS esi_id, esi.versao AS esi_versao, dd.id AS dose, dd.versao AS dose_versao, dd.situacao,
              di.id AS item_id, di.versao AS item_versao, di.insumo_id, i.codigo_gtin, li.numero_lote, di.data_validade,
              esi.dispensacao_id
         FROM entrega_setor_item esi
         JOIN dose_dispensada dd ON dd.id = esi.dose_dispensada_id AND dd.excluido_em IS NULL
         JOIN dispensacao_item di ON di.id = dd.dispensacao_item_id
         JOIN insumo i ON i.id = di.insumo_id
         LEFT JOIN lote_insumo li ON li.id = di.lote_insumo_id
        WHERE esi.entrega_setor_id = ? AND esi.excluido_em IS NULL
        ORDER BY esi.sequencia`,
      [e.controle],
    );
    const etiquetas = itens
      .filter((x) => e.dose === undefined || n(x['dose']) === e.dose)
      .flatMap((x) =>
        etiquetasAceitas(
          codigoEtiquetaDose({
            dose: n(x['dose']),
            item: n(x['insumo_id']),
            barras: texto(x['codigo_gtin']) || null,
            lote: texto(x['numero_lote']) || null,
            validade: dataIso(x['data_validade']),
          }),
        ),
      );
    const autor = (await loginDe(usuario)) ?? '';
    recusar(
      conferirAceiteEntrega({
        situacao: NUMERO_DA_ENTREGA[texto(es['situacao'])] ?? null,
        modo: e.modo,
        leitura: e.leitura ?? null,
        etiquetas,
        autor,
        dispensador: await loginDe(es['entregador_usuario_id']),
        podeAceitar: true,
      }),
    );
    await tx.alterar('entrega_setor', e.controle, n(es['versao']), {
      situacao: 'entregue',
      entregue_em: agora,
      recebedor_usuario_id: usuario,
      modo_confirmacao: e.modo,
      dispositivo: e.dispositivo ?? null,
    });
    const dispensacoes = new Set<number>();
    for (const x of itens) {
      await tx.alterar('entrega_setor_item', n(x['esi_id']), n(x['esi_versao']), {
        conferido_em: agora,
        leitura:
          e.modo === 'leitura' && (e.dose === undefined || n(x['dose']) === e.dose)
            ? (e.leitura ?? null)
            : null,
      });
      if (texto(x['situacao']) === 'dispensada') {
        await tx.alterar('dose_dispensada', n(x['dose']), n(x['dose_versao']), { situacao: 'entregue' });
        await tx.alterar('dispensacao_item', n(x['item_id']), n(x['item_versao']), { situacao: 'entregue' });
      }
      dispensacoes.add(n(x['dispensacao_id']));
    }
    let saida = 0;
    for (const d of dispensacoes) {
      const [r] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao, situacao FROM dispensacao WHERE id = ? AND estabelecimento_id = ?',
        [d, est],
      );
      if (r && texto(r['situacao']) === 'dispensada')
        await tx.alterar('dispensacao', d, n(r['versao']), { situacao: 'entregue' });
      saida = saida || n((await documentoSaidaDa(d))?.['id']);
    }
    extras.alvo = { tabela: 'entrega_setor', id: e.controle };
    evento('farmacia.entrega.confirmada', { entrega: e.controle, modo: e.modo });
    return { controle: e.controle, anterior: e.controle, saida };
  }

  // ── Devolução e cancelamento da dose ────────────────────────────────────────────────────────────────────────────

  async function devolverDose(e: DevolverDoseEntrada): Promise<ResultadoOperacao> {
    const d = await doseTravada(e.dose);
    if (['cancelada', 'devolvida'].includes(texto(d['situacao'])))
      throw recusa('dose-sem-saldo', 'A dose foi cancelada ou já devolvida por inteiro.', {
        campos: ['dose'],
      });
    if (d['setor_funcional_id'] === null)
      throw recusa(
        'dose-sem-setor',
        'A dose não saiu para um setor: registre a devolução pela farmácia ambulatorial.',
        {
          campos: ['dose'],
        },
      );
    recusar(
      conferirDevolucaoDose({
        quantidade: e.quantidade,
        dispensada: n(d['quantidade']),
        jaDevolvida: n(d['quantidade_devolvida']),
        lote: texto(d['numero_lote']) || null,
        loteInformado: e.lote ?? null,
      }),
    );
    await conferirLocal(e.local);
    const motivo = await tx.uma<Linha>('SELECT id FROM motivo_devolucao_estoque WHERE codigo = ? AND ativo', [
      e.motivo,
    ]);
    if (!motivo)
      throw recusa('dominio-nao-configurado', `O motivo de devolução "${e.motivo}" não está cadastrado.`, {
        campos: ['motivo'],
      });
    const insumo = await insumoDe(n(d['insumo_id']));
    const lote =
      d['lote_insumo_id'] === null
        ? null
        : { id: n(d['lote_insumo_id']), validade: dataIso(d['data_validade']) ?? '' };
    const q = q4(e.quantidade);
    const refs = {
      atendimento_id: idOuNulo(d['atendimento_id']),
      paciente_id: idOuNulo(d['paciente_id']),
      setor_funcional_id: idOuNulo(d['setor_funcional_id']),
      centro_custo_id: idOuNulo(d['centro_custo_id']),
    };
    const numeroDoc = await tx.proximoNumero('documento_estoque');
    const documento = await tx.incluir('documento_estoque', {
      estabelecimento_id: est,
      numero: numeroDoc.valor,
      tipo: 'devolucao_interna',
      tipo_movimento_estoque_id: await tipoMovimento('devolucao', 'entrada'),
      origem_local_estoque_id: e.local,
      dispensacao_id: n(d['dispensacao_id']),
      motivo_devolucao_estoque_id: n(motivo['id']),
      movimentado_em: agora,
      concluido_em: agora,
      concluido_usuario_id: usuario,
      consolidado: true,
      situacao: 'concluido',
      observacao: e.observacao ?? null,
      ...refs,
    });
    const devolucao = await tx.incluir('devolucao_dispensacao', {
      estabelecimento_id: est,
      numero: (await tx.proximoNumero('devolucao_dispensacao')).formatado,
      dispensacao_id: n(d['dispensacao_id']),
      prescricao_id: idOuNulo(d['prescricao_id']),
      unidade_internacao_id: idOuNulo(d['unidade_internacao_id']),
      local_estoque_id: e.local,
      motivo_devolucao_estoque_id: n(motivo['id']),
      devolvido_em: agora,
      conferido_por_usuario_id: usuario,
      conferido_em: agora,
      documento_estoque_id: documento,
      situacao: 'conferida',
      observacao: e.observacao ?? null,
      ...refs,
    });
    const devItem = await tx.incluir('devolucao_dispensacao_item', {
      devolucao_dispensacao_id: devolucao,
      sequencia: 1,
      dispensacao_item_id: n(d['item_id']),
      prescricao_item_id: idOuNulo(d['prescricao_item_id']),
      insumo_id: insumo.id,
      lote_insumo_id: lote?.id ?? null,
      validade: lote?.validade || null,
      unidade_medida_id: insumo.unidade,
      quantidade: q,
      quantidade_aceita: q,
      condicao: 'reaproveitavel',
    });
    const mov = await movimentar({
      local: e.local,
      insumo,
      lote: lote?.id ?? null,
      quantidade: q,
      sentido: 'entrada',
      natureza: 'devolucao',
      refs: {
        documento_estoque_id: documento,
        devolucao_dispensacao_item_id: devItem,
        dispensacao_item_id: n(d['item_id']),
        motivo_devolucao_estoque_id: n(motivo['id']),
        ...refs,
      },
    });
    await linhaDocumento(documento, 1, insumo, lote, q, mov, {
      dispensacao_item_id: n(d['item_id']),
      prescricao_item_id: idOuNulo(d['prescricao_item_id']),
    });
    const devolvida = q4(n(d['quantidade_devolvida']) + q);
    const inteira = devolvida + 1e-9 >= n(d['quantidade']);
    await tx.alterar('dispensacao_item', n(d['item_id']), n(d['item_versao']), {
      quantidade_devolvida: devolvida,
      ...(inteira ? { situacao: 'devolvido' } : {}),
    });
    if (inteira) await tx.alterar('dose_dispensada', e.dose, n(d['versao']), { situacao: 'devolvida' });
    if (['dispensada', 'entregue'].includes(texto(d['dispensacao_situacao'])))
      await tx.alterar('dispensacao', n(d['dispensacao_id']), n(d['dispensacao_versao']), {
        situacao: 'devolvida_parcial',
      });
    const { ano, mes } = await anoMes(agora);
    extras.alvo = { tabela: 'devolucao_dispensacao', id: devolucao };
    evento('farmacia.dose.devolvida', { devolucao, documento, dose: e.dose });
    return { id: documento, ano, mes, doc: numeroDoc.valor, itens: 1, dose: e.dose };
  }

  async function cancelarDispensacao(e: CancelarDispensacaoEntrada): Promise<ResultadoOperacao> {
    const d = await doseTravada(e.dose);
    const es = await entregaDaDose(e.dose);
    if (es && texto(es['situacao']) === 'entregue')
      throw recusa('ja-entregue', 'A dose já foi entregue ao setor: registre a devolução.', {
        campos: ['dose'],
      });
    if (texto(d['situacao']) !== 'dispensada' || (es && texto(es['situacao']) === 'estornada'))
      throw recusa('nao-dispensada', 'A dose não está dispensada (ou já foi estornada).', {
        campos: ['dose'],
      });
    const resto = q4(n(d['quantidade']) - n(d['quantidade_devolvida']));
    const insumo = await insumoDe(n(d['insumo_id']));
    const doc = await documentoSaidaDa(n(d['dispensacao_id']));
    let estorno: number | null = null;
    if (resto > 0) {
      // O estorno do lançamento de saída da dose: entrada no mesmo local, apontando o lançamento estornado.
      const original = await tx.uma<Linha>(
        `SELECT id FROM movimento_estoque WHERE dispensacao_item_id = ? AND natureza = 'saida' AND estabelecimento_id = ?
          AND excluido_em IS NULL ORDER BY id LIMIT 1`,
        [n(d['item_id']), est],
      );
      estorno = (
        await movimentar({
          local: n(d['local_estoque_id']),
          insumo,
          lote: idOuNulo(d['lote_insumo_id']),
          quantidade: resto,
          sentido: 'entrada',
          natureza: 'devolucao',
          refs: {
            documento_estoque_id: doc ? n(doc['id']) : null,
            dispensacao_item_id: n(d['item_id']),
            estorno_movimento_estoque_id: original ? n(original['id']) : null,
            atendimento_id: idOuNulo(d['atendimento_id']),
            paciente_id: idOuNulo(d['paciente_id']),
            setor_funcional_id: idOuNulo(d['setor_funcional_id']),
            centro_custo_id: idOuNulo(d['centro_custo_id']),
          },
        })
      ).id;
    }
    await tx.alterar('dose_dispensada', e.dose, n(d['versao']), { situacao: 'cancelada' });
    await tx.alterar('dispensacao_item', n(d['item_id']), n(d['item_versao']), { situacao: 'cancelado' });
    // O horário volta à fila (a dispensação dele foi desfeita).
    if (d['horario_administracao_id'] !== null) {
      const [h] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao, dispensacao_id FROM horario_administracao WHERE id = ? AND estabelecimento_id = ?',
        [n(d['horario_administracao_id']), est],
      );
      if (h && n(h['dispensacao_id']) === n(d['dispensacao_id']))
        await tx.alterar('horario_administracao', n(h['id']), n(h['versao']), { dispensacao_id: null });
    }
    // Sem dose ativa, a entrega é estornada e a dispensação, cancelada (com o documento de saída estornado).
    const ativas = await tx.uma<Linha>(
      `SELECT COUNT(*) AS n FROM dose_dispensada dd JOIN dispensacao_item di ON di.id = dd.dispensacao_item_id
        WHERE di.dispensacao_id = ? AND dd.situacao NOT IN ('cancelada','devolvida') AND dd.excluido_em IS NULL`,
      [n(d['dispensacao_id'])],
    );
    if (n(ativas?.['n']) === 0) {
      if (es)
        await tx.alterar('entrega_setor', n(es['id']), n(es['versao']), {
          situacao: 'estornada',
          estornado_em: agora,
          motivo_estorno: e.motivo,
        });
      await tx.alterar('dispensacao', n(d['dispensacao_id']), n(d['dispensacao_versao']), {
        situacao: 'cancelada',
        cancelado_em: agora,
        motivo_cancelamento: e.motivo.slice(0, 250),
      });
      if (doc && texto(doc['situacao']) === 'concluido')
        await tx.alterar('documento_estoque', n(doc['id']), n(doc['versao']), { situacao: 'estornado' });
    }
    extras.alvo = { tabela: 'dose_dispensada', id: e.dose };
    evento('farmacia.dose.cancelada', { dose: e.dose, dispensacao: n(d['dispensacao_id']) });
    const { ano, mes } = await anoMes(agora);
    return {
      id: estorno ?? 0,
      ano,
      mes,
      doc: doc ? n(doc['numero']) : 0,
      itens: 1,
      dose: e.dose,
      saida: doc ? n(doc['id']) : 0,
    };
  }

  // ── Controlados ─────────────────────────────────────────────────────────────────────────────────────────────────

  async function registrarPerdaControlado(
    p: RegistrarPerdaControladoEntrada,
    reautenticadoEm: number | null,
  ): Promise<ResultadoOperacao> {
    const insumo = await insumoDe(p.item);
    if (!insumo.lista)
      throw recusa('nao-controlado', 'O item não é controlado: registre a saída comum.', {
        campos: ['item'],
      });
    await conferirLocal(p.local);
    if (!(await centroDoEstabelecimento(p.centroCusto)))
      throw recusa('centro-custo-inexistente', 'O centro de custo não existe.', { campos: ['centroCusto'] });
    const lote = await loteDe(p.item, p.lote, 'lote');
    if (lote.validade !== p.validade)
      throw recusa('validade-diferente', `A validade do lote ${lote.numero} é ${lote.validade}.`, {
        campos: ['validade'],
      });
    const saldo = await tx.uma<Linha>(
      'SELECT quantidade FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [p.local, lote.id, est],
    );
    const responsavel = (await loginDe(usuario)) ?? '';
    recusar(
      conferirPerdaControlado({
        responsavel,
        testemunha: p.testemunha,
        motivo: p.motivo,
        quantidade: p.quantidade,
        saldoLote: n(saldo?.['quantidade']),
        reautenticadoEm,
        agora: Date.now(),
      }),
    );
    const numeroDoc = await tx.proximoNumero('documento_estoque');
    const documento = await tx.incluir('documento_estoque', {
      estabelecimento_id: est,
      numero: numeroDoc.valor,
      tipo: 'baixa',
      tipo_movimento_estoque_id: await tipoMovimento('perda', 'saida'),
      origem_local_estoque_id: p.local,
      centro_custo_id: p.centroCusto,
      movimentado_em: agora,
      concluido_em: agora,
      concluido_usuario_id: usuario,
      consolidado: true,
      situacao: 'concluido',
      observacao: `Perda de controlado. Motivo: ${p.motivo}. Testemunha: ${p.testemunha}.`.slice(0, 2000),
    });
    const q = q4(p.quantidade);
    const mov = await movimentar({
      local: p.local,
      insumo,
      lote: lote.id,
      quantidade: q,
      sentido: 'saida',
      natureza: 'perda',
      refs: { documento_estoque_id: documento, centro_custo_id: p.centroCusto },
    });
    await linhaDocumento(documento, 1, insumo, lote, q, mov, { quantidade_perda: q });
    // A testemunha com usuário no sistema fica como a segunda conferência do documento de perda.
    const testemunha = await tx.uma<Linha>('SELECT id FROM usuario WHERE login = ?', [p.testemunha]);
    if (testemunha && n(testemunha['id']) !== usuario)
      await tx.incluir('conferencia_controlado', {
        estabelecimento_id: est,
        documento_tipo: 'perda',
        documento_estoque_id: documento,
        lote_insumo_id: lote.id,
        quantidade_documento: q,
        quantidade_contada: q,
        conferente_usuario_id: n(testemunha['id']),
        conferido_em: agora,
      });
    const { ano, mes } = await anoMes(agora);
    extras.alvo = { tabela: 'documento_estoque', id: documento };
    evento('farmacia.controlado.perda', { documento, item: p.item });
    return { id: documento, doc: numeroDoc.valor, ano, mes, itens: 1 };
  }

  const conferirControlado: GravadorSghFarmacia['conferirControlado'] = async (cc) => {
    const doc = await tx.uma<Linha>(
      `SELECT id, criado_por FROM documento_estoque
        WHERE id = ? AND tipo = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [cc.documento.id, DOCUMENTO_CONFERIDO[cc.documento.tipo], est],
    );
    if (!doc)
      throw recusa('documento-inexistente', 'O documento conferido não existe.', { campos: ['documento'] });
    const lote = cc.lote ? await loteDe(cc.item, cc.lote, 'lote') : null;
    const doItem = await tx.uma(
      `SELECT id FROM documento_estoque_item WHERE documento_estoque_id = ? AND insumo_id = ? AND excluido_em IS NULL
          ${lote ? 'AND lote_insumo_id = ?' : ''} LIMIT 1`,
      lote ? [cc.documento.id, cc.item, lote.id] : [cc.documento.id, cc.item],
    );
    if (!doItem)
      throw recusa('item-fora-do-documento', 'O item (e o lote) não está neste documento.', {
        campos: ['item'],
      });
    recusar(
      conferirDuplaConferencia({
        responsavel: (await loginDe(doc['criado_por'])) ?? '',
        conferente: cc.conferente,
        reautenticadoEm: cc.reautenticadoEm,
        agora: cc.agora,
        quantidadeDocumento: cc.quantidadeDocumento,
        quantidadeContada: cc.quantidadeContada,
        justificativa: cc.justificativa,
      }),
    );
    if (
      await tx.uma(
        `SELECT id FROM conferencia_controlado WHERE documento_estoque_id = ? AND lote_chave = ? AND excluido_em IS NULL`,
        [cc.documento.id, lote?.id ?? 0],
      )
    )
      throw recusa('ja-conferido', 'Este controlado já tem a segunda conferência registrada.', {
        campos: ['item'],
      });
    const id = await tx.incluir('conferencia_controlado', {
      estabelecimento_id: est,
      documento_tipo: cc.documento.tipo,
      documento_estoque_id: cc.documento.id,
      lote_insumo_id: lote?.id ?? null,
      quantidade_documento: cc.quantidadeDocumento,
      quantidade_contada: cc.quantidadeContada,
      justificativa: cc.justificativa.trim() ? cc.justificativa.trim().slice(0, 500) : null,
      conferente_usuario_id: usuario,
      conferido_em: new Date(cc.agora),
      reautenticado_em: cc.reautenticadoEm === null ? null : new Date(cc.reautenticadoEm),
    });
    extras.alvo = { tabela: 'conferencia_controlado', id };
    evento('farmacia.controlado.conferido', { conferencia: id, documento: cc.documento.id });
    return { id };
  };

  const fecharLivro: GravadorSghFarmacia['fecharLivro'] = async (f) => {
    const oficial = f.livro.modo === 'oficial';
    const numero = `L${f.livro.livro}-${f.livro.inicio}-${oficial ? 'O' : 'C'}`;
    const ja = await tx.uma('SELECT id FROM livro_controlado WHERE estabelecimento_id = ? AND numero = ?', [
      est,
      numero,
    ]);
    recusar(
      conferirFechamentoLivro({
        responsavelTecnico: f.responsavelTecnico,
        inicio: f.livro.inicio,
        fim: f.livro.fim,
        oficial,
        chaveOficialLigada: f.chaveOficialLigada,
        jaFechado: !!ja,
      }),
    );
    if (oficial) throw armazenamentoIndisponivel();
    const responsavel = await profissionalDe(usuario);
    if (responsavel === null)
      throw recusa(
        'sem-vinculo-profissional',
        'O usuário da sessão não tem vínculo profissional no estabelecimento: o livro leva o responsável técnico.',
      );
    const hash = createHash('sha256').update(JSON.stringify(f.livro), 'utf8').digest('hex');
    const guarda = guardaAte(f.livro.fim);
    const id = await tx.incluir('livro_controlado', {
      estabelecimento_id: est,
      numero,
      periodo_inicio: f.livro.inicio,
      periodo_fim: f.livro.fim,
      responsavel_tecnico_profissional_id: responsavel,
      situacao: 'encerrado',
      aberto_em: agora,
      encerrado_em: agora,
      modo_fechamento: 'conferencia',
      hash_conteudo: hash,
      guarda_ate: guarda,
    });
    extras.alvo = { tabela: 'livro_controlado', id };
    evento('farmacia.livro.fechado', { livro: id, modo: 'conferencia' });
    return { id, hash, guardaAte: guarda };
  };

  // ── Farmácia ambulatorial e envio nacional ──────────────────────────────────────────────────────────────────────

  const dispensarAmbulatorial: GravadorSghFarmacia['dispensarAmbulatorial'] = async (d) => {
    const insumo = await insumoDe(d.item);
    recusar(
      conferirDispensacaoAmbulatorial({
        portaria: insumo.lista,
        receitaNumero: d.receitaNumero,
        receitaData: d.receitaData,
        hoje: d.hoje,
        lote: d.lote,
        quantidade: d.quantidade,
      }),
    );
    const tipo = tipoReceita(
      insumo.lista ? (listaDoItem(insumo.lista) ?? insumo.lista) : null,
      insumo.antimicrobiano,
    );
    if (!tipo)
      throw recusa(
        'fora-da-escrituracao',
        'A dispensação ambulatorial registra controlado e antimicrobiano (com a receita retida).',
        { campos: ['item'] },
      );
    if (!(d.receitaNumero ?? '').trim() || !d.receitaData)
      throw recusa('sem-receita', 'Informe o número e a data da receita retida.', { campos: ['receita'] });
    if (!(await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [d.paciente])))
      throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['paciente'] });
    if (insumo.lista)
      recusar(
        conferirPrescritorControlado({
          lista: listaDoItem(insumo.lista),
          internado: false,
          prescritor: await prescritorControlado(d.prescritor),
          daPrescricao: false,
        }),
      );
    else if (d.prescritor === null)
      throw recusa('sem-prescritor', 'Informe o prescritor da receita.', { campos: ['prescritor'] });
    if (!(await tx.uma('SELECT id FROM profissional WHERE id = ?', [d.prescritor])))
      throw recusa('prescritor-inexistente', 'O prescritor não existe no cadastro de profissionais.', {
        campos: ['prescritor'],
      });
    const lote = await loteDe(d.item, d.lote, 'lote');
    if (lote.validade !== d.validade)
      throw recusa('validade-diferente', `A validade do lote ${lote.numero} é ${lote.validade}.`, {
        campos: ['validade'],
      });
    if (lote.situacao !== 'liberado' || lote.validade < d.hoje)
      throw recusa('lote-indisponivel', `O lote ${lote.numero} está vencido ou não liberado.`, {
        campos: ['lote'],
      });
    // A farmácia que dispensa é a que tem o lote com saldo (a central primeiro).
    const local = await tx.uma<Linha>(
      `SELECT sl.local_estoque_id FROM saldo_lote sl JOIN local_estoque le ON le.id = sl.local_estoque_id
        WHERE sl.lote_insumo_id = ? AND sl.estabelecimento_id = ? AND le.estabelecimento_id = ? AND sl.quantidade >= ?
          AND NOT sl.bloqueado AND sl.excluido_em IS NULL AND le.ativo AND le.excluido_em IS NULL
          AND le.tipo IN ('farmacia_central','farmacia_satelite')
        ORDER BY le.tipo = 'farmacia_central' DESC, le.id LIMIT 1`,
      [lote.id, est, est, d.quantidade],
    );
    if (!local)
      throw recusa(
        'saldo-insuficiente',
        `Nenhuma farmácia tem saldo do lote ${lote.numero} para a quantidade.`,
        {
          campos: ['quantidade'],
        },
      );
    const emissao = d.receitaData;
    const validade = new Date(`${emissao}T12:00:00Z`);
    validade.setUTCDate(
      validade.getUTCDate() +
        (insumo.lista ? VALIDADE_RECEITA_DIAS.controlado : VALIDADE_RECEITA_DIAS.antimicrobiano),
    );
    const receita = await tx.incluir('receita_controlada', {
      estabelecimento_id: est,
      paciente_id: d.paciente,
      prescritor_profissional_id: d.prescritor,
      tipo_receita: tipo,
      lista_controle_especial_id: insumo.listaId,
      numero_notificacao: (d.receitaNumero ?? '').trim().slice(0, 30),
      data_emissao: emissao,
      data_validade: validade.toISOString().slice(0, 10),
      retida_em: agora,
      retida_por_usuario_id: usuario,
      situacao: 'retida',
    });
    const numero = await tx.proximoNumero('dispensacao');
    const dispensacao = await tx.incluir('dispensacao', {
      estabelecimento_id: est,
      numero: numero.valor,
      tipo: 'ambulatorial',
      paciente_id: d.paciente,
      local_estoque_id: n(local['local_estoque_id']),
      solicitante_profissional_id: d.prescritor,
      dispensado_em: agora,
      dispensado_usuario_id: usuario,
      consolidada: true,
      situacao: 'dispensada',
      receita_controlada_id: receita,
    });
    await tx.alterar('receita_controlada', receita, 1, { dispensacao_id: dispensacao });
    const item = await tx.incluir('dispensacao_item', {
      dispensacao_id: dispensacao,
      sequencia: 1,
      insumo_id: insumo.id,
      unidade_medida_id: insumo.unidade,
      lote_insumo_id: lote.id,
      data_validade: lote.validade,
      quantidade: q4(d.quantidade),
      justificativa_nao_prescrito: 'Dispensação ambulatorial com a receita retida.',
      situacao: 'dispensado',
    });
    await movimentar({
      local: n(local['local_estoque_id']),
      insumo,
      lote: lote.id,
      quantidade: d.quantidade,
      sentido: 'saida',
      natureza: 'consumo_paciente',
      refs: { dispensacao_item_id: item, paciente_id: d.paciente, solicitante_profissional_id: d.prescritor },
    });
    extras.alvo = { tabela: 'dispensacao', id: dispensacao };
    evento('farmacia.ambulatorial.dispensada', { dispensacao, receita });
    return { id: dispensacao };
  };

  const escriturarSngpc: GravadorSghFarmacia['escriturarSngpc'] = async (s) => {
    const responsavel = await profissionalDe(usuario);
    if (responsavel === null)
      throw recusa(
        'sem-vinculo-profissional',
        'O usuário da sessão não tem vínculo profissional no estabelecimento: o envio leva o farmacêutico responsável.',
      );
    // As dispensações ambulatoriais do período ainda não escrituradas, com o lançamento de saída de cada uma (travadas).
    const pend = await tx.consultarParaAtualizar<Linha>(
      `SELECT d.id, d.versao, d.receita_controlada_id, di.insumo_id, di.lote_insumo_id, li.numero_lote, di.quantidade,
              m.id AS movimento
         FROM dispensacao d
         JOIN dispensacao_item di ON di.dispensacao_id = d.id AND di.sequencia = 1 AND di.excluido_em IS NULL
         JOIN lote_insumo li ON li.id = di.lote_insumo_id
         JOIN movimento_estoque m ON m.dispensacao_item_id = di.id AND m.natureza = 'saida' AND m.excluido_em IS NULL
        WHERE d.estabelecimento_id = ? AND d.tipo = 'ambulatorial' AND d.situacao <> 'cancelada' AND d.excluido_em IS NULL
          AND d.dispensado_em >= ? AND d.dispensado_em < ? + INTERVAL 1 DAY
          AND NOT EXISTS (SELECT 1 FROM envio_controlado_nacional_item ei
                            JOIN envio_controlado_nacional en ON en.id = ei.envio_controlado_nacional_id
                           WHERE ei.movimento_estoque_id = m.id AND en.situacao <> 'cancelado' AND ei.excluido_em IS NULL)
        ORDER BY d.id`,
      [est, s.inicio, s.fim],
    );
    const env = montarEnvioSngpc(
      pend.map((x) => ({
        id: n(x['id']),
        item: n(x['insumo_id']),
        lote: texto(x['numero_lote']),
        quantidade: n(x['quantidade']),
        escriturada: false,
      })),
    );
    if (env.dispensacoes.length === 0)
      throw recusa('nada-a-escriturar', 'Não há dispensação ambulatorial a escriturar no período.');
    const envio = await tx.incluir('envio_controlado_nacional', {
      estabelecimento_id: est,
      periodo_inicio: s.inicio,
      periodo_fim: s.fim,
      tipo_envio: 'movimentacao',
      responsavel_profissional_id: responsavel,
      gerado_em: agora,
      quantidade_lancamentos: pend.length,
      situacao: 'gerado',
    });
    let seq = 0;
    for (const x of pend) {
      seq += 1;
      await tx.incluir('envio_controlado_nacional_item', {
        envio_controlado_nacional_id: envio,
        sequencia: seq,
        movimento_estoque_id: n(x['movimento']),
        insumo_id: n(x['insumo_id']),
        lote_insumo_id: idOuNulo(x['lote_insumo_id']),
        tipo_lancamento: 'saida_venda',
        quantidade: n(x['quantidade']),
        situacao: 'enviado',
      });
      if (x['receita_controlada_id'] !== null) {
        const [r] = await tx.consultarParaAtualizar<Linha>(
          'SELECT id, versao, situacao FROM receita_controlada WHERE id = ?',
          [n(x['receita_controlada_id'])],
        );
        if (r && texto(r['situacao']) === 'retida')
          await tx.alterar('receita_controlada', n(r['id']), n(r['versao']), { situacao: 'escriturada' });
      }
    }
    extras.alvo = { tabela: 'envio_controlado_nacional', id: envio };
    evento('farmacia.envio_nacional.gerado', { envio, lancamentos: pend.length });
    return { lote: envio, dispensacoes: env.dispensacoes.length };
  };

  return {
    dispensarHorario,
    confirmarEntrega,
    devolverDose,
    cancelarDispensacao,
    registrarPerdaControlado,
    conferirControlado,
    fecharLivro,
    dispensarAmbulatorial,
    escriturarSngpc,
  };
}
