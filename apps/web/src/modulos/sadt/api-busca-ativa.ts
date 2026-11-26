// Cliente da API da busca ativa de resultados (F8, 05-SADT linha 24): a fila dos resultados críticos, alterados ou
// de cultura positiva liberados depois da alta, os candidatos ainda fora da fila, o caso com exames, contatos e
// equipe, e as gravações (abrir casos, registrar contato, concluir e cancelar, sempre com a versão do caso).
import { DESFECHOS_BUSCA_ATIVA, RESULTADOS_CONTATO } from '@sgh/dominio-sadt';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const B = '/api/sadt/busca-ativa';
const n = z.number();
const txt = z.string();
const opcao = z.object({ id: n, nome: txt });

export const SITUACOES_BUSCA_ATIVA = ['aberto', 'em_contato', 'suspenso', 'concluido', 'cancelado'] as const;

const esquemaApoio = z.object({
  canais: z.array(opcao),
  equipe: z.array(opcao),
  resultadosContato: z.array(z.enum(RESULTADOS_CONTATO)),
  desfechos: z.array(z.enum(DESFECHOS_BUSCA_ATIVA)),
});
export type ApoioBuscaAtiva = z.infer<typeof esquemaApoio>;

const caso = z.object({
  id: n,
  numero: txt,
  paciente: n,
  pacienteNome: txt,
  prontuario: txt,
  motivo: txt,
  situacao: z.enum(SITUACOES_BUSCA_ATIVA),
  desfecho: txt.nullable(),
  abertoEm: txt,
  prazoEm: txt.nullable(),
  atrasado: z.boolean(),
  setor: txt.nullable(),
  exames: txt,
  tentativas: n,
  ultimoContatoEm: txt.nullable(),
  versao: n,
});
export type CasoNaFila = z.infer<typeof caso>;
const esquemaFila = z.object({ itens: z.array(caso) });

const esquemaCandidatos = z.object({
  itens: z.array(z.object({ requisicao: n, paciente: n, motivo: txt, prazoEm: txt, exames: n })),
});
export type CandidatoBuscaAtiva = z.infer<typeof esquemaCandidatos>['itens'][number];

const esquemaDetalhe = z.object({
  id: n,
  numero: txt,
  situacao: z.enum(SITUACOES_BUSCA_ATIVA),
  desfecho: txt.nullable(),
  observacao: txt.nullable(),
  concluidoEm: txt.nullable(),
  concluidoPor: txt.nullable(),
  versao: n,
  exames: z.array(
    z.object({
      id: n,
      nome: txt,
      situacao: txt,
      liberadoEm: txt.nullable(),
      critico: z.boolean(),
      alterado: z.boolean(),
    }),
  ),
  contatos: z.array(
    z.object({
      id: n,
      contatadoEm: txt,
      resultado: txt,
      orientacao: txt.nullable(),
      novaColetaEm: txt.nullable(),
      canal: txt.nullable(),
      por: txt.nullable(),
    }),
  ),
  equipe: z.array(opcao),
});
export type DetalheBuscaAtiva = z.infer<typeof esquemaDetalhe>;

const esquemaAbertos = z.object({ abertos: n, exames: n });
const esquemaGravado = z.object({ versao: n.optional() }).passthrough();

export interface ContatoBuscaAtiva {
  readonly versao: number;
  readonly contatadoEm: string;
  readonly canal: number | null;
  readonly resultado: (typeof RESULTADOS_CONTATO)[number];
  readonly orientacao: string | null;
  readonly novaColetaEm: string | null;
}

export const lerApoioBuscaAtiva = () => ler(`${B}/apoio`, esquemaApoio);
export const lerFilaBuscaAtiva = (todos: boolean, paciente: number | null) =>
  ler(`${B}${qs({ situacao: todos ? 'todos' : null, paciente })}`, esquemaFila);
export const lerCandidatosBuscaAtiva = () => ler(`${B}/candidatos`, esquemaCandidatos);
export const abrirCasosBuscaAtiva = (chave: string) => enviar(`${B}/abrir`, {}, esquemaAbertos, chave);
export const lerCasoBuscaAtiva = (id: number) => ler(`${B}/${id}`, esquemaDetalhe);
export const registrarContatoBuscaAtiva = (id: number, c: ContatoBuscaAtiva, chave: string) =>
  enviar(`${B}/${id}/contatos`, c, esquemaGravado, chave);
export const concluirBuscaAtiva = (
  id: number,
  c: { versao: number; desfecho: string; observacao: string | null },
  chave: string,
) => enviar(`${B}/${id}/concluir`, c, esquemaGravado, chave);
export const cancelarBuscaAtiva = (id: number, c: { versao: number; observacao: string }, chave: string) =>
  enviar(`${B}/${id}/cancelar`, c, esquemaGravado, chave);
