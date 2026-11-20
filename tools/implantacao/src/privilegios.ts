// M60, etapa 3 (achado do ensaio do manual): os privilégios de ESCRITA do papel SGH_APLICACAO nas tabelas do sistema
// anterior. As gravações compatíveis (executor do M04) e a trilha dupla do login (TBCABTRILHA/TBLANTRILHASGH) gravam
// pelo papel; os scripts SGH_ nunca concedem nada sobre tabela do sistema anterior (guarda do M04), e a conta da
// aplicação só tem leitura (manual §6.2). O anexo `privilegios-papel.sql`, gerado do registro das receitas na hora
// do pacote (nunca desatualiza), é executado pela TI como administrador do banco depois de cada migração: só GRANT
// (privilégio), nenhuma alteração de estrutura. D-PRIVILEGIOS-60.3.
// Correção da revisão (D-PRIVILEGIOS-PSQL-60.3): os gatilhos dessas tabelas chamam procedimentos e funções do sistema
// anterior (o retrato do atendimento SPHISTATENDIMENTO, as pendências do eSocial, a integração digital) e gravam, em
// caminhos que a assinatura não percorreu, tabelas fora da lista. No Firebird 3 o código de um gatilho, procedimento
// ou função vale pelo privilégio dele somado ao do papel em uso. O anexo dá ao papel o EXECUTE nos módulos que os
// gatilhos chamam (e nos que esses chamam), e a cada gatilho e módulo desses a escrita nas tabelas de que o código
// dele depende (RDB$DEPENDENCIES, lido na hora da execução, como as sequências): o papel não ganha escrita direta em
// tabela nenhuma a mais, e cada gatilho ou módulo só faz o que o código dele já faz.
import type { Receita } from '@sgh/legado';

export const PAPEL = 'SGH_APLICACAO';
const ORDEM_ACOES = ['INSERT', 'UPDATE', 'DELETE'] as const;
type AcaoGrant = (typeof ORDEM_ACOES)[number];

export interface PrivilegioTabela {
  readonly tabela: string;
  /** Ações na ordem INSERT, UPDATE, DELETE. */
  readonly acoes: readonly AcaoGrant[];
  /** Quantas receitas gravam na tabela (passo ou efeito de gatilho). */
  readonly receitas: number;
}

const NOME_VALIDO = /^[A-Z][A-Z0-9_$]{0,62}$/;

/**
 * Tabelas do sistema anterior gravadas pelas receitas (os passos e os efeitos de gatilho declarados), com as ações.
 * Tabela SGH_ fica de fora (os próprios scripts concedem ao papel). Nome fora do padrão de identificador: erro.
 */
export function privilegiosDoPapel(
  receitas: readonly Pick<Receita, 'nome' | 'passos' | 'efeitos'>[],
): PrivilegioTabela[] {
  const acoes = new Map<string, Set<AcaoGrant>>();
  const usos = new Map<string, Set<string>>();
  for (const r of receitas) {
    for (const g of [...r.passos, ...r.efeitos]) {
      const t = g.tabela.trim().toUpperCase();
      if (t.startsWith('SGH_')) continue;
      if (!NOME_VALIDO.test(t)) throw new Error(`Receita ${r.nome}: tabela com nome inválido (${g.tabela}).`);
      const a = g.acao.toUpperCase() as AcaoGrant;
      if (!ORDEM_ACOES.includes(a)) throw new Error(`Receita ${r.nome}: ação ${g.acao} em ${t}.`);
      (acoes.get(t) ?? acoes.set(t, new Set()).get(t)!).add(a);
      (usos.get(t) ?? usos.set(t, new Set()).get(t)!).add(r.nome);
    }
  }
  return [...acoes.keys()].sort().map((tabela) => ({
    tabela,
    acoes: ORDEM_ACOES.filter((a) => acoes.get(tabela)?.has(a)),
    receitas: usos.get(tabela)?.size ?? 0,
  }));
}

/** Comando de concessão de uma tabela (o texto que o anexo traz e que a conferência procura). */
export function comandoGrant(p: PrivilegioTabela): string {
  return `GRANT ${p.acoes.join(', ')} ON "${p.tabela}" TO ROLE ${PAPEL};`;
}

