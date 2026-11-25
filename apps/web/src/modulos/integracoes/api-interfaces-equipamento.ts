// Cliente da API das interfaces com os equipamentos do laboratório (F3.5, 05-SADT linha 13): cadastro da interface com
// o equipamento, de-para de exames e de analitos, e as mensagens trafegadas (com o reprocessamento da que falhou).
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const B = '/api/sadt/interfaces-equipamento';
const n = z.number();
const txt = z.string();
const sn = z.boolean();

const esquemaInterface = z.object({
  id: n,
  versao: n,
  codigo: txt,
  descricao: txt,
  modelo: n,
  modeloNome: txt,
  protocolo: txt,
  sentido: txt,
  host: txt.nullable(),
  porta: n.nullable(),
  caminhoEnvio: txt.nullable(),
  caminhoRetorno: txt.nullable(),
  enviaListaTrabalho: sn,
  recebeResultado: sn,
  importaComoLiberado: sn,
  revisaAutomaticamente: sn,
  assinaAutomaticamente: sn,
  bloqueiaLaudo: sn,
  ativo: sn,
  temCredencial: sn,
  equipamento: z
    .object({
      id: n,
      codigo: txt,
      descricao: txt,
      modelo: txt.nullable(),
      numeroSerie: txt.nullable(),
      setor: n,
      setorNome: txt,
    })
    .nullable(),
  examesComCodigo: n,
  analitosComCodigo: n,
  pedidosNaFila: n,
  resultadosComErro: n,
  ultimoResultadoEm: txt.nullable(),
});
export type InterfaceEquipamentoLida = z.infer<typeof esquemaInterface>;

const esquemaApoio = z.object({
  modelos: z.array(z.object({ id: n, nome: txt, padrao: txt, sentido: txt })),
  setores: z.array(z.object({ id: n, nome: txt })),
  protocolos: z.array(txt),
});

const esquemaDePara = z.object({
  exames: z.array(
    z.object({
      id: n,
      versao: n,
      exame: n,
      exameNome: txt,
      material: n.nullable(),
      codigo: txt,
      enviaAnalitos: sn,
      ativo: sn,
      editavel: sn,
    }),
  ),
  analitos: z.array(
    z.object({
      id: n,
      versao: n,
      analito: n,
      analitoNome: txt,
      exame: n.nullable(),
      codigo: txt,
      fator: n,
      casas: n.nullable(),
      recebe: sn,
      ativo: sn,
    }),
  ),
});
export type DeParaEquipamento = z.infer<typeof esquemaDePara>;

const esquemaMensagens = z.array(
  z.object({
    id: n,
    direcao: z.enum(['entrada', 'saida']),
    situacao: txt,
    referencia: txt,
    tentativas: n,
    erro: txt.nullable(),
    criadaEm: txt.nullable(),
    processadaEm: txt.nullable(),
  }),
);
const esquemaId = z.object({ id: n });
const esquemaRecebimento = z.object({ mensagem: n, situacao: txt, pendencias: z.array(txt) }).passthrough();

const opcao = z.object({ id: n, nome: txt });
const esquemaOpcoes = z.object({ exames: z.array(opcao), analitos: z.array(opcao) }).passthrough();

export const listarInterfacesEquipamento = () => ler(B, z.array(esquemaInterface));
export const lerApoioInterfaces = () => ler(`${B}/apoio`, esquemaApoio);
/** Exames e analitos do catálogo (os combos do de-para). */
export const lerCatalogoDoDePara = () => ler('/api/sadt/catalogo/opcoes', esquemaOpcoes);
export const salvarInterfaceEquipamento = (c: Record<string, unknown>, chave: string) =>
  enviar(B, c, esquemaId, chave);
export const lerDeParaEquipamento = (id: number) => ler(`${B}/${id}/de-para`, esquemaDePara);
export const salvarDeParaExame = (id: number, c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/${id}/de-para/exames`, c, esquemaId, chave);
export const salvarDeParaAnalito = (id: number, c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/${id}/de-para/analitos`, c, esquemaId, chave);
export const lerMensagensEquipamento = (id: number) => ler(`${B}/${id}/mensagens`, esquemaMensagens);
export const reprocessarMensagemEquipamento = (id: number, mensagem: number, chave: string) =>
  enviar(`${B}/${id}/mensagens/${mensagem}/reprocessar`, {}, esquemaRecebimento, chave);
