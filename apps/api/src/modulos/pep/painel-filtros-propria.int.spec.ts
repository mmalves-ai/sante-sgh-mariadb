// Contrato de efeito dos filtros salvos do painel de pacientes (F3.3, linha 03-PEP L90) contra o MariaDB real (cliente
// de teste). Massa SINTÉTICA: dois estabelecimentos com o código do teste, unidade e setor fictícios; o usuário é um id
// já existente do cliente de teste (só lido). Prova o que fica no banco: vários filtros nomeados por usuário e
// estabelecimento, o primeiro nasce padrão e o padrão é único (escolher outro desmarca o anterior, nova versão da
// linha), renomear com a versão lida (versão velha = 409), nome repetido recusado, recortes gravados (unidade, setor,
// situação, apenas meus), unidade de outro estabelecimento recusada, colunas e largura por filtro (sem mexer nas
// colunas gerais do usuário) e a trilha de cada operação. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaPainelFiltrosPropria } from './painel-filtros-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'l0333pf';
const P2 = 'l0333pf2';

async function limpar(e: Escritor): Promise<void> {
  for (const cod of [P, P2]) {
    const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
    await e.executar(
      `DELETE c FROM painel_coluna_usuario c JOIN painel_filtro_usuario f ON f.id = c.painel_filtro_usuario_id
        WHERE f.estabelecimento_id IN ${est}`,
      [cod],
    );
    await e.executar(`DELETE FROM painel_filtro_usuario WHERE estabelecimento_id IN ${est}`, [cod]);
    await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id IN ${est}`, [cod]);
    await e.executar(`DELETE FROM unidade_assistencial WHERE estabelecimento_id IN ${est}`, [cod]);
  }
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaPainelFiltrosPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaPainelFiltrosPropria;
  let m: { est: number; usuario: number; unidade: number; setor: number; unidade2: number };
  const ctx = () => ({
    cliente: CLIENTE,
    estabelecimento: m.est,
    usuario: m.usuario,
    correlacao: P,
    rede: 'rede-teste',
    hospital: P,
  });
  const ler = <T>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const filtrosNoBanco = () =>
    ler<{ id: number; nome: string; padrao: number; versao: number }>(
      'SELECT id, nome, padrao, versao FROM painel_filtro_usuario WHERE estabelecimento_id = ? ORDER BY id',
      [m.est],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      if (!usuario?.['id']) throw new Error('O cliente de teste precisa de um usuário.');
      const novoEst = (cod: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [cod, `Hospital sintético ${cod}`, `Hospital sintético ${cod} (fictício)`, agora],
        );
      const est = await novoEst(P);
      const est2 = await novoEst(P2);
      const novaUnidade = (e1: number, cod: string) =>
        e.inserir(
          `INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em)
           VALUES (?, ?, 'Unidade sintética', 'internacao', ?)`,
          [e1, cod, agora],
        );
      const unidade = await novaUnidade(est, `${P}-u`);
      const unidade2 = await novaUnidade(est2, `${P2}-u`);
      const setor = await e.inserir(
        `INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em)
         VALUES (?, ?, 'Setor sintético', 'assistencial', ?)`,
        [est, `${P}-s`, agora],
      );
      return { est, usuario: Number(usuario['id']), unidade, setor, unidade2 };
    });
    porta = new PortaPainelFiltrosPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar();
    }
  });

  it('vários filtros nomeados: o primeiro nasce padrão, o padrão é único e os recortes ficam gravados', async () => {
    const a = await porta.incluirFiltro(ctx(), {
      nome: 'UTI',
      unidade: m.unidade,
      situacao: 'em_atendimento',
    });
    const b = await porta.incluirFiltro(ctx(), {
      nome: 'Meus do setor',
      setor: m.setor,
      apenasMeusPacientes: true,
    });
    let banco = await filtrosNoBanco();
    expect(banco.map((x) => [x.nome, Number(x.padrao)])).toEqual([
      ['UTI', 1],
      ['Meus do setor', 0],
    ]);
    const [linhaB] = await ler<Record<string, unknown>>(
      `SELECT usuario_id, setor_funcional_id, apenas_meus_pacientes, tipo_atendimento FROM painel_filtro_usuario
        WHERE id = ?`,
      [b.id],
    );
    expect(linhaB).toMatchObject({ setor_funcional_id: m.setor, tipo_atendimento: 'todos' });
    expect(Number(linhaB!['usuario_id'])).toBe(m.usuario);
    expect(Number(linhaB!['apenas_meus_pacientes'])).toBe(1);

    await porta.escolherPadrao(ctx(), b.id);
    banco = await filtrosNoBanco();
    expect(banco.filter((x) => Number(x.padrao) === 1).map((x) => x.id)).toEqual([b.id]);
    expect(banco.find((x) => x.id === a.id)!.versao).toBe(2);

    // Incluir pedindo padrão também desmarca o anterior.
    const c = await porta.incluirFiltro(ctx(), { nome: 'Plantão', padrao: true });
    banco = await filtrosNoBanco();
    expect(banco.filter((x) => Number(x.padrao) === 1).map((x) => x.id)).toEqual([c.id]);
    const lidos = await porta.filtros(ctx());
    expect(lidos[0]).toMatchObject({ id: c.id, padrao: true });
    expect(lidos.find((x) => x.id === a.id)).toMatchObject({
      unidade: m.unidade,
      situacao: 'em_atendimento',
    });

    // Trilha de cada operação, no estabelecimento do teste.
    const trilha = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM trilha_auditoria
        WHERE estabelecimento_id = ? AND usuario_id = ? AND entidade = 'painel_filtro_usuario'`,
      [m.est, m.usuario],
    );
    expect(Number(trilha[0]!.n)).toBeGreaterThanOrEqual(4);
  });

  it('renomear com a versão lida; versão velha = 409; nome repetido e unidade de outro estabelecimento recusados', async () => {
    const [uti] = (await filtrosNoBanco()).filter((x) => x.nome === 'UTI');
    await porta.alterarFiltro(ctx(), uti!.id, {
      nome: 'UTI adulto',
      unidade: m.unidade,
      versao: uti!.versao,
    });
    const [depois] = await ler<{ nome: string; versao: number }>(
      'SELECT nome, versao FROM painel_filtro_usuario WHERE id = ?',
      [uti!.id],
    );
    expect(depois).toMatchObject({ nome: 'UTI adulto', versao: uti!.versao + 1 });
    await expect(
      porta.alterarFiltro(ctx(), uti!.id, { nome: 'Outro nome', versao: uti!.versao }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(porta.incluirFiltro(ctx(), { nome: ' uti ADULTO ' })).rejects.toMatchObject({
      problema: { status: 422, codigo: 'nome-repetido' },
    });
    await expect(porta.incluirFiltro(ctx(), { nome: 'Alheio', unidade: m.unidade2 })).rejects.toMatchObject({
      problema: { status: 404 },
    });
    expect((await filtrosNoBanco()).map((x) => x.nome)).not.toContain('Alheio');
  });

  it('colunas por filtro com largura, sem mexer nas colunas gerais; largura fora da faixa recusa', async () => {
    const [f] = (await filtrosNoBanco()).filter((x) => x.nome === 'Plantão');
    const gerais = () =>
      ler<{ n: number }>(
        'SELECT COUNT(*) AS n FROM painel_coluna_usuario WHERE usuario_id = ? AND painel_filtro_usuario_id IS NULL',
        [m.usuario],
      );
    const geraisAntes = Number((await gerais())[0]!.n);
    await porta.gravarColunas(ctx(), f!.id, {
      colunas: [
        { coluna: 'leito', largura: 80 },
        { coluna: 'paciente', largura: null },
      ],
    });
    expect(await porta.colunas(ctx(), f!.id)).toEqual([
      { coluna: 'leito', largura: 80 },
      { coluna: 'paciente', largura: null },
    ]);
    const ocultas = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM painel_coluna_usuario WHERE painel_filtro_usuario_id = ? AND exibir = FALSE',
      [f!.id],
    );
    expect(Number(ocultas[0]!.n)).toBeGreaterThan(0);
    // Regravar altera as mesmas linhas (nova versão), sem duplicar.
    await porta.gravarColunas(ctx(), f!.id, {
      colunas: [
        { coluna: 'paciente', largura: 240 },
        { coluna: 'leito', largura: 60 },
      ],
    });
    expect(await porta.colunas(ctx(), f!.id)).toEqual([
      { coluna: 'paciente', largura: 240 },
      { coluna: 'leito', largura: 60 },
    ]);
    const dup = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (SELECT coluna FROM painel_coluna_usuario WHERE painel_filtro_usuario_id = ?
        GROUP BY coluna HAVING COUNT(*) > 1) d`,
      [f!.id],
    );
    expect(Number(dup[0]!.n)).toBe(0);
    expect(Number((await gerais())[0]!.n)).toBe(geraisAntes);
    await expect(
      porta.gravarColunas(ctx(), f!.id, {
        colunas: [
          { coluna: 'leito', largura: 5 },
          { coluna: 'paciente', largura: null },
        ],
      }),
    ).rejects.toMatchObject({ problema: { status: 422, codigo: 'largura-invalida' } });
  });
});
