// M59-F1 (ficha do M59, regra 4; cap-08 §8.10 e §8.16): privilégio mínimo por módulo. Puro: do alcance de
// cada módulo (o que o catálogo de operações e as consultas dele tocam) sai o plano de privilégios, um papel
// do banco por módulo e uma conta por módulo com esse papel; a comparação com o que o catálogo de segurança
// mostra dá os desvios (o "Desvio" do guardas:legado estendido); e o plano vira o par de scripts aplicar e
// recolher de infra/mariadb/privilegios/, que a TI executa com autorização (regra 4 da Fase 7).
// Nunca: privilégio ao administrador do servidor; UPDATE ou DELETE na trilha própria; DDL; GRANT OPTION.
import {
  contaModuloBanco,
  papelModuloBanco,
  sufixoModuloBanco,
  type AcaoPrivilegioModulo,
  type AlcanceModulo,
  type PrivilegioReal,
} from '@sgh/contratos';
import { PREFIXO_CONTA_MODULO, PREFIXO_PAPEL_SGH } from './inventario.js';

/** Prefixo dos papéis por módulo. */
export const PREFIXO_PAPEL_MODULO = PREFIXO_PAPEL_SGH;

/** Tabelas só de inclusão (SGH_TRILHA e a cadeia): nenhum módulo recebe UPDATE nem DELETE nelas. */
export const SO_INCLUSAO: readonly RegExp[] = [/^SGH_TRILHA(_|$)/];

const IDENT = /^[A-Z][A-Z0-9_$]{0,62}$/;
const ORDEM_ACAO: readonly AcaoPrivilegioModulo[] = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'EXECUTE',
  'USAGE',
];
/** Ações de objeto que não é tabela (procedure, generator): não se misturam com DML. */
const ACAO_DE_OBJETO: readonly AcaoPrivilegioModulo[] = ['EXECUTE', 'USAGE'];

/** `faturamentoTiss` → `FATURAMENTO_TISS` (a convenção mora no contrato: o pool por módulo usa a mesma). */
export const sufixoModulo = sufixoModuloBanco;
export const papelDoModulo = papelModuloBanco;
export const contaDoModulo = contaModuloBanco;

export interface ItemPlano {
  readonly titular: string;
  readonly objeto: string;
  readonly acao: AcaoPrivilegioModulo;
}

export class PlanoPrivilegioRecusado extends Error {
  readonly motivos: readonly string[];
  constructor(motivos: readonly string[]) {
    super(`Plano de privilégios recusado: ${motivos.join('; ')}`);
    this.name = 'PlanoPrivilegioRecusado';
    this.motivos = motivos;
  }
}

const chave = (i: ItemPlano) => `${i.titular}\u0000${i.objeto}\u0000${i.acao}`;
const ordenar = <T extends ItemPlano>(xs: readonly T[]): T[] =>
  [...xs].sort(
    (a, b) =>
      a.titular.localeCompare(b.titular) ||
      a.objeto.localeCompare(b.objeto) ||
      ORDEM_ACAO.indexOf(a.acao) - ORDEM_ACAO.indexOf(b.acao),
  );

/**
 * Plano de privilégios por módulo: um item por (papel, objeto, ação), sem repetição e em ordem estável.
 * Recusa (com todos os motivos) identificador fora do padrão, administrador do servidor, EXECUTE em tabela
 * declarada também com DML e UPDATE ou DELETE em tabela só de inclusão.
 */
