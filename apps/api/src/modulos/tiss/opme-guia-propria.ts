// OPME na guia (06-FAT linha 25), no banco do cliente. Regras puras em @sgh/dominio-faturamento (tiss/opme-guia.ts).
// Contrato de efeito:
//   - abrirLiberacaoOpme (no criar da autorização prévia): o pedido acima do limite de OPME do procedimento nasce em
//     rascunho e RETIDO: `pedido_aprovacao` 'pendente' do tipo 'limite_opme' (tipo nativo, nasce na primeira vez em
//     `tipo_documento_aprovacao`), com o valor da OPME, a alçada do limite (ou a vigente do tipo) e o resumo (total,
//     limite, justificativa de quem pediu);
//   - liberacaoQueRetem (no envio): enquanto a liberação não for aprovada, o pedido não sai à operadora;
//   - decidir: quatro olhos (quem pediu não decide), faixa e nível da alçada (`etapaDaAlcada`); cada decisão grava
//     `decisao_aprovacao`; o nível intermediário avança o pedido; o último fecha 'aprovado' (ou 'reprovado' com o
//     motivo, ou 'cancelado' por quem pediu). Nada se apaga;
//   - gravarOpmeAutorizada (na resposta da operadora): a guia de autorização da OPME (`guia_fonte_pagadora`, tipo
//     'opme', número do pedido, ligada à conta) com uma linha por OPME respondida em `guia_fonte_pagadora_opme`
//     (valor e quantidade autorizados, negado com valor zero);
//   - gravarOpmeDaGuiaTiss (na geração do lote): a OPME da conta vai à guia de cobrança (`guia_tiss_opme`, momento
//     'utilizado'), ligada à OPME autorizada do mesmo item faturável; o que passa do autorizado fica com a revisão
//     escrita e volta como aviso do lote. Guia reapresentada: as linhas anteriores ficam com exclusão lógica e as novas
//     seguem a sequência.
import {
  type AvaliacaoLimiteOpme,
  conferirDecisaoLiberacaoOpme,
  etapaDaAlcada,
  type NivelAlcadaAjuste,
  opmeDaGuiaCobranca,
  type SituacaoLiberacaoOpme,
  situacaoOpmeAutorizada,
} from '@sgh/dominio-faturamento';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

type Consulta = Pick<Leitor, 'uma' | 'consultar'>;
type Linha = Record<string, unknown>;

export const TIPO_LIBERACAO_OPME = 'limite_opme';
export const PORTA_LIBERACAO_OPME = Symbol('PORTA_LIBERACAO_OPME');
const ENTIDADE = 'solicitacao_autorizacao';
const SITUACOES_SEM_COBRANCA = "('sem_cobranca','transferido','estornado')";

/** Tabelas que as operações que chamam estas funções declaram além das suas. */
export const TABELAS_LIBERACAO_OPME = ['pedido_aprovacao', 'tipo_documento_aprovacao'] as const;
export const TABELAS_OPME_AUTORIZADA = ['guia_fonte_pagadora', 'guia_fonte_pagadora_opme'] as const;
export const TABELAS_OPME_COBRANCA = ['guia_tiss_opme'] as const;

const hojeIso = () => new Date().toISOString().slice(0, 10);

async function tipoLiberacao(tx: TxOperacao): Promise<number> {
  const t = await tx.uma<Linha>('SELECT id FROM tipo_documento_aprovacao WHERE codigo = ?', [
    TIPO_LIBERACAO_OPME,
  ]);
  if (t) return num(t['id']);
  return tx.incluir('tipo_documento_aprovacao', {
    codigo: TIPO_LIBERACAO_OPME,
    descricao: 'OPME acima do limite do procedimento na fonte pagadora',
    entidade: ENTIDADE,
    tipo_limite: 'valor',
  });
}

/** A alçada vigente do tipo 'limite_opme' no estabelecimento (nula: sem alçada cadastrada). */
async function alcadaVigente(l: Consulta, est: number, hoje: string): Promise<number | null> {
  const a = await l.uma<Linha>(
    `SELECT a.id FROM alcada_aprovacao a
       JOIN tipo_documento_aprovacao t ON t.id = a.tipo_documento_aprovacao_id AND t.codigo = ?
      WHERE a.estabelecimento_id = ? AND a.ativo = 1 AND a.vigencia_inicio <= ?
        AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= ?)
      ORDER BY a.vigencia_inicio DESC LIMIT 1`,
    [TIPO_LIBERACAO_OPME, est, hoje, hoje],
  );
  return a ? num(a['id']) : null;
}

