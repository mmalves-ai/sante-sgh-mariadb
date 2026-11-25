// Cliente do cadastro da central de material esterilizado (CME; F7, 04-CME linha 115): produtos reprocessáveis,
// caixas, kits e pacotes avulsos com a composição em ordem de montagem, as fases do reprocessamento e a foto de
// conferência. Toda gravação leva a chave de idempotência; a alteração leva a versão lida (409 se outro gravou antes).
import { TIPO_CORPO_ANEXOS_PORTAL } from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { enviar, ler, lerJson, novaChave } from '../exames/api-exames.js';

const C = '/api/cirurgia/cme/cadastro';

const esquemaFaseLida = z.object({
  fase: z.number(),
  descricao: z.string(),
  ordem: z.number(),
  obrigatoria: z.boolean(),
});

export const esquemaProdutoReprocessavel = z.object({
  id: z.number(),
  descricao: z.string(),
  tipo: z.string(),
  codigoBarras: z.string().nullable(),
  insumo: z.number().nullable(),
  bem: z.number().nullable(),
  metodo: z.number().nullable(),
  embalagem: z.number().nullable(),
  guarda: z.number().nullable(),
  limiteReprocessamentos: z.number().nullable(),
  contadorReprocessamentos: z.number(),
  restante: z.number().nullable(),
  alertaLimite: z.string(),
  validadeDias: z.number().nullable(),
  tempoMinutos: z.number().nullable(),
  temperaturaCelsius: z.number().nullable(),
  tecnicaExpurgo: z.string().nullable(),
  tecnicaDesinfeccao: z.string().nullable(),
  tecnicaPreparo: z.string().nullable(),
  tecnicaEsterilizacao: z.string().nullable(),
  conservacao: z.string().nullable(),
  situacao: z.string(),
  versao: z.number(),
  fases: z.array(esquemaFaseLida),
});
export type ProdutoReprocessavel = z.infer<typeof esquemaProdutoReprocessavel>;

const idDescricao = z.object({ id: z.number(), descricao: z.string() });

export const esquemaPainelCadastroCme = z.object({
  produtos: z.array(esquemaProdutoReprocessavel),
  caixas: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      natureza: z.string(),
      ativo: z.boolean(),
      pecas: z.number(),
      fases: z.number(),
      temFoto: z.boolean(),
      alertaLimite: z.string(),
      versao: z.number(),
    }),
  ),
  fases: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      ordem: z.number(),
      ativo: z.boolean(),
      exigeCiclo: z.boolean(),
      exigeOperador: z.boolean(),
    }),
  ),
  metodos: z.array(idDescricao),
  embalagens: z.array(idDescricao.extend({ validadeDias: z.number().nullable() })),
  setores: z.array(z.object({ id: z.number(), nome: z.string() })),
  especialidades: z.array(idDescricao),
  insumos: z.array(idDescricao),
});
export type PainelCadastroCme = z.infer<typeof esquemaPainelCadastroCme>;

export const esquemaCaixaCadastro = z.object({
  id: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  descricaoResumida: z.string().nullable(),
  natureza: z.string(),
  especialidade: z.number().nullable(),
  metodo: z.number().nullable(),
  embalagem: z.number().nullable(),
  setor: z.number().nullable(),
  validadeDias: z.number().nullable(),
  controlaReprocessamentos: z.boolean(),
  limiteReprocessamentos: z.number().nullable(),
  reprocessamentos: z.number(),
  alertaLimite: z.string(),
  etiquetasPreparo: z.number(),
  etiquetasEsterilizacao: z.number(),
  ativo: z.boolean(),
  temFoto: z.boolean(),
  versao: z.number(),
  pecas: z.array(
    z.object({
      id: z.number(),
      sequencia: z.number(),
      produto: z.number().nullable(),
      insumo: z.number().nullable(),
      bem: z.number().nullable(),
      descricao: z.string(),
      quantidade: z.number(),
      pecaMestre: z.boolean(),
      codigoBarras: z.string().nullable(),
      suspenso: z.boolean(),
      temFoto: z.boolean(),
      versao: z.number(),
    }),
  ),
  fases: z.array(esquemaFaseLida),
});
export type CaixaCadastro = z.infer<typeof esquemaCaixaCadastro>;

