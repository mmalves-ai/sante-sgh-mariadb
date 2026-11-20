// M59-F3 (ficha do M59, regra 6; cap-08 §8.16; SBIS-26): imutabilidade clínica por privilégio. Puro: confere o plano
// dos papéis por módulo (nenhum DELETE em tabela clínica fora das exceções), gera o par de scripts que revoga o DELETE
// clínico de uma conta (a conta ampla da aplicação, enquanto ela existir) a partir do retrato dos privilégios dela
// lido ANTES, e resume quem ainda apaga registro clínico no banco. Nenhum trigger: trigger novo em tabela do banco é
// proibido enquanto durar a retrocompatibilidade (a regra por linha é o primeiro passo do plano de evolução).
import { deleteClinicoProibido, type PrivilegioReal } from '@sgh/contratos';
import type { ItemPlano, ScriptsPrivilegio } from '../contas/privilegio-minimo.js';

const IDENT = /^[A-Z][A-Z0-9_$]{0,62}$/;
const q = (id: string) => {
  if (!IDENT.test(id)) throw new Error(`Identificador inválido: ${id}`);
  return `"${id}"`;
};
const soAscii = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]+/g, ' ');

/** Itens do plano com DELETE em tabela clínica fora das exceções (o esperado é nenhum). */
export function itensPlanoComDeleteClinico(plano: readonly ItemPlano[]): ItemPlano[] {
  return plano.filter((i) => i.acao === 'DELETE' && deleteClinicoProibido(i.objeto));
}

export class ImutabilidadeRecusada extends Error {
  readonly itens: readonly { readonly onde: string; readonly tabela: string }[];
  constructor(itens: readonly { readonly onde: string; readonly tabela: string }[]) {
    super(
      `Imutabilidade clínica: DELETE em tabela clínica fora das exceções (${itens
        .slice(0, 10)
        .map((i) => `${i.onde} → ${i.tabela}`)
        .join('; ')}${itens.length > 10 ? `; e mais ${itens.length - 10}` : ''})`,
    );
    this.name = 'ImutabilidadeRecusada';
    this.itens = itens;
  }
}

/** Recusa o plano que dá DELETE clínico a algum papel por módulo. */
export function exigirPlanoImutavel(plano: readonly ItemPlano[]): void {
  const r = itensPlanoComDeleteClinico(plano);
  if (r.length > 0) throw new ImutabilidadeRecusada(r.map((i) => ({ onde: i.titular, tabela: i.objeto })));
}

/**
 * Scripts que revogam da conta o DELETE nas tabelas clínicas que ela tem hoje (retrato lido antes); o recolher
 * concede de volta exatamente os mesmos (ficha, seção 12: "privilégio revogado volta pelo script inverso versionado").
 * O administrador do servidor não é revogado por script; conta sem DELETE clínico dá scripts só com o cabeçalho.
 */
export function gerarScriptsImutabilidade(
  conta: string,
  antes: readonly PrivilegioReal[],
  cab: { hospital: string; versao: string; autorizacao: string },
): ScriptsPrivilegio & { readonly tabelas: readonly string[] } {
  if (conta === 'SYSDBA') throw new Error('O administrador do servidor não é revogado por script.');
  q(conta);
  const tabelas = [
    ...new Set(
      antes
        .filter((p) => p.titular === conta && p.acao === 'DELETE' && deleteClinicoProibido(p.objeto))
        .map((p) => p.objeto),
    ),
  ].sort();
  const topo = (o: string) =>
    [
      `-- ${o}: imutabilidade clinica (M59-F3, regra 6), conta ${q(conta)}, hospital ${cab.hospital}, versao ${cab.versao}.`,
      `-- Autorizacao: ${soAscii(cab.autorizacao)}. Gerado do retrato dos privilegios lido antes; nao edite a mao.`,
      `-- ${tabelas.length} tabela(s) clinica(s) com DELETE.`,
    ].join('\n');
  const aplicar = [
    topo('aplicar'),
    ...tabelas.map((t) => `REVOKE DELETE ON ${q(t)} FROM USER ${q(conta)};`),
    'COMMIT;',
  ];
  const recolher = [
    topo('recolher'),
    ...[...tabelas].reverse().map((t) => `GRANT DELETE ON ${q(t)} TO USER ${q(conta)};`),
    'COMMIT;',
  ];
  return { aplicar: `${aplicar.join('\n')}\n`, recolher: `${recolher.join('\n')}\n`, tabelas };
}

export interface LinhaDeleteClinico {
  /** Titular legível pelo nome, ou null (conta fora da lista: só conta no agregado). */
  readonly titular: string | null;
  readonly tabelas: number;
}

export interface TitularDeleteClinico {
  readonly titular: string;
  readonly doSante: boolean;
  readonly tabelas: number | '<5';
}

const faixa = (n: number): number | '<5' => (n > 0 && n < 5 ? '<5' : n);

/**
 * Quem tem DELETE clínico no banco: um item por titular legível (em ordem de nome), e o agregado "(outras)" para os
 * não legíveis. `doSante` diz se o titular é conta ou papel do Sante (o que o script 0002 e a troca pelos módulos
 * resolvem); a concessão segue vigente enquanto algum titular do Sante apaga registro clínico.
 */
export function resumirDeleteClinico(
  linhas: readonly LinhaDeleteClinico[],
  ehDoSante: (titular: string) => boolean,
): { titulares: TitularDeleteClinico[]; concessaoVigente: boolean } {
  const legiveis = linhas
    .filter((l): l is LinhaDeleteClinico & { titular: string } => l.titular !== null && l.tabelas > 0)
    .sort((a, b) => a.titular.localeCompare(b.titular));
  const outras = linhas.filter((l) => l.titular === null).reduce((s, l) => s + l.tabelas, 0);
  const titulares: TitularDeleteClinico[] = legiveis.map((l) => ({
    titular: l.titular,
    doSante: ehDoSante(l.titular),
    tabelas: faixa(l.tabelas),
  }));
  if (outras > 0) titulares.push({ titular: '(outras)', doSante: false, tabelas: faixa(outras) });
  return { titulares, concessaoVigente: titulares.some((t) => t.doSante) };
}
