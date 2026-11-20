// Cliente das telas do M08 (CRUD genérico, parâmetros e funcionalidades por estabelecimento), validado pelos
// contratos. As gravações mandam o CSRF (token duplo) e a Idempotency-Key (uma por pedido; repetir o mesmo
// pedido não grava de novo). Problem Details viram ErroApi (mensagem em português na tela).
import {
  type ConsultaLista,
  type DominioDescrito,
  esquemaDominioDescrito,
  esquemaIndiceDominios,
  esquemaItemDominio,
  esquemaListaDominio,
  esquemaPainelLiberacao,
  esquemaPainelParametros,
  esquemaRelatorioVigiaReconciliacao,
  esquemaResultadoGravacao,
  esquemaResultadoLiberacao,
  esquemaTextosItem,
  type TextosItem,
  esquemaUsoItem,
  type IndiceDominios,
  type ItemDominio,
  type ListaDominio,
  type PainelLiberacao,
  type PainelParametros,
  type PedidoLiberacao,
  type RelatorioVigiaReconciliacao,
  type ResultadoGravacao,
  type ResultadoLiberacao,
  type UsoItem,
  type ValorCampo,
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

const base = (modulo: string, recurso: string) =>
  `/api/cadastros/dominios/${encodeURIComponent(modulo)}/${encodeURIComponent(recurso)}`;

export async function buscarIndiceDominios(buscar: typeof fetch = fetch): Promise<IndiceDominios> {
  return lerJson(await buscar('/api/cadastros/dominios', { headers: JSON_ACEITO }), esquemaIndiceDominios);
}

export async function buscarDominio(
  m: string,
  r: string,
  buscar: typeof fetch = fetch,
): Promise<DominioDescrito> {
  return lerJson(await buscar(base(m, r), { headers: JSON_ACEITO }), esquemaDominioDescrito);
}

export async function listarItens(
  m: string,
  r: string,
  c: ConsultaLista,
  buscar: typeof fetch = fetch,
  /** M14: filtro pela referência (`ref.<campo>`), na tela mestre-detalhe. */
  referencia?: { readonly campo: string; readonly valor: string } | null,
): Promise<ListaDominio> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(c)) if (v !== undefined && v !== '') q.set(k, String(v));
  if (referencia) q.set(`ref.${referencia.campo}`, referencia.valor);
  return lerJson(
    await buscar(`${base(m, r)}/itens?${q.toString()}`, { headers: JSON_ACEITO }),
    esquemaListaDominio,
  );
}

export async function buscarItem(
  m: string,
  r: string,
  codigo: string,
  buscar: typeof fetch = fetch,
): Promise<ItemDominio> {
  return lerJson(
    await buscar(`${base(m, r)}/itens/${encodeURIComponent(codigo)}`, { headers: JSON_ACEITO }),
    esquemaItemDominio,
  );
}

export async function buscarUso(
  m: string,
  r: string,
  codigo: string,
  buscar: typeof fetch = fetch,
): Promise<UsoItem> {
  return lerJson(
    await buscar(`${base(m, r)}/itens/${encodeURIComponent(codigo)}/uso`, { headers: JSON_ACEITO }),
    esquemaUsoItem,
  );
}

const esquemaOpcoes = z.object({
  opcoes: z.array(
    z.object({ valor: z.union([z.number(), z.string()]), rotulo: z.string(), ativo: z.boolean() }),
  ),
});

export async function buscarOpcoes(m: string, r: string, campo: string, buscar: typeof fetch = fetch) {
  return lerJson(
    await buscar(`${base(m, r)}/opcoes/${encodeURIComponent(campo)}`, { headers: JSON_ACEITO }),
    esquemaOpcoes,
  );
}

export async function incluirItem(
  m: string,
  r: string,
  valores: Record<string, ValorCampo>,
  buscar: typeof fetch = fetch,
): Promise<ResultadoGravacao> {
  return lerJson(await buscar(`${base(m, r)}/itens`, escrita('POST', { valores })), esquemaResultadoGravacao);
}

