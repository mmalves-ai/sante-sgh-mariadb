// Contrato de efeito dos painéis gerenciais montados pelo hospital (01-REL L112; F3) contra o MariaDB real (cliente de
// teste; massa SINTÉTICA com o código do teste, nenhuma pessoa real). Prova o que fica no banco: o painel nasce em
// montagem (inativo) com a pessoa como dona e o código repetido é recusado; pôr em uso sem quadro nem permissão é
// recusado sem gravar; salvar grava os quadros em ordem (indicador com a forma e texto) e as permissões por perfil e
// por pessoa com a vigência; indicador repetido na mesma forma, permissão sem alvo e versão velha são recusados sem
// mudar nada; tirar quadro e permissão marca-os como excluídos (nada é apagado); em uso, quem tem o perfil abre o
// painel com a série apurada (numerador, denominador, meta) do período; quem não tem permissão não vê nem abre;
// tirado de uso, só o dono e o editor geral abrem.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaPainelGerencialPropria } from './painel-gerencial-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2077pg';

/** Primeiro dia do mês, `n` meses antes do mês corrente. */
function competencia(n: number): string {
  const h = new Date();
  const d = new Date(Date.UTC(h.getFullYear(), h.getMonth() - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const pg = `(SELECT x.id FROM (SELECT id FROM painel_gerencial WHERE estabelecimento_id IN ${est}) x)`;
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM painel_gerencial_item WHERE painel_gerencial_id IN ${pg}`, [P]);
    await e.executar(`DELETE FROM painel_gerencial_permissao WHERE painel_gerencial_id IN ${pg}`, [P]);
    await e.executar(`DELETE FROM painel_gerencial WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM apuracao_indicador WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM usuario_perfil WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM perfil_acesso WHERE codigo LIKE 'c2077-%'`);
    await e.executar(`DELETE FROM indicador WHERE codigo LIKE 'C2077%'`);
    await limparTrilhaDaMassa(e, { codigos: [P] });
    await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

describe.skipIf(SEM_BANCO)('Painéis gerenciais montados pelo hospital (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaPainelGerencialPropria;
  let m: { est: number; dono: number; leitor: number; estranho: number; perfil: number; indicador: number };
  let painel = 0;
  const ctx = (usuario = m.dono) => ({ cliente: CLIENTE, usuario, correlacao: P, hospital: P });
  const comum = { editorGeral: false };
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const linhaPainel = async () =>
    (
      await ler('SELECT ativo, nome, versao, dono_usuario_id FROM painel_gerencial WHERE id = ?', [painel])
    )[0]!;
  const itens = () =>
    ler(
      `SELECT sequencia, tipo_item, indicador_id, forma_exibicao, texto, largura, casas_decimais,
              excluido_em IS NOT NULL AS excluido
         FROM painel_gerencial_item WHERE painel_gerencial_id = ? ORDER BY sequencia`,
      [painel],
    );
  const permissoes = () =>
    ler(
      `SELECT perfil_acesso_id, usuario_id, pode_exportar, vigencia_inicio, excluido_em IS NOT NULL AS excluido
         FROM painel_gerencial_permissao WHERE painel_gerencial_id = ? ORDER BY id`,
      [painel],
    );
  const erro = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      const x = e as { problema?: { status?: number }; status?: number };
      return { status: x.problema?.status ?? x.status, texto: JSON.stringify(x.problema ?? x) };
    }
    throw new Error('Era para recusar.');
  };
  const quadroIndicador = (forma = 'linha') => ({
    tipo: 'indicador',
    indicadorId: m.indicador,
    titulo: null,
    texto: null,
    forma,
    largura: 2,
    casasDecimais: 1,
    exibirMeta: true,
  });
  const quadroTexto = {
    tipo: 'texto',
    indicadorId: null,
    titulo: 'Leitura',
    texto: 'Ocupação acima da meta no trimestre.',
    forma: 'texto',
    largura: 3,
    casasDecimais: null,
    exibirMeta: false,
  };
  const dados = {
    nome: 'Diretoria assistencial',
    descricao: null,
    publico: 'diretoria',
    periodoPadrao: 'ultimos_3_meses',
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaPainelGerencialPropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const us = await e.consultar('SELECT id FROM usuario WHERE excluido_em IS NULL ORDER BY id LIMIT 3');
      if (us.length < 3) throw new Error('O cliente de teste precisa de 3 usuários.');
      const [dono, leitor, estranho] = us.map((r) => Number(r['id'])) as [number, number, number];
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
        [P, agora],
      );
      const perfil = await e.inserir(
        "INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, 'c2077-dir', 'Diretoria teste', ?)",
        [est, agora],
      );
      await e.executar(
        'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        [leitor, perfil, est, '2026-01-01', agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      let indicador: number | undefined;
      try {
        indicador = await e.inserir(
          `INSERT INTO indicador (codigo, nome, grupo_indicador_id, unidade, polaridade, criado_em)
           VALUES ('C2077OCUP', 'Taxa de ocupação (teste)', 0, 'percentual', 'maior_melhor', ?)`,
          [agora],
        );
        // Duas competências dentro dos últimos 3 meses e uma fora (5 meses atrás), que não pode aparecer.
        for (const [n, num, den, situacao] of [
          [5, 50, 100, 'fora_da_meta'],
          [2, 70, 100, 'fora_da_meta'],
          [1, 171, 200, 'na_meta'],
        ] as const) {
          const comp = competencia(n);
          await e.executar(
            `INSERT INTO apuracao_indicador (estabelecimento_id, indicador_id, indicador_versao_id, competencia, periodo_inicio,
               periodo_fim, numerador, denominador, valor, valor_meta, situacao_meta, criado_em)
             VALUES (?, ?, 0, ?, ?, LAST_DAY(?), ?, ?, ?, 80, ?, ?)`,
            [est, indicador, comp, comp, comp, num, den, (num / den) * 100, situacao, agora],
          );
        }
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
      return { est, dono, leitor, estranho, perfil, indicador: indicador! };
    });
  });

  afterAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  });

  it('cria em montagem com a pessoa como dona; código repetido e uso sem quadro são recusados sem gravar', async () => {
    const r = await porta.criar(ctx(), { codigo: 'DIR-ASSIST', ...dados, rede: false });
    painel = r.id;
    expect(await linhaPainel()).toMatchObject({
      ativo: 0,
      nome: 'Diretoria assistencial',
      dono_usuario_id: m.dono,
    });
    expect((await erro(porta.criar(ctx(), { codigo: 'DIR-ASSIST', ...dados, rede: false }))).texto).toContain(
      'codigo-repetido',
    );
    const e = await erro(porta.mudarUso(ctx(), painel, { versao: 1, ativo: true }));
    expect(e.texto).toContain('sem-itens');
    expect(e.texto).toContain('sem-permissoes');
    expect(await linhaPainel()).toMatchObject({ ativo: 0, versao: 1 });
  });

  it('recusa indicador repetido, permissão sem alvo e versão velha sem gravar; salva quadros e permissões', async () => {
    const ruim = await erro(
      porta.salvar(ctx(), painel, {
        versao: 1,
        ...dados,
        itens: [quadroIndicador(), quadroIndicador()],
        permissoes: [
          { perfilId: null, usuarioId: null, podeExportar: false, vigenciaInicio: null, vigenciaFim: null },
        ],
      }),
    );
    expect(ruim.texto).toContain('indicador-repetido');
    expect(ruim.texto).toContain('alvo-invalido');
    expect(await itens()).toHaveLength(0);
    expect(await permissoes()).toHaveLength(0);

    const r = await porta.salvar(ctx(), painel, {
      versao: 1,
      ...dados,
      itens: [quadroIndicador(), quadroIndicador('numero'), quadroTexto],
      permissoes: [
        {
          perfilId: m.perfil,
          usuarioId: null,
          podeExportar: true,
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
        },
        { perfilId: null, usuarioId: m.dono, podeExportar: false, vigenciaInicio: null, vigenciaFim: null },
      ],
    });
    expect(r.versao).toBe(2);
    expect(await itens()).toEqual([
      expect.objectContaining({
        sequencia: 1,
        tipo_item: 'indicador',
        forma_exibicao: 'linha',
        largura: 2,
        excluido: 0,
      }),
      expect.objectContaining({
        sequencia: 2,
        tipo_item: 'indicador',
        forma_exibicao: 'numero',
        excluido: 0,
      }),
      expect.objectContaining({
        sequencia: 3,
        tipo_item: 'texto',
        indicador_id: null,
        forma_exibicao: 'texto',
      }),
    ]);
    expect(await permissoes()).toEqual([
      expect.objectContaining({
        perfil_acesso_id: m.perfil,
        usuario_id: null,
        pode_exportar: 1,
        excluido: 0,
      }),
      expect.objectContaining({ perfil_acesso_id: null, usuario_id: m.dono, pode_exportar: 0, excluido: 0 }),
    ]);
    const velha = await erro(
      porta.salvar(ctx(), painel, { versao: 1, ...dados, itens: [quadroTexto], permissoes: [] }),
    );
    expect(velha.status).toBe(409);
    expect((await itens()).filter((i) => i['excluido'] === 0)).toHaveLength(3);
  });

  it('em uso, quem tem o perfil vê e abre com a série do período; quem não tem não vê nem abre', async () => {
    await porta.mudarUso(ctx(), painel, { versao: 2, ativo: true });
    expect(await linhaPainel()).toMatchObject({ ativo: 1, versao: 3 });

    expect((await porta.paineis(ctx(m.leitor), comum)).map((x) => x.id)).toContain(painel);
    const aberto = await porta.abrir(ctx(m.leitor), painel, comum);
    expect(aberto.exportar).toBe(true);
    expect(aberto.quadros).toHaveLength(3);
    const q = aberto.quadros[0]!.indicador!;
    expect(q.serie.map((s) => s.competencia)).toEqual([competencia(2), competencia(1)]);
    expect(q.ultima).toMatchObject({
      numerador: 171,
      denominador: 200,
      valor: 85.5,
      meta: 80,
      situacaoMeta: 'na_meta',
    });
    expect(q.variacao).toBe(22.1);
    expect(q.casasDecimais).toBe(1);
    expect(aberto.quadros[2]).toMatchObject({ tipo: 'texto', indicador: null });

    expect((await porta.paineis(ctx(m.estranho), comum)).map((x) => x.id)).not.toContain(painel);
    expect((await erro(porta.abrir(ctx(m.estranho), painel, comum))).status).toBe(404);
    expect((await porta.abrir(ctx(m.estranho), painel, { editorGeral: true })).quadros).toHaveLength(3);
  });

  it('tirar quadro e permissão marca como excluído; tirado de uso, só o dono abre', async () => {
    await porta.salvar(ctx(), painel, {
      versao: 3,
      ...dados,
      itens: [quadroIndicador()],
      permissoes: [
        { perfilId: null, usuarioId: m.dono, podeExportar: false, vigenciaInicio: null, vigenciaFim: null },
      ],
    });
    const it = await itens();
    expect(it.map((i) => [i['sequencia'], i['excluido']])).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
    ]);
    expect((await permissoes()).map((p) => p['excluido'])).toEqual([1, 0]);
    expect((await erro(porta.abrir(ctx(m.leitor), painel, comum))).status).toBe(404);

    await porta.mudarUso(ctx(), painel, { versao: 4, ativo: false });
    expect(await linhaPainel()).toMatchObject({ ativo: 0, versao: 5 });
    expect((await porta.abrir(ctx(m.dono), painel, comum)).quadros).toHaveLength(1);
    // Nada foi apagado: as linhas continuam no banco.
    expect(await itens()).toHaveLength(3);
    expect(await permissoes()).toHaveLength(2);
  });
});
