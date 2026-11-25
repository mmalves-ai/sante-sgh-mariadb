// Cliente da API da escala de execução do diagnóstico e da fila do setor (F3.5, 05-SADT linha 19).
import { z } from 'zod';
import { ErroApi } from '../../casca/erros/problem-details.js';
import { enviar, ler, qs } from '../exames/api-exames.js';

const B = '/api/sadt/escalas-execucao';
const n = z.number();
const txt = z.string();
const nome = z.object({ id: n, nome: txt });

const esquemaPlantao = z.object({
  diaSemana: n.nullable(),
  data: txt.nullable(),
  inicio: txt,
  fim: txt,
  capacidade: n,
});
const esquemaExame = z.object({
  exame: n,
  limitePorTurno: n.nullable(),
  grupoPrioridade: n.nullable(),
  vagasReservadas: n,
});
const esquemaEscala = z.object({
  id: n,
  setor: n,
  profissional: n.nullable(),
  recurso: n.nullable(),
  // Os nomes de quem executa vêm com a escala (a tela não carrega o cadastro de profissionais).
  profissionalNome: txt.nullable().default(null),
  recursoNome: txt.nullable().default(null),
  papel: z.enum(['executa', 'lauda']),
  descricao: txt,
  vigenciaInicio: txt,
  vigenciaFim: txt.nullable(),
  atendeFeriado: z.boolean(),
  ativa: z.boolean(),
  versao: n,
  plantoes: z.array(esquemaPlantao),
  exames: z.array(esquemaExame),
});
export type EscalaGravada = z.infer<typeof esquemaEscala>;

const esquemaOpcoes = z.object({
  setores: z.array(nome),
  recursos: z.array(nome),
  gruposPrioridade: z.array(nome),
  hoje: txt,
});
export type OpcoesDaEscala = z.infer<typeof esquemaOpcoes>;

const esquemaFila = z.object({
  setor: n,
  data: txt,
  hora: txt,
  semExecutante: n,
  // Quantos esperam hoje (os itens são os primeiros da ordem) e quantos pedidos antigos ficaram sem execução.
  total: n.default(0),
  antigos: n.default(0),
  itens: z.array(
    z.object({
      id: n,
      posicao: n,
      urgente: z.boolean(),
      ordemPrioridade: n.nullable(),
      chegada: txt,
      requisicao: txt,
      paciente: txt,
      exame: n,
      exameNome: txt,
      situacao: txt,
      grupoPrioridade: n.nullable(),
      grupoPrioridadeNome: txt.nullable(),
      executantes: z.array(
        z.object({
          escala: n,
          descricao: txt,
          profissional: n.nullable(),
          recurso: n.nullable(),
          profissionalNome: txt.nullable().default(null),
          recursoNome: txt.nullable().default(null),
        }),
      ),
    }),
  ),
});
export type FilaDoSetor = z.infer<typeof esquemaFila>;

/** O corpo da inclusão (o mesmo desenho da regra do domínio, mais o atendimento em feriado). */
export interface CorpoEscala {
  setor: number;
  profissional: number | null;
  recurso: number | null;
  papel: 'executa' | 'lauda';
  descricao: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  atendeFeriado: boolean;
  plantoes: {
    diaSemana: number | null;
    data: string | null;
    inicio: string;
    fim: string;
    capacidade: number;
  }[];
  exames: {
    exame: number;
    limitePorTurno: number | null;
    grupoPrioridade: number | null;
    vagasReservadas: number;
  }[];
}

/**
 * As escalas que ainda valem a partir de `desde`: as do setor com a lista de exames e as dos outros setores só com os
 * plantões (a tela confere com elas o choque do mesmo executante entre setores).
 */
export const listarEscalas = (setor: number, desde: string) =>
  ler(`${B}${qs({ setor, outros: 1, desde })}`, z.array(esquemaEscala));
/** A busca por digitação do exame ou do profissional (os primeiros nomes com as palavras digitadas). */
export const buscarNaEscala = (tipo: 'exame' | 'profissional', termo: string) =>
  ler(`${B}/opcoes/busca${qs({ tipo, termo })}`, z.array(nome));
export const lerOpcoesDaEscala = () => ler(`${B}/opcoes`, esquemaOpcoes);
export const lerFilaDoSetor = (setor: number) => ler(`${B}/fila${qs({ setor })}`, esquemaFila);
export const incluirEscala = (e: CorpoEscala, chave: string) => enviar(B, e, z.object({ id: n }), chave);
export const encerrarEscala = (id: number, vigenciaFim: string, versao: number, chave: string) =>
  enviar(`${B}/${id}/encerrar`, { vigenciaFim, versao }, z.object({ id: n }), chave);

/** Os campos que a recusa do servidor aponta (`plantoes.0`, `exames.2`, `descricao`...); vazio sem recusa de campo. */
export function camposDaRecusa(e: unknown): string[] {
  if (!(e instanceof ErroApi)) return [];
  const c = (e.problema as { campos?: unknown } | null)?.campos;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string') : [];
}
