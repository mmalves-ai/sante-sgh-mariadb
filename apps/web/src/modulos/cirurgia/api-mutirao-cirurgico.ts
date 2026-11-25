// Cliente dos projetos e mutirões cirúrgicos do SUS (C2-041, 04-CC linha 108): a lista com a meta contra a produção,
// o detalhe por paciente, o cadastro (projeto, metas por procedimento SIGTAP, insumos, fornecedores, justificativas) e a
// AIH ou APAC marcada com o projeto (/api/cirurgia/mutiroes).
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const opcao = z.object({ id: z.number(), rotulo: z.string() });
const situacao = z.enum(['planejado', 'em_andamento', 'encerrado', 'cancelado']);
const projeto = z.object({
  id: z.number(),
  versao: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  portaria: z.string().nullable(),
  periodoInicio: z.string(),
  periodoFim: z.string().nullable(),
  valorFinanciamento: z.number().nullable(),
  situacao,
  motivoCancelamento: z.string().nullable(),
  fontePagadora: z.string().nullable(),
});
export type ProjetoMutirao = z.infer<typeof projeto>;
const justificativa = z.object({
  id: z.number(),
  versao: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  ativo: z.boolean(),
  aplicaInclusao: z.boolean(),
  aplicaAlteracao: z.boolean(),
  exigeComplemento: z.boolean(),
});
export type JustificativaMutirao = z.infer<typeof justificativa>;

const esquemaPainel = z.object({
  projetos: z.array(projeto.extend({ prevista: z.number(), realizada: z.number(), percentual: z.number() })),
  justificativas: z.array(justificativa),
  opcoes: z.object({
    procedimentos: z.array(opcao.extend({ sigtap: z.string().nullable() })),
    fornecedores: z.array(opcao),
    insumos: z.array(opcao),
    fontesPagadoras: z.array(opcao),
  }),
});
export type PainelMutirao = z.infer<typeof esquemaPainel>;

const esquemaDetalhe = z.object({
  projeto,
  acompanhamento: z.object({
    prevista: z.number(),
    realizada: z.number(),
    percentual: z.number(),
    valorPrevisto: z.number(),
    valorRealizado: z.number(),
    decorrido: z.number().nullable(),
  }),
  metas: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      procedimentoDescricao: z.string(),
      sigtap: z.string().nullable(),
      prevista: z.number(),
      realizada: z.number(),
      saldo: z.number(),
      percentual: z.number().optional(),
      esperadoAteHoje: z.number().nullable().optional(),
      ritmo: z.string().optional(),
    }),
  ),
  insumos: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      descricao: z.string(),
      quantidadePrevista: z.number(),
      quantidadeUtilizada: z.number(),
    }),
  ),
  fornecedores: z.array(
    z.object({ id: z.number(), versao: z.number(), nome: z.string(), cnpj: z.string().nullable() }),
  ),
  vinculos: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      tipo: z.enum(['aih', 'apac']),
      numero: z.string(),
      documentoData: z.string().nullable(),
      paciente: z.string().nullable(),
      prontuario: z.string().nullable(),
      situacao: z.string(),
      justificativa: z.string(),
      complemento: z.string().nullable(),
      retiradaJustificativa: z.string().nullable(),
    }),
  ),
});
export type DetalheMutirao = z.infer<typeof esquemaDetalhe>;

const esquemaDocumentos = z.object({
  documentos: z.array(
    z.object({
      id: z.number(),
      tipo: z.enum(['aih', 'apac']),
      numero: z.string(),
      situacao: z.string(),
      data: z.string(),
      paciente: z.string().nullable(),
      prontuario: z.string().nullable(),
      problemas: z.array(z.object({ campo: z.string(), mensagem: z.string() })),
    }),
  ),
});
export type DocumentoMutirao = z.infer<typeof esquemaDocumentos>['documentos'][number];

const gravado = z.object({ id: z.number().nullable() }).passthrough();
const P = '/api/cirurgia/mutiroes';

export const lerPainelMutirao = () => ler(P, esquemaPainel);
export const lerDetalheMutirao = (id: number) => ler(`${P}/${id}`, esquemaDetalhe);
export const buscarDocumentoMutirao = (id: number, tipo: 'aih' | 'apac', numero: string) =>
  ler(`${P}/${id}/documentos?tipo=${tipo}&numero=${encodeURIComponent(numero)}`, esquemaDocumentos);

export interface ProjetoMutiraoPedido {
  codigo: string;
  descricao: string;
  portaria: string;
  periodoInicio: string;
  periodoFim: string | null;
  valorFinanciamento: number | null;
  fontePagadora: number | null;
}
export const incluirProjetoMutirao = (p: ProjetoMutiraoPedido) =>
  enviar(P, p, gravado, novaChave('mutirao-projeto'));
export const mudarSituacaoMutirao = (id: number, versao: number, situacao: string, motivo: string | null) =>
  enviar(`${P}/${id}/situacao`, { versao, situacao, motivo }, gravado, novaChave('mutirao-situacao'));
export const incluirMetaMutirao = (
  id: number,
  m: { procedimento: number; quantidadePrevista: number; valorUnitario: number | null },
) => enviar(`${P}/${id}/metas`, m, gravado, novaChave('mutirao-meta'));
export const incluirInsumoMutirao = (id: number, insumo: number, quantidadePrevista: number) =>
  enviar(`${P}/${id}/insumos`, { insumo, quantidadePrevista }, gravado, novaChave('mutirao-insumo'));
export const incluirFornecedorMutirao = (id: number, fornecedor: number) =>
  enviar(`${P}/${id}/fornecedores`, { fornecedor }, gravado, novaChave('mutirao-fornecedor'));
/** Retira a meta, o insumo ou o fornecedor (marca a exclusão; nada apagado). */
export const retirarItemMutirao = (
  id: number,
  tipo: 'metas' | 'insumos' | 'fornecedores',
  item: number,
  versao: number,
) => enviar(`${P}/${id}/${tipo}/${item}/retirar`, { versao }, gravado, novaChave(`mutirao-retirar-${tipo}`));
export const vincularDocumentoMutirao = (
  id: number,
  tipo: 'aih' | 'apac',
  documento: number,
  justificativa: number,
  complemento: string | null,
) =>
  enviar(
    `${P}/${id}/${tipo}`,
    { documento, justificativa, complemento },
    gravado,
    novaChave('mutirao-vincular'),
  );
export const retirarVinculoMutirao = (
  id: number,
  vinculo: number,
  versao: number,
  justificativa: number,
  complemento: string | null,
) =>
  enviar(
    `${P}/${id}/vinculos/${vinculo}/retirar`,
    { versao, justificativa, complemento },
    gravado,
    novaChave('mutirao-retirar-vinculo'),
  );
export const incluirJustificativaMutirao = (j: {
  codigo: string;
  descricao: string;
  aplicaInclusao: boolean;
  aplicaAlteracao: boolean;
  exigeComplemento: boolean;
}) => enviar(`${P}/justificativas`, j, gravado, novaChave('mutirao-justificativa'));
export const ativarJustificativaMutirao = (id: number, versao: number, ativo: boolean) =>
  enviar(
    `${P}/justificativas/${id}/ativo`,
    { versao, ativo },
    gravado,
    novaChave('mutirao-justificativa-ativo'),
  );
