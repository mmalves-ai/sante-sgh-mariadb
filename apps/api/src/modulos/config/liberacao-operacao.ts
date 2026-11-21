// A gravação de uma operação está liberada para quem pergunta? Lê as chaves de operação do estabelecimento
// (FonteConfiguracao) e as resolve para a pessoa, o grupo e o setor da sessão (regra pura `chaveLibera`, em
// @sgh/dominio-config): sem chave que decida, a operação do catálogo está liberada; nome fora do catálogo é recusado.
// Lote 02-07 (ADR 0003, itens 5 e 9): era a porta das telas "só consulta" por etapa de implantação, código de convivência
// herdado e removido; a conferência da liberação por operação fica aqui, sem a etapa.
// Melhoria: a falha ao ler as chaves sobe como erro (quem chama distingue "não foi possível conferir" de "não liberada").
import { chaveLibera, type SujeitoLiberacao } from '@sgh/dominio-config';
import type { CatalogoOperacoesLiberacao } from './catalogo-operacoes.js';
import type { FonteConfiguracao } from './configuracao-fonte.js';

/** Quem pergunta: o login (só a pessoa) ou a pessoa com o grupo e o setor da sessão. */
export type QuemPergunta = string | SujeitoLiberacao;

/** O sujeito da liberação a partir de quem pergunta (setor e grupo vazios não contam). */
export function sujeitoDe(quem: QuemPergunta): SujeitoLiberacao {
  if (typeof quem === 'string') return { pessoa: quem };
  return {
    pessoa: quem.pessoa,
    ...(quem.grupo ? { grupo: quem.grupo } : {}),
    ...(quem.setor ? { setor: quem.setor } : {}),
  };
}

export async function operacaoLiberada(
  fonte: FonteConfiguracao,
  catalogo: CatalogoOperacoesLiberacao,
  rede: string,
  hospital: string,
  quem: QuemPergunta,
  operacao: string,
): Promise<boolean> {
  if (catalogo.estado(operacao, hospital) === null) return false;
  const chaves = (await fonte.chaves(rede, hospital))
    .filter((c) => c.tipo === 'operacao' && c.chave === operacao && c.ligada !== null)
    .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
  if (chaves.length === 0) return true;
  const s = sujeitoDe(quem);
  return chaveLibera(chaves, s.pessoa, s.grupo, s.setor);
}
