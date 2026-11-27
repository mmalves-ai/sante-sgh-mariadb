// Cliente dos portais externos da operadora (08-SGO L114, C3-027): a gestão pela operadora (contas dos três portais,
// fila de solicitações, lotes de exclusão da contratante) e o lado do portal (conta, cartão digital, solicitações e
// lote de exclusão). O titular nunca vem da tela: o servidor usa a conta ativa do usuário. Respostas validadas aqui;
// Problem Details viram ErroApi.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const OP = '/api/operadora/portais';
const PO = '/api/portal-operadora';
const n = z.number();
const tn = z.string().nullable();
const nn = n.nullable();
const gravado = z.object({ id: n, versao: n }).passthrough();

export const TIPOS_PORTAL = ['beneficiario', 'contratante', 'corretor'] as const;
export type TipoPortal = (typeof TIPOS_PORTAL)[number];
export const SITUACOES_CONTA = ['convidada', 'ativa', 'bloqueada', 'encerrada'] as const;
export const TIPOS_SOLICITACAO = [
  'segunda_via_cartao',
  'inclusao_beneficiario',
  'exclusao_beneficiario',
  'reativacao_beneficiario',
  'reembolso',
  'alteracao_cadastral',
  'transferencia_plano',
  'outro',
] as const;
export const SITUACOES_SOLICITACAO = [
  'aberta',
  'em_analise',
  'pendente_documento',
  'aprovada',
  'reprovada',
  'cancelada',
  'concluida',
] as const;
export type AcaoConta = 'ativar' | 'bloquear' | 'desbloquear' | 'encerrar';
export type AcaoDecisao = 'analisar' | 'pedir_documento' | 'aprovar' | 'reprovar' | 'concluir';

export const esquemaConta = z.object({
  id: n,
  portal: z.enum(TIPOS_PORTAL),
  operadora: n,
  login: z.string(),
  email: tn,
  celular: tn,
  situacao: z.enum(SITUACOES_CONTA),
  usuario: nn,
  beneficiario: nn,
  contratante: nn,
  gestor: nn,
  corretora: nn,
  vendedor: nn,
  recebeNotificacoes: z.boolean(),
  motivoBloqueio: tn,
  convidadaEm: tn,
  ativadaEm: tn,
  versao: n,
});
export type ContaPortal = z.infer<typeof esquemaConta>;
export const esquemaSolicitacao = z.object({
  id: n,
  numero: z.string(),
  tipo: z.string(),
  situacao: z.enum(SITUACOES_SOLICITACAO),
  contaBeneficiario: nn,
  contaContratante: nn,
  beneficiario: nn,
  beneficiarioNome: tn,
  dataEfeito: tn,
  resultado: tn,
  criadaEm: z.string(),
  analisadaEm: tn,
  versao: n,
});
export type SolicitacaoPortal = z.infer<typeof esquemaSolicitacao>;
export const esquemaLote = z.object({
  id: n,
  numero: z.string(),
  contratante: n,
  situacao: z.string(),
  registros: n,
  aceitos: n,
  rejeitados: n,
  recebidoEm: z.string(),
  processadoEm: tn,
  versao: n,
});
export type LoteExclusao = z.infer<typeof esquemaLote>;
export const esquemaItemLote = z.object({
  sequencia: n,
  matricula: tn,
  nome: z.string(),
  beneficiario: nn,
  situacao: z.string(),
  critica: tn,
  dataEfeito: tn,
  processadoEm: tn,
});
export type ItemLote = z.infer<typeof esquemaItemLote>;
export const esquemaCanal = z.object({ canal: z.string(), ligado: z.boolean(), decisao: z.string() });
export const esquemaContaPublica = z.object({
  id: n,
  portal: z.enum(TIPOS_PORTAL),
  login: z.string(),
  email: tn,
  celular: tn,
  situacao: z.enum(SITUACOES_CONTA),
  tipos: z.array(z.string()),
});
export type ContaPublica = z.infer<typeof esquemaContaPublica>;
export const esquemaCartao = z.object({
  matricula: z.string(),
  nome: z.string(),
  via: n,
  produto: z.string(),
  registroAns: tn,
  inicioVigencia: z.string(),
  fimVigencia: tn,
  valido: z.boolean(),
});
export type CartaoDigital = z.infer<typeof esquemaCartao>;
const lista = <T extends z.ZodTypeAny>(t: T) => z.object({ itens: z.array(t) });
const itens = async <T>(p: Promise<{ itens: T[] }>) => (await p).itens;
const filtro = (s: string | null) => (s ? `?situacao=${encodeURIComponent(s)}` : '');