/** Abre o pedido de liberação do pedido de autorização retido acima do limite. */
export async function abrirLiberacaoOpme(
  tx: TxOperacao,
  d: {
    readonly est: number;
    readonly usuario: number;
    readonly solicitacao: number;
    readonly numero: string;
    readonly avaliacao: AvaliacaoLimiteOpme;
    readonly justificativa: string;
    readonly alcadaDoLimite: number | null;
  },
): Promise<number> {
  const a = d.avaliacao;
  return tx.incluir('pedido_aprovacao', {
    estabelecimento_id: d.est,
    tipo_documento_aprovacao_id: await tipoLiberacao(tx),
    alcada_aprovacao_id: d.alcadaDoLimite ?? (await alcadaVigente(tx, d.est, hojeIso())),
    entidade: ENTIDADE,
    entidade_id: d.solicitacao,
    numero_documento: d.numero,
    descricao: `OPME acima do limite no pedido ${d.numero}`.slice(0, 500),
    valor: a.total,
    resumo_documento: JSON.stringify({
      total: a.total,
      quantidade: a.quantidade,
      limiteValor: a.limiteValor,
      limiteQuantidade: a.limiteQuantidade,
      motivos: a.excesso.map((p) => p.mensagem),
      justificativa: d.justificativa.trim(),
    }),
    solicitante_usuario_id: d.usuario,
    solicitado_em: new Date(),
    situacao: 'pendente',
  });
}

/** O motivo que retém o envio (liberação pedida e ainda não aprovada); nulo quando nada retém. */
export async function liberacaoQueRetem(l: Consulta, solicitacao: number): Promise<string | null> {
  const p = await l.uma<Linha>(
    `SELECT p.situacao FROM pedido_aprovacao p
       JOIN tipo_documento_aprovacao t ON t.id = p.tipo_documento_aprovacao_id AND t.codigo = ?
      WHERE p.entidade = ? AND p.entidade_id = ? AND p.excluido_em IS NULL ORDER BY p.id DESC LIMIT 1`,
    [TIPO_LIBERACAO_OPME, ENTIDADE, solicitacao],
  );
  if (!p || p['situacao'] === 'aprovado') return null;
  return p['situacao'] === 'pendente' || p['situacao'] === 'em_aprovacao'
    ? 'A OPME passa do limite do procedimento e aguarda a liberação na alçada.'
    : `A liberação da OPME acima do limite foi ${String(p['situacao'])}: o pedido não sai à operadora.`;
}