export function planejarPrivilegios(alcances: readonly AlcanceModulo[]): ItemPlano[] {
  const motivos: string[] = [];
  const vistos = new Map<string, ItemPlano>();
  const modulos = new Set<string>();
  for (const a of alcances) {
    if (modulos.has(a.modulo)) motivos.push(`módulo repetido: ${a.modulo}`);
    modulos.add(a.modulo);
    let titular: string;
    try {
      titular = papelDoModulo(a.modulo);
    } catch (e) {
      motivos.push((e as Error).message);
      continue;
    }
    for (const [objeto, acoes] of Object.entries(a.objetos)) {
      if (
        !IDENT.test(objeto) ||
        objeto.startsWith('RDB$') ||
        objeto.startsWith('MON$') ||
        objeto.startsWith('SEC$')
      ) {
        motivos.push(`objeto inválido em ${a.modulo}: ${objeto}`);
        continue;
      }
      const deObjeto = acoes.filter((x) => ACAO_DE_OBJETO.includes(x));
      if (deObjeto.length > 0 && new Set(acoes).size > 1) {
        motivos.push(
          `${objeto} em ${a.modulo}: ${deObjeto.join(', ')} (procedure ou generator) misturado com outra ação`,
        );
      }
      for (const acao of acoes) {
        if ((acao === 'UPDATE' || acao === 'DELETE') && SO_INCLUSAO.some((r) => r.test(objeto))) {
          motivos.push(`${objeto} é só de inclusão: ${acao} recusado em ${a.modulo}`);
          continue;
        }
        const item = { titular, objeto, acao };
        vistos.set(chave(item), item);
      }
    }
  }
  if (motivos.length > 0) throw new PlanoPrivilegioRecusado(motivos);
  return ordenar([...vistos.values()]);
}

export interface Desvios {
  /** No banco e fora do plano (privilégio a mais: o Desvio da regra 4). */
  readonly excesso: readonly ItemPlano[];
  /** No plano e fora do banco (o módulo vai falhar). */
  readonly falta: readonly ItemPlano[];
  readonly iguais: number;
}

/**
 * Compara o plano com os privilégios reais dos titulares do plano (os papéis por módulo) e das contas por
 * módulo: a conta por módulo deve ter só o papel do módulo, então qualquer privilégio direto nela é excesso.
 */
export function compararPrivilegios(plano: readonly ItemPlano[], reais: readonly PrivilegioReal[]): Desvios {
  const titulares = new Set(plano.map((p) => p.titular));
  const doPlano = new Map(plano.map((p) => [chave(p), p]));
  const relevantes = reais.filter(
    (r) =>
      titulares.has(r.titular) ||
      r.titular.startsWith(PREFIXO_CONTA_MODULO) ||
      r.titular.startsWith(PREFIXO_PAPEL_MODULO),
  );
  const doBanco = new Map(
    relevantes.map((r) => [chave(r), { titular: r.titular, objeto: r.objeto, acao: r.acao }]),
  );
  const excesso = [...doBanco.entries()].filter(([k]) => !doPlano.has(k)).map(([, v]) => v);
  const falta = [...doPlano.entries()].filter(([k]) => !doBanco.has(k)).map(([, v]) => v);
  return { excesso: ordenar(excesso), falta: ordenar(falta), iguais: doPlano.size - falta.length };
}

const q = (id: string) => {
  if (!IDENT.test(id)) throw new Error(`Identificador inválido: ${id}`);
  return `"${id}"`;
};
const verbo = (i: ItemPlano) => {
  if (i.acao === 'EXECUTE') return `EXECUTE ON PROCEDURE ${q(i.objeto)}`;
  if (i.acao === 'USAGE') return `USAGE ON GENERATOR ${q(i.objeto)}`;
  return `${i.acao} ON ${q(i.objeto)}`;
};

/**
 * Comentário do script só em ASCII: o isql (conexão sem charset) recusa byte acima de 127 até em comentário
 * ("Token unknown - line 1, column 1"), visto na integração na cópia do M59-F1.
 */
const soAscii = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]+/g, ' ');

export interface ScriptsPrivilegio {
  readonly aplicar: string;
  readonly recolher: string;
}

