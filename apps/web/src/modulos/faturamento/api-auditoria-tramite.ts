// Cliente da auditoria item a item, do protocolo entre setores e do acompanhamento da guia do convênio (F3.7, 06-FAT
// linhas 21, 22 e 24). As regras vêm de @sgh/dominio-faturamento (a mesma da API), para a recusa aparecer enquanto se
// preenche; o servidor confere de novo.
import { TIPO_CORPO_ANEXOS_PORTAL } from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { enviar, ler, lerJson } from '../exames/api-exames.js';

const F = '/api/faturamento';
const qualquer = z.record(z.string(), z.unknown());
const textoN = z.string().nullable();

const parecer = z.object({
  decisao: z.string(),
  quantidadeAceita: z.number(),
  valorAceito: z.number(),
  valorGlosa: z.number(),
  motivoGlosaId: z.number().nullable(),
  justificativa: textoN,
});
const esquemaAuditoria = z.object({
  contaId: z.number(),
  numero: z.string(),
  situacao: z.string(),
  editavel: z.boolean(),
  total: z.number(),
  auditoria: z
    .object({
      id: z.number(),
      modalidade: z.string(),
      empresa: textoN,
      auditor: z.string(),
      iniciadaEm: textoN,
      valorOriginal: z.number(),
      bloqueiaConta: z.boolean(),
    })
    .nullable(),
  itens: z.array(
    z.object({
      id: z.number(),
      sequencia: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      quantidade: z.number(),
      valorTotal: z.number(),
      situacao: z.string(),
      parecer: parecer.nullable(),
    }),
  ),
  motivosGlosa: z.array(z.object({ id: z.number(), codigo: z.string(), descricao: z.string() })),
  empresas: z.array(z.object({ id: z.number(), nome: z.string(), cnpj: z.string() }).passthrough()),
  historico: z.array(
    z.object({
      id: z.number(),
      modalidade: z.string(),
      situacao: z.string(),
      resultado: textoN,
      empresa: textoN,
      auditor: z.string(),
      encerradaEm: textoN,
      valorOriginal: z.number(),
      valorAuditado: z.number().nullable(),
      glosaInterna: z.number(),
      observacao: textoN,
    }),
  ),
});
export type AuditoriaItens = z.infer<typeof esquemaAuditoria>;
export type ItemAuditado = AuditoriaItens['itens'][number];

export const lerAuditoriaItens = (conta: number) =>
  ler(`${F}/contas/${conta}/auditoria-itens`, esquemaAuditoria);
export const abrirAuditoria = (conta: number, corpo: Record<string, unknown>, chave: string) =>
  enviar(`${F}/contas/${conta}/auditorias`, corpo, qualquer, chave);
export const registrarParecer = (auditoria: number, corpo: Record<string, unknown>, chave: string) =>
  enviar(`${F}/auditorias/${auditoria}/pareceres`, corpo, qualquer, chave);
export const concluirAuditoriaConta = (auditoria: number, chave: string) =>
  enviar(`${F}/auditorias/${auditoria}/conclusao`, {}, qualquer, chave);
export const cancelarAuditoriaConta = (auditoria: number, motivo: string, chave: string) =>
  enviar(`${F}/auditorias/${auditoria}/cancelamento`, { motivo }, qualquer, chave);
export const cadastrarEmpresaAuditoria = (corpo: Record<string, unknown>, chave: string) =>
  enviar(`${F}/empresas-auditoria`, corpo, qualquer, chave);

const esquemaProtocolos = z.object({
  setores: z.array(z.object({ id: z.number(), codigo: z.string(), descricao: z.string(), tipo: z.string() })),
  protocolos: z.array(
    z.object({
      id: z.number(),
      numero: z.number(),
      conteudo: z.string(),
      prioridade: z.string(),
      situacao: z.string(),
      deSetorId: z.number(),
      paraSetorId: z.number(),
      emissor: z.string(),
      recebedor: textoN,
      emitidoEm: textoN,
      enviadoEm: textoN,
      recebidoEm: textoN,
      observacao: textoN,
      motivoCancelamento: textoN,
      itens: z.array(
        z.object({
          id: z.number(),
          sequencia: z.number(),
          tipo: z.string(),
          alvoId: z.number().nullable(),
          rotulo: z.string(),
          recebido: z.boolean(),
          recusado: z.boolean(),
          motivoRecusa: textoN,
        }),
      ),
    }),
  ),
});
export type Protocolos = z.infer<typeof esquemaProtocolos>;
export const lerProtocolos = (setor: number | null) =>
  ler(`${F}/protocolos-tramite${setor ? `?setor=${setor}` : ''}`, esquemaProtocolos);
const esquemaAlvos = z.object({
  itens: z.array(z.object({ id: z.number(), tipo: z.string(), rotulo: z.string() })),
});
/** O item do lote pelo número de negócio: conta, atendimento, prontuário (volumes) ou atendimento (documentos). */
export const buscarAlvosProtocolo = (tipo: string, numero: string) =>
  ler(`${F}/protocolos-tramite/alvos?${new URLSearchParams({ tipo, numero }).toString()}`, esquemaAlvos);
