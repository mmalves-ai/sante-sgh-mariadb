// Contrato de efeito da composição nutricional dos alimentos (F8, 04-HOT linha 142) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA com o prefixo do teste: estabelecimento, usuário, unidade, grupo e dois gêneros (um inativo),
// grupo de alimento, dois nutrientes, um alimento vigente da fonte 'propria' com um nutriente vigente e um encerrado,
// e um alimento encerrado. Prova: a busca só traz o vigente (pela descrição e pelo código); o detalhe traz só o nutriente
// vigente, por 100 g e na porção (regra do domínio); porção fora da faixa recusada sem leitura; a ligação ao gênero grava
// só insumo_id e a versão (descrição, energia e edição intactas), com a trilha; versão velha, gênero inativo e alimento
// encerrado recusados sem escrita; desligar grava nulo.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaComposicaoPropria } from './composicao-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c3018cn';

interface Massa {
  usuario: number;
  generoAtivo: number;
  generoInativo: number;
  grupo: number;
  alimento: number;
  encerrado: number;
}

async function limpar(e: Escritor): Promise<void> {
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(
      `DELETE an FROM alimento_referencia_nutriente an JOIN alimento_referencia a ON a.id = an.alimento_referencia_id
        WHERE a.codigo_fonte LIKE ?`,
      [`${P}-%`],
    );
    await e.executar('DELETE FROM alimento_referencia WHERE codigo_fonte LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM nutriente_referencia WHERE codigo_infoods LIKE ?', [`${P}_%`]);
    await e.executar('DELETE FROM grupo_alimento WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM insumo WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM grupo_insumo WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM unidade_medida WHERE codigo LIKE ?', [`${P}-%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  const usuarios = (await e.consultar('SELECT id FROM usuario WHERE login LIKE ?', [`${P}.%`])).map((x) =>
    Number(x['id']),
  );
  await limparTrilhaDaMassa(e, { codigos: [P] });
  if (usuarios.length) {
    await e.executar('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await e.executar(`DELETE FROM usuario WHERE id IN (${usuarios.map(() => '?').join(',')})`, usuarios);
    } finally {
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    }
  }
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaComposicaoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaComposicaoPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const alimentoNoBanco = async (id: number) =>
    (
      await ler(
        'SELECT descricao, energia_kcal + 0 AS kcal, versao_fonte, insumo_id, versao, alterado_por FROM alimento_referencia WHERE id = ?',
        [id],
      )
    )[0];

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const usuario = await e.inserir(
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [`${P}.nutri`, 'USUARIO SINTETICO NUTRI', agora],
      );
      const unidade = await e.inserir(
        'INSERT INTO unidade_medida (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}-KG`, 'QUILOGRAMA SINTETICO', 'KGC', agora],
      );
      const gi = await e.inserir(
        "INSERT INTO grupo_insumo (codigo, descricao, natureza, criado_em) VALUES (?, 'GENEROS SINTETICOS', 'material', ?)",
        [`${P}-G`, agora],
      );
      const genero = (cod: string, situacao: string) =>
        e.inserir(
          `INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, situacao, criado_em)
           VALUES (?, ?, 'outro', ?, ?, ?, ?)`,
          [`${P}-${cod}`, `GENERO SINTETICO ${cod}`, gi, unidade, situacao, agora],
        );
      const generoAtivo = await genero('ARROZ', 'ativo');
      const generoInativo = await genero('VELHO', 'inativo');
      const grupo = await e.inserir(
        'INSERT INTO grupo_alimento (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-CER`, `Cereais sintéticos ${P}`, agora],
      );
      const nutriente = (cod: string, desc: string, tipo: string, un: string, ordem: number) =>
        e.inserir(
          `INSERT INTO nutriente_referencia (codigo_infoods, descricao, tipo, simbolo_unidade, ordem_exibicao,
             vigencia_inicio, versao_fonte, criado_em) VALUES (?, ?, ?, ?, ?, '2026-01-01', 'sintetica', ?)`,
          [`${P}_${cod}`, desc, tipo, un, ordem, agora],
        );
      const kcal = await nutriente('KCAL', 'Energia sintética', 'energia', 'kcal', 1);
      const prot = await nutriente('PROT', 'Proteína sintética', 'macronutriente', 'g', 2);
      const alimento_ = (cod: string, desc: string, fim: string | null) =>
        e.inserir(
          `INSERT INTO alimento_referencia (fonte_composicao, codigo_fonte, descricao, grupo_alimento_id, energia_kcal,
             vigencia_inicio, vigencia_fim, versao_fonte, criado_em) VALUES ('propria', ?, ?, ?, 360, '2026-01-01', ?, 'sint-1', ?)`,
          [`${P}-${cod}`, desc, grupo, fim, agora],
        );
      const alimento = await alimento_('1', `Arroz sintético cozido ${P}`, null);
      const encerrado = await alimento_('2', `Arroz sintético antigo ${P}`, '2026-06-30');
      const linha = (al: number, n: number, q: number, fim: string | null) =>
        e.inserir(
          `INSERT INTO alimento_referencia_nutriente (alimento_referencia_id, nutriente_referencia_id, quantidade_100g,
             vigencia_inicio, vigencia_fim, versao_fonte, criado_em) VALUES (?, ?, ?, '2026-01-01', ?, ?, ?)`,
          [al, n, q, fim, fim ? 'sint-0' : 'sint-1', agora],
        );
      await linha(alimento, kcal, 128.3, null);
      await linha(alimento, prot, 2.54, null);
      await linha(alimento, prot, 9.99, '2026-06-30');
      await linha(encerrado, kcal, 1, null);
      return { usuario, generoAtivo, generoInativo, grupo, alimento, encerrado };
    });
    porta = new PortaComposicaoPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('busca só o alimento vigente, pela descrição e pelo código, e lista o grupo', async () => {
    const pelaDescricao = await porta.alimentos(ctx(), `arroz sintético ${P}`, null);
    expect(pelaDescricao.map((a) => a.id)).toEqual([m.alimento]);
    expect(pelaDescricao[0]).toMatchObject({ fonte: 'propria', codigo: `${P}-1`, energiaKcal: 360 });
    expect((await porta.alimentos(ctx(), `${P}-1`, null)).map((a) => a.id)).toEqual([m.alimento]);
    expect((await porta.alimentos(ctx(), '', m.grupo)).map((a) => a.id)).toEqual([m.alimento]);
    expect((await porta.grupos(ctx())).some((g) => g.id === m.grupo)).toBe(true);
  });

  it('detalha os nutrientes vigentes por 100 g e na porção; recusa a porção fora da faixa', async () => {
    const a = await porta.alimento(ctx(), m.alimento, 150);
    expect(a.nutrientes.map((n) => [n.codigo, n.quantidade100g, n.quantidadePorcao])).toEqual([
      [`${P}_KCAL`, 128.3, 192],
      [`${P}_PROT`, 2.54, 3.8],
    ]);
    expect(a).toMatchObject({ fonteNome: 'Própria', edicao: 'sint-1', genero: null, porcao: 150 });
    await expect(porta.alimento(ctx(), m.alimento, 0)).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(porta.alimento(ctx(), m.encerrado, 100)).rejects.toMatchObject({
      problema: { status: 404 },
    });
  });

  it('liga o gênero com a versão lida, só na ligação, com a trilha; recusa sem escrita', async () => {
    const antes = await alimentoNoBanco(m.alimento);
    await expect(
      porta.ligarGenero(ctx(), m.alimento, { genero: m.generoInativo, versao: Number(antes?.['versao']) }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.ligarGenero(ctx(), m.encerrado, { genero: m.generoAtivo, versao: 1 }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(porta.ligarGenero(ctx(), m.alimento, { genero: 'x', versao: 1 })).rejects.toMatchObject({
      problema: { status: 400 },
    });
    expect(await alimentoNoBanco(m.alimento)).toEqual(antes);

    const r = await porta.ligarGenero(ctx(), m.alimento, {
      genero: m.generoAtivo,
      versao: Number(antes?.['versao']),
    });
    expect(r).toMatchObject({ alimento: m.alimento, genero: m.generoAtivo });
    const depois = await alimentoNoBanco(m.alimento);
    expect(depois).toMatchObject({
      descricao: antes?.['descricao'],
      kcal: antes?.['kcal'],
      versao_fonte: 'sint-1',
      versao: Number(antes?.['versao']) + 1,
    });
    expect(Number(depois?.['insumo_id'])).toBe(m.generoAtivo);
    expect(Number(depois?.['alterado_por'])).toBe(m.usuario);
    expect((await porta.alimento(ctx(), m.alimento, 100)).genero).toMatchObject({
      id: m.generoAtivo,
      codigo: `${P}-ARROZ`,
    });

    await expect(
      porta.ligarGenero(ctx(), m.alimento, { genero: null, versao: Number(antes?.['versao']) }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await porta.ligarGenero(ctx(), m.alimento, { genero: null, versao: Number(depois?.['versao']) });
    expect((await alimentoNoBanco(m.alimento))?.['insumo_id']).toBeNull();

    const trilha = await ler('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE usuario_id = ?', [m.usuario]);
    expect(Number(trilha[0]?.['n'])).toBeGreaterThanOrEqual(2);
  });
});
