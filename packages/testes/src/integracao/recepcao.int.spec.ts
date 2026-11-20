// Recepção sobre a cópia (ficha do M19, seções 8 e 10), sempre em transação desfeita e sob a trava da cópia:
//   - regra 1: o número da senha só do contador do dia do outro sistema: o novo emite, o escritor legado simulado
//     (o que o procedimento SP_GERA_SENHA_ATENDIMENTO e a tela do outro sistema gravam) emite no mesmo contador, e
//     o novo continua a sequência; dois emissores do novo na primeira do dia: o segundo espera a trava e recebe
//     "registro em edição" (nunca o mesmo número);
//   - regra 2: a chamada é SEM ESPERA: com a senha travada por outra conexão (o outro guichê), a transação NO WAIT
//     falha na hora (bem abaixo do LOCK TIMEOUT) e nada é gravado; a próxima livre é chamada; a fila não chama duas
//     vezes a mesma senha;
//   - regra 7: a chamada feita pelo outro sistema (o guichê que passou de 0 a um número, a linha C nova) aparece no
//     retrato seguinte das senhas do dia (o mesmo diff que o painel usa), e a do novo também;
//   - regras 4 e 5: encaminhar só para o local permitido; o "diversos" conclui com L e o motivo fixo;
//   - o guichê aberto no outro sistema aparece ocupado no novo;
//   - depois do ROLLBACK, o retrato (maior senha, linhas do fluxo, contador do dia, guichês, SGH_) é igual ao de antes.
// Massa sintética (operadores sintéticos criados pelo executor); saída só com contagens e códigos.
import { chamadasEntreRetratos } from '@sgh/dominio-recepcao';
import { ErroOperacao, fonteCatalogoArquivo, operacao, senhasDoDia } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  geradorLivre,
  guicheLivre,
  guicheSemCadastro,
  legadoAbreAtendimento,
  legadoAbreGuiche,
  legadoChamaSenha,
  legadoEmiteSenha,
  recepcaoComDoisLocais,
} from '../massa/reproducao-recepcao.js';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  CATALOGO,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao
      ? (e.problema.codigo ?? 'sem-codigo')
      : `outro: ${(e as Error).message.slice(0, 80)}`;
  }
}