export const emitirProtocolo = (corpo: Record<string, unknown>, chave: string) =>
  enviar(`${F}/protocolos-tramite`, corpo, qualquer, chave);
export const enviarProtocolo = (id: number, chave: string) =>
  enviar(`${F}/protocolos-tramite/${id}/envio`, {}, qualquer, chave);
export const conferirProtocolo = (
  id: number,
  itens: { itemId: number; recebido: boolean; motivoRecusa?: string | null }[],
  chave: string,
) => enviar(`${F}/protocolos-tramite/${id}/conferencia`, { itens }, qualquer, chave);
export const cancelarProtocolo = (id: number, motivo: string, chave: string) =>
  enviar(`${F}/protocolos-tramite/${id}/cancelamento`, { motivo }, qualquer, chave);

const esquemaFila = z.array(
  z.object({
    id: z.number(),
    numero: z.string(),
    numeroOperadora: textoN,
    tipo: z.string(),
    situacao: z.string(),
    fonte: z.string(),
    paciente: z.string(),
    prontuario: z.number(),
    atendimentoId: z.number().nullable(),
    contaId: z.number().nullable(),
    solicitadaEm: textoN,
    temSenha: z.boolean(),
    validadeSenha: textoN,
    cirurgia: z.boolean(),
    cirurgiaPrevista: textoN,
    prazoPendencia: textoN,
    responsavel: textoN,
    pendencias: z.number(),
  }),
);
export type GuiaNaFila = z.infer<typeof esquemaFila>[number];
/** A fila das guias; `cirurgia` monta a fila do centro cirúrgico (só guias de cirurgia, pela data prevista). */
export const lerGuiasConvenio = (situacao: string | null, minhas: boolean, cirurgia = false) => {
  const q = new URLSearchParams();
  if (situacao) q.set('situacao', situacao);
  if (minhas) q.set('minhas', '1');
  if (cirurgia) q.set('cirurgia', '1');
  return ler(`${F}/guias-convenio?${q.toString()}`, esquemaFila);
};

const esquemaGuia = z.object({
  id: z.number(),
  numero: z.string(),
  numeroOperadora: textoN,
  tipo: z.string(),
  situacao: z.string(),
  fonte: z.string(),
  senha: textoN,
  validadeSenha: textoN,
  solicitadaEm: textoN,
  autorizadaEm: textoN,
  diasSolicitados: z.number().nullable(),
  diasAutorizados: z.number().nullable(),
  motivoNegacao: textoN,
  responsavelId: z.number().nullable(),
  responsavel: textoN,
  pendencias: z.array(
    z.object({
      id: z.number(),
      sequencia: z.number(),
      situacao: z.string(),
      motivo: z.string(),
      descricao: textoN,
      abertaEm: textoN,
      prazoEm: textoN,
      responsavel: textoN,
      resolvidaEm: textoN,
      resolvidoPor: textoN,
      solucao: textoN,
    }),
  ),
  anexos: z.array(
    z.object({
      id: z.number(),
      sequencia: z.number(),
      tipo: z.string(),
      descricao: textoN,
      nome: z.string(),
      tamanho: z.number(),
      em: textoN,
    }),
  ),
  historico: z.array(
    z.object({
      id: z.number(),
      evento: z.string(),
      de: textoN,
      para: textoN,
      observacao: textoN,
      usuario: textoN,
      em: textoN,
    }),
  ),
  motivosPendencia: z.array(z.object({ id: z.number(), codigo: z.string(), descricao: z.string() })),
});
export type GuiaAcompanhamento = z.infer<typeof esquemaGuia>;
export const lerGuia = (id: number) => ler(`${F}/guias/${id}/acompanhamento`, esquemaGuia);
export const responderGuia = (id: number, corpo: Record<string, unknown>, chave: string) =>
  enviar(`${F}/guias/${id}/resposta`, corpo, qualquer, chave);
export const abrirPendenciaGuia = (id: number, corpo: Record<string, unknown>, chave: string) =>
  enviar(`${F}/guias/${id}/pendencias`, corpo, qualquer, chave);
export const resolverPendenciaGuia = (pendencia: number, solucao: string, chave: string) =>
  enviar(`${F}/guias/pendencias/${pendencia}/resolucao`, { solucao }, qualquer, chave);
export const assumirGuia = (id: number, chave: string) =>
  enviar(`${F}/guias/${id}/responsavel`, { responsavelId: null }, qualquer, chave);
/** O anexo vai em base64 com o tipo próprio do corpo com anexos (teto de 15 MB no servidor; o JSON padrão aceita 1 MB). */
export const anexarGuia = async (id: number, corpo: Record<string, unknown>, chave: string) =>
  lerJson(
    await fetch(`${F}/guias/${id}/anexos`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': TIPO_CORPO_ANEXOS_PORTAL,
        'x-csrf': tokenCsrf(),
        'idempotency-key': chave,
      },
      body: JSON.stringify(corpo),
    }),
    qualquer,
  );