/** O anexo SQL, para o isql da TI (administrador do banco), depois da migração. */
export function anexoDePrivilegios(itens: readonly PrivilegioTabela[]): string {
  return [
    '-- Anexo: privilégios do papel SGH_APLICACAO no sistema anterior (escrita nas tabelas e execução dos procedimentos).',
    '-- Gerado por `pnpm implantacao:listas`; não edite à mão.',
    '--',
    '-- Execute como administrador do banco (SYSDBA ou o dono das tabelas), DEPOIS da migração (o papel nasce nela) e',
    '-- de novo depois de cada atualização com migração (manual de implantação, seções 7.4 e 10.4). Só concede',
    '-- privilégios: nenhuma tabela, gatilho ou dado é alterado, e a estrutura do banco fica igual à homologada.',
    `-- ${itens.length} tabelas, as gravadas pelas operações do sistema (passos e efeitos de gatilho das receitas).`,
    '-- A leitura vem da seção 6.2; as funções só gravam depois de liberadas (seção 9).',
    '',
    ...itens.map(comandoGrant),
    '',
    '-- Os gatilhos das tabelas acima numeram registros pelas sequências do sistema anterior: o papel precisa usá-las.',
    'SET TERM ^ ;',
    'EXECUTE BLOCK AS',
    '  DECLARE VARIABLE g VARCHAR(63);',
    'BEGIN',
    '  FOR SELECT TRIM(RDB$GENERATOR_NAME) FROM RDB$GENERATORS',
    "       WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$GENERATOR_NAME NOT STARTING WITH 'SGH_'",
    '       INTO :g',
    '  DO',
    `    EXECUTE STATEMENT 'GRANT USAGE ON SEQUENCE "' || :g || '" TO ROLE ${PAPEL}';`,
    'END^',
    'SET TERM ; ^',
    'COMMIT;',
    '',
    ...BLOCO_EXCECOES,
    '',
    ...BLOCO_PSQL,
    '',
  ].join('\n');
}

/**
 * As regras de negócio dos gatilhos recusam a gravação levantando as exceções do sistema anterior; no Firebird 3
 * levantar uma exceção exige o USAGE nela, e sem ele a recusa vira erro de permissão em vez da mensagem da regra
 * (achado do ensaio da correção: E_LOC_EXISTENTE_SEM_SAIDA no gatilho da internação). Todas, como as sequências.
 */
export const MARCA_EXCECOES =
  '-- As regras dos gatilhos recusam gravações levantando as exceções do sistema anterior';
const BLOCO_EXCECOES: readonly string[] = [
  `${MARCA_EXCECOES}: o papel precisa`,
  '-- usá-las para a recusa chegar com a mensagem da regra, não como falta de permissão.',
  'SET TERM ^ ;',
  'EXECUTE BLOCK AS',
  '  DECLARE VARIABLE e VARCHAR(63);',
  'BEGIN',
  '  FOR SELECT TRIM(RDB$EXCEPTION_NAME) FROM RDB$EXCEPTIONS',
  "       WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$EXCEPTION_NAME NOT STARTING WITH 'SGH_'",
  '       INTO :e',
  '  DO',
  `    EXECUTE STATEMENT 'GRANT USAGE ON EXCEPTION "' || :e || '" TO ROLE ${PAPEL}';`,
  'END^',
  'SET TERM ; ^',
  'COMMIT;',
];

/** Marca do bloco dos procedimentos e funções (a conferência procura). */
export const MARCA_PSQL = '-- Procedimentos e funções que os gatilhos chamam';

/**
 * Os gatilhos do sistema anterior chamam procedimentos e funções e gravam outras tabelas; no Firebird 3 o código de
 * cada um vale pelo privilégio dele somado ao do papel. O bloco lê o RDB$DEPENDENCIES: os módulos (5 procedimento,
 * 15 função) que os gatilhos chamam, com os que esses chamam (fecho), recebem o EXECUTE do papel; cada gatilho e cada
 * módulo do fecho recebe a escrita nas tabelas de que depende (só o código dele a usa; o papel não ganha escrita
 * direta). Nenhum nome vem de texto livre; objeto SGH_ fica de fora (os scripts SGH_ concedem o que é deles).
 */
