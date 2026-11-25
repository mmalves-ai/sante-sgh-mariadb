// Regras de impressão da recepção (02-REC linha 35): a configuração (modelos de ficha e regras por fonte pagadora,
// especialidade, grupo, unidade e tipo de atendimento), a gravação por ação e as emissões de um atendimento.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/atendimento/regras-impressao';

const opcao = z.object({ id: z.number(), nome: z.string() });
const modelo = z.object({
  id: z.number(),
  versao: z.number(),
  codigo: z.string(),
  titulo: z.string(),
  tipoDocumento: z.string(),
  conteudo: z.string().nullable(),
  copias: z.number(),
  ordem: z.number().nullable(),
  somenteRetorno: z.boolean(),
  idadeMinima: z.number().nullable(),
  idadeMaxima: z.number().nullable(),
  ativo: z.boolean(),
  regrasAtivas: z.number(),
});
const regra = z.object({
  id: z.number(),
  versao: z.number(),
  modelo: z.number(),
  estabelecimento: z.number().nullable(),
  categoria: z.number().nullable(),
  fontePagadora: z.number().nullable(),
  especialidade: z.number().nullable(),
  grupo: z.number().nullable(),
  unidade: z.number().nullable(),
  clinica: z.number().nullable(),
  copias: z.number().nullable(),
  selecionada: z.boolean(),
  ativo: z.boolean(),
});
export const esquemaConfiguracaoImpressao = z.object({
  estabelecimento: z.number(),
  modelos: z.array(modelo),
  regras: z.array(regra),
  opcoes: z.object({
    categorias: z.array(opcao),
    fontes: z.array(opcao),
    especialidades: z.array(opcao),
    grupos: z.array(opcao),
    unidades: z.array(opcao),
  }),
});
export type ConfiguracaoImpressao = z.infer<typeof esquemaConfiguracaoImpressao>;
export type ModeloFichaTela = z.infer<typeof modelo>;
export type RegraImpressaoTela = z.infer<typeof regra>;

export const esquemaEmissoesImpresso = z.array(
  z.object({
    id: z.number(),
    impresso: z.string(),
    modelo: z.number().nullable(),
    titulo: z.string().nullable(),
    formato: z.string(),
    copias: z.number(),
    sequencia: z.number(),
    reimpressao: z.boolean(),
    emitidoEm: z.string(),
    emitidoPor: z.string().nullable(),
  }),
);
export type EmissaoImpresso = z.infer<typeof esquemaEmissoesImpresso>[number];

const esquemaGravacao = z
  .object({
    ok: z.boolean(),
    mensagem: z.string().optional(),
    resultado: z.object({ id: z.number(), versao: z.number() }).passthrough(),
  })
  .passthrough();

async function json<T>(r: Response, e: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return e.parse(await r.json());
}

export const lerConfiguracaoImpressao = async () =>
  json(await fetch(P, { headers: { accept: 'application/json' } }), esquemaConfiguracaoImpressao);

export const lerEmissoesImpresso = async (reg: number) =>
  json(
    await fetch(`${P}/emissoes/${reg}`, { headers: { accept: 'application/json' } }),
    esquemaEmissoesImpresso,
  );

export type AcaoRegraImpressao =
  | {
      acao: 'modelo';
      id?: number;
      versao?: number;
      codigo: string;
      titulo: string;
      tipoDocumento: string;
      conteudo: string;
      copias: number;
      ordem: number | null;
      somenteRetorno: boolean;
      idadeMinima: number | null;
      idadeMaxima: number | null;
      ativo: boolean;
    }
  | {
      acao: 'regra';
      id?: number;
      versao?: number;
      modelo: number;
      todasUnidades: boolean;
      categoria: number | null;
      fontePagadora: number | null;
      especialidade: number | null;
      grupo: number | null;
      unidade: number | null;
      copias: number | null;
      selecionada: boolean;
      ativo: boolean;
    };

export const manterRegraImpressao = async (a: AcaoRegraImpressao, chave: string) =>
  json(
    await fetch(P, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf': tokenCsrf(),
        'idempotency-key': chave,
      },
      body: JSON.stringify(a),
    }),
    esquemaGravacao,
  );
