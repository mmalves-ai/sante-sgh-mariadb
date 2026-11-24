// Porta própria do cadastro do estoque (F3.6, 05-SUP linhas 1, 3 e 6) sobre o MariaDB do cliente pelo Executor do
// núcleo: cada gravação é uma operação com a trilha na mesma transação e a versão conferida (conflito = 409).
// Item e local nunca são apagados (inativação com motivo, recusada com saldo). Os filhos do item são acertados pela
// chave natural: o que sai da lista é excluído pela gravação auditada (vias, princípios, códigos de barras) ou
// inativado (apresentação com o registro sanitário e estabilidade, que a nota e o lote podem citar); o que volta
// reaproveita a linha. O escopo retirado do local fica marcado como excluído e sem nenhuma ação; a concessão por
// classificação ou centro de custo retirada fecha a vigência (o histórico fica).
import {
  conferirConcessaoVigente,
  conferirEscopoLocal,
  conferirInativacaoItem,
  conferirInativacaoLocal,
  conferirItemEstoque,
  conferirLocalEstoque,
  chaveEstabilidade,
  conferirAlteracaoItem,
  conferirRequisicaoSeparavel,
  retiradaDaConcessao,
  type ItemEstoqueEntrada,
  type LocalEstoqueEntrada,
  montarSeparacao,
  PERMISSOES_LOCAL_USUARIO,
  type PermissaoLocalUsuario,
  type RecusaCadastroEstoque,
  situacaoRegistroNaData,
} from '@sgh/contratos/regras-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type {
  ApoioCadastroEstoque,
  ConcessaoEntrada,
  ConcessaoVigente,
  EscopoCompletoUsuario,
  FichaItemEdicao,
  FichaLocalEdicao,
  ListaSeparacao,
  LocalResumo,
  Opcao,
  PortaCadastroEstoque,
} from './cadastro-estoque-porta.js';

export type NucleoCadastroEstoque = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export const TABELAS_CADASTRO_ESTOQUE = [
  'insumo',
  'insumo_principio_ativo',
  'insumo_via',
  'insumo_codigo_barras',
  'apresentacao_comercial',
  'registro_sanitario',
  'estabilidade_insumo',
  'local_estoque',
  'local_estoque_setor',
  'local_estoque_classificacao',
  'local_estoque_usuario',
  'usuario_estoque_classificacao',
  'usuario_estoque_centro_custo',
] as const;

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const b = (v: unknown) => v === true || v === 1 || v === '1' || v === 1n;
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '';
const nulo = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** As recusas do domínio viram um 409 com todos os campos (nada gravado). */
function recusarTodas(f: readonly RecusaCadastroEstoque[]): void {
  if (f.length)
    throw recusa(f[0]!.codigo, f.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(f.flatMap((x) => x.campos ?? []))],
    });
}
const recusarUma = (x: RecusaCadastroEstoque | null) => recusarTodas(x ? [x] : []);

const COLUNA_PERMISSAO: Record<PermissaoLocalUsuario, string> = {
  requisitar: 'pode_requisitar',
  atender: 'pode_atender',
  autorizarRequisicao: 'pode_autorizar_requisicao',
  receberNota: 'pode_receber_nota',
  conferirRecebimento: 'pode_conferir_recebimento',
  transferir: 'pode_transferir',
  devolver: 'pode_devolver',
  ajustar: 'pode_ajustar',
  inventariar: 'pode_inventariar',
  autorizarPedido: 'pode_autorizar_pedido',
  movimentarControlado: 'pode_movimentar_controlado',
  movimentarAntimicrobiano: 'pode_movimentar_antimicrobiano',
  desbloquearFechamento: 'pode_desbloquear_fechamento',
  visualizaPreco: 'visualiza_preco',
};

/** As colunas do item a partir da entrada (o mesmo mapa na inclusão e na alteração). */
function colunasItem(e: ItemEstoqueEntrada): Record<string, unknown> {
  return {
    codigo: e.codigo.trim(),
    nome: e.nome.trim(),
    nome_resumido: nulo(e.nomeResumido),
    tipo: e.tipo,
    grupo_insumo_id: e.grupo,
    subgrupo_insumo_id: e.subgrupo ?? null,
    fabricante_id: e.fabricante ?? null,
    estoque_unidade_medida_id: e.unidadeEstoque,
    compra_unidade_medida_id: e.unidadeCompra ?? null,
    consumo_unidade_medida_id: e.unidadeConsumo ?? null,
    prescricao_unidade_medida_id: e.unidadePrescricao ?? null,
    fator_compra_estoque: e.fatorCompraEstoque,
    fator_estoque_consumo: e.fatorEstoqueConsumo,
    fator_consumo_prescricao: e.fatorConsumoPrescricao,
    codigo_gtin: nulo(e.gtin),
    codigo_ncm: nulo(e.ncm),
    codigo_cest: nulo(e.cest),
    classe_risco: e.classeRisco ?? null,
    controla_lote: e.controlaLote,
    controla_validade: e.controlaValidade,
    controlado: e.controlado,
    antimicrobiano: e.antimicrobiano,
    alta_vigilancia: e.altaVigilancia,
    fracionavel: e.fracionavel,
    prescritivel: e.prescritivel,
    opme: e.tipo === 'opme',
    estoque_minimo: e.estoqueMinimo ?? null,
    estoque_maximo: e.estoqueMaximo ?? null,
  };
}

/** Confere que as referências do item existem e estão ativas (a recusa aponta o campo). */
async function referenciasItem(tx: TxOperacao, e: ItemEstoqueEntrada): Promise<void> {
  const existe = async (sql: string, id: number | null | undefined, campo: string, nome: string) => {
    if (id === null || id === undefined) return;
    if (!(await tx.uma(sql, [id])))
      throw recusa('referencia-inexistente', `${nome} inexistente ou inativo.`, { campos: [campo] });
  };
  await existe(
    'SELECT id FROM grupo_insumo WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL',
    e.grupo,
    'grupo',
    'Grupo',
  );
  if (e.subgrupo) {
    const s = await tx.uma<Linha>(
      'SELECT grupo_insumo_id FROM subgrupo_insumo WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL',
      [e.subgrupo],
    );
    if (!s || n(s['grupo_insumo_id']) !== e.grupo)
      throw recusa('subgrupo-fora-do-grupo', 'O subgrupo não pertence ao grupo escolhido.', {
        campos: ['subgrupo'],
      });
  }
  const un = 'SELECT id FROM unidade_medida WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL';
  await existe(un, e.unidadeEstoque, 'unidadeEstoque', 'Unidade de estoque');
  await existe(un, e.unidadeCompra, 'unidadeCompra', 'Unidade de compra');
  await existe(un, e.unidadeConsumo, 'unidadeConsumo', 'Unidade de consumo');
  await existe(un, e.unidadePrescricao, 'unidadePrescricao', 'Unidade de prescrição');
  const fab = 'SELECT id FROM fabricante WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL';
  await existe(fab, e.fabricante, 'fabricante', 'Fabricante');
  for (const p of e.principiosAtivos)
    await existe(
      'SELECT id FROM principio_ativo WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL',
      p.principio,
      'principiosAtivos',
      'Princípio ativo',
    );
  for (const v of e.vias)
    await existe(
      'SELECT id FROM via_de_uso WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL',
      v.via,
      'vias',
      'Via de uso',
    );
  for (const a of e.apresentacoes)
    await existe(fab, a.fabricante, 'apresentacoes', 'Fabricante da apresentação');
  for (const c of e.codigosBarras)
    await existe(un, c.unidade, 'codigosBarras', 'Unidade do código de barras');
}

type Filho = { readonly chave: string; readonly valores: Record<string, unknown> };

/**
 * Acerta os filhos do item pela chave natural: alterar o que ficou (reabre linha marcada como excluída), incluir o
 * novo e, para o que saiu, excluir pela gravação auditada ou inativar (quando `inativar` é a coluna).
 */
