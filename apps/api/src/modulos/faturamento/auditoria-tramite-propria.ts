// Auditoria da conta item a item, protocolo de documentos entre setores e acompanhamento da guia do convênio, sobre o
// banco do cliente (F3.7, 06-FAT linhas 21, 22 e 24). Leituras pelo Leitor; gravações pelo Executor (trilha, autoria e
// idempotência na mesma transação). As regras são do @sgh/dominio-faturamento (conta/auditoria-tramite).
// Contrato de efeito (auditoria-tramite-propria.int.spec.ts):
// - auditoria.abrir: auditoria_conta em andamento (modalidade, auditor = usuário da sessão, empresa externa quando da
//   operadora, valor original = total da conta) e o retrato "antes" (auditoria_conta_versao com os itens).
// - auditoria.parecer: auditoria_conta_item do item (decisão, quantidades e valores original e aceito, glosa interna e
//   motivo); um novo parecer do mesmo item altera a linha (versão), nunca duplica.
// - auditoria.concluir: cada item com parecer que muda valor recebe a quantidade e o valor aceitos (aceito zero ou
//   excluído: "sem_cobranca", nunca apagado) e a memória do item (operação "alteracao", origem "auditoria"); o total da
//   conta é refeito; a auditoria fica "concluida" com resultado, valor auditado e glosa interna; o retrato "depois"
//   guarda os itens e mantém a lista de pareceres já registrada.
// - auditoria.cancelar: situação "cancelada" com data, autor e motivo na observação; nenhum item muda.
// - empresa.cadastrar: empresa_auditoria_externa ligada à pessoa_juridica do CNPJ (achada ou criada); empresa.ativo.
// - protocolo.emitir: protocolo_tramite "aberto" (número de negócio, conteúdo pelo domínio) e um protocolo_tramite_item
//   por item; protocolo.enviar: "enviado" com a data; protocolo.conferir: cada item recebido ou recusado (com motivo),
//   situação pelo domínio, recebedor e data; protocolo.cancelar: "cancelado" com motivo (só aberto).
// - guia.responder: guia_fonte_pagadora com número da operadora, senha, validade, dias e situação; guia_historico.
// - guia.pendencia.abrir: guia_pendencia "aberta" (sequência, motivo, prazo, responsável), guia "pendente" com o motivo
//   corrente e o histórico com a situação anterior; guia.pendencia.resolver: pendência "resolvida" com solução e autor;
//   sem outra aberta, a guia volta à situação de antes da primeira pendência (pelo histórico).
// - guia.responsavel: responsavel_usuario_id e histórico; guia.anexo: guia_anexo (sequência, arquivo já guardado no
//   disco da instalação, tipo) e histórico.
import {
  avaliarParecerItem,
  cnpjValido,
  concluirAuditoria,
  conferirConclusaoAuditoria,
  contaEditavel,
  conteudoDoProtocolo,
  DECISOES_ITEM_AUDITORIA,
  MODALIDADES_AUDITORIA,
  podeNoProtocolo,
  type SituacaoProtocolo,
  situacaoAoResolver,
  situacaoAposConferencia,
  TIPOS_ANEXO_GUIA,
  TIPOS_ITEM_PROTOCOLO,
  validarAberturaAuditoria,
  validarAnexoGuia,
  validarPendenciaGuia,
  validarProtocolo,
  validarRespostaGuia,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { totalDosItens } from './operacoes.js';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const json = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  try {
    return JSON.parse(txt(v) || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
};

function exigirValido(erros: Record<string, string>) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos, erros });
}
function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}
function usuarioDe(ctx: ContextoOperacao): number {
  if (!ctx.usuario) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.', { campos: [] });
  return ctx.usuario;
}

// ── Auditoria da conta ──────────────────────────────────────────────────────────────────────────────────────────

