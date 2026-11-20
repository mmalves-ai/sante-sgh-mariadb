// M59-F4 na CÓPIA, sob a trava da cópia e numa transação SEMPRE desfeita (ROLLBACK, desfazendoNaCopia): a aplicação
// do saneamento dos grupos pelas receitas do M10 no executor do M04, com o plano em SGH_ACESSO_SANEAMENTO e a
// SGH_TRILHA. Massa sintética criada pelo próprio executor: dois usuários de integração postos no MASTER, um grupo de
// trabalho com uma opção e um grupo sintético com três opções (o lote da dissolução). Prova: troca de grupo (TBUSERS),
// bloqueio (TBUSERS) e retirada das três opções no mesmo lote (TBPERUSU), cada item concluído como "aplicado" no plano,
// com a trilha do legado (TBCABTRILHA) e a SGH_TRILHA; fora da transação, nada mudou. Só contagens e códigos na saída.
// Rodar: obra-sgh/travas/com-copia.sh ./pnpm exec vitest run --config packages/testes/vitest.integracao.config.ts m59-4
import {
  concluirItemSaneamento,
  descartarItemSaneamento,
  reservarItemSaneamento,
  incluirItemSaneamento,
  lerItemSaneamento,
  lerUsuarioSaneamento,
  type Leitor,
  operacao,
  type TrilhaSaneamento,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx as contextoDe, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

/** O último ID da trilha do legado pelo gerador (o MAX(ID) varre a tabela de ~30 M linhas na cópia). */
const GERADOR_TRILHA = 'SELECT GEN_ID(GEN_TBCABTRILHA_ID, 0) N FROM RDB$DATABASE';

async function contagens(l: Leitor, cod: string): Promise<string> {
  const n = async (sql: string, p: unknown[] = []) =>
    Number((await l.consultar(sql, p, { teto: 1 }))[0]?.['N'] ?? -1);
  return JSON.stringify([
    await n('SELECT COUNT(*) N FROM TBPERUSU'),
    await n('SELECT COUNT(*) N FROM TBGRUUSU'),
    await n('SELECT COUNT(*) N FROM TBUSERS'),
    await n("SELECT COUNT(*) N FROM TBUSERS WHERE BLOQUEADO = 'T'"),
    await n('SELECT COUNT(*) N FROM SGH_ACESSO_SANEAMENTO'),
    // A SGH_TRILHA é grande: o último ID do estabelecimento pelo índice descendente, nunca a contagem inteira.
    await n('SELECT MAX(ID) N FROM SGH_TRILHA WHERE HOSPITAL = ?', [cod]),
  ]);
}

describe.skipIf(!PODE_ESCREVER)('saneamento dos grupos aplicado pelo executor na cópia (M59-F4)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente({ FB_POOL_TETO: '1' });
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('troca de grupo, bloqueio e retirada das opções em lote, com o plano e a trilha; ROLLBACK no fim', async () => {
    const ctx = contextoDe(a);
    const { nucleo, executor, cod } = a;
    const antesFora = await nucleo.lerSomente(ctx, (l) => contagens(l, cod));
    const gerador0 = await nucleo.lerSomente(ctx, async (l) =>
      Number((await l.consultar(GERADOR_TRILHA, [], { teto: 1 }))[0]?.['N'] ?? 0),
    );
    const sufixo = Date.now().toString(36).toUpperCase();
    const gestor = `sgh.int.gst.${sufixo}`.slice(0, 31);
    const alvoTroca = `sgh.int.trc.${sufixo}`.slice(0, 31);
    const alvoBloqueio = `sgh.int.blq.${sufixo}`.slice(0, 31);
    const trabalho = `SGH_INT_T${sufixo}`.slice(0, 30);
    const vazio = `SGH_INT_V${sufixo}`.slice(0, 30);
    const correlacao = `int-m59-f4-${sufixo}`.slice(0, 64);
    let n = 0;
    const r = await nucleo.desfazendoNaCopia(ctx, async (e) => {
      const [trilhaSgh] = await e.consultar(
        'SELECT COUNT(*) N FROM SGH_TRILHA WHERE HOSPITAL = ? AND USUARIO = ? AND CORRELACAO = ?',
        [cod, gestor, correlacao],
        { teto: 1 },
      );
      const exec = (nome: string, entrada: unknown, quem = gestor) =>
        executor.executar(
          operacao(nome),
          cod,
          entrada,
          {
            ...ctx,
            traceId: correlacao,
            usuarioLegado: quem,
            idempotencyKey: `int-m59-f4-${sufixo}-${++n}`,
            reautenticadoEm: Date.now(),
          },
          { escritor: e },
        );
      const trilha = (evento: string): TrilhaSaneamento => ({
        rede: nucleo.rede,
        hospital: cod,
        usuario: gestor,
        evento,
        recurso: 'acesso.saneamento',
        operacao: 'acesso.saneamento.aplicar',
        resultado: 'sucesso',
        estacao: 'SGH-TESTE:integracao',
        correlacao,
      });
      // Massa: gestor e dois alvos de integração; os alvos no MASTER; um grupo de trabalho e um grupo a dissolver.
      for (const u of [gestor, alvoTroca, alvoBloqueio])
        await exec(
          'acesso.criarUsuarioIntegracao',
          { nome: u, nomeCompleto: 'USUARIO SINTETICO SGH M59 F4' },
          'SGH.INT',
        );
      // Opções ativas do legado (as primeiras pelo ID; os grupos são novos, nenhuma está concedida a eles).
      const ativas = (
        await e.consultar("SELECT FIRST 3 o.ID FROM TBOPCOES o WHERE o.ATIVO = 'T' ORDER BY o.ID", [], {
          teto: 3,
        })
      ).map((l) => Number(l['ID']));
      const OPCAO_TRABALHO = ativas[0] as number;
      const OPCOES_LOTE = ativas;
      await exec('acesso.criarGrupo', { nome: trabalho });
      await exec('acesso.concederOpcoesGrupo', { grupo: trabalho, opcoes: [OPCAO_TRABALHO] });
      await exec('acesso.criarGrupo', { nome: vazio });
      await exec('acesso.concederOpcoesGrupo', { grupo: vazio, opcoes: OPCOES_LOTE });
      for (const u of [alvoTroca, alvoBloqueio])
        await exec('acesso.trocarGrupoUsuario', { login: u, grupo: 'MASTER' });
      // O usuário de integração nasce bloqueado (sem login): o alvo do bloqueio é liberado antes, como um ativo.
      await exec('acesso.desbloquearUsuario', { login: alvoBloqueio });
      const [maxMassa] = await e.consultar(GERADOR_TRILHA, [], { teto: 1 });

      const idDe = async (login: string) => (await lerUsuarioSaneamento(e, login))?.idUsuario ?? 0;
      const base = {
        hospital: cod,
        grupoOrigem: 'MASTER',
        perdasTotal: 0,
        perdasUsadas: 0,
        exigeAprovacao: false,
        motivo: 'Integração do saneamento (M59-F4)',
        criadoPor: gestor,
      };
      // 1) Troca de grupo: decisão no plano, a receita do M10, a conclusão.
      const troca = await incluirItemSaneamento(
        e,
        {
          ...base,
          login: alvoTroca,
          idUsuario: await idDe(alvoTroca),
          decisao: 'trocar-grupo',
          grupoDestino: trabalho,
        },
        trilha('acesso.saneamento.incluido'),
      );
      // Revisão do M59.4 (achado 3): reserva antes da receita; reservado, o descarte recebe 0 linha.
      const trocaReservada = await reservarItemSaneamento(
        e,
        { hospital: cod, id: troca.id, por: gestor },
        trilha('acesso.saneamento.aplicado'),
      );
      const descarteNoMeio = await descartarItemSaneamento(
        e,
        { hospital: cod, id: troca.id, por: gestor },
        trilha('acesso.saneamento.descartado'),
      );
      await exec('acesso.trocarGrupoUsuario', { login: alvoTroca, grupo: trabalho });
      const trocaOk = await concluirItemSaneamento(
        e,
        { hospital: cod, id: troca.id, por: gestor, resultado: 'aplicado', erro: null },
        trilha('acesso.saneamento.aplicado'),
      );
      // 2) Bloqueio de quem não entra há mais de 180 dias.
      const bloqueio = await incluirItemSaneamento(
        e,
        {
          ...base,
          login: alvoBloqueio,
          idUsuario: await idDe(alvoBloqueio),
          decisao: 'bloquear',
          grupoDestino: null,
        },
        trilha('acesso.saneamento.incluido'),
      );
      await reservarItemSaneamento(
        e,
        { hospital: cod, id: bloqueio.id, por: gestor },
        trilha('acesso.saneamento.aplicado'),
      );
      await exec('acesso.bloquearUsuario', { login: alvoBloqueio });
      const bloqueioOk = await concluirItemSaneamento(
        e,
        { hospital: cod, id: bloqueio.id, por: gestor, resultado: 'aplicado', erro: null },
        trilha('acesso.saneamento.aplicado'),
      );
      // 3) Dissolução do grupo sem ativos: as três opções no mesmo lote (uma transação por lote).
      const [antesLote] = await e.consultar('SELECT COUNT(*) N FROM TBPERUSU WHERE GRUPO = ?', [vazio], {
        teto: 1,
      });
      const dissolve = await incluirItemSaneamento(
        e,
        {
          ...base,
          grupoOrigem: vazio,
          login: null,
          idUsuario: null,
          decisao: 'dissolver-grupo',
          grupoDestino: null,
        },
        trilha('acesso.saneamento.incluido'),
      );
      await reservarItemSaneamento(
        e,
        { hospital: cod, id: dissolve.id, por: gestor },
        trilha('acesso.saneamento.aplicado'),
      );
      await exec('acesso.revogarOpcoesGrupo', { grupo: vazio, opcoes: OPCOES_LOTE });
      const dissolveOk = await concluirItemSaneamento(
        e,
        { hospital: cod, id: dissolve.id, por: gestor, resultado: 'aplicado', erro: null },
        trilha('acesso.saneamento.aplicado'),
      );
      const [depoisLote] = await e.consultar('SELECT COUNT(*) N FROM TBPERUSU WHERE GRUPO = ?', [vazio], {
        teto: 1,
      });
      // Repetir a troca para o mesmo grupo: a receita recusa (o item já aplicado não se reaplica).
      let repetida = 'aceita';
      try {
        await exec('acesso.trocarGrupoUsuario', { login: alvoTroca, grupo: trabalho });
      } catch (x) {
        repetida = (x as { problema?: { codigo?: string } }).problema?.codigo ?? 'outro';
      }
      const uTroca = await lerUsuarioSaneamento(e, alvoTroca);
      const uBloqueio = await lerUsuarioSaneamento(e, alvoBloqueio);
      const itens = await Promise.all(
        [troca.id, bloqueio.id, dissolve.id].map((id) => lerItemSaneamento(e, cod, id)),
      );
      const eventos = await e.consultar(
        `SELECT COUNT(*) N FROM TBCABTRILHA c WHERE c.ID > ? AND c.USUARIO = ?`,
        [Number(maxMassa?.['N'] ?? 0), gestor],
        { teto: 1 },
      );
      const [trilhaDepois] = await e.consultar(
        `SELECT COUNT(*) N FROM SGH_TRILHA
          WHERE HOSPITAL = ? AND USUARIO = ? AND CORRELACAO = ? AND TABELA_ALVO = 'SGH_ACESSO_SANEAMENTO'`,
        [cod, gestor, correlacao],
        { teto: 1 },
      );
      return {
        semMassaAntes: gerador0 <= Number(maxMassa?.['N'] ?? 0),
        trilhaSghAntes: Number(trilhaSgh?.['N'] ?? -1),
        trilhaSghDepois: Number(trilhaDepois?.['N'] ?? -1),
        grupoTroca: uTroca?.grupo ?? null,
        bloqueado: uBloqueio?.bloqueado ?? null,
        grupoBloqueado: uBloqueio?.grupo ?? null,
        concluidos: [trocaOk, bloqueioOk, dissolveOk],
        reservaTroca: [trocaReservada, descarteNoMeio],
        situacoes: itens.map((i) => i?.situacao ?? null),
        aplicadoPor: itens.map((i) => i?.aplicadoPor === gestor),
        lote: [Number(antesLote?.['N'] ?? -1), Number(depoisLote?.['N'] ?? -1)],
        repetida,
        eventosLegado: Number(eventos[0]?.['N'] ?? -1),
      };
    });
    expect(r.semMassaAntes).toBe(true);
    expect(r.grupoTroca).toBe(trabalho);
    expect(r.bloqueado).toBe(true);
    // O bloqueio não muda o grupo: o usuário bloqueado deixa de contar como ativo do MASTER.
    expect(r.grupoBloqueado).toBe('MASTER');
    expect(r.concluidos).toEqual([true, true, true]);
    expect(r.reservaTroca).toEqual([true, false]);
    expect(r.situacoes).toEqual(['aplicado', 'aplicado', 'aplicado']);
    expect(r.aplicadoPor).toEqual([true, true, true]);
    expect(r.lote).toEqual([3, 0]);
    expect(r.repetida).toBe('mesmo-grupo');
    // Troca, bloqueio e a retirada do lote: cada receita deixa a sua trilha do legado.
    expect(r.eventosLegado).toBeGreaterThanOrEqual(3);
    // Plano: 3 inclusões + 3 reservas + 3 conclusões na SGH_TRILHA, na mesma transação (o descarte recusado não grava).
    expect(r.trilhaSghAntes).toBe(0);
    expect(r.trilhaSghDepois).toBe(9);
    // ROLLBACK: nada mudou fora da transação.
    expect(await nucleo.lerSomente(ctx, (l) => contagens(l, cod))).toBe(antesFora);
    const trilhaFora = await nucleo.lerSomente(ctx, async (l) =>
      Number(
        (
          await l.consultar(
            "SELECT COUNT(*) N FROM TBCABTRILHA WHERE ID > ? AND USUARIO IN (?, 'SGH.INT')",
            [gerador0, gestor],
            { teto: 1 },
          )
        )[0]?.['N'] ?? -1,
      ),
    );
    expect(trilhaFora).toBe(0);
  });
});
