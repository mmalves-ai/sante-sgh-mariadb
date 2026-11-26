// Regras puras do pós-fechamento (M31) no vocabulário do modelo do banco (sem banco nem I/O): a conta que entra no
// lote, o tipo de guia pela natureza da conta, as situações do protocolo, o grupo TISS do item, o estado da glosa do
// item e o desfecho do recurso. A porta própria as confere sob a transação; os testes ficam em regras-tiss.spec.ts.
// Melhoria: a conta pronta para o lote sai da situação do modelo (fechada, faturada, enviada, paga, cancelada) e da
// ligação com o lote, sem marcas de texto; o tipo de guia confere com a natureza da conta (internação ou não).
// Melhoria: a guia só leva o que está no cadastro (executante com conselho, número, UF e CBO; caráter; tipo, regime e
// motivo de saída da internação): sem o dado, o lote é recusado com o que falta, nunca com um valor padrão; a guia
// confere com a conta (itens e total) antes de montar; o protocolo cancelado do mesmo lote é reativado, não duplicado;
// a situação e o valor aceito da glosa saem das decisões dos itens.
import type { ContaTiss } from '@sgh/contratos';
import { ROTULO_TIPO_GUIA } from '@sgh/dominio-faturamento';

type NaturezaItemTiss = ContaTiss['itens'][number]['natureza'];

export interface RecusaTiss {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}
const recusaTiss = (codigo: string, mensagem: string, campos?: readonly string[]): RecusaTiss => ({
  codigo,
  mensagem,
  ...(campos ? { campos } : {}),
});

export type TipoGuiaLote = 1 | 2 | 3 | 4;

/** Tipo de guia da tela (1 a 4) → valor do modelo (lote_tiss.tipo_guia). */
export const TIPO_GUIA_NO_MODELO: Readonly<Record<TipoGuiaLote, string>> = {
  1: 'consulta',
  2: 'sp_sadt',
  3: 'resumo_internacao',
  4: 'honorario_individual',
};

/** Valor do modelo → tipo de guia da tela (8: recurso de glosa; 0: outro). */
export function tipoGuiaDoModelo(t: string): number {
  if (t === 'recurso_glosa') return 8;
  const e = Object.entries(TIPO_GUIA_NO_MODELO).find(([, v]) => v === t);
  return e ? Number(e[0]) : 0;
}

/** Tipos de guia que a natureza da conta admite: internação → resumo e honorário; as demais → consulta, SP/SADT e honorário. */
export function tiposGuiaDaNatureza(natureza: string): TipoGuiaLote[] {
  return natureza === 'internacao' ? [3, 4] : [1, 2, 4];
}

export interface ContaParaLoteModelo {
  readonly id: number;
  readonly convenio: number;
  readonly natureza: string;
  readonly situacao: string;
  readonly emLote: boolean;
  readonly competenciaFechada: boolean;
}

/** A conta entra no lote? (mesmo convênio, fechada, fora de outro lote, tipo de guia compatível, competência aberta.) */
export function conferirContaParaLoteModelo(
  c: ContaParaLoteModelo,
  lote: { readonly convenio: number; readonly tipoGuia: number },
): RecusaTiss | null {
  if (c.convenio !== lote.convenio)
    return recusaTiss('outro-convenio', `A conta ${c.id} é de outro convênio: um lote leva um convênio só.`);
  if (c.situacao === 'cancelada') return recusaTiss('conta-cancelada', `A conta ${c.id} está cancelada.`);
  if (c.emLote || ['faturada', 'enviada', 'paga'].includes(c.situacao))
    return recusaTiss('conta-em-lote', `A conta ${c.id} já está em outro lote.`);
  if (c.situacao !== 'fechada')
    return recusaTiss(
      'conta-aberta',
      `A conta ${c.id} não está fechada: feche a conta antes de montar o lote.`,
    );
  if (!tiposGuiaDaNatureza(c.natureza).includes(lote.tipoGuia as TipoGuiaLote))
    return recusaTiss(
      'tipo-guia-incompativel',
      `A conta ${c.id} (${c.natureza === 'internacao' ? 'internação' : 'externa'}) não vai em lote de ${ROTULO_TIPO_GUIA[lote.tipoGuia] ?? 'outro tipo'}.`,
    );
  if (c.competenciaFechada)
    return recusaTiss(
      'competencia-fechada',
      'A competência desta conta está fechada para o convênio: reabrir exige o supervisor e o motivo.',
    );
  return null;
}

/**
 * Situações do protocolo de recebimento com o número da terminologia TISS do status do protocolo (o mesmo padrão da
 * base em situacao_protocolo_recebimento, migração 12_FAT/99_situacao_protocolo_tiss). "Recusado" não existe na
 * terminologia: fica fora da lista (só o histórico antigo o tem).
 */
