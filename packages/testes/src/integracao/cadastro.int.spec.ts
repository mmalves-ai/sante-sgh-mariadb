// Cadastro de pacientes sobre a cópia (ficha do M11, seção 10): as chaves de SGH_BUSCA_NOME gravadas na
// MESMA transação do cadastro e da alteração; paciente criado "por fora" (a mesma gravação sem o índice, como
// o SPDATA faria: só os triggers) achado pela busca depois de um ciclo do vigia, dentro da meta de 10 s; as
// buscas sem leitura sequencial de RICADPAC nem de SGH_BUSCA_NOME (estatística por tabela da transação,
// MON$TABLE_STATS); colisão com a linha alterada desde a leitura; LOCK TIMEOUT com a linha travada por outra
// conexão. Toda gravação em transação desfeita; massa sintética marcada; saída só com contagens e tempos.
// Prova do ROLLBACK: o retrato das tabelas que a receita toca (contagem ou maior chave; nenhum dado de linha)
// igual antes e depois (só as diferenças são impressas, e devem ser zero).
import {
  alterarPaciente,
  buscarPacientesDireto,
  cadastrarPaciente,
  cicloVigiaBusca,
  definirOperacao,
  gravarMarca,
  ErroOperacao,
  idsPorPalavra,
  idsPorPalavras,
  lerPaciente,
  lerPacientesPorIds,
  novaMemoriaVigia,
  operacao,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cepCompleto,
  cpfLivre,
  loginLivre,
  MARCA_SINTETICA,
  pacienteSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const criarUsuario = operacao('acesso.criarUsuarioIntegracao');
type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

/** Palavra só de letras, única por execução (a busca por palavra acha exatamente o paciente sintético). */
function palavraUnica(semente: number): string {
  let n = semente;
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += String.fromCharCode(65 + (n % 26));
    n = Math.floor(n / 26) + 7;
  }
  return `ZQ${s}`;
}

