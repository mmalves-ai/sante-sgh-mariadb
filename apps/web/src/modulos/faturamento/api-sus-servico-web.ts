// Cliente das rotas da troca por serviço web com o SUS (F7, 08-INTG linha 131, C1-054): /api/sus/servicos-web —
// o rastreamento de câncer (exame pedido do paciente, pela linha de cuidado) e o cadastro de prestador (profissional
// com cartão e ocupação). Fora de produção responde o simulador (regra 6); o modo vem na leitura do painel.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/sus/servicos-web';

export const SERVICOS_WEB_SUS_TELA = ['rastreamento_cancer', 'cadastro_prestador'] as const;
export type ServicoWebSusTela = (typeof SERVICOS_WEB_SUS_TELA)[number];
export const LINHAS_CUIDADO_SUS_TELA = ['colo_utero', 'mama'] as const;
export type LinhaCuidadoSusTela = (typeof LINHAS_CUIDADO_SUS_TELA)[number];
export const SITUACOES_ENVIO_SUS_TELA = [
  'pendente',
  'enviado',
  'aceito',
  'aceito_com_critica',
  'rejeitado',
  'cancelado',
  'erro',
] as const;
export type SituacaoEnvioSusTela = (typeof SITUACOES_ENVIO_SUS_TELA)[number];

const texto = z.string().nullable();
const numero = z.number().nullable();

export const esquemaEnvioServicoWebSus = z.object({
  id: z.number(),
  servico: z.string(),
  situacao: z.string(),
  tentativas: z.number(),
  protocolo: texto,
  cnsInformado: texto,
  cnsConfirmado: texto,
  paciente: numero,
  pacienteNome: texto,
  prontuario: texto,
  exameItem: numero,
  exameNome: texto,
  profissional: numero,
  profissionalNome: texto,
  criadoEm: texto,
  enviadoEm: texto,
  respondidoEm: texto,
  versao: z.number(),
  retornos: z.array(
    z.object({
      sequencia: z.number(),
      recebidoEm: texto,
      tipo: z.string(),
      codigo: texto,
      campo: texto,
      mensagem: texto,
    }),
  ),
});
export type EnvioServicoWebSus = z.infer<typeof esquemaEnvioServicoWebSus>;

export const esquemaPainelServicoWebSus = z.object({
  itens: z.array(esquemaEnvioServicoWebSus),
  modo: z.enum(['simulador', 'producao']),
});
export type PainelServicoWebSus = z.infer<typeof esquemaPainelServicoWebSus>;

export const esquemaRastreamentoSus = z.object({
  paciente: z.object({ id: z.number(), nome: z.string(), temCns: z.boolean() }).nullable(),
  exames: z.array(
    z.object({
      exameItem: z.number(),
      exame: z.string(),
      requisicao: z.string(),
      solicitadoEm: z.string(),
      situacao: z.string(),
      envio: numero,
      envioSituacao: texto,
    }),
  ),
});
export type RastreamentoSus = z.infer<typeof esquemaRastreamentoSus>;

export const esquemaPrestadoresSus = z.object({
  itens: z.array(
    z.object({ id: z.number(), nome: z.string(), temCns: z.boolean(), cbo: texto, ativo: z.boolean() }),
  ),
});
export type PrestadorSus = z.infer<typeof esquemaPrestadoresSus>['itens'][number];

const esquemaGravado = z
  .object({ envio: z.number(), situacao: z.string(), protocolo: texto.optional() })
  .passthrough();
export type EnvioServicoWebSusGravado = z.infer<typeof esquemaGravado>;

export type RegistrarServicoWebSus =
  | { servico: 'rastreamento_cancer'; exameItem: number; linha: LinhaCuidadoSusTela }
  | { servico: 'cadastro_prestador'; profissional: number };

export interface FiltroServicoWebSusTela {
  servico?: ServicoWebSusTela;
  situacao?: SituacaoEnvioSusTela;
  paciente?: number;
}

/** A query string só com os filtros preenchidos (nada de parâmetro vazio). */
export function consultaServicoWebSus(f: FiltroServicoWebSusTela): string {
  const q = new URLSearchParams();
  if (f.servico) q.set('servico', f.servico);
  if (f.situacao) q.set('situacao', f.situacao);
  if (f.paciente) q.set('paciente', String(f.paciente));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const lerServicosWebSus = (f: FiltroServicoWebSusTela = {}) =>
  ler(`${B}${consultaServicoWebSus(f)}`, esquemaPainelServicoWebSus);

export const lerRastreamentoSus = (prontuario: string) =>
  ler(`${B}/rastreamento?prontuario=${encodeURIComponent(prontuario)}`, esquemaRastreamentoSus);

export const buscarPrestadoresSus = (termo: string) =>
  ler(`${B}/prestadores?termo=${encodeURIComponent(termo)}`, esquemaPrestadoresSus);

export const registrarServicoWebSus = (corpo: RegistrarServicoWebSus) =>
  enviar(B, corpo, esquemaGravado, novaChave('sus-servico-web'));

export const enviarServicoWebSus = (id: number) =>
  enviar(`${B}/${id}/envio`, {}, esquemaGravado, novaChave('sus-servico-web-envio'));

export const cancelarServicoWebSus = (id: number, versao: number, motivo: string) =>
  enviar(
    `${B}/${id}/cancelamento`,
    { versao, motivo },
    esquemaGravado,
    novaChave('sus-servico-web-cancelar'),
  );
