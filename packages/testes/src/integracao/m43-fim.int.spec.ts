// Fim da coexistência sobre a cópia (ficha do M43, campos 4, 5, 8 e 10), sob a trava da cópia:
//   - leituras do campo 4 no schema real (READ ONLY): ativos sem grupo ("SEM GRUPO" e nulo) e logins de painel com as
//     contagens que fecham (a lista bate com as parcelas), os grupos ativos, a última competência fechada com o que o
//     novo fechou e enviou (pela ligação conta × lote e pela trilha no índice do dia), as conexões do outro sistema ao
//     banco agora (MON$ATTACHMENTS) e a série diária; só agregados (nada de nome; abaixo de 5 vira <5); tempos;
//   - regra 3: o pico diário das conexões ao banco gravado duas vezes no dia fica o maior, e a linha não entra no uso
//     por operação (o indicador do M37 continua igual);
//   - regras 4 e 5 numa transação desfeita: um login sintético do grupo de painéis só passa a "pode bloquear" depois do
//     aparelho com token conferido no setor (o segundo aparelho para o mesmo login é recusado), e o bloqueio pelo
//     executor (acesso.bloquearUsuario) relê BLOQUEADO; um usuário sintético do "SEM GRUPO" recebe grupo pela troca de
//     grupo (acesso.trocarGrupoUsuario) e sai da revisão; depois do ROLLBACK, as contagens, os aparelhos e o uso do dia
//     como antes.
// Massa: usuários sintéticos criados pelo executor na transação desfeita. Saída só com contagens.
import { GRUPO_PAINEIS, GRUPO_SEM_GRUPO } from '@sgh/contratos';
import { motivoBloqueioLoginPainel, revisarSemGrupo } from '@sgh/dominio-config';
import {
  conferirDispositivo,
  contarConexoesOutroSistemaAgora,
  contarUsuariosFim,
  criarDispositivo,
  gravarPicoConexoesOutro,
  lerCompetenciaPeloNovo,
  lerGruposAtivos,
  lerSerieConexoesOutro,
  lerUltimaCompetenciaFechada,
  lerUsoDia,
  lerUsuariosParaRevisao,
  listarDispositivos,
  operacao,
  relogioDoBanco,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const menos5 = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));

