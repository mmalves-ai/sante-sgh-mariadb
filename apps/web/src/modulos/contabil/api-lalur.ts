// Cliente do LALUR/LACS e da apuração do IRPJ e da CSLL do lucro real (C3-023, 07-FIN linha 115, F7): configuração da
// provisão, contas da parte B, apuração do período com os ajustes da parte A, cálculo, provisão, fechamento e o bloco M
// da ECF. As gravações vão com o CSRF e a Idempotency-Key (uma por intenção); as respostas são conferidas pelo zod.
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';
import { novaChave } from './api-contabil.js';

const P = '/api/contabil/lalur';

const esquemaContaB = z.object({
  id: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  tributo: z.string(),
  natureza: z.string(),
  saldoInicialCentavos: z.number(),
  dataSaldoInicial: z.string(),
  saldoCentavos: z.number(),
});
const esquemaApoio = z.object({
  estabelecimento: z.number().nullable(),
  estabelecimentos: z.array(z.object({ id: z.number(), nome: z.string() })),
  formas: z.array(z.string()),
  configuracao: z
    .object({
      irpjDebito: z.number(),
      irpjCredito: z.number(),
      csllDebito: z.number(),
      csllCredito: z.number(),
      aliquotaIrpj: z.number(),
      aliquotaAdicional: z.number(),
      limiteAdicionalMensal: z.number(),
      aliquotaCsll: z.number(),
    })
    .nullable(),
  contasContabeis: z.array(
    z.object({ id: z.number(), classificacao: z.string(), descricao: z.string(), natureza: z.string() }),
  ),
  contasParteB: z.array(esquemaContaB),
  apuracoes: z.array(
    z.object({
      id: z.number(),
      forma: z.string(),
      inicio: z.string(),
      fim: z.string(),
      situacao: z.string(),
      aRecolherCentavos: z.number(),
    }),
  ),
});
export type ApoioLalur = z.infer<typeof esquemaApoio>;

const esquemaDetalhe = z.object({
  apuracao: z.object({
    id: z.number(),
    inicio: z.string(),
    fim: z.string(),
    forma: z.string(),
    situacao: z.string(),
    versao: z.number(),
    lucroAntes: z.number(),
    baseIrpj: z.number(),
    baseCsll: z.number(),
    irpjRecolher: z.number(),
    csllRecolher: z.number(),
  }),
  ajustes: z.array(
    z.object({
      id: z.number(),
      sequencia: z.number(),
      tipo: z.string(),
      codigo: z.string().nullable(),
      descricao: z.string(),
      valorCentavos: z.number(),
      irpj: z.boolean(),
      csll: z.boolean(),
      contaParteB: z.string().nullable(),
      versao: z.number(),
    }),
  ),
  ecf: z.object({ linhas: z.array(z.string()), avisos: z.array(z.string()) }),
  memoria: z.array(z.string()),
});
export type DetalheLalur = z.infer<typeof esquemaDetalhe>;

const esquemaGravacao = z.object({
  mensagem: z.string(),
  repetida: z.boolean(),
  resultado: z.record(z.string(), z.unknown()),
});

export const lerApoioLalur = (estabelecimento: number | null) =>
  ler(`${P}/apoio${qs({ estabelecimento: estabelecimento ?? undefined })}`, esquemaApoio);
export const lerApuracaoLalur = (id: number) => ler(`${P}/apuracoes/${id}`, esquemaDetalhe);

const gravar = (url: string, corpo: unknown, rotulo: string) =>
  enviar(url, corpo, esquemaGravacao, novaChave(rotulo));
export const salvarConfiguracaoLalur = (c: Record<string, unknown>) =>
  gravar(`${P}/configuracao`, c, 'lalur-configuracao');
export const incluirContaParteB = (c: Record<string, unknown>) =>
  gravar(`${P}/contas-parte-b`, c, 'lalur-conta-b');
export const abrirApuracaoLalur = (c: Record<string, unknown>) => gravar(`${P}/apuracoes`, c, 'lalur-abrir');
export const incluirAjusteLalur = (apuracao: number, c: Record<string, unknown>) =>
  gravar(`${P}/apuracoes/${apuracao}/ajustes`, c, 'lalur-ajuste');
export const excluirAjusteLalur = (apuracao: number, ajuste: number, versao: number) =>
  gravar(`${P}/apuracoes/${apuracao}/ajustes/${ajuste}/excluir`, { versao }, 'lalur-ajuste-excluir');
export const apurarLalur = (apuracao: number, c: Record<string, unknown>) =>
  gravar(`${P}/apuracoes/${apuracao}/apurar`, c, 'lalur-apurar');
export const provisionarLalur = (apuracao: number, versao: number) =>
  gravar(`${P}/apuracoes/${apuracao}/provisionar`, { versao }, 'lalur-provisionar');
export const estornarProvisaoLalur = (apuracao: number, versao: number, justificativa: string) =>
  gravar(
    `${P}/apuracoes/${apuracao}/estornar-provisao`,
    { versao, justificativa },
    'lalur-estornar-provisao',
  );
export const fecharLalur = (apuracao: number, c: Record<string, unknown>) =>
  gravar(`${P}/apuracoes/${apuracao}/fechar`, c, 'lalur-fechar');
