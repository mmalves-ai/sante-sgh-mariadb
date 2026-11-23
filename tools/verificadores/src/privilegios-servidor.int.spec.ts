// SBIS-26 (apagar registro clínico recusado): prova no SERVIDOR que o papel de banco de um módulo, como o
// privilegios:gerar o escreve em infra/mariadb/privilegios/0001_papeis_por_modulo.aplicar.sql, não apaga registro
// clínico. Para cada módulo provado, as linhas GRANT do papel saem do script versionado, aplicadas a um papel efêmero
// no banco do cliente de teste; uma conta efêmera recebe esse papel como padrão e tenta DELETE nas tabelas clínicas
// do alcance (e UPDATE onde o papel só lê). O MariaDB recusa com ER_TABLEACCESS_DENIED_ERROR (1142) antes de olhar
// linha: o WHERE nunca casa linha (id = -1), então nada é tocado nem se o servidor aceitasse. Também confere que o
// gerador nunca concede DELETE a tabela clínica para papel nenhum. Conta e papel são apagados no fim.
// Nenhum dado lido. SGH_NUCLEO_SEM_BANCO=1 pula o arquivo. A parte estática (o que o script e o alcance concedem)
// fica em privilegios-sem-delete-clinico.spec.ts, que roda na esteira.
// Rodar: ./pnpm exec vitest run --config tools/verificadores/vitest.integracao.config.ts src/privilegios-servidor.int.spec.ts
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ehTabelaClinica } from '@sgh/contratos';
import { errnoDe, fecharDiasTrilha, gravarTrilha, lerConfiguracaoNucleo, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ambienteDoRepositorio } from './copia-leitura.ts';
import { caminhoScript, concessoesDoScript as concessoesDoArquivo, RAIZ } from './privilegios.ts';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'teste_nucleo';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const ER_TABLEACCESS_DENIED_ERROR = 1142;
/** Módulos provados no servidor: o PEP (só lê o registro clínico) e a enfermagem (grava e corrige registro e prescrição). */
const MODULOS = ['pep', 'enfermagem'] as const;
const TABELAS_ALVO = ['registro_assistencial', 'prescricao'] as const;

const LER_SCRIPT = () => readFileSync(resolve(RAIZ, caminhoScript('aplicar')), 'utf8');
const concessoesDoScript = () => concessoesDoArquivo(LER_SCRIPT());
/** O anexo da implantação: o papel único da conta da aplicação no banco do cliente (papel_aplicacao). */
const ANEXO_APLICACAO = 'docs/implantacao/anexos/privilegios-papel.sql';
const GRANT_ANEXO = /^GRANT ([A-Z, ]+) ON ([a-z][a-z0-9_]*) TO papel_aplicacao;$/;

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
      // O papel da conta da aplicação em produção (anexo da implantação, papel padrão da conta): só os GRANT dele
      // (os REVOKE do anexo retiram o que um papel novo não tem).
      const aplicacao = `sgh_t26_apl_${sufixo}`;
      papeis.set('aplicacao', aplicacao);
      await admin(`CREATE ROLE ${aplicacao}`);
      const anexo = readFileSync(resolve(RAIZ, ANEXO_APLICACAO), 'utf8').split('\n');
      let n = 0;
      for (const linha of anexo) {
        const m = GRANT_ANEXO.exec(linha.trim());
        if (!m) continue;
        n++;
        await admin(`GRANT ${m[1]} ON \`${banco}\`.${m[2]} TO ${aplicacao}`);
      }
      expect(n).toBe(anexo.filter((l) => l.startsWith('GRANT ')).length);
      await admin(`GRANT ${aplicacao} TO '${conta}'@'%'`);
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

    it('papel da aplicação (anexo da implantação): DELETE clínico recusado; a trilha encadeada grava pelo núcleo', async () => {
      await assumir('aplicacao');
      for (const t of TABELAS_ALVO) {
        expect(await tentar(`DELETE FROM ${t} WHERE id = -1`), t).toBe(ER_TABLEACCESS_DENIED_ERROR);
      }
      // SBIS-16 pela conta real: cabeça da cadeia (INSERT, FOR UPDATE, UPDATE), elo e fecho do dia, desfeitos no fim.
      const id = await efemero.escrever(
        { cliente: CLIENTE, correlacao: 'sbis26-trilha' },
        async (e) => {
          const x = await gravarTrilha(e, {
            estabelecimento: null,
            usuario: null,
            acao: 'operacao',
            entidade: 'teste_privilegio',
            entidadeId: null,
            correlacao: 'sbis26-trilha',
            ocorridoEm: new Date(),
          });
          await fecharDiasTrilha(e);
          return x;
        },
        false,
      );
      expect(id).toBeGreaterThan(0);
      // O fecho e o marco do encadeamento só recebem inclusão; a trilha não se altera nem se apaga.
      expect(await tentar('UPDATE trilha_auditoria_fecho SET versao = versao WHERE id = -1')).toBe(
        ER_TABLEACCESS_DENIED_ERROR,
      );
      expect(await tentar('DELETE FROM trilha_auditoria_fecho WHERE id = -1')).toBe(
        ER_TABLEACCESS_DENIED_ERROR,
      );
      expect(await tentar('UPDATE trilha_encadeamento_inicio SET versao = versao WHERE id = -1')).toBe(
        ER_TABLEACCESS_DENIED_ERROR,
      );
      expect(await tentar('DELETE FROM trilha_auditoria WHERE id = -1')).toBe(ER_TABLEACCESS_DENIED_ERROR);
    });
  },
);
