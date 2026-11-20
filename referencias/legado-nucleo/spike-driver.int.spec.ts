// Spike do driver (ficha do M02, seção 1; cap-09 §9.17 e cap-10 §10.2) sobre a cópia descartável, em
// todos os estabelecimentos configurados (hoje só pc; hs aguarda a cópia do Serrano, HS-1). Nada é
// gravado em tabela: ida e volta pelo servidor (CAST de parâmetro), contagens e MON$. A contagem de linhas
// afetadas usa uma transação de escrita desfeita (ROLLBACK) e o próprio anexo de teste em MON$.
// Saída: só contagens e marcadores; o valor acentuado de TBESPEC nunca é impresso.
import { createNativeClient } from 'node-firebird-driver-native';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lerData, lerHoraHHMM, prepararData } from './codec.js';
import { CONFIGURACAO_PADRAO } from './configuracao.js';
import { codificarCp1252, decodificarCp1252, registrarCodificacaoNone } from './cp1252.js';
import { clientesNativosAbertos, criarDriverNativo } from './driver-nativo.js';
import { GDS_EXCECAO, GDS_VALIDACAO, gdscodeDe, problemaDoLegado } from './erros.js';
import { codigos, contexto, criarNucleoIntegracao, env, estabelecimentos } from './integracao.spec-util.js';
import type { NucleoLegado } from './legado.js';
import { PoolsDaRede } from './pool.js';
import { escreverReservado } from './transacao.js';

const TODOS = Buffer.from(Uint8Array.from({ length: 256 }, (_, i) => i));