async function acertarFilhos(
  tx: TxOperacao,
  tabela: string,
  insumo: number,
  chaveDe: (r: Linha) => string,
  novos: readonly Filho[],
  saida: { inativar: string } | 'excluir',
): Promise<void> {
  const atuais = await tx.consultar<Linha>(`SELECT * FROM ${tabela} WHERE insumo_id = ? FOR UPDATE`, [
    insumo,
  ]);
  const porChave = new Map(atuais.map((r) => [chaveDe(r), r]));
  const ficam = new Set(novos.map((x) => x.chave));
  for (const r of atuais) {
    if (ficam.has(chaveDe(r)) || r['excluido_em'] !== null) continue;
    if (saida === 'excluir') await tx.excluir(tabela, n(r['id']), n(r['versao']));
    else if (b(r[saida.inativar]))
      await tx.alterar(tabela, n(r['id']), n(r['versao']), { [saida.inativar]: false });
  }
  for (const x of novos) {
    const r = porChave.get(x.chave);
    const valores = { ...x.valores, ...(saida !== 'excluir' ? { [saida.inativar]: true } : {}) };
    if (r) {
      const muda =
        Object.entries(valores).some(
          ([k, v]) => String(r[k] ?? '') !== String(v === true ? 1 : v === false ? 0 : (v ?? '')),
        ) || r['excluido_em'] !== null;
      if (muda)
        await tx.alterar(tabela, n(r['id']), n(r['versao']), {
          ...valores,
          ...(r['excluido_em'] !== null ? { excluido_em: null, excluido_por: null } : {}),
        });
    } else await tx.incluir(tabela, { insumo_id: insumo, ...valores });
  }
}

async function gravarFilhosItem(tx: TxOperacao, id: number, e: ItemEstoqueEntrada): Promise<void> {
  await acertarFilhos(
    tx,
    'insumo_principio_ativo',
    id,
    (r) => String(n(r['principio_ativo_id'])),
    e.principiosAtivos.map((p, i) => ({
      chave: String(p.principio),
      valores: {
        principio_ativo_id: p.principio,
        concentracao: p.concentracao ?? null,
        concentracao_unidade_medida_id: p.unidade ?? null,
        principal: p.principal ?? (i === 0 && !e.principiosAtivos.some((x) => x.principal)),
      },
    })),
    'excluir',
  );
  await acertarFilhos(
    tx,
    'insumo_via',
    id,
    (r) => String(n(r['via_de_uso_id'])),
    e.vias.map((v, i) => ({
      chave: String(v.via),
      valores: { via_de_uso_id: v.via, padrao: v.padrao ?? (i === 0 && !e.vias.some((x) => x.padrao)) },
    })),
    'excluir',
  );
  // A sequência é única por item: o código que já existe mantém a sua; o novo entra depois da maior.
  const cbAtuais = await tx.consultar<Linha>(
    'SELECT codigo_barras, sequencia FROM insumo_codigo_barras WHERE insumo_id = ?',
    [id],
  );
  const jaTem = new Set(cbAtuais.map((r) => t(r['codigo_barras'])));
  let proxima = cbAtuais.reduce((m, r) => Math.max(m, n(r['sequencia'])), 0);
  await acertarFilhos(
    tx,
    'insumo_codigo_barras',
    id,
    (r) => t(r['codigo_barras']),
    e.codigosBarras.map((c, i) => ({
      chave: c.codigo,
      valores: {
        ...(jaTem.has(c.codigo) ? {} : { sequencia: ++proxima }),
        codigo_barras: c.codigo,
        padrao: c.padrao,
        quantidade_representada: c.quantidade,
        unidade_medida_id: c.unidade,
        principal: c.principal ?? (i === 0 && !e.codigosBarras.some((x) => x.principal)),
      },
    })),
    'excluir',
  );
  const chaveAp = (fab: unknown, nome: unknown, ap: unknown) => `${n(fab)}|${t(nome)}|${t(ap)}`;
  await acertarFilhos(
    tx,
    'apresentacao_comercial',
    id,
    (r) => chaveAp(r['fabricante_id'], r['nome_comercial'], r['apresentacao']),
    e.apresentacoes.map((a) => ({
      chave: chaveAp(a.fabricante, a.nomeComercial.trim(), nulo(a.apresentacao)),
      valores: {
        fabricante_id: a.fabricante ?? null,
        nome_comercial: a.nomeComercial.trim(),
        apresentacao: nulo(a.apresentacao),
        quantidade_embalagem: a.quantidadeEmbalagem,
        registro_anvisa: a.registro?.numero ?? null,
        registro_anvisa_validade: a.registro?.validade ?? null,
      },
    })),
    { inativar: 'ativo' },
  );
  // O registro sanitário de cada apresentação ativa (uma linha por número; a situação e a validade acompanham).
  const aps = await tx.consultar<Linha>(
    'SELECT id, fabricante_id, nome_comercial, apresentacao FROM apresentacao_comercial WHERE insumo_id = ? AND ativo = TRUE AND excluido_em IS NULL',
    [id],
  );
  for (const a of e.apresentacoes) {
    const ap0 = aps.find(
      (x) =>
        chaveAp(x['fabricante_id'], x['nome_comercial'], x['apresentacao']) ===
        chaveAp(a.fabricante, a.nomeComercial.trim(), nulo(a.apresentacao)),
    );
    // O registro substituído (outro número) ou retirado deixa de valer: fica no histórico como cancelado.
    if (ap0)
      for (const v of await tx.consultar<Linha>(
        `SELECT id, versao FROM registro_sanitario WHERE apresentacao_comercial_id = ? AND excluido_em IS NULL
            AND situacao IN ('valido','em_revalidacao') AND (? IS NULL OR numero_registro <> ?) FOR UPDATE`,
        [n(ap0['id']), a.registro?.numero ?? null, a.registro?.numero ?? null],
      ))
        await tx.alterar('registro_sanitario', n(v['id']), n(v['versao']), { situacao: 'cancelado' });
    if (!a.registro) continue;
    const ap = aps.find(
      (x) =>
        chaveAp(x['fabricante_id'], x['nome_comercial'], x['apresentacao']) ===
        chaveAp(a.fabricante, a.nomeComercial.trim(), nulo(a.apresentacao)),
    );
    if (!ap) continue;
    const apId = n(ap['id']);
    const reg = await tx.uma<Linha>(
      'SELECT id, versao, situacao, data_validade FROM registro_sanitario WHERE apresentacao_comercial_id = ? AND numero_registro = ? FOR UPDATE',
      [apId, a.registro.numero],
    );
    const valores = {
      numero_registro: a.registro.numero,
      data_validade: a.registro.validade ?? null,
      situacao: a.registro.situacao ?? 'valido',
      fabricante_id: a.fabricante ?? null,
    };
    if (reg) {
      if (
        t(reg['situacao']) !== valores.situacao ||
        dataIso(reg['data_validade']) !== (valores.data_validade ?? '')
      )
        await tx.alterar('registro_sanitario', n(reg['id']), n(reg['versao']), valores);
    } else {
      const seq = await tx.uma<Linha>(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM registro_sanitario WHERE apresentacao_comercial_id = ?',
        [apId],
      );
      await tx.incluir('registro_sanitario', {
        apresentacao_comercial_id: apId,
        sequencia: n(seq?.['s']),
        ...valores,
      });
    }
  }
  await acertarFilhos(
    tx,
    'estabilidade_insumo',
    id,
    (r) => `${t(r['condicao'])}|${n(r['condicao_armazenamento_id'])}|${n(r['diluente_insumo_id'])}`,
    e.estabilidades.map((s) => ({
      chave: chaveEstabilidade(s),
      valores: {
        condicao: s.condicao,
        condicao_armazenamento_id: s.condicaoArmazenamento ?? null,
        diluente_insumo_id: s.diluente ?? null,
        horas_estabilidade: s.horas,
        horas_infusao_maxima: s.horasInfusaoMaxima ?? null,
      },
    })),
    { inativar: 'ativo' },
  );
}

/** O que o item já tem no estoque: o saldo e a quantidade de movimentos. */
async function usoDoItem(l: Leitor, insumo: number): Promise<{ saldoTotal: number; movimentos: number }> {
  const m = await l.uma<Linha>(
    'SELECT COUNT(*) AS q FROM movimento_estoque WHERE insumo_id = ? AND excluido_em IS NULL',
    [insumo],
  );
  return { saldoTotal: await saldoDoItem(l, insumo), movimentos: n(m?.['q']) };
}