/**
 * Scripts dos papéis por módulo (texto SQL para o isql da TI): cria cada papel, concede o plano ao papel,
 * cria a conta do módulo SEM senha no texto (a TI define no cofre) e dá o papel à conta (o pool informa o papel ao conectar: o Firebird 3 não tem papel padrão). O
 * recolher desfaz na ordem inversa. Cabeçalho com hospital e versão; nenhum segredo no arquivo.
 */
export function gerarScriptsPapeis(
  plano: readonly ItemPlano[],
  cab: { hospital: string; versao: string },
): ScriptsPrivilegio {
  const papeis = [...new Set(plano.map((p) => p.titular))].sort();
  const topo = (o: string) =>
    [
      `-- ${o}: privilegio minimo por modulo (M59-F1), hospital ${cab.hospital}, versao ${cab.versao}.`,
      '-- Gerado; executado pela TI com autorizacao do dono (ESTADO.md, Autorizacoes). Nao edite a mao.',
      '-- As contas por modulo nascem sem senha neste arquivo: a TI define a senha e a guarda no cofre.',
    ].join('\n');
  const aplicar = [topo('aplicar')];
  for (const p of papeis) aplicar.push(`CREATE ROLE ${q(p)};`);
  for (const i of plano) aplicar.push(`GRANT ${verbo(i)} TO ROLE ${q(i.titular)};`);
  for (const p of papeis) {
    const conta = PREFIXO_CONTA_MODULO + p.slice(PREFIXO_PAPEL_MODULO.length);
    aplicar.push(`-- CREATE USER ${q(conta)} PASSWORD '<definida pela TI>' USING PLUGIN Srp;`);
    aplicar.push(`GRANT ${q(p)} TO USER ${q(conta)};`);
  }
  aplicar.push('COMMIT;');
  const recolher = [topo('recolher')];
  for (const p of [...papeis].reverse()) {
    const conta = PREFIXO_CONTA_MODULO + p.slice(PREFIXO_PAPEL_MODULO.length);
    recolher.push(`REVOKE ${q(p)} FROM USER ${q(conta)};`);
  }
  for (const i of [...plano].reverse()) recolher.push(`REVOKE ${verbo(i)} FROM ROLE ${q(i.titular)};`);
  for (const p of [...papeis].reverse()) recolher.push(`DROP ROLE ${q(p)};`);
  recolher.push('COMMIT;');
  return { aplicar: `${aplicar.join('\n')}\n`, recolher: `${recolher.join('\n')}\n` };
}

/**
 * Scripts de revogação de uma conta (técnica do sistema anterior, ou a conta ampla da aplicação depois da
 * troca pelos módulos), a partir do retrato dos privilégios lido ANTES: aplicar revoga cada um; recolher
 * concede de volta os mesmos (ficha, seção 12: "privilégio revogado volta pelo script inverso versionado").
 */
export function gerarScriptsRevogacao(
  conta: string,
  antes: readonly PrivilegioReal[],
  cab: { hospital: string; versao: string; autorizacao: string },
): ScriptsPrivilegio {
  if (conta === 'SYSDBA') throw new Error('O administrador do servidor não é revogado por script.');
  const itens = ordenar(antes.filter((p) => p.titular === conta).map((p) => ({ ...p })));
  const topo = (o: string) =>
    `-- ${o}: revogacao da conta ${q(conta)} (M59-F1), hospital ${cab.hospital}, versao ${cab.versao}; autorizacao: ${soAscii(cab.autorizacao)}.`;
  const aplicar = [
    topo('aplicar'),
    ...itens.map((i) => `REVOKE ${verbo(i)} FROM USER ${q(conta)};`),
    'COMMIT;',
  ];
  const recolher = [
    topo('recolher'),
    ...[...itens].reverse().map((i) => `GRANT ${verbo(i)} TO USER ${q(conta)};`),
    'COMMIT;',
  ];
  return { aplicar: `${aplicar.join('\n')}\n`, recolher: `${recolher.join('\n')}\n` };
}
