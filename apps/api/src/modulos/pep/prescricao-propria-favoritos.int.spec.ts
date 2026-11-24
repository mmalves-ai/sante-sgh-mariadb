// Contrato de efeito dos favoritos do prescritor no banco próprio (03-PEP L107), contra o MariaDB real (cliente de
// teste f22_o5): marcar inclui a linha em favorito_prescritor do profissional da sessão; o mesmo alvo ativo é recusado
// (409) sem gravar; desmarcar deixa ativo = false sem apagar; marcar de novo reativa a mesma linha; o favorito de
// outro profissional não é desmarcado (404); cada gravação vai à trilha. Massa SINTÉTICA (prefixo l107fv), montada
// no beforeAll e apagada no início e no fim (a trilha pelo utilitário comum). SGH_NUCLEO_SEM_BANCO=1 pula.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GravacaoPrescricaoPropria } from './prescricao-propria-gravacao.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';

const CLIENTE = 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l107fv';
const c = {
  cliente: CLIENTE,
  estabelecimento: null,
  usuario: null,
  correlacao: P,
  rede: 'rede-teste',
  hospital: P,
};

interface Massa {
  readonly est: number;
  readonly prof: number;
  readonly outroProf: number;
  readonly item1: number;
  readonly item2: number;
}

async function limpar(e: Escritor): Promise<void> {
  await limparTrilhaDaMassa(e, { codigos: [P] });
  const profs = '(SELECT id FROM profissional WHERE nome_exibicao LIKE ?)';
  await e.executar(`DELETE FROM favorito_prescritor WHERE profissional_id IN ${profs}`, [`${P} %`]);
  await e.executar(
    'DELETE FROM idempotencia_operacao WHERE estabelecimento_id IN (SELECT id FROM estabelecimento WHERE codigo = ?)',
    [P],
  );
  await e.executar(
    'DELETE up FROM usuario_profissional up JOIN usuario u ON u.id = up.usuario_id WHERE u.login LIKE ?',
    [`${P}%`],
  );
  await e.executar('DELETE FROM usuario WHERE login LIKE ?', [`${P}%`]);
  await e.executar(`DELETE FROM inscricao_conselho WHERE profissional_id IN ${profs}`, [`${P} %`]);
  await e.executar('DELETE FROM profissional WHERE nome_exibicao LIKE ?', [`${P} %`]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`${P} %`]);
  await e.executar('DELETE FROM item_prescritivel WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar('DELETE FROM tipo_item_prescricao WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

async function montar(nucleo: NucleoProprio): Promise<Massa> {
  return nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
    await e.executar('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await limpar(e);
      const agora = new Date();
      const ins = (sql: string, p: unknown[]) => e.inserir(sql, [...p, agora]);
      const est = await ins(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital sintético', 'Hospital sintético (fictício)', 'America/Sao_Paulo', ?)`,
        [P],
      );
      const ocup = await e.uma<{ id: unknown }>(
        "SELECT id FROM ocupacao_cbo WHERE codigo_cbo REGEXP '^2251[0-9]+$' ORDER BY id LIMIT 1",
      );
      const profissional = async (n: string, login: string) => {
        const pf = await ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [`${P} ${n}`]);
        const prof = await ins(
          `INSERT INTO profissional (pessoa_fisica_id, tipo, nome_exibicao, criado_em) VALUES (?, 'corpo_clinico', ?, ?)`,
          [pf, `${P} ${n}`],
        );
        await ins(
          `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
             numero_inscricao, ocupacao_cbo_id, principal, situacao, criado_em)
           VALUES (?, 1, 1, 1, ?, ?, TRUE, 'ativa', ?)`,
          [prof, `107${login.length}${n.length}`, ocup?.id],
        );
        const u = await ins(
          `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Usuário sintético', 'servico', ?)`,
          [login],
        );
        await ins(
          `INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, '2026-01-01', ?)`,
          [u, prof],
        );
        return prof;
      };
      const prof = await profissional('Prescritor', `${P}med`);
      const outroProf = await profissional('Outro', `${P}out`);
      const tipo = await ins(
        `INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, 'Medicamento sintético', 'medicamento', ?)`,
        [`${P}t`],
      );
      const item = (n: number) =>
        ins(
          `INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, criado_em) VALUES (?, ?, ?, ?)`,
          [`${P}${n}`, `Produto sintético ${n}`, tipo],
        );
      return { est, prof, outroProf, item1: await item(1), item2: await item(2) };
    } finally {
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

describe.skipIf(SEM_BANCO)('favoritos do prescritor no banco próprio (integração, 03-PEP L107)', () => {
  let nucleo: NucleoProprio;
  let m: Massa;
  let porta: GravacaoPrescricaoPropria;
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await montar(nucleo);
    porta = new GravacaoPrescricaoPropria(nucleo, CLIENTE);
  }, 120_000);
  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await limpar(e);
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    await nucleo.encerrar();
  });

  it('marca, recusa o duplicado, desmarca sem apagar e reativa a mesma linha; tudo na trilha', async () => {
    const id1 = await porta.marcarFavorito(c, `${P}med`, {
      tipo: 'item_prescritivel',
      alvo: m.item1,
      rotulo: null,
      ordem: 2,
    });
    await porta.marcarFavorito(c, `${P}med`, {
      tipo: 'item_prescritivel',
      alvo: m.item2,
      rotulo: 'Meu atalho',
      ordem: 1,
    });
    const linha = await ler(
      'SELECT profissional_id, estabelecimento_id, tipo_favorito, item_prescritivel_id, ativo, criado_por FROM favorito_prescritor WHERE id = ?',
      [id1],
    );
    expect(linha[0]).toMatchObject({ tipo_favorito: 'item_prescritivel' });
    expect(Number(linha[0]!['profissional_id'])).toBe(m.prof);
    expect(Number(linha[0]!['estabelecimento_id'])).toBe(m.est);
    expect(Number(linha[0]!['item_prescritivel_id'])).toBe(m.item1);
    expect(Number(linha[0]!['ativo'])).toBe(1);
    expect(linha[0]!['criado_por']).not.toBeNull();

    // Lista na ordem do prescritor, com o nome do cadastro quando não há rótulo.
    const lista = await porta.favoritos(c, `${P}med`);
    expect(lista.map((f) => f.rotulo)).toEqual(['Meu atalho', 'Produto sintético 1']);

    // O mesmo alvo ativo: 409 e nenhuma linha a mais.
    await expect(
      porta.marcarFavorito(c, `${P}med`, {
        tipo: 'item_prescritivel',
        alvo: m.item1,
        rotulo: null,
        ordem: null,
      }),
    ).rejects.toMatchObject({ problema: { codigo: 'favorito-duplicado' } });
    const contar = async () =>
      Number(
        (await ler('SELECT COUNT(*) AS n FROM favorito_prescritor WHERE profissional_id = ?', [m.prof]))[0]?.[
          'n'
        ],
      );
    expect(await contar()).toBe(2);

    // Outro profissional não desmarca o favorito alheio.
    await expect(porta.desmarcarFavorito(c, `${P}out`, id1)).rejects.toMatchObject({
      problema: { codigo: 'registro-inexistente' },
    });

    // Desmarcar não apaga; marcar de novo reativa a mesma linha.
    await porta.desmarcarFavorito(c, `${P}med`, id1);
    const desm = await ler('SELECT ativo, versao FROM favorito_prescritor WHERE id = ?', [id1]);
    expect(Number(desm[0]!['ativo'])).toBe(0);
    expect(await contar()).toBe(2);
    expect((await porta.favoritos(c, `${P}med`)).map((f) => f.alvo)).toEqual([m.item2]);
    const id1b = await porta.marcarFavorito(c, `${P}med`, {
      tipo: 'item_prescritivel',
      alvo: m.item1,
      rotulo: null,
      ordem: 3,
    });
    expect(id1b).toBe(id1);
    expect(await contar()).toBe(2);

    // Alvo inexistente: 404 sem gravar.
    await expect(
      porta.marcarFavorito(c, `${P}med`, {
        tipo: 'kit_prescricao',
        alvo: 999_999_999,
        rotulo: null,
        ordem: null,
      }),
    ).rejects.toMatchObject({ problema: { codigo: 'registro-inexistente' } });

    const trilha = await ler(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'favorito_prescritor' AND entidade_id = ?",
      [id1],
    );
    expect(Number(trilha[0]?.['n'])).toBeGreaterThanOrEqual(3);
  });
});