async function contaDo(l: Consulta, est: number, conta: number) {
  const c = await l.uma<Linha>(
    `SELECT id, versao, numero, situacao, valor_total FROM conta_hospitalar
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [conta, est],
  );
  if (!c)
    throw recusa('nao-encontrado', 'A conta não existe neste estabelecimento.', { campos: ['contaId'] });
  return c;
}
async function itensDaConta(l: Consulta, conta: number) {
  return l.consultar<Linha>(
    `SELECT ci.id, ci.versao, ci.sequencia, ci.quantidade, ci.valor_unitario, ci.valor_total, ci.situacao,
            ifa.codigo, ifa.descricao
       FROM conta_hospitalar_item ci JOIN item_faturavel ifa ON ifa.id = ci.item_faturavel_id
      WHERE ci.conta_hospitalar_id = ? AND ci.excluido_em IS NULL ORDER BY ci.sequencia, ci.id`,
    [conta],
    { teto: 5_000 },
  );
}
const retratoItens = (itens: Linha[]) =>
  itens.map((i) => ({
    id: n(i['id']),
    codigo: txt(i['codigo']),
    quantidade: n(i['quantidade']),
    valor: n(i['valor_total']),
    situacao: txt(i['situacao']),
  }));

/** A tela da auditoria item a item: itens com o parecer da auditoria em andamento, motivos, empresas e o histórico. */
export async function auditoriaItensPropria(l: Leitor, est: number, conta: number) {
  const c = await contaDo(l, est, conta);
  const aud = await l.consultar<Linha>(
    `SELECT a.id, a.modalidade, a.situacao, a.resultado, a.iniciada_em, a.concluida_em, a.cancelada_em,
            a.valor_original, a.valor_auditado, a.valor_glosa_interna, a.bloqueia_conta, a.observacao,
            e.nome AS empresa, u.login AS auditor
       FROM auditoria_conta a LEFT JOIN empresa_auditoria_externa e ON e.id = a.empresa_auditoria_externa_id
       LEFT JOIN usuario u ON u.id = a.auditor_usuario_id
      WHERE a.conta_hospitalar_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL ORDER BY a.id DESC`,
    [conta, est],
    { teto: 200 },
  );
  const atual = aud.find((a) => txt(a['situacao']) === 'em_andamento') ?? null;
  const pareceres = atual
    ? await l.consultar<Linha>(
        `SELECT conta_hospitalar_item_id, decisao, quantidade_aceita, valor_aceito, valor_glosa_interna,
                motivo_glosa_id, justificativa
           FROM auditoria_conta_item WHERE auditoria_conta_id = ? AND excluido_em IS NULL`,
        [n(atual['id'])],
        { teto: 5_000 },
      )
    : [];
  const porItem = new Map(pareceres.map((p) => [n(p['conta_hospitalar_item_id']), p]));
  const itens = await itensDaConta(l, conta);
  const motivos = await l.consultar<Linha>(
    `SELECT id, codigo_tuss, descricao FROM motivo_glosa
      WHERE vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
      ORDER BY codigo_tuss`,
    [],
    { teto: 2_000 },
  );
  return {
    contaId: conta,
    numero: txt(c['numero']),
    situacao: txt(c['situacao']),
    editavel: contaEditavel(txt(c['situacao'])),
    total: n(c['valor_total']),
    auditoria: atual
      ? {
          id: n(atual['id']),
          modalidade: txt(atual['modalidade']),
          empresa: atual['empresa'] === null ? null : txt(atual['empresa']),
          auditor: txt(atual['auditor']),
          iniciadaEm: iso(atual['iniciada_em']),
          valorOriginal: n(atual['valor_original']),
          bloqueiaConta: Boolean(n(atual['bloqueia_conta'])),
        }
      : null,
    itens: itens.map((i) => {
      const p = porItem.get(n(i['id']));
      return {
        id: n(i['id']),
        sequencia: n(i['sequencia']),
        codigo: txt(i['codigo']),
        descricao: txt(i['descricao']),
        quantidade: n(i['quantidade']),
        valorTotal: n(i['valor_total']),
        situacao: txt(i['situacao']),
        parecer: p
          ? {
              decisao: txt(p['decisao']),
              quantidadeAceita: n(p['quantidade_aceita']),
              valorAceito: n(p['valor_aceito']),
              valorGlosa: n(p['valor_glosa_interna']),
              motivoGlosaId: nn(p['motivo_glosa_id']),
              justificativa: p['justificativa'] === null ? null : txt(p['justificativa']),
            }
          : null,
      };
    }),
    motivosGlosa: motivos.map((m) => ({
      id: n(m['id']),
      codigo: txt(m['codigo_tuss']),
      descricao: txt(m['descricao']),
    })),
    empresas: await empresasAuditoria(l, true),
    historico: aud
      .filter((a) => a !== atual)
      .map((a) => ({
        id: n(a['id']),
        modalidade: txt(a['modalidade']),
        situacao: txt(a['situacao']),
        resultado: a['resultado'] === null ? null : txt(a['resultado']),
        empresa: a['empresa'] === null ? null : txt(a['empresa']),
        auditor: txt(a['auditor']),
        iniciadaEm: iso(a['iniciada_em']),
        encerradaEm: iso(a['concluida_em'] ?? a['cancelada_em']),
        valorOriginal: n(a['valor_original']),
        valorAuditado: nn(a['valor_auditado']),
        glosaInterna: n(a['valor_glosa_interna']),
        observacao: a['observacao'] === null ? null : txt(a['observacao']),
      })),
  };
}

export async function empresasAuditoria(l: Consulta, soAtivas = false) {
  const es = await l.consultar<Linha>(
    `SELECT e.id, e.codigo, e.nome, e.ativo, e.contato_nome, e.contato_email, e.contato_telefone, p.cnpj
       FROM empresa_auditoria_externa e JOIN pessoa_juridica p ON p.id = e.pessoa_juridica_id
      WHERE e.excluido_em IS NULL${soAtivas ? ' AND e.ativo = TRUE' : ''} ORDER BY e.nome`,
    [],
    { teto: 1_000 },
  );
  return es.map((e) => ({
    id: n(e['id']),
    codigo: e['codigo'] === null ? null : txt(e['codigo']),
    nome: txt(e['nome']),
    ativo: Boolean(n(e['ativo'])),
    cnpj: txt(e['cnpj']),
    contato: [e['contato_nome'], e['contato_email'], e['contato_telefone']]
      .filter(Boolean)
      .map(txt)
      .join(' · '),
  }));
}

const id = z.number().int().positive();
const textoOpc = (max: number) => z.string().trim().max(max).nullable().default(null);

async function auditoriaEmAndamento(tx: TxOperacao, est: number, auditoria: number) {
  const [a] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, conta_hospitalar_id, situacao, valor_original, observacao FROM auditoria_conta
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [auditoria, est],
    { teto: 1 },
  );
  if (!a) throw recusa('nao-encontrado', 'A auditoria não existe.', { campos: ['auditoriaId'] });
  if (txt(a['situacao']) !== 'em_andamento')
    throw recusa('auditoria-encerrada', 'A auditoria já foi concluída ou cancelada.', { campos: [] });
  return a;
}

export const opAbrirAuditoria = definirOperacao({
  nome: 'faturamento.abrir-auditoria-conta',
  tabelas: ['auditoria_conta', 'auditoria_conta_versao'],
  entrada: z.object({
    contaId: id,
    modalidade: z.enum(MODALIDADES_AUDITORIA).default('interna'),
    tipoAuditoriaId: id.nullable().default(null),
    empresaExternaId: id.nullable().default(null),
    auditorProfissionalId: id.nullable().default(null),
    bloqueiaConta: z.boolean().default(false),
    observacao: textoOpc(2000),
  }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const usuario = usuarioDe(ctx);
    const c = await contaDo(tx, est, e.contaId);
    await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [e.contaId]);
    const andamento = await tx.uma<Linha>(
      `SELECT id FROM auditoria_conta WHERE conta_hospitalar_id = ? AND situacao = 'em_andamento' AND excluido_em IS NULL`,
      [e.contaId],
    );
    exigirValido(
      validarAberturaAuditoria({
        modalidade: e.modalidade,
        empresaExternaId: e.empresaExternaId,
        auditorProfissionalId: e.auditorProfissionalId,
        auditoriaEmAndamento: Boolean(andamento),
      }),
    );
    if (
      e.empresaExternaId &&
      !(await tx.uma(
        'SELECT id FROM empresa_auditoria_externa WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL',
        [e.empresaExternaId],
      ))
    )
      throw recusa('nao-encontrado', 'A empresa de auditoria não existe ou está inativa.', {
        campos: ['empresaExternaId'],
      });
    const externa = e.modalidade === 'operadora' || e.modalidade === 'presencial';
    const tipo = e.tipoAuditoriaId
      ? await tx.uma<Linha>('SELECT id FROM tipo_auditoria WHERE id = ? AND ativo = TRUE', [
          e.tipoAuditoriaId,
        ])
      : await tx.uma<Linha>(
          'SELECT id FROM tipo_auditoria WHERE ativo = TRUE ORDER BY externa = ? DESC, id LIMIT 1',
          [externa],
        );
    if (!tipo)
      throw recusa(
        'tipo-auditoria-inexistente',
        'Cadastre um tipo de auditoria ativo antes de auditar a conta.',
        {
          campos: ['tipoAuditoriaId'],
        },
      );
    const agora = new Date();
    const total = n(c['valor_total']);
    const auditoria = await tx.incluir('auditoria_conta', {
      estabelecimento_id: est,
      conta_hospitalar_id: e.contaId,
      tipo_auditoria_id: n(tipo['id']),
      modalidade: e.modalidade,
      empresa_auditoria_externa_id: e.empresaExternaId,
      auditor_profissional_id: e.auditorProfissionalId,
      auditor_usuario_id: usuario,
      solicitante_usuario_id: usuario,
      solicitada_em: agora,
      iniciada_em: agora,
      bloqueia_conta: e.bloqueiaConta,
      situacao: 'em_andamento',
      valor_original: total,
      observacao: e.observacao,
    });
    await tx.incluir('auditoria_conta_versao', {
      auditoria_conta_id: auditoria,
      conta_hospitalar_id: e.contaId,
      momento: 'antes',
      valor_total_conta: total,
      operacao: 'inclusao',
      dados: JSON.stringify({ itens: retratoItens(await itensDaConta(tx, e.contaId)), total }),
      ocorrido_em: agora,
      usuario_id: usuario,
    });
    return { id: auditoria, valorOriginal: total };
  },
  alvo: (_e, r) => ({ tabela: 'auditoria_conta', id: r.id }),
});

export const opParecerItem = definirOperacao({
  nome: 'faturamento.parecer-item-auditoria',
  tabelas: ['auditoria_conta_item'],
  entrada: z.object({
    auditoriaId: id,
    itemId: id,
    decisao: z.enum(DECISOES_ITEM_AUDITORIA),
    quantidadeAceita: z.number().nullable().default(null),
    valorAceito: z.number().nullable().default(null),
    motivoGlosaId: id.nullable().default(null),
    justificativa: textoOpc(2000),
  }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const a = await auditoriaEmAndamento(tx, est, e.auditoriaId);
    const i = await tx.uma<Linha>(
      `SELECT id, quantidade, valor_total, situacao FROM conta_hospitalar_item
        WHERE id = ? AND conta_hospitalar_id = ? AND excluido_em IS NULL`,
      [e.itemId, n(a['conta_hospitalar_id'])],
    );
    if (!i) throw recusa('nao-encontrado', 'O item não é desta conta.', { campos: ['itemId'] });
    if (['estornado', 'transferido'].includes(txt(i['situacao'])))
      throw recusa('item-inativo', 'O item foi estornado ou transferido: não entra na auditoria.', {
        campos: ['itemId'],
      });
    if (e.motivoGlosaId && !(await tx.uma('SELECT id FROM motivo_glosa WHERE id = ?', [e.motivoGlosaId])))
      throw recusa('nao-encontrado', 'O motivo da glosa não existe.', { campos: ['motivoGlosaId'] });
    const r = avaliarParecerItem({
      quantidadeOriginal: n(i['quantidade']),
      valorOriginal: n(i['valor_total']),
      decisao: e.decisao,
      quantidadeAceita: e.quantidadeAceita,
      valorAceito: e.valorAceito,
      motivoGlosaId: e.motivoGlosaId,
      justificativa: e.justificativa,
    });
    if (!r.ok) exigirValido(r.erros);
    if (!r.ok) throw new Error('inalcançável');
    const linha = {
      decisao: e.decisao,
      quantidade_original: n(i['quantidade']),
      quantidade_aceita: r.quantidadeAceita,
      valor_original: n(i['valor_total']),
      valor_aceito: r.valorAceito,
      valor_glosa_interna: r.valorGlosa,
      motivo_glosa_id: e.decisao === 'glosado' ? e.motivoGlosaId : null,
      justificativa: e.justificativa,
    };
    const [atual] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao FROM auditoria_conta_item WHERE auditoria_conta_id = ? AND conta_hospitalar_item_id = ?',
      [e.auditoriaId, e.itemId],
      { teto: 1 },
    );
    if (atual) {
      await tx.alterar('auditoria_conta_item', n(atual['id']), n(atual['versao']), linha);
      return { id: n(atual['id']), ...r };
    }
    const seq = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM auditoria_conta_item WHERE auditoria_conta_id = ?',
      [e.auditoriaId],
    );
    const novo = await tx.incluir('auditoria_conta_item', {
      auditoria_conta_id: e.auditoriaId,
      sequencia: n(seq?.['s']),
      conta_hospitalar_item_id: e.itemId,
      ...linha,
    });
    return { id: novo, ...r };
  },
  alvo: (_e, r) => ({ tabela: 'auditoria_conta_item', id: r.id }),
});

export const opConcluirAuditoria = definirOperacao({
  nome: 'faturamento.concluir-auditoria-conta',
  tabelas: [
    'auditoria_conta',
    'auditoria_conta_versao',
    'conta_hospitalar',
    'conta_hospitalar_item',
    'conta_hospitalar_item_memoria',
  ],
  entrada: z.object({ auditoriaId: id, observacao: textoOpc(2000) }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const usuario = usuarioDe(ctx);
    const a = await auditoriaEmAndamento(tx, est, e.auditoriaId);
    const conta = n(a['conta_hospitalar_id']);
    const c = await contaDo(tx, est, conta);
    const pareceres = await tx.consultar<Linha>(
      `SELECT ai.conta_hospitalar_item_id AS item, ai.decisao, ai.quantidade_original, ai.quantidade_aceita,
              ai.valor_original, ai.valor_aceito, ai.valor_glosa_interna, ai.motivo_glosa_id
         FROM auditoria_conta_item ai WHERE ai.auditoria_conta_id = ? AND ai.excluido_em IS NULL ORDER BY ai.sequencia`,
      [e.auditoriaId],
      { teto: 5_000 },
    );
    // Todo item cobrado tem parecer e nenhum mudou depois dele: o item lançado depois da abertura não conta como
    // mantido sem ter sido visto, e o valor auditado sai do total real da conta.
    const ativos = await tx.consultar<Linha>(
      `SELECT id, quantidade, valor_total FROM conta_hospitalar_item
        WHERE conta_hospitalar_id = ? AND excluido_em IS NULL AND situacao NOT IN ('estornado','transferido','sem_cobranca')`,
      [conta],
      { teto: 5_000 },
    );
    const cobertura = conferirConclusaoAuditoria(
      ativos.map((i) => ({ id: n(i['id']), quantidade: n(i['quantidade']), valor: n(i['valor_total']) })),
      pareceres.map((p) => ({
        itemId: n(p['item']),
        quantidadeOriginal: n(p['quantidade_original']),
        valorOriginal: n(p['valor_original']),
      })),
    );
    if (cobertura.semParecer.length)
      throw recusa(
        'item-sem-parecer',
        `Há ${cobertura.semParecer.length} item(ns) da conta sem parecer (lançados depois da abertura ou ainda não vistos): registre o parecer de cada um antes de concluir.`,
        { campos: ['itemId'], itens: cobertura.semParecer },
      );
    if (cobertura.mudados.length)
      throw recusa(
        'item-mudou',
        'Um item auditado mudou ou saiu da conta depois do parecer: registre o parecer de novo antes de concluir.',
        { campos: ['itemId'], itens: cobertura.mudados },
      );
    const totalAntes = (await totalDosItens(tx, conta)).valor_total;
    const mudam = pareceres.filter((p) => txt(p['decisao']) !== 'mantido');
    if (mudam.length && !contaEditavel(txt(c['situacao'])))
      throw recusa(
        'conta-fechada',
        'A conta não está aberta: reabra-a para aplicar os ajustes da auditoria.',
        {
          campos: [],
        },
      );
    const agora = new Date();
    for (const p of mudam) {
      const [i] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao, quantidade, valor_total, situacao FROM conta_hospitalar_item WHERE id = ?',
        [n(p['item'])],
        { teto: 1 },
      );
      if (!i) continue;
      // O item mudou depois do parecer: o auditor confere de novo (nunca se aplica sobre valor diferente).
      if (
        n(i['valor_total']) !== n(p['valor_original']) ||
        n(i['quantidade']) !== n(p['quantidade_original'])
      )
        throw recusa(
          'item-mudou',
          'Um item auditado mudou depois do parecer: registre o parecer de novo antes de concluir.',
          { campos: ['itemId'], itemId: n(i['id']) },
        );
      const qa = n(p['quantidade_aceita']);
      const va = n(p['valor_aceito']);
      const semCobranca = txt(p['decisao']) === 'excluido' || va === 0 || qa === 0;
      // Item excluído ou glosado por inteiro: fica na conta como "sem cobrança", com a quantidade lançada (a regra do
      // banco exige quantidade positiva) e valor zero; o que o auditor aceitou fica no parecer e na memória.
      await tx.alterar(
        'conta_hospitalar_item',
        n(i['id']),
        n(i['versao']),
        semCobranca
          ? { valor_total: 0, situacao: 'sem_cobranca' }
          : { quantidade: qa, valor_unitario: Math.round((va / qa) * 10_000) / 10_000, valor_total: va },
      );
      await tx.incluir('conta_hospitalar_item_memoria', {
        conta_hospitalar_item_id: n(i['id']),
        tabela_preco_id: null,
        valor_unitario_calculado: qa > 0 ? Math.round((va / qa) * 10_000) / 10_000 : 0,
        valor_total_calculado: va,
        preco_manual: 1,
        operacao: 'alteracao',
        dados: JSON.stringify({
          origem: 'auditoria',
          auditoria: e.auditoriaId,
          decisao: txt(p['decisao']),
          quantidadeOriginal: n(p['quantidade_original']),
          valorOriginal: n(p['valor_original']),
          glosaInterna: n(p['valor_glosa_interna']),
          motivoGlosa: nn(p['motivo_glosa_id']),
        }),
        ocorrido_em: agora,
        usuario_id: usuario,
      });
    }
    if (mudam.length)
      await tx.alterar('conta_hospitalar', conta, n(c['versao']), await totalDosItens(tx, conta));
    const fim = concluirAuditoria(
      totalAntes,
      pareceres.map((p) => ({
        decisao: txt(p['decisao']) as (typeof DECISOES_ITEM_AUDITORIA)[number],
        valorOriginal: n(p['valor_original']),
        valorAceito: n(p['valor_aceito']),
        valorGlosa: n(p['valor_glosa_interna']),
      })),
    );
    const totalDepois = n(
      (await tx.uma<Linha>('SELECT valor_total FROM conta_hospitalar WHERE id = ?', [conta]))?.[
        'valor_total'
      ],
    );
    await tx.alterar('auditoria_conta', e.auditoriaId, n(a['versao']), {
      situacao: 'concluida',
      concluida_em: agora,
      resultado: fim.resultado,
      valor_auditado: fim.valorAuditado,
      valor_glosa_interna: fim.valorGlosaInterna,
      ...(e.observacao ? { observacao: e.observacao } : {}),
    });
    const retrato = { itens: retratoItens(await itensDaConta(tx, conta)), total: totalDepois };
    const [depois] = await tx.consultarParaAtualizar<Linha>(
      "SELECT id, versao, dados FROM auditoria_conta_versao WHERE auditoria_conta_id = ? AND momento = 'depois'",
      [e.auditoriaId],
      { teto: 1 },
    );
    if (depois) {
      const pareceresTexto = json(depois['dados'])['pareceres'];
      await tx.alterar('auditoria_conta_versao', n(depois['id']), n(depois['versao']), {
        valor_total_conta: totalDepois,
        operacao: 'alteracao',
        dados: JSON.stringify({ ...retrato, pareceres: Array.isArray(pareceresTexto) ? pareceresTexto : [] }),
        ocorrido_em: agora,
        usuario_id: usuario,
      });
    } else
      await tx.incluir('auditoria_conta_versao', {
        auditoria_conta_id: e.auditoriaId,
        conta_hospitalar_id: conta,
        momento: 'depois',
        valor_total_conta: totalDepois,
        operacao: 'inclusao',
        dados: JSON.stringify(retrato),
        ocorrido_em: agora,
        usuario_id: usuario,
      });
    return { id: e.auditoriaId, ...fim, totalConta: totalDepois };
  },
  alvo: (e) => ({ tabela: 'auditoria_conta', id: e.auditoriaId }),
});

export const opCancelarAuditoria = definirOperacao({
  nome: 'faturamento.cancelar-auditoria-conta',
  tabelas: ['auditoria_conta'],
  entrada: z.object({ auditoriaId: id, motivo: z.string().trim().min(3).max(500) }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const a = await auditoriaEmAndamento(tx, est, e.auditoriaId);
    const obs = [txt(a['observacao']), `Cancelada: ${e.motivo}`].filter(Boolean).join('\n');
    await tx.alterar('auditoria_conta', e.auditoriaId, n(a['versao']), {
      situacao: 'cancelada',
      cancelada_em: new Date(),
      cancelada_por_usuario_id: usuarioDe(ctx),
      observacao: obs.slice(0, 60_000),
    });
    return { id: e.auditoriaId };
  },
  alvo: (e) => ({ tabela: 'auditoria_conta', id: e.auditoriaId }),
  trilha: (e) => ({ motivo: e.motivo }),
});

export const opCadastrarEmpresa = definirOperacao({
  nome: 'faturamento.cadastrar-empresa-auditoria',
  tabelas: ['empresa_auditoria_externa', 'pessoa_juridica'],
  entrada: z.object({
    cnpj: z.string().trim().max(18),
    razaoSocial: z.string().trim().min(2).max(250),
    nome: z.string().trim().min(2).max(150),
    codigo: textoOpc(30),
    contatoNome: textoOpc(150),
    contatoEmail: z.string().trim().email().max(254).nullable().default(null),
    contatoTelefone: textoOpc(20),
  }),
  async gravar(tx, e) {
    const cnpj = e.cnpj.replace(/\D/g, '');
    if (!cnpjValido(cnpj)) exigirValido({ cnpj: 'CNPJ inválido.' });
    let pj = nn((await tx.uma<Linha>('SELECT id FROM pessoa_juridica WHERE cnpj = ?', [cnpj]))?.['id']);
    if (pj && (await tx.uma('SELECT id FROM empresa_auditoria_externa WHERE pessoa_juridica_id = ?', [pj])))
      throw recusa('duplicado', 'Esta empresa já está cadastrada.', { campos: ['cnpj'] });
    if (e.codigo && (await tx.uma('SELECT id FROM empresa_auditoria_externa WHERE codigo = ?', [e.codigo])))
      throw recusa('duplicado', 'O código já é de outra empresa.', { campos: ['codigo'] });
    pj ??= await tx.incluir('pessoa_juridica', { cnpj, razao_social: e.razaoSocial, nome_fantasia: e.nome });
    const novo = await tx.incluir('empresa_auditoria_externa', {
      pessoa_juridica_id: pj,
      codigo: e.codigo,
      nome: e.nome,
      contato_nome: e.contatoNome,
      contato_email: e.contatoEmail,
      contato_telefone: e.contatoTelefone,
    });
    return { id: novo };
  },
  alvo: (_e, r) => ({ tabela: 'empresa_auditoria_externa', id: r.id }),
});

export const opAtivarEmpresa = definirOperacao({
  nome: 'faturamento.ativar-empresa-auditoria',
  tabelas: ['empresa_auditoria_externa'],
  entrada: z.object({ empresaId: id, ativo: z.boolean() }),
  async gravar(tx, e) {
    const x = await tx.uma<Linha>(
      'SELECT id, versao FROM empresa_auditoria_externa WHERE id = ? AND excluido_em IS NULL',
      [e.empresaId],
    );
    if (!x) throw recusa('nao-encontrado', 'A empresa não existe.', { campos: ['empresaId'] });
    await tx.alterar('empresa_auditoria_externa', e.empresaId, n(x['versao']), { ativo: e.ativo });
    return { id: e.empresaId, ativo: e.ativo };
  },
  alvo: (e) => ({ tabela: 'empresa_auditoria_externa', id: e.empresaId }),
});

// ── Protocolo de documentos entre setores ─────────────────────────────────────────────────────────────────────

/** Os protocolos que saem ou chegam no setor (ou os últimos de todos), com os itens, e os setores. */
export async function protocolosPropria(l: Leitor, est: number, setor: number | null) {
  const ps = await l.consultar<Linha>(
    `SELECT p.id, p.numero, p.tipo_conteudo, p.prioridade, p.situacao, p.emitido_em, p.enviado_em, p.recebido_em,
            p.remetente_setor_tramite_id AS de, p.destinatario_setor_tramite_id AS para, p.observacao,
            p.motivo_cancelamento, ue.login AS emissor, ur.login AS recebedor
       FROM protocolo_tramite p JOIN usuario ue ON ue.id = p.emissor_usuario_id
       LEFT JOIN usuario ur ON ur.id = p.recebedor_usuario_id
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL
        ${setor ? 'AND (p.remetente_setor_tramite_id = ? OR p.destinatario_setor_tramite_id = ?)' : ''}
      ORDER BY p.id DESC LIMIT 200`,
    setor ? [est, setor, setor] : [est],
    { teto: 200 },
  );
  const ids = ps.map((p) => n(p['id']));
  const itens = ids.length
    ? await l.consultar<Linha>(
        `SELECT i.id, i.protocolo_tramite_id AS p, i.sequencia, i.tipo_item, i.descricao_documento, i.recebido,
                i.recusado, i.motivo_recusa, i.recebido_em,
                COALESCE(i.volume_prontuario_id, i.atendimento_id, i.conta_hospitalar_id, i.documento_emitido_id) AS alvo,
                c.numero AS conta, a.numero AS atendimento
           FROM protocolo_tramite_item i LEFT JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
           LEFT JOIN atendimento a ON a.id = i.atendimento_id
          WHERE i.protocolo_tramite_id IN (${ids.map(() => '?').join(', ')}) AND i.excluido_em IS NULL
          ORDER BY i.sequencia`,
        ids,
        { teto: 10_000 },
      )
    : [];
  const setores = await l.consultar<Linha>(
    'SELECT id, codigo, descricao, tipo FROM setor_tramite WHERE ativo = TRUE ORDER BY descricao',
    [],
    { teto: 500 },
  );
  return {
    setores: setores.map((s) => ({
      id: n(s['id']),
      codigo: txt(s['codigo']),
      descricao: txt(s['descricao']),
      tipo: txt(s['tipo']),
    })),
    protocolos: ps.map((p) => ({
      id: n(p['id']),
      numero: n(p['numero']),
      conteudo: txt(p['tipo_conteudo']),
      prioridade: txt(p['prioridade']),
      situacao: txt(p['situacao']),
      deSetorId: n(p['de']),
      paraSetorId: n(p['para']),
      emissor: txt(p['emissor']),
      recebedor: p['recebedor'] === null ? null : txt(p['recebedor']),
      emitidoEm: iso(p['emitido_em']),
      enviadoEm: iso(p['enviado_em']),
      recebidoEm: iso(p['recebido_em']),
      observacao: p['observacao'] === null ? null : txt(p['observacao']),
      motivoCancelamento: p['motivo_cancelamento'] === null ? null : txt(p['motivo_cancelamento']),
      itens: itens
        .filter((i) => n(i['p']) === n(p['id']))
        .map((i) => ({
          id: n(i['id']),
          sequencia: n(i['sequencia']),
          tipo: txt(i['tipo_item']),
          alvoId: nn(i['alvo']),
          rotulo:
            txt(i['tipo_item']) === 'conta'
              ? `Conta ${txt(i['conta'])}`
              : txt(i['tipo_item']) === 'atendimento'
                ? `Atendimento ${txt(i['atendimento'])}`
                : txt(i['descricao_documento']) || `${txt(i['tipo_item'])} ${txt(i['alvo'])}`,
          recebido: Boolean(n(i['recebido'])),
          recusado: Boolean(n(i['recusado'])),
          motivoRecusa: i['motivo_recusa'] === null ? null : txt(i['motivo_recusa']),
        })),
    })),
  };
}

const itemProtocolo = z.object({
  tipo: z.enum(TIPOS_ITEM_PROTOCOLO),
  alvoId: id.nullable().default(null),
  descricao: textoOpc(200),
});
const COLUNA_ALVO = {
  volume_prontuario: ['volume_prontuario_id', 'volume_prontuario'],
  atendimento: ['atendimento_id', 'atendimento'],
  conta: ['conta_hospitalar_id', 'conta_hospitalar'],
  documento: ['documento_emitido_id', 'documento_emitido'],
} as const;

async function setorAtivo(tx: TxOperacao, setor: number, campo: string) {
  if (!(await tx.uma('SELECT id FROM setor_tramite WHERE id = ? AND ativo = TRUE', [setor])))
    throw recusa('nao-encontrado', 'O setor não existe ou está inativo.', { campos: [campo] });
}

export const opEmitirProtocolo = definirOperacao({
  nome: 'faturamento.emitir-protocolo-tramite',
  tabelas: ['protocolo_tramite', 'protocolo_tramite_item'],
  entrada: z.object({
    remetenteId: id,
    destinatarioId: id,
    prioridade: z.enum(['normal', 'urgente']).default('normal'),
    motivoId: id.nullable().default(null),
    observacao: textoOpc(2000),
    enviarJa: z.boolean().default(true),
    itens: z.array(itemProtocolo).max(500),
  }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const usuario = usuarioDe(ctx);
    exigirValido(
      validarProtocolo({ remetente: e.remetenteId, destinatario: e.destinatarioId, itens: e.itens }),
    );
    await setorAtivo(tx, e.remetenteId, 'remetenteId');
    await setorAtivo(tx, e.destinatarioId, 'destinatarioId');
    for (const [k, i] of e.itens.entries()) {
      if (!i.alvoId) continue;
      const [, tabela] = COLUNA_ALVO[i.tipo];
      // As quatro tabelas têm o estabelecimento: item de outro estabelecimento não entra no protocolo.
      if (
        !(await tx.uma(`SELECT id FROM ${tabela} WHERE id = ? AND estabelecimento_id = ?`, [i.alvoId, est]))
      )
        throw recusa('nao-encontrado', 'Um item do protocolo não existe neste estabelecimento.', {
          campos: [`itens.${k}`],
        });
    }
    const agora = new Date();
    const numero = await tx.proximoNumero('protocolo_tramite');
    const protocolo = await tx.incluir('protocolo_tramite', {
      estabelecimento_id: est,
      numero: numero.valor,
      tipo_conteudo: conteudoDoProtocolo(e.itens),
      remetente_setor_tramite_id: e.remetenteId,
      destinatario_setor_tramite_id: e.destinatarioId,
      motivo_tramite_documento_id: e.motivoId,
      prioridade: e.prioridade,
      emissor_usuario_id: usuario,
      emitido_em: agora,
      enviado_em: e.enviarJa ? agora : null,
      situacao: e.enviarJa ? 'enviado' : 'aberto',
      observacao: e.observacao,
    });
    let s = 0;
    for (const i of e.itens) {
      const [coluna] = COLUNA_ALVO[i.tipo];
      await tx.incluir('protocolo_tramite_item', {
        protocolo_tramite_id: protocolo,
        sequencia: ++s,
        tipo_item: i.tipo,
        [coluna]: i.alvoId,
        descricao_documento: i.descricao,
      });
    }
    return { id: protocolo, numero: numero.valor, itens: s };
  },
  alvo: (_e, r) => ({ tabela: 'protocolo_tramite', id: r.id }),
});

async function protocoloDo(tx: TxOperacao, est: number, protocolo: number) {
  const [p] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, situacao, enviado_em, destinatario_setor_tramite_id FROM protocolo_tramite
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [protocolo, est],
    { teto: 1 },
  );
  if (!p) throw recusa('nao-encontrado', 'O protocolo não existe.', { campos: ['protocoloId'] });
  return p;
}
function exigirTransicao(p: Linha, acao: 'enviar' | 'conferir' | 'cancelar') {
  const msg = podeNoProtocolo(txt(p['situacao']) as SituacaoProtocolo, acao);
  if (msg) throw recusa('situacao-invalida', msg, { campos: [] });
}

export const opEnviarProtocolo = definirOperacao({
  nome: 'faturamento.enviar-protocolo-tramite',
  tabelas: ['protocolo_tramite'],
  entrada: z.object({ protocoloId: id }),
  async gravar(tx, e, ctx) {
    const p = await protocoloDo(tx, estDe(ctx), e.protocoloId);
    exigirTransicao(p, 'enviar');
    await tx.alterar('protocolo_tramite', e.protocoloId, n(p['versao']), {
      situacao: 'enviado',
      enviado_em: new Date(),
    });
    return { id: e.protocoloId, situacao: 'enviado' };
  },
  alvo: (e) => ({ tabela: 'protocolo_tramite', id: e.protocoloId }),
});

export const opConferirProtocolo = definirOperacao({
  nome: 'faturamento.conferir-protocolo-tramite',
  tabelas: ['protocolo_tramite', 'protocolo_tramite_item'],
  entrada: z.object({
    protocoloId: id,
    itens: z
      .array(
        z.object({
          itemId: id,
          recebido: z.boolean(),
          motivoRecusa: textoOpc(500),
        }),
      )
      .min(1)
      .max(500),
  }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const usuario = usuarioDe(ctx);
    const p = await protocoloDo(tx, est, e.protocoloId);
    exigirTransicao(p, 'conferir');
    const atuais = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, recebido, recusado FROM protocolo_tramite_item WHERE protocolo_tramite_id = ? AND excluido_em IS NULL',
      [e.protocoloId],
      { teto: 1_000 },
    );
    const porId = new Map(atuais.map((a) => [n(a['id']), a]));
    const agora = new Date();
    const estado = new Map(
      atuais.map((a) => [
        n(a['id']),
        { recebido: Boolean(n(a['recebido'])), recusado: Boolean(n(a['recusado'])) },
      ]),
    );
    for (const [k, c] of e.itens.entries()) {
      const a = porId.get(c.itemId);
      if (!a) throw recusa('nao-encontrado', 'O item não é deste protocolo.', { campos: [`itens.${k}`] });
      const ja = estado.get(c.itemId)!;
      if (ja.recebido || ja.recusado)
        throw recusa('item-conferido', 'O item já foi conferido neste protocolo.', {
          campos: [`itens.${k}`],
        });
      if (!c.recebido && !c.motivoRecusa)
        exigirValido({ [`itens.${k}`]: 'Diga o motivo da recusa do item.' });
      await tx.alterar(
        'protocolo_tramite_item',
        c.itemId,
        n(a['versao']),
        c.recebido
          ? { recebido: true, recebido_em: agora, recebedor_usuario_id: usuario }
          : { recusado: true, motivo_recusa: c.motivoRecusa, recebedor_usuario_id: usuario },
      );
      estado.set(c.itemId, { recebido: c.recebido, recusado: !c.recebido });
    }
    const situacao = situacaoAposConferencia([...estado.values()]);
    const enviado = p['enviado_em'] instanceof Date ? p['enviado_em'] : new Date(txt(p['enviado_em']));
    await tx.alterar('protocolo_tramite', e.protocoloId, n(p['versao']), {
      situacao,
      recebedor_usuario_id: usuario,
      recebido_em: situacao === 'recebido_parcial' ? null : agora < enviado ? enviado : agora,
    });
    return { id: e.protocoloId, situacao };
  },
  alvo: (e) => ({ tabela: 'protocolo_tramite', id: e.protocoloId }),
});

export const opCancelarProtocolo = definirOperacao({
  nome: 'faturamento.cancelar-protocolo-tramite',
  tabelas: ['protocolo_tramite'],
  entrada: z.object({ protocoloId: id, motivo: z.string().trim().min(3).max(500) }),
  async gravar(tx, e, ctx) {
    const p = await protocoloDo(tx, estDe(ctx), e.protocoloId);
    exigirTransicao(p, 'cancelar');
    await tx.alterar('protocolo_tramite', e.protocoloId, n(p['versao']), {
      situacao: 'cancelado',
      cancelado_em: new Date(),
      motivo_cancelamento: e.motivo,
    });
    return { id: e.protocoloId, situacao: 'cancelado' };
  },
  alvo: (e) => ({ tabela: 'protocolo_tramite', id: e.protocoloId }),
  trilha: (e) => ({ motivo: e.motivo }),
});

// ── Guia do convênio no hospital ──────────────────────────────────────────────────────────────────────────────

/** A guia com pendências, anexos, histórico e responsável, numa leitura só. */
export async function guiaAcompanhamentoPropria(l: Leitor, est: number, guia: number) {
  const g = await l.uma<Linha>(
    `SELECT g.id, g.numero, g.numero_guia_operadora, g.tipo_guia, g.situacao, g.senha, g.data_validade_senha,
            g.data_validade, g.data_solicitacao, g.data_autorizacao, g.dias_solicitados, g.dias_autorizados,
            g.motivo_negacao, g.nome_autorizador, g.responsavel_usuario_id, u.login AS responsavel,
            f.nome AS fonte, g.conta_hospitalar_id, g.atendimento_id, g.agendamento_cirurgico_id
       FROM guia_fonte_pagadora g JOIN fonte_pagadora f ON f.id = g.fonte_pagadora_id
       LEFT JOIN usuario u ON u.id = g.responsavel_usuario_id
      WHERE g.id = ? AND g.estabelecimento_id = ? AND g.excluido_em IS NULL`,
    [guia, est],
  );
  if (!g) throw recusa('nao-encontrado', 'A guia não existe neste estabelecimento.', { campos: ['guiaId'] });
  const pend = await l.consultar<Linha>(
    `SELECT p.id, p.sequencia, p.situacao, p.descricao, p.aberta_em, p.prazo_em, p.resolvida_em, p.solucao,
            m.descricao AS motivo, ur.login AS responsavel, ux.login AS resolvido_por
       FROM guia_pendencia p JOIN motivo_pendencia_guia m ON m.id = p.motivo_pendencia_guia_id
       LEFT JOIN usuario ur ON ur.id = p.responsavel_usuario_id
       LEFT JOIN usuario ux ON ux.id = p.resolvido_por_usuario_id
      WHERE p.guia_fonte_pagadora_id = ? AND p.excluido_em IS NULL ORDER BY p.sequencia DESC`,
    [guia],
    { teto: 500 },
  );
  const anexos = await l.consultar<Linha>(
    `SELECT a.id, a.sequencia, a.tipo_documento, a.descricao, a.arquivo_id, a.criado_em, ar.nome_original,
            ar.tamanho_bytes, a.enviado_fonte_pagadora
       FROM guia_anexo a JOIN arquivo ar ON ar.id = a.arquivo_id
      WHERE a.guia_fonte_pagadora_id = ? AND a.excluido_em IS NULL ORDER BY a.sequencia`,
    [guia],
    { teto: 500 },
  );
  const hist = await l.consultar<Linha>(
    `SELECT h.id, h.operacao, h.situacao_anterior, h.situacao_nova, h.observacao, h.dados, h.ocorrido_em, u.login
       FROM guia_historico h LEFT JOIN usuario u ON u.id = h.usuario_id
      WHERE h.guia_fonte_pagadora_id = ? ORDER BY h.ocorrido_em DESC, h.id DESC`,
    [guia],
    { teto: 1_000 },
  );
  const motivos = await l.consultar<Linha>(
    'SELECT id, codigo, descricao, bloqueia_faturamento FROM motivo_pendencia_guia WHERE ativo = TRUE ORDER BY descricao',
    [],
    { teto: 500 },
  );
  return {
    id: n(g['id']),
    numero: txt(g['numero']),
    numeroOperadora: g['numero_guia_operadora'] === null ? null : txt(g['numero_guia_operadora']),
    tipo: txt(g['tipo_guia']),
    situacao: txt(g['situacao']),
    fonte: txt(g['fonte']),
    senha: g['senha'] === null ? null : txt(g['senha']),
    validadeSenha: iso(g['data_validade_senha'])?.slice(0, 10) ?? null,
    solicitadaEm: iso(g['data_solicitacao']),
    autorizadaEm: iso(g['data_autorizacao']),
    diasSolicitados: nn(g['dias_solicitados']),
    diasAutorizados: nn(g['dias_autorizados']),
    motivoNegacao: g['motivo_negacao'] === null ? null : txt(g['motivo_negacao']),
    responsavelId: nn(g['responsavel_usuario_id']),
    responsavel: g['responsavel'] === null ? null : txt(g['responsavel']),
    contaId: nn(g['conta_hospitalar_id']),
    atendimentoId: nn(g['atendimento_id']),
    cirurgiaId: nn(g['agendamento_cirurgico_id']),
    pendencias: pend.map((p) => ({
      id: n(p['id']),
      sequencia: n(p['sequencia']),
      situacao: txt(p['situacao']),
      motivo: txt(p['motivo']),
      descricao: p['descricao'] === null ? null : txt(p['descricao']),
      abertaEm: iso(p['aberta_em']),
      prazoEm: iso(p['prazo_em']),
      responsavel: p['responsavel'] === null ? null : txt(p['responsavel']),
      resolvidaEm: iso(p['resolvida_em']),
      resolvidoPor: p['resolvido_por'] === null ? null : txt(p['resolvido_por']),
      solucao: p['solucao'] === null ? null : txt(p['solucao']),
    })),
    anexos: anexos.map((a) => ({
      id: n(a['id']),
      sequencia: n(a['sequencia']),
      tipo: txt(a['tipo_documento']),
      descricao: a['descricao'] === null ? null : txt(a['descricao']),
      arquivoId: n(a['arquivo_id']),
      nome: txt(a['nome_original']),
      tamanho: n(a['tamanho_bytes']),
      enviado: Boolean(n(a['enviado_fonte_pagadora'])),
      em: iso(a['criado_em']),
    })),
    historico: hist.map((h) => ({
      id: n(h['id']),
      evento: txt(json(h['dados'])['evento']) || txt(h['operacao']),
      de: h['situacao_anterior'] === null ? null : txt(h['situacao_anterior']),
      para: h['situacao_nova'] === null ? null : txt(h['situacao_nova']),
      observacao: h['observacao'] === null ? null : txt(h['observacao']),
      usuario: h['login'] === null ? null : txt(h['login']),
      em: iso(h['ocorrido_em']),
    })),
    motivosPendencia: motivos.map((m) => ({
      id: n(m['id']),
      codigo: txt(m['codigo']),
      descricao: txt(m['descricao']),
      bloqueiaFaturamento: Boolean(n(m['bloqueia_faturamento'])),
    })),
  };
}

/**
 * A fila das guias do convênio no hospital, por paciente: abertas (pendente, em análise, solicitada), com o paciente
 * (nome e prontuário), o atendimento e a conta para abrir num clique, o prazo da pendência aberta mais próxima e a
 * validade da senha; o que vence primeiro vem antes. A fila do centro cirúrgico (`cirurgia`) traz só as guias de
 * cirurgia agendada, na ordem da data prevista da cirurgia.
 */
export async function guiasConvenioPropria(
  l: Leitor,
  est: number,
  f: { situacao: string | null; minhas: boolean; usuario: number | null; cirurgia?: boolean },
) {
  const filtros: string[] = ['g.estabelecimento_id = ?', 'g.excluido_em IS NULL'];
  const p: unknown[] = [est];
  if (f.situacao) {
    filtros.push('g.situacao = ?');
    p.push(f.situacao);
  } else filtros.push("g.situacao IN ('rascunho','solicitada','em_analise','pendente')");
  if (f.minhas && f.usuario) {
    filtros.push('g.responsavel_usuario_id = ?');
    p.push(f.usuario);
  }
  if (f.cirurgia) filtros.push('g.agendamento_cirurgico_id IS NOT NULL');
  const ordem = f.cirurgia
    ? 'ac.inicio_previsto_em IS NULL, ac.inicio_previsto_em, g.data_solicitacao'
    : "prazo IS NULL, prazo, g.data_validade_senha IS NULL, g.data_validade_senha, FIELD(g.situacao, 'pendente', 'em_analise', 'solicitada', 'rascunho'), g.data_solicitacao";
  const gs = await l.consultar<Linha>(
    `SELECT g.id, g.numero, g.numero_guia_operadora, g.tipo_guia, g.situacao, g.data_solicitacao, g.senha,
            g.data_validade_senha, g.agendamento_cirurgico_id, g.atendimento_id, g.conta_hospitalar_id,
            ac.inicio_previsto_em, f.nome AS fonte, u.login AS responsavel, pa.numero_prontuario,
            CASE WHEN pf.usa_nome_social AND pf.nome_social IS NOT NULL THEN pf.nome_social ELSE pf.nome END AS paciente,
            (SELECT COUNT(*) FROM guia_pendencia gp WHERE gp.guia_fonte_pagadora_id = g.id
                AND gp.situacao IN ('aberta','em_tratamento') AND gp.excluido_em IS NULL) AS pendencias,
            (SELECT MIN(gp.prazo_em) FROM guia_pendencia gp WHERE gp.guia_fonte_pagadora_id = g.id
                AND gp.situacao IN ('aberta','em_tratamento') AND gp.excluido_em IS NULL) AS prazo
       FROM guia_fonte_pagadora g JOIN fonte_pagadora f ON f.id = g.fonte_pagadora_id
       JOIN paciente pa ON pa.id = g.paciente_id JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
       LEFT JOIN agendamento_cirurgico ac ON ac.id = g.agendamento_cirurgico_id
       LEFT JOIN usuario u ON u.id = g.responsavel_usuario_id
      WHERE ${filtros.join(' AND ')}
      ORDER BY ${ordem}
      LIMIT 300`,
    p,
    { teto: 300 },
  );
  const dia = (v: unknown) => (v === null || v === undefined ? null : (iso(v)?.slice(0, 10) ?? null));
  return gs.map((g) => ({
    id: n(g['id']),
    numero: txt(g['numero']),
    numeroOperadora: g['numero_guia_operadora'] === null ? null : txt(g['numero_guia_operadora']),
    tipo: txt(g['tipo_guia']),
    situacao: txt(g['situacao']),
    fonte: txt(g['fonte']),
    paciente: txt(g['paciente']),
    prontuario: n(g['numero_prontuario']),
    atendimentoId: nn(g['atendimento_id']),
    contaId: nn(g['conta_hospitalar_id']),
    solicitadaEm: iso(g['data_solicitacao']),
    temSenha: g['senha'] !== null,
    validadeSenha: dia(g['data_validade_senha']),
    cirurgia: g['agendamento_cirurgico_id'] !== null,
    cirurgiaPrevista: g['inicio_previsto_em'] === null ? null : iso(g['inicio_previsto_em']),
    prazoPendencia: g['prazo'] === null ? null : iso(g['prazo']),
    responsavel: g['responsavel'] === null ? null : txt(g['responsavel']),
    pendencias: n(g['pendencias']),
  }));
}

async function guiaDo(tx: TxOperacao, est: number, guia: number) {
  const [g] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, situacao, data_solicitacao, dias_solicitados, motivo_pendencia_guia_id, responsavel_usuario_id
       FROM guia_fonte_pagadora WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [guia, est],
    { teto: 1 },
  );
  if (!g) throw recusa('nao-encontrado', 'A guia não existe neste estabelecimento.', { campos: ['guiaId'] });
  return g;
}
async function historico(
  tx: TxOperacao,
  guia: number,
  usuario: number,
  e: { evento: string; de?: string | null; para?: string | null; observacao?: string | null; dados?: object },
) {
  await tx.incluir('guia_historico', {
    guia_fonte_pagadora_id: guia,
    operacao: e.evento === 'anexo' ? 'inclusao' : 'alteracao',
    situacao_anterior: e.de ?? null,
    situacao_nova: e.para ?? null,
    observacao: e.observacao ?? null,
    dados: JSON.stringify({ evento: e.evento, ...(e.dados ?? {}) }),
    ocorrido_em: new Date(),
    usuario_id: usuario,
  });
}
const pendenciasAbertas = async (tx: TxOperacao, guia: number, fora = 0) =>
  n(
    (
      await tx.uma<Linha>(
        `SELECT COUNT(*) AS n FROM guia_pendencia WHERE guia_fonte_pagadora_id = ? AND id <> ?
            AND situacao IN ('aberta','em_tratamento') AND excluido_em IS NULL`,
        [guia, fora],
      )
    )?.['n'],
  );

export const opResponderGuia = definirOperacao({
  nome: 'faturamento.responder-guia',
  tabelas: ['guia_fonte_pagadora', 'guia_historico'],
  entrada: z.object({
    guiaId: id,
    resposta: z.enum(['em_analise', 'autorizada', 'autorizada_parcial', 'negada']),
    numeroOperadora: textoOpc(20),
    senha: textoOpc(20),
    validadeSenha: z.string().date().nullable().default(null),
    validade: z.string().date().nullable().default(null),
    diasAutorizados: z.number().int().min(0).max(999).nullable().default(null),
    nomeAutorizador: textoOpc(70),
    motivoNegacao: textoOpc(500),
    observacao: textoOpc(2000),
  }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const usuario = usuarioDe(ctx);
    const g = await guiaDo(tx, est, e.guiaId);
    const agora = new Date();
    exigirValido(
      validarRespostaGuia({
        situacaoAtual: txt(g['situacao']),
        resposta: e.resposta,
        senha: e.senha,
        validadeSenha: e.validadeSenha,
        diasSolicitados: nn(g['dias_solicitados']),
        diasAutorizados: e.diasAutorizados,
        motivoNegacao: e.motivoNegacao,
        pendenciasAbertas: await pendenciasAbertas(tx, e.guiaId),
        hoje: agora.toISOString().slice(0, 10),
      }),
    );
    const autoriza = e.resposta === 'autorizada' || e.resposta === 'autorizada_parcial';
    const solicitada = g['data_solicitacao'] instanceof Date ? g['data_solicitacao'] : agora;
    await tx.alterar('guia_fonte_pagadora', e.guiaId, n(g['versao']), {
      situacao: e.resposta,
      ...(e.numeroOperadora ? { numero_guia_operadora: e.numeroOperadora } : {}),
      ...(autoriza
        ? {
            senha: e.senha,
            data_validade_senha: e.validadeSenha,
            data_validade: e.validade,
            data_autorizacao: agora < solicitada ? solicitada : agora,
            dias_autorizados: e.diasAutorizados,
            nome_autorizador: e.nomeAutorizador,
          }
        : {}),
      ...(e.resposta === 'negada' ? { data_negacao: agora, motivo_negacao: e.motivoNegacao } : {}),
      ...(txt(g['situacao']) === 'pendente' ? { motivo_pendencia_guia_id: null } : {}),
    });
    await historico(tx, e.guiaId, usuario, {
      evento: 'resposta',
      de: txt(g['situacao']),
      para: e.resposta,
      observacao: e.observacao,
      dados: { numeroOperadora: e.numeroOperadora, diasAutorizados: e.diasAutorizados },
    });
    return { id: e.guiaId, situacao: e.resposta };
  },
  alvo: (e) => ({ tabela: 'guia_fonte_pagadora', id: e.guiaId }),
});

export const opAbrirPendenciaGuia = definirOperacao({
  nome: 'faturamento.abrir-pendencia-guia',
  tabelas: ['guia_pendencia', 'guia_fonte_pagadora', 'guia_historico'],
  entrada: z.object({
    guiaId: id,
    motivoId: id,
    descricao: textoOpc(500),
    prazo: z.string().datetime({ offset: true }).nullable().default(null),
    responsavelId: id.nullable().default(null),
  }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const usuario = usuarioDe(ctx);
    const g = await guiaDo(tx, est, e.guiaId);
    const agora = new Date();
    exigirValido(
      validarPendenciaGuia({
        situacaoAtual: txt(g['situacao']),
        motivoId: e.motivoId,
        prazo: e.prazo ? new Date(e.prazo).toISOString() : null,
        agora: agora.toISOString(),
      }),
    );
    if (!(await tx.uma('SELECT id FROM motivo_pendencia_guia WHERE id = ? AND ativo = TRUE', [e.motivoId])))
      throw recusa('nao-encontrado', 'O motivo da pendência não existe.', { campos: ['motivoId'] });
    const seq = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM guia_pendencia WHERE guia_fonte_pagadora_id = ?',
      [e.guiaId],
    );
    const pend = await tx.incluir('guia_pendencia', {
      guia_fonte_pagadora_id: e.guiaId,
      sequencia: n(seq?.['s']),
      motivo_pendencia_guia_id: e.motivoId,
      descricao: e.descricao,
      aberta_em: agora,
      prazo_em: e.prazo ? new Date(e.prazo) : null,
      responsavel_usuario_id: e.responsavelId ?? nn(g['responsavel_usuario_id']),
      situacao: 'aberta',
    });
    const antes = txt(g['situacao']);
    await tx.alterar('guia_fonte_pagadora', e.guiaId, n(g['versao']), {
      situacao: 'pendente',
      motivo_pendencia_guia_id: e.motivoId,
    });
    await historico(tx, e.guiaId, usuario, {
      evento: 'pendencia_aberta',
      de: antes,
      para: 'pendente',
      observacao: e.descricao,
      dados: { pendencia: pend, motivo: e.motivoId },
    });
    return { id: pend, guiaId: e.guiaId };
  },
  alvo: (_e, r) => ({ tabela: 'guia_pendencia', id: r.id }),
});

export const opResolverPendenciaGuia = definirOperacao({
  nome: 'faturamento.resolver-pendencia-guia',
  tabelas: ['guia_pendencia', 'guia_fonte_pagadora', 'guia_historico'],
  entrada: z.object({ pendenciaId: id, solucao: z.string().trim().min(3).max(500) }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const usuario = usuarioDe(ctx);
    const [p] = await tx.consultarParaAtualizar<Linha>(
      `SELECT p.id, p.versao, p.situacao, p.guia_fonte_pagadora_id AS guia, p.aberta_em FROM guia_pendencia p
         JOIN guia_fonte_pagadora g ON g.id = p.guia_fonte_pagadora_id
        WHERE p.id = ? AND g.estabelecimento_id = ? AND p.excluido_em IS NULL`,
      [e.pendenciaId, est],
      { teto: 1 },
    );
    if (!p) throw recusa('nao-encontrado', 'A pendência não existe.', { campos: ['pendenciaId'] });
    if (!['aberta', 'em_tratamento'].includes(txt(p['situacao'])))
      throw recusa('pendencia-encerrada', 'A pendência já foi resolvida ou cancelada.', { campos: [] });
    const guia = n(p['guia']);
    const g = await guiaDo(tx, est, guia);
    const agora = new Date();
    const aberta = p['aberta_em'] instanceof Date ? p['aberta_em'] : agora;
    await tx.alterar('guia_pendencia', e.pendenciaId, n(p['versao']), {
      situacao: 'resolvida',
      resolvida_em: agora < aberta ? aberta : agora,
      resolvido_por_usuario_id: usuario,
      solucao: e.solucao,
    });
    const outras = await tx.consultar<Linha>(
      `SELECT motivo_pendencia_guia_id AS m FROM guia_pendencia WHERE guia_fonte_pagadora_id = ? AND id <> ?
          AND situacao IN ('aberta','em_tratamento') AND excluido_em IS NULL ORDER BY sequencia DESC`,
      [guia, e.pendenciaId],
      { teto: 500 },
    );
    // A situação de antes da primeira pendência do ciclo: a última entrada no "pendente" vinda de outra situação.
    const entrada = await tx.uma<Linha>(
      `SELECT situacao_anterior FROM guia_historico WHERE guia_fonte_pagadora_id = ? AND situacao_nova = 'pendente'
          AND situacao_anterior <> 'pendente' ORDER BY ocorrido_em DESC, id DESC LIMIT 1`,
      [guia],
    );
    const volta = situacaoAoResolver({
      situacaoAntesDaPendencia: entrada ? txt(entrada['situacao_anterior']) : null,
      outrasAbertas: outras.length,
    });
    const atual = txt(g['situacao']);
    if (volta.situacao && atual === 'pendente')
      await tx.alterar('guia_fonte_pagadora', guia, n(g['versao']), {
        situacao: volta.situacao,
        motivo_pendencia_guia_id: null,
      });
    else if (outras.length && atual === 'pendente')
      await tx.alterar('guia_fonte_pagadora', guia, n(g['versao']), {
        motivo_pendencia_guia_id: n(outras[0]!['m']),
      });
    await historico(tx, guia, usuario, {
      evento: 'pendencia_resolvida',
      de: atual,
      para: volta.situacao && atual === 'pendente' ? volta.situacao : atual,
      observacao: e.solucao,
      dados: { pendencia: e.pendenciaId },
    });
    return { id: e.pendenciaId, guiaId: guia, situacaoGuia: volta.situacao ?? atual };
  },
  alvo: (e) => ({ tabela: 'guia_pendencia', id: e.pendenciaId }),
});

export const opResponsavelGuia = definirOperacao({
  nome: 'faturamento.responsavel-guia',
  tabelas: ['guia_fonte_pagadora', 'guia_historico'],
  entrada: z.object({ guiaId: id, responsavelId: id.nullable(), observacao: textoOpc(2000) }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const usuario = usuarioDe(ctx);
    const g = await guiaDo(tx, est, e.guiaId);
    const novo = e.responsavelId ?? usuario;
    if (!(await tx.uma('SELECT id FROM usuario WHERE id = ? AND excluido_em IS NULL', [novo])))
      throw recusa('nao-encontrado', 'O usuário não existe.', { campos: ['responsavelId'] });
    await tx.alterar('guia_fonte_pagadora', e.guiaId, n(g['versao']), { responsavel_usuario_id: novo });
    await historico(tx, e.guiaId, usuario, {
      evento: 'responsavel',
      de: txt(g['situacao']),
      para: txt(g['situacao']),
      observacao: e.observacao,
      dados: { de: nn(g['responsavel_usuario_id']), para: novo },
    });
    return { id: e.guiaId, responsavelId: novo };
  },
  alvo: (e) => ({ tabela: 'guia_fonte_pagadora', id: e.guiaId }),
});

export const opAnexarGuia = definirOperacao({
  nome: 'faturamento.anexar-guia',
  tabelas: ['guia_anexo', 'guia_historico'],
  entrada: z.object({
    guiaId: id,
    arquivoId: id,
    tipoDocumento: z.enum(TIPOS_ANEXO_GUIA),
    descricao: textoOpc(300),
  }),
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const usuario = usuarioDe(ctx);
    const g = await guiaDo(tx, est, e.guiaId);
    const a = await tx.uma<Linha>(
      'SELECT id, tipo_mime, tamanho_bytes FROM arquivo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.arquivoId, est],
    );
    if (!a) throw recusa('nao-encontrado', 'O arquivo não existe.', { campos: ['arquivo'] });
    exigirValido(
      validarAnexoGuia({
        situacaoGuia: txt(g['situacao']),
        tipoDocumento: e.tipoDocumento,
        tipoMime: txt(a['tipo_mime']),
        tamanhoBytes: n(a['tamanho_bytes']),
      }),
    );
    const seq = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM guia_anexo WHERE guia_fonte_pagadora_id = ?',
      [e.guiaId],
    );
    const anexo = await tx.incluir('guia_anexo', {
      guia_fonte_pagadora_id: e.guiaId,
      sequencia: n(seq?.['s']),
      arquivo_id: e.arquivoId,
      tipo_documento: e.tipoDocumento,
      descricao: e.descricao,
    });
    await historico(tx, e.guiaId, usuario, {
      evento: 'anexo',
      observacao: e.descricao,
      dados: { anexo, tipo: e.tipoDocumento },
    });
    return { id: anexo };
  },
  alvo: (_e, r) => ({ tabela: 'guia_anexo', id: r.id }),
});

export const OPERACOES_AUDITORIA_TRAMITE = {
  'auditoria.abrir': opAbrirAuditoria,
  'auditoria.parecer': opParecerItem,
  'auditoria.concluir': opConcluirAuditoria,
  'auditoria.cancelar': opCancelarAuditoria,
  'empresa.cadastrar': opCadastrarEmpresa,
  'empresa.ativo': opAtivarEmpresa,
  'protocolo.emitir': opEmitirProtocolo,
  'protocolo.enviar': opEnviarProtocolo,
  'protocolo.conferir': opConferirProtocolo,
  'protocolo.cancelar': opCancelarProtocolo,
  'guia.responder': opResponderGuia,
  'guia.pendencia.abrir': opAbrirPendenciaGuia,
  'guia.pendencia.resolver': opResolverPendenciaGuia,
  'guia.responsavel': opResponsavelGuia,
  'guia.anexo': opAnexarGuia,
} as const;
export type NomeOperacaoAuditoriaTramite = keyof typeof OPERACOES_AUDITORIA_TRAMITE;

export async function gravarAuditoriaTramite(
  executor: Executor,
  nome: NomeOperacaoAuditoriaTramite,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_AUDITORIA_TRAMITE[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
