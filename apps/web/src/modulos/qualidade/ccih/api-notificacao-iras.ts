// Cliente do envio mensal da notificação de IRAS ao órgão sanitário (F7, 09-AREA linha 68), validado na chegada. As
// competências fechadas vêm com o prazo, o atraso e os envios de cada formulário; a gravação vai com o CSRF e a
// Idempotency-Key (uma por intenção de gravar).
import { FORMULARIOS_IRAS, SITUACOES_ENVIO_IRAS } from '@sgh/dominio-qualidade';
import { z } from 'zod';
import { enviar, ler } from '../../exames/api-exames.js';

const C = '/api/qualidade/ccih/notificacao';

const formulario = z.enum(FORMULARIOS_IRAS);
const situacao = z.enum(SITUACOES_ENVIO_IRAS);

const esquemaEnvio = z.object({
  id: z.number(),
  formulario,
  tipo: z.enum(['inicial', 'retificacao']),
  situacao,
  enviadoEm: z.string().nullable(),
  protocolo: z.string().nullable(),
  motivoRetificacao: z.string().nullable(),
  mensagemRetorno: z.string().nullable(),
  registradoEm: z.string().nullable(),
  registradoPor: z.string().nullable(),
  versao: z.number(),
});
export type EnvioIrasDaTela = z.infer<typeof esquemaEnvio>;

const esquemaCompetencia = z.object({
  id: z.number(),
  competencia: z.string(),
  situacao: z.string(),
  prazo: z.string(),
  atrasada: z.boolean(),
  formularios: z.array(z.object({ formulario, ultima: situacao, atrasado: z.boolean() })),
  envios: z.array(esquemaEnvio),
  versao: z.number(),
});
export type CompetenciaNotificacaoDaTela = z.infer<typeof esquemaCompetencia>;

export interface NovoEnvioIras {
  readonly formulario: (typeof FORMULARIOS_IRAS)[number];
  readonly situacao: 'pendente' | 'transcrita';
  readonly enviadoEm: string | null;
  readonly protocolo: string | null;
  readonly motivoRetificacao: string | null;
}

export interface AndamentoEnvioIras {
  readonly versao: number;
  readonly situacao: (typeof SITUACOES_ENVIO_IRAS)[number];
  readonly enviadoEm: string | null;
  readonly protocolo: string | null;
  readonly mensagemRetorno: string | null;
}

export const lerCompetenciasNotificacao = () => ler(C, z.array(esquemaCompetencia));
export const registrarEnvioIras = (competencia: number, e: NovoEnvioIras, chave: string) =>
  enviar(
    `${C}/${String(competencia)}/envios`,
    e,
    z.object({ id: z.number(), tipo: z.enum(['inicial', 'retificacao']), situacao }),
    chave,
  );
export const registrarAndamentoIras = (envio: number, a: AndamentoEnvioIras, chave: string) =>
  enviar(
    `${C}/envios/${String(envio)}/andamento`,
    a,
    z.object({ id: z.number(), situacao, versao: z.number() }),
    chave,
  );