describe.skipIf(!PODE_ESCREVER)('cadastro de pacientes na cópia (transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  async function operador(e: Escritor): Promise<string> {
    const login = (await loginLivre(e, Date.now() % 1_000_000)).toUpperCase();
    await a.executor.executar(
      criarUsuario,
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      {
        escritor: e,
      },
    );
    return login;
  }

  async function novoPaciente(e: Escritor, nome: string, op = cadastrarPaciente) {
    const usuario = await operador(e);
    const cpf = await cpfLivre(e, (Date.now() + Math.floor(Math.random() * 1000)) % 90_000_000);
    const cep = await cepCompleto(e, new Set(['81', '8', '65', '100']));
    const s = await a.executor.executar(
      op,
      a.cod,
      { ...pacienteSintetico('com-cep', cpf, cep), nome },
      ctxOperacao(a, usuario),
      {
        escritor: e,
      },
    );
    return { id: num(s.resultado['idPaciente']), usuario };
  }

  /** Contagem (tabela pequena) ou maior chave (tabela grande) das tabelas que as receitas tocam. */
  const RETRATO: readonly (readonly [string, string])[] = [
    ['RICADPAC', 'SELECT COUNT(*) N FROM RICADPAC'],
    ['HTPACIENTE', 'SELECT MAX(ID) N FROM HTPACIENTE'],
    ['HTPACTELEFONE', 'SELECT MAX(ID_HTPACIENTE) N FROM HTPACTELEFONE'],
    ['TBGERSEQ', 'SELECT COUNT(*) + COALESCE(SUM(SEQ), 0) N FROM TBGERSEQ'],
    ['TBUSERS', 'SELECT COUNT(*) N FROM TBUSERS'],
    ['TBCABTRILHA', 'SELECT MAX(ID) N FROM TBCABTRILHA'],
    ['TBLANTRILHASGH', 'SELECT MAX(ID_TBCABTRILHA) N FROM TBLANTRILHASGH'],
    // SGH_TRILHA: o dev do dono (no ar sobre a mesma cópia) registra os acessos dele; conta só as linhas das
    // operações destes testes acima da maior chave de antes (abaixo, em `diferencas`).
    ['SGH_TRILHA', 'SELECT MAX(ID) N FROM SGH_TRILHA'],
    ['SGH_OUTBOX', 'SELECT MAX(ID) N FROM SGH_OUTBOX'],
    ['SGH_IDEMPOTENCIA', 'SELECT COUNT(*) N FROM SGH_IDEMPOTENCIA'],
    ['SGH_BUSCA_NOME', 'SELECT MAX(ID) N FROM SGH_BUSCA_NOME'],
  ];
  const OPERACOES_DO_TESTE = [
    'cadastro.cadastrarPaciente',
    'cadastro.alterarPaciente',
    'acesso.criarUsuarioIntegracao',
  ];
  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => {
      const r: Record<string, number> = {};
      for (const [t, sql] of RETRATO) r[t] = await contar(l, sql);
      return r;
    });
  /** As tabelas cujo retrato mudou (devem ser nenhuma depois do ROLLBACK). */
  const diferencas = async (antes: Record<string, number>, depois: Record<string, number>) => {
    const r = Object.keys(antes).filter((t) => t !== 'SGH_TRILHA' && antes[t] !== depois[t]);
    const nossas = await a.nucleo.lerSomente(ctx(a), (l) =>
      contar(
        l,
        `SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID > ? AND OPERACAO IN (${OPERACOES_DO_TESTE.map(() => '?').join(', ')})`,
        [antes['SGH_TRILHA'] ?? 0, ...OPERACOES_DO_TESTE],
      ),
    );
    return nossas > 0 ? [...r, 'SGH_TRILHA'] : r;
  };

  const chaves = (e: Parameters<typeof contar>[0], id: number) =>
    contar(e, "SELECT COUNT(*) N FROM SGH_BUSCA_NOME WHERE ENTIDADE = 'paciente' AND ID_LEGADO = ?", [id]);

  it('SGH_BUSCA_NOME na mesma transação do cadastro e da alteração; desfeita junto', async () => {
    const palavra = palavraUnica(Date.now());
    const nova = palavraUnica(Date.now() + 99_991);
    let id = 0;
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await novoPaciente(e, `PACIENTE ${MARCA_SINTETICA} ${palavra}`);
      id = p.id;
      const achou = (await idsPorPalavra(e, 'paciente', ['nome'], palavra)).ids;
      const lido = await lerPaciente(e, id);
      await a.executor.executar(
        alterarPaciente,
        a.cod,
        { idPaciente: id, versao: lido!.versao, alteracoes: { nome: `PACIENTE ${MARCA_SINTETICA} ${nova}` } },
        ctxOperacao(a, p.usuario),
        { escritor: e },
      );
      return {
        chaves: (await chaves(e, id)) > 0,
        achouNoCadastro: achou.has(id),
        achouPeloNovo: (await idsPorPalavra(e, 'paciente', ['nome'], nova)).ids.has(id),
        antigoSaiu: !(await idsPorPalavra(e, 'paciente', ['nome'], palavra)).ids.has(id),
      };
    });
    expect(r).toEqual({ chaves: true, achouNoCadastro: true, achouPeloNovo: true, antigoSaiu: true });
    const depois = await a.nucleo.lerSomente(ctx(a), (l) => chaves(l, id));
    expect(depois).toBe(0);
    const mudaram = await diferencas(antes, await retrato());
    expect(mudaram).toEqual([]);
    console.log(
      `[${a.cod}] índice na mesma transação: ${JSON.stringify(r)}; depois do ROLLBACK ${depois} chave; tabelas com retrato diferente: ${mudaram.length}`,
    );
  });

  it('paciente criado por fora (só os triggers, sem o índice) aparece na busca depois do vigia, em até 10 s', async () => {
    // A mesma gravação SEM o passo SGH_ (o que o SPDATA faz): o retrato do trigger é a mudança que o vigia lê.
    const semSgh = { ...cadastrarPaciente };
    delete semSgh.sgh;
    const comoSpdata = definirOperacao(semSgh);
    const palavra = palavraUnica(Date.now() + 31_337);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await novoPaciente(e, `PACIENTE ${MARCA_SINTETICA} ${palavra}`, comoSpdata);
      const antes = (await idsPorPalavra(e, 'paciente', ['nome'], palavra)).ids.has(p.id);
      const inicio = Date.now();
      let ciclos = 0;
      let achou = false;
      while (!achou && ciclos < 50) {
        const c = await cicloVigiaBusca(e, 'paciente');
        ciclos++;
        achou = (await idsPorPalavra(e, 'paciente', ['nome'], palavra)).ids.has(p.id);
        if (c.lidos === 0) break;
      }
      return { antes, achou, ciclos, ms: Date.now() - inicio };
    });
    expect(r.antes).toBe(false);
    expect(r.achou).toBe(true);
    expect(r.ms).toBeLessThan(10_000);
    console.log(`[${a.cod}] vigia: achado em ${r.ciclos} ciclo(s), ${r.ms} ms (meta 10 s)`);
  });

  it('commit fora da ordem do generator: a versão abaixo da marca é lida pela janela do vigia', async () => {
    // Na cópia não há COMMIT no legado: a "versão atrasada" é simulada pondo a marca d'água ACIMA do retrato do
    // paciente por fora (como se uma versão maior já tivesse sido lida); a janela do vigia tem de achá-lo.
    const semSgh = { ...cadastrarPaciente };
    delete semSgh.sgh;
    const comoSpdata = definirOperacao(semSgh);
    const palavra = palavraUnica(Date.now() + 77_777);
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await novoPaciente(e, `PACIENTE ${MARCA_SINTETICA} ${palavra}`, comoSpdata);
      const [v] = await e.consultar('SELECT MAX(ID) M FROM HTPACIENTE WHERE ID_RICADPAC = ?', [p.id], {
        teto: 1,
      });
      await gravarMarca(e, 'paciente', num(v?.['M']) + 1);
      const semMemoria = await cicloVigiaBusca(e, 'paciente');
      const achouSem = (await idsPorPalavra(e, 'paciente', ['nome'], palavra)).ids.has(p.id);
      // A janela é relida em lotes (LOTE_VIGIA por ciclo; processo novo revê a janela inteira uma vez).
      const memoria = novaMemoriaVigia();
      let achou = false;
      let atrasados = 0;
      for (let i = 0; i < 5 && !achou; i++) {
        const c = await cicloVigiaBusca(e, 'paciente', memoria);
        atrasados += c.atrasados;
        achou = (await idsPorPalavra(e, 'paciente', ['nome'], palavra)).ids.has(p.id);
        if (c.lidos === 0) break;
      }
      return { achouSem, semMemoriaLidos: semMemoria.lidos, achou, atrasados };
    });
    expect(r.achouSem).toBe(false);
    expect(r.achou).toBe(true);
    expect(r.atrasados).toBeGreaterThan(0);
    expect(await diferencas(antes, await retrato())).toEqual([]);
    console.log(`[${a.cod}] janela do vigia: ${r.atrasados} versão(ões) atrás da marca relida(s); achado`);
  });

  it('buscas sem leitura sequencial de RICADPAC nem de SGH_BUSCA_NOME (estatística da transação)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const tempos: Record<string, number> = {};
      const medir = async (nome: string, f: () => Promise<unknown>) => {
        const t0 = performance.now();
        await f();
        tempos[nome] = Math.round(performance.now() - t0);
      };
      await medir('palavra', () => idsPorPalavra(l, 'paciente', ['nome', 'social'], 'MARIA'));
      await medir('mae', () => idsPorPalavra(l, 'paciente', ['mae'], 'SOUZA'));
      await medir('duasPalavras', () =>
        idsPorPalavras(l, 'paciente', ['nome', 'social'], ['MARIA', 'SILVA']),
      );
      await medir('tresPalavras', () =>
        idsPorPalavras(l, 'paciente', ['nome', 'social'], ['JOSE', 'DOS', 'SANTOS']),
      );
      await medir('maeDuas', () => idsPorPalavras(l, 'paciente', ['mae'], ['ANA', 'SOUZA']));
      await medir('telefone', () => idsPorPalavra(l, 'paciente', ['telefone'], '99999999'));
      await medir('cpf', () => buscarPacientesDireto(l, { tipo: 'cpf', cpf: 12345678909 }));
      await medir('prontuario', () => buscarPacientesDireto(l, { tipo: 'prontuario', prontuario: 1 }));
      await medir('nascimento', () => buscarPacientesDireto(l, { tipo: 'nascimento', data: '1980-01-01' }));
      await medir('ids', () => lerPacientesPorIds(l, [1, 2, 3]));
      // O instantâneo do monitoramento nasce na primeira consulta MON$ da transação: depois das buscas.
      const linhas = await l.consultar(
        `SELECT TRIM(TS.MON$TABLE_NAME) T, RS.MON$RECORD_SEQ_READS S, RS.MON$RECORD_IDX_READS I
           FROM MON$TRANSACTIONS TR
           JOIN MON$TABLE_STATS TS ON TS.MON$STAT_ID = TR.MON$STAT_ID AND TS.MON$STAT_GROUP = 2
           JOIN MON$RECORD_STATS RS ON RS.MON$STAT_ID = TS.MON$RECORD_STAT_ID
          WHERE TR.MON$TRANSACTION_ID = CURRENT_TRANSACTION
            AND TS.MON$TABLE_NAME IN ('RICADPAC', 'SGH_BUSCA_NOME')`,
        [],
        { teto: 10 },
      );
      const est = Object.fromEntries(
        linhas.map((x) => [String(x['T']), { sequencial: num(x['S']), indice: num(x['I']) }]),
      );
      return { est, tempos };
    });
    expect(r.est['RICADPAC']?.sequencial ?? 0).toBe(0);
    expect(r.est['SGH_BUSCA_NOME']?.sequencial ?? 0).toBe(0);
    expect(r.est['SGH_BUSCA_NOME']?.indice ?? 0).toBeGreaterThan(0);
    console.log(`[${a.cod}] leituras: ${JSON.stringify(r.est)}; tempos (ms): ${JSON.stringify(r.tempos)}`);
  });

  it('colisão: a linha mudou desde a leitura → conflito de versão com os campos; nada gravado pela segunda', async () => {
    let codigo = '';
    let colunas: readonly string[] = [];
    let retratosDoPrimeiro = 0;
    let retratosDepois = 0;
    const antes = await retrato();
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const p = await novoPaciente(e, `PACIENTE ${MARCA_SINTETICA} ${palavraUnica(Date.now() + 7)}`);
      const lido = await lerPaciente(e, p.id);
      const versoes = () => contar(e, 'SELECT COUNT(*) N FROM HTPACIENTE WHERE ID_RICADPAC = ?', [p.id]);
      const v0 = await versoes();
      // Primeiro operador grava o telefone (a linha muda por fora da tela do segundo).
      await a.executor.executar(
        alterarPaciente,
        a.cod,
        { idPaciente: p.id, versao: lido!.versao, alteracoes: { telefone: '2133334444' } },
        ctxOperacao(a, p.usuario),
        { escritor: e },
      );
      retratosDoPrimeiro = (await versoes()) - v0;
      try {
        await a.executor.executar(
          alterarPaciente,
          a.cod,
          { idPaciente: p.id, versao: lido!.versao, alteracoes: { bairro: 'BAIRRO SINTETICO' } },
          ctxOperacao(a, p.usuario),
          { escritor: e },
        );
      } catch (x) {
        codigo = x instanceof ErroOperacao ? (x.problema.codigo ?? '') : 'outro';
        colunas = x instanceof ErroOperacao ? (x.problema.colunas ?? []) : [];
      }
      const depois = await lerPaciente(e, p.id);
      expect(depois?.bairro).not.toBe('BAIRRO SINTETICO');
      retratosDepois = (await versoes()) - v0;
    });
    expect(codigo).toBe('conflito-versao');
    expect(colunas.length).toBeGreaterThan(0);
    // A segunda (recusada) não deixou retrato: só o da primeira alteração, desfeito com o resto.
    expect(retratosDepois).toBe(retratosDoPrimeiro);
    const mudaram = await diferencas(antes, await retrato());
    expect(mudaram).toEqual([]);
    console.log(
      `[${a.cod}] colisão: ${codigo}; ${colunas.length} coluna(s) apontada(s); retratos da recusada ${retratosDepois - retratosDoPrimeiro}; tabelas com retrato diferente depois do ROLLBACK: ${mudaram.length}`,
    );
  });

  it('LOCK TIMEOUT: paciente travado por outra conexão → registro em edição, nada gravado', async () => {
    // M11 D-TRV-1: o alvo da trava tem de ser uma linha CONFIRMADA (READ COMMITTED RECORD_VERSION: a outra conexão
    // não vê um paciente sintético não confirmado, e o legado nunca recebe COMMIT). Salvaguardas: nada da ficha é
    // lido (só o ID e o carimbo da linha); a versão mandada é SINTÉTICA e impossível (carimbo de 1900), então, sem a
    // trava, a alteração seria recusada por conflito de versão antes de qualquer UPDATE; e tudo é desfeito.
    const alvo = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [x] = await l.consultar(
        "SELECT FIRST 1 ID FROM RICADPAC WHERE ATIVO = 'T' AND ID = ID_RICADPAC_UNIFICADO ORDER BY ID DESC",
        [],
        { teto: 1 },
      );
      return num(x?.['ID']);
    });
    const carimbo = () =>
      a.nucleo.lerSomente(ctx(a), async (l) => {
        const [x] = await l.consultar(
          'SELECT DATA_HORA_ULTIMA_ATUALIZACAO C FROM RICADPAC WHERE ID = ?',
          [alvo],
          { teto: 1 },
        );
        return x?.['C'] instanceof Date ? x['C'].toISOString() : String(x?.['C'] ?? '');
      });
    const antes = await carimbo();
    const retratoAntes = await retrato();
    const versaoImpossivel = JSON.stringify({ DATA_HORA_ULTIMA_ATUALIZACAO: '1900-01-01T00:00:00.000Z' });
    let codigo = '';
    let segundos = 0;
    await a.nucleo.desfazendoNaCopia(ctx(a), async (trava) => {
      await trava.consultar('SELECT ID FROM RICADPAC WHERE ID = ? WITH LOCK', [alvo], { teto: 1 });
      const inicio = Date.now();
      try {
        await a.executor.executar(
          alterarPaciente,
          a.cod,
          { idPaciente: alvo, versao: versaoImpossivel, alteracoes: { complemento: 'TRAVA SGH' } },
          ctxOperacao(a, 'SGH.M11'),
          { desfazer: true },
        );
      } catch (x) {
        codigo = x instanceof ErroOperacao ? (x.problema.codigo ?? '') : 'outro';
      }
      segundos = Math.round((Date.now() - inicio) / 100) / 10;
    });
    expect(codigo).toBe('registro-em-edicao');
    expect(await carimbo()).toBe(antes);
    const mudaram = await diferencas(retratoAntes, await retrato());
    expect(mudaram).toEqual([]);
    console.log(
      `[${a.cod}] linha travada: ${codigo} depois de ${segundos} s; tabelas com retrato diferente: ${mudaram.length}`,
    );
  });
});
