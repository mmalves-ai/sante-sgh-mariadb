// Cliente da ficha complementar do paciente (F3.1, 02-CAD linhas 2, 3 e 4): contatos, responsáveis e regras de campo.
// As gravações mandam o CSRF e a Idempotency-Key; Problem Details viram ErroApi (mensagem em português na tela).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const P = '/api/cadastros/pacientes';

const esquemaContatos = z.object({
  enderecos: z.array(
    z.object({
      id: z.number(),
      tipo: z.string(),
      cep: z.string().nullable(),
      logradouro: z.string(),
      numero: z.string().nullable(),
      complemento: z.string().nullable(),
      bairro: z.string().nullable(),
      principal: z.boolean(),
      vigenciaInicio: z.string().nullable(),
      vigenciaFim: z.string().nullable(),
      vigente: z.boolean(),
    }),
  ),
  telefones: z.array(
    z.object({
      id: z.number(),
      tipo: z.string(),
      ddi: z.string(),
      ddd: z.string().nullable(),
      numero: z.string(),
      nomeContato: z.string().nullable(),
      principal: z.boolean(),
      aceitaMensagem: z.boolean(),
      ativo: z.boolean(),
    }),
  ),
  emails: z.array(
    z.object({
      id: z.number(),
      email: z.string(),
      finalidade: z.string(),
      principal: z.boolean(),
      aceitaComunicacao: z.boolean(),
      aceiteEm: z.string().nullable(),
      ativo: z.boolean(),
    }),
  ),
});
export type Contatos = z.infer<typeof esquemaContatos>;

const opcoes = z.array(z.object({ id: z.number(), descricao: z.string() }));
const esquemaTipos = z.object({ endereco: opcoes, telefone: opcoes, parentesco: opcoes });
export type TiposFicha = z.infer<typeof esquemaTipos>;

const esquemaResponsaveis = z.object({
  itens: z.array(
    z.object({
      id: z.number(),
      nome: z.string(),
      cpfFinal: z.string().nullable(),
      papel: z.string(),
      parentesco: z.string().nullable(),
      autorizarProcedimento: z.boolean(),
      receberInformacao: z.boolean(),
      retirarDocumento: z.boolean(),
      contatoPrincipal: z.boolean(),
      vigenciaInicio: z.string().nullable(),
      vigenciaFim: z.string().nullable(),
      vigente: z.boolean(),
      temComprovante: z.boolean(),
    }),
  ),
  pendencias: z.array(z.object({ pendencia: z.string(), vinculo: z.number().nullable() })),
});
export type Responsaveis = z.infer<typeof esquemaResponsaveis>;

const esquemaRegras = z.object({
  itens: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      campo: z.string(),
      estabelecimento: z.number().nullable(),
      modulo: z.number().nullable(),
      tipoAtendimento: z.string(),
      fontePagadora: z.number().nullable(),
      exigencia: z.string(),
      rotulo: z.string().nullable().optional(),
      ativo: z.boolean(),
    }),
  ),
});
export type RegrasCampo = z.infer<typeof esquemaRegras>;

const esquemaId = z.object({ id: z.number() });

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function ler<T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch = fetch): Promise<T> {
  const r = await buscar(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

async function gravar(url: string, corpo: unknown = {}, buscar: typeof fetch = fetch): Promise<number> {
  const r = await buscar(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaId.parse(await r.json()).id;
}

export const lerContatos = (id: number, b?: typeof fetch) => ler(`${P}/${id}/contatos`, esquemaContatos, b);
export const lerTiposFicha = (b?: typeof fetch) =>
  ler('/api/cadastros/ficha-complementar/tipos', esquemaTipos, b);
export const lerResponsaveis = (id: number, b?: typeof fetch) =>
  ler(`${P}/${id}/responsaveis`, esquemaResponsaveis, b);
export const lerRegrasCampo = (inativas: boolean, b?: typeof fetch) =>
  ler(`/api/cadastros/regras-campo${inativas ? '?inativas=1' : ''}`, esquemaRegras, b);

export const incluirContato = (id: number, especie: 'enderecos' | 'telefones' | 'emails', corpo: object) =>
  gravar(`${P}/${id}/${especie}`, corpo);
export const ajustarContato = (
  id: number,
  especie: 'endereco' | 'telefone' | 'email',
  contato: number,
  acao: 'principal' | 'encerrar' | 'revogar-aceite' | 'reativar',
) => gravar(`${P}/${id}/contatos/${especie}/${contato}/${acao}`);
export const incluirResponsavel = (id: number, corpo: object) => gravar(`${P}/${id}/responsaveis`, corpo);
export const encerrarResponsavel = (id: number, vinculo: number, corpo: object) =>
  gravar(`${P}/${id}/responsaveis/${vinculo}/encerrar`, corpo);
export const gravarRegraCampo = (corpo: object) => gravar('/api/cadastros/regras-campo', corpo);
export const inativarRegraCampo = (id: number, versao: number) =>
  gravar(`/api/cadastros/regras-campo/${id}/inativar`, { versao });

// Canal de entrada dos módulos de recepção (02-CAD linha 2): sem local, a abertura tira o módulo do canal.
export const CANAIS_ENTRADA = ['agenda', 'urgencia', 'internacao', 'exames', 'demanda'] as const;
const esquemaModulosRecepcao = z.object({
  itens: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      ativo: z.boolean(),
      canal: z.enum(CANAIS_ENTRADA).nullable(),
      versao: z.number(),
    }),
  ),
});
export type ModulosRecepcao = z.infer<typeof esquemaModulosRecepcao>;
export const lerModulosRecepcao = (b?: typeof fetch) =>
  ler('/api/cadastros/modulos-recepcao', esquemaModulosRecepcao, b);
export const gravarCanalModulo = (modulo: number, versao: number, canal: string | null) =>
  gravar(`/api/cadastros/modulos-recepcao/${modulo}/canal`, { versao, canal });
