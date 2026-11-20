// Cliente das telas da notificação de incidentes (M48, etapa 1), validado na chegada. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção de gravar: o reenvio da mesma notificação devolve o mesmo número e o mesmo código);
// Problem Details viram ErroApi e o código da recusa (ex.: versao-desatualizada, anonima-no-suporte) fica em
// `problema.codigo` para a tela mostrar o texto certo.
import {
  type AcompanhamentoNotificacao,
  type CamposNotivisa,
  CODIGOS_CLASSIFICACAO_OMS,
  CODIGOS_GRAU_DANO,
  CODIGOS_SITUACAO_NOTIFICACAO,
  CODIGOS_TIPO_INCIDENTE,
  type NotificacaoDetalhe,
  type NotificacaoResumo,
  type NotificarIncidenteEntrada,
  SITUACOES_PRAZO,
  TIPOS_EVENTO_NOTIFICACAO,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const Q = '/api/qualidade';

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChaveQualidade(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m48.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

// ── Esquemas das respostas ──────────────────────────────────────────────────────────────────────────

const instante = z.string();
const esquemaPrazo = z.object({
  tipo: z.enum(['notivisaObito', 'notivisaMensal', 'analiseCausaRaiz']),
  venceEm: instante,
  situacao: z.enum(SITUACOES_PRAZO),
  minutosRestantes: z.number().nullable(),
});
export const esquemaResumoNotificacao = z.object({
  id: z.number().int(),
  protocolo: z.string(),
  notificadaEm: instante,
  ocorridoEm: instante,
  tipo: z.enum(CODIGOS_TIPO_INCIDENTE),
  classificacao: z.enum(CODIGOS_CLASSIFICACAO_OMS),
  dano: z.enum(CODIGOS_GRAU_DANO),
  situacao: z.enum(CODIGOS_SITUACAO_NOTIFICACAO),
  notivisa: z.enum(['naoObrigatoria', 'pendente', 'exportada', 'transcrita']),
  unidade: z.string().nullable(),
  comPaciente: z.boolean(),
  anonima: z.boolean(),
  proximoPrazo: esquemaPrazo.nullable(),
});
export const esquemaDetalheNotificacao = esquemaResumoNotificacao.extend({
  versao: z.number().int(),
  descricao: z.string(),
  local: z.string().nullable(),
  chegouAoPaciente: z.boolean(),
  danoPercebido: z.enum(CODIGOS_GRAU_DANO),
  tipoOutro: z.string().nullable(),
  neverEvent: z.boolean(),
  notificador: z.string().nullable(),
  paciente: z
    .object({
      id: z.number().int(),
      nome: z.string(),
      prontuario: z.number().nullable(),
      leito: z.string().nullable(),
    })
    .nullable(),
  gestor: z.string().nullable(),
  prazoAnalise: z.string().nullable(),
  prazos: z.array(esquemaPrazo),
  eventos: z.array(
    z.object({
      tipo: z.enum(TIPOS_EVENTO_NOTIFICACAO),
      em: instante,
      por: z.string().nullable(),
      texto: z.string().nullable(),
    }),
  ),
});
const esquemaGravacao = z.object({
  ligada: z.boolean(),
  motivo: z.string().nullable().optional(),
  acoes: z.object({ triar: z.boolean(), notivisa: z.boolean() }),
});
export type GravacaoQualidade = z.infer<typeof esquemaGravacao>;

const esquemaFormulario = z.object({
  ligada: z.boolean(),
  motivo: z.string().nullable().optional(),
  unidades: z.array(z.object({ codigo: z.number().int(), nome: z.string() })),
  anonimaPermitida: z.boolean(),
  agora: instante,
});
export type FormularioNotificacao = z.infer<typeof esquemaFormulario>;

const esquemaNotificada = z.object({
  protocolo: z.string(),
  codigoAcompanhamento: z.string(),
  repetida: z.boolean(),
});
export type NotificacaoEnviada = z.infer<typeof esquemaNotificada>;

const esquemaAcompanhamento = z.object({
  protocolo: z.string(),
  notificadaEm: instante,
  situacao: z.enum(CODIGOS_SITUACAO_NOTIFICACAO),
  devolutivas: z.array(z.object({ em: instante, texto: z.string() })),
});

const esquemaLista = z.object({
  itens: z.array(esquemaResumoNotificacao),
  temMais: z.boolean(),
  pagina: z.number().int(),
  agora: instante,
  gravacao: esquemaGravacao,
});
export type ListaNotificacoes = z.infer<typeof esquemaLista>;

const esquemaDetalheResposta = z.object({
  notificacao: esquemaDetalheNotificacao,
  agora: instante,
  gravacao: esquemaGravacao,
});
export type DetalheNotificacaoResposta = z.infer<typeof esquemaDetalheResposta>;

const esquemaFeriadoAusente = z.object({ data: z.string(), nome: z.string() });
const esquemaPorSituacao = z.object({
  noPrazo: z.number().int(),
  venceEmBreve: z.number().int(),
  vencido: z.number().int(),
});
const esquemaPrazos = z.object({
  itens: z.array(esquemaResumoNotificacao),
  cortada: z.boolean(),
  resumo: z.object({ porSituacao: esquemaPorSituacao, feriadosAusentes: z.array(esquemaFeriadoAusente) }),
  agora: instante,
  gravacao: esquemaGravacao,
});
export type FilaPrazos = z.infer<typeof esquemaPrazos>;

const esquemaResumoPrazos = z.object({
  porSituacao: esquemaPorSituacao,
  feriadosAusentes: z.array(esquemaFeriadoAusente),
  cortada: z.boolean(),
  agora: instante,
});
export type ResumoPrazos = z.infer<typeof esquemaResumoPrazos>;

const esquemaCampos = z.object({
  campos: z.object({
    protocoloInterno: z.string(),
    tipoIncidente: z.string(),
    classificacao: z.string(),
    ocorridoEm: z.string(),
    periodo: z.enum(['manha', 'tarde', 'noite', 'madrugada']),
    unidade: z.string().nullable(),
    local: z.string().nullable(),
    descricao: z.string(),
    dano: z.string(),
    obito: z.boolean(),
    neverEvent: z.boolean(),
    paciente: z
      .object({ iniciais: z.string(), sexo: z.enum(['F', 'M', 'I']), idade: z.number().nullable() })
      .nullable(),
    prazo: esquemaPrazo.nullable(),
  }),
});

const esquemaResultado = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  versao: z.number().int(),
  mensagem: z.string(),
});
export type ResultadoNsp = z.infer<typeof esquemaResultado>;

