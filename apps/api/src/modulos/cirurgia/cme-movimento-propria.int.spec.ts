// Contrato de efeito do fluxo do material esterilizado entre a CME e os setores (F7, 04-CME linha 117) contra o
// MariaDB real (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, setores funcionais (CME,
// setor de destino e outro), método, caixa, equipamento e três pacotes esterilizados por um ciclo liberado; usuário,
// produto e unidade são ids já existentes do cliente de teste (só os ids são lidos).
// Prova o que fica no banco: a CME recebe a solicitação (recebida_cme com quem e quando; de novo, 422); o cancelamento
// sem motivo é recusado e com motivo cancela a solicitação e os itens (nada apagado); a entrega além da quantidade
// pedida é recusada sem escrita; a entrega parcial grava o movimento com a solicitação, o pacote distribuído e a
// quantidade atendida, e a segunda completa a solicitação (entregue, com quem e quando); a permissão por setor sem o
// expurgo recusa o recolhimento e a gravação de novo altera a mesma linha; o recolhimento volta o pacote íntegro ao
// arsenal e descarta o sem integridade; o pacote que está na CME não é recolhido; o setor confere o movimento (itens
// conferidos; de novo, 422); tudo na trilha; outro estabelecimento não enxerga o movimento (404).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaCmeMovimentoPropria } from './cme-movimento-propria.js';
import { PortaCmePropria } from './cme-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const P = 'c3015cme';
const P2 = `${P}b`;