export const SITUACOES_PROTOCOLO: readonly {
  readonly id: number;
  readonly valor: string;
  readonly nome: string;
}[] = [
  { id: 1, valor: 'recebido', nome: 'Recebido' },
  { id: 2, valor: 'em_analise', nome: 'Em análise' },
  { id: 3, valor: 'liberado_pagamento', nome: 'Liberado para pagamento' },
  { id: 4, valor: 'encerrado', nome: 'Encerrado sem pagamento' },
  {
    id: 5,
    valor: 'analisado_aguardando_liberacao',
    nome: 'Analisado e aguardando liberação para o pagamento',
  },
  { id: 6, valor: 'pagamento_efetuado', nome: 'Pagamento efetuado' },
  { id: 7, valor: 'nao_localizado', nome: 'Não localizado' },
  { id: 8, valor: 'aguardando_informacao', nome: 'Aguardando informação complementar' },
  { id: 9, valor: 'cancelado', nome: 'Cancelado' },
  { id: 10, valor: 'bloqueio_judicial', nome: 'Bloqueio judicial do prestador' },
];
export const situacaoProtocoloDoNumero = (n: number | null): string | null =>
  n === null ? null : (SITUACOES_PROTOCOLO.find((s) => s.id === n)?.valor ?? null);
export const numeroDaSituacaoProtocolo = (v: string): number | null =>
  SITUACOES_PROTOCOLO.find((s) => s.valor === v)?.id ?? null;
export const nomeDaSituacaoProtocolo = (v: string): string =>
  SITUACOES_PROTOCOLO.find((s) => s.valor === v)?.nome ?? '';

/** Natureza TISS do item pelo tipo do item faturável. */
export function naturezaDoItem(tipoItem: string): NaturezaItemTiss {
  switch (tipoItem) {
    case 'diaria':
      return 'diaria';
    case 'taxa':
    case 'pacote':
      return 'taxa';
    case 'gas':
      return 'gas';
    case 'material':
      return 'material';
    case 'medicamento':
      return 'medicamento';
    case 'opme':
      return 'opme';
    default:
      return 'procedimento';
  }
}

/** Grupo do item na guia: 1 diárias, taxas e gases; 2 honorários; 3 procedimentos e serviços; 4 materiais e medicamentos. */
export function grupoTissDoItem(tipoItem: string): 1 | 2 | 3 | 4 {
  if (['diaria', 'taxa', 'gas', 'pacote'].includes(tipoItem)) return 1;
  if (tipoItem === 'honorario') return 2;
  if (['material', 'medicamento', 'opme'].includes(tipoItem)) return 4;
  return 3;
}

/** Tabela TISS de referência do item: 18 diárias e taxas, 19 materiais e OPME, 20 medicamentos, 22 procedimentos. */
export function tabelaTissDoItem(tipoItem: string): string {
  const g = grupoTissDoItem(tipoItem);
  if (g === 1) return '18';
  if (g === 4) return tipoItem === 'medicamento' ? '20' : '19';
  return '22';
}

export type EstadoItemGlosa =
  'pendente' | 'aceita' | 'recorrida' | 'encerrada' | 'sem-glosa' | 'nao-conciliado';

/** Estado da glosa do item: sem análise → não conciliado; sem valor glosado → sem glosa; depois, a decisão e o recurso. */
export function estadoDaGlosa(i: {
  readonly conciliado: boolean;
  readonly glosado: number;
  readonly decisao: string | null;
  readonly emRecurso: boolean;
  readonly retornado: boolean;
}): EstadoItemGlosa {
  if (!i.conciliado) return 'nao-conciliado';
  if (!(i.glosado > 0)) return 'sem-glosa';
  if (i.retornado) return 'encerrada';
  if (i.decisao === 'aceitar') return 'aceita';
  if (i.emRecurso || i.decisao === 'recorrer') return 'recorrida';
  return 'pendente';
}

/** Desfecho do recurso do item pelo que foi recuperado (só depois do retorno). */
export function desfechoDoRecurso(i: {
  readonly recursado: number;
  readonly recuperado: number;
  readonly retornado: boolean;
}): 'acatado' | 'parcial' | 'negado' | null {
  if (!i.retornado) return null;
  if (i.recursado > 0 && i.recuperado >= i.recursado - 0.005) return 'acatado';
  return i.recuperado > 0 ? 'parcial' : 'negado';
}

/** Situação da mensagem TISS → situação da fila de integração do modelo. */
export const SITUACAO_MENSAGEM_NO_MODELO: Readonly<Record<string, string>> = {
  enfileirada: 'pendente',
  enviada: 'enviada',
  aceita: 'processada',
  recusada: 'descartada',
  erro: 'erro',
};