/** A guia de autorização da OPME com o que a operadora respondeu, item a item. */
export async function gravarOpmeAutorizada(
  tx: TxOperacao,
  d: {
    readonly est: number;
    readonly s: Linha;
    readonly situacao: string;
    readonly senha: string | null;
    readonly numeroGuiaOperadora: string | null;
    readonly agora: Date;
    readonly itens: readonly {
      readonly sequencia: number;
      readonly situacao: string;
      readonly quantidadeAutorizada: number;
      readonly valorAutorizado: number | null;
    }[];
  },
): Promise<number | null> {
  const solicitacao = num(d.s['id']);
  const opme = await tx.consultar<Linha>(
    `SELECT si.id, si.sequencia, si.quantidade_solicitada, si.valor_unitario, si.registro_anvisa, si.fabricante_id,
            COALESCE(si.item_faturavel_id,
              (SELECT f.id FROM item_faturavel f WHERE f.codigo = si.codigo_procedimento AND f.tipo_item = 'opme'
                ORDER BY f.id LIMIT 1)) AS item_faturavel_id
       FROM solicitacao_autorizacao_item si
      WHERE si.solicitacao_autorizacao_id = ? AND si.opme = TRUE AND si.excluido_em IS NULL ORDER BY si.sequencia`,
    [solicitacao],
  );
  const situacaoGuia =
    d.situacao === 'autorizada' || d.situacao === 'autorizada_parcial' || d.situacao === 'negada'
      ? d.situacao
      : null;
  const comItem = opme.filter((o) => o['item_faturavel_id'] !== null);
  if (!situacaoGuia || !comItem.length) return null;
  const numero = String(d.s['numero']);
  const existe = await tx.uma<Linha>(
    'SELECT id FROM guia_fonte_pagadora WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL',
    [d.est, numero],
  );
  if (existe)
    throw recusaRegra('Resposta recusada', [
      { campo: 'situacao', mensagem: `A OPME do pedido ${numero} já tem guia de autorização registrada.` },
    ]);
  const guia = await tx.incluir('guia_fonte_pagadora', {
    estabelecimento_id: d.est,
    numero,
    numero_guia_operadora: d.numeroGuiaOperadora,
    tipo_guia: 'opme',
    paciente_id: num(d.s['paciente_id']),
    atendimento_id: numOuNull(d.s['atendimento_id']),
    conta_hospitalar_id: numOuNull(d.s['conta_hospitalar_id']),
    agendamento_cirurgico_id: numOuNull(d.s['agendamento_cirurgico_id']),
    fonte_pagadora_id: num(d.s['fonte_pagadora_id']),
    plano_fonte_pagadora_id: numOuNull(d.s['plano_fonte_pagadora_id']),
    numero_carteira: txtOuNull(d.s['numero_carteira']),
    solicitante_profissional_id: numOuNull(d.s['solicitante_profissional_id']),
    data_solicitacao: d.s['solicitada_em'] ?? d.agora,
    data_envio_fonte_pagadora: d.s['enviada_em'] ?? null,
    data_autorizacao: situacaoGuia === 'negada' ? null : d.agora,
    data_negacao: situacaoGuia === 'negada' ? d.agora : null,
    senha: d.senha,
    situacao: situacaoGuia,
  });
  const resposta = new Map(d.itens.map((i) => [i.sequencia, i]));
  let seq = 0;
  for (const o of comItem) {
    const r = resposta.get(num(o['sequencia']));
    const qtd = Number(o['quantidade_solicitada']);
    const unit = o['valor_unitario'] === null ? 0 : Number(o['valor_unitario']);
    const sit = situacaoOpmeAutorizada(r?.situacao ?? 'em_analise');
    const autorizado = sit === 'negado' ? 0 : (r?.valorAutorizado ?? Math.round(unit * qtd * 100) / 100);
    await tx.incluir('guia_fonte_pagadora_opme', {
      guia_fonte_pagadora_id: guia,
      sequencia: ++seq,
      item_faturavel_id: num(o['item_faturavel_id']),
      fabricante_id: numOuNull(o['fabricante_id']),
      registro_anvisa: txtOuNull(o['registro_anvisa']),
      quantidade: qtd,
      valor_proposto: o['valor_unitario'] === null ? null : unit,
      valor_unitario: unit,
      valor_total: Math.round(unit * qtd * 100) / 100,
      valor_autorizado:
        sit === 'autorizado' || sit === 'autorizado_parcial' || sit === 'negado' ? autorizado : null,
      situacao: sit,
      observacao: r
        ? `Item ${r.sequencia} do pedido; quantidade autorizada ${r.quantidadeAutorizada}.`
        : null,
    });
  }
  return guia;
}