// ── Operadora ────────────────────────────────────────────────────────────────────────────────────
export const lerContas = (portal: TipoPortal, situacao: string | null) =>
  itens(ler(`${OP}/${portal}/contas${filtro(situacao)}`, lista(esquemaConta)));
export interface Convite {
  login: string;
  email: string | null;
  celular: string | null;
  usuario: number | null;
  beneficiario: number | null;
  contratante: number | null;
  gestor: number | null;
  corretora: number | null;
  vendedor: number | null;
}
export const convidarConta = (portal: TipoPortal, corpo: Convite) =>
  enviar(`${OP}/${portal}/contas`, corpo, gravado, novaChave('portal-conta'));
export const mudarSituacaoConta = (
  portal: TipoPortal,
  id: number,
  corpo: { versao: number; acao: AcaoConta; motivo: string | null; termosAceitos: boolean },
) => enviar(`${OP}/${portal}/contas/${id}/situacao`, corpo, gravado, novaChave('portal-conta-sit'));
export const lerSolicitacoes = (situacao: string | null) =>
  itens(ler(`${OP}/solicitacoes${filtro(situacao)}`, lista(esquemaSolicitacao)));
export const decidirSolicitacao = (
  id: number,
  corpo: { versao: number; acao: AcaoDecisao; resultado: string | null },
) => enviar(`${OP}/solicitacoes/${id}/decisao`, corpo, gravado, novaChave('portal-decisao'));
export const lerLotes = () => itens(ler(`${OP}/lotes`, lista(esquemaLote)));
export const lerItensLote = (id: number) => itens(ler(`${OP}/lotes/${id}/itens`, lista(esquemaItemLote)));
export const processarLote = (id: number, versao: number) =>
  enviar(`${OP}/lotes/${id}/processar`, { versao }, gravado, novaChave('portal-lote-proc'));
export const lerCanal = () => ler(`${OP}/canal-mensagens`, esquemaCanal);

// ── Portal externo ───────────────────────────────────────────────────────────────────────────────
export const lerMinhaConta = (portal: TipoPortal) => ler(`${PO}/${portal}/conta`, esquemaContaPublica);
export const lerCartao = (beneficiario: number | null) =>
  ler(`${PO}/beneficiario/cartao${beneficiario ? `?beneficiario=${beneficiario}` : ''}`, esquemaCartao);
export const lerMinhasSolicitacoes = (portal: TipoPortal) =>
  itens(ler(`${PO}/${portal}/solicitacoes`, lista(esquemaSolicitacao)));
export const esquemaOpcoesPortal = z.object({
  motivosExclusao: z.array(z.object({ id: n, codigo: z.string(), descricao: z.string() })),
  contratos: z.array(z.object({ id: n, numero: z.string(), produto: tn })),
});
export type OpcoesPortal = z.infer<typeof esquemaOpcoesPortal>;
/** Os motivos de exclusão visíveis no portal e, na contratante, os contratos dela (para a inclusão). */
export const lerOpcoesPortal = (portal: TipoPortal) => ler(`${PO}/${portal}/opcoes`, esquemaOpcoesPortal);
export interface NovaSolicitacao {
  tipo: string;
  beneficiario: number | null;
  motivo: number | null;
  dataEfeito: string | null;
  pedidoReembolso: number | null;
  dados: Record<string, unknown> | null;
  observacao: string | null;
}
export const abrirSolicitacao = (portal: TipoPortal, corpo: NovaSolicitacao) =>
  enviar(`${PO}/${portal}/solicitacoes`, corpo, gravado, novaChave('portal-solicitacao'));
export const cancelarSolicitacao = (portal: TipoPortal, id: number, versao: number) =>
  enviar(`${PO}/${portal}/solicitacoes/${id}/cancelar`, { versao }, gravado, novaChave('portal-cancelar'));
export const lerMeusLotes = () => itens(ler(`${PO}/contratante/lotes`, lista(esquemaLote)));
export const lerItensMeuLote = (id: number) =>
  itens(ler(`${PO}/contratante/lotes/${id}/itens`, lista(esquemaItemLote)));
export interface LinhaLote {
  sequencia: number;
  matricula: string;
  motivo: number | null;
  dataEfeito: string | null;
}
export const enviarLote = (linhas: LinhaLote[]) =>
  enviar(`${PO}/contratante/lotes`, { linhas }, gravado, novaChave('portal-lote'));
