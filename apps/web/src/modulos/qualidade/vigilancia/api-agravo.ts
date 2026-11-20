// Cliente da notificação compulsória (M48, etapa 4), validado na chegada. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção de gravar); Problem Details viram ErroApi e o código da recusa fica em
// `problema.codigo` para a tela mostrar o texto certo (os textos das recusas ficam em @sgh/dominio-qualidade, os mesmos
// da API).
import {
  type AbrirCasoAgravoEntrada,
  CODIGOS_AUTORIDADE_SANITARIA,
  CODIGOS_CANAL_NOTIFICACAO_AGRAVO,
  CODIGOS_MOTIVO_DESCARTE_AGRAVO,
  CODIGOS_ORIGEM_CASO_AGRAVO,
  CODIGOS_PERIODICIDADE_AGRAVO,
  CODIGOS_SITUACAO_CASO_AGRAVO,
  type ConfigurarGatilhoExameEntrada,
  type DescartarCasoAgravoEntrada,
  type RegistrarNotificacaoAgravoEntrada,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../../exames/api-exames.js';

export { codigoDaRecusa } from '../../exames/api-exames.js';

const A = '/api/qualidade/vigilancia/agravos';

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChaveAgravo(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m48a.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

// ── Esquemas das respostas ──────────────────────────────────────────────────────────────────────────

const n = z.number();
const nN = z.number().nullable();
const s = z.string();
const sN = z.string().nullable();
const periodicidade = z.enum(CODIGOS_PERIODICIDADE_AGRAVO);
const estadoPrazo = z.enum(['noPrazo', 'vencendo', 'vencido', 'cumprido', 'naoSeAplica']);

const esquemaPaciente = z.object({
  id: n,
  nome: s,
  prontuario: nN,
  nascimento: sN,
  sexo: z.enum(['M', 'F']).nullable(),
});

export const esquemaResumoAgravos = z.object({
  abertos: n,
  imediatosAbertos: n,
  vencidos: n,
  gatilhosSemCaso: n,
  notificadosNoMes: n,
  ligada: z.boolean(),
  motivo: sN,
  podeNotificar: z.boolean(),
  agora: s,
});
export type ResumoAgravosTela = z.infer<typeof esquemaResumoAgravos>;

export const esquemaGatilho = z.object({
  chave: s,
  origem: z.enum(['cid', 'exame', 'obito']),
  atendimento: n,
  exame: nN,
  paciente: esquemaPaciente,
  cid: s,
  nomeCid: s,
  periodicidade,
  gatilhoEm: s,
  prazoEm: s,
  estadoPrazo,
  exameNome: sN,
  resultado: sN,
  unidade: sN,
});
export type GatilhoTela = z.infer<typeof esquemaGatilho>;
const esquemaFila = z.object({ itens: z.array(esquemaGatilho), cortada: z.boolean(), desde: s });
export type FilaGatilhos = z.infer<typeof esquemaFila>;

export const esquemaCaso = z.object({
  id: n,
  versao: n,
  situacao: z.enum(CODIGOS_SITUACAO_CASO_AGRAVO),
  origem: z.enum(CODIGOS_ORIGEM_CASO_AGRAVO),
  atendimento: nN,
  exame: nN,
  paciente: esquemaPaciente,
  cid: s,
  nomeCid: s,
  periodicidade,
  gatilhoEm: s,
  prazoEm: s,
  estadoPrazo,
  horasRestantes: nN,
  fichaModelo: nN,
  autoridade: z.enum(CODIGOS_AUTORIDADE_SANITARIA).nullable(),
  canal: z.enum(CODIGOS_CANAL_NOTIFICACAO_AGRAVO).nullable(),
  numero: sN,
  notificadoEm: sN,
  recebidoPor: sN,
  motivoDescarte: z.enum(CODIGOS_MOTIVO_DESCARTE_AGRAVO).nullable(),
  justificativaDescarte: sN,
  observacao: sN,
  abertoPor: s,
  abertoEm: s,
  encerradoPor: sN,
  encerradoEm: sN,
});
export type CasoTela = z.infer<typeof esquemaCaso>;
const esquemaCasos = z.object({ itens: z.array(esquemaCaso), total: n, pagina: n, porPagina: n });
export type PaginaCasos = z.infer<typeof esquemaCasos>;

const esquemaFicha = z.object({
  caso: n,
  modelo: z.object({ id: n, nome: s }).nullable(),
  perguntas: z.array(z.object({ codigo: n, subcodigo: n, texto: s, valor: sN })),
  preenchidas: n,
  generica: z.boolean(),
});
export type FichaTela = z.infer<typeof esquemaFicha>;

const esquemaCids = z.object({
  itens: z.array(z.object({ cid: s, nome: s, periodicidade })),
  total: n,
});
export type CidsNotificaveis = z.infer<typeof esquemaCids>;

const esquemaGatilhoExame = z.object({
  id: nN,
  versao: nN,
  padrao: s,
  exceto: sN,
  cid: s,
  ativo: z.boolean(),
  fonte: z.enum(['padrao', 'configurado']),
});
export type GatilhoExameTela = z.infer<typeof esquemaGatilhoExame>;
const esquemaGatilhosExame = z.object({ itens: z.array(esquemaGatilhoExame) });

const esquemaAberto = z.object({ id: n, periodicidade, prazoEm: s });
export type CasoAberto = z.infer<typeof esquemaAberto>;
const esquemaNotificado = z.object({ versao: n, comAtraso: z.boolean() });
export type CasoNotificado = z.infer<typeof esquemaNotificado>;
const esquemaVersao = z.object({ versao: n });
const esquemaGatilhoGravado = z.object({ id: n, versao: n });

// ── Chamadas ────────────────────────────────────────────────────────────────────────────────────────

export const lerResumoAgravos = (): Promise<ResumoAgravosTela> => ler(`${A}/resumo`, esquemaResumoAgravos);
export const lerGatilhos = (dias: number, origem?: string | undefined): Promise<FilaGatilhos> =>
  ler(`${A}/gatilhos${qs({ dias, origem })}`, esquemaFila);
export const lerCasos = (f: {
  situacao?: string | undefined;
  periodicidade?: string | undefined;
  desde?: string | null | undefined;
  ate?: string | null | undefined;
  pagina?: number | undefined;
}): Promise<PaginaCasos> => ler(`${A}/casos${qs({ ...f, porPagina: 50 })}`, esquemaCasos);
export const lerCaso = (id: number): Promise<CasoTela> => ler(`${A}/casos/${String(id)}`, esquemaCaso);
export const lerFicha = (id: number): Promise<FichaTela> =>
  ler(`${A}/casos/${String(id)}/ficha`, esquemaFicha);
export const lerCids = (busca: string): Promise<CidsNotificaveis> =>
  ler(`${A}/cids${qs({ busca })}`, esquemaCids);
export const lerGatilhosExame = () => ler(`${A}/gatilhos-exame`, esquemaGatilhosExame);

export const abrirCaso = (e: AbrirCasoAgravoEntrada, chave: string): Promise<CasoAberto> =>
  enviar(`${A}/casos`, e, esquemaAberto, chave);
export const notificarCaso = (
  id: number,
  e: Omit<RegistrarNotificacaoAgravoEntrada, 'caso'>,
  chave: string,
): Promise<CasoNotificado> => enviar(`${A}/casos/${String(id)}/notificacao`, e, esquemaNotificado, chave);
export const descartarCaso = (id: number, e: Omit<DescartarCasoAgravoEntrada, 'caso'>, chave: string) =>
  enviar(`${A}/casos/${String(id)}/descarte`, e, esquemaVersao, chave);
export const configurarGatilhoExame = (e: ConfigurarGatilhoExameEntrada, chave: string) =>
  enviar(`${A}/gatilhos-exame`, e, esquemaGatilhoGravado, chave);
