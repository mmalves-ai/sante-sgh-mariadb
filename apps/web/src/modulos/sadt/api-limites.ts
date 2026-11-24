// Cliente da API dos limites do pedido de exame (F8, 05-SADT linha 6): cota por período, intervalo de repetição
// (inclusive no mesmo dia) e bloqueio pelo último resultado.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const B = '/api/sadt/limites';
const n = z.number();
const txt = z.string();
const acao = z.enum(['bloquear', 'alertar', 'exigir_justificativa']);

const esquemaLista = z.object({
  cotas: z.array(
    z.object({
      id: n,
      exame: n.nullable(),
      exameNome: txt.nullable(),
      setor: n.nullable(),
      fontePagadora: n.nullable(),
      periodo: z.enum(['dia', 'semana', 'mes', 'competencia']),
      quantidadeMaxima: n.nullable(),
      percentualLimite: n.nullable(),
      permiteExceder: z.boolean(),
      vigenciaInicio: txt,
      vigenciaFim: txt.nullable(),
      ativo: z.boolean(),
      usoNoPeriodo: n,
    }),
  ),
  intervalos: z.array(
    z.object({
      id: n,
      exame: n,
      conflitante: n,
      fontePagadora: n.nullable(),
      intervaloMinimoHoras: n,
      mesmoDia: z.boolean(),
      acao,
      mensagem: txt.nullable(),
      ativo: z.boolean(),
    }),
  ),
  bloqueios: z.array(
    z.object({
      id: n,
      exame: n,
      exameAvaliado: n.nullable(),
      analito: n,
      operador: txt,
      valor: txt,
      janelaDias: n,
      acao,
      mensagem: txt.nullable(),
      ativo: z.boolean(),
    }),
  ),
  fontes: z.array(z.object({ id: n, nome: txt })),
});
export type LimitesExame = z.infer<typeof esquemaLista>;
const esquemaId = z.object({ id: n });

export type AcaoLimite = z.infer<typeof acao>;

export const listarLimites = () => ler(B, esquemaLista);
export const incluirCota = (c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/cotas`, c, esquemaId, chave);
export const incluirIntervalo = (c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/intervalos`, c, esquemaId, chave);
export const incluirBloqueioResultado = (c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/resultados`, c, esquemaId, chave);
export const desativarLimite = (tipo: 'cota' | 'intervalo' | 'resultado', id: number, chave: string) =>
  enviar(`${B}/${tipo}/${id}/desativar`, {}, esquemaId, chave);

const opcao = z.object({ id: n, nome: txt });
const esquemaOpcoes = z
  .object({ exames: z.array(opcao), setores: z.array(opcao), analitos: z.array(opcao) })
  .passthrough();
/** Exames, setores executantes e analitos do catálogo (os combos da tela). */
export const lerOpcoesCatalogo = () => ler('/api/sadt/catalogo/opcoes', esquemaOpcoes);