/** Situação da conta do modelo → código da leitura agregada da competência (N aberta, S fechada, A apresentada). */
export function situacaoContaNaCompetencia(situacao: string): 'N' | 'S' | 'A' | 'outra' {
  if (['aberta', 'em_conferencia', 'em_auditoria'].includes(situacao)) return 'N';
  if (situacao === 'fechada') return 'S';
  if (['faturada', 'enviada', 'paga'].includes(situacao)) return 'A';
  return 'outra';
}

/** Primeiro dia da competência (AAAA-MM-01). */
export const diaDaCompetencia = (ano: number, mes: number): string =>
  `${ano}-${String(mes).padStart(2, '0')}-01`;

/** Dias corridos entre duas datas AAAA-MM-DD (negativo se `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

// ── Montagem da guia (gerar o lote) ─────────────────────────────────────────────────────────────────────

/** Profissional da guia nos códigos da TISS, como lido do cadastro (texto cru; a regra decide se basta). */
export interface ProfissionalLido {
  readonly conselho: string | null;
  readonly numero: string | null;
  readonly uf: string | null;
  readonly cbo: string | null;
  readonly nome: string | null;
  readonly codigoOperadora?: string | null;
}

export interface ExecutanteGuia {
  readonly profissional: ContaTiss['profissional'];
  readonly nome: string;
  readonly codigo: string;
}

const limpo = (v: string | null | undefined) => (v ?? '').trim();

/** O profissional basta para a guia: conselho (2 dígitos), número (sem zeros só), UF (2 dígitos), CBO e nome. */
export function executanteDaGuia(x: ProfissionalLido): ExecutanteGuia | null {
  const conselho = limpo(x.conselho);
  const numero = limpo(x.numero).replace(/\s+/g, '');
  const uf = limpo(x.uf);
  const cbo = limpo(x.cbo);
  const nome = limpo(x.nome);
  if (!/^\d{2}$/.test(conselho) || !/^\d{2}$/.test(uf)) return null;
  if (!numero || /^0+$/.test(numero) || numero.length > 15) return null;
  if (!/^\d{6}$/.test(cbo) || /^0+$/.test(cbo) || !nome) return null;
  return {
    profissional: { conselho, numeroConselho: numero, uf, cbos: cbo },
    nome: nome.slice(0, 70),
    codigo: limpo(x.codigoOperadora).slice(0, 14),
  };
}

/** Caráter do atendimento na TISS (1 eletivo, 2 urgência); outro código → null (o cadastro precisa ser corrigido). */
export const caraterTiss = (v: string | null | undefined): '1' | '2' | null => {
  const c = limpo(v);
  return c === '1' || c === '2' ? c : null;
};

/** Tipo de faturamento da TISS pela cobrança da conta (ou o da guia montada): total 4, parcial 1, final 2, complementar 3. */
export function tipoFaturamentoTiss(v: string | null | undefined): '1' | '2' | '3' | '4' | null {
  return ({ parcial: '1', final: '2', complementar: '3', total: '4' } as const)[limpo(v) as 'total'] ?? null;
}

/**
 * Indicador de acidente da guia (terminologia TISS 36: 0 trabalho, 1 trânsito, 2 outros, 9 não acidente): o da guia
 * montada; sem ele, o do atendimento (gravado pela admissão ou pelo registro do acidente); sem nenhum válido, 9.
 */
export function indicadorAcidenteGuia(
  daGuia: string | null | undefined,
  doAtendimento: string | null | undefined,
): '0' | '1' | '2' | '9' {
  for (const v of [limpo(daGuia), limpo(doAtendimento)]) if (/^[0129]$/.test(v)) return v as '0';
  return '9';
}

/** Tipo de consulta: o da guia montada; sem ele, retorno → 2 (seguimento), senão 1 (primeira consulta). */
export function tipoConsultaTiss(daGuia: string | null | undefined, retorno: boolean): '1' | '2' | '3' | '4' {
  const g = limpo(daGuia);
  return g === '1' || g === '2' || g === '3' || g === '4' ? g : retorno ? '2' : '1';
}

export type CodigosInternacao =
  | {
      readonly ok: true;
      readonly tipoInternacao: '1' | '2' | '3' | '4' | '5';
      readonly regimeInternacao: '1' | '2' | '3';
      readonly motivoEncerramento: string;
    }
  | { readonly ok: false; readonly faltas: readonly string[] };

