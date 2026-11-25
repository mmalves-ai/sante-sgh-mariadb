// Contrato de efeito das preferências do usuário (01-ADM L84) no MariaDB: a primeira gravação cria a linha da conta
// e as seguintes a alteram (versão crescente, sem linha nova); o texto ampliado vira zoom; a tela inicial só aceita
// tela do menu; a visão de tela guarda colunas e ordenação, nasce padrão e a nova padrão tira a marca da anterior
// (nada apagado) e regravar a padrão sem dizer `padrao` mantém a marca; a tela inicial e as telas oferecidas seguem
// só o menu do cargo (rota de entrada do menu com permissão da sessão); valor fora da faixa e conta sem pessoa são
// recusados sem gravar. A visão é de uma lista de verdade (a trilha de auditoria): a tela do menu é registrada no
// banco na primeira gravação (código derivado do endereço, ativa, uma linha só), coluna que a lista não oferece é
// recusada e tela sem lista não guarda visão. Massa sintética (prefixo L84I).
import { randomUUID } from 'node:crypto';
import { ARVORE_MENU, COLUNAS_VISAO_POR_ROTA, ROTA_TRILHA_AUDITORIA } from '@sgh/contratos';
import { codigoTelaDoMenu } from '@sgh/dominio-acesso';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../problema.filter.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { FonteAdministracaoPropria } from './fonte-propria.js';
import type { ContextoGestao } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L84I';
/** A lista que guarda visão: a trilha de auditoria, pelo código que a tela do menu recebe. */
const LISTA = codigoTelaDoMenu(ROTA_TRILHA_AUDITORIA);

/** Coluna JSON: o driver pode devolvê-la já interpretada ou como texto. */
const doBanco = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema.codigo ?? '');
    if (e instanceof ErroProblema) return String(e.extras?.['codigo'] ?? e.tipo);
    return `outro: ${(e as Error)?.message ?? ''}`;
  }
}