const BLOCO_PSQL: readonly string[] = [
  `${MARCA_PSQL} (o retrato do atendimento, as pendências do eSocial): o papel`,
  '-- precisa executá-los; cada gatilho e cada um desses módulos precisa gravar o que o código dele grava, inclusive',
  '-- nos caminhos que as operações do sistema não percorreram. O papel não recebe escrita direta além da lista acima.',
  'SET TERM ^ ;',
  'EXECUTE BLOCK AS',
  "  DECLARE VARIABLE vistos VARCHAR(16000) = ',';",
  '  DECLARE VARIABLE novos INTEGER = 1;',
  '  DECLARE VARIABLE n VARCHAR(63);',
  '  DECLARE VARIABLE t VARCHAR(63);',
  '  DECLARE VARIABLE k SMALLINT;',
  'BEGIN',
  '  FOR SELECT DISTINCT TRIM(d.RDB$DEPENDED_ON_NAME), d.RDB$DEPENDED_ON_TYPE FROM RDB$DEPENDENCIES d',
  '        JOIN RDB$TRIGGERS g ON g.RDB$TRIGGER_NAME = d.RDB$DEPENDENT_NAME AND COALESCE(g.RDB$SYSTEM_FLAG, 0) = 0',
  "       WHERE d.RDB$DEPENDENT_TYPE = 2 AND d.RDB$DEPENDED_ON_TYPE IN (5, 15) AND g.RDB$TRIGGER_NAME NOT STARTING WITH 'SGH_'",
  "         AND d.RDB$DEPENDED_ON_NAME NOT STARTING WITH 'SGH_'",
  '       INTO :n, :k',
  "  DO vistos = vistos || k || ':' || n || ',';",
  '  WHILE (novos > 0) DO',
  '  BEGIN',
  '    novos = 0;',
  '    FOR SELECT DISTINCT TRIM(d.RDB$DEPENDED_ON_NAME), d.RDB$DEPENDED_ON_TYPE FROM RDB$DEPENDENCIES d',
  '         WHERE d.RDB$DEPENDENT_TYPE IN (5, 15) AND d.RDB$DEPENDED_ON_TYPE IN (5, 15)',
  "           AND d.RDB$DEPENDED_ON_NAME NOT STARTING WITH 'SGH_'",
  "           AND POSITION(',' || d.RDB$DEPENDENT_TYPE || ':' || TRIM(d.RDB$DEPENDENT_NAME) || ',' IN :vistos) > 0",
  '          INTO :n, :k',
  "    DO IF (POSITION(',' || k || ':' || n || ',' IN vistos) = 0) THEN",
  '    BEGIN',
  "      vistos = vistos || k || ':' || n || ',';",
  '      novos = novos + 1;',
  '    END',
  '  END',
  '  FOR SELECT TRIM(RDB$PROCEDURE_NAME) FROM RDB$PROCEDURES WHERE RDB$PACKAGE_NAME IS NULL',
  "         AND POSITION(',5:' || TRIM(RDB$PROCEDURE_NAME) || ',' IN :vistos) > 0 INTO :n",
  `  DO EXECUTE STATEMENT 'GRANT EXECUTE ON PROCEDURE "' || :n || '" TO ROLE ${PAPEL}';`,
  '  FOR SELECT TRIM(RDB$FUNCTION_NAME) FROM RDB$FUNCTIONS WHERE RDB$PACKAGE_NAME IS NULL',
  "         AND POSITION(',15:' || TRIM(RDB$FUNCTION_NAME) || ',' IN :vistos) > 0 INTO :n",
  `  DO EXECUTE STATEMENT 'GRANT EXECUTE ON FUNCTION "' || :n || '" TO ROLE ${PAPEL}';`,
  '  FOR SELECT DISTINCT d.RDB$DEPENDENT_TYPE, TRIM(d.RDB$DEPENDENT_NAME), TRIM(d.RDB$DEPENDED_ON_NAME)',
  '        FROM RDB$DEPENDENCIES d',
  '        JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = d.RDB$DEPENDED_ON_NAME AND r.RDB$VIEW_BLR IS NULL',
  "         AND COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0 AND r.RDB$RELATION_NAME NOT STARTING WITH 'SGH_'",
  '        LEFT JOIN RDB$TRIGGERS g ON g.RDB$TRIGGER_NAME = d.RDB$DEPENDENT_NAME AND d.RDB$DEPENDENT_TYPE = 2',
  "       WHERE d.RDB$DEPENDED_ON_TYPE = 0 AND d.RDB$DEPENDENT_NAME NOT STARTING WITH 'SGH_' AND (",
  '             (d.RDB$DEPENDENT_TYPE = 2 AND COALESCE(g.RDB$SYSTEM_FLAG, 1) = 0)',
  '          OR (d.RDB$DEPENDENT_TYPE IN (5, 15)',
  "              AND POSITION(',' || d.RDB$DEPENDENT_TYPE || ':' || TRIM(d.RDB$DEPENDENT_NAME) || ',' IN :vistos) > 0))",
  '        INTO :k, :n, :t',
  `  DO EXECUTE STATEMENT 'GRANT INSERT, UPDATE, DELETE ON "' || :t || '" TO '`,
  "    || DECODE(:k, 2, 'TRIGGER', 5, 'PROCEDURE', 'FUNCTION') || ' \"' || :n || '\"';",
  'END^',
  'SET TERM ; ^',
  'COMMIT;',
];

/**
 * Tabelas sem a concessão exata no anexo (o verificar falha quando uma receita nova grava em outra tabela) e, sem o
 * bloco dos procedimentos e funções dos gatilhos, o rótulo dele.
 */
export function conferirAnexoPrivilegios(texto: string, itens: readonly PrivilegioTabela[]): string[] {
  const faltam = itens.filter((i) => !texto.includes(comandoGrant(i))).map((i) => i.tabela);
  if (!texto.includes(BLOCO_EXCECOES.join('\n'))) faltam.push('(exceções dos gatilhos)');
  if (!texto.includes(BLOCO_PSQL.join('\n'))) faltam.push('(procedimentos e funções dos gatilhos)');
  return faltam;
}
