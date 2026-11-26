// Cliente das telas da conta do paciente (M30), validado pelos contratos. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção de gravar); Problem Details viram ErroApi e a recusa de negócio traz o texto em
// português do servidor (pendência bloqueante, conta apresentada, grupo não liberado…).
import {
  esquemaAuditoriaConta,
  esquemaCaixaLido,
  esquemaContaDetalhe,
  esquemaExplicacaoLida,
  esquemaGravacaoFaturamento,
  esquemaItemSigtap,
  esquemaListaContas,
  esquemaListaItens,
  esquemaNotaSala,
  esquemaOrcamentoParticular,
  esquemaPacoteLido,
  esquemaPagamentoLido,
  esquemaPainelLancamentos,
  esquemaReciboLido,
  esquemaRegraLida,
  esquemaResultadoFaturamento,
  esquemaWorklistFaturamento,
  type ResultadoFaturamento,
} from '@sgh/contratos';
import { z } from 'zod';
import { ErroApi } from '../../casca/erros/problem-details.js';
import { enviar, ler, qs } from '../exames/api-exames.js';

const F = '/api/faturamento';

let sequencia = 0;
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m30.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

export function textoDaRecusa(e: unknown): string | null {
  if (!(e instanceof ErroApi)) return null;
  if (![400, 403, 409, 422].includes(e.status)) return null;
  const d = (e.problema as { detail?: unknown } | null)?.detail;
  return typeof d === 'string' && d.trim() ? d : null;
}

const gravar = (url: string, corpo: unknown, chave: string): Promise<ResultadoFaturamento> =>
  enviar(url, corpo, esquemaResultadoFaturamento, chave);

export const lerGravacao = (particular = false) =>
  ler(`${F}${particular ? '/particular' : ''}/gravacao`, esquemaGravacaoFaturamento);
export const lerApoio = (particular = false) =>
  ler(
    `${F}${particular ? '/particular' : ''}/apoio`,
    z.object({
      hoje: z.string(),
      escopo: z.array(z.string()),
      situacoes: z.array(z.string()),
      convenios: z.array(z.object({ codigo: z.number(), nome: z.string() })).default([]),
    }),
  );
export const lerWorklist = () => ler(`${F}/worklist`, esquemaWorklistFaturamento);

export const listarContas = (f: {
  situacao?: string;
  convenio?: string;
  competencia?: string;
  tipo?: string;
  termo?: string;
  altaDias?: string;
  pagina?: number;
  sus?: boolean;
}) => ler(`${F}/contas${qs({ ...f, sus: f.sus ? 'sim' : '' })}`, esquemaListaContas);
export const lerConta = (id: number) => ler(`${F}/contas/${id}`, esquemaContaDetalhe);
export const listarItens = (
  id: number,
  f: { pagina?: number; tipo?: number | null; naoConferidos?: boolean; regua?: string; mes?: string },
) =>
  ler(
    `${F}/contas/${id}/itens${qs({ ...f, naoConferidos: f.naoConferidos ? 'sim' : '' })}`,
    esquemaListaItens,
  );
export const lerSigtap = (id: number) => ler(`${F}/contas/${id}/sigtap`, z.array(esquemaItemSigtap));
export const lerAuditoria = (id: number) => ler(`${F}/contas/${id}/auditoria`, esquemaAuditoriaConta);
export const explicarItem = (item: number) => ler(`${F}/itens/${item}/explicacao`, esquemaExplicacaoLida);

export const fecharConta = (id: number, versao: string, chave: string) =>
  gravar(`${F}/contas/${id}/fechar`, { versao }, chave);
export const reabrirConta = (id: number, versao: string, motivo: string, chave: string) =>
  gravar(`${F}/contas/${id}/reabrir`, { versao, motivo }, chave);
export const conferirItens = (id: number, itens: { id: number; versao: string }[], chave: string) =>
  gravar(`${F}/contas/${id}/conferencia`, { itens }, chave);
export const lancarItem = (id: number, e: unknown, chave: string) =>
  gravar(`${F}/contas/${id}/itens`, e, chave);
export const registrarPendencia = (
  id: number,
  e: { tipo: number; descricao: string; bloqueante: boolean },
  chave: string,
) => gravar(`${F}/contas/${id}/pendencias`, e, chave);
export const resolverPendencia = (id: number, resolucao: string, chave: string) =>
  gravar(`${F}/pendencias/${id}/resolver`, { resolucao }, chave);
export const registrarEtapa = (
  id: number,
  e: { etapa: 'conferencia' | 'auditoria'; acao: 'iniciar' | 'concluir'; observacao?: string },
  chave: string,
) => gravar(`${F}/contas/${id}/etapas`, e, chave);
export const registrarVersaoAuditoria = (
  id: number,
  e: { papel: 'enfermeiro' | 'medico'; parecer: string },
  chave: string,
) => gravar(`${F}/contas/${id}/auditoria/versoes`, e, chave);