/** As requisições e os pedidos de compra em aberto com o item. */
async function pendenciasDoItem(
  l: Leitor,
  insumo: number,
): Promise<{ requisicoesAbertas: number; pedidosAbertos: number }> {
  const rq = await l.uma<Linha>(
    `SELECT COUNT(DISTINCT ri.requisicao_material_id) AS q FROM requisicao_material_item ri
       JOIN requisicao_material r ON r.id = ri.requisicao_material_id AND r.excluido_em IS NULL
        AND r.situacao IN ('rascunho','solicitada','autorizada','em_separacao','atendida_parcial')
      WHERE ri.insumo_id = ? AND ri.excluido_em IS NULL AND ri.situacao IN ('pendente','atendido_parcial')`,
    [insumo],
  );
  const pc = await l.uma<Linha>(
    `SELECT COUNT(DISTINCT pi.pedido_compra_id) AS q FROM pedido_compra_item pi
       JOIN pedido_compra p ON p.id = pi.pedido_compra_id AND p.excluido_em IS NULL
        AND p.situacao IN ('rascunho','em_cotacao','aguardando_aprovacao','aprovado','enviado','parcialmente_recebido')
      WHERE pi.insumo_id = ? AND pi.excluido_em IS NULL AND pi.cancelado_em IS NULL
        AND pi.quantidade - pi.quantidade_recebida - pi.quantidade_cancelada > 0`,
    [insumo],
  );
  return { requisicoesAbertas: n(rq?.['q']), pedidosAbertos: n(pc?.['q']) };
}

/**
 * Inclui a concessão; a cancelada com o mesmo início (a chave única do par) volta a valer com os novos dados, e a
 * trilha guarda as duas gravações.
 */
async function incluirConcessao(
  tx: TxOperacao,
  tabela: 'usuario_estoque_classificacao' | 'usuario_estoque_centro_custo',
  par: string,
  valoresPar: readonly unknown[],
  inicio: string,
  valores: Record<string, unknown>,
): Promise<number> {
  const cancelada = await tx.uma<Linha>(
    `SELECT id, versao FROM ${tabela} WHERE ${par} AND vigencia_inicio = ? AND excluido_em IS NOT NULL FOR UPDATE`,
    [...valoresPar, inicio],
  );
  if (!cancelada) return tx.incluir(tabela, valores);
  await tx.alterar(tabela, n(cancelada['id']), n(cancelada['versao']), {
    ...valores,
    excluido_em: null,
    excluido_por: null,
  });
  return n(cancelada['id']);
}

async function saldoDoItem(l: Leitor, insumo: number): Promise<number> {
  const r = await l.uma<Linha>(
    'SELECT COALESCE(SUM(quantidade), 0) AS q FROM saldo_estoque WHERE insumo_id = ? AND excluido_em IS NULL',
    [insumo],
  );
  return n(r?.['q']);
}

function colunasLocal(e: LocalEstoqueEntrada): Record<string, unknown> {
  return {
    codigo: e.codigo.trim(),
    nome: e.nome.trim(),
    tipo: e.tipo,
    setor_funcional_id: e.setor ?? null,
    centro_custo_id: e.centroCusto ?? null,
    origem_local_estoque_id: e.localOrigem ?? null,
    devolucao_local_estoque_id: e.localDevolucao ?? null,
    atende_solicitacao_setor: e.atendeSetor,
    atende_solicitacao_paciente: e.atendePaciente,
    atende_transferencia: e.atendeTransferencia,
    permite_atendimento_parcial: e.atendimentoParcial,
    verifica_saldo: e.verificaSaldo,
    usa_codigo_barras: e.usaCodigoBarras,
    apenas_urgente: e.apenasUrgente,
    tipo_reposicao: e.tipoReposicao ?? null,
    horas_antecedencia_atendimento: e.horasAntecedencia ?? null,
  };
}

async function referenciasLocal(tx: TxOperacao, est: number, e: LocalEstoqueEntrada): Promise<void> {
  const doEst = async (tabela: string, id: number | null | undefined, campo: string, nome: string) => {
    if (id === null || id === undefined) return;
    if (
      !(await tx.uma(
        `SELECT id FROM ${tabela} WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL`,
        [id, est],
      ))
    )
      throw recusa('referencia-inexistente', `${nome} inexistente neste estabelecimento.`, {
        campos: [campo],
      });
  };
  await doEst('setor_funcional', e.setor, 'setor', 'Setor');
  await doEst('centro_custo', e.centroCusto, 'centroCusto', 'Centro de custo');
  await doEst('local_estoque', e.localOrigem, 'localOrigem', 'Local que abastece');
  await doEst('local_estoque', e.localDevolucao, 'localDevolucao', 'Local de devolução');
  for (const s of e.setores) await doEst('setor_funcional', s.setor, 'setores', 'Setor atendido');
}

async function gravarFilhosLocal(tx: TxOperacao, id: number, e: LocalEstoqueEntrada): Promise<void> {
  const setores = await tx.consultar<Linha>(
    'SELECT id, versao, setor_funcional_id, tipo_atendimento, padrao, excluido_em FROM local_estoque_setor WHERE local_estoque_id = ? FOR UPDATE',
    [id],
  );
  for (const r of setores)
    if (r['excluido_em'] === null && !e.setores.some((s) => s.setor === n(r['setor_funcional_id'])))
      await tx.excluir('local_estoque_setor', n(r['id']), n(r['versao']));
  for (const s of e.setores) {
    const r = setores.find((x) => n(x['setor_funcional_id']) === s.setor);
    const v = { tipo_atendimento: s.tipo, padrao: s.padrao ?? false };
    if (!r)
      await tx.incluir('local_estoque_setor', { local_estoque_id: id, setor_funcional_id: s.setor, ...v });
    else if (
      t(r['tipo_atendimento']) !== v.tipo_atendimento ||
      b(r['padrao']) !== v.padrao ||
      r['excluido_em'] !== null
    )
      await tx.alterar('local_estoque_setor', n(r['id']), n(r['versao']), {
        ...v,
        excluido_em: null,
        excluido_por: null,
      });
  }
  const chave = (g: unknown, s: unknown, i: unknown) => `${nn(g) ?? ''}|${nn(s) ?? ''}|${nn(i) ?? ''}`;
  const cls = await tx.consultar<Linha>(
    'SELECT id, versao, grupo_insumo_id, subgrupo_insumo_id, insumo_id, excluido_em FROM local_estoque_classificacao WHERE local_estoque_id = ? FOR UPDATE',
    [id],
  );
  const novas = e.classificacoes.map((c) => chave(c.grupo, c.subgrupo, c.item));
  for (const r of cls)
    if (
      r['excluido_em'] === null &&
      !novas.includes(chave(r['grupo_insumo_id'], r['subgrupo_insumo_id'], r['insumo_id']))
    )
      await tx.excluir('local_estoque_classificacao', n(r['id']), n(r['versao']));
  for (const c of e.classificacoes) {
    const r = cls.find(
      (x) =>
        chave(x['grupo_insumo_id'], x['subgrupo_insumo_id'], x['insumo_id']) ===
        chave(c.grupo, c.subgrupo, c.item),
    );
    if (!r)
      await tx.incluir('local_estoque_classificacao', {
        local_estoque_id: id,
        grupo_insumo_id: c.grupo ?? null,
        subgrupo_insumo_id: c.subgrupo ?? null,
        insumo_id: c.item ?? null,
      });
    else if (r['excluido_em'] !== null)
      await tx.alterar('local_estoque_classificacao', n(r['id']), n(r['versao']), {
        excluido_em: null,
        excluido_por: null,
      });
  }
}

async function hojeDe(l: Leitor): Promise<string> {
  const r = await l.uma<Linha>('SELECT CURRENT_DATE() AS d', []);
  return dataIso(r?.['d']);
}

const opcoes = (rs: readonly Linha[]): Opcao[] =>
  rs.map((r) => ({
    id: n(r['id']),
    codigo: t(r['codigo']),
    nome: t(r['nome']),
    ...(r['grupo'] !== undefined ? { grupo: n(r['grupo']) } : {}),
  }));

