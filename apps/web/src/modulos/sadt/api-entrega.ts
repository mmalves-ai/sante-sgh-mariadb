// Cliente da API da entrega de resultados (F3.5, 05-SADT linha 21): o balcão (visão por paciente e protocolo de
// entrega) e o cadastro do prazo de entrega, do exame restrito no portal e do perfil do portal.
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const B = '/api/sadt/entregas';
const n = z.number();
const txt = z.string();
const opcao = z.object({ id: n, nome: txt });

export const PRIORIDADES_PRAZO = ['rotina', 'urgencia', 'emergencia'] as const;
export const ATENDIMENTOS_PRAZO = [
  'ambulatorial',
  'externo',
  'urgencia',
  'internacao',
  'hospital_dia',
  'domiciliar',
] as const;
export const REGRAS_RESTRICAO = ['nunca_publicar', 'apos_entrega_presencial', 'apos_dias'] as const;
export const PUBLICOS_PORTAL = ['paciente', 'medico_externo', 'empresa', 'interno'] as const;
export const SITUACOES_PRAZO = [
  'sem_prazo',
  'no_prazo',
  'atrasado',
  'liberado_no_prazo',
  'liberado_atrasado',
] as const;

const exameNoBalcao = z.object({
  item: n,
  pedido: txt,
  exame: txt,
  setor: txt.nullable(),
  pedidoEm: txt,
  liberado: z.boolean(),
  previsto: txt.nullable(),
  situacaoPrazo: z.enum(SITUACOES_PRAZO),
});
const protocolo = z.object({
  id: n,
  numero: txt,
  situacao: z.enum(['entregue', 'cancelada']),
  entregueEm: txt,
  entreguePor: txt.nullable(),
  forma: txt.nullable(),
  retiradoPeloPaciente: z.boolean(),
  nomeResponsavel: txt.nullable(),
  documentoResponsavel: txt.nullable(),
  motivoCancelamento: txt.nullable(),
  observacao: txt.nullable(),
  exames: z.array(z.object({ item: n, exame: txt, pedido: txt })),
});
export type ProtocoloEntrega = z.infer<typeof protocolo>;
const esquemaBalcao = z.object({
  paciente: z.object({ id: n, nome: txt, nascimento: txt.nullable() }).nullable(),
  prontos: z.array(exameNoBalcao),
  aguardando: z.array(exameNoBalcao),
  entregas: z.array(protocolo),
  formas: z.array(opcao),
  parentescos: z.array(opcao),
});
export type BalcaoEntrega = z.infer<typeof esquemaBalcao>;

const esquemaCadastro = z.object({
  prazos: z.array(
    z.object({
      id: n,
      exame: n,
      exameNome: txt,
      setor: n.nullable(),
      setorSolicitante: n.nullable(),
      material: n.nullable(),
      prioridade: z.enum(PRIORIDADES_PRAZO),
      tipoAtendimento: z.enum(ATENDIMENTOS_PRAZO).nullable(),
      prazoDias: n,
      prazoMinutos: n.nullable(),
      horarioCorte: txt.nullable(),
      diasDaSemana: z.array(z.boolean()),
      ativo: z.boolean(),
    }),
  ),
  restricoes: z.array(
    z.object({
      id: n,
      exame: n,
      exameNome: txt,
      regra: z.enum(REGRAS_RESTRICAO),
      diasCarencia: n.nullable(),
      motivo: txt.nullable(),
      global: z.boolean(),
      ativo: z.boolean(),
    }),
  ),
  perfis: z.array(
    z.object({
      id: n,
      versao: n,
      codigo: txt,
      descricao: txt,
      publico: z.enum(PUBLICOS_PORTAL),
      setores: z.array(n),
      ocultaExameRestrito: z.boolean(),
      diasVisibilidade: n.nullable(),
      global: z.boolean(),
      ativo: z.boolean(),
    }),
  ),
  setores: z.array(opcao),
  setoresSolicitantes: z.array(opcao),
  materiais: z.array(opcao),
});
export type CadastroEntrega = z.infer<typeof esquemaCadastro>;
export type PerfilPortalCadastrado = CadastroEntrega['perfis'][number];

const esquemaId = z.object({ id: n });
const esquemaEntregaFeita = z.object({ id: n, numero: txt });

export const lerBalcao = (busca: string) => ler(`${B}/balcao${qs({ busca })}`, esquemaBalcao);
export const registrarEntrega = (c: Record<string, unknown>, chave: string) =>
  enviar(B, c, esquemaEntregaFeita, chave);
export const cancelarEntrega = (id: number, motivo: string, chave: string) =>
  enviar(`${B}/protocolo/${id}/cancelar`, { motivo }, esquemaId, chave);
export const lerCadastroEntrega = () => ler(`${B}/cadastro`, esquemaCadastro);
export const incluirPrazoEntrega = (c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/prazos`, c, esquemaId, chave);
export const incluirRestricaoPortal = (c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/restricoes`, c, esquemaId, chave);
export const salvarPerfilPortal = (c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/perfis`, c, esquemaId, chave);
export const desativarCadastroEntrega = (tipo: 'prazo' | 'restricao' | 'perfil', id: number, chave: string) =>
  enviar(`${B}/${tipo}/${id}/desativar`, {}, esquemaId, chave);
