// ADR 0022 na CÓPIA, sob a trava da cópia e numa transação SEMPRE desfeita (ROLLBACK, desfazendoNaCopia): as
// receitas das permissões do próprio legado pelo executor (grupo, opções, troca de grupo, papéis), a trilha do
// legado como o Delphi grava (tipos 25, 18 e 17), o efeito nas concessões lidas ao vivo, o mapa grupo → perfil
// aprovado (perfil para o grupo inteiro), a concessão e a revogação de perfil do Sante SGH, a imagem
// antes/depois numa sessão de acesso total e o Desfazer; fora da transação, nada mudou. Massa sintética
// (operador, alvo e grupo criados pelo executor); a saída só tem contagens e códigos.
// Rodar: flock <travas>/copia.lock ./pnpm testes:integracao (com o 0018 aplicado pelo sgh:aplicar).
import { CATALOGO_DECLARADO } from '@sgh/contratos';
import { CATALOGO_LEGADO } from '@sgh/contratos/catalogo-legado';
import { conceder } from '@sgh/dominio-acesso';
import {
  comImagens,
  decidirMapaOpcao,
  type Escritor,
  executarComo,
  executarCorrecao,
  gravarConcessaoPerfil,
  type Leitor,
  lerConcessoesUsuario,
  lerHistoricoPerfis,
  lerImagens,
  lerPerfisConcedidos,
  lerPerfisDoGrupo,
  limparMetadadosComo,
  type MarcaComo,
  operacao,
  revogarConcessaoPerfil,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx as contextoDe, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const MARCA: MarcaComo = {
  sessao: '999000101',
  acao: '999000102',
  atorTipo: 'plataforma',
  idConta: '999000103',
  alvo: 'SINT.SGH.ACESSOTOTAL',
};

/** Opção 5429 "Cadastro de usuários" (módulo de abertura, ativa): dá acesso.grupo.ler e acesso.permissao.ler. */
const OPCAO = 5429;

async function contagens(l: Leitor): Promise<string> {
  const n = async (sql: string) => Number((await l.consultar(sql, [], { teto: 1 }))[0]?.['N'] ?? -1);
  return JSON.stringify([
    await n('SELECT COUNT(*) N FROM TBPERUSU'),
    await n('SELECT COUNT(*) N FROM TBGRUUSU'),
    await n('SELECT COUNT(*) N FROM TBUSERS_TBPAPEL'),
    await n('SELECT COUNT(*) N FROM TBUSERS'),
    await n('SELECT COUNT(*) N FROM TBPAPEL_TBOPCOES'),
    await n('SELECT MAX(ID) N FROM TBCABTRILHA'),
    await n('SELECT COUNT(*) N FROM SGH_ACESSO_PERFIL_USUARIO'),
    await n('SELECT COUNT(*) N FROM SGH_ACESSO_MAPA_OPCAO'),
  ]);
}

describe.skipIf(!PODE_ESCREVER)('permissões do legado e perfis do Sante SGH na cópia (ADR 0022)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    limparMetadadosComo();
    a = await prepararAmbiente({ FB_POOL_TETO: '1' });
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('receitas pelo executor, trilha do Delphi, concessões ao vivo, mapa, perfil, imagem e Desfazer; ROLLBACK no fim', async () => {
    const ctx = contextoDe(a);
    const { nucleo, executor, cod } = a;
    const antesFora = await nucleo.lerSomente(ctx, (l) => contagens(l));
    const sufixo = Date.now().toString(36).toUpperCase();
    const operador = `sgh.int.op.${sufixo}`.slice(0, 31);
    const alvo = `sgh.int.alvo.${sufixo}`.slice(0, 31);
    const grupo = `SGH_INT_${sufixo}`;
    let n = 0;
    const r = await nucleo.desfazendoNaCopia(ctx, async (e) => {
      const [maxTrilha] = await e.consultar('SELECT MAX(ID) N FROM TBCABTRILHA', [], { teto: 1 });
      const exec = (nome: string, entrada: unknown, quem = operador, escritor: Escritor = e) =>
        executor.executar(
          operacao(nome),
          cod,
          entrada,
          {
            ...ctx,
            usuarioLegado: quem,
            idempotencyKey: `int-adr22-${sufixo}-${++n}`,
            reautenticadoEm: Date.now(),
          },
          { escritor },
        );
      for (const u of [operador, alvo])
        await exec(
          'acesso.criarUsuarioIntegracao',
          { nome: u, nomeCompleto: 'USUARIO SINTETICO SGH ADR 0022' },
          'SGH.INT',
        );
      await exec('acesso.criarGrupo', { nome: grupo });
      await exec('acesso.concederOpcoesGrupo', { grupo, opcoes: [OPCAO] });
      await exec('acesso.trocarGrupoUsuario', { login: alvo, grupo });
      await exec('acesso.concederPapelUsuario', { login: alvo, papel: 3 });
      await exec('acesso.concederPapelUsuario', { login: alvo, papel: 4 });
      await exec('acesso.revogarPapelUsuario', { login: alvo, papel: 3 });
      let aSi = 'aceito';
      try {
        await exec('acesso.concederPapelUsuario', { login: operador, papel: 3 });
      } catch (x) {
        aSi = (x as { problema?: { codigo?: string } }).problema?.codigo ?? 'outro';
      }
      const concessoes = await lerConcessoesUsuario(e, alvo);
      const legadoConcede = conceder({
        legado: concessoes,
        catalogo: [...CATALOGO_LEGADO, ...CATALOGO_DECLARADO],
      });
      // Mapa grupo → perfil aprovado: o grupo inteiro recebe o perfil (e as telas da Fase 0).
      const trilha = {
        rede: nucleo.rede,
        hospital: cod,
        usuario: operador,
        evento: 'acesso.mapa.decidido',
        recurso: 'acesso.perfil',
        operacao: 'acesso.decidirMapa',
        resultado: 'sucesso',
        estacao: 'SGH-TESTE:integracao',
        correlacao: 'int-adr22',
      };
      await decidirMapaOpcao(
        e,
        {
          tipo: 'grupo-perfil',
          grupo,
          perfil: 'administrador-sistema',
          permissao: null,
          situacao: 'aprovada',
          origem: 'revisao-area',
          por: operador,
        },
        trilha,
      );
      const perfisDoGrupo = await lerPerfisDoGrupo(e, grupo);
      const comMapa = conceder({
        legado: concessoes,
        catalogo: [...CATALOGO_LEGADO, ...CATALOGO_DECLARADO],
        perfisDoGrupo,
      });
      // Perfil do Sante SGH concedido e revogado.
      const [u] = await e.consultar('SELECT ID_TBUSERS FROM TBUSERS WHERE NOME = ?', [alvo], { teto: 1 });
      const c = await gravarConcessaoPerfil(
        e,
        {
          idUsuario: Number(u?.['ID_TBUSERS']),
          login: alvo,
          perfil: 'auditor',
          concedidoPor: operador,
          areaAprovou: 'gestor-acessos',
          inicio: null,
          fim: null,
          motivo: 'teste de integração',
        },
        { ...trilha, evento: 'acesso.perfil.concedido' },
      );
      const vigentes = (await lerPerfisConcedidos(e, alvo)).map((p) => p.perfil);
      await revogarConcessaoPerfil(e, c.id, operador, { ...trilha, evento: 'acesso.perfil.revogado' });
      const depoisRevogar = (await lerPerfisConcedidos(e, alvo)).map((p) => p.perfil);
      // Concessão temporária (fim = agora + 2 s, um instante real do pedido): vale até o fim pedido, nem 3 h a
      // mais (a coluna guarda a hora civil do banco: civilDoBanco na gravação, instanteDoBanco na leitura).
      const fimPedido = new Date(Date.now() + 2_000);
      await gravarConcessaoPerfil(
        e,
        {
          idUsuario: Number(u?.['ID_TBUSERS']),
          login: alvo,
          perfil: 'administrador-sistema',
          concedidoPor: operador,
          areaAprovou: 'gestor-acessos',
          inicio: null,
          fim: fimPedido,
          motivo: 'teste de integração: temporária',
        },
        { ...trilha, evento: 'acesso.perfil.concedido' },
      );
      const temporaria = (await lerPerfisConcedidos(e, alvo)).find(
        (p) => p.perfil === 'administrador-sistema',
      );
      const fimLido = Math.abs((temporaria?.fim?.getTime() ?? 0) - fimPedido.getTime());
      await new Promise((r) => setTimeout(r, 3_500));
      const temporariaDepois = (await lerPerfisConcedidos(e, alvo)).some(
        (p) => p.perfil === 'administrador-sistema',
      );
      const historico = (await lerHistoricoPerfis(e, alvo))
        .filter((h) => h.perfil === 'auditor')
        .map((h) => h.revogadoEm !== null);
      // Trilha do legado como o Delphi: tipo e opção de cada gravação, pelo operador.
      const eventos = await e.consultar(
        `SELECT ID_TBTPACAOAUDIT T, ID_TBOPCOES O, (SELECT COUNT(*) FROM TBLANTRILHASGH l WHERE l.ID_TBCABTRILHA = c.ID) D
           FROM TBCABTRILHA c WHERE c.ID > ? AND c.USUARIO = ? ORDER BY c.ID`,
        [maxTrilha?.['N'] ?? 0, operador],
        { teto: 50 },
      );
      // Acesso total: a imagem antes/depois da escrita no legado e o Desfazer.
      const { imagens, opcoesAntes, opcoesDepois } = await executarComo(MARCA, async () => {
        const como = comImagens(e, MARCA, nucleo.rede);
        await exec('acesso.concederOpcoesGrupo', { grupo, opcoes: [5433] }, operador, como);
        const antes = (
          await e.consultar('SELECT COUNT(*) N FROM TBPERUSU WHERE GRUPO = ?', [grupo], { teto: 1 })
        )[0]?.['N'];
        const im = await lerImagens(e, MARCA.sessao);
        await executarCorrecao(e, im, { atorTipo: 'plataforma', idConta: MARCA.idConta }, false);
        const depois = (
          await e.consultar('SELECT COUNT(*) N FROM TBPERUSU WHERE GRUPO = ?', [grupo], { teto: 1 })
        )[0]?.['N'];
        return {
          imagens: im.map((i) => `${i.tabela}:${i.operacao}`),
          opcoesAntes: Number(antes),
          opcoesDepois: Number(depois),
        };
      });
      const [modo] = await e.consultar('SELECT FIRST 1 MODO FROM SGH_SUP_SESSAO', [], { teto: 1 });
      return {
        grupo: concessoes.grupo,
        opcoesGrupo: concessoes.opcoesGrupo,
        papeis: [...concessoes.papeis].sort(),
        aSi,
        legado: [...legadoConcede.permissoes].filter((p) => p.startsWith('acesso.')),
        schemaSemMapa: legadoConcede.permissoes.has('config.schema.ler'),
        perfisDoGrupo,
        schemaComMapa: comMapa.permissoes.has('config.schema.ler'),
        vigentes,
        depoisRevogar,
        historico,
        temporaria: temporaria !== undefined,
        fimLidoMs: fimLido,
        temporariaDepois,
        eventos: eventos.map((x) => `${Number(x['T'])}/${Number(x['O'])}/${Number(x['D'])}`),
        imagens,
        opcoesAntes,
        opcoesDepois,
        colunaModo: modo === undefined || 'MODO' in modo,
      };
    });
    expect(r.grupo).toBe(grupo);
    expect(r.opcoesGrupo).toEqual([OPCAO]);
    expect(r.papeis).toEqual([4]);
    expect(r.aSi).toBe('a-si-mesmo');
    expect(r.legado).toEqual(expect.arrayContaining(['acesso.grupo.ler', 'acesso.permissao.ler']));
    expect(r.schemaSemMapa).toBe(false);
    expect(r.perfisDoGrupo).toEqual(['administrador-sistema']);
    expect(r.schemaComMapa).toBe(true);
    expect(r.vigentes).toEqual(['auditor']);
    expect(r.depoisRevogar).toEqual([]);
    expect(r.historico).toEqual([true]);
    expect(r.temporaria).toBe(true);
    // O TIMESTAMP do Firebird guarda décimos de milissegundo: a diferença é só o arredondamento.
    expect(r.fimLidoMs).toBeLessThan(1_000);
    expect(r.temporariaDepois).toBe(false);
    // Grupo (18/5426), opções (25/5438), troca de grupo e papéis (17/5435 com TBUSERS.ID_TBUSERS no detalhe).
    expect(r.eventos).toEqual(['18/5426/0', '25/5438/0', '17/5435/1', '17/5435/1', '17/5435/1', '17/5435/1']);
    expect(r.imagens).toEqual(['TBPERUSU:INSERT']);
    expect([r.opcoesAntes, r.opcoesDepois]).toEqual([2, 1]);
    expect(r.colunaModo).toBe(true);
    // ROLLBACK: nada mudou fora da transação (contagens e o maior ID da trilha do legado).
    expect(await nucleo.lerSomente(ctx, (l) => contagens(l))).toBe(antesFora);
  });
});
