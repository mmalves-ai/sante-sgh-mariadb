// Cliente das rotas da página inicial montada pelo hospital (01-ADM L114): /api/relatorios/pagina-inicial
// (pagina-inicial.controller.ts). Gravações com CSRF e Idempotency-Key.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { enviar, ler, lerJson, novaChave } from '../exames/api-exames.js';

const B = '/api/relatorios/pagina-inicial';

export const TIPOS_BLOCO = ['lista_trabalho', 'indicador', 'link', 'texto'] as const;
export type TipoBloco = (typeof TIPOS_BLOCO)[number];
export const SITUACOES_MODELO = ['rascunho', 'publicado', 'inativo'] as const;

const esquemaBloco = z.object({
  tipo: z.enum(TIPOS_BLOCO),
  catalogo: z.string().nullable(),
  indicadorId: z.number().nullable(),
  indicadorNome: z.string().nullable().optional(),
  titulo: z.string().nullable(),
  endereco: z.string().nullable(),
  texto: z.string().nullable(),
  largura: z.number(),
});
export type BlocoModelo = z.infer<typeof esquemaBloco>;

export const esquemaCatalogo = z.object({
  tipos: z.array(
    z.object({
      codigo: z.string(),
      descricao: z.string(),
      categoria: z.string(),
      componente: z.string(),
      detalhamento: z.string().nullable(),
    }),
  ),
  indicadores: z.array(
    z.object({ id: z.number(), codigo: z.string(), nome: z.string(), unidade: z.string() }),
  ),
  // Os perfis daqui e da rede; com o escopo de rede (podeRede), os de todos os estabelecimentos.
  perfis: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      nome: z.string(),
      estabelecimentoId: z.number().nullable(),
      estabelecimento: z.string().nullable(),
    }),
  ),
  estabelecimento: z.number(),
  podeRede: z.boolean(),
});
export type CatalogoPagina = z.infer<typeof esquemaCatalogo>;

const esquemaResumo = z.object({
  id: z.number(),
  nome: z.string(),
  descricao: z.string().nullable(),
  situacao: z.enum(SITUACOES_MODELO),
  rede: z.boolean(),
  blocos: z.number(),
  perfis: z.number(),
  versao: z.number(),
});
export type ResumoModelo = z.infer<typeof esquemaResumo>;

export const esquemaModelo = z.object({
  id: z.number(),
  nome: z.string(),
  descricao: z.string().nullable(),
  situacao: z.enum(SITUACOES_MODELO),
  rede: z.boolean(),
  versao: z.number(),
  /** Falso no modelo da rede visto sem o escopo de rede (só consulta). */
  podeAlterar: z.boolean(),
  blocos: z.array(esquemaBloco),
  perfis: z.array(z.object({ perfilId: z.number(), nome: z.string(), prioridade: z.number() })),
  /** Perfis de outros estabelecimentos ligados ao modelo da rede (contados, não mostrados, sem o escopo de rede). */
  perfisOutros: z.number(),
});
export type ModeloPagina = z.infer<typeof esquemaModelo>;

const esquemaGravado = z.object({ id: z.number(), versao: z.number() }).passthrough();

export const esquemaMinhaPagina = z.object({
  modelo: z.object({ id: z.number(), nome: z.string() }).nullable(),
  blocos: z.array(
    esquemaBloco.extend({
      indicador: z
        .object({
          id: z.number(),
          codigo: z.string(),
          nome: z.string(),
          unidade: z.string(),
          simbolo: z.string().nullable(),
          serie: z.array(
            z.object({ competencia: z.string(), valor: z.number().nullable(), meta: z.number().nullable() }),
          ),
        })
        .nullable(),
    }),
  ),
});
export type MinhaPagina = z.infer<typeof esquemaMinhaPagina>;

export const lerCatalogoPagina = () => ler(`${B}/catalogo`, esquemaCatalogo);
export const lerModelosPagina = async () =>
  (await ler(`${B}/modelos`, z.object({ itens: z.array(esquemaResumo) }))).itens;
export const lerModeloPagina = (id: number) => ler(`${B}/modelos/${id}`, esquemaModelo);
export const lerMinhaPagina = () => ler(`${B}/minha`, esquemaMinhaPagina);
export const criarModeloPagina = (nome: string, rede: boolean) =>
  enviar(`${B}/modelos`, { nome, descricao: null, rede }, esquemaGravado, novaChave('pagina.criar'));
export const mudarSituacaoModelo = (id: number, versao: number, situacao: string) =>
  enviar(`${B}/modelos/${id}/situacao`, { versao, situacao }, esquemaGravado, novaChave('pagina.situacao'));

export interface SalvarModelo {
  readonly versao: number;
  readonly nome: string;
  readonly descricao: string | null;
  readonly blocos: readonly Omit<BlocoModelo, 'indicadorNome'>[];
  readonly perfis: readonly { perfilId: number; prioridade: number }[];
}
export async function salvarModeloPagina(id: number, corpo: SalvarModelo) {
  const r = await fetch(`${B}/modelos/${id}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pagina.salvar'),
    },
    body: JSON.stringify(corpo),
  });
  return lerJson(r, esquemaGravado);
}
