// Cliente das rotas do projeto como centro de resultado (C2-107, 07-FIN linha 128): /api/financeiro/projetos.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/financeiro/projetos';
const n = z.number().nullable();
const s = z.string().nullable();
const opcao = z.object({ id: z.number(), nome: z.string() });

export const esquemaResumoProjeto = z.object({
  id: z.number(),
  versao: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  tipo: z.string(),
  situacao: z.enum(['planejado', 'em_andamento', 'concluido', 'suspenso', 'cancelado']),
  verba: z.number(),
  inicioPrevisto: s,
  fimPrevisto: s,
  despesa: z.number(),
  receita: z.number(),
  estourado: z.boolean(),
});
export type ResumoProjeto = z.infer<typeof esquemaResumoProjeto>;
export const esquemaProjetos = z.object({
  projetos: z.array(esquemaResumoProjeto),
  centros: z.array(opcao),
  insumos: z.array(opcao),
});
export type ProjetosLidos = z.infer<typeof esquemaProjetos>;

const situacaoEtapa = z.enum(['planejada', 'em_andamento', 'concluida', 'cancelada']);
const origem = z.enum(['titulo', 'titulo_receber', 'lancamento', 'consumo', 'contrato']);
export const esquemaProjeto = esquemaResumoProjeto
  .omit({ despesa: true, receita: true, estourado: true })
  .extend({
    inicioEfetivo: s,
    fimEfetivo: s,
    centroResultado: n,
    convenio: s,
    etapas: z.array(
      z.object({
        id: z.number(),
        sequencia: z.number(),
        descricao: z.string(),
        centroCusto: n,
        centroNome: s,
        inicioPrevisto: s,
        fimPrevisto: s,
        valorPrevisto: z.number(),
        valorRealizado: z.number(),
        percentualConcluido: z.number(),
        situacao: situacaoEtapa,
      }),
    ),
    centros: z.array(z.object({ centroCusto: z.number(), nome: s, percentual: n })),
    produtos: z.array(z.object({ insumo: n, servico: s, nome: s, quantidade: z.number(), valorPrevisto: n })),
    apropriacoes: z.array(
      z.object({
        id: z.number(),
        versao: z.number(),
        origem,
        documento: z.number(),
        natureza: z.enum(['receita', 'despesa']),
        etapa: n,
        percentual: n,
        valor: z.number(),
        data: z.string(),
        observacao: s,
        estornada: z.boolean(),
      }),
    ),
    resultado: z.object({
      orcado: z.number(),
      despesa: z.number(),
      receita: z.number(),
      resultado: z.number(),
      saldoVerba: z.number(),
      percentualConsumido: n,
      estourado: z.boolean(),
      etapas: z.array(
        z.object({
          sequencia: z.number(),
          descricao: z.string(),
          previsto: z.number(),
          realizado: z.number(),
          diferenca: z.number(),
          estourada: z.boolean(),
        }),
      ),
      semEtapa: z.number(),
      centros: z.array(z.object({ centroCusto: z.number(), percentual: z.number(), despesa: z.number() })),
    }),
  });
export type ProjetoLido = z.infer<typeof esquemaProjeto>;

export const esquemaDocumento = z.object({
  id: z.number(),
  numero: z.string(),
  data: s,
  valor: z.number(),
  livre: z.number(),
  cancelado: z.boolean(),
  descricao: s,
});
export type DocumentoProjeto = z.infer<typeof esquemaDocumento>;
export type OrigemDocumento = z.infer<typeof origem>;

const gravado = z.object({ id: z.number().nullable().optional() }).passthrough();

export const lerProjetos = () => ler(B, esquemaProjetos);
export const lerProjeto = (id: number) => ler(`${B}/${id}`, esquemaProjeto);
export const lerDocumentosProjeto = (o: OrigemDocumento, busca: string) =>
  ler(`${B}/documentos?origem=${o}&busca=${encodeURIComponent(busca)}`, z.array(esquemaDocumento));

export interface ProjetoProposto {
  codigo: string;
  descricao: string;
  tipo: string;
  verba: number;
  inicioPrevisto: string | null;
  fimPrevisto: string | null;
  centroResultado: number | null;
  convenio: string | null;
  situacao: string;
  etapas: {
    sequencia: number;
    descricao: string;
    centroCusto: number | null;
    inicioPrevisto: string | null;
    fimPrevisto: string | null;
    valorPrevisto: number;
    percentualConcluido: number;
    situacao: string;
  }[];
  centros: { centroCusto: number; percentual: number | null }[];
  produtos: {
    insumo: number | null;
    servico: string | null;
    quantidade: number;
    valorPrevisto: number | null;
  }[];
  versao?: number;
}
export const salvarProjeto = (alvo: number | null, p: ProjetoProposto) =>
  enviar(alvo === null ? B : `${B}/${alvo}`, p, gravado, novaChave('projeto'));

export interface ApropriacaoProposta {
  origem: OrigemDocumento;
  documento: number;
  natureza: 'receita' | 'despesa' | null;
  etapa: number | null;
  percentual: number | null;
  valor: number | null;
  data: string;
  observacao: string | null;
}
export const apropriarAoProjeto = (projeto: number, a: ApropriacaoProposta) =>
  enviar(`${B}/${projeto}/apropriacoes`, a, gravado, novaChave('projeto-apropriar'));
export const estornarApropriacao = (id: number, versao: number, motivo: string) =>
  enviar(`${B}/apropriacoes/${id}/estornar`, { versao, motivo }, gravado, novaChave('projeto-estornar'));