/** Tipo, regime e motivo de saída da internação (só o resumo de internação os leva): sem eles, o que falta. */
export function codigosDaInternacao(x: {
  readonly tipo: string | null;
  readonly regime: string | null;
  readonly motivo: string | null;
}): CodigosInternacao {
  const tipo = limpo(x.tipo).replace(/^0(?=\d$)/, '');
  const regime = limpo(x.regime).replace(/^0(?=\d$)/, '');
  const motivo = limpo(x.motivo);
  const faltas: string[] = [];
  if (!/^[1-5]$/.test(tipo)) faltas.push('o tipo de internação (clínica da internação ou guia TISS)');
  if (!/^[1-3]$/.test(regime)) faltas.push('o regime de internação');
  if (!/^\d{2}$/.test(motivo)) faltas.push('o motivo de saída (encerramento do atendimento)');
  if (faltas.length) return { ok: false, faltas };
  return {
    ok: true,
    tipoInternacao: tipo as '1',
    regimeInternacao: regime as '1',
    motivoEncerramento: motivo,
  };
}

/** Recusa do cadastro incompleto para a guia da conta. */
export const recusaCadastroTiss = (conta: string, faltas: readonly string[]): RecusaTiss =>
  recusaTiss(
    'cadastro-tiss-incompleto',
    `A guia da conta ${conta} não pode ser montada: falta ${faltas.join(', ')} no cadastro. Nenhum lote foi gerado.`,
  );

const centavos = (v: number) => Math.round(v * 100) / 100;

/** Unitário da guia: o cadastrado quando quantidade × unitário confere com o total do item; senão total ÷ quantidade. */
export function unitarioDaGuia(quantidade: number, unitario: number, total: number): number {
  if (!(quantidade > 0)) return centavos(total);
  return Math.abs(quantidade * unitario - total) <= 0.005 * quantidade
    ? centavos(unitario)
    : centavos(total / quantidade);
}

/** A guia leva todos os itens cobrados e o mesmo total da conta (folga de meio centavo por unidade arredondada). */
export function conferirGuiaComConta(g: {
  readonly conta: string;
  readonly itens: readonly { readonly quantidade: number; readonly valorUnitario: number }[];
  readonly esperados: number;
  readonly totalConta: number;
}): RecusaTiss | null {
  const total = g.itens.reduce((t, i) => t + Math.round(i.quantidade * i.valorUnitario * 100), 0) / 100;
  const folga = 0.005 * g.itens.reduce((t, i) => t + Math.max(1, Math.abs(i.quantidade)), 0) + 0.005;
  if (g.itens.length === 0)
    return recusaTiss('guia-sem-itens', `A conta ${g.conta} não tem item cobrado: não vai em lote.`);
  if (g.itens.length !== g.esperados || Math.abs(total - g.totalConta) > folga)
    return recusaTiss(
      'guia-divergente',
      `A guia da conta ${g.conta} não confere com a conta (${g.itens.length} de ${g.esperados} itens; R$ ${total.toFixed(2)} na guia e R$ ${g.totalConta.toFixed(2)} na conta): o lote não foi montado.`,
    );
  return null;
}

// ── Protocolo e glosa ───────────────────────────────────────────────────────────────────────────────────

/** O número já existe para o convênio: reativa o registro cancelado do mesmo lote; em outro lote ou vivo, recusa. */
export function reusoDoProtocolo(
  existente: { readonly lote: number; readonly situacao: string; readonly excluido: boolean } | null,
  lote: number,
  protocolo: string,
): 'incluir' | 'reativar' | RecusaTiss {
  if (!existente) return 'incluir';
  if (!existente.excluido && existente.lote === lote && existente.situacao === 'cancelado') return 'reativar';
  return recusaTiss(
    'protocolo-em-uso',
    existente.lote === lote
      ? `O protocolo ${protocolo} já está registrado neste lote.`
      : `O protocolo ${protocolo} já foi usado em outro lote deste convênio: confira o número.`,
    ['protocolo'],
  );
}

/** Cabeçalho da glosa pelas decisões dos itens vivos: valor aceito e situação (só enquanto a glosa está em análise). */
export function situacaoDaGlosa(
  atual: string,
  itens: readonly { readonly decisao: string; readonly valorAceito: number }[],
): { readonly situacao: string; readonly valorAceito: number } {
  const valorAceito = centavos(itens.reduce((t, i) => t + i.valorAceito, 0));
  if (!['em_analise', 'aceita_total', 'aceita_parcial'].includes(atual))
    return { situacao: atual, valorAceito };
  if (itens.length === 0 || itens.some((i) => i.decisao === 'pendente'))
    return { situacao: 'em_analise', valorAceito };
  const aceitos = itens.filter((i) => i.decisao === 'aceitar').length;
  if (aceitos === itens.length) return { situacao: 'aceita_total', valorAceito };
  return { situacao: aceitos > 0 || valorAceito > 0 ? 'aceita_parcial' : 'em_analise', valorAceito };
}
