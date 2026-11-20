// Cliente das telas das integrações e do laboratório de apoio (M34), validado pelos contratos. As gravações vão com o
// CSRF e a Idempotency-Key; o segredo da credencial de um parceiro aparece só na resposta do cadastro (uma vez).
import {
  type CredencialEmitida,
  type EnvioLido,
  esquemaCredencialEmitida,
  esquemaEnvioLido,
  esquemaEstadoFhir,
  esquemaEstadoHl7,
  esquemaEstadoMensagens,
  esquemaMonitorIntegracoes,
  esquemaParceiroLido,
  esquemaRetornoApoioLido,
  esquemaVisaoParceiro,
  type EstadoFhir,
  type EstadoHl7,
  type EstadoMensagens,
  type MonitorIntegracoes,
  type ParceiroLido,
  type RetornoApoioLido,
  type VisaoParceiro,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';
import { novaChave } from '../relatorios/api-relatorios.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const I = '/api/integracoes';

export const lerMonitor = (): Promise<MonitorIntegracoes> => ler(`${I}/monitor`, esquemaMonitorIntegracoes);
export const tratarMorto = (id: string, acao: string, motivo: string): Promise<EnvioLido> =>
  enviar(`${I}/envios/${id}/tratar`, { acao, motivo }, esquemaEnvioLido, novaChave('tratar'));

const esquemaParceiros = z.object({
  novos: z.array(esquemaParceiroLido),
  leemOBanco: z.array(esquemaVisaoParceiro.extend({ oferta: z.array(z.string()) })),
  eventosDosGatilhos: z.array(z.string()),
});
export const lerParceiros = (): Promise<{
  novos: ParceiroLido[];
  leemOBanco: (VisaoParceiro & { oferta: string[] })[];
  eventosDosGatilhos: string[];
}> => ler(`${I}/parceiros`, esquemaParceiros);
export const criarParceiro = (
  p: unknown,
): Promise<{ parceiro: ParceiroLido; credencial: CredencialEmitida }> =>
  enviar(
    `${I}/parceiros`,
    p,
    z.object({ parceiro: esquemaParceiroLido, credencial: esquemaCredencialEmitida }),
    novaChave('parceiro'),
  );
export const alterarParceiro = (codigo: string, p: unknown): Promise<ParceiroLido> =>
  enviar(`${I}/parceiros/${codigo}`, p, esquemaParceiroLido, novaChave('parceiro'));
export const trocarCredencial = (codigo: string): Promise<CredencialEmitida> =>
  enviar(`${I}/parceiros/${codigo}/credencial`, {}, esquemaCredencialEmitida, novaChave('credencial'));
export const mensagemDeTeste = (codigo: string): Promise<{ evento: string }> =>
  enviar(`${I}/parceiros/${codigo}/teste`, {}, z.object({ evento: z.string() }), novaChave('teste'));

export const lerFhir = (): Promise<EstadoFhir> => ler(`${I}/fhir`, esquemaEstadoFhir);
export const enviarTesteFhir = () =>
  enviar(
    `${I}/fhir/teste`,
    {},
    z.object({
      ambiente: z.string(),
      valido: z.boolean(),
      problemas: z.array(z.string()),
      recibo: z.string(),
    }),
    novaChave('fhir'),
  );
export const lerHl7 = (): Promise<EstadoHl7> => ler(`${I}/hl7`, esquemaEstadoHl7);
export const lerMensagens = (): Promise<EstadoMensagens> => ler(`${I}/mensagens`, esquemaEstadoMensagens);

export const lerRetornos = (): Promise<RetornoApoioLido[]> =>
  ler(`${I}/apoio/retornos`, z.array(esquemaRetornoApoioLido));
export const conferirRetorno = (
  id: string,
  decisao: 'aprovar' | 'recusar',
  motivo: string | null,
): Promise<{ situacao: string; exame: number }> =>
  enviar(
    `${I}/apoio/retornos/${id}`,
    { decisao, motivo },
    z.object({ situacao: z.string(), exame: z.number() }),
    novaChave('conferir'),
  );
export const lerInterfacesApoio = () =>
  ler(
    `${I}/apoio/interfaces`,
    z.array(
      z.object({
        codigo: z.number(),
        nome: z.string().nullable(),
        laboratorio: z.string().nullable(),
        exames: z.number(),
      }),
    ),
  );
