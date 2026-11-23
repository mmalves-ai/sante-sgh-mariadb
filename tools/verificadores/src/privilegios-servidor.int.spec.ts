// SBIS-26 (apagar registro clínico recusado): prova no SERVIDOR que o papel de banco de um módulo, como o
// privilegios:gerar o escreve em infra/mariadb/privilegios/0001_papeis_por_modulo.aplicar.sql, não apaga registro
// clínico. Para cada módulo provado, as linhas GRANT do papel saem do script versionado, aplicadas a um papel efêmero
// no banco do cliente de teste; uma conta efêmera recebe esse papel como padrão e tenta DELETE nas tabelas clínicas
// do alcance (e UPDATE onde o papel só lê). O MariaDB recusa com ER_TABLEACCESS_DENIED_ERROR (1142) antes de olhar
// linha: o WHERE nunca casa linha (id = -1), então nada é tocado nem se o servidor aceitasse. Também confere que o
// gerador nunca concede DELETE a tabela clínica para papel nenhum. Conta e papel são apagados no fim.
// Nenhum dado lido. SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
// Rodar: ./pnpm exec vitest run --config tools/verificadores/vitest.integracao.config.ts src/privilegios-servidor.int.spec.ts
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deleteClinicoProibido, ehTabelaClinica } from '@sgh/contratos';
import { errnoDe, lerConfiguracaoNucleo, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ambienteDoRepositorio } from './copia-leitura.ts';
import { caminhoScript, gerarArtefatos, RAIZ } from './privilegios.ts';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'teste_nucleo';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const ER_TABLEACCESS_DENIED_ERROR = 1142;
/** Módulos provados no servidor: o PEP (só lê o registro clínico) e a enfermagem (grava e corrige registro e prescrição). */
const MODULOS = ['pep', 'enfermagem'] as const;
const TABELAS_ALVO = ['registro_assistencial', 'prescricao'] as const;

const GRANT = /^GRANT ([A-Z, ]+) ON ([a-z][a-z0-9_]*) TO (sgh_mod_[a-z_]+);$/;

interface Concessao {
  readonly acoes: readonly string[];
  readonly tabela: string;
  readonly papel: string;
}

/** As concessões do script versionado (o mesmo texto que a TI roda no banco de cada cliente). */
function concessoesDoScript(): Concessao[] {
  const texto = readFileSync(resolve(RAIZ, caminhoScript('aplicar')), 'utf8');
  const saida: Concessao[] = [];
  for (const linha of texto.split('\n')) {
    const m = GRANT.exec(linha.trim());
    if (m) saida.push({ acoes: m[1]!.split(',').map((a) => a.trim()), tabela: m[2]!, papel: m[3]! });
  }
  return saida;
}

describe('privilégios gerados: nenhum DELETE em tabela clínica (SBIS-26)', () => {
  it('o alcance gerado e o script versionado não concedem DELETE clínico a papel nenhum', () => {
    const a = gerarArtefatos();
    expect(a.alcances.length).toBeGreaterThan(10);
    const doAlcance = a.alcances.flatMap((x) =>
      Object.entries(x.objetos)
        .filter(([t, acoes]) => acoes.includes('DELETE') && deleteClinicoProibido(t))
        .map(([t]) => `${x.modulo}:${t}`),
    );
    expect(doAlcance).toEqual([]);
    const script = concessoesDoScript();
    // O parser leu o script inteiro: toda linha GRANT casou.
    const linhasGrant = readFileSync(resolve(RAIZ, caminhoScript('aplicar')), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('GRANT ')).length;
    expect(script.length).toBe(linhasGrant);
    expect(script.filter((c) => c.acoes.includes('DELETE') && deleteClinicoProibido(c.tabela))).toEqual([]);
    // O script versionado é o que o gerador produz hoje.
    expect(readFileSync(resolve(RAIZ, caminhoScript('aplicar')), 'utf8')).toBe(a.aplicar);
    // Os alvos do teste no servidor são clínicos de fato.
    for (const t of TABELAS_ALVO) expect(deleteClinicoProibido(t), t).toBe(true);
  });
});

