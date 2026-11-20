// Esquemas das respostas do M27 (página inicial, filas do médico e da recepção, mensagens, avisos e dicionário): a tela
// valida o que a API devolve antes de mostrar (o mesmo padrão das respostas dos outros módulos). Os tipos continuam
// os de `worklist.ts` e `comunicacao.ts`; aqui só a validação na chegada.
import { z } from 'zod';
import type {
  CaixaMensagens,
  CentralAvisos,
  ComunicadoDetalhe,
  DicionarioPessoal,
  MensagemAnterior,
  MensagemRecebida,
} from './comunicacao.js';
import { ESTADOS_AVISO, EVENTOS_COMUNICADO, GRAVIDADES_AVISO, TIPOS_MENSAGEM } from './comunicacao.js';
import type { PaginaInicio, WorklistMedico, WorklistRecepcao } from './worklist.js';
import { COMPONENTES_INICIO, TIPOS_PENDENCIA_MEDICO } from './worklist.js';

const nulo = <T extends z.ZodType>(t: T) => t.nullable();

export const esquemaPaginaInicio = z.object({
  perfis: z.array(z.object({ id: z.enum(COMPONENTES_INICIO), titulo: z.string() })),
  componentes: z.array(
    z.object({
      id: z.enum(COMPONENTES_INICIO),
      titulo: z.string(),
      rota: z.string(),
      pendentes: nulo(z.number()),
      prioridade: z.number(),
      prazo: nulo(z.string()),
    }),
  ),
}) satisfies z.ZodType<PaginaInicio>;

export const esquemaWorklistMedico = z.object({
  pacientes: z.array(
    z.object({
      paciente: z.number(),
      nome: z.string(),
      idade: nulo(z.string()),
      sexo: nulo(z.string()),
      prontuario: z.string(),
      atendimento: z.number(),
      registro: z.number(),
      tipo: z.enum(['internacao', 'externo', 'urgencia']),
      unidade: nulo(z.string()),
      leito: nulo(z.string()),
      dias: nulo(z.number()),
      previsaoAlta: nulo(z.string()),
      alergias: z.enum(['lista', 'nega', 'nao-avaliadas']),
      pendencias: z.array(
        z.object({
          tipo: z.enum(TIPOS_PENDENCIA_MEDICO),
          quantidade: z.number(),
          prazo: nulo(z.string()),
          texto: z.string(),
          link: z.string(),
        }),
      ),
      prioridade: z.number(),
      prazo: nulo(z.string()),
    }),
  ),
  total: z.number(),
  teto: z.number(),
  limitado: z.boolean(),
  semVinculo: z.boolean(),
  geradaEm: z.string(),
}) satisfies z.ZodType<WorklistMedico>;

export const esquemaWorklistRecepcao = z.object({
  senhas: z.array(
    z.object({
      id: z.number(),
      senha: z.string(),
      prioridade: z.enum(['0', '1', '2']),
      grupo: nulo(z.number()),
      grupoDescricao: z.string(),
      emitidaEm: z.string(),
      esperaMinutos: z.number(),
      situacao: z.string(),
      gerador: z.string(),
    }),
  ),
  chegadas: z.array(
    z.object({
      marcacao: z.number(),
      hora: z.string(),
      paciente: z.string(),
      agenda: z.string(),
      chegou: z.boolean(),
    }),
  ),
  guias: z.array(
    z.object({
      reg: z.number(),
      paciente: z.string(),
      convenio: z.string(),
      abertoEm: z.string(),
      esperaMinutos: z.number(),
    }),
  ),
  teto: z.number(),
  cortada: z.boolean(),
  geradaEm: z.string(),
}) satisfies z.ZodType<WorklistRecepcao>;

