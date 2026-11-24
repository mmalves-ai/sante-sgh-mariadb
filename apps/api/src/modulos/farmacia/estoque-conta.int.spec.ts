// Motor estoque → conta (F3.0) contra o MariaDB real: a dispensação ao paciente lança o item na conta (item faturável
// do produto, quantidade, preço negociado vigente, origem = o lançamento do razão do estoque) na mesma transação do
// movimento; a devolução reduz o item na proporção e, devolvido tudo, o estorna; o cancelamento da dose estorna o item.
// O produto é um material próprio do hospital com id >= 10^12. Massa SINTÉTICA com o código "F3EC" (nenhuma pessoa
// real). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type ContextoNucleo, type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaFarmaciaPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F3EC';
/** Material próprio do hospital: id acima de 10^12 (faixa dos itens próprios). */
const ID_PROPRIO = 1_000_000_000_031;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('motor estoque → conta pela farmácia (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFarmaciaPropria;
  const ids = { est: 0, farma: 0, enf: 0, medico: 0, farmacia: 0, centro: 0, paciente: 0, atendimento: 0, conta: 0 };
  const horarios: number[] = [];
  let ctx: ContextoNucleo;
  let chave = 0;
  const op = (nome: string, entrada: unknown, extra: Partial<ContextoOperacao> = {}) =>
    porta.executar(ctx, nome, entrada, { ...ctx, chaveIdempotencia: `f3ec-${Date.now()}-${(chave += 1)}`, ...extra });

  const limpar = (e: Escritor) =>
    (async () => {
      for (const sql of [
        'UPDATE movimento_estoque SET conta_hospitalar_item_id = NULL WHERE estabelecimento_id = ?',
        'DELETE m FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id = ?',
        'DELETE i FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id = ?',
        'DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?',
        'DELETE FROM idempotencia_operacao WHERE estabelecimento_id = ?',
        'DELETE FROM integracao_mensagem WHERE estabelecimento_id = ?',
        'DELETE FROM trilha_auditoria WHERE estabelecimento_id = ?',
        'DELETE esi FROM entrega_setor_item esi JOIN entrega_setor es ON es.id = esi.entrega_setor_id WHERE es.estabelecimento_id = ?',
        'DELETE FROM entrega_setor WHERE estabelecimento_id = ?',
        'DELETE dei FROM documento_estoque_item dei JOIN documento_estoque de ON de.id = dei.documento_estoque_id WHERE de.estabelecimento_id = ?',
        'DELETE FROM movimento_estoque WHERE estabelecimento_id = ? AND estorno_movimento_estoque_id IS NOT NULL',
        'DELETE FROM movimento_estoque WHERE estabelecimento_id = ?',
        'DELETE di FROM devolucao_dispensacao_item di JOIN devolucao_dispensacao d ON d.id = di.devolucao_dispensacao_id WHERE d.estabelecimento_id = ?',
        'DELETE FROM devolucao_dispensacao WHERE estabelecimento_id = ?',
        'DELETE dd FROM dose_dispensada dd JOIN dispensacao_item di ON di.id = dd.dispensacao_item_id JOIN dispensacao d ON d.id = di.dispensacao_id WHERE d.estabelecimento_id = ?',
        'DELETE FROM horario_administracao WHERE estabelecimento_id = ?',
        'DELETE FROM documento_estoque WHERE estabelecimento_id = ?',
        'DELETE di FROM dispensacao_item di JOIN dispensacao d ON d.id = di.dispensacao_id WHERE d.estabelecimento_id = ?',
        'DELETE FROM dispensacao WHERE estabelecimento_id = ?',
        'DELETE pi FROM prescricao_item pi JOIN prescricao p ON p.id = pi.prescricao_id WHERE p.estabelecimento_id = ?',
        'DELETE FROM prescricao WHERE estabelecimento_id = ?',
        'DELETE FROM internacao WHERE estabelecimento_id = ?',
        'DELETE FROM atendimento WHERE estabelecimento_id = ?',
        'DELETE FROM usuario_vinculo_profissional WHERE estabelecimento_id = ?',
        'DELETE FROM saldo_lote WHERE estabelecimento_id = ?',
        'DELETE FROM saldo_estoque WHERE estabelecimento_id = ?',
        'DELETE FROM lote_insumo WHERE estabelecimento_id = ?',
        'DELETE FROM sequencia_negocio WHERE estabelecimento_id = ?',
      ])
        await e.executar(sql, [ids.est]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-f3ec' }, async (e) => {
      const agora = new Date();
      const g = (tabela: string, chaves: Record<string, unknown>, resto: Record<string, unknown> = {}) => {
        const cs = Object.keys(chaves);
        const todos = { ...chaves, ...resto, criado_em: agora };
        return garantir(
          e,
          `SELECT id FROM ${tabela} WHERE ${cs.map((c) => `${c} = ?`).join(' AND ')}`,
          Object.values(chaves),
          `INSERT INTO ${tabela} (${Object.keys(todos).join(', ')}) VALUES (${Object.keys(todos)
            .map(() => '?')
            .join(', ')})`,
          Object.values(todos),
        );
      };
      ids.est = await g(
        'estabelecimento',
        { codigo: P },
        { nome_fantasia: `ESTAB ${P} SINTETICO`, razao_social: `ESTAB ${P} SINTETICO` },
      );
      await limpar(e);
      ids.farma = await g(
        'usuario',
        { login: 'f3ec.farma' },
        { nome: 'FARMACEUTICO SINTETICO F3EC', tipo_conta: 'servico' },
      );
      ids.enf = await g(
        'usuario',
        { login: 'f3ec.enf' },
        { nome: 'ENFERMEIRO SINTETICO F3EC', tipo_conta: 'servico' },
      );
      const pessoa = (nome: string) => g('pessoa_fisica', { nome });
      const pFarma = await g(
        'profissional',
        { pessoa_fisica_id: await pessoa(`FARMACEUTICO ${P}`) },
        { tipo: 'corpo_clinico' },
      );
      ids.medico = await g(
        'profissional',
        { pessoa_fisica_id: await pessoa(`MEDICO ${P}`) },
        { tipo: 'corpo_clinico' },
      );
      await e.inserir(
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2026-01-01', ?)`,
        [ids.farma, ids.est, pFarma, agora],
      );
      ids.paciente = await g(
        'paciente',
        { pessoa_fisica_id: await pessoa(`PACIENTE SINTETICO ${P}`) },
        { numero_prontuario: 924_031_001, situacao: 'ativo' },
      );
      // Unidade, setor, centro de custo e o local da farmácia.
      const ua = await g(
        'unidade_assistencial',
        { estabelecimento_id: ids.est, codigo: `${P}-UA` },
        { nome: 'UTI SINTETICA', tipo_unidade: 'internacao' },
      );
      const setor = await g(
        'setor_funcional',
        { estabelecimento_id: ids.est, codigo: `${P}-SF` },
        { nome: 'UTI SINTETICA F3EC', tipo: 'assistencial' },
      );
      ids.centro = await g(
        'centro_custo',
        { estabelecimento_id: ids.est, codigo: `${P}-CC` },
        { nome: 'UTI SINTETICA F3EC', vigencia_inicio: '2026-01-01' },
      );
      await g(
        'unidade_internacao',
        { estabelecimento_id: ids.est, codigo: 'UTI-F3EC' },
        {
          unidade_assistencial_id: ua,
          descricao: 'UTI SINTETICA F3EC',
          tipo: 'uti_adulto',
          setor_funcional_id: setor,
          centro_custo_id: ids.centro,
        },
      );
      ids.farmacia = await g(
        'local_estoque',
        { estabelecimento_id: ids.est, codigo: `${P}-FC` },
        { nome: 'FARMACIA SINTETICA F3EC', tipo: 'farmacia_central' },
      );
      const um = await g('unidade_medida', { codigo: `${P}-UN` }, { descricao: 'UNIDADE F3EC', sigla: 'UNF3E' });
      const grupo = await g(
        'grupo_insumo',
        { codigo: `${P}-MAT` },
        { descricao: 'MATERIAIS F3EC', natureza: 'medicamento' },
      );
      // O material próprio do hospital, com id na faixa >= 10^12.
      await g(
        'insumo',
        { id: ID_PROPRIO },
        {
          codigo: `${P}-PROP`,
          nome: 'SORO PROPRIO SINTETICO F3EC',
          tipo: 'medicamento',
          grupo_insumo_id: grupo,
          estoque_unidade_medida_id: um,
          controla_lote: true,
          controla_validade: true,
        },
      );
      for (const [codigo, natureza, sentido] of [
        [`${P}-CONS`, 'consumo_paciente', 'saida'],
        [`${P}-DEV`, 'devolucao', 'entrada'],
      ] as const)
        await g(
          'tipo_movimento_estoque',
          { codigo },
          { descricao: `MOVIMENTO ${codigo}`, natureza, sentido, afeta_saldo: true },
        );
      for (const codigo of ['nao-administrado', 'sobra'])
        await g('motivo_devolucao_estoque', { codigo }, { descricao: `DEVOLUCAO ${codigo}`, origem_devolucao: 'setor' });
      for (const tipo of ['dispensacao', 'documento_estoque', 'devolucao_dispensacao'])
        await e.inserir(
          'INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, incremento, ativo, criado_em) VALUES (?, ?, 1, 1, TRUE, ?)',
          [ids.est, tipo, agora],
        );
      const lote = await e.inserir(
        'INSERT INTO lote_insumo (estabelecimento_id, insumo_id, numero_lote, validade, criado_em) VALUES (?, ?, ?, ?, ?)',
        [ids.est, ID_PROPRIO, 'EC-1', '2099-12-31', agora],
      );
      await e.inserir(
        `INSERT INTO saldo_lote (estabelecimento_id, local_estoque_id, lote_insumo_id, quantidade, competencia, criado_em)
         VALUES (?, ?, ?, 20, ?, ?)`,
        [ids.est, ids.farmacia, lote, `${agora.toISOString().slice(0, 7)}-01`, agora],
      );
      await e.inserir(
        'INSERT INTO saldo_estoque (estabelecimento_id, local_estoque_id, insumo_id, quantidade, custo_medio, criado_em) VALUES (?, ?, ?, 20, 2, ?)',
        [ids.est, ids.farmacia, ID_PROPRIO, agora],
      );
      // O item faturável do produto, a fonte pagadora com o preço negociado vigente e a conta aberta do atendimento.
      const grupoFat = await g(
        'grupo_faturamento',
        { codigo: `${P}-GF` },
        { descricao: 'MEDICAMENTOS F3EC', tipo_grupo: 'medicamento' },
      );
      const fat = await g(
        'item_faturavel',
        { codigo: `${P}-FAT` },
        { descricao: 'SORO PROPRIO F3EC', tipo_item: 'medicamento', grupo_faturamento_id: grupoFat, insumo_id: ID_PROPRIO },
      );
      const fonte = await g(
        'fonte_pagadora',
        { codigo: `${P}-OP` },
        { nome: 'OPERADORA F3EC', tipo: 'operadora', situacao: 'ativa' },
      );
      await e.executar('DELETE FROM preco_negociado_matmed WHERE fonte_pagadora_id = ?', [fonte]);
      for (const [inicio, valor] of [
        ['2020-01-01', 1.1],
        ['2026-01-01', 3.75],
        ['2099-01-01', 99],
      ] as const)
        await e.inserir(
          `INSERT INTO preco_negociado_matmed (fonte_pagadora_id, item_faturavel_id, vigencia_inicio, valor_unitario, criado_em)
           VALUES (?, ?, ?, ?, ?)`,
          [fonte, fat, inicio, valor, agora],
        );
      const tiss = await g('carater_atendimento_tiss', { codigo_tiss: 'F4' }, { descricao: 'CARATER F24PF', versao_fonte: 'teste' });
      const cat = await g(
        'categoria_atendimento',
        { codigo: `${P}-INT` },
        { descricao: 'INTERNACAO F3EC', tipo_base: 'internacao' },
      );
      ids.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
           fonte_pagadora_id, profissional_id, setor_funcional_id, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3) - INTERVAL 1 DAY, ?)`,
        [ids.est, `${P}-AT1`, ids.paciente, cat, tiss, fonte, ids.medico, setor, agora],
      );
      const tipoConta = await g('tipo_conta', { codigo: `${P}-TC` }, { descricao: 'INTERNACAO F3EC', natureza: 'internacao' });
      ids.conta = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id, tipo_conta_id,
           natureza, competencia, inicio_em, calculada, criado_em) VALUES (?, ?, ?, ?, ?, ?, 'internacao', ?, NOW(3) - INTERVAL 1 DAY, TRUE, ?)`,
        [ids.est, `${P}-C1`, ids.atendimento, ids.paciente, fonte, tipoConta, `${agora.toISOString().slice(0, 7)}-01`, agora],
      );
      const prescricao = await e.inserir(
        `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id, situacao,
           prescrito_em, vigencia_inicio_em, vigencia_fim_em, criado_em)
         VALUES (?, 931001, ?, ?, ?, 'vigente', NOW(3) - INTERVAL 1 HOUR, NOW(3) - INTERVAL 1 HOUR, NOW(3) + INTERVAL 23 HOUR, ?)`,
        [ids.est, ids.paciente, ids.atendimento, ids.medico, agora],
      );
      const tipoItem = await g(
        'tipo_item_prescricao',
        { codigo: `${P}-MED` },
        { descricao: 'MEDICAMENTO F3EC', categoria: 'medicamento' },
      );
      const ip = await g(
        'item_prescritivel',
        { codigo: `${P}-PROP` },
        { descricao: 'SORO PROPRIO (SINTETICO)', tipo_item_prescricao_id: tipoItem, insumo_id: ID_PROPRIO },
      );
      const situacao = await g('situacao_checagem', { codigo: `${P}-P` }, { descricao: 'PENDENTE F3EC', categoria: 'pendente' });
      const item = await e.inserir(
        `INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, item_prescritivel_id, quantidade,
           inicio_em, lancamento_profissional_id, situacao, criado_em) VALUES (?, 1, ?, ?, 2, NOW(3) - INTERVAL 1 HOUR, ?, 'ativo', ?)`,
        [prescricao, tipoItem, ip, ids.medico, agora],
      );
      for (const h of [1, 2])
        horarios.push(
          await e.inserir(
            `INSERT INTO horario_administracao (estabelecimento_id, atendimento_id, prescricao_id, prescricao_item_id, previsto_em,
               situacao_checagem_id, criado_em) VALUES (?, ?, ?, ?, NOW(3) + INTERVAL ${h} HOUR, ?, ?)`,
            [ids.est, ids.atendimento, prescricao, item, situacao, agora],
          ),
        );
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.farma, correlacao: 'teste-f3ec' };
    porta = new PortaFarmaciaPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-f3ec' }, limpar);
    await nucleo.encerrar();
  });

  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f3ec' }, (l) => l.uma<Record<string, unknown>>(sql, p));
  const lerTodas = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f3ec' }, (l) => l.consultar<Record<string, unknown>>(sql, p));
  const saldo = async () =>
    Number(
      (await ler('SELECT quantidade FROM saldo_estoque WHERE insumo_id = ? AND estabelecimento_id = ?', [ID_PROPRIO, ids.est]))?.[
        'quantidade'
      ],
    );
  const itemDaConta = (id: number) =>
    ler(
      `SELECT i.id, i.conta_hospitalar_id, i.item_faturavel_id, i.quantidade, i.valor_unitario, i.valor_total, i.situacao,
              i.movimento_estoque_id, i.numero_lote, i.tipo_valorizacao, i.setor_funcional_id, i.centro_custo_id, i.versao
         FROM conta_hospitalar_item i WHERE i.id = ?`,
      [id],
    );
  const dispensar = (horario: number, q: number) =>
    op('suprimentos.dispensarHorario', {
      atendimento: ids.atendimento,
      local: ids.farmacia,
      centroCusto: ids.centro,
      doses: [{ horario, quantidade: q, lotes: [{ lote: 'EC-1', validade: '2099-12-31', quantidade: q }] }],
    });
  const estado = { dose: 0, item: 0, saida: 0 };

  it('dispensar: o saldo cai e o item entra na conta com o preço negociado vigente, ligado ao movimento', async () => {
    const r = await dispensar(horarios[0]!, 2);
    estado.dose = Number(r.resultado['idsDoses']);
    expect(await saldo()).toBe(18);
    const mov = await ler(
      `SELECT m.id, m.insumo_id, m.conta_hospitalar_item_id, m.faturavel FROM movimento_estoque m
         JOIN dispensacao_item di ON di.id = m.dispensacao_item_id JOIN dose_dispensada dd ON dd.dispensacao_item_id = di.id
        WHERE dd.id = ? AND m.natureza = 'saida'`,
      [estado.dose],
    );
    expect(Number(mov?.['insumo_id'])).toBe(ID_PROPRIO);
    expect(Number(mov?.['faturavel'])).toBe(1);
    estado.saida = Number(mov?.['id']);
    estado.item = Number(mov?.['conta_hospitalar_item_id']);
    expect(estado.item).toBeGreaterThan(0);
    const i = await itemDaConta(estado.item);
    expect(i).toMatchObject({ situacao: 'lancado', numero_lote: 'EC-1', tipo_valorizacao: 'tabela' });
    expect(Number(i?.['conta_hospitalar_id'])).toBe(ids.conta);
    expect(Number(i?.['movimento_estoque_id'])).toBe(estado.saida);
    expect(Number(i?.['quantidade'])).toBe(2);
    expect(Number(i?.['valor_unitario'])).toBe(3.75);
    expect(Number(i?.['valor_total'])).toBe(7.5);
    expect(Number(i?.['centro_custo_id'])).toBe(ids.centro);
    const m = await lerTodas(
      'SELECT operacao, valor_total_calculado, dados FROM conta_hospitalar_item_memoria WHERE conta_hospitalar_item_id = ? ORDER BY id',
      [estado.item],
    );
    expect(m.map((x) => x['operacao'])).toEqual(['inclusao']);
    expect(JSON.parse(String(m[0]!['dados']))).toMatchObject({ regra: 'negociado_fixo', movimento: estado.saida });
    // A conta fica para recalcular (o item novo mudou o total).
    expect(Number((await ler('SELECT calculada FROM conta_hospitalar WHERE id = ?', [ids.conta]))?.['calculada'])).toBe(0);
  });

  it('devolver parte: o saldo volta e o item é reduzido na proporção, com a memória', async () => {
    await op('suprimentos.devolverDose', {
      dose: estado.dose,
      local: ids.farmacia,
      quantidade: 1,
      lote: 'EC-1',
      motivo: 'sobra',
    });
    expect(await saldo()).toBe(19);
    const i = await itemDaConta(estado.item);
    expect(i?.['situacao']).toBe('lancado');
    expect(Number(i?.['quantidade'])).toBe(1);
    expect(Number(i?.['valor_total'])).toBe(3.75);
    const dev = await ler(
      "SELECT conta_hospitalar_item_id FROM movimento_estoque WHERE estabelecimento_id = ? AND natureza = 'entrada' ORDER BY id DESC LIMIT 1",
      [ids.est],
    );
    expect(Number(dev?.['conta_hospitalar_item_id'])).toBe(estado.item);
  });

  it('devolver o resto: o item fica estornado (não é apagado) e o saldo volta ao inicial', async () => {
    await op('suprimentos.devolverDose', {
      dose: estado.dose,
      local: ids.farmacia,
      quantidade: 1,
      lote: 'EC-1',
      motivo: 'nao-administrado',
    });
    expect(await saldo()).toBe(20);
    const i = await itemDaConta(estado.item);
    expect(i?.['situacao']).toBe('estornado');
    const m = await lerTodas(
      'SELECT operacao FROM conta_hospitalar_item_memoria WHERE conta_hospitalar_item_id = ? ORDER BY id',
      [estado.item],
    );
    expect(m.map((x) => x['operacao'])).toEqual(['inclusao', 'alteracao', 'exclusao']);
  });

  it('cancelar a dose antes da entrega estorna o item da conta e devolve o saldo', async () => {
    const r = await dispensar(horarios[1]!, 1);
    const dose = Number(r.resultado['idsDoses']);
    expect(await saldo()).toBe(19);
    const item = Number(
      (
        await ler(
          `SELECT m.conta_hospitalar_item_id AS i FROM movimento_estoque m JOIN dose_dispensada dd ON dd.dispensacao_item_id = m.dispensacao_item_id
            WHERE dd.id = ? AND m.natureza = 'saida'`,
          [dose],
        )
      )?.['i'],
    );
    expect(Number((await itemDaConta(item))?.['valor_total'])).toBe(3.75);
    await op('suprimentos.cancelarDispensacao', { dose, motivo: 'Item suspenso (texto sintético)' });
    expect(await saldo()).toBe(20);
    expect((await itemDaConta(item))?.['situacao']).toBe('estornado');
    const itens = await lerTodas('SELECT sequencia, situacao FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? ORDER BY sequencia', [
      ids.conta,
    ]);
    expect(itens.map((x) => [Number(x['sequencia']), x['situacao']])).toEqual([
      [1, 'estornado'],
      [2, 'estornado'],
    ]);
  });
});