describe.skipIf(!PODE_ESCREVER)('recepção na cópia (transação desfeita)', () => {
  let a: Ambiente;

  beforeAll(async () => {
    // LOCK TIMEOUT curto: a espera da trava (emissão concorrente) acaba em 2 s.
    a = await prepararAmbiente({ FB_LOCK_TIMEOUT_S: '2' });
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  /** Retrato agregado das tabelas da recepção (maiores chaves e contagens; nenhum dado de linha). */
  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      senha: await contar(l, 'SELECT MAX(ID) N FROM TBSENHAATEND'),
      fluxo: await contar(l, 'SELECT MAX(ID) N FROM TBFLUXOATEND'),
      contadorHoje: await contar(l, 'SELECT COUNT(*) N FROM TBULTSENHATEND WHERE DATA = CURRENT_DATE'),
      // O valor do contador (um UPDATE do contador existente não desfeito apareceria aqui).
      contadorSoma: await contar(
        l,
        'SELECT COALESCE(SUM(SENHA), 0) N FROM TBULTSENHATEND WHERE DATA >= CURRENT_DATE - 1',
      ),
      // Soma de controle das senhas de hoje (situação e guichê) e das antigas que a chamada sem espera trava.
      senhasHoje: await contar(
        l,
        `SELECT COUNT(*) * 1000000 + COALESCE(SUM(GUICHE), 0) * 100 + COALESCE(SUM(IIF(SITUACAO = 'G', 1, 0)), 0) N
           FROM TBSENHAATEND WHERE DATA_SENHA = CURRENT_DATE`,
      ),
      senhasAntigasChamadas: await contar(
        l,
        `SELECT COALESCE(SUM(s.GUICHE), 0) N FROM TBSENHAATEND s JOIN TBGERASENHA g ON g.ID = s.ID_TBGERASENHA
          WHERE s.DATA_SENHA BETWEEN CURRENT_DATE - 400 AND CURRENT_DATE - 1 AND s.SITUACAO = 'G' AND g.ID_TBRECEPCAO = 2`,
      ),
      guiches: await contar(l, 'SELECT COUNT(*) N FROM TBSTATUSGUICHE'),
      cadastroGuiches: await contar(l, 'SELECT COUNT(*) N FROM TBGUICHE'),
      chegadas: await contar(l, 'SELECT COUNT(*) N FROM TBSENHAATEND_REPACAGD'),
      chegadasExame: await contar(l, 'SELECT COUNT(*) N FROM TBSENHAATEND_SIPACAGD'),
      senhasComAtendimento: await contar(l, 'SELECT COUNT(*) N FROM ATCABECATEND_TBSENHAATEND'),
      ext: await contar(l, 'SELECT COUNT(*) N FROM SGH_REC_SENHA_EXT'),
      eventos: await contar(l, 'SELECT COUNT(*) N FROM SGH_REC_SENHA_EVENTO'),
    }));

  async function operador(e: Escritor): Promise<string> {
    const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
    await a.executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      { escritor: e },
    );
    return login;
  }

  it('contador compartilhado com o escritor legado simulado, chamada, eventos, encaminhamento e o painel', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const emissor = await operador(e);
      const guicheiro = await operador(e);
      const exec = (op: string, entrada: unknown, quem = guicheiro) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, quem), { escritor: e });
      const g = await geradorLivre(e, { tipo: '5', prioritaria: false });
      const s1 = await exec(
        'recepcao.emitirSenha',
        { gerador: g.id, prioridade: '2', origem: 'balcao' },
        emissor,
      );
      // O escritor legado simulado: o procedimento do contador (última + 1) e a senha da tela do outro sistema.
      await legadoEmiteSenha(e, g.id, emissor);
      const s3 = await exec(
        'recepcao.emitirSenha',
        { gerador: g.id, prioridade: '2', origem: 'balcao' },
        emissor,
      );
      const numeros = (
        await e.consultar(
          'SELECT SENHA FROM TBSENHAATEND WHERE DATA_SENHA = CURRENT_DATE AND ID_TBGERASENHA = ? ORDER BY SENHA',
          [g.id],
          { teto: 100 },
        )
      ).map((x) => num(x['SENHA']));
      // O guichê e a chamada (a primeira da fila, a mais antiga), o painel antes e depois.
      const guiche = await guicheLivre(e, g.recepcao, g.local);
      await exec('recepcao.abrirGuiche', { recepcao: g.recepcao, local: g.local, guiche });
      const retratoA = (await senhasDoDia(e, a.cod, { geradores: [g.id] })).senhas;
      const c1 = await exec('recepcao.chamarSenha', {
        recepcao: g.recepcao,
        local: g.local,
        guiche,
        geradores: [g.id],
      });
      // O outro sistema chama a seguinte (o procedimento SPSENHAATEND: usuário e guichê na senha).
      const [seguinte] = await e.consultar(
        `SELECT FIRST 1 ID FROM TBSENHAATEND WHERE DATA_SENHA = CURRENT_DATE AND ID_TBGERASENHA = ? AND GUICHE = 0
          AND SITUACAO = 'G' ORDER BY DATA_HORA, SENHA`,
        [g.id],
        { teto: 1 },
      );
      await legadoChamaSenha(e, num(seguinte?.['ID']), await guicheLivre(e, g.recepcao, g.local), emissor);
      const retratoB = (await senhasDoDia(e, a.cod, { geradores: [g.id] })).senhas;
      const vistas = chamadasEntreRetratos(
        new Map(
          retratoA.map((s) => [
            s.id,
            { id: s.id, guiche: s.guiche, situacao: s.situacao, chamadasNoFluxo: s.chamadasNoFluxo },
          ]),
        ),
        retratoB.map((s) => ({
          id: s.id,
          guiche: s.guiche,
          situacao: s.situacao,
          chamadasNoFluxo: s.chamadasNoFluxo,
        })),
      ).map((x) => x.id);
      // A terceira (a do novo) fica: a próxima chamada pega ela, nunca a já chamada.
      const c2 = await exec('recepcao.chamarSenha', {
        recepcao: g.recepcao,
        local: g.local,
        guiche,
        geradores: [g.id],
      });
      const fila = await codigo(
        exec('recepcao.chamarSenha', { recepcao: g.recepcao, local: g.local, guiche, geradores: [g.id] }),
      );
      // Eventos no guichê: chamar de novo, suspender, retomar e concluir (diversos).
      const senha = num(c1.resultado['senha']);
      await exec('recepcao.registrarEventoSenha', { senha, evento: 'rechamar', local: g.local, guiche });
      await exec('recepcao.registrarEventoSenha', {
        senha,
        evento: 'suspender',
        motivo: 'DOCUMENTO',
        local: g.local,
        guiche,
      });
      await exec('recepcao.registrarEventoSenha', { senha, evento: 'retomar', local: g.local, guiche });
      await exec('recepcao.registrarEventoSenha', { senha, evento: 'liberar', local: g.local, guiche });
      const final = await e.consultar('SELECT SITUACAO, MOTIVO FROM TBSENHAATEND WHERE ID = ?', [senha], {
        teto: 1,
      });
      const letras = (
        await e.consultar('SELECT ACAO FROM TBFLUXOATEND WHERE ID_TBSENHAATEND = ? ORDER BY ID', [senha], {
          teto: 20,
        })
      ).map((x) => String(x['ACAO']).trim());
      return {
        numeros,
        sequencia: [num(s1.resultado['numero']), num(s3.resultado['numero'])],
        primeiraChamada: senha === num(s1.resultado['senha']),
        legadoVistoNoPainel: vistas.includes(num(seguinte?.['ID'])) && vistas.includes(senha),
        segundaChamadaPulouAdoLegado: num(c2.resultado['senha']) === num(s3.resultado['senha']),
        filaDepois: fila,
        situacaoFinal: String(final[0]?.['SITUACAO']).trim(),
        motivoFinal: String(final[0]?.['MOTIVO']).trim(),
        letras,
      };
    });
    expect(r).toEqual({
      numeros: [1, 2, 3],
      sequencia: [1, 3],
      primeiraChamada: true,
      legadoVistoNoPainel: true,
      segundaChamadaPulouAdoLegado: true,
      filaDepois: 'fila-vazia',
      situacaoFinal: 'L',
      motivoFinal: 'Tipo de atendimento diversos',
      letras: ['C', 'S', 'C', 'L'],
    });
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] recepção: ${JSON.stringify(r)}; retrato igual depois do ROLLBACK`);
  });

  it('chamada SEM ESPERA: a senha travada por outra conexão falha na hora; nada gravado', async () => {
    // Duas senhas antigas da cópia da mesma recepção (só os IDs em memória): uma travada pela outra conexão, a
    // outra livre; e um local ativo dessa recepção para o guichê.
    const [x, y] = await a.nucleo.lerSomente(ctx(a), (l) =>
      l.consultar(
        `SELECT FIRST 2 s.ID, s.ID_TBGERASENHA G, g.ID_TBRECEPCAO R,
            (SELECT FIRST 1 c.ID FROM TBLOCAL c WHERE c.ID_TBRECEPCAO = g.ID_TBRECEPCAO AND COALESCE(c.ATIVO, 'T') <> 'F' ORDER BY c.COD) L
           FROM TBSENHAATEND s JOIN TBGERASENHA g ON g.ID = s.ID_TBGERASENHA
          WHERE s.DATA_SENHA BETWEEN CURRENT_DATE - 400 AND CURRENT_DATE - 1 AND s.SITUACAO = 'G' AND g.ID_TBRECEPCAO = 2
          ORDER BY s.ID DESC`,
        [],
        { teto: 2, tempoMaximoMs: 120_000 },
      ),
    );
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (outra) => {
      // A outra conexão (o outro guichê) segura a senha x.
      await outra.consultar('SELECT ID FROM TBSENHAATEND WHERE ID = ? WITH LOCK', [num(x?.['ID'])], {
        teto: 1,
      });
      return a.nucleo.desfazendoNaCopia(
        ctx(a),
        async (e) => {
          const quem = await operador(e);
          const g = { recepcao: num(x?.['R']), local: num(x?.['L']) };
          const guiche = await guicheLivre(e, g.recepcao, g.local);
          const exec = (op: string, entrada: unknown) =>
            a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, quem), { escritor: e });
          await exec('recepcao.abrirGuiche', { recepcao: g.recepcao, local: g.local, guiche });
          const base = { recepcao: g.recepcao, local: g.local, guiche };
          const gx = { G: x?.['G'] };
          const gy = { G: y?.['G'] };
          const inicio = performance.now();
          const travada = await codigo(
            exec('recepcao.chamarSenha', { ...base, geradores: [num(gx?.['G'])], senha: num(x?.['ID']) }),
          );
          const ms = performance.now() - inicio;
          // A livre é travada e relida: de outro dia, nada gravado (nunca chamada duas vezes).
          const livre = await codigo(
            exec('recepcao.chamarSenha', { ...base, geradores: [num(gy?.['G'])], senha: num(y?.['ID']) }),
          );
          return { travada, menosDe1s: ms < 1_000, livre };
        },
        { semEspera: true },
      );
    });
    expect(r).toEqual({ travada: 'senha-ocupada', menosDe1s: true, livre: 'senha-de-outro-dia' });
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] chamada sem espera: ${JSON.stringify(r)}`);
  });

  it('dois emissores do novo na primeira do dia: o segundo espera a trava e recebe "registro em edição"', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const quem = await operador(e);
      const g = await geradorLivre(e, { tipo: '5', prioritaria: false });
      const s1 = await a.executor.executar(
        operacao('recepcao.emitirSenha'),
        a.cod,
        { gerador: g.id, prioridade: '2', origem: 'balcao' },
        ctxOperacao(a, quem),
        { escritor: e },
      );
      // O segundo emissor, noutra conexão e noutra transação (operador da cópia de referência: sem gravação).
      const comLog = a.nucleo.criarExecutor({
        catalogo: fonteCatalogoArquivo(CATALOGO),
        log: (m, c) => console.log('[depurar]', m, JSON.stringify(c)),
      });
      const segundo = await codigo(
        comLog.executar(
          operacao('recepcao.emitirSenha'),
          a.cod,
          { gerador: g.id, prioridade: '2', origem: 'balcao' },
          ctxOperacao(a, 'SGH.REPRODUCAO'),
          { desfazer: true },
        ),
      );
      return { primeira: num(s1.resultado['numero']), segundo };
    });
    expect(r.primeira).toBe(1);
    expect(['registro-em-edicao']).toContain(r.segundo);
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] dois emissores: ${JSON.stringify(r)}`);
  });

  it('o guichê aberto no outro sistema aparece ocupado (o número em qualquer local da recepção); só número cadastrado; encaminhar só ao local permitido', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const quem = await operador(e);
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, quem), { escritor: e });
      const [ocupado] = await e.consultar(
        'SELECT FIRST 1 NUMERO_GUICHE, ID_TBRECEPCAO, ID_TBLOCAL FROM TBSTATUSGUICHE',
        [],
        { teto: 1 },
      );
      const tomado = await codigo(
        exec('recepcao.abrirGuiche', {
          recepcao: num(ocupado?.['ID_TBRECEPCAO']),
          local: num(ocupado?.['ID_TBLOCAL']),
          guiche: num(ocupado?.['NUMERO_GUICHE']),
        }),
      );
      // O mesmo número em OUTRO local da recepção, aberto pelo outro sistema: ocupado (um número por recepção).
      const dois = await recepcaoComDoisLocais(e);
      const numero = await guicheLivre(e, dois.recepcao, dois.local);
      const outraPessoa = await operador(e);
      await legadoAbreGuiche(e, { recepcao: dois.recepcao, local: dois.local, guiche: numero }, outraPessoa);
      const outroLocal = await codigo(
        exec('recepcao.abrirGuiche', { recepcao: dois.recepcao, local: dois.outroLocal, guiche: numero }),
      );
      // A outra pessoa conduz no número dela; quem não abriu o número não chama nele.
      const chamarNoDoOutro = await codigo(
        exec('recepcao.chamarSenha', {
          recepcao: dois.recepcao,
          local: dois.outroLocal,
          guiche: numero,
          geradores: [dois.gerador],
        }),
      );
      const semCadastro = await codigo(
        exec('recepcao.abrirGuiche', {
          recepcao: dois.recepcao,
          local: dois.local,
          guiche: await guicheSemCadastro(e, dois.recepcao),
        }),
      );
      // Encaminhamento: a senha com o atendimento aberto (estado do M20 posto na transação desfeita).
      const [par] = await e.consultar(
        'SELECT FIRST 1 ID_TBLOCAL DE, ID_TBLOCAL_ENCAM_ATEND PARA FROM TBLOCALENCATE WHERE ID_TBLOCAL <> ID_TBLOCAL_ENCAM_ATEND',
        [],
        { teto: 1 },
      );
      const g = await geradorLivre(e, { tipo: '0' });
      const s = await exec('recepcao.emitirSenha', { gerador: g.id, prioridade: '2', origem: 'balcao' });
      const senha = num(s.resultado['senha']);
      const [at] = await e.consultar(
        `SELECT FIRST 1 CAST(a.ID AS VARCHAR(20)) ID FROM ATCABECATEND a
          WHERE NOT EXISTS (SELECT 1 FROM ATCABECATEND_TBSENHAATEND s WHERE s.ID_ATCABECATEND = a.ID) ORDER BY a.ID DESC`,
        [],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      await legadoAbreAtendimento(e, senha, String(at?.['ID']));
      const proibido = await codigo(
        exec('recepcao.registrarEventoSenha', {
          senha,
          evento: 'encaminhar',
          local: num(par?.['DE']),
          guiche: 0,
          destino: num(par?.['DE']) === 2 ? 3 : 2,
        }),
      );
      const permitido = await codigo(
        exec('recepcao.registrarEventoSenha', {
          senha,
          evento: 'encaminhar',
          local: num(par?.['DE']),
          guiche: 0,
          destino: num(par?.['PARA']),
        }),
      );
      const [e1] = await e.consultar(
        "SELECT ID_TBLOCAL FROM TBFLUXOATEND WHERE ID_TBSENHAATEND = ? AND ACAO = 'E'",
        [senha],
        { teto: 1 },
      );
      return {
        tomado,
        outroLocal,
        chamarNoDoOutro,
        semCadastro,
        proibido,
        permitido,
        destinoGravado: num(e1?.['ID_TBLOCAL']) === num(par?.['PARA']),
      };
    });
    expect(r).toEqual({
      tomado: 'guiche-ocupado',
      outroLocal: 'guiche-ocupado',
      chamarNoDoOutro: 'guiche-de-outro',
      semCadastro: 'guiche-nao-cadastrado',
      proibido: 'destino-nao-permitido',
      permitido: 'gravou',
      destinoGravado: true,
    });
    expect(await retrato()).toEqual(antes);
    console.log(`[${a.cod}] guichê e encaminhamento: ${JSON.stringify(r)}`);
  });
});