describe.skipIf(!PODE_ESCREVER)('M43: fim da coexistência na cópia', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('campo 4 no schema real (READ ONLY): as listas batem com as contagens; competência e conexões; tempos', async () => {
    const tempos: Record<string, number> = {};
    const medir = async <T>(nome: string, f: () => Promise<T>): Promise<T> => {
      const t0 = performance.now();
      const r = await f();
      tempos[nome] = Math.round(performance.now() - t0);
      return r;
    };
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const hoje = (await relogioDoBanco(l)).toISOString().slice(0, 10);
      const ultima = await medir('ultimaCompetencia', () => lerUltimaCompetenciaFechada(l));
      return {
        revisao: await medir('revisao', () => lerUsuariosParaRevisao(l)),
        contagem: await medir('contagem', () => contarUsuariosFim(l)),
        grupos: await medir('grupos', () => lerGruposAtivos(l)),
        ultima,
        competencia: ultima
          ? await medir('competencia', () => lerCompetenciaPeloNovo(l, a.cod, ultima.ano, ultima.mes))
          : null,
        mon: await medir('mon', () => contarConexoesOutroSistemaAgora(l, [])),
        serie: await medir('serie', () => lerSerieConexoesOutro(l, a.cod, hoje)),
      };
    });
    const semGrupo = r.revisao.filter((u) => (u.grupo ?? '') !== GRUPO_PAINEIS);
    const paineis = r.revisao.filter((u) => u.grupo === GRUPO_PAINEIS);
    // A lista dos sem grupo (ativos) bate com as parcelas da contagem; a de painéis com livres + bloqueados.
    expect(semGrupo.length).toBe(r.contagem.ativosSemGrupo + r.contagem.ativosGrupoNulo);
    expect(paineis.length).toBe(r.contagem.paineisLivres + r.contagem.paineisBloqueados);
    expect(r.contagem.ativos).toBeLessThanOrEqual(r.contagem.total);
    const rev = revisarSemGrupo(r.revisao, new Map(), r.grupos);
    expect(rev.pendentes.length).toBe(semGrupo.length);
    expect(rev.parcelas.semGrupo + rev.parcelas.nulo).toBe(semGrupo.length);
    expect(r.grupos).toContain(GRUPO_SEM_GRUPO);
    if (r.competencia) {
      expect(r.competencia.fechadosPeloNovo).toBeLessThanOrEqual(r.competencia.conveniosComConta);
      expect(r.competencia.lotesPeloNovo).toBeLessThanOrEqual(r.competencia.lotes);
    }
    expect(r.mon.conexoes).toBeGreaterThanOrEqual(0);
    for (const t of Object.values(tempos)) expect(t).toBeLessThan(20_000);
    console.log(
      `[M43] ativos ${r.contagem.ativos} de ${r.contagem.total}; sem grupo ${menos5(r.contagem.ativosSemGrupo)} + nulo ${menos5(
        r.contagem.ativosGrupoNulo,
      )} (login vazio ${menos5(rev.parcelas.loginVazio)}); painéis ${menos5(r.contagem.paineisLivres)} livres e ${menos5(
        r.contagem.paineisBloqueados,
      )} bloqueados; grupos ativos ${r.grupos.length}; competência ${r.competencia?.competencia ?? '—'}: ${
        r.competencia?.conveniosComConta ?? 0
      } convênio(s) com conta, ${r.competencia?.conveniosFechados ?? 0} fechado(s), ${
        r.competencia?.fechadosPeloNovo ?? 0
      } pelo novo; ${r.competencia?.lotes ?? 0} lote(s), ${r.competencia?.lotesPeloNovo ?? 0} pelo novo; conexões do outro sistema agora ${
        r.mon.conexoes
      }; série ${r.serie.length} dia(s); tempos ${JSON.stringify(tempos)}`,
    );
  });

  it('regras 3, 4 e 5 numa transação desfeita; ROLLBACK deixa as contagens, os aparelhos e o uso do dia iguais', async () => {
    const [operador, painel, semGrupo] = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const base = Date.now() % 1_000_000_000;
      return [
        (await loginLivre(l, base)).toUpperCase(),
        (await loginLivre(l, (base + 7_919) % 1_000_000_000)).toUpperCase(),
        (await loginLivre(l, (base + 104_729) % 1_000_000_000)).toUpperCase(),
      ];
    });
    const retrato = () =>
      a.nucleo.lerSomente(ctx(a), async (l) => {
        const hoje = (await relogioDoBanco(l)).toISOString().slice(0, 10);
        return {
          contagem: await contarUsuariosFim(l),
          aparelhos: (await listarDispositivos(l, a.cod)).length,
          serie: (await lerSerieConexoesOutro(l, a.cod, hoje)).length,
          uso: (await lerUsoDia(l, a.cod, hoje)).length,
          usuarios: num(
            (
              await l.consultar(
                'SELECT COUNT(*) N FROM TBUSERS WHERE NOME IN (?, ?, ?)',
                [operador, painel, semGrupo],
                {
                  teto: 1,
                },
              )
            )[0]?.['N'],
          ),
        };
      });
    const antes = await retrato();
    expect(antes.usuarios).toBe(0);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const hoje = (await relogioDoBanco(e)).toISOString().slice(0, 10);
      const agora = (await relogioDoBanco(e)).toISOString().slice(0, 19);
      // Regra 3: o pico do dia fica o maior; a linha da série não entra no uso por operação.
      const usoAntes = (await lerUsoDia(e, a.cod, hoje)).length;
      await gravarPicoConexoesOutro(e, a.cod, hoje, 3);
      await gravarPicoConexoesOutro(e, a.cod, hoje, 1);
      const serie = await lerSerieConexoesOutro(e, a.cod, hoje);
      const usoDepois = (await lerUsoDia(e, a.cod, hoje)).length;

      // Massa: o operador (técnico) e os dois usuários sintéticos pelo executor.
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', operador),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      for (const [login, grupo] of [
        [painel, GRUPO_PAINEIS],
        [semGrupo, GRUPO_SEM_GRUPO],
      ] as const)
        await a.executor.executar(
          operacao('acesso.criarUsuario'),
          a.cod,
          { login, nomeCompleto: `USUARIO SGH M43 INT ${login.slice(-4)}`, grupo },
          ctxOperacao(a, operador),
          { escritor: e },
        );

      // Regra 4: sem aparelho, o bloqueio do login de painel é recusado; com o aparelho conferido, pode.
      const semAparelho = motivoBloqueioLoginPainel(painel, await listarDispositivos(e, a.cod), a.cod, agora);
      const tv = await criarDispositivo(e, {
        hospital: a.cod,
        tipo: 'painel',
        nome: 'TV SINTETICA M43',
        recepcao: null,
        locais: [],
        geradores: [],
        conteudo: null,
        portalOrdem: null,
        usuarioLegado: null,
        voz: false,
        validadeDias: 30,
        usuario: operador,
      });
      const outra = await criarDispositivo(e, {
        hospital: a.cod,
        tipo: 'painel',
        nome: 'TV SINTETICA M43 B',
        recepcao: null,
        locais: [],
        geradores: [],
        conteudo: null,
        portalOrdem: null,
        usuarioLegado: null,
        voz: false,
        validadeDias: 30,
        usuario: operador,
      });
      await conferirDispositivo(e, {
        hospital: a.cod,
        id: tv.id,
        loginSubstituido: painel,
        usuario: operador,
      });
      const repetido = await conferirDispositivo(e, {
        hospital: a.cod,
        id: outra.id,
        loginSubstituido: painel,
        usuario: operador,
      }).then(
        () => 'aceito',
        (x: unknown) => (x as { problema?: { codigo?: string } }).problema?.codigo ?? 'erro',
      );
      const aparelhos = await listarDispositivos(e, a.cod);
      const comAparelho = motivoBloqueioLoginPainel(painel, aparelhos, a.cod, agora);
      await a.executor.executar(
        operacao('acesso.bloquearUsuario'),
        a.cod,
        { login: painel },
        ctxOperacao(a, operador),
        {
          escritor: e,
        },
      );
      // Regra 5: o sem grupo recebe grupo de trabalho e sai da revisão.
      const grupos = await lerGruposAtivos(e);
      const destino = grupos.find((g) => g !== GRUPO_SEM_GRUPO && g !== GRUPO_PAINEIS)!;
      const revAntes = revisarSemGrupo(await lerUsuariosParaRevisao(e), new Map(), grupos);
      await a.executor.executar(
        operacao('acesso.trocarGrupoUsuario'),
        a.cod,
        { login: semGrupo, grupo: destino },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const revDepois = revisarSemGrupo(await lerUsuariosParaRevisao(e), new Map(), grupos);
      const [relido] = await e.consultar('SELECT BLOQUEADO FROM TBUSERS WHERE NOME = ?', [painel], {
        teto: 1,
      });
      return {
        serie: serie.find((x) => x.dia === hoje)?.conexoes ?? null,
        usoAntes,
        usoDepois,
        semAparelho,
        comAparelho,
        repetido,
        conferido: aparelhos.find((d) => d.id === tv.id)?.loginSubstituido ?? null,
        bloqueado: String(relido?.['BLOQUEADO'] ?? '').trim(),
        pendenteAntes: revAntes.pendentes.includes(semGrupo),
        pendenteDepois: revDepois.pendentes.includes(semGrupo),
      };
    });
    expect(r.serie).toBe(3);
    expect(r.usoDepois).toBe(r.usoAntes);
    expect(r.semAparelho).toMatch(/ainda é o da TV/);
    expect(r.repetido).toBe('login-ja-substituido');
    expect(r.conferido).toBe(painel);
    expect(r.comAparelho).toBeNull();
    expect(r.bloqueado).toBe('T');
    expect(r.pendenteAntes).toBe(true);
    expect(r.pendenteDepois).toBe(false);
    // ROLLBACK: nada ficou.
    expect(await retrato()).toEqual(antes);
  });

  it('um aparelho por login substituído com duas conferências ao mesmo tempo: a segunda espera a trava do login e recusa (ROLLBACK nas duas)', async () => {
    // Login sintético de painel (não precisa existir no cadastro: a conferência só grava o vínculo do aparelho).
    const login = `SGH.M43.TRAVA.${Date.now() % 1_000_000}`;
    const operador = 'SGH.TESTE';
    const novo = (e: Parameters<typeof criarDispositivo>[0], nome: string) =>
      criarDispositivo(e, {
        hospital: a.cod,
        tipo: 'painel',
        nome,
        recepcao: null,
        locais: [],
        geradores: [],
        conteudo: null,
        portalOrdem: null,
        usuarioLegado: null,
        voz: false,
        validadeDias: 30,
        usuario: operador,
      });
    const contar = () =>
      a.nucleo.lerSomente(ctx(a), async (l) =>
        num(
          (
            await l.consultar(
              'SELECT COUNT(*) N FROM SGH_ACESSO_DISP_SUBST_TRAVA WHERE HOSPITAL = ? AND LOGIN_SUBSTITUIDO = ?',
              [a.cod, login],
              { teto: 1 },
            )
          )[0]?.['N'],
        ),
      );
    expect(await contar()).toBe(0);
    let primeiraConferiu!: () => void;
    const conferiu = new Promise<void>((r) => (primeiraConferiu = r));
    let segundaTerminou!: () => void;
    const terminou = new Promise<void>((r) => (segundaTerminou = r));
    const t0 = performance.now();
    const [primeira, segunda] = await Promise.all([
      a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        const tv = await novo(e, 'TV SINTETICA M43 TRAVA A');
        await conferirDispositivo(e, {
          hospital: a.cod,
          id: tv.id,
          loginSubstituido: login,
          usuario: operador,
        });
        primeiraConferiu();
        // Segura a trava (sem confirmar) até a segunda terminar.
        await terminou;
        return 'conferida';
      }),
      a.nucleo
        .desfazendoNaCopia(ctx(a), async (e) => {
          await conferiu;
          const tv = await novo(e, 'TV SINTETICA M43 TRAVA B');
          return conferirDispositivo(e, {
            hospital: a.cod,
            id: tv.id,
            loginSubstituido: login,
            usuario: operador,
          }).then(
            () => 'aceita',
            (x: unknown) => (x as { problema?: { codigo?: string } }).problema?.codigo ?? 'erro',
          );
        })
        .finally(() => segundaTerminou()),
    ]);
    console.info(`M43 trava do login substituído: ${Math.round(performance.now() - t0)} ms`);
    expect(primeira).toBe('conferida');
    expect(segunda).toBe('login-ja-substituido');
    // ROLLBACK nas duas: nenhuma trava ficou.
    expect(await contar()).toBe(0);
  });
});