export class PortaCadastroEstoquePropria implements PortaCadastroEstoque {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastroEstoque,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private est(c: ContextoPortaM18): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private contexto(c: ContextoPortaM18, est: number): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: c.correlacao || 'cadastro-estoque',
    };
  }

  private ler<T>(c: ContextoPortaM18, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.contexto(c, est), (l) => fn(l, est));
  }

  /** Uma operação do executor: a trilha leva a tabela e o id do alvo e o resumo do que mudou. */
  private async gravar<T extends { id: number }>(
    c: ContextoPortaM18,
    nome: string,
    tabela: string,
    resumo: Record<string, unknown>,
    fn: (tx: TxOperacao, est: number) => Promise<T>,
  ): Promise<T> {
    const est = this.est(c);
    let saida: T | null = null;
    const op = definirOperacao({
      nome: `suprimentos.cadastro.${nome}`,
      tabelas: [...TABELAS_CADASTRO_ESTOQUE],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = await fn(tx, est);
        return {} as ResultadoOperacao;
      },
      alvo: () => ({ tabela, id: saida ? (saida as T).id : null }),
      trilha: () => ({ dados: resumo, motivo: (resumo['motivo'] as string | undefined) ?? null }),
    });
    const chave = `cadastro-estoque:${randomUUID()}`;
    const ctx: ContextoOperacao = { ...this.contexto(c, est), chaveIdempotencia: chave };
    await this.executor.executar(op, c.cliente, { chave }, ctx);
    if (!saida) throw new Error('Gravação do cadastro do estoque sem resultado.');
    return saida;
  }

  apoio(c: ContextoPortaM18): Promise<ApoioCadastroEstoque> {
    return this.ler(c, async (l, est) => ({
      hoje: await hojeDe(l),
      grupos: opcoes(
        await l.consultar(
          'SELECT id, codigo, descricao AS nome FROM grupo_insumo WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY descricao',
          [],
          { teto: 2000 },
        ),
      ),
      subgrupos: opcoes(
        await l.consultar(
          'SELECT id, codigo, descricao AS nome, grupo_insumo_id AS grupo FROM subgrupo_insumo WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY descricao',
          [],
          { teto: 5000 },
        ),
      ),
      unidades: opcoes(
        await l.consultar(
          'SELECT id, sigla AS codigo, descricao AS nome FROM unidade_medida WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY sigla',
          [],
          { teto: 2000 },
        ),
      ),
      vias: opcoes(
        await l.consultar(
          'SELECT id, codigo, descricao AS nome FROM via_de_uso WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY descricao',
          [],
          { teto: 500 },
        ),
      ),
      setores: opcoes(
        await l.consultar(
          'SELECT id, codigo, nome FROM setor_funcional WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome',
          [est],
          { teto: 2000 },
        ),
      ),
      centrosCusto: opcoes(
        await l.consultar(
          'SELECT id, codigo, nome FROM centro_custo WHERE estabelecimento_id = ? AND ativo = TRUE AND analitico = TRUE AND excluido_em IS NULL ORDER BY nome',
          [est],
          { teto: 5000 },
        ),
      ),
      locais: opcoes(
        await l.consultar(
          'SELECT id, codigo, nome FROM local_estoque WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome',
          [est],
          { teto: 2000 },
        ),
      ),
    }));
  }

  buscar(
    c: ContextoPortaM18,
    tipo: 'principios' | 'fabricantes' | 'usuarios',
    termo: string,
  ): Promise<Opcao[]> {
    const like = `%${termo.replace(/[%_\\]/g, (x) => `\\${x}`)}%`;
    const sql = {
      principios:
        'SELECT id, CAST(id AS CHAR) AS codigo, descricao AS nome FROM principio_ativo WHERE ativo = TRUE AND excluido_em IS NULL AND descricao LIKE ? ORDER BY descricao LIMIT 30',
      fabricantes:
        "SELECT id, COALESCE(cnpj, '') AS codigo, nome FROM fabricante WHERE ativo = TRUE AND excluido_em IS NULL AND nome LIKE ? ORDER BY nome LIMIT 30",
      usuarios:
        "SELECT id, login AS codigo, nome FROM usuario WHERE situacao = 'ativo' AND excluido_em IS NULL AND (login LIKE ? OR nome LIKE ?) ORDER BY nome LIMIT 30",
    }[tipo];
    return this.ler(c, async (l) =>
      opcoes(await l.consultar(sql, tipo === 'usuarios' ? [like, like] : [like])),
    );
  }

  fichaItem(c: ContextoPortaM18, id: number): Promise<FichaItemEdicao | null> {
    return this.ler(c, async (l) => {
      const r = await l.uma<Linha>('SELECT * FROM insumo WHERE id = ? AND excluido_em IS NULL', [id]);
      if (!r) return null;
      const hoje = await hojeDe(l);
      const pas = await l.consultar<Linha>(
        'SELECT ip.*, pa.descricao FROM insumo_principio_ativo ip JOIN principio_ativo pa ON pa.id = ip.principio_ativo_id WHERE ip.insumo_id = ? AND ip.excluido_em IS NULL ORDER BY ip.principal DESC, ip.id',
        [id],
      );
      const vias = await l.consultar<Linha>(
        'SELECT * FROM insumo_via WHERE insumo_id = ? AND excluido_em IS NULL ORDER BY padrao DESC, id',
        [id],
      );
      const cbs = await l.consultar<Linha>(
        'SELECT * FROM insumo_codigo_barras WHERE insumo_id = ? AND excluido_em IS NULL ORDER BY sequencia',
        [id],
      );
      const aps = await l.consultar<Linha>(
        `SELECT ac.*, f.nome AS fabricante_nome,
                (SELECT rs.numero_registro FROM registro_sanitario rs WHERE rs.apresentacao_comercial_id = ac.id AND rs.excluido_em IS NULL ORDER BY rs.sequencia DESC LIMIT 1) AS rs_numero,
                (SELECT rs.situacao FROM registro_sanitario rs WHERE rs.apresentacao_comercial_id = ac.id AND rs.excluido_em IS NULL ORDER BY rs.sequencia DESC LIMIT 1) AS rs_situacao,
                (SELECT rs.data_validade FROM registro_sanitario rs WHERE rs.apresentacao_comercial_id = ac.id AND rs.excluido_em IS NULL ORDER BY rs.sequencia DESC LIMIT 1) AS rs_validade
           FROM apresentacao_comercial ac LEFT JOIN fabricante f ON f.id = ac.fabricante_id
          WHERE ac.insumo_id = ? AND ac.ativo = TRUE AND ac.excluido_em IS NULL ORDER BY ac.id`,
        [id],
      );
      const ests = await l.consultar<Linha>(
        'SELECT * FROM estabilidade_insumo WHERE insumo_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY id',
        [id],
      );
      const fab = r['fabricante_id']
        ? await l.uma<Linha>('SELECT nome FROM fabricante WHERE id = ?', [r['fabricante_id']])
        : null;
      const registro = (a: Linha) => {
        const numero = t(a['rs_numero']) || t(a['registro_anvisa']);
        if (!numero) return null;
        return {
          numero,
          validade: dataIso(a['rs_validade'] ?? a['registro_anvisa_validade']) || null,
          situacao: (t(a['rs_situacao']) || 'valido') as 'valido',
        };
      };
      return {
        id,
        versao: n(r['versao']),
        situacao: t(r['situacao']) as FichaItemEdicao['situacao'],
        saldoTotal: await saldoDoItem(l, id),
        codigo: t(r['codigo']),
        nome: t(r['nome']),
        nomeResumido: nulo(t(r['nome_resumido'])),
        tipo: t(r['tipo']) as ItemEstoqueEntrada['tipo'],
        grupo: n(r['grupo_insumo_id']),
        subgrupo: nn(r['subgrupo_insumo_id']),
        unidadeEstoque: n(r['estoque_unidade_medida_id']),
        unidadeCompra: nn(r['compra_unidade_medida_id']),
        fatorCompraEstoque: n(r['fator_compra_estoque']),
        unidadeConsumo: nn(r['consumo_unidade_medida_id']),
        fatorEstoqueConsumo: n(r['fator_estoque_consumo']),
        unidadePrescricao: nn(r['prescricao_unidade_medida_id']),
        fatorConsumoPrescricao: n(r['fator_consumo_prescricao']),
        fabricante: nn(r['fabricante_id']),
        gtin: nulo(t(r['codigo_gtin'])),
        ncm: nulo(t(r['codigo_ncm'])),
        cest: nulo(t(r['codigo_cest'])),
        classeRisco: (nulo(t(r['classe_risco'])) as ItemEstoqueEntrada['classeRisco']) ?? null,
        controlaLote: b(r['controla_lote']),
        controlaValidade: b(r['controla_validade']),
        controlado: b(r['controlado']),
        antimicrobiano: b(r['antimicrobiano']),
        altaVigilancia: b(r['alta_vigilancia']),
        fracionavel: b(r['fracionavel']),
        prescritivel: b(r['prescritivel']),
        estoqueMinimo: nn(r['estoque_minimo']),
        estoqueMaximo: nn(r['estoque_maximo']),
        principiosAtivos: pas.map((p) => ({
          principio: n(p['principio_ativo_id']),
          concentracao: nn(p['concentracao']),
          unidade: nn(p['concentracao_unidade_medida_id']),
          principal: b(p['principal']),
        })),
        vias: vias.map((v) => ({ via: n(v['via_de_uso_id']), padrao: b(v['padrao']) })),
        codigosBarras: cbs.map((x) => ({
          codigo: t(x['codigo_barras']),
          padrao: t(x['padrao']) as 'gtin',
          quantidade: n(x['quantidade_representada']),
          unidade: n(x['unidade_medida_id']),
          principal: b(x['principal']),
        })),
        apresentacoes: aps.map((a) => ({
          nomeComercial: t(a['nome_comercial']),
          apresentacao: nulo(t(a['apresentacao'])),
          fabricante: nn(a['fabricante_id']),
          quantidadeEmbalagem: n(a['quantidade_embalagem']),
          registro: registro(a),
        })),
        registrosNaData: aps.map((a) => {
          const g = registro(a);
          return g ? situacaoRegistroNaData(g.situacao, g.validade, hoje) : null;
        }),
        estabilidades: ests.map((s) => ({
          condicao: t(s['condicao']) as 'aberto',
          horas: n(s['horas_estabilidade']),
          horasInfusaoMaxima: nn(s['horas_infusao_maxima']),
          condicaoArmazenamento: nn(s['condicao_armazenamento_id']),
          diluente: nn(s['diluente_insumo_id']),
        })),
        nomesPrincipios: Object.fromEntries(pas.map((p) => [n(p['principio_ativo_id']), t(p['descricao'])])),
        nomesFabricantes: Object.fromEntries([
          ...(fab ? [[n(r['fabricante_id']), t(fab['nome'])]] : []),
          ...aps
            .filter((a) => a['fabricante_id'])
            .map((a) => [n(a['fabricante_id']), t(a['fabricante_nome'])]),
        ]),
      };
    });
  }

  incluirItem(c: ContextoPortaM18, e: ItemEstoqueEntrada) {
    recusarTodas(conferirItemEstoque(e));
    return this.gravar(c, 'incluirItem', 'insumo', { codigo: e.codigo, tipo: e.tipo }, async (tx) => {
      if (await tx.uma('SELECT id FROM insumo WHERE codigo = ?', [e.codigo.trim()]))
        throw recusa('item-codigo-existente', `Já existe item com o código ${e.codigo.trim()}.`, {
          campos: ['codigo'],
        });
      await referenciasItem(tx, e);
      const id = await tx.incluir('insumo', { ...colunasItem(e), situacao: 'ativo' });
      await this.codigosLivres(tx, id, e);
      await gravarFilhosItem(tx, id, e);
      return { id, versao: 1 };
    });
  }

  alterarItem(c: ContextoPortaM18, id: number, versao: number, e: ItemEstoqueEntrada) {
    recusarTodas(conferirItemEstoque(e));
    return this.gravar(c, 'alterarItem', 'insumo', { codigo: e.codigo, tipo: e.tipo }, async (tx) => {
      const atual = await tx.uma<Linha>(
        'SELECT * FROM insumo WHERE id = ? AND excluido_em IS NULL FOR UPDATE',
        [id],
      );
      if (!atual) throw recusa('item-inexistente', 'Item inexistente.', { campos: ['id'] });
      recusarTodas(
        conferirAlteracaoItem(
          {
            tipo: t(atual['tipo']) as ItemEstoqueEntrada['tipo'],
            unidadeEstoque: n(atual['estoque_unidade_medida_id']),
            unidadeCompra: nn(atual['compra_unidade_medida_id']),
            fatorCompraEstoque: n(atual['fator_compra_estoque']),
            unidadeConsumo: nn(atual['consumo_unidade_medida_id']),
            fatorEstoqueConsumo: n(atual['fator_estoque_consumo']),
            unidadePrescricao: nn(atual['prescricao_unidade_medida_id']),
            fatorConsumoPrescricao: n(atual['fator_consumo_prescricao']),
            controlaLote: b(atual['controla_lote']),
            controlaValidade: b(atual['controla_validade']),
          },
          e,
          await usoDoItem(tx, id),
        ),
      );
      if (await tx.uma('SELECT id FROM insumo WHERE codigo = ? AND id <> ?', [e.codigo.trim(), id]))
        throw recusa('item-codigo-existente', `Já existe item com o código ${e.codigo.trim()}.`, {
          campos: ['codigo'],
        });
      await referenciasItem(tx, e);
      await this.codigosLivres(tx, id, e);
      const nova = await tx.alterar('insumo', id, versao, colunasItem(e));
      await gravarFilhosItem(tx, id, e);
      return { id, versao: nova };
    });
  }

  /** O código de barras é único na base inteira: o de outro item é recusado com o campo. */
  private async codigosLivres(tx: TxOperacao, id: number, e: ItemEstoqueEntrada): Promise<void> {
    if (!e.codigosBarras.length) return;
    const outros = await tx.consultar<Linha>(
      `SELECT codigo_barras FROM insumo_codigo_barras WHERE insumo_id <> ? AND codigo_barras IN (${e.codigosBarras.map(() => '?').join(', ')})`,
      [id, ...e.codigosBarras.map((x) => x.codigo)],
    );
    if (outros.length)
      throw recusa(
        'codigo-barras-de-outro-item',
        `O código ${t(outros[0]!['codigo_barras'])} já é de outro item.`,
        { campos: ['codigosBarras'] },
      );
  }

  situacaoItem(c: ContextoPortaM18, id: number, versao: number, ativo: boolean, motivo: string) {
    return this.gravar(
      c,
      ativo ? 'reativarItem' : 'inativarItem',
      'insumo',
      { ativo, motivo },
      async (tx) => {
        if (!ativo)
          recusarUma(
            conferirInativacaoItem({
              motivo,
              saldoTotal: await saldoDoItem(tx, id),
              ...(await pendenciasDoItem(tx, id)),
            }),
          );
        else if (motivo.trim().length < 5)
          throw recusa('reativar-sem-motivo', 'Informe o motivo da reativação.', { campos: ['motivo'] });
        const nova = await tx.alterar('insumo', id, versao, { situacao: ativo ? 'ativo' : 'inativo' });
        return { id, versao: nova };
      },
    );
  }

  locais(c: ContextoPortaM18): Promise<LocalResumo[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar<Linha>(
          `SELECT le.id, le.codigo, le.nome, le.tipo, le.ativo, le.versao,
                  (SELECT COUNT(*) FROM local_estoque_usuario u WHERE u.local_estoque_id = le.id AND u.excluido_em IS NULL) AS usuarios
             FROM local_estoque le WHERE le.estabelecimento_id = ? AND le.excluido_em IS NULL ORDER BY le.ativo DESC, le.nome`,
          [est],
          { teto: 2000 },
        )
      ).map((r) => ({
        id: n(r['id']),
        codigo: t(r['codigo']),
        nome: t(r['nome']),
        tipo: t(r['tipo']),
        ativo: b(r['ativo']),
        versao: n(r['versao']),
        usuarios: n(r['usuarios']),
      })),
    );
  }

  fichaLocal(c: ContextoPortaM18, id: number): Promise<FichaLocalEdicao | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(
        'SELECT * FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est],
      );
      if (!r) return null;
      const setores = await l.consultar<Linha>(
        'SELECT setor_funcional_id, tipo_atendimento, padrao FROM local_estoque_setor WHERE local_estoque_id = ? AND excluido_em IS NULL ORDER BY id',
        [id],
      );
      const cls = await l.consultar<Linha>(
        'SELECT grupo_insumo_id, subgrupo_insumo_id, insumo_id FROM local_estoque_classificacao WHERE local_estoque_id = ? AND excluido_em IS NULL ORDER BY id',
        [id],
      );
      return {
        id,
        versao: n(r['versao']),
        ativo: b(r['ativo']),
        codigo: t(r['codigo']),
        nome: t(r['nome']),
        tipo: t(r['tipo']) as LocalEstoqueEntrada['tipo'],
        setor: nn(r['setor_funcional_id']),
        centroCusto: nn(r['centro_custo_id']),
        localOrigem: nn(r['origem_local_estoque_id']),
        localDevolucao: nn(r['devolucao_local_estoque_id']),
        atendeSetor: b(r['atende_solicitacao_setor']),
        atendePaciente: b(r['atende_solicitacao_paciente']),
        atendeTransferencia: b(r['atende_transferencia']),
        atendimentoParcial: b(r['permite_atendimento_parcial']),
        verificaSaldo: b(r['verifica_saldo']),
        usaCodigoBarras: b(r['usa_codigo_barras']),
        apenasUrgente: b(r['apenas_urgente']),
        tipoReposicao: (nulo(t(r['tipo_reposicao'])) as LocalEstoqueEntrada['tipoReposicao']) ?? null,
        horasAntecedencia: nn(r['horas_antecedencia_atendimento']),
        setores: setores.map((s) => ({
          setor: n(s['setor_funcional_id']),
          tipo: t(s['tipo_atendimento']) as 'ambos',
          padrao: b(s['padrao']),
        })),
        classificacoes: cls.map((x) => ({
          grupo: nn(x['grupo_insumo_id']),
          subgrupo: nn(x['subgrupo_insumo_id']),
          item: nn(x['insumo_id']),
        })),
      };
    });
  }

  incluirLocal(c: ContextoPortaM18, e: LocalEstoqueEntrada) {
    recusarTodas(conferirLocalEstoque(e));
    return this.gravar(
      c,
      'incluirLocal',
      'local_estoque',
      { codigo: e.codigo, tipo: e.tipo },
      async (tx, est) => {
        if (
          await tx.uma('SELECT id FROM local_estoque WHERE estabelecimento_id = ? AND codigo = ?', [
            est,
            e.codigo.trim(),
          ])
        )
          throw recusa('local-codigo-existente', `Já existe local com o código ${e.codigo.trim()}.`, {
            campos: ['codigo'],
          });
        await referenciasLocal(tx, est, e);
        const id = await tx.incluir('local_estoque', { estabelecimento_id: est, ...colunasLocal(e) });
        await gravarFilhosLocal(tx, id, e);
        return { id, versao: 1 };
      },
    );
  }

  alterarLocal(c: ContextoPortaM18, id: number, versao: number, e: LocalEstoqueEntrada) {
    recusarTodas(conferirLocalEstoque(e, id));
    return this.gravar(
      c,
      'alterarLocal',
      'local_estoque',
      { codigo: e.codigo, tipo: e.tipo },
      async (tx, est) => {
        if (
          !(await tx.uma(
            'SELECT id FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL FOR UPDATE',
            [id, est],
          ))
        )
          throw recusa('local-inexistente', 'O local de estoque não existe neste estabelecimento.', {
            campos: ['id'],
          });
        if (
          await tx.uma(
            'SELECT id FROM local_estoque WHERE estabelecimento_id = ? AND codigo = ? AND id <> ?',
            [est, e.codigo.trim(), id],
          )
        )
          throw recusa('local-codigo-existente', `Já existe local com o código ${e.codigo.trim()}.`, {
            campos: ['codigo'],
          });
        await referenciasLocal(tx, est, e);
        const nova = await tx.alterar('local_estoque', id, versao, colunasLocal(e));
        await gravarFilhosLocal(tx, id, e);
        return { id, versao: nova };
      },
    );
  }

  situacaoLocal(c: ContextoPortaM18, id: number, versao: number, ativo: boolean, motivo: string) {
    return this.gravar(
      c,
      ativo ? 'reativarLocal' : 'inativarLocal',
      'local_estoque',
      { ativo, motivo },
      async (tx, est) => {
        if (
          !(await tx.uma(
            'SELECT id FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [id, est],
          ))
        )
          throw recusa('local-inexistente', 'O local de estoque não existe neste estabelecimento.', {
            campos: ['id'],
          });
        if (!ativo) {
          const s = await tx.uma<Linha>(
            'SELECT COALESCE(SUM(quantidade), 0) AS q FROM saldo_estoque WHERE local_estoque_id = ? AND excluido_em IS NULL',
            [id],
          );
          const rq = await tx.uma<Linha>(
            `SELECT COUNT(*) AS q FROM requisicao_material WHERE atendente_local_estoque_id = ? AND excluido_em IS NULL
              AND situacao IN ('solicitada','autorizada','em_separacao','atendida_parcial')`,
            [id],
          );
          recusarUma(
            conferirInativacaoLocal({ motivo, saldoTotal: n(s?.['q']), requisicoesAbertas: n(rq?.['q']) }),
          );
        } else if (motivo.trim().length < 5)
          throw recusa('reativar-sem-motivo', 'Informe o motivo da reativação.', { campos: ['motivo'] });
        const nova = await tx.alterar('local_estoque', id, versao, { ativo });
        return { id, versao: nova };
      },
    );
  }

  escopoUsuario(c: ContextoPortaM18, usuario: number): Promise<EscopoCompletoUsuario | null> {
    return this.ler(c, async (l, est) => {
      const u = await l.uma<Linha>(
        'SELECT id, login, nome FROM usuario WHERE id = ? AND excluido_em IS NULL',
        [usuario],
      );
      if (!u) return null;
      const hoje = await hojeDe(l);
      const locais = await l.consultar<Linha>(
        `SELECT u.*, le.codigo, le.nome FROM local_estoque_usuario u JOIN local_estoque le ON le.id = u.local_estoque_id
          WHERE u.usuario_id = ? AND le.estabelecimento_id = ? AND u.excluido_em IS NULL ORDER BY le.nome`,
        [usuario, est],
      );
      const cls = await l.consultar<Linha>(
        `SELECT c.*, g.descricao AS g_nome, s.descricao AS s_nome FROM usuario_estoque_classificacao c
           JOIN grupo_insumo g ON g.id = c.grupo_insumo_id LEFT JOIN subgrupo_insumo s ON s.id = c.subgrupo_insumo_id
          WHERE c.usuario_id = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL ORDER BY c.vigencia_inicio DESC, c.id DESC`,
        [usuario, est],
      );
      const ccs = await l.consultar<Linha>(
        `SELECT c.*, cc.nome AS cc_nome FROM usuario_estoque_centro_custo c JOIN centro_custo cc ON cc.id = c.centro_custo_id
          WHERE c.usuario_id = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL ORDER BY c.vigencia_inicio DESC, c.id DESC`,
        [usuario, est],
      );
      const vigente = (r: Linha) =>
        dataIso(r['vigencia_inicio']) <= hoje && (!r['vigencia_fim'] || dataIso(r['vigencia_fim']) >= hoje);
      return {
        usuario,
        login: t(u['login']),
        nome: t(u['nome']),
        locais: locais.map((r) => ({
          local: n(r['local_estoque_id']),
          codigo: t(r['codigo']),
          nome: t(r['nome']),
          permissoes: PERMISSOES_LOCAL_USUARIO.filter((p) => b(r[COLUNA_PERMISSAO[p]])),
          variacaoValorPct: nn(r['variacao_valor_unitario_pct']),
          padrao: b(r['padrao']),
        })),
        classificacoes: cls.map((r): ConcessaoVigente => ({
          id: n(r['id']),
          alvo: n(r['grupo_insumo_id']),
          alvo2: nn(r['subgrupo_insumo_id']),
          nome: r['s_nome'] ? `${t(r['g_nome'])} › ${t(r['s_nome'])}` : t(r['g_nome']),
          inicio: dataIso(r['vigencia_inicio']),
          fim: dataIso(r['vigencia_fim']) || null,
          permissoes: [
            ...(b(r['permite_requisitar']) ? ['requisitar'] : []),
            ...(b(r['permite_movimentar']) ? ['movimentar'] : []),
            ...(b(r['permite_comprar']) ? ['comprar'] : []),
          ],
          vigente: vigente(r),
        })),
        centrosCusto: ccs.map((r): ConcessaoVigente => ({
          id: n(r['id']),
          alvo: n(r['centro_custo_id']),
          alvo2: null,
          nome: t(r['cc_nome']),
          inicio: dataIso(r['vigencia_inicio']),
          fim: dataIso(r['vigencia_fim']) || null,
          permissoes: [
            ...(b(r['permite_requisitar']) ? ['requisitar'] : []),
            ...(b(r['permite_saida']) ? ['movimentar'] : []),
          ],
          vigente: vigente(r),
        })),
      };
    });
  }

  private async usuarioELocal(tx: TxOperacao, est: number, usuario: number, local: number | null) {
    if (!(await tx.uma('SELECT id FROM usuario WHERE id = ? AND excluido_em IS NULL', [usuario])))
      throw recusa('usuario-inexistente', 'Usuário inexistente.', { campos: ['usuario'] });
    if (
      local !== null &&
      !(await tx.uma(
        'SELECT id FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [local, est],
      ))
    )
      throw recusa('local-inexistente', 'O local de estoque não existe neste estabelecimento.', {
        campos: ['local'],
      });
  }

  gravarEscopoLocal(
    c: ContextoPortaM18,
    usuario: number,
    local: number,
    e: { permissoes: PermissaoLocalUsuario[]; variacaoValorPct?: number | null; padrao?: boolean },
  ) {
    recusarUma(conferirEscopoLocal(e));
    return this.gravar(
      c,
      'escopoLocal',
      'local_estoque_usuario',
      { usuario, local, permissoes: e.permissoes },
      async (tx, est) => {
        await this.usuarioELocal(tx, est, usuario, local);
        const valores: Record<string, unknown> = Object.fromEntries(
          PERMISSOES_LOCAL_USUARIO.map((p) => [COLUNA_PERMISSAO[p], e.permissoes.includes(p)]),
        );
        valores['variacao_valor_unitario_pct'] = e.variacaoValorPct ?? null;
        valores['padrao'] = e.padrao ?? false;
        if (e.padrao)
          await tx.executar(
            `UPDATE local_estoque_usuario SET padrao = FALSE, versao = versao + 1 WHERE usuario_id = ? AND padrao = TRUE AND local_estoque_id <> ?
              AND local_estoque_id IN (SELECT id FROM local_estoque WHERE estabelecimento_id = ?)`,
            [usuario, local, est],
          );
        const r = await tx.uma<Linha>(
          'SELECT id, versao FROM local_estoque_usuario WHERE local_estoque_id = ? AND usuario_id = ? FOR UPDATE',
          [local, usuario],
        );
        if (!r)
          return {
            id: await tx.incluir('local_estoque_usuario', {
              local_estoque_id: local,
              usuario_id: usuario,
              ...valores,
            }),
          };
        await tx.alterar('local_estoque_usuario', n(r['id']), n(r['versao']), {
          ...valores,
          excluido_em: null,
          excluido_por: null,
        });
        return { id: n(r['id']) };
      },
    );
  }

  retirarEscopoLocal(c: ContextoPortaM18, usuario: number, local: number) {
    return this.gravar(
      c,
      'retirarEscopoLocal',
      'local_estoque_usuario',
      { usuario, local },
      async (tx, est) => {
        await this.usuarioELocal(tx, est, usuario, local);
        const r = await tx.uma<Linha>(
          'SELECT id, versao FROM local_estoque_usuario WHERE local_estoque_id = ? AND usuario_id = ? AND excluido_em IS NULL FOR UPDATE',
          [local, usuario],
        );
        if (!r) throw recusa('escopo-inexistente', 'O usuário não tem este local.', { campos: ['local'] });
        await tx.alterar('local_estoque_usuario', n(r['id']), n(r['versao']), {
          ...Object.fromEntries(PERMISSOES_LOCAL_USUARIO.map((p) => [COLUNA_PERMISSAO[p], false])),
          padrao: false,
          excluido_em: new Date(),
          excluido_por: tx.contexto.usuario,
        });
        return { id: n(r['id']) };
      },
    );
  }

  concederClassificacao(
    c: ContextoPortaM18,
    usuario: number,
    e: ConcessaoEntrada & { grupo: number; subgrupo?: number | null },
  ) {
    const perms = [
      ...(e.requisitar ? ['requisitar'] : []),
      ...(e.movimentar ? ['movimentar'] : []),
      ...(e.comprar ? ['comprar'] : []),
    ];
    recusarUma(conferirConcessaoVigente({ inicio: e.inicio, fim: e.fim ?? null, permissoes: perms }));
    return this.gravar(
      c,
      'concederClassificacao',
      'usuario_estoque_classificacao',
      { usuario, grupo: e.grupo, subgrupo: e.subgrupo ?? null },
      async (tx, est) => {
        await this.usuarioELocal(tx, est, usuario, null);
        if (!(await tx.uma('SELECT id FROM grupo_insumo WHERE id = ? AND ativo = TRUE', [e.grupo])))
          throw recusa('referencia-inexistente', 'Grupo inexistente ou inativo.', { campos: ['grupo'] });
        if (
          e.subgrupo &&
          !(await tx.uma('SELECT id FROM subgrupo_insumo WHERE id = ? AND grupo_insumo_id = ?', [
            e.subgrupo,
            e.grupo,
          ]))
        )
          throw recusa('subgrupo-fora-do-grupo', 'O subgrupo não pertence ao grupo escolhido.', {
            campos: ['subgrupo'],
          });
        const sobrepoe = await tx.uma(
          `SELECT id FROM usuario_estoque_classificacao WHERE estabelecimento_id = ? AND usuario_id = ? AND grupo_insumo_id = ?
            AND COALESCE(subgrupo_insumo_id, 0) = ? AND excluido_em IS NULL
            AND (vigencia_fim IS NULL OR vigencia_fim >= ?) AND (? IS NULL OR vigencia_inicio <= ?)`,
          [est, usuario, e.grupo, e.subgrupo ?? 0, e.inicio, e.fim ?? null, e.fim ?? null],
        );
        if (sobrepoe)
          throw recusa(
            'concessao-sobreposta',
            'Já há concessão vigente desta classificação no período: retire-a antes.',
            { campos: ['inicio'] },
          );
        const id = await incluirConcessao(
          tx,
          'usuario_estoque_classificacao',
          'estabelecimento_id = ? AND usuario_id = ? AND grupo_insumo_id = ? AND COALESCE(subgrupo_insumo_id, 0) = ?',
          [est, usuario, e.grupo, e.subgrupo ?? 0],
          e.inicio,
          {
            estabelecimento_id: est,
            usuario_id: usuario,
            grupo_insumo_id: e.grupo,
            subgrupo_insumo_id: e.subgrupo ?? null,
            permite_requisitar: e.requisitar,
            permite_movimentar: e.movimentar,
            permite_comprar: e.comprar ?? false,
            vigencia_inicio: e.inicio,
            vigencia_fim: e.fim ?? null,
          },
        );
        return { id };
      },
    );
  }

  concederCentroCusto(c: ContextoPortaM18, usuario: number, e: ConcessaoEntrada & { centroCusto: number }) {
    const perms = [...(e.requisitar ? ['requisitar'] : []), ...(e.movimentar ? ['movimentar'] : [])];
    recusarUma(conferirConcessaoVigente({ inicio: e.inicio, fim: e.fim ?? null, permissoes: perms }));
    return this.gravar(
      c,
      'concederCentroCusto',
      'usuario_estoque_centro_custo',
      { usuario, centroCusto: e.centroCusto },
      async (tx, est) => {
        await this.usuarioELocal(tx, est, usuario, null);
        if (
          !(await tx.uma(
            'SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL',
            [e.centroCusto, est],
          ))
        )
          throw recusa('referencia-inexistente', 'Centro de custo inexistente neste estabelecimento.', {
            campos: ['centroCusto'],
          });
        const sobrepoe = await tx.uma(
          `SELECT id FROM usuario_estoque_centro_custo WHERE usuario_id = ? AND centro_custo_id = ? AND excluido_em IS NULL
            AND (vigencia_fim IS NULL OR vigencia_fim >= ?) AND (? IS NULL OR vigencia_inicio <= ?)`,
          [usuario, e.centroCusto, e.inicio, e.fim ?? null, e.fim ?? null],
        );
        if (sobrepoe)
          throw recusa(
            'concessao-sobreposta',
            'Já há concessão vigente deste centro de custo no período: retire-a antes.',
            { campos: ['inicio'] },
          );
        const id = await incluirConcessao(
          tx,
          'usuario_estoque_centro_custo',
          'usuario_id = ? AND centro_custo_id = ?',
          [usuario, e.centroCusto],
          e.inicio,
          {
            estabelecimento_id: est,
            usuario_id: usuario,
            centro_custo_id: e.centroCusto,
            permite_requisitar: e.requisitar,
            permite_saida: e.movimentar,
            vigencia_inicio: e.inicio,
            vigencia_fim: e.fim ?? null,
          },
        );
        return { id };
      },
    );
  }

  /**
   * Retirar a concessão: a que já valia é encerrada na véspera; a que começa hoje ou depois é cancelada (a linha fica
   * marcada como excluída, com o executor e o motivo na trilha). Nos dois casos deixa de valer na hora.
   */
  retirarConcessao(c: ContextoPortaM18, tipo: 'classificacao' | 'centro-custo', id: number, motivo = '') {
    const tabela =
      tipo === 'classificacao' ? 'usuario_estoque_classificacao' : 'usuario_estoque_centro_custo';
    return this.gravar(c, 'retirarConcessao', tabela, { tipo, id, motivo }, async (tx, est) => {
      const r = await tx.uma<Linha>(
        `SELECT id, versao, vigencia_inicio, vigencia_fim FROM ${tabela} WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL FOR UPDATE`,
        [id, est],
      );
      if (!r) throw recusa('concessao-inexistente', 'Concessão inexistente.', { campos: ['id'] });
      const hoje = await hojeDe(tx);
      const d = retiradaDaConcessao(
        {
          inicio: dataIso(r['vigencia_inicio']),
          fim: r['vigencia_fim'] ? dataIso(r['vigencia_fim']) : null,
          motivo,
        },
        hoje,
      );
      if (d.acao === 'recusar') recusarUma(d.recusa);
      if (d.acao === 'encerrar') {
        await tx.alterar(tabela, id, n(r['versao']), { vigencia_fim: d.fim });
        return { id, fim: d.fim as string | null, cancelada: false };
      }
      await tx.alterar(tabela, id, n(r['versao']), {
        excluido_em: new Date(),
        excluido_por: c.usuario,
      });
      return { id, fim: null as string | null, cancelada: true };
    });
  }

  separacao(c: ContextoPortaM18, requisicao: number): Promise<ListaSeparacao | null> {
    return this.ler(c, async (l, est) => {
      const rq = await l.uma<Linha>(
        `SELECT r.*, le.codigo AS local_codigo, le.nome AS local_nome, sf.nome AS setor_nome, cc.nome AS centro_nome, NOW(3) AS agora
           FROM requisicao_material r JOIN local_estoque le ON le.id = r.atendente_local_estoque_id
           LEFT JOIN setor_funcional sf ON sf.id = r.setor_funcional_id LEFT JOIN centro_custo cc ON cc.id = r.centro_custo_id
          WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`,
        [requisicao, est],
      );
      if (!rq) return null;
      recusarUma(conferirRequisicaoSeparavel(t(rq['situacao'])));
      const local = n(rq['atendente_local_estoque_id']);
      const itens = await l.consultar<Linha>(
        `SELECT ri.sequencia, ri.insumo_id, i.nome, i.controla_lote, um.sigla, ri.quantidade_solicitada, ri.quantidade_atendida, ri.quantidade_cancelada
           FROM requisicao_material_item ri JOIN insumo i ON i.id = ri.insumo_id JOIN unidade_medida um ON um.id = ri.unidade_medida_id
          WHERE ri.requisicao_material_id = ? AND ri.excluido_em IS NULL AND ri.situacao IN ('pendente','atendido_parcial') ORDER BY ri.sequencia`,
        [requisicao],
      );
      const ids = [...new Set(itens.map((x) => n(x['insumo_id'])))];
      const enderecos = new Map<number, { codigo: string; preferencial: boolean }[]>();
      const lotes = new Map<number, { lote: string; validade: string; quantidade: number }[]>();
      const saldos = new Map<number, number>();
      if (ids.length) {
        const ph = ids.map(() => '?').join(', ');
        for (const r of await l.consultar<Linha>(
          `SELECT ie.insumo_id, ea.codigo_completo, ie.preferencial FROM insumo_endereco ie JOIN endereco_armazem ea ON ea.id = ie.endereco_armazem_id
            WHERE ea.local_estoque_id = ? AND ea.ativo = TRUE AND ea.excluido_em IS NULL AND ie.excluido_em IS NULL AND ie.insumo_id IN (${ph})`,
          [local, ...ids],
        ))
          enderecos.set(n(r['insumo_id']), [
            ...(enderecos.get(n(r['insumo_id'])) ?? []),
            { codigo: t(r['codigo_completo']), preferencial: b(r['preferencial']) },
          ]);
        for (const r of await l.consultar<Linha>(
          `SELECT li.insumo_id, li.numero_lote, li.validade, sl.quantidade FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id AND li.excluido_em IS NULL
              AND li.situacao = 'liberado'
            WHERE sl.local_estoque_id = ? AND sl.excluido_em IS NULL AND sl.quantidade > 0 AND sl.bloqueado = FALSE
              AND li.insumo_id IN (${ph})`,
          [local, ...ids],
        ))
          lotes.set(n(r['insumo_id']), [
            ...(lotes.get(n(r['insumo_id'])) ?? []),
            { lote: t(r['numero_lote']), validade: dataIso(r['validade']), quantidade: n(r['quantidade']) },
          ]);
        for (const r of await l.consultar<Linha>(
          `SELECT insumo_id, quantidade FROM saldo_estoque WHERE local_estoque_id = ? AND excluido_em IS NULL AND insumo_id IN (${ph})`,
          [local, ...ids],
        ))
          saldos.set(n(r['insumo_id']), n(r['quantidade']));
      }
      const geradaEm =
        rq['agora'] instanceof Date
          ? (rq['agora'] as Date).toISOString().slice(0, 19)
          : t(rq['agora']).replace(' ', 'T').slice(0, 19);
      const linhas = montarSeparacao(
        itens.map((x) => ({
          sequencia: n(x['sequencia']),
          item: n(x['insumo_id']),
          nome: t(x['nome']),
          unidade: t(x['sigla']),
          solicitada: n(x['quantidade_solicitada']),
          atendida: n(x['quantidade_atendida']),
          cancelada: n(x['quantidade_cancelada']),
          controlaLote: b(x['controla_lote']),
        })),
        enderecos,
        lotes,
        saldos,
        geradaEm.slice(0, 10),
      );
      return {
        requisicao,
        numero: n(rq['numero']),
        situacao: t(rq['situacao']),
        tipo: t(rq['tipo']),
        local: { id: local, codigo: t(rq['local_codigo']), nome: t(rq['local_nome']) },
        destino:
          t(rq['setor_nome']) ||
          t(rq['centro_nome']) ||
          (rq['atendimento_id'] ? `Atendimento ${n(rq['atendimento_id'])}` : ''),
        solicitadoEm:
          rq['solicitado_em'] instanceof Date
            ? (rq['solicitado_em'] as Date).toISOString().slice(0, 16)
            : t(rq['solicitado_em']).slice(0, 16),
        urgente: b(rq['urgente']),
        geradaEm,
        linhas,
        totalFalta: linhas.filter((x) => x.falta > 0).length,
      };
    });
  }
}
