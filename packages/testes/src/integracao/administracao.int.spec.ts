// M10 na CÓPIA, sob a trava da cópia e numa transação SEMPRE desfeita (ROLLBACK, desfazendoNaCopia): as receitas
// de usuários (criar com nome em CP1252, alterar com a versão e a colisão de versão com a linha alterada por fora,
// bloquear e desbloquear), um escopo (unidade), o aceite do termo, as gravações SGH_ (setor e pedido do titular) e
// as de acomodação e leito pelo executor, com o espelho dos gatilhos conferido e NENHUM vazio onde o banco sempre
// preenche; o LOCK TIMEOUT com a linha de TBUSERS travada por outra transação ("registro em edição", nada gravado);
// regra 1 (exclusão de usuário recusada pelo banco; nenhuma receita exclui de TBUSERS) e regra 16 (código de leito
// em uso não muda, com a mensagem em português); a trilha de 31 dias com p95 abaixo de 2 s. Fora da transação,
// nada mudou (contagens das tabelas gravadas, do espelho e das duas trilhas). Massa sintética (operador, alvo,
// grupo, acomodação e leito criados aqui); a saída só tem contagens e códigos.
// Rodar: flock <travas>/copia.lock ./pnpm testes:integracao (com 0130 e 0131 aplicados pelo sgh:aplicar).
import {
  concederSetor,
  ErroOperacao,
  type Escritor,
  type Leitor,
  lerEspelhoLeitos,
  lerTrilhaLegado,
  OPERACOES,
  operacao,
  problemaDoLegado,
  registrarPedidoTitular,
  retirarSetor,
  tratarPedidoTitular,
  versaoDaAcomodacao,
  versaoDoLeito,
  versaoDoUsuario,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Ambiente,
  ctx as contextoDe,
  ctxOperacao,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

async function contagens(l: Leitor): Promise<string> {
  const n = async (sql: string) => Number((await l.consultar(sql, [], { teto: 1 }))[0]?.['N'] ?? -1);
  return JSON.stringify([
    await n('SELECT COUNT(*) N FROM TBUSERS'),
    await n('SELECT COUNT(*) N FROM TBUNIUSE'),
    await n('SELECT COUNT(*) N FROM PRTERMOACEITE'),
    await n('SELECT COUNT(*) N FROM RIACOMOD'),
    await n('SELECT COUNT(*) N FROM RILEITOS'),
    await n('SELECT COUNT(*) N FROM TBLEITO'),
    await n('SELECT COUNT(*) N FROM HTLEITO'),
    // O espelho da acomodação (TRG_RIACOMOD_AIU) e as duas trilhas também voltam ao que eram.
    await n('SELECT COUNT(*) N FROM TBACOMODLEITO'),
    await n('SELECT COUNT(*) N FROM SGH_ACESSO_ESCOPO_SETOR'),
    await n('SELECT COUNT(*) N FROM SGH_AUD_PEDIDO_TITULAR'),
    await n('SELECT MAX(ID) N FROM TBCABTRILHA'),
    // Os detalhes da trilha do banco ficam presos aos cabeçalhos: os dos cabeçalhos recentes bastam (a tabela é
    // grande para um COUNT inteiro no tempo da consulta); da trilha própria, o último ID e o total do dia.
    await n(
      'SELECT COUNT(*) N FROM TBLANTRILHASGH WHERE ID_TBCABTRILHA > (SELECT MAX(ID) - 100000 FROM TBCABTRILHA)',
    ),
    await n('SELECT MAX(ID) N FROM SGH_TRILHA'),
    await n('SELECT COUNT(*) N FROM SGH_TRILHA WHERE DIA >= CURRENT_DATE'),
  ]);
}

const codigo = (x: unknown) =>
  (x as { problema?: { codigo?: string; status?: number } }).problema?.codigo ?? 'outro';

describe.skipIf(!PODE_ESCREVER)('M10 na cópia: usuários, escopo, termo, setor, pedido e leitos', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente({ FB_POOL_TETO: '2' });
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('receitas pelo executor e gravações SGH_ numa transação desfeita; espelho dos gatilhos; nada fica', async () => {
    const ctx = contextoDe(a);
    const { nucleo, executor, cod } = a;
    const antesFora = await nucleo.lerSomente(ctx, (l) => contagens(l));
    const sufixo = Date.now().toString(36).toUpperCase();
    const operador = `sgh.int.m10op.${sufixo}`.slice(0, 31);
    const alvo = `sgh.int.m10.${sufixo}`.slice(0, 31);
    const grupo = `SGH_M10_${sufixo}`.slice(0, 20);
    let n = 0;
    const r = await nucleo.desfazendoNaCopia(ctx, async (e: Escritor) => {
      const exec = (nome: string, entrada: unknown, quem = operador) =>
        executor.executar(
          operacao(nome),
          cod,
          entrada,
          {
            ...ctx,
            usuarioLegado: quem,
            idempotencyKey: `int-m10-${sufixo}-${++n}`,
            reautenticadoEm: Date.now(),
          },
          { escritor: e },
        );
      await exec(
        'acesso.criarUsuarioIntegracao',
        { nome: operador, nomeCompleto: 'USUARIO SINTETICO SGH M10' },
        'SGH.INT',
      );
      await exec('acesso.criarGrupo', { nome: grupo });
      // Nome com acentos do CP1252 (corpus da regra de texto): volta igual.
      const nome = 'SINTÉTICO JOSÉ AÇÃO ÜNICO';
      await exec('acesso.criarUsuario', { login: alvo, nomeCompleto: nome, grupo });
      const [u] = await e.consultar(
        'SELECT NOMEC, GRUPO, STATUS, BLOQUEADO FROM TBUSERS WHERE NOME = ?',
        [alvo],
        {
          teto: 1,
        },
      );
      const nomeIgual = String(u?.['NOMEC'] ?? '').trimEnd() === nome;
      let repetido = 'aceito';
      await exec('acesso.criarUsuario', { login: alvo, nomeCompleto: nome, grupo }).catch(
        (x) => (repetido = codigo(x)),
      );
      await exec('acesso.alterarUsuario', {
        login: alvo,
        nomeCompleto: 'SINTETICO RENOMEADO',
        versao: versaoDoUsuario(u!),
      });
      let versaoVelha = 'aceito';
      await exec('acesso.alterarUsuario', {
        login: alvo,
        nomeCompleto: 'OUTRO',
        versao: versaoDoUsuario(u!),
      }).catch((x) => (versaoVelha = codigo(x)));
      await exec('acesso.bloquearUsuario', { login: alvo });
      await exec('acesso.desbloquearUsuario', { login: alvo });
      let aSi = 'aceito';
      await exec('acesso.bloquearUsuario', { login: operador }).catch((x) => (aSi = codigo(x)));
      // Escopo: uma unidade existente.
      const [un] = await e.consultar('SELECT FIRST 1 COD FROM TBUNIDAD WHERE COD > 0 ORDER BY COD', [], {
        teto: 1,
      });
      const unidade = Number(un?.['COD']);
      await exec('acesso.concederUnidadeUsuario', { login: alvo, valor: unidade });
      await exec('acesso.retirarUnidadeUsuario', { login: alvo, valor: unidade });
      // Termo: o alvo aceita a versão vigente (quando há).
      const [t] = await e.consultar(
        `SELECT FIRST 1 ID FROM PRTERMOCAD WHERE ATIVO = 'T' ORDER BY ID DESC`,
        [],
        {
          teto: 1,
        },
      );
      let termo = 'sem-termo';
      if (t) {
        await exec('acesso.aceitarTermo', { termo: Number(t['ID']) }, alvo);
        termo = 'aceito';
        await exec('acesso.aceitarTermo', { termo: Number(t['ID']) }, alvo).catch((x) => (termo = codigo(x)));
      }
      // SGH_: setor e pedido do titular, com a SGH_TRILHA na mesma transação.
      const trilha = {
        rede: nucleo.rede,
        hospital: cod,
        usuario: operador,
        evento: 'acesso.escopo.setor.alterado',
        recurso: 'acesso.escopo',
        operacao: 'acesso.alterarSetor',
        resultado: 'sucesso',
        estacao: 'SGH-TESTE:integracao',
        correlacao: 'int-m10',
      };
      const [blocoRow] = await e.consultar('SELECT FIRST 1 BLOCO FROM RIBLOCOS ORDER BY BLOCO', [], {
        teto: 1,
      });
      const bloco = String(blocoRow?.['BLOCO'] ?? '').trimEnd();
      const [idAlvo] = await e.consultar('SELECT ID_TBUSERS FROM TBUSERS WHERE NOME = ?', [alvo], {
        teto: 1,
      });
      const pedidoSetor = {
        rede: nucleo.rede,
        hospital: cod,
        idUsuario: Number(idAlvo?.['ID_TBUSERS']),
        login: alvo,
        bloco,
        por: operador,
      };
      await concederSetor(e, pedidoSetor, trilha);
      await retirarSetor(e, pedidoSetor, trilha);
      const [pac] = await e.consultar('SELECT FIRST 1 ID FROM RICADPAC ORDER BY ID DESC', [], { teto: 1 });
      const p = await registrarPedidoTitular(
        e,
        {
          rede: nucleo.rede,
          hospital: cod,
          idPaciente: Number(pac?.['ID']),
          tipo: 'acesso',
          canal: 'presencial',
          descricao: null,
          por: operador,
          prazoDias: 15,
        },
        { ...trilha, evento: 'auditoria.pedidoTitular.registrado' },
      );
      const tratado = await tratarPedidoTitular(
        e,
        cod,
        {
          id: p.id,
          acao: 'confirmar-identidade',
          fundamento: null,
          resposta: null,
          por: operador,
          conferir: () => null,
        },
        { ...trilha, evento: 'auditoria.pedidoTitular.tratado' },
      );
      // Acomodação e leito no primeiro bloco; o espelho é dos gatilhos. Só os campos obrigatórios: idades e diária
      // ficam com o valor do banco, nunca vazio. Os códigos de referência são os primeiros ativos (só em memória).
      const primeiro = async (sql: string) =>
        Number((await e.consultar(sql, [], { teto: 1 }))[0]?.['V'] ?? NaN);
      const tipo = await primeiro('SELECT FIRST 1 ID V FROM TBTIPOACOMOD ORDER BY ID');
      const centroCusto = await primeiro(
        `SELECT FIRST 1 COD V FROM TBCENCUS WHERE SITUACAO = 'A' AND COD > 0 ORDER BY COD`,
      );
      const localConta = await primeiro(`SELECT FIRST 1 COD V FROM TBLOCCON WHERE ATIVO = 'T' ORDER BY COD`);
      const acomodacaoTiss = await primeiro('SELECT FIRST 1 ID V FROM TBTPACOMTISS WHERE ID > 0 ORDER BY ID');
      const acom = `Z${sufixo}`.slice(0, 6);
      let codigoInexistente = 'aceito';
      await exec('organizacao.incluirAcomodacao', {
        bloco,
        acomodacao: acom,
        nome: 'ACOMODACAO SINTETICA M10',
        andar: 1,
        leitos: 2,
        sexo: 'A',
        tipo,
        convenio: 'A',
        centroCusto: 2_000_000_000,
        localConta,
        acomodacaoTiss,
      }).catch((x) => (codigoInexistente = codigo(x)));
      await exec('organizacao.incluirAcomodacao', {
        bloco,
        acomodacao: acom,
        nome: 'ACOMODACAO SINTETICA M10',
        andar: 1,
        leitos: 2,
        sexo: 'A',
        tipo,
        convenio: 'A',
        centroCusto,
        localConta,
        acomodacaoTiss,
      });
      const inc = await exec('organizacao.incluirLeito', {
        bloco,
        acomodacao: acom,
        leito: 'Z1',
        andar: 1,
        ramal: 4321,
        anoVigente: 2026,
        mesVigente: 10,
      });
      const idLeito = Number((inc.resultado as { id?: number }).id);
      // Nenhum NULL onde o banco sempre preenche (perfil da cópia pc): cadastro, espelho da acomodação e leito.
      const nulos = async (sql: string, p: unknown[]) => {
        const [l] = await e.consultar(sql, p, { teto: 1 });
        return Object.entries(l ?? {})
          .filter(([, v]) => v === null)
          .map(([k]) => k);
      };
      const vazios = [
        ...(await nulos(
          'SELECT ANDAR, CDC, LCONS, ACOMOD_TISS, IDADE_MINIMA, IDADE_MAXIMA, ID_TBUNID_IDADE_MIN, ID_TBUNID_IDADE_MAX FROM RIACOMOD WHERE BLOCO = ? AND ACOMOD = ?',
          [bloco, acom],
        )),
        ...(await nulos(
          `SELECT NUM_ANDAR, ID_TBCENCUS, ID_TBLOCCON, ID_TBTPACOMTISS, IDADE_MINIMA, IDADE_MAXIMA FROM TBACOMODLEITO
            WHERE ID_RIBLOCOS = ? AND COD_ACOMODACAO = ? AND TP_ATENDIMENTO = 'I'`,
          [bloco, acom],
        )),
        ...(await nulos('SELECT ANDAR, CDIARIA, RAMAL, ORDEM FROM RILEITOS WHERE ID = ?', [idLeito])),
      ];
      const ler = async () =>
        (
          await e.consultar('SELECT STATUS, RAMAL, ANDAR, REG FROM RILEITOS WHERE ID = ?', [idLeito], {
            teto: 1,
          })
        )[0]!;
      await exec('organizacao.alterarLeito', {
        id: idLeito,
        versao: versaoDoLeito(await ler()),
        ramal: 4322,
      });
      await exec('organizacao.inativarLeito', { id: idLeito, versao: versaoDoLeito(await ler()) });
      const espInativo = (await lerEspelhoLeitos(e)).leitos.find(
        (x) => x.acomodacao === acom && x.leito === 'Z1',
      );
      await exec('organizacao.reativarLeito', { id: idLeito, versao: versaoDoLeito(await ler()) });
      const esp = (await lerEspelhoLeitos(e)).leitos.find((x) => x.acomodacao === acom && x.leito === 'Z1');
      const [ac] = await e.consultar(
        'SELECT NOME, ANDAR, LEITOS, SEXO, TIPO, TCONV FROM RIACOMOD WHERE BLOCO = ? AND ACOMOD = ?',
        [bloco, acom],
        { teto: 1 },
      );
      await exec('organizacao.alterarAcomodacao', {
        bloco,
        acomodacao: acom,
        versao: versaoDaAcomodacao(ac!),
        nome: 'ACOMODACAO SINTETICA M10 B',
      });
      const espAc = (await lerEspelhoLeitos(e)).acomodacoes.find((x) => x.acomodacao === acom);
      // Regra 16: o código do leito em uso não muda (TRG_RILEITOS_BU, e_geral_valor_chave). Nenhuma receita muda a
      // chave; o comando direto (só neste teste, na transação desfeita) prova a recusa do banco e a mensagem.
      let chave = { codigo: 'aceito', detail: '' };
      await e.executar('UPDATE RILEITOS SET LEITO = ? WHERE ID = ?', ['Z9', idLeito]).catch((x: unknown) => {
        const p = problemaDoLegado(x).problema;
        chave = { codigo: p.codigo ?? '', detail: p.detail ?? '' };
      });
      // Regra 1: o usuário nunca é excluído (TRG_TBUSERS_BD, e_exc_nao_permitida), nem o sintético recém-criado.
      let exclusao = 'aceito';
      await e
        .executar('DELETE FROM TBUSERS WHERE NOME = ?', [alvo])
        .catch((x: unknown) => (exclusao = problemaDoLegado(x).problema.codigo ?? ''));
      return {
        nomeIgual,
        repetido,
        versaoVelha,
        aSi,
        termo,
        tratado: tratado.situacao,
        protocolo: /^\d{4}-\d{6}$/.test(p.protocolo),
        espelhoInativo: espInativo?.ativo,
        espelhoAtivo: esp?.ativo,
        espelhoRamal: esp?.ramal,
        espelhoNome: espAc?.nome,
        codigoInexistente,
        vazios,
        chave,
        exclusao,
      };
    });
    expect(r).toEqual({
      nomeIgual: true,
      repetido: 'login-existente',
      versaoVelha: 'conflito-versao',
      aSi: 'a-si-mesmo',
      termo: expect.stringMatching(/^(ja-aceito|sem-termo)$/),
      tratado: 'identidade-verificada',
      protocolo: true,
      espelhoInativo: false,
      espelhoAtivo: true,
      espelhoRamal: 4322,
      espelhoNome: 'ACOMODACAO SINTETICA M10 B',
      codigoInexistente: 'centro-custo-inexistente',
      vazios: [],
      chave: { codigo: 'chave-imutavel', detail: expect.stringMatching(/inative este item e crie outro/) },
      exclusao: 'exclusao-nao-permitida',
    });
    expect(await nucleo.lerSomente(ctx, (l) => contagens(l))).toBe(antesFora);
    // Regra 1: nenhuma receita tem passo de exclusão em TBUSERS.
    const excluem = Object.values(OPERACOES).filter((o) =>
      o.receita.passos.some((p) => p.tabela === 'TBUSERS' && p.acao === 'DELETE'),
    );
    expect(excluem).toEqual([]);
  }, 120_000);

  it('LOCK TIMEOUT: a linha de TBUSERS travada por outra transação → registro em edição, nada gravado', async () => {
    // A trava precisa de uma linha CONFIRMADA (READ COMMITTED: a outra conexão não vê um usuário sintético não
    // confirmado, e o banco nunca recebe COMMIT). Salvaguardas (como o M11, D-TRV-1): só o login da linha é lido
    // (em memória, nunca impresso) de um usuário bloqueado; a versão mandada é SINTÉTICA e impossível, então, sem a
    // trava, a alteração seria recusada por colisão de versão antes de qualquer UPDATE; e tudo é desfeito.
    const ctx = contextoDe(a);
    const alvo = await a.nucleo.lerSomente(ctx, async (l) => {
      const [x] = await l.consultar(
        "SELECT FIRST 1 NOME FROM TBUSERS WHERE BLOQUEADO = 'T' ORDER BY ID_TBUSERS",
        [],
        { teto: 1 },
      );
      return String(x?.['NOME'] ?? '').trimEnd();
    });
    expect(alvo.length).toBeGreaterThan(0);
    const antes = await a.nucleo.lerSomente(ctx, (l) => contagens(l));
    let resultado = '';
    let segundos = 0;
    await a.nucleo.desfazendoNaCopia(ctx, async (trava) => {
      await trava.consultar('SELECT NOME FROM TBUSERS WHERE NOME = ? WITH LOCK', [alvo], { teto: 1 });
      const inicio = Date.now();
      try {
        await a.executor.executar(
          operacao('acesso.alterarUsuario'),
          a.cod,
          { login: alvo, nomeCompleto: 'POR CIMA SGH', versao: '["SGH-VERSAO-IMPOSSIVEL"]' },
          ctxOperacao(a, 'SGH.M10'),
          { desfazer: true },
        );
        resultado = 'gravou';
      } catch (x) {
        resultado = x instanceof ErroOperacao ? (x.problema.codigo ?? '') : 'outro';
      }
      segundos = Math.round((Date.now() - inicio) / 100) / 10;
    });
    expect(resultado).toBe('registro-em-edicao');
    expect(await a.nucleo.lerSomente(ctx, (l) => contagens(l))).toBe(antes);
    console.log(`[${a.cod}] TBUSERS travado: ${resultado} depois de ${segundos} s`);
  }, 120_000);

  it('trilha do banco: os 31 dias mais recentes com movimento, com p95 abaixo de 2 s (10 consultas)', async () => {
    const ctx = contextoDe(a);
    // A cópia é um retrato: o período termina no último registro da trilha (não no relógio de hoje).
    const [ult] = await a.nucleo.lerSomente(ctx, (l) =>
      l.consultar('SELECT MAX(DATA_HORA_ACAO) N FROM TBCABTRILHA', [], { teto: 1 }),
    );
    const fim = ult?.['N'] instanceof Date ? (ult['N'] as Date) : new Date();
    const dia = (n: number) => new Date(fim.getTime() - n * 86_400_000).toISOString().slice(0, 10);
    const tempos: number[] = [];
    let linhas = 0;
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      const r = await a.nucleo.lerSomente(ctx, (l) =>
        lerTrilhaLegado(l, { hospital: a.cod, inicio: dia(30), fimExclusivo: dia(-1), limite: 500 }),
      );
      tempos.push(performance.now() - t0);
      linhas = r.length;
    }
    tempos.sort((x, y) => x - y);
    const p95 = tempos[Math.ceil(tempos.length * 0.95) - 1]!;
    console.log(
      `[M10] trilha 31 dias: p95 ${Math.round(p95)} ms; página com ${linhas < 5 ? '<5' : linhas} linhas`,
    );
    expect(p95).toBeLessThan(2000);
  }, 120_000);
});
