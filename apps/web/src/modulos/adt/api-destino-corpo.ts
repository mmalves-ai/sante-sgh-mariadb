// Cliente das rotas do destino do corpo após o óbito (C1-112, 09-AREA linha 74): /api/internacao/destino-corpo.
// Funerárias do estabelecimento, funerária e cartório na declaração de óbito e guarda e liberação do corpo.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/internacao/destino-corpo';
const n = z.number();
const txt = z.string();

export const esquemaFuneraria = z.object({
  id: n,
  nome: txt,
  telefone: txt.nullable(),
  telefonePlantao: txt.nullable(),
  email: txt.nullable(),
  documentosExigidos: txt.nullable(),
  observacao: txt.nullable(),
  ativo: z.boolean(),
  versao: n,
});
export type Funeraria = z.infer<typeof esquemaFuneraria>;

const esquemaApoio = z.object({
  funerarias: z.array(esquemaFuneraria),
  cartorios: z.array(z.object({ id: n, descricao: txt, padrao: z.boolean() })),
  parentescos: z.array(z.object({ id: n, descricao: txt })),
});
export type ApoioDestinoCorpo = z.infer<typeof esquemaApoio>;

export const SITUACOES_GUARDA = [
  'em_guarda',
  'liberado',
  'retirado',
  'encaminhado_iml',
  'cancelado',
] as const;
export const esquemaObitoDestino = z.object({
  declaracao: n,
  versao: n,
  paciente: n,
  pacienteNome: txt.nullable(),
  atendimento: n,
  numero: txt.nullable(),
  situacao: z.enum(['rascunho', 'emitida', 'cancelada']),
  obitoEm: txt,
  encaminhadoServicoVerificacao: z.boolean(),
  funeraria: z.object({ id: n, nome: txt, telefonePlantao: txt.nullable() }).nullable(),
  cartorio: z.object({ id: n, descricao: txt }).nullable(),
  guarda: z
    .object({
      id: n,
      situacao: z.enum(SITUACOES_GUARDA),
      entradaNecroterio: txt.nullable(),
      localGuarda: txt.nullable(),
      encaminhadoIml: z.boolean(),
      funeraria: n.nullable(),
      retiranteNome: txt.nullable(),
      documentosConferidos: z.boolean(),
      declaracaoEntregue: z.boolean(),
      pertencesEntregues: z.boolean(),
      liberadoEm: txt.nullable(),
      retiradoEm: txt.nullable(),
      versao: n,
    })
    .nullable(),
  pendencias: z.array(txt),
});
export type ObitoDestino = z.infer<typeof esquemaObitoDestino>;

export const lerApoioDestinoCorpo = () => ler(`${C}/apoio`, esquemaApoio);
export const lerFunerarias = (todas: boolean) =>
  ler(`${C}/funerarias${todas ? '?todas=1' : ''}`, z.array(esquemaFuneraria));
export const lerObitosDestino = (todos: boolean) =>
  ler(`${C}/obitos${todos ? '?todos=1' : ''}`, z.array(esquemaObitoDestino));
export const lerObitoDoPaciente = (paciente: number) =>
  ler(`${C}/pacientes/${paciente}`, esquemaObitoDestino.nullable());

export interface CorpoFuneraria {
  nome: string;
  telefone: string | null;
  telefonePlantao: string | null;
  email: string | null;
  documentosExigidos: string | null;
  observacao: string | null;
}
const okId = z.object({ id: n }).passthrough();
export const incluirFuneraria = (corpo: CorpoFuneraria) =>
  enviar(`${C}/funerarias`, corpo, okId, novaChave('funeraria-incluir'));
export const alterarFuneraria = (id: number, corpo: CorpoFuneraria & { versao: number }) =>
  enviar(`${C}/funerarias/${id}`, corpo, okId, novaChave('funeraria-alterar'));
export const usoFuneraria = (id: number, corpo: { ativo: boolean; versao: number }) =>
  enviar(`${C}/funerarias/${id}/uso`, corpo, okId, novaChave('funeraria-uso'));
export const definirDestinoCorpo = (
  declaracao: number,
  corpo: { funeraria: number | null; cartorio: number | null; versao: number },
) => enviar(`${C}/declaracoes/${declaracao}/destino`, corpo, esquemaObitoDestino, novaChave('obito-destino'));
export const abrirGuardaCorpo = (corpo: {
  declaracao: number;
  entradaNecroterio: string | null;
  localGuarda: string | null;
  observacao: string | null;
}) => enviar(`${C}/guardas`, corpo, okId, novaChave('corpo-guarda'));
export const acaoGuardaCorpo = (id: number, corpo: Record<string, unknown>) =>
  enviar(`${C}/guardas/${id}/acao`, corpo, okId, novaChave('corpo-acao'));