describe.each(codigos)('spike do driver nativo — estabelecimento %s', (cod) => {
  let nucleo: NucleoLegado;
  const ctx = () => contexto(cod, nucleo.rede);
  const um = async (sql: string, p: unknown[] = []) => (await nucleo.consultar(ctx(), sql, p))[0] ?? {};

  beforeAll(() => {
    nucleo = criarNucleoIntegracao();
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('banco em charset NONE (texto CP1252)', async () => {
    expect(String((await um('SELECT d.RDB$CHARACTER_SET_NAME CS FROM RDB$DATABASE d'))['CS']).trim()).toBe(
      'NONE',
    );
  });

  it('os 256 bytes do CP1252 vão e voltam por CAST(? AS VARCHAR(256) CHARACTER SET NONE)', async () => {
    const texto = decodificarCp1252(TODOS);
    const r = await um('SELECT CAST(? AS VARCHAR(256) CHARACTER SET NONE) T FROM RDB$DATABASE', [texto]);
    expect(r['T']).toBe(texto);
    const b = await um(
      'SELECT CAST(CAST(? AS VARCHAR(256) CHARACTER SET NONE) AS VARCHAR(256) CHARACTER SET OCTETS) B FROM RDB$DATABASE',
      [texto],
    );
    expect(Buffer.compare(b['B'] as Buffer, TODOS)).toBe(0);
  });

  it('os 256 bytes em BLOB: dado lido e devolvido por CAST(? AS BLOB SUB_TYPE TEXT)', async () => {
    const lidos = await nucleo.lerSomente(ctx(), async (l) => {
      const [r] = await l.consultar(
        'SELECT CAST(? AS BLOB SUB_TYPE TEXT CHARACTER SET NONE) B FROM RDB$DATABASE',
        [TODOS],
      );
      return l.lerBlob(r?.['B']);
    });
    expect(Buffer.compare(lidos, TODOS)).toBe(0);
    // BLOB de texto do banco lido como dado (fonte de um trigger do legado; só o tamanho é conferido).
    const tamanho = await nucleo.lerSomente(ctx(), async (l) => {
      const [t] = await l.consultar(
        'SELECT FIRST 1 t.RDB$TRIGGER_SOURCE F FROM RDB$TRIGGERS t WHERE t.RDB$SYSTEM_FLAG = 0 AND t.RDB$TRIGGER_SOURCE IS NOT NULL',
      );
      return (await l.lerBlob(t?.['F'])).length;
    });
    expect(tamanho).toBeGreaterThan(0);
  });

  it("o padrão 'win1252' do iconv-lite perde 5 bytes e o 'utf8' troca acento (por isso não são usados)", async () => {
    const e = estabelecimentos.find((x) => x.codigo === cod);
    if (!e) throw new Error('sem estabelecimento');
    const cliente = createNativeClient(CONFIGURACAO_PADRAO.bibliotecaCliente);
    try {
      for (const charSetForNONE of ['win1252', 'utf8']) {
        const att = await cliente.connect(`inet://${e.host}:${e.porta}/${e.banco}`, {
          username: e.usuario,
          password: e.senha,
          charSetForNONE,
        });
        const tr = await att.startTransaction({ accessMode: 'READ_ONLY' });
        // utf8: o texto nem cabe (acento vira 2 bytes); win1252: cabe, mas 5 bytes viram '?'.
        const preserva = await att
          .executeSingleton(
            tr,
            'SELECT CAST(CAST(? AS VARCHAR(256) CHARACTER SET NONE) AS VARCHAR(256) CHARACTER SET OCTETS) FROM RDB$DATABASE',
            [decodificarCp1252(TODOS)],
          )
          .then(
            ([b]) => Buffer.compare(b as Buffer, TODOS) === 0,
            () => false,
          );
        expect(preserva).toBe(false);
        await tr.rollback();
        await att.disconnect();
      }
    } finally {
      await cliente.dispose();
    }
    expect(registrarCodificacaoNone()).toBe('sghcp1252');
  });

  it('parâmetro acentuado casa no WHERE de tabela de domínio (TBESPEC): contagem por parâmetro = por literal', async () => {
    const nomes = (await nucleo.consultar(ctx(), 'SELECT e.NOME FROM TBESPEC e', [], { teto: 5000 }))
      .map((r) => r['NOME'])
      .filter((n): n is string => typeof n === 'string' && /[^\x20-\x7e]/.test(n));
    expect(nomes.length).toBeGreaterThan(0);
    const valor = nomes[0] as string;
    const hex = codificarCp1252(valor).toString('hex');
    const porParametro = Number(
      (await um('SELECT COUNT(*) N FROM TBESPEC e WHERE e.NOME = ?', [valor]))['N'],
    );
    const porLiteral = Number(
      (
        await um(
          `SELECT COUNT(*) N FROM TBESPEC e WHERE e.NOME = CAST(x'${hex}' AS VARCHAR(250) CHARACTER SET NONE)`,
        )
      )['N'],
    );
    expect(porParametro).toBeGreaterThan(0);
    expect(porParametro).toBe(porLiteral);
    console.log(
      `[${cod}] TBESPEC: ${nomes.length} nome(s) acentuado(s); contagem por parâmetro ${porParametro} = por literal ${porLiteral}`,
    );
  });

  it('1899-12-30 00:00:00 exata nos dois sentidos (RICADPAC.DTOBITO: parâmetro = literal; processo em UTC)', async () => {
    expect(process.env['TZ']).toBe('UTC');
    const porParametro = Number(
      (await um('SELECT COUNT(*) N FROM RICADPAC p WHERE p.DTOBITO = ?', [prepararData(null)]))['N'],
    );
    const porLiteral = Number(
      (await um("SELECT COUNT(*) N FROM RICADPAC p WHERE p.DTOBITO = DATE '1899-12-30'"))['N'],
    );
    const total = Number((await um('SELECT COUNT(*) N FROM RICADPAC p'))['N']);
    expect(porParametro).toBe(porLiteral);
    expect(porParametro).toBeGreaterThan(0);
    console.log(
      `[${cod}] RICADPAC.DTOBITO = sentinela: parâmetro ${porParametro} = literal ${porLiteral} de ${total}`,
    );
    const r = await um(
      "SELECT CAST('1899-12-30 00:00:00' AS TIMESTAMP) L, CAST(? AS TIMESTAMP) P, CAST(CAST(? AS TIMESTAMP) AS VARCHAR(30)) TXT FROM RDB$DATABASE",
      [prepararData(null), prepararData(null)],
    );
    expect(lerData(r['L'] as Date)).toEqual({ tipo: 'vazio' });
    expect(lerData(r['P'] as Date)).toEqual({ tipo: 'vazio' });
    expect(String(r['TXT'])).toBe('1899-12-30 00:00:00.0000');
  });

  it('hora HHMM chega como texto de quatro dígitos', async () => {
    const r = await um('SELECT CAST(? AS VARCHAR(4) CHARACTER SET NONE) H FROM RDB$DATABASE', ['0830']);
    expect(r['H']).toBe('0830');
    expect(lerHoraHHMM(r['H'] as string)).toEqual({ hora: 8, minuto: 30 });
    const a = await um(
      "SELECT COUNT(*) N, SUM(CASE WHEN a.HORA SIMILAR TO '[0-9]{4}' THEN 1 ELSE 0 END) H FROM SIPACAGI a",
    );
    expect(Number(a['N'])).toBeGreaterThan(0);
    console.log(`[${cod}] SIPACAGI.HORA: ${a['H']} de ${a['N']} no formato HHMM`);
  });

  it('autenticação Srp e WireCrypt ligado', async () => {
    const r = await um(
      "SELECT a.MON$AUTH_METHOD M, RDB$GET_CONTEXT('SYSTEM', 'WIRE_ENCRYPTED') W FROM MON$ATTACHMENTS a WHERE a.MON$ATTACHMENT_ID = CURRENT_CONNECTION",
    );
    expect(String(r['M']).trim()).toBe('Srp');
    expect(r['W']).toBe('TRUE');
  });

  it('número de linhas afetadas informado (transação de escrita desfeita, LOCK TIMEOUT configurado)', async () => {
    const e = estabelecimentos.filter((x) => x.codigo === cod);
    // O driver extra é encerrado no fim. Antes do cliente compartilhado (driver-nativo.ts), o cliente sem
    // dispose deixava o Master do addon pendurado depois do GC e o próximo erro caía com SIGSEGV (ADR 0010).
    const driver = criarDriverNativo();
    const pools = new PoolsDaRede(nucleo.rede, e, driver, nucleo.config, env);
    try {
      // Um segundo anexo do próprio teste, encerrado por DELETE em MON$ATTACHMENTS (tabela virtual).
      // O encerramento é imediato e NÃO volta com o ROLLBACK; o filtro (ID, PID deste processo, mesmo
      // usuário, nunca a própria conexão) impede atingir anexo de outro sistema (a sante-api usa a cópia).
      // "Nenhuma linha" é medido em tabela virtual, sem comando de escrita em tabela do legado.
      const [alvo] = await nucleo.consultar(ctx(), 'SELECT CURRENT_CONNECTION C FROM RDB$DATABASE');
      const r = await escreverReservado(
        pools,
        nucleo.config,
        ctx(),
        async (w) => {
          const [t] = await w.consultar(
            'SELECT t.MON$LOCK_TIMEOUT LT, t.MON$READ_ONLY RO FROM MON$TRANSACTIONS t WHERE t.MON$TRANSACTION_ID = CURRENT_TRANSACTION',
          );
          const nenhuma = await w.executar('DELETE FROM MON$STATEMENTS s WHERE 1 = 0');
          const uma = await w.executar(
            'DELETE FROM MON$ATTACHMENTS a WHERE a.MON$ATTACHMENT_ID = ? AND a.MON$REMOTE_PID = ? ' +
              'AND a.MON$USER = CURRENT_USER AND a.MON$ATTACHMENT_ID <> CURRENT_CONNECTION',
            [alvo?.['C'], process.pid],
          );
          return { lt: t?.['LT'], ro: t?.['RO'], nenhuma, uma };
        },
        { confirmar: false },
      );
      expect(r).toEqual({ lt: nucleo.config.lockTimeoutSegundos, ro: 0, nenhuma: 0, uma: 1 });
    } finally {
      await pools.encerrar();
      await driver.encerrar();
    }
    // O driver extra usou o cliente nativo do núcleo (um por biblioteca no processo) e não o descartou.
    expect(clientesNativosAbertos()).toBe(1);
    // O núcleo percebe o anexo encerrado, descarta e abre outro.
    await expect(nucleo.consultar(ctx(), 'SELECT 1 X FROM RDB$DATABASE')).rejects.toThrow();
    expect((await nucleo.consultar(ctx(), 'SELECT 1 X FROM RDB$DATABASE'))[0]?.['X']).toBe(1);
  });

  it('a leitura roda em READ COMMITTED READ ONLY', async () => {
    const t = await um(
      'SELECT t.MON$READ_ONLY RO, t.MON$ISOLATION_MODE IM FROM MON$TRANSACTIONS t WHERE t.MON$TRANSACTION_ID = CURRENT_TRANSACTION',
    );
    expect(t).toEqual({ RO: 1, IM: 2 }); // 2 = READ COMMITTED RECORD_VERSION
  });

  it('exceção do legado e validação de domínio viram 409 em português (sem mensagem crua)', async () => {
    const [ex] = await nucleo.consultar(
      ctx(),
      'SELECT FIRST 1 TRIM(e.RDB$EXCEPTION_NAME) N FROM RDB$EXCEPTIONS e WHERE e.RDB$SYSTEM_FLAG = 0 ORDER BY 1',
    );
    const erroExcecao = await nucleo
      .consultar(
        ctx(),
        `EXECUTE BLOCK RETURNS (X INTEGER) AS BEGIN EXCEPTION ${String(ex?.['N'])}; SUSPEND; END`,
        [],
        { permitirBloco: true }, // exceção explícita da guarda de leitura: o bloco só lança a exceção
      )
      .catch((e: unknown) => e);
    expect(gdscodeDe(erroExcecao)).toBe(GDS_EXCECAO);
    expect(problemaDoLegado(erroExcecao).problema).toMatchObject({ status: 409, codigo: 'legado-recusa' });
    const [dom] = await nucleo.consultar(
      ctx(),
      "SELECT FIRST 1 TRIM(f.RDB$FIELD_NAME) N FROM RDB$FIELDS f WHERE f.RDB$SYSTEM_FLAG = 0 AND f.RDB$FIELD_NAME = 'LOGICO'",
    );
    if (dom) {
      const erroValidacao = await nucleo
        .consultar(ctx(), 'SELECT CAST(? AS LOGICO) V FROM RDB$DATABASE', ['X'])
        .catch((e: unknown) => e);
      expect(gdscodeDe(erroValidacao)).toBe(GDS_VALIDACAO);
      expect(problemaDoLegado(erroValidacao).problema.status).toBe(409);
      expect(problemaDoLegado(erroValidacao).log.mensagem).not.toContain('"X"');
    }
  });
});
