// Cliente das telas do M12 (convênios, contratos, tabelas de preço, importação e motor de preços), validado
// pelos contratos. As gravações mandam o CSRF (token duplo) e a Idempotency-Key (uma por pedido; repetir o
// mesmo pedido não grava de novo); as críticas mandam a senha de novo. Problem Details viram ErroApi.
import {
  type CargaDetalhe,
  type CargaResumo,
  type ContratoConvenio,
  esquemaCargaDetalhe,
  esquemaContratoConvenio,
  esquemaEdicoesReferencia,
  esquemaImpactoSituacao,
  esquemaListaCargas,
  esquemaListaConvenios,
  esquemaListaLotes,
  esquemaListaTabelas,
  esquemaPaginaDiarias,
  esquemaPaginaGenerica,
  esquemaPaginaHonorarios,
  esquemaPaginaMatmed,
  esquemaPaginaModificadores,
  esquemaPropostaReajuste,
  esquemaResultadoGravacaoPreco,
  esquemaSaneamento,
  esquemaValorVigente,
  esquemaVigenciasItem,
  esquemaVigenciasValor,
  type ImpactoSituacao,
  type ListaConvenios,
  type LoteReajuste,
  type PaginaDiarias,
  type PaginaGenerica,
  type PaginaHonorarios,
  type PaginaMatmed,
  type PaginaModificadores,
  type PropostaReajusteResposta,
  type ResultadoGravacaoPreco,
  type Saneamento,
  type TabelaPreco,
  type ValorVigente,
  type VigenciasItem,
  type VigenciasValor,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

function chaveIdempotencia(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function escrita(metodo: string, corpo: unknown): RequestInit {
  return {
    method: metodo,
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chaveIdempotencia(),
    },
    body: JSON.stringify(corpo),
  };
}

const qs = (p: Record<string, string | number | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};
const ler = <T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch = fetch) =>
  buscar(url, { headers: JSON_ACEITO }).then((r) => lerJson(r, esquema));
const gravar = <T>(
  url: string,
  metodo: string,
  corpo: unknown,
  esquema: z.ZodType<T>,
  buscar: typeof fetch = fetch,
) => buscar(url, escrita(metodo, corpo)).then((r) => lerJson(r, esquema));

// ── Convênios e contratos ──────────────────────────────────────────────────────────────────────────

export const listarConvenios = (busca: string, situacao: string): Promise<ListaConvenios> =>
  ler(`/api/cadastros/convenios${qs({ busca, situacao })}`, esquemaListaConvenios);

export const buscarContrato = (cod: number): Promise<ContratoConvenio> =>
  ler(`/api/cadastros/convenios/${cod}`, esquemaContratoConvenio);

export const buscarModificadores = (
  cod: number,
  tipo: string,
  pagina: number,
): Promise<PaginaModificadores> =>
  ler(
    `/api/cadastros/convenios/${cod}/modificadores${qs({ tipo, pagina, porPagina: 25 })}`,
    esquemaPaginaModificadores,
  );

export const buscarImpactoSituacao = (cod: number, operacao: string): Promise<ImpactoSituacao> =>
  ler(`/api/cadastros/convenios/${cod}/situacao/impacto${qs({ operacao })}`, esquemaImpactoSituacao);

export const alterarSituacao = (
  cod: number,
  operacao: 'suspender' | 'reativar',
  justificativa: string,
  senha: string,
): Promise<ResultadoGravacaoPreco> =>
  gravar(
    `/api/cadastros/convenios/${cod}/situacao`,
    'POST',
    { operacao, justificativa, senha },
    esquemaResultadoGravacaoPreco,
  );

export const alterarContrato = (
  cod: number,
  pedido: {
    aba: 'cadastro' | 'faturabilidade' | 'financeiro';
    valores: Record<string, string | number | null>;
    lidos: Record<string, string | number | null>;
    justificativa: string;
    senha: string;
  },
): Promise<ResultadoGravacaoPreco> =>
  gravar(`/api/cadastros/convenios/${cod}/contrato`, 'PUT', pedido, esquemaResultadoGravacaoPreco);

export const gravarPlano = (
  cod: number,
  p: {
    nome: string;
    planoLegado: number | null;
    inicio: string;
    fim: string | null;
    justificativa: string;
    senha: string;
  },
) => gravar(`/api/cadastros/convenios/${cod}/planos`, 'POST', p, z.object({ id: z.number() }));

