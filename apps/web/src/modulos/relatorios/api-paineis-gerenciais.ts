// Cliente das rotas dos painéis gerenciais montados pelo hospital (01-REL L112): /api/relatorios/paineis-gerenciais
// (painel-gerencial.controller.ts). Gravações com CSRF e Idempotency-Key.
import {
  FORMAS_EXIBICAO_PAINEL,
  PERIODOS_PAINEL,
  PUBLICOS_PAINEL,
  TIPOS_ITEM_PAINEL,
} from '@sgh/dominio-relatorio';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { enviar, ler, lerJson, novaChave } from '../exames/api-exames.js';

const B = '/api/relatorios/paineis-gerenciais';

const esquemaItem = z.object({
  tipo: z.enum(TIPOS_ITEM_PAINEL),
  indicadorId: z.number().nullable(),
  indicadorNome: z.string().nullable().optional(),
  titulo: z.string().nullable(),
  texto: z.string().nullable(),
  forma: z.enum(FORMAS_EXIBICAO_PAINEL),
  largura: z.number(),
  casasDecimais: z.number().nullable(),
  exibirMeta: z.boolean(),
});
export type ItemPainel = z.infer<typeof esquemaItem>;

const esquemaPermissao = z.object({
  perfilId: z.number().nullable(),
  usuarioId: z.number().nullable(),
  perfilNome: z.string().nullable().optional(),
  podeExportar: z.boolean(),
  vigenciaInicio: z.string().nullable(),
  vigenciaFim: z.string().nullable(),
});
export type PermissaoPainel = z.infer<typeof esquemaPermissao>;

const esquemaResumo = z.object({
  id: z.number(),
  codigo: z.string(),
  nome: z.string(),
  descricao: z.string().nullable(),
  publico: z.enum(PUBLICOS_PAINEL),
  periodoPadrao: z.enum(PERIODOS_PAINEL),
  ativo: z.boolean(),
  rede: z.boolean(),
  donoId: z.number().nullable(),
  versao: z.number(),
});
export type ResumoPainel = z.infer<typeof esquemaResumo> & { itens: number; permissoes: number };

export const esquemaPainel = esquemaResumo.extend({
  itens: z.array(esquemaItem),
  permissoes: z.array(esquemaPermissao),
});
export type PainelGerencial = z.infer<typeof esquemaPainel>;

export const esquemaCatalogoPainel = z.object({
  indicadores: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      nome: z.string(),
      unidade: z.string(),
      casasDecimais: z.number(),
    }),
  ),
  perfis: z.array(z.object({ id: z.number(), codigo: z.string(), nome: z.string() })),
});

const esquemaPonto = z.object({
  competencia: z.string(),
  valor: z.number().nullable(),
  numerador: z.number().nullable(),
  denominador: z.number().nullable(),
  meta: z.number().nullable(),
  situacaoMeta: z.string(),
});
export type PontoSerie = z.infer<typeof esquemaPonto>;

export const esquemaPainelAberto = z.object({
  painel: z.object({
    id: z.number(),
    nome: z.string(),
    descricao: z.string().nullable(),
    periodoPadrao: z.enum(PERIODOS_PAINEL),
    ativo: z.boolean(),
  }),
  periodo: z.object({ de: z.string(), ate: z.string() }),
  exportar: z.boolean(),
  quadros: z.array(
    esquemaItem.extend({
      indicador: z
        .object({
          id: z.number(),
          codigo: z.string(),
          nome: z.string(),
          unidade: z.string(),
          simbolo: z.string().nullable(),
          casasDecimais: z.number(),
          polaridade: z.string(),
          ultima: esquemaPonto.nullable(),
          variacao: z.number().nullable(),
          serie: z.array(esquemaPonto),
        })
        .nullable(),
    }),
  ),
});
export type PainelAberto = z.infer<typeof esquemaPainelAberto>;

const esquemaGravado = z.object({ id: z.number(), versao: z.number() }).passthrough();

export const lerCatalogoPainel = () => ler(`${B}/catalogo`, esquemaCatalogoPainel);
export const lerPaineis = async (): Promise<ResumoPainel[]> =>
  (
    await ler(
      B,
      z.object({ itens: z.array(esquemaResumo.extend({ itens: z.number(), permissoes: z.number() })) }),
    )
  ).itens;
export const lerPainel = (id: number) => ler(`${B}/${id}`, esquemaPainel);
export const abrirPainel = (id: number) => ler(`${B}/${id}/abrir`, esquemaPainelAberto);

export interface NovoPainel {
  readonly codigo: string;
  readonly nome: string;
  readonly descricao: string | null;
  readonly publico: string;
  readonly periodoPadrao: string;
  readonly rede: boolean;
}
export const criarPainel = (corpo: NovoPainel) => enviar(B, corpo, esquemaGravado, novaChave('painel.criar'));
export const mudarUsoPainel = (id: number, versao: number, ativo: boolean) =>
  enviar(`${B}/${id}/uso`, { versao, ativo }, esquemaGravado, novaChave('painel.uso'));

export interface SalvarPainel {
  readonly versao: number;
  readonly nome: string;
  readonly descricao: string | null;
  readonly publico: string;
  readonly periodoPadrao: string;
  readonly itens: readonly Omit<ItemPainel, 'indicadorNome'>[];
  readonly permissoes: readonly Omit<PermissaoPainel, 'perfilNome'>[];
}
export async function salvarPainel(id: number, corpo: SalvarPainel) {
  const r = await fetch(`${B}/${id}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('painel.salvar'),
    },
    body: JSON.stringify(corpo),
  });
  return lerJson(r, esquemaGravado);
}
