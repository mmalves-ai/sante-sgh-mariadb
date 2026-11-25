// Contrato de efeito do custo-padrão por procedimento (07-FIN L140, C2-115) contra o MariaDB real (cliente f22_o3, que
// tem insumos, salas, acomodações e procedimentos cirúrgicos de teste). Massa SINTÉTICA: dois estabelecimentos fictícios,
// um procedimento faturável, os custos de referência (custo médio do insumo, minuto do gás, minuto de duas salas e a
// diária padrão da unidade) e, para a comparação, uma apuração com duas contas que lançaram o procedimento. Prova o que
// fica no banco: a ficha em rascunho com a versão; cada item com o custo unitário de referência (ou o informado) e o
// custo total; os totais da ficha (honorário, operacional, total) refeitos pela regra; as recusas sem linha (sem custo,
// versão velha, ficha ativa); o item retirado com a data de exclusão (a linha fica); a ativação (padrão) e a nova versão
// copiada da vigente que encerra a anterior na véspera; a inativação com motivo; a trilha por gravação; a comparação
// padrão × apurado; outro estabelecimento não vê a ficha. SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { type ContextoFichaCusto, PortaFichaCustoPadraoPropria } from './ficha-custo-padrao-propria.js';

const CLIENTE = process.env['C2115_CLIENTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const COD = 'C2115';
const INI_SALA = '2001-03-15';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    const x = e as { problema?: { codigo?: string }; codigo?: string };
    return x.problema?.codigo ?? x.codigo ?? String(e);
  }
}

