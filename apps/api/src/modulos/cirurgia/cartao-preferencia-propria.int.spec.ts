// Contrato de efeito do cartão de preferência do cirurgião (F8, 04-CC linha 105) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: estabelecimento com o código do teste (sessão e trilha) e um procedimento cirúrgico fictício;
// usuário, profissionais, produto do estoque e posição cirúrgica são ids já existentes do cliente de teste (só lidos).
// Prova o que fica no banco: o cartão e os itens em sequência, o repetido recusado (409) sem linha nova, a validação do
// domínio (422) antes do banco, a alteração com a versão +1 (item mantido no lugar, retirado marcado excluído e o novo
// no fim), o cartão de outro cirurgião recusado sem a gestão do bloco (403), tirar de uso sem apagar e o cartão
// aplicável (o do procedimento ganha do geral) com a sugestão do mapa e os produtos do gasto de sala.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaCartaoPreferenciaPropria } from './cartao-preferencia-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c1012cp';

interface Massa {
  usuario: number;
  meu: number | null;
  outro: number;
  proc: number;
  insumo: number;
  insumo2: number;
  posicao: number | null;
  salaAlheia: number | null;
}

async function limpar(e: Escritor): Promise<void> {
  const est = 'SELECT id FROM estabelecimento WHERE codigo = ?';
  await e.executar(
    `DELETE i FROM cartao_preferencia_cirurgiao_item i
       JOIN cartao_preferencia_cirurgiao c ON c.id = i.cartao_preferencia_cirurgiao_id
      WHERE c.estabelecimento_id = (${est})`,
    [P],
  );
  await e.executar(`DELETE FROM cartao_preferencia_cirurgiao WHERE estabelecimento_id = (${est})`, [P]);
  await e.executar('DELETE FROM procedimento_cirurgico WHERE codigo = ?', [`${P}-PC`]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaCartaoPreferenciaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCartaoPreferenciaPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const gestor = { gestor: true };
  const comum = { gestor: false };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const ligado = await e.uma(
        'SELECT usuario_id, profissional_id FROM usuario_profissional WHERE usuario_vigente_id IS NOT NULL ORDER BY id LIMIT 1',
      );
      const usuario = ligado
        ? { id: ligado['usuario_id'] }
        : await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const meu = ligado ? Number(ligado['profissional_id']) : null;
      const outro = await e.uma(
        'SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL AND id <> ?',
        [meu ?? 0],
      );
      const ins = await e.consultar('SELECT id FROM insumo WHERE excluido_em IS NULL ORDER BY id LIMIT 2');
      const pos = await e.uma('SELECT MIN(id) AS id FROM posicao_cirurgica WHERE ativo');
      const sala = await e.uma('SELECT MIN(id) AS id FROM sala_cirurgica');
      if (!usuario?.['id'] || !outro?.['id'] || ins.length < 2)
        throw new Error('O cliente de teste precisa de usuário, profissional e dois produtos do estoque.');
      await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const proc = await e.inserir(
        'INSERT INTO procedimento_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-PC`, 'PROCEDIMENTO SINTETICO C1012', agora],
      );
      return {
        usuario: Number(usuario['id']),
        meu,
        outro: Number(outro['id']),
        proc,
        insumo: Number(ins[0]!['id']),
        insumo2: Number(ins[1]!['id']),
        posicao: pos?.['id'] ? Number(pos['id']) : null,
        salaAlheia: sala?.['id'] ? Number(sala['id']) : null,
      };
    });
    porta = new PortaCartaoPreferenciaPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  const cartao = (extra: Record<string, unknown> = {}) => ({
    cirurgiao: m.outro,
    procedimento: m.proc,
    posicao: m.posicao,
    tempoMinutos: 90,
    tamanhoLuva: '7.5',
    preparoPele: 'Clorexidina alcoólica',
    itens: [
      { natureza: 'material', insumo: m.insumo, quantidade: 2 },
      { natureza: 'fio', descricao: 'Poliglactina 3-0', quantidade: 3 },
      { natureza: 'outro', descricao: 'Coxim de gel', quantidade: 1 },
    ],
    ...extra,
  });
  const itensVivos = (cartaoId: number) =>
    ler(
      `SELECT sequencia, natureza, insumo_id, descricao, quantidade, excluido_em, excluido_por
         FROM cartao_preferencia_cirurgiao_item WHERE cartao_preferencia_cirurgiao_id = ? ORDER BY sequencia`,
      [cartaoId],
    );

  it('inclui com itens em sequência, recusa repetido e inválido, altera itens sem apagar e tira de uso', async () => {
    const a = await porta.incluir(ctx(), cartao(), gestor);
    const [c1] = await ler(
      `SELECT cirurgiao_profissional_id, procedimento_cirurgico_id, tempo_realizacao_minutos, tamanho_luva, ativo,
              versao, criado_por, estabelecimento_id = (SELECT id FROM estabelecimento WHERE codigo = ?) AS do_est
         FROM cartao_preferencia_cirurgiao WHERE id = ?`,
      [P, a.id],
    );
    expect([
      Number(c1!['cirurgiao_profissional_id']),
      Number(c1!['procedimento_cirurgico_id']),
      Number(c1!['tempo_realizacao_minutos']),
      c1!['tamanho_luva'],
      Number(c1!['ativo']),
      Number(c1!['versao']),
      Number(c1!['criado_por']),
      Number(c1!['do_est']),
    ]).toEqual([m.outro, m.proc, 90, '7,5', 1, 1, m.usuario, 1]);
    expect((await itensVivos(a.id)).map((i) => [Number(i['sequencia']), i['natureza']])).toEqual([
      [1, 'material'],
      [2, 'fio'],
      [3, 'outro'],
    ]);

    await expect(porta.incluir(ctx(), cartao(), gestor)).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(
      porta.incluir(ctx(), cartao({ procedimento: null, tempoMinutos: 2 }), gestor),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.incluir(
        ctx(),
        cartao({
          procedimento: null,
          itens: [{ natureza: 'instrumental', insumo: m.insumo, quantidade: 1 }],
        }),
        gestor,
      ),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    if (m.salaAlheia !== null)
      await expect(
        porta.incluir(ctx(), cartao({ procedimento: null, sala: m.salaAlheia }), gestor),
      ).rejects.toMatchObject({ problema: { status: 404 } });
    const [n] = await ler(
      'SELECT COUNT(*) AS n FROM cartao_preferencia_cirurgiao WHERE cirurgiao_profissional_id = ? AND estabelecimento_id = (SELECT id FROM estabelecimento WHERE codigo = ?)',
      [m.outro, P],
    );
    expect(Number(n!['n'])).toBe(1);

    // Altera: o material muda de quantidade (no lugar), o fio sai (marcado excluído), entra outro produto no fim.
    await porta.alterar(
      ctx(),
      a.id,
      cartao({
        tempoMinutos: 120,
        versao: 1,
        itens: [
          { natureza: 'material', insumo: m.insumo, quantidade: 4 },
          { natureza: 'outro', descricao: 'Coxim de gel', quantidade: 1 },
          { natureza: 'medicamento', insumo: m.insumo2, quantidade: 1 },
        ],
      }),
      gestor,
    );
    const [c2] = await ler(
      'SELECT tempo_realizacao_minutos, versao FROM cartao_preferencia_cirurgiao WHERE id = ?',
      [a.id],
    );
    expect([Number(c2!['tempo_realizacao_minutos']), Number(c2!['versao'])]).toEqual([120, 2]);
    const its = await itensVivos(a.id);
    expect(
      its.map((i) => [Number(i['sequencia']), Number(i['quantidade']), i['excluido_em'] !== null]),
    ).toEqual([
      [1, 4, false],
      [2, 3, true],
      [3, 1, false],
      [4, 1, false],
    ]);
    expect(Number(its[1]!['excluido_por'])).toBe(m.usuario);
    // Versão velha: conflito, nada muda.
    await expect(porta.alterar(ctx(), a.id, cartao({ versao: 1 }), gestor)).rejects.toBeTruthy();

    await porta.definirUso(ctx(), a.id, { ativo: false, versao: 2 }, gestor);
    const [c3] = await ler('SELECT ativo, versao FROM cartao_preferencia_cirurgiao WHERE id = ?', [a.id]);
    expect([Number(c3!['ativo']), Number(c3!['versao'])]).toEqual([0, 3]);
    const lidos = await porta.listar(ctx(), { cirurgiao: m.outro });
    expect(lidos.map((x) => [x.id, x.ativo, x.itens.length])).toEqual([[a.id, false, 3]]);

    const [tr] = await ler(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = (SELECT id FROM estabelecimento WHERE codigo = ?)',
      [P],
    );
    expect(Number(tr!['n'])).toBeGreaterThanOrEqual(3);
    await porta.definirUso(ctx(), a.id, { ativo: true, versao: 3 }, gestor);
  });

  it('cartão de outro cirurgião só com a gestão; aplicável: o do procedimento ganha do geral, com mapa e gasto', async () => {
    await expect(porta.incluir(ctx(), cartao({ procedimento: null }), comum)).rejects.toMatchObject({
      problema: { status: 403 },
    });
    const geral = await porta.incluir(
      ctx(),
      cartao({
        procedimento: null,
        tempoMinutos: 60,
        itens: [{ natureza: 'material', insumo: m.insumo2, quantidade: 1 }],
      }),
      gestor,
    );
    const doProc = await porta.aplicavel(ctx(), m.outro, m.proc);
    expect(doProc.cartao?.procedimento).toBe(m.proc);
    expect(doProc.mapa).toEqual({ sala: null, tempoMinutos: 120, posicao: m.posicao });
    expect(doProc.gasto.map((g) => [g.insumo, g.quantidade])).toEqual([
      [m.insumo, 4],
      [m.insumo2, 1],
    ]);
    const semProc = await porta.aplicavel(ctx(), m.outro, null);
    expect([semProc.cartao?.id, semProc.mapa?.tempoMinutos]).toEqual([geral.id, 60]);
    const nenhum = await porta.aplicavel(ctx(), m.usuario + 999_999, m.proc);
    expect(nenhum).toEqual({ cartao: null, mapa: null, gasto: [] });

    if (m.meu !== null) {
      const meu = await porta.incluir(ctx(), cartao({ cirurgiao: m.meu, procedimento: null }), comum);
      await porta.definirUso(ctx(), meu.id, { ativo: false, versao: 1 }, comum);
      const [lm] = await ler('SELECT ativo FROM cartao_preferencia_cirurgiao WHERE id = ?', [meu.id]);
      expect(Number(lm!['ativo'])).toBe(0);
    }
  });
});