export async function alterarItem(
  m: string,
  r: string,
  codigo: string,
  versao: string,
  valores: Record<string, ValorCampo>,
  buscar: typeof fetch = fetch,
): Promise<ResultadoGravacao> {
  return lerJson(
    await buscar(`${base(m, r)}/itens/${encodeURIComponent(codigo)}`, escrita('PUT', { versao, valores })),
    esquemaResultadoGravacao,
  );
}

/** Revisão do W0-02: a inativação leva o motivo (vai ao registro do evento com o valor anterior). */
export async function inativarItem(
  m: string,
  r: string,
  codigo: string,
  versao: string,
  motivo: string,
  confirmarEmUso: boolean,
  buscar: typeof fetch = fetch,
): Promise<ResultadoGravacao> {
  return lerJson(
    await buscar(
      `${base(m, r)}/itens/${encodeURIComponent(codigo)}/inativar`,
      escrita('POST', { versao, motivo, ...(confirmarEmUso ? { confirmarEmUso: true } : {}) }),
    ),
    esquemaResultadoGravacao,
  );
}

/**
 * Correção do M14: desfaz a inativação só no novo. W0-02: também nos cadastros que inativam pela situação (grava a
 * situação de ativo), sempre com o motivo.
 */
export async function reativarItem(
  m: string,
  r: string,
  codigo: string,
  versao: string,
  motivo: string,
  buscar: typeof fetch = fetch,
): Promise<ResultadoGravacao> {
  return lerJson(
    await buscar(
      `${base(m, r)}/itens/${encodeURIComponent(codigo)}/reativar`,
      escrita('POST', { versao, motivo }),
    ),
    esquemaResultadoGravacao,
  );
}

/**
 * W0-02: exclusão do item nunca usado (crítica: a senha de novo vai só no pedido). Com registros dependentes, o
 * servidor recusa (409) com a lista e a oferta de inativar.
 */
