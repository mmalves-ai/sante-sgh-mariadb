// Cliente da API do prontuário de acesso restrito (03-PEP L93):
// GET  /api/pep/prontuario-restrito                 fila de pedidos pendentes e configuração da unidade
// GET  /api/pep/prontuario-restrito/paciente/:id    visão por paciente (restrição, minha situação, pedidos, autorizações)
// POST /api/pep/prontuario-restrito/<acao>          configuracao, restricoes, restricoes/encerrar, senha, pedidos,
//                                                   pedidos/cancelar, pedidos/decidir, autorizacoes/revogar, abrir
// Toda gravação leva a chave de idempotência e o x-csrf (como as demais do prontuário).
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from './api-registro.js';

const P = '/api/pep/prontuario-restrito';
const JSON_ACEITO = { accept: 'application/json' };

const esquemaConfiguracao = z.object({
  autorizador: z.enum(['paciente', 'medico_responsavel', 'diretoria_clinica', 'papel']),
  papelId: z.number().nullable(),
  validadeHoras: z.number(),
  exigeSenhaPaciente: z.boolean(),
  limiteAcessos: z.number().nullable(),
  exigeMotivo: z.boolean(),
  avisaResponsavel: z.boolean(),
  daUnidade: z.boolean(),
  versao: z.number(),
});
export type ConfiguracaoTela = z.infer<typeof esquemaConfiguracao>;

const esquemaPedido = z.object({
  id: z.number(),
  versao: z.number(),
  paciente: z.number(),
  prontuario: z.string().nullable(),
  solicitante: z.string().nullable(),
  doUsuario: z.boolean(),
  motivo: z.string(),
  justificativa: z.string(),
  tipo: z.string(),
  situacao: z.string(),
  solicitadoEm: z.string().nullable(),
  decididoEm: z.string().nullable(),
  motivoDecisao: z.string().nullable(),
  acessoFim: z.string().nullable(),
});
export type PedidoTela = z.infer<typeof esquemaPedido>;

const esquemaAutorizacao = z.object({
  id: z.number(),
  versao: z.number(),
  autorizado: z.string().nullable(),
  concedidaPor: z.string(),
  senhaConferida: z.boolean(),
  tipo: z.string(),
  inicio: z.string().nullable(),
  fim: z.string().nullable(),
  revogadaEm: z.string().nullable(),
  motivoRevogacao: z.string().nullable(),
  acessos: z.number(),
  limite: z.number().nullable(),
  vigente: z.boolean(),
});
export type AutorizacaoTela = z.infer<typeof esquemaAutorizacao>;

export const esquemaPainel = z.object({
  paciente: z.number(),
  prontuario: z.string().nullable(),
  restricao: z
    .object({
      id: z.number(),
      versao: z.number(),
      modo: z.string(),
      categoria: z.string(),
      motivo: z.string(),
      desde: z.string().nullable(),
      permiteEmergencial: z.boolean(),
    })
    .nullable(),
  configuracao: esquemaConfiguracao,
  senha: z.object({ definida: z.boolean(), bloqueada: z.boolean() }),
  minha: z.object({
    permitido: z.boolean(),
    mensagem: z.string().nullable(),
    restantes: z.number().nullable(),
  }),
  podeDecidir: z.boolean(),
  pedidos: z.array(esquemaPedido),
  autorizacoes: z.array(esquemaAutorizacao),
  motivos: z.array(
    z.object({
      id: z.number(),
      descricao: z.string(),
      textoPadrao: z.string().nullable(),
      exigeComplemento: z.boolean(),
    }),
  ),
});
export type PainelTela = z.infer<typeof esquemaPainel>;

export const esquemaFila = z.object({
  pedidos: z.array(esquemaPedido),
  configuracao: esquemaConfiguracao,
  papeis: z.array(z.object({ id: z.number(), rotulo: z.string() })),
});
export type FilaTela = z.infer<typeof esquemaFila>;

export async function lerFilaRestrito(buscar: typeof fetch = fetch): Promise<FilaTela> {
  const r = await buscar(P, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaFila.parse(await r.json());
}

export async function lerPainelRestrito(paciente: number, buscar: typeof fetch = fetch): Promise<PainelTela> {
  const r = await buscar(`${P}/paciente/${paciente}`, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaPainel.parse(await r.json());
}

export type AcaoRestrito =
  | 'configuracao'
  | 'restricoes'
  | 'restricoes/encerrar'
  | 'senha'
  | 'pedidos'
  | 'pedidos/cancelar'
  | 'pedidos/decidir'
  | 'autorizacoes/revogar'
  | 'abrir';

export async function gravarRestrito(
  acao: AcaoRestrito,
  corpo: Record<string, unknown>,
  buscar: typeof fetch = fetch,
) {
  const r = await buscar(`${P}/${acao}`, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pep.prontuarioRestrito'),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return z
    .object({ ok: z.boolean(), mensagem: z.string().optional() })
    .passthrough()
    .parse(await r.json());
}
