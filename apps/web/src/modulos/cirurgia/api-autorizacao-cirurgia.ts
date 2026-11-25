// Cliente da autorização prévia da cirurgia eletiva por etapas (C1-117, 04-CC linha 102): a guia de solicitação ligada
// à cirurgia agendada, as etapas pela situação da guia, a senha da operadora e a exceção de urgência
// (/api/tiss/autorizacoes/cirurgias/:id). O pedido usa a rota da autorização prévia (POST /api/tiss/autorizacoes).
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const A = '/api/tiss/autorizacoes';

const esquemaCirurgia = z.object({
  id: z.number(),
  numero: z.string(),
  situacao: z.string(),
  carater: z.string(),
  natureza: z.string(),
  inicioPrevisto: z.string().nullable(),
  versao: z.number(),
  paciente: z.number(),
  cirurgiao: z.number(),
  senha: z.string().nullable(),
  etapa: z.string(),
  autorizacaoPosterior: z
    .object({ justificativa: z.string().nullable(), em: z.string().nullable() })
    .nullable(),
  guias: z.array(
    z.object({ id: z.number(), numero: z.string(), situacao: z.string(), senha: z.string().nullable() }),
  ),
});
export type AutorizacaoDaCirurgia = z.infer<typeof esquemaCirurgia>;

const esquemaCoberturas = z
  .object({
    coberturas: z.array(
      z.object({
        id: z.number(),
        fontePagadora: z.string(),
        carteira: z.string().nullable(),
        validade: z.string().nullable(),
      }),
    ),
  })
  .passthrough();

export const lerAutorizacaoDaCirurgia = (agendamento: number) =>
  ler(`${A}/cirurgias/${agendamento}`, esquemaCirurgia);

export const lerCoberturasDoPaciente = async (paciente: number) =>
  (await ler(`${A}/pacientes/${paciente}`, esquemaCoberturas)).coberturas;

export interface PedidoAutorizacaoCirurgia {
  agendamento: number;
  cobertura: number;
  cirurgiao: number;
  codigoProcedimento: string;
  descricao: string;
  indicacaoClinica: string;
  canal: 'webservice' | 'portal' | 'telefone' | 'email' | 'presencial';
}

/** A guia SP/SADT do procedimento da cirurgia, ligada ao agendamento, com o cirurgião como solicitante. */
export const pedirAutorizacaoDaCirurgia = (p: PedidoAutorizacaoCirurgia) =>
  enviar(
    A,
    {
      tipo: 'sp_sadt',
      cobertura: p.cobertura,
      agendamentoCirurgico: p.agendamento,
      solicitanteProfissional: p.cirurgiao,
      canal: p.canal,
      indicacaoClinica: p.indicacaoClinica.trim() || null,
      itens: [
        {
          codigoTabela: '22',
          codigoProcedimento: p.codigoProcedimento.trim(),
          descricao: p.descricao.trim(),
          quantidade: 1,
        },
      ],
    },
    z.object({ id: z.number(), numero: z.string() }).passthrough(),
    novaChave('autorizacao-cirurgia'),
  );

export const registrarUrgenciaDaCirurgia = (agendamento: number, versao: number, justificativa: string) =>
  enviar(
    `${A}/cirurgias/${agendamento}/urgencia`,
    { versao, justificativa: justificativa.trim() },
    z.object({ id: z.number(), etapa: z.string() }).passthrough(),
    novaChave('autorizacao-urgencia'),
  );