export async function excluirItem(
  m: string,
  r: string,
  codigo: string,
  versao: string,
  motivo: string,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<ResultadoGravacao> {
  return lerJson(
    await buscar(
      `${base(m, r)}/itens/${encodeURIComponent(codigo)}/excluir`,
      escrita('POST', { versao, motivo, senha }),
    ),
    esquemaResultadoGravacao,
  );
}

/** Revisão do W0-02: o relatório da vigia de reconciliação (exclusões de cadastro feitas fora do sistema). */
export async function buscarRelatorioVigia(
  buscar: typeof fetch = fetch,
): Promise<RelatorioVigiaReconciliacao> {
  return lerJson(
    await buscar('/api/cadastros/dominios/vigia/exclusoes-fora', { headers: JSON_ACEITO }),
    esquemaRelatorioVigiaReconciliacao,
  );
}

/** Correção do M14: os textos longos do item, em leitura. */
export async function buscarTextos(
  m: string,
  r: string,
  codigo: string,
  buscar: typeof fetch = fetch,
): Promise<TextosItem> {
  return lerJson(
    await buscar(`${base(m, r)}/itens/${encodeURIComponent(codigo)}/textos`, { headers: JSON_ACEITO }),
    esquemaTextosItem,
  );
}

/** Exportação auditada: devolve o CSV (o servidor registra a trilha antes de responder). */
export async function exportarItens(
  m: string,
  r: string,
  justificativa?: number,
  buscar: typeof fetch = fetch,
): Promise<string> {
  const resp = await buscar(`${base(m, r)}/exportar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf': tokenCsrf() },
    body: JSON.stringify(justificativa ? { justificativa } : {}),
  });
  if (!resp.ok) throw await erroDaResposta(resp);
  return resp.text();
}

// ── Parâmetros ──

export async function buscarParametros(buscar: typeof fetch = fetch): Promise<PainelParametros> {
  return lerJson(
    await buscar('/api/administracao/parametros', { headers: JSON_ACEITO }),
    esquemaPainelParametros,
  );
}

export async function definirParametro(
  chave: string,
  pedido: { nivel: string; alvo: string; valor: string; justificativa: string; senha?: string },
  buscar: typeof fetch = fetch,
) {
  return lerJson(
    await buscar(`/api/administracao/parametros/${encodeURIComponent(chave)}`, escrita('PUT', pedido)),
    z.object({ id: z.string(), destino: z.enum(['legado', 'memoria']), atrasoInvalidacaoMs: z.number() }),
  );
}

/** W0-09: as versões do parâmetro (as retiradas com quem e o motivo), da mais nova para a mais antiga. */
const esquemaVersaoParametro = z
  .object({
    id: z.string(),
    nivel: z.string(),
    alvo: z.string(),
    valor: z.string(),
    vigenteDesde: z.string(),
    vigenteAte: z.string().nullable(),
    justificativa: z.string(),
    autor: z.string(),
    retiradaPor: z.string().nullish(),
    retiradaMotivo: z.string().nullish(),
  })
  .passthrough();
export type VersaoParametroTela = z.infer<typeof esquemaVersaoParametro>;

export async function buscarVersoesParametro(
  chave: string,
  buscar: typeof fetch = fetch,
): Promise<VersaoParametroTela[]> {
  const r = await lerJson(
    await buscar(`/api/administracao/parametros/${encodeURIComponent(chave)}`, { headers: JSON_ACEITO }),
    z.object({ versoes: z.array(esquemaVersaoParametro) }).passthrough(),
  );
  return r.versoes;
}

/**
 * W0-09: retira a sobreposição do nível e do alvo (volta a herdar do nível acima); a versão fica com quem retirou e o
 * motivo. Parâmetro crítico pede a senha.
 */
export async function retirarParametro(
  chave: string,
  pedido: { nivel: string; alvo: string; justificativa: string; senha?: string },
  buscar: typeof fetch = fetch,
) {
  return lerJson(
    await buscar(
      `/api/administracao/parametros/${encodeURIComponent(chave)}/retirada`,
      escrita('POST', pedido),
    ),
    z.object({ atrasoInvalidacaoMs: z.number() }).passthrough(),
  );
}

// ── Funcionalidades por estabelecimento ──

export async function buscarLiberacao(buscar: typeof fetch = fetch): Promise<PainelLiberacao> {
  return lerJson(
    await buscar('/api/administracao/liberacao', { headers: JSON_ACEITO }),
    esquemaPainelLiberacao,
  );
}

export async function aplicarLiberacao(
  pedido: PedidoLiberacao,
  buscar: typeof fetch = fetch,
): Promise<ResultadoLiberacao> {
  return lerJson(
    await buscar('/api/administracao/liberacao', escrita('POST', pedido)),
    esquemaResultadoLiberacao,
  );
}

export async function reverterLote(
  lote: string,
  justificativa: string,
  senha: string,
  referenciaAutorizacao?: string,
  buscar: typeof fetch = fetch,
): Promise<ResultadoLiberacao> {
  return lerJson(
    await buscar(
      `/api/administracao/liberacao/lotes/${encodeURIComponent(lote)}/reverter`,
      escrita('POST', {
        justificativa,
        senha,
        ...(referenciaAutorizacao ? { referenciaAutorizacao } : {}),
      }),
    ),
    esquemaResultadoLiberacao,
  );
}

export async function registrarPrerequisito(
  pedido: {
    recurso: string;
    tipo: string;
    situacao: string;
    validade: string | null;
    evidencia: string | null;
    referenciaAutorizacao?: string;
    senha: string;
  },
  buscar: typeof fetch = fetch,
) {
  return lerJson(
    await buscar('/api/administracao/liberacao/prerequisitos', escrita('PUT', pedido)),
    z.object({ ok: z.boolean(), destino: z.enum(['legado', 'memoria']) }),
  );
}