describe.skipIf(SEM_BANCO)(`custo-padrão por procedimento contra o MariaDB (cliente ${CLIENTE})`, () => {
  let nucleo: NucleoProprio;
  let porta: PortaFichaCustoPadraoPropria;
  let estA = 0;
  let estB = 0;
  let proc = 0;
  let insumo = 0;
  let gas = 0;
  let salas: number[] = [];
  let procCir = 0;
  let acomodacao = 0;
  let insumoCodigo = '';
  let ctxA: ContextoFichaCusto;
  let ctxB: ContextoFichaCusto;
  const contas: number[] = [];

  const q = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c2115-conf' }, (l) =>
      l.consultar(sql, p, { teto: 1000 }),
    );
  const um = async (sql: string, p: unknown[] = []) => (await q(sql, p))[0] ?? {};
  const trilha =
    (evento: string) =>
    (r: { id: number }): RegistroTrilhaTela => ({
      estabelecimento: estA,
      usuario: null,
      acao: 'operacao',
      entidade: 'ficha_custo_padrao',
      entidadeId: r.id,
      dadosDepois: { evento, recurso: 'custos.ficha-padrao' },
      correlacao: 'teste-c2115',
    });

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c2115-limpa' }, async (e) => {
      const ests = [estA, estB].filter(Boolean);
      if (ests.length === 0) return;
      const em = ests.map(() => '?').join(', ');
      await e.executar(
        `DELETE x FROM ficha_custo_padrao_item x JOIN ficha_custo_padrao f ON f.id = x.ficha_custo_padrao_id WHERE f.estabelecimento_id IN (${em})`,
        ests,
      );
      await e.executar(`DELETE FROM ficha_custo_padrao WHERE estabelecimento_id IN (${em})`, ests);
      await e.executar(
        `DELETE k FROM custo_conta_paciente k JOIN apuracao_custo a ON a.id = k.apuracao_custo_id WHERE a.estabelecimento_id IN (${em})`,
        ests,
      );
      await e.executar(`DELETE FROM apuracao_custo WHERE estabelecimento_id IN (${em})`, ests);
      await e.executar(
        `DELETE i FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id IN (${em})`,
        ests,
      );
      await e.executar(`DELETE FROM conta_hospitalar WHERE estabelecimento_id IN (${em})`, ests);
      await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN (${em})`, ests);
      await e.executar(`DELETE FROM custo_medio_historico WHERE estabelecimento_id IN (${em})`, ests);
      await e.executar(`DELETE FROM custo_gas_medicinal WHERE estabelecimento_id IN (${em})`, ests);
      await e.executar(`DELETE FROM custo_sala_cirurgica WHERE estabelecimento_id IN (${em})`, ests);
      await e.executar(`DELETE FROM custo_diaria_unidade WHERE estabelecimento_id IN (${em})`, ests);
      await limparTrilhaDaMassa(e, { ids: ests });
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaFichaCustoPadraoPropria(nucleo, CLIENTE);
    const agora = new Date();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c2115-massa' }, async (e) => {
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      estA = await est('c2115a');
      estB = await est('c2115b');
    });
    await limpar();
    const ins = await q('SELECT id, codigo FROM insumo WHERE excluido_em IS NULL ORDER BY id LIMIT 2');
    insumo = Number(ins[0]!['id']);
    insumoCodigo = String(ins[0]!['codigo']);
    gas = Number(ins[1]!['id']);
    salas = (await q('SELECT id FROM sala_cirurgica ORDER BY id LIMIT 2')).map((r) => Number(r['id']));
    procCir = Number((await um('SELECT id FROM procedimento_cirurgico ORDER BY id LIMIT 1'))['id']);
    const ac = await um('SELECT id, unidade_internacao_id FROM acomodacao ORDER BY id LIMIT 1');
    acomodacao = Number(ac['id']);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c2115-massa' }, async (e) => {
      const grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [`${COD}-GF`],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, 'GRUPO C2115', 'servico_hospitalar', ?)",
        [`${COD}-GF`, agora],
      );
      proc = await garantir(
        e,
        'SELECT id FROM item_faturavel WHERE codigo = ?',
        ['99321150'],
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES ('99321150', 'PROCEDIMENTO SINTETICO C2115', 'taxa', ?, ?)",
        [grupo, agora],
      );
      // Custo médio do insumo: o mais recente vale (5,00 e depois 5,50).
      for (const [quando, custo] of [
        ['2026-01-10 10:00:00', '5.00000000'],
        ['2026-02-10 10:00:00', '5.50000000'],
      ] as const)
        await e.executar(
          `INSERT INTO custo_medio_historico (estabelecimento_id, ocorrido_em, insumo_id, tipo, quantidade_antes, custo_medio_antes, custo_medio, criado_em)
           VALUES (?, ?, ?, 'entrada', 0, 0, ?, ?)`,
          [estA, quando, insumo, custo, agora],
        );
      await e.executar(
        `INSERT INTO custo_gas_medicinal (estabelecimento_id, insumo_id, valor_custo_minuto, vigencia_inicio, criado_em)
         VALUES (?, ?, 0.25, '2020-01-01', ?)`,
        [estA, gas, agora],
      );
      // Minuto de sala: 60/h e 90/h (1,00 e 1,50 por minuto; média 1,25).
      for (const [i, sala] of salas.entries())
        await e.executar(
          `INSERT INTO custo_sala_cirurgica (estabelecimento_id, sala_cirurgica_id, vigencia_inicio, valor_hora, criado_em)
           VALUES (?, ?, ?, ?, ?)`,
          [estA, sala, INI_SALA, i === 0 ? 60 : 90, agora],
        );
      for (const [comp, valor] of [
        ['2025-06-01', 350],
        ['2026-01-01', 400],
      ] as const)
        await e.executar(
          `INSERT INTO custo_diaria_unidade (estabelecimento_id, unidade_internacao_id, competencia, tipo_custo, valor_custo_diaria, criado_em)
           VALUES (?, ?, ?, 'padrao', ?, ?)`,
          [estA, Number(ac['unidade_internacao_id']), comp, valor, agora],
        );
    });
    ctxA = {
      cliente: CLIENTE,
      hospital: 'c2115a',
      estabelecimento: estA,
      usuario: null,
      correlacao: 'teste-c2115',
    };
    ctxB = {
      cliente: CLIENTE,
      hospital: 'c2115b',
      estabelecimento: estB,
      usuario: null,
      correlacao: 'teste-c2115',
    };
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  let v1 = 0;
  let versaoV1 = 0;

  it('referências: custo médio mais recente do insumo, procedimento para abrir a ficha', async () => {
    const r = await porta.referencias(ctxA, 'insumo', insumoCodigo);
    expect(r.find((x) => x.id === insumo)?.custoUnitario).toBe(5.5);
    const p = await porta.procedimentos(ctxA, '99321150');
    expect(p.map((x) => x.id)).toContain(proc);
  });

  it('ficha em rascunho e itens com o custo de referência; totais refeitos pela regra', async () => {
    const f = await porta.criar(
      ctxA,
      {
        procedimento: proc,
        descricao: 'Ficha sintética C2115',
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
        setorFuncional: null,
        copiarVigente: false,
      },
      trilha('criada'),
    );
    v1 = f.id;
    expect(f.versao).toBe(1);
    let versao = 1;
    const item = async (
      tipo: string,
      referencia: number | null,
      quantidade: number,
      custoUnitario: number | null,
      descricao: string | null = null,
    ) => {
      const r = await porta.incluirItem(
        ctxA,
        v1,
        { versao, tipo, referencia, descricao, quantidade, custoUnitario },
        trilha('item'),
      );
      versao = r.versao;
    };
    await item('insumo', insumo, 2, null); // 2 × 5,50 = 11,00
    await item('sala_cirurgica', procCir, 90, null); // 90 × 1,25 = 112,50
    await item('gas_medicinal', gas, 30, null); // 30 × 0,25 = 7,50
    await item('diaria', acomodacao, 1, null); // 400,00
    await item('mao_de_obra', null, 2, 150, 'Hora do cirurgião'); // 300,00
    const ficha = await um(
      'SELECT situacao, versao_ficha, custo_honorario, custo_operacional, custo_total, versao FROM ficha_custo_padrao WHERE id = ?',
      [v1],
    );
    expect(ficha).toMatchObject({ situacao: 'rascunho', versao_ficha: '1', versao: 6 });
    expect([
      Number(ficha['custo_honorario']),
      Number(ficha['custo_operacional']),
      Number(ficha['custo_total']),
    ]).toEqual([300, 531, 831]);
    const itens = await q(
      'SELECT tipo_referencia, custo_unitario, custo_total FROM ficha_custo_padrao_item WHERE ficha_custo_padrao_id = ? ORDER BY sequencia',
      [v1],
    );
    expect(
      itens.map((i) => [i['tipo_referencia'], Number(i['custo_unitario']), Number(i['custo_total'])]),
    ).toEqual([
      ['insumo', 5.5, 11],
      ['sala_cirurgica', 1.25, 112.5],
      ['gas_medicinal', 0.25, 7.5],
      ['diaria', 400, 400],
      ['mao_de_obra', 150, 300],
    ]);
    versaoV1 = versao;
    const d = await porta.detalhar(ctxA, v1);
    expect(d.porTipo).toMatchObject({
      insumo: 1100,
      sala_cirurgica: 11250,
      diaria: 40000,
      mao_de_obra: 30000,
    });
  });

  it('recusas sem gravar: sem custo de referência, versão velha; outro estabelecimento não vê', async () => {
    expect(
      await codigoDe(
        porta.incluirItem(
          ctxA,
          v1,
          {
            versao: versaoV1,
            tipo: 'procedimento',
            referencia: proc,
            descricao: null,
            quantidade: 1,
            custoUnitario: null,
          },
          trilha('item'),
        ),
      ),
    ).toBe('sem-custo-referencia');
    expect(
      await codigoDe(
        porta.incluirItem(
          ctxA,
          v1,
          {
            versao: 1,
            tipo: 'insumo',
            referencia: insumo,
            descricao: null,
            quantidade: 1,
            custoUnitario: null,
          },
          trilha('item'),
        ),
      ),
    ).toBe('conflito-versao');
    expect(
      Number(
        (await um('SELECT COUNT(*) AS n FROM ficha_custo_padrao_item WHERE ficha_custo_padrao_id = ?', [v1]))[
          'n'
        ],
      ),
    ).toBe(5);
    expect(await codigoDe(porta.detalhar(ctxB, v1))).toBe('nao-encontrado');
    expect((await porta.listar(ctxB, { termo: null, situacao: null })).length).toBe(0);
  });

  it('retirar item: a linha fica com a data de exclusão e o total cai', async () => {
    const gasItem = Number(
      (
        await um(
          "SELECT id FROM ficha_custo_padrao_item WHERE ficha_custo_padrao_id = ? AND tipo_referencia = 'gas_medicinal'",
          [v1],
        )
      )['id'],
    );
    const r = await porta.retirarItem(ctxA, v1, gasItem, versaoV1, trilha('retirado'));
    versaoV1 = r.versao;
    const it = await um('SELECT excluido_em FROM ficha_custo_padrao_item WHERE id = ?', [gasItem]);
    expect(it['excluido_em']).not.toBeNull();
    expect(
      Number((await um('SELECT custo_total FROM ficha_custo_padrao WHERE id = ?', [v1]))['custo_total']),
    ).toBe(823.5);
  });

  let v2 = 0;
  it('ativar; nova versão copiada da vigente; ativar a nova encerra a anterior na véspera; ativa não muda', async () => {
    const a = await porta.ativar(ctxA, v1, versaoV1, trilha('ativada'));
    expect(await um('SELECT situacao, padrao FROM ficha_custo_padrao WHERE id = ?', [v1])).toMatchObject({
      situacao: 'ativa',
    });
    expect(
      await codigoDe(
        porta.incluirItem(
          ctxA,
          v1,
          {
            versao: a.versao,
            tipo: 'insumo',
            referencia: insumo,
            descricao: null,
            quantidade: 1,
            custoUnitario: null,
          },
          trilha('item'),
        ),
      ),
    ).toBe('ficha-nao-rascunho');
    const n = await porta.criar(
      ctxA,
      {
        procedimento: proc,
        descricao: 'Ficha sintética C2115 revisada',
        vigenciaInicio: '2026-07-01',
        vigenciaFim: null,
        setorFuncional: null,
        copiarVigente: true,
      },
      trilha('criada'),
    );
    v2 = n.id;
    const nova = await um('SELECT versao_ficha, custo_total, situacao FROM ficha_custo_padrao WHERE id = ?', [
      v2,
    ]);
    expect(nova).toMatchObject({ versao_ficha: '2', situacao: 'rascunho' });
    expect(Number(nova['custo_total'])).toBe(823.5);
    expect(
      Number(
        (
          await um(
            'SELECT COUNT(*) AS n FROM ficha_custo_padrao_item WHERE ficha_custo_padrao_id = ? AND excluido_em IS NULL',
            [v2],
          )
        )['n'],
      ),
    ).toBe(4);
    await porta.ativar(ctxA, v2, n.versao, trilha('ativada'));
    const antiga = await um(
      "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, padrao, situacao FROM ficha_custo_padrao WHERE id = ?",
      [v1],
    );
    expect(antiga).toMatchObject({ fim: '2026-06-30', situacao: 'ativa' });
    expect(Number(antiga['padrao'])).toBe(0);
    expect(Number((await um('SELECT padrao FROM ficha_custo_padrao WHERE id = ?', [v2]))['padrao'])).toBe(1);
  });

  it('comparação: padrão da ficha × custo apurado das contas que lançaram o procedimento', async () => {
    const agora = new Date();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c2115-massa' }, async (e) => {
      const porCodigo = (tabela: string, codigo: string, colunas: Record<string, unknown>) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, ${Object.keys(colunas).join(', ')}, criado_em) VALUES (?, ${Object.keys(
            colunas,
          )
            .map(() => '?')
            .join(', ')}, ?)`,
          [codigo, ...Object.values(colunas), agora],
        );
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${COD}-OP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA C2115', 'operadora', 'ativa', ?)",
        [`${COD}-OP`, agora],
      );
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pp = await pessoa('PACIENTE SINTETICO C2115');
      const paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp, 921_150_001, agora],
      );
      const pm = await pessoa('MEDICO SINTETICO C2115');
      const profissional = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      const tiss = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['E8'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('E8', 'CARATER C2115', 'teste', ?)",
        [agora],
      );
      const categoria = await porCodigo('categoria_atendimento', `${COD}-AMB`, {
        descricao: 'AMBULATORIO C2115',
        tipo_base: 'externo',
      });
      const tipoConta = await porCodigo('tipo_conta', `${COD}-EXT`, {
        descricao: 'EXTERNA C2115',
        natureza: 'externa',
      });
      const apuracao = await e.inserir(
        "INSERT INTO apuracao_custo (estabelecimento_id, competencia, situacao, criado_em) VALUES (?, '2026-05-01', 'apurada', ?)",
        [estA, agora],
      );
      // Conta 1: 1 procedimento, custo 900,00 (padrão 823,50 → +9,3%, dentro). Conta 2: 2 procedimentos, custo 2.000,00
      // (padrão 1.647,00 → +21,4%, acima). Uma terceira conta sem o procedimento não entra.
      for (const [i, qtd, custo] of [
        [1, 1, 900],
        [2, 2, 2000],
        [3, 0, 500],
      ] as const) {
        const at = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
             fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-05-10 08:00:00', ?)`,
          [estA, `${COD}-AT${i}`, paciente, categoria, tiss, fonte, profissional, agora],
        );
        const conta = await e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id, tipo_conta_id,
             natureza, competencia, inicio_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, 'ambulatorial', '2026-05-01', '2026-05-10 08:00:00', ?)`,
          [estA, `${COD}-CH${i}`, at, paciente, fonte, tipoConta, agora],
        );
        contas.push(conta);
        if (qtd > 0)
          await e.executar(
            `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
               valor_unitario, valor_total, situacao, criado_em)
             VALUES (?, 1, ?, '2026-05-10 09:00:00', ?, 100, ?, 'lancado', ?)`,
            [conta, proc, qtd, 100 * qtd, agora],
          );
        await e.executar(
          `INSERT INTO custo_conta_paciente (apuracao_custo_id, conta_hospitalar_id, atendimento_id, data_atendimento, custo_total, criado_em)
           VALUES (?, ?, ?, '2026-05-10', ?, ?)`,
          [apuracao, conta, at, custo, agora],
        );
      }
    });
    // A v1 vale até 30/06: o padrão dela (823,50) contra as contas de maio.
    const c = await porta.comparar(ctxA, v1, '2026-05');
    expect(c.apuracao?.situacao).toBe('apurada');
    expect(c.linhas.map((l) => [l.numero, l.quantidade, l.custoPadrao, l.custoApurado, l.classe])).toEqual([
      [`${COD}-CH1`, 1, 82_350, 90_000, 'dentro'],
      [`${COD}-CH2`, 2, 164_700, 200_000, 'acima'],
    ]);
    expect([c.totalPadrao, c.totalApurado, c.variacao]).toEqual([247_050, 290_000, 42_950]);
    expect(c.contagem).toEqual({ dentro: 1, acima: 1, abaixo: 0 });
    expect((await porta.comparar(ctxA, v1, '2026-04')).linhas).toEqual([]);
  });

  it('inativar com motivo; a trilha tem uma linha por gravação', async () => {
    const atual = Number((await um('SELECT versao FROM ficha_custo_padrao WHERE id = ?', [v2]))['versao']);
    expect(await codigoDe(porta.inativar(ctxA, v2, atual, ' ', trilha('inativada')))).toBe(
      'motivo-obrigatorio',
    );
    await porta.inativar(ctxA, v2, atual, 'Revisão do protocolo', trilha('inativada'));
    expect(await um('SELECT situacao, padrao FROM ficha_custo_padrao WHERE id = ?', [v2])).toMatchObject({
      situacao: 'inativa',
    });
    // criar(2) + itens(5) + retirar(1) + ativar(2) + inativar(1) = 11.
    const n = await um(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'ficha_custo_padrao'",
      [estA],
    );
    expect(Number(n['n'])).toBe(11);
  });
});
