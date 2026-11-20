// Consulta de USO do recurso desligado (POL-3; ADR 0019): o recurso vale para a pessoa só quando a chave a
// libera (a mesma regra do executor) E nenhum pré-requisito falta NA HORA DO USO. Pré-requisito que vence
// depois de a chave ser ligada desliga o recurso sem ninguém mexer na chave. É a função que os marcos que
// constroem os recursos chamam (com as chaves e os pré-requisitos lidos na mesma requisição).
import type { PrerequisitoDeclarado } from '@sgh/contratos';
import { type ChaveAtual, chaveLibera } from './lote.js';
import { faltasDoRecurso, type PrerequisitoRegistrado } from './prerequisito-chave.js';

export interface SujeitoLiberacao {
  readonly pessoa: string;
  readonly grupo?: string;
  readonly setor?: string;
}

export function recursoLigado(
  chaves: readonly ChaveAtual[],
  declarados: readonly PrerequisitoDeclarado[],
  registrados: readonly PrerequisitoRegistrado[],
  sujeito: SujeitoLiberacao,
  agora: Date,
): boolean {
  if (!chaveLibera(chaves, sujeito.pessoa, sujeito.grupo, sujeito.setor)) return false;
  return faltasDoRecurso(declarados, registrados, agora).length === 0;
}

/**
 * O recurso ligado para o ESTABELECIMENTO inteiro (a chave de escopo `hospital`, valor `*`), com os pré-requisitos dele
 * cumpridos na hora. Serve a quem age sobre um estabelecimento sem uma pessoa ou um setor dele (o worker, ou a Rede
 * lendo e gravando no banco de outro estabelecimento): a liberação por pessoa, grupo ou setor não vale aí.
 */
export function recursoLigadoNoEstabelecimento(
  chaves: readonly ChaveAtual[],
  declarados: readonly PrerequisitoDeclarado[],
  registrados: readonly PrerequisitoRegistrado[],
  agora: Date,
): boolean {
  const c = chaves.find((x) => x.escopo === 'hospital' && x.valor === '*' && x.ligada !== null);
  if (c?.ligada !== true) return false;
  return faltasDoRecurso(declarados, registrados, agora).length === 0;
}