const esquemaProxima = z.object({ id: z.number().int().nullable(), protocolo: z.string().nullable() });
const esquemaGestores = z.object({ itens: z.array(z.object({ login: z.string(), nome: z.string() })) });

// Os esquemas acima espelham os contratos: o que eles aceitam cabe no tipo do contrato (o compilador barra a
// divergência).
type Igual<A, B> = [A] extends [B] ? true : false;
const _conferencia: [
  Igual<z.infer<typeof esquemaResumoNotificacao>, NotificacaoResumo>,
  Igual<z.infer<typeof esquemaDetalheNotificacao>, NotificacaoDetalhe>,
  Igual<z.infer<typeof esquemaAcompanhamento>, AcompanhamentoNotificacao>,
  Igual<z.infer<typeof esquemaCampos>['campos'], CamposNotivisa>,
] = [true, true, true, true];
void _conferencia;

// ── O botão global (todo perfil de pessoa) ──────────────────────────────────────────────────────────

export const lerBotaoNotificacao = () => ler(`${Q}/notificacoes/botao`, z.object({ ligada: z.boolean() }));
export const lerFormularioNotificacao = (): Promise<FormularioNotificacao> =>
  ler(`${Q}/notificacoes/formulario`, esquemaFormulario);
export const notificarIncidente = (
  e: NotificarIncidenteEntrada,
  chave: string,
): Promise<NotificacaoEnviada> => enviar(`${Q}/notificacoes`, e, esquemaNotificada, chave);
export const acompanharNotificacao = (
  protocolo: string,
  codigo: string,
): Promise<AcompanhamentoNotificacao> =>
  enviar(
    `${Q}/notificacoes/acompanhar`,
    { protocolo, codigo },
    esquemaAcompanhamento,
    novaChaveQualidade('acompanhar'),
  );