/** A OPME da conta na guia de cobrança, ligada à OPME autorizada; devolve os avisos de revisão. */
export async function gravarOpmeDaGuiaTiss(
  tx: TxOperacao,
  d: {
    readonly guiaTiss: number;
    readonly conta: number;
    readonly agora: Date;
    readonly usuario: number | null;
  },
): Promise<string[]> {
  const cobradas = (
    await tx.consultar<Linha>(
      `SELECT ci.id, ci.item_faturavel_id, ci.quantidade, ci.valor_total, f.codigo, f.descricao
         FROM conta_hospitalar_item ci JOIN item_faturavel f ON f.id = ci.item_faturavel_id
        WHERE ci.conta_hospitalar_id = ? AND ci.excluido_em IS NULL AND ci.situacao NOT IN ${SITUACOES_SEM_COBRANCA}
          AND f.tipo_item = 'opme'
        ORDER BY ci.sequencia`,
      [d.conta],
    )
  ).map((x) => ({
    contaItem: num(x['id']),
    itemFaturavel: num(x['item_faturavel_id']),
    codigo: String(x['codigo'] ?? '').slice(0, 10),
    descricao: String(x['descricao'] ?? '').slice(0, 150),
    quantidade: Number(x['quantidade']),
    valorTotal: Number(x['valor_total']),
    registroAnvisa: null,
  }));
  const anteriores = await tx.consultar<Linha>(
    'SELECT id, versao, sequencia, excluido_em FROM guia_tiss_opme WHERE guia_tiss_id = ?',
    [d.guiaTiss],
  );
  for (const a of anteriores)
    if (a['excluido_em'] === null)
      await tx.alterar('guia_tiss_opme', num(a['id']), num(a['versao']), {
        excluido_em: d.agora,
        excluido_por: d.usuario,
      });
  if (!cobradas.length) return [];
  const autorizadas = (
    await tx.consultar<Linha>(
      `SELECT o.id, o.item_faturavel_id, o.valor_autorizado, o.quantidade
         FROM guia_fonte_pagadora_opme o JOIN guia_fonte_pagadora g ON g.id = o.guia_fonte_pagadora_id
        WHERE g.conta_hospitalar_id = ? AND g.excluido_em IS NULL AND o.excluido_em IS NULL
          AND o.situacao IN ('autorizado','autorizado_parcial')
        ORDER BY o.id`,
      [d.conta],
    )
  ).map((x) => ({
    id: num(x['id']),
    itemFaturavel: num(x['item_faturavel_id']),
    valorAutorizado: Number(x['valor_autorizado'] ?? 0),
    quantidadeAutorizada: Number(x['quantidade']),
  }));
  const base = anteriores.reduce((m, a) => Math.max(m, num(a['sequencia'])), 0);
  const avisos: string[] = [];
  for (const l of opmeDaGuiaCobranca(cobradas, autorizadas)) {
    await tx.incluir('guia_tiss_opme', {
      guia_tiss_id: d.guiaTiss,
      sequencia: base + l.sequencia,
      conta_hospitalar_item_id: l.contaItem,
      item_faturavel_id: l.itemFaturavel,
      guia_fonte_pagadora_opme_id: l.opmeAutorizada,
      momento: 'utilizado',
      tabela_tiss: '19',
      codigo_item: l.codigo || 'SEMCODIGO',
      descricao: l.descricao || 'OPME',
      quantidade: l.quantidade,
      valor_unitario: l.valorUnitario,
      valor_total: l.valorTotal,
      justificativa_revisao: l.revisao,
    });
    if (l.revisao) avisos.push(`Conta ${d.conta}: ${l.revisao}`);
  }
  return avisos;
}

