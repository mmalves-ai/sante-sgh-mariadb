// Cliente das rotas dos painéis de TV operacionais (01-REL L116): /api/relatorios/paineis-tv (painel-tv.controller.ts).
// Gravações com CSRF e Idempotency-Key.
import { FONTES_BLOCO_TV, FORMAS_BLOCO_TV, SITUACOES_PAINEL_TV } from '@sgh/dominio-relatorio';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { enviar, ler, lerJson, novaChave } from '../exames/api-exames.js';

const B = '/api/relatorios/paineis-tv';

const esquemaBloco = z.object({
  fonte: z.enum(FONTES_BLOCO_TV),
  titulo: z.string(),
  forma: z.enum(FORMAS_BLOCO_TV),
  tempoEmTelaSegundos: z.number().nullable(),
  unidadeInternacaoId: z.number().nullable(),
  salaCirurgicaId: z.number().nullable(),
  limite: z.number(),
});
export type BlocoTv = z.infer<typeof esquemaBloco>;

const esquemaResumo = z.object({
  id: z.number(),
  codigo: z.string(),
  nome: z.string(),
  tipo: z.string(),
  situacao: z.enum(SITUACOES_PAINEL_TV),
  blocos: z.number(),
  televisores: z.number(),
  noAr: z.boolean(),
  versao: z.number(),
});
export type ResumoPainelTv = z.infer<typeof esquemaResumo>;

const esquemaPainel = z.object({
  id: z.number(),
  codigo: z.string(),
  nome: z.string(),
  situacao: z.enum(SITUACOES_PAINEL_TV),
  tipo: z.object({ id: z.number(), codigo: z.string(), descricao: z.string() }),
  tempoRotacaoSegundos: z.number(),
  atualizacaoSegundos: z.number(),
  versao: z.number(),
  blocos: z.array(esquemaBloco),
  televisores: z.array(
    z.object({
      id: z.number(),
      estacaoId: z.number(),
      estacao: z.string(),
      codigoPareamento: z.string().nullable(),
      pareado: z.boolean(),
      ultimoContatoEm: z.string().nullable(),
      noAr: z.boolean(),
      versaoCliente: z.string().nullable(),
    }),
  ),
});
export type PainelTv = z.infer<typeof esquemaPainel>;

const opcao = z.object({ id: z.number(), nome: z.string() });
const esquemaCatalogo = z.object({
  tipos: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      categoria: z.string(),
      atualizacaoPadraoSegundos: z.number(),
    }),
  ),
  unidadesIntensivas: z.array(opcao),
  salas: z.array(opcao),
  televisores: z.array(z.object({ id: z.number(), codigo: z.string(), nome: z.string() })),
});
export type CatalogoPainelTv = z.infer<typeof esquemaCatalogo>;

const valorCelula = z.union([z.string(), z.number(), z.null()]);
const esquemaTela = z.object({
  id: z.number(),
  nome: z.string(),
  situacao: z.string(),
  atualizacaoSegundos: z.number(),
  atualizadoEm: z.string(),
  blocos: z.array(
    z.object({
      sequencia: z.number(),
      titulo: z.string(),
      fonte: z.enum(FONTES_BLOCO_TV),
      forma: z.string(),
      tempoEmTelaSegundos: z.number(),
      colunas: z.array(z.object({ campo: z.string(), rotulo: z.string() })),
      linhas: z.array(z.record(z.string(), valorCelula)),
      resumo: z.array(z.object({ rotulo: z.string(), valor: z.number() })),
    }),
  ),
});
export type TelaPainelTv = z.infer<typeof esquemaTela>;

const esquemaGravado = z.object({ id: z.number() }).passthrough();

export const lerCatalogoTv = () => ler(`${B}/catalogo`, esquemaCatalogo);
export const lerPaineisTv = async (): Promise<ResumoPainelTv[]> =>
  (await ler(B, z.object({ itens: z.array(esquemaResumo) }))).itens;
export const lerPainelTv = (id: number) => ler(`${B}/${id}`, esquemaPainel);
export const lerTelaTv = (id: number) => ler(`${B}/${id}/tela`, esquemaTela);

export interface NovoPainelTv {
  readonly codigo: string;
  readonly tipoId: number;
  readonly nome: string;
  readonly tempoRotacaoSegundos: number;
  readonly atualizacaoSegundos: number;
}
export const criarPainelTv = (corpo: NovoPainelTv) =>
  enviar(B, corpo, esquemaGravado.extend({ versao: z.number() }), novaChave('paineltv.criar'));

export interface SalvarPainelTv {
  readonly versao: number;
  readonly nome: string;
  readonly tempoRotacaoSegundos: number;
  readonly atualizacaoSegundos: number;
  readonly blocos: readonly BlocoTv[];
}
export async function salvarPainelTv(id: number, corpo: SalvarPainelTv) {
  const r = await fetch(`${B}/${id}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('paineltv.salvar'),
    },
    body: JSON.stringify(corpo),
  });
  return lerJson(r, esquemaGravado.extend({ versao: z.number() }));
}
export const mudarSituacaoTv = (id: number, versao: number, situacao: string) =>
  enviar(`${B}/${id}/situacao`, { versao, situacao }, esquemaGravado, novaChave('paineltv.situacao'));
export const ligarTelevisor = (id: number, estacaoId: number) =>
  enviar(
    `${B}/${id}/televisores`,
    { estacaoId },
    esquemaGravado.extend({ codigoPareamento: z.string() }),
    novaChave('paineltv.ligar'),
  );
export const desligarTelevisor = (id: number, tv: number) =>
  enviar(`${B}/${id}/televisores/${tv}/desligar`, {}, esquemaGravado, novaChave('paineltv.desligar'));
export const parearTelevisor = (codigo: string) =>
  enviar(
    `${B}/parear`,
    { codigo, versaoCliente: 'web-1' },
    esquemaGravado.extend({ painelId: z.number() }),
    novaChave('paineltv.parear'),
  );
export const avisarContato = (tv: number) =>
  enviar(`${B}/televisores/${tv}/contato`, {}, esquemaGravado, novaChave('paineltv.contato'));
