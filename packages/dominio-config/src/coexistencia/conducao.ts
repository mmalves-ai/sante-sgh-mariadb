// Regra 6 e seção 5 do M37 (BRIEF §4.2; cap-15 §15.3.3; DP-4): condução opcional de um setor pelas permissões do
// legado (grupo × opção). A lista proposta são as opções do legado das operações liberadas do setor (as `opcoesLegado`
// do catálogo de permissões) que os grupos do setor têm. Retirar uma opção de um grupo atinge TODOS os usuários do
// grupo, inclusive de outros setores: cada par mostra quantos usuários ativos do grupo estão fora do setor, e o par
// com gente fora do setor só entra com a decisão do gestor de acessos. Nunca regra fixa; sempre reversível.
import type { ParConducao } from '@sgh/contratos';
import { chaveDoGrupo } from '../prontidao/prontidao.js';

export interface ConcessaoGrupo {
  readonly grupo: string;
  readonly opcao: number;
  readonly titulo: string | null;
}

export interface RetiradaRegistrada {
  readonly id: string;
  readonly grupo: string;
  readonly opcao: number;
  readonly situacao: 'retirada' | 'devolvida';
}

/** A chave do par para a decisão do gestor (o formulário manda "GRUPO:opção"). */
export const chavePar = (grupo: string, opcao: number) => `${chaveDoGrupo(grupo)}:${opcao}`;

/**
 * Os pares propostos: grupos do setor × opções das operações liberadas do setor que o grupo tem hoje, mais os pares
 * já retirados (para devolver). `usuariosPorGrupo` conta os usuários ativos do grupo no setor e fora dele.
 */
export function proporConducao(
  gruposDoSetor: readonly string[],
  opcoesDasOperacoes: ReadonlySet<number>,
  concessoes: readonly ConcessaoGrupo[],
  usuariosPorGrupo: Readonly<Record<string, { noSetor: number; fora: number }>>,
  retiradas: readonly RetiradaRegistrada[],
): ParConducao[] {
  const grupos = new Set(gruposDoSetor.map(chaveDoGrupo));
  const contagem = (g: string) => usuariosPorGrupo[chaveDoGrupo(g)] ?? { noSetor: 0, fora: 0 };
  const ativas = new Map(
    retiradas.filter((r) => r.situacao === 'retirada').map((r) => [chavePar(r.grupo, r.opcao), r]),
  );
  const r: ParConducao[] = [];
  const vistos = new Set<string>();
  for (const c of concessoes) {
    if (!grupos.has(chaveDoGrupo(c.grupo)) || !opcoesDasOperacoes.has(c.opcao)) continue;
    const k = chavePar(c.grupo, c.opcao);
    if (vistos.has(k)) continue;
    vistos.add(k);
    const n = contagem(c.grupo);
    r.push({
      grupo: c.grupo,
      opcao: c.opcao,
      titulo: c.titulo,
      usuariosNoSetor: n.noSetor,
      usuariosFora: n.fora,
      exigeDecisao: n.fora > 0,
      situacao: 'proposta',
      idConducao: null,
    });
  }
  for (const [k, x] of ativas) {
    if (vistos.has(k)) continue;
    const n = contagem(x.grupo);
    r.push({
      grupo: x.grupo,
      opcao: x.opcao,
      titulo: null,
      usuariosNoSetor: n.noSetor,
      usuariosFora: n.fora,
      exigeDecisao: n.fora > 0,
      situacao: 'retirada',
      idConducao: x.id,
    });
  }
  return r.sort((a, b) => a.grupo.localeCompare(b.grupo) || a.opcao - b.opcao);
}

/**
 * Confere o pedido de retirada contra a proposta: só pares propostos (o grupo tem a opção hoje e ela é das operações
 * liberadas do setor) e, com usuário fora do setor, só com a decisão do gestor. Devolve os pares aceitos agrupados por
 * grupo (uma retirada por grupo, várias opções) ou o motivo da recusa.
 */
export function conferirRetirada(
  pedido: readonly { grupo: string; opcao: number }[],
  proposta: readonly ParConducao[],
  decisaoGestor: readonly string[],
): { ok: true; porGrupo: Map<string, number[]> } | { ok: false; motivo: string } {
  const propostos = new Map(
    proposta.filter((p) => p.situacao === 'proposta').map((p) => [chavePar(p.grupo, p.opcao), p]),
  );
  const decididos = new Set(decisaoGestor.map((d) => d.trim().toUpperCase()));
  const porGrupo = new Map<string, number[]>();
  for (const x of pedido) {
    const k = chavePar(x.grupo, x.opcao);
    const p = propostos.get(k);
    if (!p)
      return { ok: false, motivo: `O par ${x.grupo} × ${x.opcao} não está na lista proposta do setor.` };
    if (p.exigeDecisao && !decididos.has(k))
      return {
        ok: false,
        motivo: `O grupo ${p.grupo} tem ${p.usuariosFora} usuário(s) ativo(s) fora do setor: a retirada da opção ${p.opcao} precisa da decisão do gestor de acessos.`,
      };
    porGrupo.set(p.grupo, [...new Set([...(porGrupo.get(p.grupo) ?? []), x.opcao])]);
  }
  return { ok: true, porGrupo };
}