const esquemaDecidir = z
  .object({
    versao: z.number().int().positive(),
    decisao: z.enum(['aprovar', 'recusar', 'cancelar']),
    justificativa: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

const TABELAS = [
  'pedido_aprovacao',
  'decisao_aprovacao',
  'tipo_documento_aprovacao',
  'solicitacao_autorizacao',
] as const;

/** A fila de liberação da OPME acima do limite e a decisão por quatro olhos na alçada. */
export class PortaLiberacaoOpmePropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'tiss.opme-liberacao');
  }

  /** Os pedidos abertos e os decididos nos últimos 30 dias, com o resumo, o paciente e quem pediu. */
  painel(c: ContextoPortaPropria) {
    return this.ler(c, 'painel', async (l, est) => {
      const r = await l.consultar<Linha>(
        `SELECT p.id, p.versao, p.situacao, p.valor, p.nivel_atual, p.numero_documento, p.resumo_documento,
                p.solicitado_em, p.concluido_em, p.motivo_conclusao, p.solicitante_usuario_id,
                u.nome AS solicitante, s.id AS solicitacao_id, s.situacao AS situacao_pedido, s.paciente_id,
                pf.nome AS paciente, fp.nome AS fonte
           FROM pedido_aprovacao p
           JOIN tipo_documento_aprovacao t ON t.id = p.tipo_documento_aprovacao_id AND t.codigo = ?
           JOIN solicitacao_autorizacao s ON s.id = p.entidade_id AND p.entidade = ?
           LEFT JOIN usuario u ON u.id = p.solicitante_usuario_id
           LEFT JOIN paciente pa ON pa.id = s.paciente_id
           LEFT JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
           LEFT JOIN fonte_pagadora fp ON fp.id = s.fonte_pagadora_id
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL
            AND (p.situacao IN ('pendente','em_aprovacao') OR p.concluido_em >= NOW() - INTERVAL 30 DAY)
          ORDER BY p.situacao IN ('pendente','em_aprovacao') DESC, p.solicitado_em DESC LIMIT 200`,
        [TIPO_LIBERACAO_OPME, ENTIDADE, est.id],
      );
      const pedidos = [];
      for (const x of r) {
        const resumo = (
          typeof x['resumo_documento'] === 'string'
            ? JSON.parse(x['resumo_documento'] as string)
            : (x['resumo_documento'] ?? {})
        ) as Record<string, unknown>;
        const decisoes = (
          await l.consultar<Linha>(
            `SELECT d.nivel, d.decisao, d.justificativa, d.ocorrido_em, u.nome FROM decisao_aprovacao d
               LEFT JOIN usuario u ON u.id = d.aprovador_usuario_id WHERE d.pedido_aprovacao_id = ? ORDER BY d.id`,
            [x['id']],
          )
        ).map((dd) => ({
          nivel: num(dd['nivel']),
          decisao: String(dd['decisao']),
          justificativa: txtOuNull(dd['justificativa']),
          aprovador: txtOuNull(dd['nome']),
          em: dd['ocorrido_em'] ? new Date(String(dd['ocorrido_em'])).toISOString() : null,
        }));
        pedidos.push({
          id: num(x['id']),
          versao: num(x['versao']),
          situacao: String(x['situacao']),
          valor: Number(x['valor'] ?? 0),
          nivelAtual: num(x['nivel_atual']),
          numero: txtOuNull(x['numero_documento']),
          solicitacao: num(x['solicitacao_id']),
          situacaoPedido: String(x['situacao_pedido']),
          paciente: txtOuNull(x['paciente']),
          fonte: txtOuNull(x['fonte']),
          solicitante: txtOuNull(x['solicitante']),
          meu: c.usuario !== null && num(x['solicitante_usuario_id']) === c.usuario,
          solicitadoEm: new Date(String(x['solicitado_em'])).toISOString(),
          motivoConclusao: txtOuNull(x['motivo_conclusao']),
          limiteValor: resumo['limiteValor'] === null ? null : Number(resumo['limiteValor'] ?? 0),
          limiteQuantidade: resumo['limiteQuantidade'] == null ? null : Number(resumo['limiteQuantidade']),
          motivos: Array.isArray(resumo['motivos']) ? (resumo['motivos'] as unknown[]).map(String) : [],
          justificativa: txtOuNull(resumo['justificativa']),
          decisoes,
        });
      }
      return { pedidos };
    });
  }

  /** Decide a liberação: aprovar (nível da alçada), recusar com motivo ou cancelar (só quem pediu). */
  decidir(
    c: ContextoPortaPropria,
    pedido: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: string; faltam: number[] }> {
    const e = entradaValida(esquemaDecidir, entrada);
    return this.gravar(c, 'tiss.opme-liberacao.decidir', TABELAS, async (tx, est, usuario) => {
      const p = (
        await tx.consultarParaAtualizar(
          `SELECT p.* FROM pedido_aprovacao p
             JOIN tipo_documento_aprovacao t ON t.id = p.tipo_documento_aprovacao_id AND t.codigo = ?
            WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
          [TIPO_LIBERACAO_OPME, pedido, est.id],
        )
      )[0] as Linha | undefined;
      if (!p) throw naoEncontrado('Pedido de liberação');
      const motivo = conferirDecisaoLiberacaoOpme({
        situacao: String(p['situacao']) as SituacaoLiberacaoOpme,
        solicitante: num(p['solicitante_usuario_id']),
        decisor: usuario,
        decisao: e.decisao,
        justificativa: e.justificativa,
      });
      if (motivo) throw recusaRegra('Decisão recusada', [{ campo: 'decisao', mensagem: motivo }]);
      const agora = new Date();
      const hoje = hojeIso();
      if (e.decisao === 'cancelar') {
        await tx.alterar('pedido_aprovacao', pedido, e.versao, {
          situacao: 'cancelado',
          concluido_em: agora,
          motivo_conclusao: e.justificativa,
        });
        return { tabela: 'pedido_aprovacao', id: pedido, situacao: 'cancelado', faltam: [] };
      }
      const alcada = numOuNull(p['alcada_aprovacao_id']);
      const niveis: NivelAlcadaAjuste[] = alcada
        ? (
            await tx.consultar<Linha>(
              `SELECT id, nivel, perfil_acesso_id, aprovador_usuario_id, valor_unitario_minimo, valor_unitario_maximo,
                      obrigatorio FROM alcada_aprovacao_nivel
                WHERE alcada_aprovacao_id = ? AND excluido_em IS NULL
                  AND (vigencia_inicio IS NULL OR vigencia_inicio <= ?) AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
                ORDER BY nivel, sequencia`,
              [alcada, hoje, hoje],
            )
          ).map((x) => ({
            id: num(x['id']),
            nivel: num(x['nivel']),
            perfilId: numOuNull(x['perfil_acesso_id']),
            usuarioId: numOuNull(x['aprovador_usuario_id']),
            valorMinimo: Number(x['valor_unitario_minimo']),
            valorMaximo: x['valor_unitario_maximo'] === null ? null : Number(x['valor_unitario_maximo']),
            obrigatorio: Number(x['obrigatorio']) === 1,
          }))
        : [];
      const modo = alcada
        ? String(
            (await tx.uma<Linha>('SELECT modo_aprovacao FROM alcada_aprovacao WHERE id = ?', [alcada]))?.[
              'modo_aprovacao'
            ],
          )
        : 'serie';
      let nivel: NivelAlcadaAjuste | null = null;
      let faltam: number[] = [];
      if (e.decisao === 'aprovar') {
        const perfis = niveis.length
          ? (
              await tx.consultar<Linha>(
                `SELECT perfil_acesso_id FROM usuario_perfil WHERE usuario_id = ? AND estabelecimento_id = ?
                    AND excluido_em IS NULL AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
                [usuario, est.id, hoje, hoje],
              )
            ).map((x) => num(x['perfil_acesso_id']))
          : [];
        const aprovacoes = (
          await tx.consultar<Linha>(
            "SELECT nivel, aprovador_usuario_id FROM decisao_aprovacao WHERE pedido_aprovacao_id = ? AND decisao = 'aprovado'",
            [pedido],
          )
        ).map((x) => ({ nivel: num(x['nivel']), usuarioId: num(x['aprovador_usuario_id']) }));
        const et = etapaDaAlcada(
          Number(p['valor'] ?? 0),
          niveis,
          { modo: modo === 'paralelo' ? 'paralelo' : 'serie', permiteAutoaprovacao: false },
          aprovacoes,
          usuario,
          perfis,
        );
        if (et.motivo)
          throw recusaRegra('Decisão recusada', [
            {
              campo: 'decisao',
              mensagem: et.motivo
                .replace('de ajustes da conta', 'da OPME acima do limite')
                .replace(/^O ajuste de/, 'A OPME de'),
            },
          ]);
        nivel = et.nivel;
        if (!et.conclui) faltam = et.faltam.filter((x) => x !== et.nivel?.nivel);
      }
      await tx.incluir('decisao_aprovacao', {
        pedido_aprovacao_id: pedido,
        alcada_aprovacao_nivel_id: nivel?.id ?? null,
        nivel: nivel?.nivel ?? 1,
        aprovador_usuario_id: usuario,
        decisao: e.decisao === 'aprovar' ? 'aprovado' : 'recusado',
        justificativa: e.justificativa,
        valor_aprovado: e.decisao === 'aprovar' ? Number(p['valor'] ?? 0) : null,
        ocorrido_em: agora,
      });
      if (faltam.length) {
        const proximo = niveis.find((x) => x.nivel === faltam[0]) ?? null;
        await tx.alterar('pedido_aprovacao', pedido, e.versao, {
          situacao: 'em_aprovacao',
          nivel_atual: faltam[0],
          alcada_aprovacao_nivel_id: proximo?.id ?? null,
        });
        return { tabela: 'pedido_aprovacao', id: pedido, situacao: 'em_aprovacao', faltam };
      }
      const situacao = e.decisao === 'aprovar' ? 'aprovado' : 'reprovado';
      await tx.alterar('pedido_aprovacao', pedido, e.versao, {
        situacao,
        concluido_em: agora,
        motivo_conclusao: e.justificativa,
      });
      return { tabela: 'pedido_aprovacao', id: pedido, situacao, faltam: [] };
    });
  }
}
