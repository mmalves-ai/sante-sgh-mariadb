// Cliente das telas da portaria (M50, etapa 5). As leituras vêm tipadas pelos contratos; as gravações levam o CSRF e a
// Idempotency-Key (o mesmo pedido reenviado não grava duas vezes). Problem Details viram ErroApi.
import type {
  AcompanhanteLido,
  BloqueioVisitaLido,
  ContatoVisita,
  CrachaVisita,
  PacientePortaria,
  PainelAcompanhantes,
  PainelPortaria,
  PainelRegrasPortaria,
  PainelTerminais,
  RespostaCatraca,
  ResultadoPortaria,
  VisitanteLido,
} from '@sgh/contratos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const B = '/api/portaria';
const JSON_ACEITO = { accept: 'application/json' };

let seq = 0;
/** Chave de idempotência de um pedido (uma por ação da tela). */
export const novaChave = (prefixo: string) =>
  `${prefixo}-${Date.now().toString(36)}-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function consulta(x: Readonly<Record<string, string | number | undefined | null>>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(x)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: JSON_ACEITO });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function enviar<T>(url: string, corpo: unknown, prefixo: string): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave(prefixo),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export interface InternadoDaUnidade {
  readonly internacao: number;
  readonly nome: string;
  readonly leito: string;
  readonly unidade: string;
}
export type AvaliacaoPortaria = PacientePortaria & {
  readonly excepcionavel: boolean;
  readonly papel: string | null;
};

export const lerPainelPortaria = () => ler<PainelPortaria>(B);
export const buscarPacientesPortaria = (busca: string) =>
  ler<PacientePortaria[]>(`${B}/pacientes${consulta({ busca })}`);
export const avaliarVisitaPortaria = (
  internacao: number,
  visitante: number | null,
  identificacao: number | null,
) =>
  ler<AvaliacaoPortaria>(`${B}/pacientes/${internacao}/avaliacao${consulta({ visitante, identificacao })}`);
export const buscarVisitantes = (o: { busca?: string; tipo?: string; documento?: string }) =>
  ler<VisitanteLido[]>(`${B}/visitantes${consulta(o)}`);
/** A internação de que o visitante é o acompanhante vigente com direito legal (entra mesmo com o sigilo). */
export const lerAcompanhamento = (visitante: number) =>
  ler<{ paciente: PacientePortaria | null }>(`${B}/visitantes/${visitante}/acompanhamento`);
export const lerFotoVisitante = (id: number) =>
  ler<{ tipo: string; conteudo: string }>(`${B}/visitantes/${id}/foto`);
export const registrarVisitante = (corpo: unknown) =>
  enviar<ResultadoPortaria>(`${B}/visitantes`, corpo, 'visitante');
export const registrarVisita = (corpo: unknown) => enviar<ResultadoPortaria>(`${B}/visitas`, corpo, 'visita');
export const lerCracha = (visita: number) => ler<CrachaVisita>(`${B}/visitas/${visita}/cracha`);
export const registrarSaida = (visita: number) =>
  enviar<ResultadoPortaria>(`${B}/visitas/${visita}/saida`, {}, `saida-${visita}`);

export const lerRegrasPortaria = () => ler<PainelRegrasPortaria>(`${B}/regras`);
export const lerInternadosRegras = (unidade: string) =>
  ler<InternadoDaUnidade[]>(`${B}/regras/internados${consulta({ unidade })}`);
export const definirRegraVisita = (corpo: unknown) =>
  enviar<ResultadoPortaria>(`${B}/regras`, corpo, 'regra');
export const bloquearVisita = (corpo: unknown) =>
  enviar<ResultadoPortaria>(`${B}/bloqueios`, corpo, 'bloqueio');
export const revogarBloqueio = (id: number, motivo: string) =>
  enviar<ResultadoPortaria>(`${B}/bloqueios/${id}/revogacao`, { motivo }, `revogar-${id}`);
export const expurgarVisitantes = () => enviar<ResultadoPortaria>(`${B}/visitantes/expurgo`, {}, 'expurgo');
export const lerContatos = (o: {
  internacao?: number | null;
  unidade?: string | null;
  de: string;
  ate: string;
}) => ler<ContatoVisita[]>(`${B}/contatos${consulta(o)}`);
export const lerUnidadesContatos = () => ler<{ unidade: string; nome: string }[]>(`${B}/contatos/unidades`);
export const lerInternadosContatos = (unidade: string) =>
  ler<InternadoDaUnidade[]>(`${B}/contatos/internados${consulta({ unidade })}`);

export interface PainelBloqueioClinico {
  readonly unidades: { unidade: string; nome: string }[];
  readonly internados: InternadoDaUnidade[];
  readonly bloqueios: BloqueioVisitaLido[];
  readonly gravacao: PainelPortaria['gravacao'];
}
export const lerBloqueiosClinicos = (unidade: string | null) =>
  ler<PainelBloqueioClinico>(`${B}/bloqueios-clinicos${consulta({ unidade })}`);
export const bloquearClinico = (corpo: unknown) =>
  enviar<ResultadoPortaria>(`${B}/bloqueios-clinicos`, corpo, 'bloqueio-clinico');
export const revogarClinico = (id: number, motivo: string) =>
  enviar<ResultadoPortaria>(`${B}/bloqueios-clinicos/${id}/revogacao`, { motivo }, `revogar-clinico-${id}`);

export const lerAcompanhantes = (unidade: string | null) =>
  ler<PainelAcompanhantes & { internados: InternadoDaUnidade[] }>(
    `${B}/acompanhantes${consulta({ unidade })}`,
  );
/** A busca e o cadastro mínimo da pessoa pela permissão do acompanhante (a recepção interna). */
export const buscarPessoasAcompanhante = (o: { busca?: string; tipo?: string; documento?: string }) =>
  ler<VisitanteLido[]>(`${B}/acompanhantes/visitantes${consulta(o)}`);
export const registrarPessoaAcompanhante = (corpo: unknown) =>
  enviar<ResultadoPortaria>(`${B}/acompanhantes/visitantes`, corpo, 'pessoa-acompanhante');
export const registrarAcompanhante = (corpo: unknown) =>
  enviar<ResultadoPortaria & { aviso: string | null }>(`${B}/acompanhantes`, corpo, 'acompanhante');
export const encerrarAcompanhante = (id: number, motivo: string) =>
  enviar<ResultadoPortaria>(`${B}/acompanhantes/${id}/fim`, { motivo }, `fim-acompanhante-${id}`);
export type { AcompanhanteLido };

export const lerTerminais = () => ler<PainelTerminais>(`${B}/terminais`);
export const gravarTerminal = (id: number | null, corpo: unknown) =>
  enviar<ResultadoPortaria>(id === null ? `${B}/terminais` : `${B}/terminais/${id}`, corpo, 'terminal');
export const simularCatraca = (corpo: unknown) =>
  enviar<RespostaCatraca>(`${B}/catraca/simular`, corpo, 'simulador');
/** A regra de acesso do colaborador num terminal (inclui com `id` null; altera pela versão lida; nunca apaga). */
export const gravarRegraAcesso = (terminal: number, id: number | null, corpo: unknown) =>
  enviar<ResultadoPortaria>(
    id === null
      ? `${B}/terminais/${terminal}/regras-acesso`
      : `${B}/terminais/${terminal}/regras-acesso/${id}`,
    corpo,
    'terminal',
  );
/** Liga (ou, com `cracha` null, retira) o crachá do colaborador à matrícula. */
export const vincularCrachaColaborador = (corpo: { matricula: string; cracha: string | null }) =>
  enviar<ResultadoPortaria>(`${B}/crachas-colaborador`, corpo, 'terminal');
