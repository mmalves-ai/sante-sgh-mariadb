// Cliente da remuneração e do pagamento do prestador (08-SGO L102, C2-120): tabela negociada e itens, regra de
// valoração e simulação, pacote, reajuste do contrato, calendário, adiantamento e lote de pagamento com o título a
// pagar. Respostas validadas aqui; Problem Details viram ErroApi.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/operadora/remuneracao-rede';
const n = z.number();
const nn = n.nullable();
const tn = z.string().nullable();
const opcao = z.object({ id: n, rotulo: z.string() });
export type Opcao = z.infer<typeof opcao>;
const gravado = z.object({ id: n, versao: n }).passthrough();

export const esquemaOpcoes = z.object({
  prestadores: z.array(opcao),
  tabelas: z.array(opcao),
  grupos: z.array(opcao),
  indices: z.array(opcao),
  tributos: z.array(opcao),
  naturezas: z.array(opcao),
  documentos: z.array(opcao),
  contratos: z.array(opcao),
  tiposPrestador: z.array(opcao),
});
export type OpcoesRemuneracao = z.infer<typeof esquemaOpcoes>;
const tabela = z.object({
  id: n,
  versao: n,
  codigo: z.string(),
  nome: z.string(),
  finalidade: z.string(),
  tipoValor: z.enum(['valor_fixo', 'indice']),
  valorCh: nn,
  valorUco: nn,
  valorFilme: nn,
  prestador: nn,
  prestadorNome: tn,
  situacao: z.string(),
  inicio: z.string(),
  fim: tn,
  itens: n,
});
export type TabelaRemuneracao = z.infer<typeof tabela>;
const item = z.object({
  id: n,
  sequencia: n,
  procedimento: nn,
  procedimentoRotulo: tn,
  grupo: nn,
  grupoRotulo: tn,
  prestador: nn,
  valor: nn,
  quantidadeCh: nn,
  quantidadeUco: nn,
  quantidadeFilme: nn,
  inicio: z.string(),
  fim: tn,
  valorCalculado: n,
});
export type ItemTabela = z.infer<typeof item>;
const regra = z
  .object({
    id: n,
    codigo: z.string(),
    descricao: z.string(),
    prioridade: n,
    fator: n,
    acrescimo: nn,
    tabelaCodigo: z.string(),
  })
  .passthrough();
export type RegraValoracao = z.infer<typeof regra>;
const valoracao = z.object({
  regra: n,
  tabela: n,
  tabelaCodigo: z.string(),
  valorUnitarioTabela: n,
  fator: n,
  acrescimoPercentual: n,
  quantidade: n,
  valor: n,
});
export type ResultadoValoracao = z.infer<typeof valoracao>;
const calendario = z.object({
  id: n,
  versao: n,
  competencia: z.string(),
  prestador: nn,
  prestadorNome: tn,
  atendimentoInicio: z.string(),
  atendimentoFim: z.string(),
  entregaInicio: tn,
  entregaFim: tn,
  corte: tn,
  pagamento: tn,
  dias: nn,
  fechado: z.boolean(),
});
export type CalendarioPagamento = z.infer<typeof calendario>;
const lote = z.object({
  id: n,
  versao: n,
  numero: z.string(),
  competencia: z.string(),
  prestador: n,
  prestadorNome: z.string(),
  vencimento: z.string(),
  situacao: z.string(),
  bruto: n,
  tributos: n,
  liquido: n,
  titulo: nn,
  tituloNumero: tn,
  contas: n,
});
export type LotePagamento = z.infer<typeof lote>;
const visaoPrestador = z.object({
  contas: z.array(
    z.object({
      id: n,
      protocolo: z.string(),
      competencia: z.string(),
      tipoGuia: z.string(),
      apresentado: n,
      glosado: n,
      liberado: n,
    }),
  ),
  adiantamentos: z.array(
    z.object({
      id: n,
      numero: z.string(),
      descricao: z.string(),
      data: z.string(),
      valor: n,
      compensado: n,
      parcelas: n,
      inicioCompensacao: tn,
      situacao: z.string(),
      titulo: tn,
    }),
  ),
  lotes: z.array(lote),
});
export type VisaoPrestador = z.infer<typeof visaoPrestador>;

export const lerOpcoes = (op: number) => ler(`${A}/${op}/opcoes`, esquemaOpcoes);
export const lerTabelas = (op: number) => ler(`${A}/${op}/tabelas`, z.array(tabela));
export const lerItens = (t: number) => ler(`${A}/tabela/${t}/itens`, z.array(item));
export const lerRegras = (op: number) => ler(`${A}/${op}/regras`, z.array(regra));
export const lerCalendario = (op: number, ano: number) =>
  ler(`${A}/${op}/calendario?ano=${ano}`, z.array(calendario));
export const lerPrestador = (op: number, p: number) => ler(`${A}/${op}/prestador/${p}`, visaoPrestador);
export const buscarProcedimentos = (busca: string) =>
  ler(`${A}/procedimentos?tipo=termo&busca=${encodeURIComponent(busca)}`, z.array(opcao));
export const valorarEvento = (
  op: number,
  q: {
    prestador: number;
    procedimento: number;
    data: string;
    hora: string | null;
    urgencia: boolean;
    quantidade: number;
  },
) => {
  const p = new URLSearchParams({
    prestador: String(q.prestador),
    procedimento: String(q.procedimento),
    data: q.data,
    urgencia: String(q.urgencia),
    quantidade: String(q.quantidade),
    ...(q.hora ? { hora: q.hora } : {}),
  });
  return ler(`${A}/${op}/valorar?${p.toString()}`, valoracao);
};

export const incluirTabela = (op: number, corpo: Record<string, unknown>) =>
  enviar(`${A}/${op}/tabelas`, corpo, gravado, novaChave('remun-tabela'));
export const incluirItem = (t: number, corpo: Record<string, unknown>) =>
  enviar(`${A}/tabela/${t}/itens`, corpo, gravado, novaChave('remun-item'));
export const incluirRegra = (op: number, corpo: Record<string, unknown>) =>
  enviar(`${A}/${op}/regras`, corpo, gravado, novaChave('remun-regra'));
export const reajustarContrato = (k: number, corpo: Record<string, unknown>) =>
  enviar(`${A}/contrato/${k}/reajustes`, corpo, gravado, novaChave('remun-reajuste'));
export const incluirCalendario = (op: number, corpo: Record<string, unknown>) =>
  enviar(`${A}/${op}/calendario`, corpo, gravado, novaChave('remun-calendario'));
export const fecharCalendario = (id: number, versao: number) =>
  enviar(`${A}/calendario/${id}/fechar`, { versao }, gravado, novaChave('remun-cal-fechar'));
export const incluirAdiantamento = (p: number, corpo: Record<string, unknown>) =>
  enviar(`${A}/prestador/${p}/adiantamentos`, corpo, gravado, novaChave('remun-adiantamento'));
export const criarLote = (op: number, corpo: Record<string, unknown>) =>
  enviar(`${A}/${op}/lotes`, corpo, gravado, novaChave('remun-lote'));
export const fecharLote = (id: number, corpo: { versao: number; natureza: number; documento: number }) =>
  enviar(`${A}/lote/${id}/fechar`, corpo, gravado, novaChave('remun-lote-fechar'));
export const cancelarLote = (id: number, versao: number) =>
  enviar(`${A}/lote/${id}/cancelar`, { versao }, gravado, novaChave('remun-lote-cancelar'));