/** Corrige, encerra (fim) ou desativa o plano: só os campos informados mudam; a versão lida vai junto. */
export const alterarPlano = (
  cod: number,
  id: number,
  p: {
    versao: number;
    nome?: string;
    fim?: string | null;
    ativo?: boolean;
    justificativa: string;
    senha: string;
  },
) =>
  gravar(
    `/api/cadastros/convenios/${cod}/planos/${id}`,
    'PATCH',
    p,
    z.object({ id: z.number(), versao: z.number() }),
  );

export const buscarCodigosPrestador = (convenio: number | null, pagina: number): Promise<PaginaGenerica> =>
  ler(
    `/api/cadastros/convenios/codigos-prestador${qs({ convenio, pagina, porPagina: 50 })}`,
    esquemaPaginaGenerica,
  );

// ── Tabelas de preço ───────────────────────────────────────────────────────────────────────────────

export const listarTabelas = (tipo: 'honorarios' | 'diarias' | 'matmed'): Promise<TabelaPreco[]> =>
  ler(`/api/precos/tabelas${qs({ tipo })}`, esquemaListaTabelas).then((r) => r.tabelas);

export const buscarHonorarios = (
  tab: number,
  f: { busca: string; pagina: number; porPagina: number; data: string | null },
): Promise<PaginaHonorarios> => ler(`/api/precos/honorarios/${tab}/itens${qs(f)}`, esquemaPaginaHonorarios);

export const buscarVigencias = (tab: number, cod: number): Promise<VigenciasItem> =>
  ler(`/api/precos/honorarios/${tab}/itens/${cod}/vigencias`, esquemaVigenciasItem);

/** Vigências da diária/taxa (por operação) ou do mat/med (por código). */
export const buscarVigenciasValor = (
  tipo: 'diarias' | 'matmed',
  tab: number,
  cod: number,
): Promise<VigenciasValor> => ler(`/api/precos/${tipo}/${tab}/itens/${cod}/vigencias`, esquemaVigenciasValor);

export interface PedidoReajusteTela {
  readonly codigos: number[] | null;
  readonly percentual: number | null;
  readonly valores: { codigo: number; ch: number }[] | null;
}

export const proporReajuste = (tab: number, p: PedidoReajusteTela): Promise<PropostaReajusteResposta> =>
  gravar(`/api/precos/honorarios/${tab}/reajuste/proposta`, 'POST', p, esquemaPropostaReajuste);

export const aplicarReajuste = (
  tab: number,
  p: PedidoReajusteTela & {
    justificativa: string;
    senha: string;
    confirmacoes: { tabelaCompartilhada?: boolean; percentualTabela?: boolean };
  },
): Promise<ResultadoGravacaoPreco> =>
  gravar(`/api/precos/honorarios/${tab}/reajuste`, 'POST', p, esquemaResultadoGravacaoPreco);

export const listarLotes = (tab: number | null): Promise<LoteReajuste[]> =>
  ler(`/api/precos/reajustes${qs({ tabela: tab })}`, esquemaListaLotes).then((r) => r.lotes);

export const desfazerLote = (
  lote: string,
  justificativa: string,
  senha: string,
): Promise<ResultadoGravacaoPreco> =>
  gravar(
    `/api/precos/reajustes/${encodeURIComponent(lote)}/desfazer`,
    'POST',
    { justificativa, senha },
    esquemaResultadoGravacaoPreco,
  );

export const buscarDiarias = (
  tab: number,
  f: { busca: string; pagina: number; data: string | null },
): Promise<PaginaDiarias> =>
  ler(`/api/precos/diarias/${tab}/itens${qs({ ...f, porPagina: 50 })}`, esquemaPaginaDiarias);

export const buscarMatmed = (
  tab: number,
  f: { busca: string; pagina: number; data: string | null },
): Promise<PaginaMatmed> =>
  ler(`/api/precos/matmed/${tab}/itens${qs({ ...f, porPagina: 50 })}`, esquemaPaginaMatmed);

export const buscarEdicoes = () => ler('/api/precos/matmed/edicoes', esquemaEdicoesReferencia);