export const lerTiposPendencia = () =>
  ler(
    `${F}/pendencias-tipos`,
    z.object({
      tipos: z.array(z.object({ id: z.number(), nome: z.string(), modulos: z.array(z.number()) })),
      controles: z.array(z.object({ id: z.number(), nome: z.string() })),
    }),
  );
export const lerPainel = (competencia: string) =>
  ler(`${F}/lancamentos/painel${qs({ competencia })}`, esquemaPainelLancamentos);
export const decidirTardio = (registro: number, e: { decisao: string; motivo: string }, chave: string) =>
  gravar(`${F}/lancamentos/tardios/${registro}/decisao`, e, chave);

export const lerRegras = () => ler(`${F}/regras`, z.array(esquemaRegraLida));
export const editarRegra = (e: unknown, chave: string) => gravar(`${F}/regras`, e, chave);
export const lerPacotes = () =>
  ler(
    `${F}/pacotes`,
    z.object({
      pacotes: z.array(esquemaPacoteLido),
      orcamentosPadrao: z.array(
        z.object({
          convenio: z.number(),
          procedimento: z.number(),
          tipo: z.number(),
          nome: z.string(),
          valor: z.number(),
          quantidade: z.number(),
        }),
      ),
      orcamentoAntigo: z.number(),
    }),
  );
export const editarPacote = (e: unknown, chave: string) => gravar(`${F}/pacotes`, e, chave);
export const simular = (f: {
  convenio: string;
  tipoConta: string;
  tipo: string;
  codigo: string;
  quantidade: string;
  data: string;
  setor?: string;
  horarioEspecial?: string;
  reajusteIndice?: string;
  reajustePorte?: string;
  reajustePorteAnestesico?: string;
  reajusteTabela?: string;
}) =>
  ler(
    `${F}/simulador${qs(f)}`,
    z.object({
      encontrado: z.boolean(),
      nome: z.string(),
      preco: z
        .object({
          modelo: z.string(),
          unitario: z.number(),
          ch: z.number(),
          cop: z.number(),
          filme: z.number(),
          valor: z.number(),
        })
        .nullable(),
      vigencia: z.string().nullable(),
      origem: z.enum(['indice', 'vigencia']).nullable().optional(),
      passos: z.array(z.string()).optional(),
      falta: z.string().nullable().optional(),
      impacto: z
        .object({
          atual: z.number().nullable(),
          novo: z.number().nullable(),
          diferenca: z.number().nullable(),
          percentual: z.number().nullable(),
          afetadoPor: z.array(z.string()),
          passos: z.array(z.string()),
        })
        .nullable()
        .optional(),
    }),
  );

export const listarCirurgias = () =>
  ler(
    `${F}/notas-sala`,
    z.array(
      z.object({
        id: z.number(),
        data: z.string().nullable(),
        sala: z.number(),
        conta: z.number().nullable(),
      }),
    ),
  );
export const lerNotaSala = (id: number) => ler(`${F}/notas-sala/${id}`, esquemaNotaSala);

export const listarOrcamentos = () => ler(`${F}/particular/orcamentos`, z.array(esquemaOrcamentoParticular));
export const registrarOrcamento = (e: unknown, chave: string) =>
  gravar(`${F}/particular/orcamentos`, e, chave);
export const listarCaixas = () => ler(`${F}/particular/caixas`, z.array(esquemaCaixaLido));
export const abrirCaixa = (saldoInicial: number, chave: string) =>
  gravar(`${F}/particular/caixas`, { saldoInicial }, chave);
export const fecharCaixa = (id: number, contado: number, chave: string) =>
  gravar(`${F}/particular/caixas/${id}/fechar`, { contado }, chave);
export const receber = (e: unknown, chave: string) => gravar(`${F}/particular/recebimentos`, e, chave);
export const listarPagamentos = (
  f:
    | number
    | null
    | {
        caixa?: string;
        forma?: string;
        situacao?: string;
        desde?: string;
        ate?: string;
        pagina?: number;
      } = null,
) =>
  ler(
    `${F}/particular/pagamentos${qs(typeof f === 'object' && f !== null ? f : { caixa: f })}`,
    z.array(esquemaPagamentoLido),
  );
export const listarRecibos = (antigos: boolean) =>
  ler(`${F}/particular/recibos${qs({ antigos: antigos ? 'sim' : '' })}`, z.array(esquemaReciboLido));
export const emitirRecibo = (e: { pagamento: number; pagador: string; referente: string }, chave: string) =>
  gravar(`${F}/particular/recibos`, e, chave);