// ── Núcleo de Segurança do Paciente ────────────────────────────────────────────────────────────────

export interface FiltroTela {
  situacao?: string;
  tipo?: string;
  classificacao?: string;
  prazo?: string;
  unidade?: number | null;
  de?: string | null;
  ate?: string | null;
  protocolo?: string;
  pagina?: number;
}
export const listarNotificacoes = (f: FiltroTela): Promise<ListaNotificacoes> =>
  ler(
    `${Q}/nsp/notificacoes${qs({
      situacao: f.situacao,
      tipo: f.tipo,
      classificacao: f.classificacao,
      prazo: f.prazo,
      unidade: f.unidade,
      de: f.de,
      ate: f.ate,
      protocolo: f.protocolo?.trim().toUpperCase(),
      pagina: f.pagina,
    })}`,
    esquemaLista,
  );
export const lerProximaNotificacao = () => ler(`${Q}/nsp/notificacoes/proxima`, esquemaProxima);
export const lerNotificacao = (id: number): Promise<DetalheNotificacaoResposta> =>
  ler(`${Q}/nsp/notificacoes/${String(id)}`, esquemaDetalheResposta);
export const buscarGestores = (busca: string) =>
  ler(`${Q}/nsp/gestores${qs({ busca: busca.trim() })}`, esquemaGestores);

const acao = (id: number, sufixo: string, corpo: unknown, chave: string): Promise<ResultadoNsp> =>
  enviar(`${Q}/nsp/notificacoes/${String(id)}/${sufixo}`, corpo, esquemaResultado, chave);

export const triarNotificacao = (
  id: number,
  c: {
    versao: number;
    tipo: string;
    tipoOutro: string | null;
    classificacao: string;
    dano: string;
    neverEvent: boolean;
    justificativa: string | null;
  },
  chave: string,
) => acao(id, 'triar', c, chave);
export const descartarNotificacao = (
  id: number,
  c: { versao: number; motivo: string; justificativa: string; duplicadaDe: string | null },
  chave: string,
) => acao(id, 'descartar', c, chave);
export const distribuirNotificacao = (
  id: number,
  c: { versao: number; gestor: string; unidade: number; prazoAnalise: string; orientacao: string | null },
  chave: string,
) => acao(id, 'distribuir', c, chave);
export const devolverAoNotificador = (id: number, c: { versao: number; texto: string }, chave: string) =>
  acao(id, 'devolutiva', c, chave);

export const lerFilaPrazos = (): Promise<FilaPrazos> => ler(`${Q}/nsp/prazos`, esquemaPrazos);
export const lerResumoPrazos = (): Promise<ResumoPrazos> =>
  ler(`${Q}/nsp/prazos/resumo`, esquemaResumoPrazos);
export const gerarCamposNotivisa = (id: number, chave: string): Promise<CamposNotivisa> =>
  enviar(`${Q}/nsp/notificacoes/${String(id)}/notivisa/campos`, {}, esquemaCampos, chave).then(
    (r) => r.campos,
  );
export const registrarTranscricao = (
  id: number,
  c: { versao: number; numeroNotivisa: string; transcritaEm: string },
  chave: string,
) => acao(id, 'notivisa/transcricao', c, chave);