describe.skipIf(SEM_BANCO)('preferências do usuário no banco próprio (cliente f22_o2)', () => {
  const nucleo = new NucleoProprio();
  let fonte: FonteAdministracaoPropria;
  const ids = { est: 0, pessoa: 0, tela: 0, telaAvulsa: 0, telaMenu: 0 };
  // Uma entrada real do menu (rota e permissão de leitura): a tela sintética ${P}M usa a rota dela.
  const menu = { rota: '', permissao: '' };
  const ctx = (usuario: number | null = ids.pessoa): ContextoGestao => ({
    rede: 'rede-sint',
    hospital: P,
    correlacao: 'teste-l84i',
    login: `${P}.PESSOA`,
    usuario,
    chaveIdempotencia: `tl84i-${randomUUID()}`,
    estacao: 'teste',
  });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l84i' }, (l) => l.uma(sql, p));
  const todos = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l84i' }, (l) => l.consultar(sql, p));
  const exec = (nome: string, entrada: unknown, usuario?: number | null) =>
    fonte.executar(nome, entrada, ctx(usuario));

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l84i' }, async (e) => {
      if (ids.pessoa) {
        await e.executar('DELETE FROM preferencia_tela_usuario WHERE usuario_id = ?', [ids.pessoa]);
        await e.executar('DELETE FROM preferencia_usuario WHERE usuario_id = ?', [ids.pessoa]);
      }
      await limparTrilhaDaMassa(e, { codigos: [P] });
    });
  }

  beforeAll(async () => {
    if ((await nucleo.cliente(CLIENTE)).banco !== `cliente_${CLIENTE}`)
      throw new Error('Cliente de teste inesperado.');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l84i' }, async (e) => {
      const agora = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      ids.est = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids.pessoa = await g(
        'SELECT id FROM usuario WHERE login = ?',
        [`${P}.PESSOA`],
        "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'PESSOA SINTETICA', TRUE, 'pessoa', ?)",
        [`${P}.PESSOA`, agora],
      );
      await g(
        'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
        [ids.pessoa, ids.est],
        'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [ids.pessoa, ids.est, '2020-01-01', agora],
      );
      const modulo = await e.uma<{ id: number }>('SELECT id FROM modulo_sistema ORDER BY id LIMIT 1', []);
      if (!modulo) throw new Error('Cliente de teste sem módulo do sistema.');
      const tela = (cod: string, rota: string | null, avulsa: boolean) =>
        g(
          'SELECT id FROM tela_sistema WHERE codigo = ?',
          [cod],
          "INSERT INTO tela_sistema (codigo, descricao, modulo_sistema_id, titulo, rota, avulsa, criado_em) VALUES (?, 'TELA SINTETICA', ?, 'TELA SINTETICA', ?, ?, ?)",
          [cod, modulo.id, rota, avulsa, agora],
        );
      ids.tela = await tela(P, '/l84i-sintetica', false);
      const jaMinha = await e.uma<{ rota: string }>('SELECT rota FROM tela_sistema WHERE codigo = ?', [
        `${P}M`,
      ]);
      for (const i of ARVORE_MENU) {
        if (!i.rota || !i.permissao) continue;
        if (jaMinha && jaMinha.rota !== i.rota) continue;
        if (!jaMinha && (await e.uma('SELECT id FROM tela_sistema WHERE rota = ?', [i.rota]))) continue;
        Object.assign(menu, { rota: i.rota, permissao: i.permissao });
        break;
      }
      if (!menu.rota) throw new Error('Nenhuma entrada do menu livre para a massa.');
      ids.telaMenu = await tela(`${P}M`, menu.rota, false);
      ids.telaAvulsa = await tela(`${P}AV`, null, true);
    });
    fonte = new FonteAdministracaoPropria(nucleo, CLIENTE, { rede: 'rede-sint' });
    await limpar();
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('geral: a primeira gravação cria a linha da conta; a seguinte altera a mesma (versão 2)', async () => {
    const r1 = await exec('preferencias.gravarGeral', { tema: 'escuro', textoAmpliado: true });
    const l1 = await um('SELECT * FROM preferencia_usuario WHERE usuario_id = ?', [ids.pessoa]);
    expect(l1).toMatchObject({ id: r1['id'], tema: 'escuro', densidade: 'normal', versao: 1 });
    expect(Number(l1!['zoom_percentual'])).toBe(125);
    expect(Number(l1!['criado_por'])).toBe(ids.pessoa);
    await exec('preferencias.gravarGeral', {
      densidade: 'compacta',
      textoAmpliado: false,
      telaInicial: `${P}M`,
      permissoesSessao: [menu.permissao],
    });
    const linhas = await todos('SELECT * FROM preferencia_usuario WHERE usuario_id = ?', [ids.pessoa]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      tema: 'escuro',
      densidade: 'compacta',
      zoom_percentual: null,
      versao: 2,
    });
    expect(Number(linhas[0]!['tela_inicial_id'])).toBe(ids.telaMenu);
    const c = { rede: 'rede-sint', hospital: P, traceId: 't' };
    const lidas = await fonte.lerPreferencias(c, ids.pessoa, undefined, new Set([menu.permissao]));
    expect(lidas.guardadas).toBe(true);
    expect(lidas.telaInicial).toEqual({ codigo: `${P}M`, titulo: 'TELA SINTETICA', rota: menu.rota });
    expect(lidas.geral).toMatchObject({ tema: 'escuro', densidade: 'compacta', textoAmpliado: false });
    expect(lidas.telasDoMenu.map((t) => t.codigo)).toContain(`${P}M`);
    // Fora do menu do cargo: nem a tela sintética sem entrada no menu nem a avulsa são oferecidas.
    expect(lidas.telasDoMenu.some((t) => t.codigo === P || t.codigo === `${P}AV`)).toBe(false);
    // O cargo perdeu o acesso: a tela não é oferecida nem devolvida como inicial, e a linha fica como está.
    const semAcesso = await fonte.lerPreferencias(c, ids.pessoa, undefined, new Set());
    expect(semAcesso.telaInicial).toBeNull();
    expect(semAcesso.telasDoMenu.some((t) => t.codigo === `${P}M`)).toBe(false);
  });

  it('geral: recusa valor fora da faixa, tela avulsa e conta sem pessoa, sem gravar', async () => {
    expect(await codigo(exec('preferencias.gravarGeral', { zoomPercentual: 20 }))).toBe('zoom-fora-da-faixa');
    expect(await codigo(exec('preferencias.gravarGeral', { tema: 'azul' }))).toBe('tema-invalido');
    expect(await codigo(exec('preferencias.gravarGeral', { telaInicial: `${P}AV` }))).toBe(
      'tela-inicial-sem-rota',
    );
    expect(await codigo(exec('preferencias.gravarGeral', { tema: 'claro' }, null))).toBe('sem-conta');
    // Tela do menu sem a permissão do cargo e tela fora do menu: recusadas.
    expect(
      await codigo(
        exec('preferencias.gravarGeral', { telaInicial: `${P}M`, permissoesSessao: ['outra.ler'] }),
      ),
    ).toBe('tela-sem-permissao');
    expect(
      await codigo(exec('preferencias.gravarGeral', { telaInicial: P, permissoesSessao: [menu.permissao] })),
    ).toBe('tela-sem-permissao');
    expect(
      await um('SELECT versao, tema FROM preferencia_usuario WHERE usuario_id = ?', [ids.pessoa]),
    ).toMatchObject({
      versao: 2,
      tema: 'escuro',
    });
  });

  it('visão de tela: registra a tela do menu, nasce padrão; a nova padrão tira a marca da anterior; nada apagado', async () => {
    // O cadastro da tela vem do código: a primeira visão registra a tela do menu (uma linha, ativa, com o endereço).
    const telaLista = async () =>
      (await um('SELECT codigo FROM tela_sistema WHERE rota = ?', [ROTA_TRILHA_AUDITORIA]))?.['codigo'] as
        string | undefined;
    const codigoLista = (await telaLista()) ?? LISTA;
    await exec('preferencias.gravarVisaoTela', {
      tela: codigoLista,
      colunas: ['dataHora', 'usuario', 'acao'],
      ordenacao: [{ coluna: 'dataHora', direcao: 'asc' }],
      itensPorPagina: 50,
    });
    const registrada = await todos(
      'SELECT codigo, ativo, avulsa, titulo, modulo_sistema_id FROM tela_sistema WHERE rota = ?',
      [ROTA_TRILHA_AUDITORIA],
    );
    expect(registrada).toHaveLength(1);
    expect(registrada[0]).toMatchObject({ codigo: codigoLista });
    expect(Number(registrada[0]!['ativo'])).toBe(1);
    expect(Number(registrada[0]!['avulsa'])).toBe(0);
    expect(Number(registrada[0]!['modulo_sistema_id'])).toBeGreaterThan(0);
    await exec('preferencias.gravarVisaoTela', {
      tela: codigoLista,
      nome: 'Plantão noturno',
      colunas: ['usuario', 'dataHora'],
      ordenacao: [{ coluna: 'usuario', direcao: 'desc' }],
      padrao: true,
    });
    expect(await todos('SELECT id FROM tela_sistema WHERE rota = ?', [ROTA_TRILHA_AUDITORIA])).toHaveLength(
      1,
    );
    const v = await todos(
      'SELECT nome, padrao, colunas_visiveis, ordenacao, itens_por_pagina FROM preferencia_tela_usuario WHERE usuario_id = ? ORDER BY nome',
      [ids.pessoa],
    );
    expect(v.map((x) => [x['nome'], Number(x['padrao'])])).toEqual([
      ['padrao', 0],
      ['Plantão noturno', 1],
    ]);
    expect(doBanco(v[0]!['colunas_visiveis'])).toEqual(['dataHora', 'usuario', 'acao']);
    expect(Number(v[0]!['itens_por_pagina'])).toBe(50);
    expect(doBanco(v[1]!['ordenacao'])).toEqual([{ coluna: 'usuario', direcao: 'desc' }]);
    const lidas = await fonte.lerPreferencias(
      { rede: 'rede-sint', hospital: P, traceId: 't' },
      ids.pessoa,
      codigoLista,
      new Set(['auditoria.trilha.ler']),
    );
    expect(lidas.visaoInicialPorTela[codigoLista]).toBe('Plantão noturno');
    expect(lidas.visoes).toHaveLength(2);
    // A tela é oferecida a quem tem a permissão do menu, com o código que está no banco.
    expect(lidas.telasDoMenu.find((t) => t.rota === ROTA_TRILHA_AUDITORIA)?.codigo).toBe(codigoLista);
    // Regravar a visão padrão (só as colunas, sem `padrao`) mantém a marca; a outra segue sem ela.
    await exec('preferencias.gravarVisaoTela', {
      tela: codigoLista,
      nome: 'Plantão noturno',
      colunas: ['usuario'],
    });
    const marcas = await todos(
      'SELECT nome, padrao, versao FROM preferencia_tela_usuario WHERE usuario_id = ? ORDER BY nome',
      [ids.pessoa],
    );
    expect(marcas.map((x) => [x['nome'], Number(x['padrao'])])).toEqual([
      ['padrao', 0],
      ['Plantão noturno', 1],
    ]);
    expect(Number(marcas[1]!['versao'])).toBe(2);
    expect(
      await codigo(
        exec('preferencias.gravarVisaoTela', {
          tela: codigoLista,
          colunas: ['dataHora'],
          ordenacao: [{ coluna: 'usuario', direcao: 'asc' }],
        }),
      ),
    ).toBe('ordenacao-fora-das-colunas');
    // Coluna que a lista não oferece e tela que não tem lista: recusadas sem gravar.
    expect(COLUNAS_VISAO_POR_ROTA[ROTA_TRILHA_AUDITORIA]).not.toContain('salario');
    expect(
      await codigo(
        exec('preferencias.gravarVisaoTela', { tela: codigoLista, colunas: ['dataHora', 'salario'] }),
      ),
    ).toBe('coluna-desconhecida');
    expect(await codigo(exec('preferencias.gravarVisaoTela', { tela: P, colunas: ['dataHora'] }))).toBe(
      'tela-sem-visao',
    );
    expect(await codigo(exec('preferencias.gravarVisaoTela', { tela: 'L84INEXISTE', colunas: ['a'] }))).toBe(
      'tela-inexistente',
    );
    const depois = await todos(
      'SELECT nome, colunas_visiveis FROM preferencia_tela_usuario WHERE usuario_id = ? ORDER BY nome',
      [ids.pessoa],
    );
    expect(depois).toHaveLength(2);
    expect(doBanco(depois[1]!['colunas_visiveis'])).toEqual(['usuario']);
    const trilha = await um(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = 'teste-l84i' AND usuario_id = ?",
      [ids.pessoa],
    );
    expect(Number(trilha?.['n'] ?? 0)).toBeGreaterThanOrEqual(5);
  });
});
