// Motor estoque → conta (F3.0) contra o MariaDB real: a dispensação ao paciente lança o item na conta (item faturável
// do produto, quantidade, preço negociado vigente, origem = o lançamento do razão do estoque) na mesma transação do
// movimento; a devolução reduz o item na proporção e, devolvido tudo, o estorna; o cancelamento da dose estorna o item.
// Pelos suprimentos: a saída ao paciente (vários lotes: lote nulo; solicitante = o médico) lança pela referência de
// mercado (vínculo do insumo com fator de conversão, base pf da tabela da conta, fator da embalagem), pelo negociado
// percentual de contrato vigente (o de contrato encerrado não vale) e sem preço; a devolução reduz o item; com a conta
// fechada a devolução é recusada e nada fica (nem o saldo); sem conta aberta ou sem item faturável não há item.
// O vínculo gravado pela ficha do item (porta do vínculo com a referência de preço, pelo Executor, 05-SUP linha 28) é o
// que a saída usa: a referência e o fator dele dão a quantidade cobrada e o preço do item na conta.
// O produto é um material próprio do hospital com id >= 10^12. Massa SINTÉTICA com o código "F3EC" (nenhuma pessoa
// real). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type ContextoNucleo, type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoSuprimentos } from '../suprimentos/porta.js';
import { PortaSuprimentosPropria } from '../suprimentos/porta-propria.js';
import { PortaVinculoReferenciaPropria } from '../suprimentos/vinculo-referencia-preco.js';
import { PortaFarmaciaPropria } from './porta-propria.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F3EC';
/** Material próprio do hospital: id acima de 10^12 (faixa dos itens próprios). */
const ID_PROPRIO = 1_000_000_000_031;
/** Os insumos da saída pelos suprimentos: referência (2 lotes), negociado de contrato, sem preço, sem item faturável. */
const I_REF = ID_PROPRIO + 1;
const I_NEG = ID_PROPRIO + 2;
const I_SEM = ID_PROPRIO + 3;
const I_NAOFAT = ID_PROPRIO + 4;
/** O insumo cujo vínculo com a referência de preço é gravado pela porta do vínculo (ficha do item). */
const I_VINC = ID_PROPRIO + 5;

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    const x = e as { problema?: { codigo?: unknown } };
    return x.problema?.codigo !== undefined ? String(x.problema.codigo) : String(e);
  }
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('motor estoque → conta pela farmácia (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFarmaciaPropria;
  let sup: PortaSuprimentosPropria;
  const ids = {
    est: 0,
    farma: 0,
    enf: 0,
    medico: 0,
    farmacia: 0,
    centro: 0,
    paciente: 0,
    atendimento: 0,
    atendimento2: 0,
    conta: 0,
    contratoVigente: 0,
    contratoEncerrado: 0,
    itemRef: 0,
  };
  const horarios: number[] = [];
  let ctx: ContextoNucleo;
  let chave = 0;
  const op = (nome: string, entrada: unknown, extra: Partial<ContextoOperacao> = {}) =>
    porta.executar(ctx, nome, entrada, {
      ...ctx,
      chaveIdempotencia: `f3ec-${Date.now()}-${(chave += 1)}`,
      ...extra,
    });
  const opSup = (nome: string, entrada: unknown) =>
    sup.executar(ctx as ContextoSuprimentos, `suprimentos.${nome}`, entrada, {
      ...ctx,
      chaveIdempotencia: `f3ec-s-${Date.now()}-${(chave += 1)}`,
    });

  const limpar = (e: Escritor) =>
    (async () => {
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
      for (const sql of [
        'UPDATE movimento_estoque SET conta_hospitalar_item_id = NULL, documento_estoque_item_id = NULL WHERE estabelecimento_id = ?',
        'DELETE m FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id = ?',
        'DELETE i FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id = ?',
        'DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?',
        'DELETE FROM idempotencia_operacao WHERE estabelecimento_id = ?',
        'DELETE FROM integracao_mensagem WHERE estabelecimento_id = ?',
        'DELETE esi FROM entrega_setor_item esi JOIN entrega_setor es ON es.id = esi.entrega_setor_id WHERE es.estabelecimento_id = ?',
        'DELETE FROM entrega_setor WHERE estabelecimento_id = ?',
        'DELETE dei FROM documento_estoque_item dei JOIN documento_estoque de ON de.id = dei.documento_estoque_id WHERE de.estabelecimento_id = ?',
        'DELETE ml FROM movimento_lote ml JOIN movimento_estoque m ON m.id = ml.movimento_estoque_id WHERE m.estabelecimento_id = ?',
        'DELETE FROM fato_contabil WHERE estabelecimento_id = ? AND estornado_fato_contabil_id IS NOT NULL',
        'DELETE FROM fato_contabil WHERE estabelecimento_id = ?',
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
        'DELETE lu FROM local_estoque_usuario lu JOIN local_estoque l ON l.id = lu.local_estoque_id WHERE l.estabelecimento_id = ?',
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
      const um = await g(
        'unidade_medida',
        { codigo: `${P}-UN` },
        { descricao: 'UNIDADE F3EC', sigla: 'UNF3E' },
      );
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
        await g(
          'motivo_devolucao_estoque',
          { codigo },
          { descricao: `DEVOLUCAO ${codigo}`, origem_devolucao: 'setor' },
        );
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
        {
          descricao: 'SORO PROPRIO F3EC',
          tipo_item: 'medicamento',
          grupo_faturamento_id: grupoFat,
          insumo_id: ID_PROPRIO,
        },
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
      const tiss = await g(
        'carater_atendimento_tiss',
        { codigo_tiss: 'F4' },
        { descricao: 'CARATER F24PF', versao_fonte: 'teste' },
      );
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
      const tabela = await g(
        'tabela_preco',
        { codigo: `${P}-TP` },
        {
          descricao: 'MATMED F3EC',
          tipo_item: 'medicamento',
          referencia: 'brasindice',
          preco_referencia: 'pf',
          situacao: 'ativa',
        },
      );
      const tipoConta = await g(
        'tipo_conta',
        { codigo: `${P}-TC` },
        { descricao: 'INTERNACAO F3EC', natureza: 'internacao' },
      );
      ids.conta = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id, tipo_conta_id,
           tabela_preco_id, natureza, competencia, inicio_em, calculada, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'internacao', ?, NOW(3) - INTERVAL 1 DAY, TRUE, ?)`,
        [
          ids.est,
          `${P}-C1`,
          ids.atendimento,
          ids.paciente,
          fonte,
          tipoConta,
          tabela,
          `${agora.toISOString().slice(0, 7)}-01`,
          agora,
        ],
      );
      // Um segundo atendimento, sem conta aberta.
      ids.atendimento2 = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
           fonte_pagadora_id, profissional_id, setor_funcional_id, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3) - INTERVAL 1 DAY, ?)`,
        [ids.est, `${P}-AT2`, ids.paciente, cat, tiss, fonte, ids.medico, setor, agora],
      );
      // Os suprimentos: o usuário atende e devolve no local; os tipos de movimento da saída ao paciente e da devolução.
      await e.inserir(
        'INSERT INTO local_estoque_usuario (local_estoque_id, usuario_id, pode_atender, pode_devolver, criado_em) VALUES (?, ?, TRUE, TRUE, ?)',
        [ids.farmacia, ids.farma, agora],
      );
      for (const [codigo, natureza, sentido] of [
        ['saida_paciente', 'consumo_paciente', 'saida'],
        ['devolucao_interna', 'devolucao', 'entrada'],
      ] as const)
        await g(
          'tipo_movimento_estoque',
          { codigo },
          { descricao: `MOVIMENTO ${codigo}`, natureza, sentido, afeta_saldo: true },
        );
      // A referência de mercado: item no frasco (fator da embalagem 10), preço de fábrica 20 e máximo ao consumidor 30.
      const umFrasco = await g(
        'unidade_medida',
        { codigo: `${P}-FR` },
        { descricao: 'FRASCO F3EC', sigla: 'FRF3E' },
      );
      const fonteRef = await g(
        'fonte_referencia_matmed',
        { codigo: `${P}-FR` },
        { descricao: 'REFERENCIA F3EC', tipo_fonte: 'propria' },
      );
      const edicao = await g(
        'edicao_referencia_matmed',
        { fonte_referencia_matmed_id: fonteRef, numero_edicao: `${P}-1` },
        { vigencia_inicio: '2026-01-01', operacao: 'inclusao', ocorrido_em: agora },
      );
      const itemRef = await g(
        'item_referencia_matmed',
        { fonte_referencia: 'outra', codigo_referencia: `${P}-R1` },
        {
          descricao: 'FRASCO SINTETICO F3EC',
          tipo_produto: 'material',
          fator_divisao: 10,
          unidade_medida_id: umFrasco,
        },
      );
      ids.itemRef = itemRef;
      // O vínculo do I_VINC nasce na prova, pela porta (a rodada anterior não deixa vínculo para trás).
      await e.executar('DELETE FROM insumo_referencia_preco WHERE insumo_id = ?', [I_VINC]);
      await e.executar('DELETE FROM preco_referencia_matmed WHERE item_referencia_matmed_id = ?', [itemRef]);
      await e.inserir(
        `INSERT INTO preco_referencia_matmed (item_referencia_matmed_id, ocorrido_em, edicao_referencia_matmed_id, vigencia_inicio,
           preco_fabrica, preco_maximo_consumidor, criado_em) VALUES (?, ?, ?, '2026-01-01', 20, 30, ?)`,
        [itemRef, agora, edicao, agora],
      );
      for (const [numero, situacao, inicio] of [
        ['CV', 'vigente', '2026-01-01'],
        ['CE', 'encerrado', '2025-01-01'],
      ] as const) {
        const c = await g(
          'contrato_fonte_pagadora',
          { estabelecimento_id: ids.est, numero: `${P}-${numero}` },
          {
            fonte_pagadora_id: fonte,
            descricao: `CONTRATO ${numero} F3EC`,
            vigencia_inicio: inicio,
            situacao,
          },
        );
        if (numero === 'CV') ids.contratoVigente = c;
        else ids.contratoEncerrado = c;
      }
      // Os insumos da saída pelos suprimentos (lotes e saldos próprios; item faturável, menos o último).
      for (const [k, id, lotes] of [
        [2, I_REF, ['EC-2A', 'EC-2B']],
        [3, I_NEG, ['EC-3']],
        [4, I_SEM, ['EC-4']],
        [5, I_NAOFAT, ['EC-5']],
        [6, I_VINC, ['EC-6']],
      ] as const) {
        await g(
          'insumo',
          { id },
          {
            codigo: `${P}-P${k}`,
            nome: `MATERIAL ${k} SINTETICO F3EC`,
            tipo: 'medicamento',
            grupo_insumo_id: grupo,
            estoque_unidade_medida_id: um,
            controla_lote: true,
            controla_validade: true,
          },
        );
        for (const numero of lotes) {
          const l = await e.inserir(
            'INSERT INTO lote_insumo (estabelecimento_id, insumo_id, numero_lote, validade, criado_em) VALUES (?, ?, ?, ?, ?)',
            [ids.est, id, numero, '2099-12-31', agora],
          );
          await e.inserir(
            `INSERT INTO saldo_lote (estabelecimento_id, local_estoque_id, lote_insumo_id, quantidade, competencia, criado_em)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [ids.est, ids.farmacia, l, 10 / lotes.length, `${agora.toISOString().slice(0, 7)}-01`, agora],
          );
        }
        await e.inserir(
          'INSERT INTO saldo_estoque (estabelecimento_id, local_estoque_id, insumo_id, quantidade, custo_medio, criado_em) VALUES (?, ?, ?, 10, 1, ?)',
          [ids.est, ids.farmacia, id, agora],
        );
        if (id === I_NAOFAT) continue;
        const f = await g(
          'item_faturavel',
          { codigo: `${P}-FAT${k}` },
          {
            descricao: `MATERIAL ${k} F3EC`,
            tipo_item: 'medicamento',
            grupo_faturamento_id: grupoFat,
            insumo_id: id,
          },
        );
        // Duas unidades de estoque valem um frasco da referência.
        if (id === I_REF || id === I_NEG)
          await g(
            'insumo_referencia_preco',
            { insumo_id: id, item_referencia_matmed_id: itemRef, vigencia_inicio: '2026-01-01' },
            { fator_conversao: 2 },
          );
        if (id === I_NEG)
          for (const [contrato, inicio, valor, pct, unidade] of [
            [ids.contratoVigente, '2026-01-01', null, 10, umFrasco],
            [ids.contratoEncerrado, '2026-06-01', 50, null, null],
          ] as const)
            await e.inserir(
              `INSERT INTO preco_negociado_matmed (fonte_pagadora_id, contrato_fonte_pagadora_id, item_faturavel_id, unidade_medida_id,
                 vigencia_inicio, valor_unitario, percentual_ajuste, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [fonte, contrato, f, unidade, inicio, valor, pct, agora],
            );
      }
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
      const situacao = await g(
        'situacao_checagem',
        { codigo: `${P}-P` },
        { descricao: 'PENDENTE F3EC', categoria: 'pendente' },
      );
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
    sup = new PortaSuprimentosPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-f3ec' }, limpar);
    await nucleo.encerrar();
  });

  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f3ec' }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );
  const lerTodas = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f3ec' }, (l) =>
      l.consultar<Record<string, unknown>>(sql, p),
    );
  const saldo = async () =>
    Number(
      (
        await ler('SELECT quantidade FROM saldo_estoque WHERE insumo_id = ? AND estabelecimento_id = ?', [
          ID_PROPRIO,
          ids.est,
        ])
      )?.['quantidade'],
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
  const estado = { dose: 0, item: 0, saida: 0, docSaida: 0 };
  const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>;
  const saldoDe = async (insumo: number) =>
    Number(
      (
        await ler('SELECT quantidade FROM saldo_estoque WHERE insumo_id = ? AND estabelecimento_id = ?', [
          insumo,
          ids.est,
        ])
      )?.['quantidade'],
    );
  /** O lançamento de saída mais recente do insumo, com o item da conta ligado a ele. */
  const saidaDo = (insumo: number) =>
    ler(
      `SELECT m.id, m.faturavel, m.conta_hospitalar_item_id, m.atendimento_id FROM movimento_estoque m
        WHERE m.insumo_id = ? AND m.estabelecimento_id = ? AND m.natureza = 'saida' ORDER BY m.id DESC LIMIT 1`,
      [insumo, ids.est],
    );
  const memoriaDo = (item: number) =>
    lerTodas(
      'SELECT operacao, valor_total_calculado, dados FROM conta_hospitalar_item_memoria WHERE conta_hospitalar_item_id = ? ORDER BY id',
      [item],
    );
  const loteId = async (numero: string) =>
    Number(
      (
        await ler('SELECT id FROM lote_insumo WHERE estabelecimento_id = ? AND numero_lote = ?', [
          ids.est,
          numero,
        ])
      )?.['id'],
    );
  const itemDoDocumento = async (doc: number, insumo: number) =>
    Number(
      (
        await ler('SELECT id FROM documento_estoque_item WHERE documento_estoque_id = ? AND insumo_id = ?', [
          doc,
          insumo,
        ])
      )?.['id'],
    );
  const lote = (numero: string, quantidade: number) => ({ lote: numero, validade: '2099-12-31', quantidade });
  const saidaPaciente = (atendimento: number, itens: unknown[]) =>
    opSup('registrarSaida', {
      destino: 1,
      local: ids.farmacia,
      centroCusto: ids.centro,
      localConsumo: 1,
      atendimento,
      medico: ids.medico,
      itens,
    });

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
    expect(json(m[0]!['dados'])).toMatchObject({ regra: 'negociado_fixo', movimento: estado.saida });
    // A conta fica para recalcular (o item novo mudou o total).
    expect(
      Number((await ler('SELECT calculada FROM conta_hospitalar WHERE id = ?', [ids.conta]))?.['calculada']),
    ).toBe(0);
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
    const itens = await lerTodas(
      'SELECT sequencia, situacao FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? ORDER BY sequencia',
      [ids.conta],
    );
    expect(itens.map((x) => [Number(x['sequencia']), x['situacao']])).toEqual([
      [1, 'estornado'],
      [2, 'estornado'],
    ]);
  });

  it('suprimentos, saída ao paciente: referência (vínculo com fator, base pf, vários lotes), negociado de contrato vigente e sem preço', async () => {
    const r = await saidaPaciente(ids.atendimento, [
      { item: I_REF, quantidade: 4, lotes: [lote('EC-2A', 2), lote('EC-2B', 2)] },
      { item: I_NEG, quantidade: 2, lotes: [lote('EC-3', 2)] },
      { item: I_SEM, quantidade: 1, lotes: [lote('EC-4', 1)] },
    ]);
    estado.docSaida = Number(r.resultado['id']);
    expect([await saldoDe(I_REF), await saldoDe(I_NEG), await saldoDe(I_SEM)]).toEqual([6, 8, 9]);
    const item = async (insumo: number) => {
      const mov = await saidaDo(insumo);
      expect(Number(mov?.['faturavel'])).toBe(1);
      const i = await ler(
        `SELECT conta_hospitalar_id, quantidade, valor_unitario, valor_total, situacao, movimento_estoque_id, lote_insumo_id,
                numero_lote, solicitante_profissional_id, centro_custo_id, observacao
           FROM conta_hospitalar_item WHERE id = ?`,
        [Number(mov?.['conta_hospitalar_item_id'])],
      );
      expect(Number(i?.['conta_hospitalar_id'])).toBe(ids.conta);
      expect(Number(i?.['movimento_estoque_id'])).toBe(Number(mov?.['id']));
      expect(Number(i?.['solicitante_profissional_id'])).toBe(ids.medico);
      expect(Number(i?.['centro_custo_id'])).toBe(ids.centro);
      const m = await memoriaDo(Number(mov?.['conta_hospitalar_item_id']));
      return {
        i: i!,
        id: Number(mov?.['conta_hospitalar_item_id']),
        dados: json(m[0]!['dados']),
        ops: m.map((x) => x['operacao']),
      };
    };
    // Referência: pf 20 / embalagem 10 = 2 por frasco; 4 unidades de estoque = 2 frascos (fator 2) = 4. Dois lotes: lote nulo.
    const ref = await item(I_REF);
    expect([
      Number(ref.i['quantidade']),
      Number(ref.i['valor_unitario']),
      Number(ref.i['valor_total']),
    ]).toEqual([2, 2, 4]);
    expect([ref.i['lote_insumo_id'], ref.i['numero_lote']]).toEqual([null, null]);
    expect(ref.dados).toMatchObject({ regra: 'referencia', quantidadeEstoque: 4 });
    expect(ref.ops).toEqual(['inclusao']);
    // Negociado: +10% sobre a referência no frasco (2,2) para 1 frasco; o de contrato encerrado (50, mais recente) não vale.
    const neg = await item(I_NEG);
    expect([
      Number(neg.i['quantidade']),
      Number(neg.i['valor_unitario']),
      Number(neg.i['valor_total']),
    ]).toEqual([1, 2.2, 2.2]);
    expect(neg.dados['regra']).toBe('negociado_percentual');
    expect(
      (neg.dados['passos'] as string[]).some((x) =>
        x.includes(`contrato ${ids.contratoEncerrado} não vigente`),
      ),
    ).toBe(true);
    // Sem preço: valor zero, para a conferência (a saída não para).
    const sem = await item(I_SEM);
    expect([Number(sem.i['quantidade']), Number(sem.i['valor_total'])]).toEqual([1, 0]);
    expect(sem.dados['regra']).toBe('sem_preco');
    expect(String(sem.i['observacao'])).toContain('Sem preço');
  });

  it('suprimentos, saída ao paciente com o vínculo gravado pela ficha do item: a referência e o fator do vínculo dão o preço', async () => {
    const vinc = new PortaVinculoReferenciaPropria(nucleo);
    const hoje = String((await ler("SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS d", []))?.['d']);
    // Cinco unidades de estoque valem um frasco da referência (vínculo novo, pelo Executor, com a chave da tela).
    const { id: vinculo } = await vinc.vincular(
      ctx,
      I_VINC,
      { referencia: ids.itemRef, edicao: null, fator: 5, inicio: hoje },
      `f3ec-vinc-${Date.now()}`,
    );
    const gravado = await ler(
      `SELECT insumo_id, item_referencia_matmed_id, fator_conversao, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio,
              vigencia_fim, excluido_em FROM insumo_referencia_preco WHERE id = ?`,
      [vinculo],
    );
    expect([
      Number(gravado?.['insumo_id']),
      Number(gravado?.['item_referencia_matmed_id']),
      Number(gravado?.['fator_conversao']),
      gravado?.['inicio'],
      gravado?.['vigencia_fim'],
      gravado?.['excluido_em'],
    ]).toEqual([I_VINC, ids.itemRef, 5, hoje, null, null]);
    await saidaPaciente(ids.atendimento, [{ item: I_VINC, quantidade: 10, lotes: [lote('EC-6', 10)] }]);
    expect(await saldoDe(I_VINC)).toBe(0);
    const mov = await saidaDo(I_VINC);
    const id = Number(mov?.['conta_hospitalar_item_id']);
    const i = await itemDaConta(id);
    // pf 20 / embalagem 10 = 2 por frasco; 10 unidades de estoque / fator 5 do vínculo = 2 frascos = 4.
    expect([
      Number(i?.['conta_hospitalar_id']),
      Number(i?.['movimento_estoque_id']),
      Number(i?.['quantidade']),
      Number(i?.['valor_unitario']),
      Number(i?.['valor_total']),
      i?.['situacao'],
    ]).toEqual([ids.conta, Number(mov?.['id']), 2, 2, 4, 'lancado']);
    const m = await memoriaDo(id);
    expect(m.map((x) => x['operacao'])).toEqual(['inclusao']);
    expect(json(m[0]!['dados'])).toMatchObject({ regra: 'referencia', quantidadeEstoque: 10 });
  });

  it('suprimentos, devolução: reduz o item na proporção e liga o lançamento de entrada ao item', async () => {
    await opSup('registrarDevolucao', {
      saida: estado.docSaida,
      local: ids.farmacia,
      itens: [
        {
          lancamentoSaida: await itemDoDocumento(estado.docSaida, I_REF),
          item: I_REF,
          quantidade: 2,
          lotes: [{ loteSaida: await loteId('EC-2A'), quantidade: 2 }],
        },
      ],
    });
    expect(await saldoDe(I_REF)).toBe(8);
    const id = Number((await saidaDo(I_REF))?.['conta_hospitalar_item_id']);
    const i = await itemDaConta(id);
    expect([i?.['situacao'], Number(i?.['quantidade']), Number(i?.['valor_total'])]).toEqual([
      'lancado',
      1,
      2,
    ]);
    expect((await memoriaDo(id)).map((x) => x['operacao'])).toEqual(['inclusao', 'alteracao']);
    const dev = await ler(
      "SELECT conta_hospitalar_item_id FROM movimento_estoque WHERE insumo_id = ? AND estabelecimento_id = ? AND natureza = 'entrada' ORDER BY id DESC LIMIT 1",
      [I_REF, ids.est],
    );
    expect(Number(dev?.['conta_hospitalar_item_id'])).toBe(id);
  });

  it('suprimentos, conta fechada: a devolução é recusada e nada fica (nem o saldo, nem o item, nem o lançamento)', async () => {
    const escrever = (sql: string, p: unknown[]) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f3ec' }, (e) => e.executar(sql, p));
    const id = Number((await saidaDo(I_NEG))?.['conta_hospitalar_item_id']);
    const contar = async () =>
      Number(
        (
          await ler(
            "SELECT COUNT(*) AS n FROM movimento_estoque WHERE estabelecimento_id = ? AND natureza = 'entrada'",
            [ids.est],
          )
        )?.['n'],
      );
    const entradasAntes = await contar();
    await escrever(
      "UPDATE conta_hospitalar SET situacao = 'fechada', fechada_em = NOW(3), fechada_por_usuario_id = ? WHERE id = ?",
      [ids.farma, ids.conta],
    );
    try {
      expect(
        await codigoDe(
          opSup('registrarDevolucao', {
            saida: estado.docSaida,
            local: ids.farmacia,
            itens: [
              {
                lancamentoSaida: await itemDoDocumento(estado.docSaida, I_NEG),
                item: I_NEG,
                quantidade: 1,
                lotes: [{ loteSaida: await loteId('EC-3'), quantidade: 1 }],
              },
            ],
          }),
        ),
      ).toBe('conta-fechada');
    } finally {
      await escrever(
        "UPDATE conta_hospitalar SET situacao = 'aberta', fechada_em = NULL, fechada_por_usuario_id = NULL WHERE id = ?",
        [ids.conta],
      );
    }
    expect(await saldoDe(I_NEG)).toBe(8);
    expect(await contar()).toBe(entradasAntes);
    const i = await itemDaConta(id);
    expect([i?.['situacao'], Number(i?.['quantidade']), Number(i?.['versao'])]).toEqual(['lancado', 1, 1]);
    expect((await memoriaDo(id)).map((x) => x['operacao'])).toEqual(['inclusao']);
  });

  it('suprimentos, sem conta aberta ou sem item faturável: a saída fica faturável sem item na conta', async () => {
    const itens = async () =>
      Number(
        (
          await ler('SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [
            ids.conta,
          ])
        )?.['n'],
      );
    const antes = await itens();
    await saidaPaciente(ids.atendimento2, [{ item: I_SEM, quantidade: 1, lotes: [lote('EC-4', 1)] }]);
    const semConta = await saidaDo(I_SEM);
    expect(Number(semConta?.['atendimento_id'])).toBe(ids.atendimento2);
    expect([Number(semConta?.['faturavel']), semConta?.['conta_hospitalar_item_id']]).toEqual([1, null]);
    await saidaPaciente(ids.atendimento, [{ item: I_NAOFAT, quantidade: 1, lotes: [lote('EC-5', 1)] }]);
    const semFat = await saidaDo(I_NAOFAT);
    expect([Number(semFat?.['faturavel']), semFat?.['conta_hospitalar_item_id']]).toEqual([1, null]);
    expect([await saldoDe(I_SEM), await saldoDe(I_NAOFAT)]).toEqual([8, 9]);
    expect(await itens()).toBe(antes);
  });
});