interface Massa {
  usuario: number;
  est: number;
  metodo: number;
  insumo: number;
  unidade: number;
  cme: number;
  destino: number;
  outro: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(
    `DELETE mi FROM movimento_material_esteril_item mi JOIN movimento_material_esteril m
        ON m.id = mi.movimento_material_esteril_id WHERE m.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM movimento_material_esteril WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(
    `DELETE i FROM solicitacao_material_esteril_item i JOIN solicitacao_material_esteril s
        ON s.id = i.solicitacao_material_esteril_id WHERE s.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM solicitacao_material_esteril WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(
    `DELETE i FROM ciclo_esterilizacao_item i JOIN ciclo_esterilizacao c ON c.id = i.ciclo_esterilizacao_id
      WHERE c.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(
    `DELETE x FROM pacote_esteril_conteudo x JOIN pacote_esteril p ON p.id = x.pacote_esteril_id
      WHERE p.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM pacote_esteril WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM ciclo_esterilizacao WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM equipamento_esterilizacao WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(
    `DELETE i FROM caixa_instrumental_item i JOIN caixa_instrumental c ON c.id = i.caixa_instrumental_id
      WHERE c.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM caixa_instrumental WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(
    `DELETE p FROM permissao_setor_cme p JOIN setor_funcional s ON s.id = p.setor_funcional_id
      WHERE s.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar('DELETE FROM metodo_esterilizacao WHERE codigo = ?', [`${P}-VAP`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaCmeMovimentoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let cme: PortaCmePropria;
  let porta: PortaCmeMovimentoPropria;
  let m: Massa;
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const um = async (sql: string, p: unknown[] = []) => (await ler(sql, p))[0] ?? {};
  const erro = async (pr: Promise<unknown>) => {
    try {
      await pr;
    } catch (e) {
      const x = e as { problema?: { status?: number } };
      return x.problema?.status;
    }
    throw new Error('Esperava recusa.');
  };
  const trilha = async (entidade: string, id: number) =>
    Number(
      (
        await um(
          `SELECT COUNT(*) AS n FROM trilha_auditoria t JOIN estabelecimento e ON e.id = t.estabelecimento_id
            WHERE e.codigo = ? AND t.entidade = ? AND t.entidade_id = ?`,
          [P, entidade, id],
        )
      )['n'],
    );
  const movimentos = async () =>
    Number(
      (
        await um('SELECT COUNT(*) AS n FROM movimento_material_esteril WHERE estabelecimento_id = ?', [m.est])
      )['n'],
    );
  const situacaoPacote = async (id: number) =>
    String((await um('SELECT situacao FROM pacote_esteril WHERE id = ?', [id]))['situacao']);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    cme = new PortaCmePropria(nucleo, CLIENTE);
    porta = new PortaCmeMovimentoPropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const insumo = await e.uma('SELECT MIN(id) AS id FROM insumo WHERE excluido_em IS NULL');
      const unidade = await e.uma('SELECT MIN(id) AS id FROM unidade_assistencial');
      if (!usuario?.['id'] || !insumo?.['id'] || !unidade?.['id'])
        throw new Error('O cliente de teste precisa de usuário, produto e unidade.');
      const novoEst = (c: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [c, `Hospital sintético ${c}`, `Hospital sintético ${c} (fictício)`, agora],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      const setor = (codigo: string, tipo: string) =>
        e.inserir(
          'INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ?, ?)',
          [est, `${P}-${codigo}`, `SETOR SINTETICO ${codigo}`, tipo, agora],
        );
      const metodo = await e.inserir(
        "INSERT INTO metodo_esterilizacao (codigo, descricao, categoria, criado_em) VALUES (?, ?, 'esterilizacao', ?)",
        [`${P}-VAP`, `VAPOR SINTETICO ${P}`, agora],
      );
      return {
        usuario: Number(usuario['id']),
        est,
        metodo,
        insumo: Number(insumo['id']),
        unidade: Number(unidade['id']),
        cme: await setor('CME', 'apoio_tecnico'),
        destino: await setor('UTI', 'assistencial'),
        outro: await setor('PS', 'assistencial'),
      };
    });
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  let caixa = 0;
  const pacotes: number[] = [];
  let sol = 0;
  let sol2 = 0;
  let entrega = 0;
  let recolhimento = 0;

  it('prepara três pacotes estéreis da caixa por um ciclo liberado', async () => {
    caixa = (
      await cme.criarCaixa(ctx(), {
        codigo: 'CX-CURATIVO',
        descricao: 'Caixa de curativo sintética',
        validadeDias: 30,
        metodo: m.metodo,
        itens: [{ insumo: m.insumo, quantidade: 3, pecaMestre: true }],
      })
    ).caixa;
    const equipamento = (
      await cme.criarEquipamento(ctx(), {
        codigo: 'AC1',
        descricao: 'Autoclave sintética',
        natureza: 'autoclave',
        metodo: m.metodo,
      })
    ).equipamento;
    for (let i = 0; i < 3; i++) pacotes.push((await cme.prepararPacote(ctx(), { caixa })).pacote);
    const ciclo = (await cme.abrirCiclo(ctx(), { equipamento, metodo: m.metodo, pacotes })).ciclo;
    const versao = Number(
      (await um('SELECT versao FROM ciclo_esterilizacao WHERE id = ?', [ciclo]))['versao'],
    );
    const r = await cme.concluirCiclo(ctx(), ciclo, {
      versao,
      temperatura: 134,
      tempoExposicao: 5,
      fisico: 'conforme',
      quimico: 'conforme',
      biologico: 'conforme',
    });
    expect(r.situacao).toBe('liberado');
    for (const p of pacotes) expect(await situacaoPacote(p)).toBe('esteril');
  });

  it('a CME recebe a solicitação aberta e o cancelamento pede motivo', async () => {
    sol = (await cme.solicitar(ctx(), { tipo: 'setor', setor: m.unidade, itens: [{ caixa, quantidade: 2 }] }))
      .solicitacao;
    sol2 = (
      await cme.solicitar(ctx(), { tipo: 'setor', setor: m.unidade, itens: [{ caixa, quantidade: 1 }] })
    ).solicitacao;
    expect((await porta.receber(ctx(), sol)).situacao).toBe('recebida_cme');
    const s = await um(
      'SELECT situacao, recebido_cme_em, recebido_cme_usuario_id FROM solicitacao_material_esteril WHERE id = ?',
      [sol],
    );
    expect([s['situacao'], Number(s['recebido_cme_usuario_id']), !!s['recebido_cme_em']]).toEqual([
      'recebida_cme',
      m.usuario,
      true,
    ]);
    expect(await erro(porta.receber(ctx(), sol))).toBe(422);
    expect(await erro(porta.cancelar(ctx(), sol2, { motivo: 'x' }))).toBe(422);
    expect(
      (await um('SELECT situacao FROM solicitacao_material_esteril WHERE id = ?', [sol2]))['situacao'],
    ).toBe('aberta');
    await porta.cancelar(ctx(), sol2, { motivo: 'Paciente transferido' });
    const c = await um(
      `SELECT s.situacao, s.motivo_cancelamento, s.cancelado_usuario_id, i.situacao AS item, s.excluido_em
         FROM solicitacao_material_esteril s JOIN solicitacao_material_esteril_item i
           ON i.solicitacao_material_esteril_id = s.id WHERE s.id = ?`,
      [sol2],
    );
    expect([
      c['situacao'],
      c['motivo_cancelamento'],
      Number(c['cancelado_usuario_id']),
      c['item'],
      c['excluido_em'],
    ]).toEqual(['cancelada', 'Paciente transferido', m.usuario, 'cancelado', null]);
    expect(await trilha('solicitacao_material_esteril', sol)).toBeGreaterThan(0);
  });

  it('entrega ao setor em duas vezes; além do pedido, recusa sem escrita', async () => {
    const base = { solicitacao: sol, cme: m.cme, setor: m.destino };
    expect(await erro(porta.entregarAoSetor(ctx(), { ...base, pacotes }))).toBe(422);
    expect(await movimentos()).toBe(0);
    expect(await situacaoPacote(pacotes[0]!)).toBe('esteril');
    const r1 = await porta.entregarAoSetor(ctx(), { ...base, pacotes: [pacotes[0]!] });
    entrega = r1.movimento;
    expect(r1.solicitacao).toBe('parcial');
    const mv = await um(
      'SELECT tipo, situacao, solicitacao_material_esteril_id AS s, setor_funcional_id AS d, responsavel_usuario_id AS u FROM movimento_material_esteril WHERE id = ?',
      [entrega],
    );
    expect([mv['tipo'], mv['situacao'], Number(mv['s']), Number(mv['d']), Number(mv['u'])]).toEqual([
      'entrega',
      'aberto',
      sol,
      m.destino,
      m.usuario,
    ]);
    const it1 = await um(
      'SELECT situacao, quantidade_atendida AS q, pacote_esteril_id AS p FROM solicitacao_material_esteril_item WHERE solicitacao_material_esteril_id = ?',
      [sol],
    );
    expect([it1['situacao'], Number(it1['q']), Number(it1['p'])]).toEqual(['pendente', 1, pacotes[0]]);
    expect(await situacaoPacote(pacotes[0]!)).toBe('distribuido');
    const r2 = await porta.entregarAoSetor(ctx(), { ...base, pacotes: [pacotes[1]!] });
    expect(r2.solicitacao).toBe('entregue');
    const s = await um(
      `SELECT s.situacao, s.entregue_usuario_id AS u, i.situacao AS item, i.quantidade_atendida AS q
         FROM solicitacao_material_esteril s JOIN solicitacao_material_esteril_item i
           ON i.solicitacao_material_esteril_id = s.id WHERE s.id = ?`,
      [sol],
    );
    expect([s['situacao'], Number(s['u']), s['item'], Number(s['q'])]).toEqual([
      'entregue',
      m.usuario,
      'entregue',
      2,
    ]);
    expect(
      Number(
        (
          await um(
            'SELECT COUNT(*) AS n FROM movimento_material_esteril_item WHERE pacote_esteril_id IN (?, ?)',
            [pacotes[0], pacotes[1]],
          )
        )['n'],
      ),
    ).toBe(2);
    expect(await trilha('movimento_material_esteril', entrega)).toBeGreaterThan(0);
  });

  it('a permissão por setor sem expurgo recusa o recolhimento; gravar de novo altera a mesma linha', async () => {
    const outro = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL AND id <> ?', [
      m.usuario,
    ]);
    if (!outro['id']) throw new Error('O cliente de teste precisa de dois usuários.');
    const gestor = { ...ctx(), usuario: Number(outro['id']) };
    const contar = () =>
      um('SELECT COUNT(*) AS n FROM permissao_setor_cme WHERE usuario_id = ?', [m.usuario]).then((r) =>
        Number(r['n']),
      );
    const antes = await contar();
    expect(
      await erro(porta.gravarPermissao(ctx(), { usuario: m.usuario, setor: m.destino, expurgo: true })),
    ).toBe(422);
    expect(await contar()).toBe(antes);
    const p1 = await porta.gravarPermissao(gestor, {
      usuario: m.usuario,
      setor: m.destino,
      saidaArsenal: true,
    });
    const recolher = { cme: m.cme, setor: m.destino, pacotes: [{ pacote: pacotes[0]!, integro: true }] };
    expect(await erro(porta.recolher(ctx(), recolher))).toBe(422);
    expect(
      await erro(
        porta.entregarAoSetor(ctx(), {
          solicitacao: sol,
          cme: m.cme,
          setor: m.outro,
          pacotes: [pacotes[2]!],
        }),
      ),
    ).toBe(422);
    const p2 = await porta.gravarPermissao(gestor, {
      usuario: m.usuario,
      setor: m.destino,
      saidaArsenal: true,
      expurgo: true,
    });
    expect(p2.permissao).toBe(p1.permissao);
    const linha = await um(
      'SELECT COUNT(*) AS n, MAX(pode_expurgo) AS e, MAX(pode_saida_arsenal) AS s FROM permissao_setor_cme WHERE usuario_id = ? AND setor_funcional_id = ?',
      [m.usuario, m.destino],
    );
    expect([Number(linha['n']), Number(linha['e']), Number(linha['s'])]).toEqual([1, 1, 1]);
    const painel = await porta.painel(ctx());
    expect(painel.permissoes.map((x) => [x.setor, x.expurgo])).toEqual([[m.destino, true]]);
    expect(await trilha('permissao_setor_cme', p1.permissao)).toBeGreaterThan(0);
  });

  it('recolhe: o íntegro volta ao arsenal, o sem integridade é descartado; o que está na CME é recusado', async () => {
    expect(
      await erro(
        porta.recolher(ctx(), {
          cme: m.cme,
          setor: m.destino,
          pacotes: [{ pacote: pacotes[2]!, integro: true }],
        }),
      ),
    ).toBe(422);
    const r = await porta.recolher(ctx(), {
      cme: m.cme,
      setor: m.destino,
      pacotes: [
        { pacote: pacotes[0]!, integro: true },
        { pacote: pacotes[1]!, integro: false },
      ],
    });
    recolhimento = r.movimento;
    expect([r.arsenal, r.expurgo]).toEqual([1, 1]);
    expect([await situacaoPacote(pacotes[0]!), await situacaoPacote(pacotes[1]!)]).toEqual([
      'esteril',
      'descartado',
    ]);
    const mv = await um(
      `SELECT m.tipo, m.setor_funcional_id AS d, COUNT(i.id) AS n FROM movimento_material_esteril m
         JOIN movimento_material_esteril_item i ON i.movimento_material_esteril_id = m.id WHERE m.id = ? GROUP BY m.id`,
      [recolhimento],
    );
    expect([mv['tipo'], Number(mv['d']), Number(mv['n'])]).toEqual(['recolhimento', m.destino, 2]);
  });

  it('o setor confere o movimento; outro estabelecimento não o enxerga', async () => {
    expect(await erro(porta.conferir(ctx(P2), entrega))).toBe(404);
    await porta.conferir(ctx(), entrega);
    const mv = await um(
      'SELECT situacao, conferido_por_usuario_id AS u, conferido_em FROM movimento_material_esteril WHERE id = ?',
      [entrega],
    );
    expect([mv['situacao'], Number(mv['u']), !!mv['conferido_em']]).toEqual(['conferido', m.usuario, true]);
    expect(
      Number(
        (
          await um(
            'SELECT COUNT(*) AS n FROM movimento_material_esteril_item WHERE movimento_material_esteril_id = ? AND conferido = TRUE',
            [entrega],
          )
        )['n'],
      ),
    ).toBe(1);
    expect(await erro(porta.conferir(ctx(), entrega))).toBe(422);
    const painel = await porta.painel(ctx());
    expect(painel.movimentos.map((x) => x.tipo).sort()).toEqual(['entrega', 'entrega', 'recolhimento']);
    expect(painel.arsenal.map((x) => x.id).sort()).toEqual([pacotes[0], pacotes[2]].sort());
    expect(painel.setores).toHaveLength(3);
  });
});
