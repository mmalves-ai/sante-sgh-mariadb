// Cliente das regras do acordo com a fonte pagadora (06-FAT linha 1), na tela do contrato: a leitura das seis regras
// numa visão só (com a vigência, "vigente na data" e a versão) e as gravações (incluir e encerrar a vigência; nada se
// apaga). As gravações mandam o CSRF e a Idempotency-Key; erro vira ErroApi.
import type { TipoRegraAcordo } from '@sgh/dominio-preco';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const tx = z.string().nullable();
const nm = z.number().nullable();
const vig = { id: z.number(), versao: z.number(), inicio: z.string(), fim: tx, vigente: z.boolean() };

export const esquemaRegrasAcordo = z.object({
  data: z.string(),
  percentuais: z.array(
    z.object({
      ...vig,
      componente: z.string(),
      tipoPaciente: z.string(),
      plano: tx,
      grupo: tx,
      item: tx,
      funcaoEquipe: tx,
      tipoConta: tx,
      percentual: nm,
      valorFixo: nm,
      quantidadeFixa: nm,
    }),
  ),
  descontosGrupo: z.array(
    z.object({
      ...vig,
      grupo: z.string(),
      subgrupo: tx,
      acrescimo: z.number(),
      desconto: z.number(),
      sobre: z.array(z.string()),
      regimes: z.array(z.string()),
      destacaNaFatura: z.boolean(),
    }),
  ),
  viasAcesso: z.array(
    z.object({
      ...vig,
      descricao: z.string(),
      via: z.string(),
      ordem: z.number(),
      percentual: z.number(),
      criterio: z.string(),
      item: tx,
      tipoLancamento: tx,
      padraoDeTodas: z.boolean(),
    }),
  ),
  isentos: z.array(z.object({ ...vig, item: tx, grupo: tx, plano: tx, regime: tx, motivo: z.string() })),
  tetos: z.array(
    z.object({
      ...vig,
      abrangencia: z.string(),
      plano: tx,
      item: tx,
      grupo: tx,
      valorTeto: nm,
      quantidadeMaxima: nm,
      ocorrenciasMaximas: nm,
      acao: z.string(),
      excedenteFonte: tx,
      excedentePlano: tx,
    }),
  ),
  altoCusto: z.array(
    z.object({
      ...vig,
      plano: tx,
      item: tx,
      grupo: tx,
      regra: z.string(),
      valorBase: nm,
      valorNegociado: nm,
    }),
  ),
});
export type RegrasAcordo = z.infer<typeof esquemaRegrasAcordo>;

const esquemaGravado = z.object({ id: z.number() }).passthrough();

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

const postar = (url: string, corpo: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(corpo),
  }).then((r) => lerJson(r, esquemaGravado));

const base = (convenio: number) =>
  `/api/cadastros/convenios/${encodeURIComponent(String(convenio))}/regras-acordo`;

export const lerRegrasAcordo = (convenio: number, data?: string) =>
  fetch(`${base(convenio)}${data ? `?data=${encodeURIComponent(data)}` : ''}`, { headers: JSON_ACEITO }).then(
    (r) => lerJson(r, esquemaRegrasAcordo),
  );

export const incluirRegraAcordo = (
  convenio: number,
  tipo: TipoRegraAcordo,
  entrada: Record<string, unknown>,
) => postar(`${base(convenio)}/${tipo}`, entrada);

export const encerrarRegraAcordo = (
  convenio: number,
  tipo: TipoRegraAcordo,
  id: number,
  corpo: { versao: number; vigenciaFim: string; motivoAlteracao?: string | null },
) => postar(`${base(convenio)}/${tipo}/${id}/encerramento`, corpo);
