// Porta da onda 0 (ficha do M38): se a gravação de uma operação está liberada para quem pergunta (a faixa "só consulta
// nesta etapa" das telas) e a saúde do banco do cliente (sonda da implantação). A liberação vem das chaves de operação
// do estabelecimento (FonteConfiguracao), resolvidas para a pessoa, o grupo e o setor da sessão: sem chave que decida,
// a operação do catálogo está liberada; nome fora do catálogo de operações é recusado.
// Melhoria: sem o estado da captura de assinatura e sem a vigilância diária de gravação do sistema de origem (ADR 0003).
// Melhoria: a falha ao ler as chaves sobe como erro (quem chama distingue "não foi possível conferir" de "não liberada").
import { chaveLibera, type SujeitoLiberacao } from '@sgh/dominio-config';
import type { Leitor } from '@sgh/nucleo';
import { type CatalogoOperacoesLiberacao, catalogoOperacoesProprio } from './catalogo-operacoes.js';
import type { DestinoConfiguracao, FonteConfiguracao } from './configuracao-fonte.js';

/** Quem pergunta: o login (só a pessoa) ou a pessoa com o grupo e o setor da sessão. */
export type QuemPergunta = string | SujeitoLiberacao;

export interface PortaOnda0 {
  readonly destino: DestinoConfiguracao;
  /** Estabelecimentos configurados (códigos). */
  readonly estabelecimentos: readonly string[];
  /**
   * A gravação da operação está liberada para quem pergunta (chaves de operação do estabelecimento por pessoa, grupo
   * e setor)? Rejeita (não devolve false) quando não consegue ler as chaves.
   */
  podeEscrever(rede: string, hospital: string, quem: QuemPergunta, op: string): Promise<boolean>;
  /** O banco do cliente responde a uma leitura curta (sonda `saude`). */
  bancoResponde(rede: string, hospital: string): Promise<boolean>;
}

export const PORTA_ONDA0 = Symbol('PORTA_ONDA0');

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoSonda {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
}

/** O sujeito da liberação a partir de quem pergunta (setor e grupo vazios não contam). */
export function sujeitoDe(quem: QuemPergunta): SujeitoLiberacao {
  if (typeof quem === 'string') return { pessoa: quem };
  return {
    pessoa: quem.pessoa,
    ...(quem.grupo ? { grupo: quem.grupo } : {}),
    ...(quem.setor ? { setor: quem.setor } : {}),
  };
}

async function liberadaPelasChaves(
  fonte: FonteConfiguracao,
  catalogo: CatalogoOperacoesLiberacao,
  rede: string,
  hospital: string,
  quem: QuemPergunta,
  op: string,
): Promise<boolean> {
  if (catalogo.estado(op, hospital) === null) return false;
  const chaves = (await fonte.chaves(rede, hospital))
    .filter((c) => c.tipo === 'operacao' && c.chave === op && c.ligada !== null)
    .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
  if (chaves.length === 0) return true;
  const s = sujeitoDe(quem);
  return chaveLibera(chaves, s.pessoa, s.grupo, s.setor);
}

export function portaOnda0Propria(
  nucleo: NucleoSonda,
  cliente: string,
  fonte: FonteConfiguracao,
  estabelecimentos: readonly string[],
  catalogo: CatalogoOperacoesLiberacao = catalogoOperacoesProprio(),
): PortaOnda0 {
  return {
    destino: 'banco',
    estabelecimentos,
    podeEscrever: (rede, hospital, quem, op) => liberadaPelasChaves(fonte, catalogo, rede, hospital, quem, op),
    async bancoResponde() {
      try {
        const r = await nucleo.lerSomente({ cliente, correlacao: 'sonda-saude' }, (l) =>
          l.uma<{ ok: number }>('SELECT 1 AS ok'),
        );
        return Number(r?.ok) === 1;
      } catch {
        return false;
      }
    },
  };
}

export function portaOnda0Memoria(
  fonte: FonteConfiguracao,
  hospitais: readonly string[],
  catalogo: CatalogoOperacoesLiberacao = catalogoOperacoesProprio(),
): PortaOnda0 {
  return {
    destino: 'memoria',
    estabelecimentos: hospitais,
    podeEscrever: (rede, hospital, quem, op) =>
      hospitais.includes(hospital)
        ? liberadaPelasChaves(fonte, catalogo, rede, hospital, quem, op)
        : Promise.resolve(false),
    async bancoResponde() {
      return true;
    },
  };
}
