// Cliente das exceções da regra de lançamento automático (C1-090, 06-FAT linha 16). A validação do cadastro vem de
// @sgh/dominio-faturamento (a mesma regra da API), para o erro aparecer na hora; o servidor confere de novo.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

export {
  cancelamentoExcecaoRegra,
  encerramentoExcecaoRegra,
  NATUREZAS_EXCECAO_REGRA,
  validarExcecaoRegraLancamento,
  type NaturezaExcecaoRegra,
} from '@sgh/dominio-faturamento';

const U = '/api/faturamento/regras-lancamento/excecoes';
const numN = z.number().nullable();
const textoN = z.string().nullable();
const aplica = z.object({
  internacao: z.boolean(),
  ambulatorial: z.boolean(),
  externo: z.boolean(),
  urgencia: z.boolean(),
  domiciliar: z.boolean(),
});
const esquemaExcecao = z.object({
  id: z.number(),
  versao: z.number(),
  todosEstabelecimentos: z.boolean(),
  fontePagadoraId: numN,
  fonte: textoN,
  planoId: numN,
  plano: textoN,
  setorId: numN,
  setor: textoN,
  especialidadeId: numN,
  especialidade: textoN,
  itemId: numN,
  item: textoN,
  grupoId: numN,
  grupo: textoN,
  efeito: z.enum(['nao_aplicar', 'aplicar_somente']),
  aplica,
  vigenciaInicio: textoN,
  vigenciaFim: textoN,
  situacao: z.enum(['cancelada', 'futura', 'vigente', 'encerrada']),
  motivo: textoN,
  criadoPor: textoN,
  motivoCancelamento: textoN.optional().default(null),
  canceladaPor: textoN.optional().default(null),
});
const opcao = z.object({ id: z.number(), rotulo: z.string() });
const esquemaPainel = z.object({
  hoje: z.string(),
  regras: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      gatilho: z.string(),
      vigenciaInicio: textoN,
      vigenciaFim: textoN,
      excecoes: z.array(esquemaExcecao),
    }),
  ),
  opcoes: z.object({
    fontes: z.array(opcao),
    planos: z.array(opcao.extend({ fontePagadoraId: z.number() })),
    setores: z.array(opcao),
    especialidades: z.array(opcao),
    grupos: z.array(opcao),
  }),
});
export type PainelExcecoes = z.infer<typeof esquemaPainel>;
export type ExcecaoRegra = z.infer<typeof esquemaExcecao>;

export interface PedidoExcecao {
  regraLancamentoId: number;
  todosEstabelecimentos: boolean;
  fontePagadoraId: number | null;
  planoId: number | null;
  setorId: number | null;
  especialidadeId: number | null;
  itemId: number | null;
  grupoId: number | null;
  efeito: 'nao_aplicar' | 'aplicar_somente';
  aplica: z.infer<typeof aplica>;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  motivo: string;
}

const esquemaGravado = z.object({ id: z.number() }).passthrough();
export const lerExcecoesRegra = () => ler(U, esquemaPainel);
export const incluirExcecaoRegra = (p: PedidoExcecao, chave: string) => enviar(U, p, esquemaGravado, chave);
export const encerrarExcecaoRegra = (id: number, versao: number, chave: string) =>
  enviar(`${U}/${id}/encerramento`, { versao }, esquemaGravado, chave);
export const cancelarExcecaoRegra = (id: number, versao: number, motivo: string, chave: string) =>
  enviar(`${U}/${id}/cancelamento`, { versao, motivo }, esquemaGravado, chave);
/** Permissão do recorte de todos os estabelecimentos (incluir, encerrar e cancelar a exceção global). */
export const PERMISSAO_EDITAR_GLOBAL = 'faturamento.regra.editarGlobal';