export const consultarValor = (q: {
  convenio: number;
  tipo: string;
  conta: string;
  item: number;
  data: string | null;
}): Promise<ValorVigente> => ler(`/api/precos/consulta${qs(q)}`, esquemaValorVigente);

export const buscarSaneamento = (): Promise<Saneamento> => ler('/api/precos/saneamento', esquemaSaneamento);

// ── Importação versionada ──────────────────────────────────────────────────────────────────────────

export const listarImportacoes = (): Promise<{ cargas: CargaResumo[]; versoes: Record<string, number> }> =>
  ler('/api/precos/importacoes', esquemaListaCargas.extend({ versoes: z.record(z.string(), z.number()) }));

export const criarImportacao = (tabela: number, arquivo: string, conteudo: string) =>
  gravar(
    '/api/precos/importacoes',
    'POST',
    { tabela, arquivo, conteudo },
    z.object({ id: z.number(), situacao: z.string(), motivo: z.string().nullable() }),
  );

export const buscarImportacao = (
  id: number,
  pagina: number,
  comparacao: string | null,
): Promise<CargaDetalhe & { versao: number }> =>
  ler(
    `/api/precos/importacoes/${id}${qs({ pagina, porPagina: 50, comparacao })}`,
    esquemaCargaDetalhe.extend({ versao: z.number() }),
  );

export const aprovarImportacao = (
  id: number,
  p: {
    justificativa: string;
    senha: string;
    versao: number;
    confirmacoes: { tabelaCompartilhada?: boolean; percentualTabela?: boolean };
  },
): Promise<ResultadoGravacaoPreco> =>
  gravar(`/api/precos/importacoes/${id}/aprovar`, 'POST', p, esquemaResultadoGravacaoPreco);

export const rejeitarImportacao = (id: number, motivo: string, versao: number) =>
  gravar(
    `/api/precos/importacoes/${id}/rejeitar`,
    'POST',
    { motivo, versao },
    z.object({ id: z.number(), situacao: z.string() }),
  );

// ── Motor de preços (consulta) ─────────────────────────────────────────────────────────────────────

export const buscarCredenciamento = (
  convenio: number | null,
  pagina: number,
  profissional = '',
): Promise<PaginaGenerica> =>
  ler(
    `/api/faturamento/credenciamento${qs({ convenio, profissional, pagina, porPagina: 50 })}`,
    esquemaPaginaGenerica,
  );

export const buscarCredenciamentoComplementar = (convenio: number | null, profissional = '') =>
  ler(
    `/api/faturamento/credenciamento/complementar${qs({ convenio, profissional })}`,
    z.object({
      atos: esquemaPaginaGenerica,
      unimed: esquemaPaginaGenerica.optional(),
      auditoras: esquemaPaginaGenerica.optional(),
    }),
  );

export const buscarDePara = (
  convenio: number | null,
  exame: string,
  pagina: number,
): Promise<PaginaGenerica> =>
  ler(
    `/api/faturamento/de-para-exames${qs({ convenio, exame, pagina, porPagina: 50 })}`,
    esquemaPaginaGenerica,
  );

/** Portes anestésicos: pela tabela de porte ou pelo convênio (a tabela de porte do contrato). */
export const buscarPortes = (
  filtro: { tabela: number | null; convenio: number | null },
  pagina: number,
): Promise<PaginaGenerica> =>
  ler(
    `/api/faturamento/portes${qs({ tabela: filtro.tabela, convenio: filtro.convenio, pagina, porPagina: 50 })}`,
    esquemaPaginaGenerica,
  );

export const buscarTabelasTerceiros = () =>
  ler(
    '/api/faturamento/terceiros/tabelas',
    z.object({
      tabelas: z.array(z.object({ tabela: z.number(), itens: z.number(), ultima: z.string().nullable() })),
    }),
  ).then((r) => r.tabelas);

export const buscarTerceiros = (tabela: number, busca: string, pagina: number): Promise<PaginaGenerica> =>
  ler(`/api/faturamento/terceiros${qs({ tabela, busca, pagina, porPagina: 50 })}`, esquemaPaginaGenerica);

export const buscarUnimed = (busca: string, pagina: number): Promise<PaginaGenerica> =>
  ler(`/api/faturamento/unimed${qs({ busca, pagina, porPagina: 50 })}`, esquemaPaginaGenerica);