export const esquemaMensagemRecebida = z.object({
  id: z.number(),
  tipo: z.enum(TIPOS_MENSAGEM),
  assunto: z.string(),
  texto: z.string(),
  remetente: z.string(),
  enviadaEm: z.string(),
  cienciaObrigatoria: z.boolean(),
  lidaEm: nulo(z.string()),
  cienciaEm: nulo(z.string()),
  contextoAtendimento: nulo(z.number()),
  contextoPaciente: nulo(z.number()),
  vigenciaInicio: nulo(z.string()),
  vigenciaFim: nulo(z.string()),
  via: z.string(),
  encerradoEm: nulo(z.string()),
  motivoEncerramento: nulo(z.string()),
}) satisfies z.ZodType<MensagemRecebida>;

export const esquemaCaixaMensagens = z.object({
  recebidas: z.array(esquemaMensagemRecebida),
  enviadas: z.array(
    z.object({
      id: z.number(),
      tipo: z.enum(TIPOS_MENSAGEM),
      assunto: z.string(),
      enviadaEm: z.string(),
      destinatarios: z.number(),
      lidas: z.number(),
      ciencias: z.number(),
      cienciaObrigatoria: z.boolean(),
      vigenciaInicio: nulo(z.string()),
      vigenciaFim: nulo(z.string()),
      encerradoEm: nulo(z.string()),
    }),
  ),
  naoLidas: z.number(),
  cienciasPendentes: z.number(),
  teto: z.number(),
}) satisfies z.ZodType<CaixaMensagens>;

/** W0-09: o comunicado por inteiro (texto, vigência, ciências e eventos). */
export const esquemaComunicadoDetalhe = z.object({
  id: z.number(),
  remetente: z.string(),
  assunto: z.string(),
  texto: z.string(),
  cienciaObrigatoria: z.boolean(),
  publicadoEm: z.string(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string(),
  encerradoEm: nulo(z.string()),
  encerradoPor: nulo(z.string()),
  motivoEncerramento: nulo(z.string()),
  destinatarios: z.array(
    z.object({ login: z.string(), via: z.string(), lidaEm: nulo(z.string()), cienciaEm: nulo(z.string()) }),
  ),
  eventos: z.array(
    z.object({
      evento: z.enum(EVENTOS_COMUNICADO),
      antes: nulo(z.string()),
      motivo: z.string(),
      por: z.string(),
      em: z.string(),
    }),
  ),
  podeCorrigir: z.boolean(),
}) satisfies z.ZodType<ComunicadoDetalhe>;

export const esquemaMensagensAnteriores = z.object({
  mensagens: z.array(
    z.object({
      sequencia: z.number(),
      origem: nulo(z.string()),
      texto: z.string(),
      enviadaEm: nulo(z.string()),
      lidaEm: nulo(z.string()),
    }) satisfies z.ZodType<MensagemAnterior>,
  ),
  teto: z.number(),
});

export const esquemaEnvioMensagem = z.object({
  id: z.number(),
  destinatarios: z.number(),
  repetida: z.boolean(),
});

export const esquemaCentralAvisos = z.object({
  avisos: z.array(
    z.object({
      id: z.number(),
      tipo: z.string(),
      gravidade: z.enum(GRAVIDADES_AVISO),
      modulo: z.string(),
      titulo: z.string(),
      link: nulo(z.string()),
      estado: z.enum(ESTADOS_AVISO),
      criadoEm: z.string(),
    }),
  ),
  novos: z.number(),
  versao: z.number(),
}) satisfies z.ZodType<CentralAvisos>;

export const esquemaMudancaAviso = z.object({ mudou: z.boolean() });

export const esquemaDicionarioPessoal = z.object({
  palavras: z.array(z.object({ palavra: z.string(), fonetica: z.string() })),
  teto: z.number(),
  gravacao: z.object({ incluir: nulo(z.string()), excluir: nulo(z.string()) }),
}) satisfies z.ZodType<DicionarioPessoal>;

export const esquemaGravacaoPalavra = z.object({ repetida: z.boolean() });