describe.skipIf(SEM_BANCO)(
  `servidor recusa DELETE clínico ao papel do módulo (SBIS-26, cliente ${CLIENTE})`,
  () => {
    const sufixo = `${process.pid}_${randomBytes(3).toString('hex')}`;
    const conta = `sgh_t26_${sufixo}`;
    const senha = randomBytes(24).toString('hex');
    const papeis = new Map<string, string>(MODULOS.map((m) => [m, `sgh_t26_${m}_${sufixo}`]));
    let raiz: NucleoProprio;
    let efemero: NucleoProprio;
    let banco = '';
    const concessoes = concessoesDoScript();

    const admin = (sql: string) =>
      raiz.escrever({ cliente: CLIENTE, correlacao: 'sbis26-preparo' }, (e) => e.executar(sql));

    /** Troca o papel padrão da conta efêmera (vale na próxima conexão: o núcleo do efêmero é recriado). */
    async function assumir(modulo: string): Promise<void> {
      await efemero?.encerrar();
      await admin(`SET DEFAULT ROLE ${papeis.get(modulo)} FOR '${conta}'@'%'`);
      const env = ambienteDoRepositorio();
      efemero = new NucleoProprio({
        env,
        configuracao: lerConfiguracaoNucleo({ ...env, SGH_MARIADB_USUARIO: conta, MARIADB_SENHA: senha }),
      });
    }

    /** Executa com a conta efêmera e devolve o errno do servidor (null se aceitou). */
    async function tentar(sql: string): Promise<number | null> {
      try {
        await efemero.escrever(
          { cliente: CLIENTE, correlacao: 'sbis26-tentativa' },
          (e) => e.executar(sql),
          false,
        );
        return null;
      } catch (erro) {
        const n = errnoDe(erro) ?? errnoDe((erro as { cause?: unknown }).cause);
        if (n === null) throw erro;
        return n;
      }
    }

    beforeAll(async () => {
      raiz = new NucleoProprio({ env: ambienteDoRepositorio() });
      banco = (await raiz.cliente(CLIENTE)).banco;
      await admin(`CREATE USER '${conta}'@'%' IDENTIFIED BY '${senha}'`);
      // Só para o núcleo achar o banco do cliente pela plataforma (as colunas que ele lê); fora do papel do módulo.
      await admin(
        `GRANT SELECT (codigo, banco_nome, banco_servidor, situacao) ON \`${raiz.configuracao.bancoPlataforma}\`.cliente TO '${conta}'@'%'`,
      );
      for (const [modulo, papel] of papeis) {
        await admin(`CREATE ROLE ${papel}`);
        const doPapel = concessoes.filter((c) => c.papel === `sgh_mod_${modulo}`);
        expect(doPapel.length, modulo).toBeGreaterThan(5);
        for (const c of doPapel)
          await admin(`GRANT ${c.acoes.join(', ')} ON \`${banco}\`.${c.tabela} TO ${papel}`);
        await admin(`GRANT ${papel} TO '${conta}'@'%'`);
      }
    });

    afterAll(async () => {
      await efemero?.encerrar();
      if (raiz) {
        for (const p of [`'${conta}'@'%'`, ...[...papeis.values()]]) {
          const ehConta = p.startsWith("'");
          await admin(ehConta ? `DROP USER IF EXISTS ${p}` : `DROP ROLE IF EXISTS ${p}`).catch(
            () => undefined,
          );
        }
        const sobra = await raiz.lerPlataforma('sbis26-limpeza', (l) =>
          l.consultar<{ n: number }>('SELECT COUNT(*) AS n FROM mysql.user WHERE user LIKE ?', [
            `sgh_t26_%${sufixo}`,
          ]),
        );
        expect(Number(sobra[0]?.n)).toBe(0);
        await raiz.encerrar();
      }
    });

    it.each(MODULOS)(
      'papel %s: SELECT passa e DELETE em tabela clínica é recusado pelo servidor (1142)',
      async (modulo) => {
        await assumir(modulo);
        const clinicas = concessoes
          .filter((c) => c.papel === `sgh_mod_${modulo}` && ehTabelaClinica(c.tabela))
          .map((c) => c.tabela);
        for (const t of TABELAS_ALVO) expect(clinicas, `${modulo} alcança ${t}`).toContain(t);
        // A conta funciona: a leitura concedida passa (contagem, sem dado).
        const n = await efemero.lerSomente({ cliente: CLIENTE, correlacao: 'sbis26-leitura' }, (l) =>
          l.consultar<{ n: number }>('SELECT COUNT(*) AS n FROM registro_assistencial'),
        );
        expect(Number(n[0]?.n)).toBeGreaterThanOrEqual(0);
        const aceitos: string[] = [];
        for (const t of clinicas) {
          const r = await tentar(`DELETE FROM ${t} WHERE id = -1`);
          if (r !== ER_TABLEACCESS_DENIED_ERROR) aceitos.push(`${t}: ${r ?? 'aceito'}`);
        }
        expect(aceitos).toEqual([]);
      },
    );

    it('papel pep (só lê o registro clínico): UPDATE no registro e na prescrição também é recusado', async () => {
      await assumir('pep');
      for (const t of TABELAS_ALVO) {
        expect(await tentar(`UPDATE ${t} SET id = id WHERE id = -1`), t).toBe(ER_TABLEACCESS_DENIED_ERROR);
      }
    });

    it('papel enfermagem: trilha de auditoria sem UPDATE nem DELETE; a escrita concedida passa', async () => {
      await assumir('enfermagem');
      expect(await tentar('UPDATE trilha_auditoria SET id = id WHERE id = -1')).toBe(
        ER_TABLEACCESS_DENIED_ERROR,
      );
      expect(await tentar('DELETE FROM trilha_auditoria WHERE id = -1')).toBe(ER_TABLEACCESS_DENIED_ERROR);
      // Controle: o mesmo papel corrige o registro (UPDATE concedido), então a recusa acima é do privilégio.
      expect(await tentar('UPDATE registro_assistencial SET id = id WHERE id = -1')).toBeNull();
    });
  },
);