export interface FaseEnvio {
  readonly fase: number;
  readonly obrigatoria: boolean;
}

export interface ProdutoEnvio {
  readonly versao?: number;
  readonly descricao: string;
  readonly tipo: string;
  readonly codigoBarras: string | null;
  readonly metodo: number | null;
  readonly embalagem: number | null;
  readonly guarda: number | null;
  readonly limiteReprocessamentos: number | null;
  readonly validadeDias: number | null;
  readonly tempoMinutos: number | null;
  readonly temperaturaCelsius: number | null;
  readonly tecnicaPreparo: string | null;
  readonly conservacao: string | null;
  readonly fases: readonly FaseEnvio[];
}

export interface PecaEnvio {
  readonly id?: number;
  readonly produto: number | null;
  readonly insumo: number | null;
  readonly bem: number | null;
  readonly quantidade: number;
  readonly pecaMestre: boolean;
  readonly codigoBarras: string | null;
  readonly suspenso: boolean;
}

export interface CaixaEnvio {
  readonly versao?: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly natureza: string;
  readonly metodo: number | null;
  readonly embalagem: number | null;
  readonly setor: number | null;
  readonly especialidade: number | null;
  readonly validadeDias: number | null;
  readonly controlaReprocessamentos: boolean;
  readonly limiteReprocessamentos: number | null;
  readonly pecas: readonly PecaEnvio[];
  readonly fases: readonly FaseEnvio[];
}

const qualquer = z.record(z.string(), z.unknown());

export const lerPainelCadastroCme = () => ler(C, esquemaPainelCadastroCme);
export const lerCaixaCadastro = (id: number) => ler(`${C}/caixas/${id}`, esquemaCaixaCadastro);

export const gravarProdutoReprocessavel = (id: number | null, corpo: ProdutoEnvio) =>
  enviar(id ? `${C}/produtos/${id}` : `${C}/produtos`, corpo, qualquer, novaChave('cme.produto'));
export const situacaoProdutoReprocessavel = (id: number, versao: number, situacao: string) =>
  enviar(`${C}/produtos/${id}/situacao`, { versao, situacao }, qualquer, novaChave('cme.produto.situacao'));

export const gravarCaixaCadastro = (id: number | null, corpo: CaixaEnvio) =>
  enviar(id ? `${C}/caixas/${id}` : `${C}/caixas`, corpo, qualquer, novaChave('cme.caixa.cadastro'));
export const situacaoCaixaCadastro = (id: number, versao: number, ativo: boolean) =>
  enviar(`${C}/caixas/${id}/situacao`, { versao, ativo }, qualquer, novaChave('cme.caixa.situacao'));

export const enviarFotoCme = async (
  alvo: 'caixas' | 'pecas',
  id: number,
  corpo: { versao: number; conteudo: string; nomeOriginal: string },
) =>
  // A foto vai em base64 com o tipo do corpo com anexos (o JSON padrão aceita 1 MB; a foto tem até 2 MB).
  lerJson(
    await fetch(`${C}/${alvo}/${id}/foto`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': TIPO_CORPO_ANEXOS_PORTAL,
        'x-csrf': tokenCsrf(),
        'idempotency-key': novaChave('cme.foto'),
      },
      body: JSON.stringify(corpo),
    }),
    qualquer,
  );
export const lerFotoCme = (alvo: 'caixas' | 'pecas', id: number) =>
  ler(`${C}/${alvo}/${id}/foto`, z.object({ tipo: z.string(), conteudo: z.string() }));
