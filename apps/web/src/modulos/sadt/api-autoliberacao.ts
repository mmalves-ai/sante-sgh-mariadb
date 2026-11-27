// Cliente da API da autoliberação do resultado (F8, 05-SADT linha 11): a fila de conferência do responsável técnico e
// o cadastro (regras com condições, limites de delta, substâncias interferentes). A liberação do retido usa a rota de
// liberar do resultado (/api/sadt/exames-pedidos/:exame/resultado/liberar).
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const B = '/api/sadt/autoliberacao';
const n = z.number();
const txt = z.string();

export type MotivoRetencao =
  'critico' | 'delta' | 'interferente' | 'curva' | 'regra-reter' | 'sem-regra-atendida';

const esquemaFila = z.array(
  z.object({
    exameItem: n,
    resultado: n,
    paciente: n,
    pacienteNome: txt,
    exame: txt,
    setor: txt,
    avaliadoEm: txt,
    motivos: z.array(txt),
    interferentes: z.array(txt),
    critico: z.boolean(),
  }),
);
export type RetidoNaFila = z.infer<typeof esquemaFila>[number];

const esquemaCondicao = z.object({
  tipo: txt,
  analito: n.nullable(),
  operador: txt.nullable(),
  valor: txt.nullable(),
  minimo: n.nullable(),
  maximo: n.nullable(),
  deltaPercentual: n.nullable(),
  deltaJanelaHoras: n.nullable(),
});

const opcao = z.object({ id: n, nome: txt });
const esquemaCadastro = z.object({
  regras: z.array(
    z.object({
      id: n,
      codigo: txt,
      descricao: txt,
      exame: n,
      exameNome: txt,
      setor: n.nullable(),
      acao: txt,
      prioridade: n,
      vigenciaInicio: txt.nullable(),
      vigenciaFim: txt.nullable(),
      ativo: z.boolean(),
      condicoes: z.array(esquemaCondicao),
    }),
  ),
  limitesDelta: z.array(
    z.object({
      id: n,
      analito: n,
      analitoNome: txt,
      tipo: txt,
      variacaoMaxima: n,
      janelaHoras: n,
      acao: txt,
      vigenciaInicio: txt.nullable(),
      vigenciaFim: txt.nullable(),
      ativo: z.boolean(),
    }),
  ),
  interferentes: z.array(
    z.object({
      id: n,
      exame: n,
      exameNome: txt,
      analito: n.nullable(),
      principioAtivo: n.nullable(),
      principioNome: txt.nullable(),
      substancia: txt,
      efeito: txt,
      mensagem: txt.nullable(),
      bloqueia: z.boolean(),
      ativo: z.boolean(),
    }),
  ),
  opcoes: z.object({
    exames: z.array(opcao),
    analitos: z.array(opcao.extend({ exame: n })),
    setores: z.array(opcao),
  }),
});
export type CadastroAutoliberacao = z.infer<typeof esquemaCadastro>;

export interface CondicaoNova {
  tipo: 'faixa' | 'delta' | 'analito_relacionado' | 'idade' | 'sexo';
  analito: number | null;
  operador: 'entre' | 'maior' | 'maior_igual' | 'menor' | 'menor_igual' | 'igual' | null;
  valor: string | null;
  minimo: number | null;
  maximo: number | null;
  deltaPercentual: number | null;
  deltaJanelaHoras: number | null;
}

const esquemaId = z.object({ id: n });

export const lerFilaConferencia = () => ler(`${B}/fila`, esquemaFila);
export const lerCadastroAutoliberacao = () => ler(B, esquemaCadastro);
export const buscarPrincipios = (busca: string) =>
  ler(`${B}/principios?busca=${encodeURIComponent(busca)}`, z.array(opcao));

export const incluirRegraAutoliberacao = (
  corpo: {
    codigo: string;
    descricao: string;
    exame: number;
    setor: number | null;
    acao: 'liberar' | 'reter';
    prioridade: number;
    vigenciaInicio: string;
    vigenciaFim: string | null;
    condicoes: CondicaoNova[];
  },
  chave: string,
) => enviar(`${B}/regras`, corpo, esquemaId, chave);

export const incluirLimiteDelta = (
  corpo: {
    analito: number;
    tipo: 'percentual' | 'absoluta';
    variacaoMaxima: number;
    janelaHoras: number;
    acao: 'alertar' | 'reter_revisao' | 'bloquear_autoliberacao';
    vigenciaInicio: string;
  },
  chave: string,
) => enviar(`${B}/limites-delta`, corpo, esquemaId, chave);

export const incluirInterferente = (
  corpo: {
    exame: number;
    analito: number | null;
    principioAtivo: number | null;
    substancia: string;
    efeito: 'aumenta' | 'diminui' | 'variavel' | 'invalida';
    mensagem: string | null;
    bloqueia: boolean;
  },
  chave: string,
) => enviar(`${B}/interferentes`, corpo, esquemaId, chave);

export const desativarCadastroAutoliberacao = (
  tipo: 'regras' | 'limites-delta' | 'interferentes',
  id: number,
  chave: string,
) => enviar(`${B}/${tipo}/${id}/desativar`, {}, esquemaId, chave);

const esquemaLiberado = z.object({ resultado: n, exame: n, situacao: txt }).passthrough();
export const liberarRetido = (exameItem: number, chave: string) =>
  enviar(`/api/sadt/exames-pedidos/${exameItem}/resultado/liberar`, {}, esquemaLiberado, chave);

/** Condições da amostra cadastradas para o exame (hemólise, lipemia...), que a bancada aponta na digitação. */
export const listarCondicoesDaAmostra = (exame: number) =>
  ler(
    `${B}/amostra?exame=${exame}`,
    z.array(z.object({ id: n, substancia: txt, efeito: txt, bloqueia: z.boolean() })),
  );
