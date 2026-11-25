// Cliente da API da soroteca (F8, 05-SADT linha 9): equipamentos e racks, regras de prazo de descarte, guarda da
// amostra na posição, retirada com motivo, devolução e expurgo das vencidas (nada se apaga).
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const B = '/api/sadt/soroteca';
const n = z.number();
const txt = z.string();
const posicao = z.object({ linha: n, coluna: n });

const esquemaGuarda = z.object({
  id: n,
  amostra: n,
  codigo: txt,
  paciente: n.nullable(),
  equipamento: n,
  equipamentoDescricao: txt,
  suporte: n.nullable(),
  suporteCodigo: txt.nullable(),
  tipoMaterial: txt,
  prateleira: n.nullable(),
  linha: n.nullable(),
  coluna: n.nullable(),
  guardadoEm: txt,
  descartePrevistoEm: txt.nullable(),
  situacao: z.enum(['guardada', 'retirada', 'descartada']),
  retiradoEm: txt.nullable(),
  descartadoEm: txt.nullable(),
});

const esquemaPainel = z.object({
  hoje: txt,
  equipamentos: z.array(
    z.object({
      id: n,
      codigo: txt,
      descricao: txt,
      tipo: txt,
      temperaturaMinima: n.nullable(),
      temperaturaMaxima: n.nullable(),
      ativo: z.boolean(),
      guardadas: n,
    }),
  ),
  suportes: z.array(
    z.object({
      id: n,
      equipamento: n.nullable(),
      codigo: txt,
      descricao: txt,
      tipo: txt,
      prateleira: n.nullable(),
      quantidadeLinhas: n,
      quantidadeColunas: n,
      ativo: z.boolean(),
      ocupadas: z.array(posicao),
      sugerida: posicao.nullable(),
    }),
  ),
  regras: z.array(
    z.object({
      id: n,
      descricao: txt,
      abrangencia: z.enum(['geral', 'exame', 'resultado', 'fonte_pagadora']),
      exame: n.nullable(),
      comparador: txt.nullable(),
      valorTexto: txt.nullable(),
      fontePagadora: n.nullable(),
      diasGuarda: n,
      prioridade: n,
      ativo: z.boolean(),
    }),
  ),
  motivos: z.array(
    z.object({ id: n, codigo: txt, descricao: txt, finalidade: txt, definitiva: z.boolean() }),
  ),
  guardas: z.array(esquemaGuarda),
  vencidas: z.array(esquemaGuarda),
});

const esquemaAmostra = z.object({
  id: n,
  codigo: txt,
  situacao: txt,
  guardas: z.array(esquemaGuarda),
  movimentos: z.array(
    z.object({
      guarda: n,
      tipo: txt,
      em: txt,
      linha: n.nullable(),
      coluna: n.nullable(),
      motivo: txt.nullable(),
      por: txt.nullable(),
      observacao: txt.nullable(),
    }),
  ),
  doPaciente: z.array(esquemaGuarda),
  prazo: z.object({ regra: n.nullable(), dias: n.nullable(), descarteSeGuardarHoje: txt.nullable() }),
});

const esquemaId = z.object({ id: n });
const esquemaExpurgo = z.object({ id: n, descartadas: n });

export type PainelSoroteca = z.infer<typeof esquemaPainel>;
export type GuardaAmostra = z.infer<typeof esquemaGuarda>;
export type AmostraNaSoroteca = z.infer<typeof esquemaAmostra>;

export const lerSoroteca = () => ler(B, esquemaPainel);
export const lerAmostraNaSoroteca = (codigo: string) =>
  ler(`${B}/amostras/${encodeURIComponent(codigo)}`, esquemaAmostra);
export const incluirEquipamento = (c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/equipamentos`, c, esquemaId, chave);
export const incluirSuporte = (c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/suportes`, c, esquemaId, chave);
export const incluirRegraDescarte = (c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/regras`, c, esquemaId, chave);
export const desativarCadastroSoroteca = (
  tipo: 'equipamento' | 'suporte' | 'regra',
  id: number,
  chave: string,
) => enviar(`${B}/${tipo}/${id}/desativar`, {}, esquemaId, chave);
export const guardarAmostra = (c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/guardas`, c, esquemaId, chave);
export const retirarAmostra = (guarda: number, c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/guardas/${guarda}/retirar`, c, esquemaId, chave);
export const devolverAmostra = (guarda: number, c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/guardas/${guarda}/devolver`, c, esquemaId, chave);
export const expurgarAmostras = (c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/expurgo`, c, esquemaExpurgo, chave);
