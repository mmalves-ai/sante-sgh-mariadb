// Integração da farmácia hospitalar da porta própria contra o MariaDB real (cliente de teste do lote, padrão f22_o2).
// Massa SINTÉTICA com o código "F24PF" (nenhuma pessoa real): um paciente internado na UTI sintética, a farmácia
// central, três insumos (um rastreável comum, um controlado da lista A1 e um antimicrobiano) com lote e saldo, uma
// prescrição com horários, os tipos de movimento, os motivos de devolução e as numerações do estabelecimento. Confere o
// contrato de efeito (linhas, saldos, versao, trilha e outbox) e as leituras da dispensação por horário, da entrega ao
// setor, da devolução, do cancelamento, da perda e da dupla conferência do controlado, do fechamento do livro, da
// dispensação ambulatorial com o envio nacional e da avaliação pelo horário, com as recusas de cada uma.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codigoEtiquetaDose, etiquetasAceitas, type LivroMontado } from '@sgh/contratos/regras-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  criarArmazemLocal,
  type Escritor,
  ErroOperacao,
  NucleoProprio,
} from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FUSO_PADRAO, instanteCivil } from '../exames/relogio.js';
import { PortaFarmaciaPropria } from './porta-propria.js';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import { moduloFarmacia } from './modulo.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F24PF';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('farmácia hospitalar da porta própria (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFarmaciaPropria;
  const ids = {
    est: 0,
    farma: 0,
    enf: 0,
    medico: 0,
    farmacia: 0,
    centro: 0,
    paciente: 0,
    atendimento: 0,
    dipirona: 0,
    morfina: 0,
    amoxicilina: 0,
    horarios: [] as number[],
  };
  let ctx: ContextoNucleo;
  let ctxEnf: ContextoNucleo;
  let chave = 0;
  const op = (c: ContextoNucleo, nome: string, entrada: unknown, extra: Partial<ContextoOperacao> = {}) =>
    porta.executar(c, nome, entrada, {
      ...c,
      chaveIdempotencia: `f24pf-${Date.now()}-${(chave += 1)}`,
      ...extra,
    });

  const limpar = (e: Escritor) =>
    (async () => {
      const est = [ids.est];
      await limparTrilhaDaMassa(e, { ids: est });
      for (const sql of [
        'DELETE FROM idempotencia_operacao WHERE estabelecimento_id = ?',
        'DELETE FROM integracao_mensagem WHERE estabelecimento_id = ?',
        'DELETE FROM conferencia_controlado WHERE estabelecimento_id = ?',
        'DELETE ei FROM envio_controlado_nacional_item ei JOIN envio_controlado_nacional en ON en.id = ei.envio_controlado_nacional_id WHERE en.estabelecimento_id = ?',
        'DELETE FROM envio_controlado_nacional WHERE estabelecimento_id = ?',
        'DELETE t FROM termo_livro_controlado t JOIN livro_controlado l ON l.id = t.livro_controlado_id WHERE l.estabelecimento_id = ?',
        'DELETE FROM livro_controlado WHERE estabelecimento_id = ?',
        "DELETE FROM arquivo WHERE estabelecimento_id = ? AND finalidade = 'livro_controlado'",
        'DELETE FROM etiqueta_identificacao WHERE estabelecimento_id = ?',
        'DELETE esi FROM entrega_setor_item esi JOIN entrega_setor es ON es.id = esi.entrega_setor_id WHERE es.estabelecimento_id = ?',
        'DELETE FROM entrega_setor WHERE estabelecimento_id = ?',
        'UPDATE receita_controlada SET dispensacao_id = NULL WHERE estabelecimento_id = ?',
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
        'DELETE FROM receita_controlada WHERE estabelecimento_id = ?',
        'DELETE ai FROM avaliacao_farmaceutica_item ai JOIN avaliacao_farmaceutica a ON a.id = ai.avaliacao_farmaceutica_id WHERE a.estabelecimento_id = ?',
        'DELETE FROM avaliacao_farmaceutica WHERE estabelecimento_id = ?',
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
        await e.executar(sql, est);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-f24pf' }, async (e) => {
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
        { login: 'f24pf.farma' },
        { nome: 'FARMACEUTICO SINTETICO F24PF', tipo_conta: 'servico' },
      );
      ids.enf = await g(
        'usuario',
        { login: 'f24pf.enf' },
        { nome: 'ENFERMEIRO SINTETICO F24PF', tipo_conta: 'servico' },
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
        { numero_prontuario: 924_000_001, situacao: 'ativo' },
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
        { nome: 'UTI SINTETICA F24PF', tipo: 'assistencial' },
      );
      ids.centro = await g(
        'centro_custo',
        { estabelecimento_id: ids.est, codigo: `${P}-CC` },
        { nome: 'UTI SINTETICA F24PF', vigencia_inicio: '2026-01-01' },
      );
      const ui = await g(
        'unidade_internacao',
        { estabelecimento_id: ids.est, codigo: 'UTI-F24PF' },
        {
          unidade_assistencial_id: ua,
          descricao: 'UTI SINTETICA F24PF',
          tipo: 'uti_adulto',
          setor_funcional_id: setor,
          centro_custo_id: ids.centro,
        },
      );
      ids.farmacia = await g(
        'local_estoque',
        { estabelecimento_id: ids.est, codigo: `${P}-FC` },
        { nome: 'FARMACIA SINTETICA F24PF', tipo: 'farmacia_central' },
      );
      // Cadastros do estoque: unidade, grupo, insumos, lista A1, tipos de movimento e motivos de devolução.
      const um = await g(
        'unidade_medida',
        { codigo: `${P}-UN` },
        { descricao: 'UNIDADE F24PF', sigla: 'UNF24' },
      );
      const grupo = await g(
        'grupo_insumo',
        { codigo: `${P}-MED` },
        { descricao: 'MEDICAMENTOS F24PF', natureza: 'medicamento' },
      );
      const listaA1 = await g(
        'lista_controle_especial',
        { codigo_lista: 'A1' },
        { descricao: 'ENTORPECENTES', vigencia_inicio: '2020-01-01', versao_fonte: 'teste' },
      );
      const insumo = (codigo: string, nome: string, extra: Record<string, unknown>) =>
        g(
          'insumo',
          { codigo },
          {
            nome,
            tipo: 'medicamento',
            grupo_insumo_id: grupo,
            estoque_unidade_medida_id: um,
            controla_lote: true,
            controla_validade: true,
            ...extra,
          },
        );
      ids.dipirona = await insumo(`${P}-DIPI`, 'DIPIRONA SINTETICA F24PF', { codigo_gtin: '7890000024001' });
      ids.morfina = await insumo(`${P}-MORF`, 'MORFINA SINTETICA F24PF', {
        controlado: true,
        lista_controle_especial_id: listaA1,
      });
      ids.amoxicilina = await insumo(`${P}-AMOX`, 'AMOXICILINA SINTETICA F24PF', { antimicrobiano: true });
      for (const [codigo, natureza, sentido] of [
        [`${P}-CONS`, 'consumo_paciente', 'saida'],
        [`${P}-DEV`, 'devolucao', 'entrada'],
        [`${P}-PERDA`, 'perda', 'saida'],
      ] as const)
        await g(
          'tipo_movimento_estoque',
          { codigo },
          { descricao: `MOVIMENTO ${codigo}`, natureza, sentido, afeta_saldo: true },
        );
      for (const codigo of ['nao-administrado', 'suspenso', 'sobra', 'outro'])
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
      for (const [ins, numero, q, custo] of [
        [ids.dipirona, 'DP-1', 50, 2.5],
        [ids.morfina, 'MF-1', 20, 10],
        [ids.amoxicilina, 'AX-1', 30, 1],
      ] as const) {
        const lote = await e.inserir(
          'INSERT INTO lote_insumo (estabelecimento_id, insumo_id, numero_lote, validade, criado_em) VALUES (?, ?, ?, ?, ?)',
          [ids.est, ins, numero, '2099-12-31', agora],
        );
        await e.inserir(
          `INSERT INTO saldo_lote (estabelecimento_id, local_estoque_id, lote_insumo_id, quantidade, competencia, criado_em)
           VALUES (?, ?, ?, ?, '2026-11-01', ?)`,
          [ids.est, ids.farmacia, lote, q, agora],
        );
        await e.inserir(
          'INSERT INTO saldo_estoque (estabelecimento_id, local_estoque_id, insumo_id, quantidade, custo_medio, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          [ids.est, ids.farmacia, ins, q, custo, agora],
        );
      }
      // Atendimento, internação na UTI sintética, prescrição com dois itens e os horários.
      const tiss = await g(
        'carater_atendimento_tiss',
        { codigo_tiss: 'F4' },
        { descricao: 'CARATER F24PF', versao_fonte: 'teste' },
      );
      const cat = await g(
        'categoria_atendimento',
        { codigo: `${P}-INT` },
        { descricao: 'INTERNACAO F24PF', tipo_base: 'internacao' },
      );
      const fonte = await g(
        'fonte_pagadora',
        { codigo: `${P}-OP` },
        { nome: 'OPERADORA F24PF', tipo: 'operadora', situacao: 'ativa' },
      );
      ids.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
           fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3) - INTERVAL 1 DAY, ?)`,
        [ids.est, `${P}-AT1`, ids.paciente, cat, tiss, fonte, ids.medico, agora],
      );
      const catAc = await g(
        'categoria_acomodacao',
        { codigo: `${P}-UTI` },
        { descricao: 'UTI F24PF', tipo: 'terapia_intensiva' },
      );
      const acomodacao = await g(
        'acomodacao',
        { estabelecimento_id: ids.est, codigo: `${P}-AC` },
        { unidade_internacao_id: ui, categoria_acomodacao_id: catAc, nome: 'UTI F24PF' },
      );
      await e.inserir(
        `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada, carater_admissao_id,
           modalidade_internacao_id, unidade_internacao_id, acomodacao_id, especialidade_medica_id, medico_assistente_profissional_id,
           fonte_pagadora_id, situacao, criado_em) VALUES (?, ?, ?, ?, NOW(3) - INTERVAL 1 DAY, ?, ?, ?, ?, ?, ?, ?, 'ativa', ?)`,
        [
          ids.est,
          `${P}-I1`,
          ids.atendimento,
          ids.paciente,
          await g('carater_admissao', { codigo: `${P}-EL` }, { descricao: 'ELETIVA F24PF' }),
          await g('modalidade_internacao', { codigo: `${P}-CL` }, { descricao: 'CLINICA F24PF' }),
          ui,
          acomodacao,
          await g('especialidade_medica', { codigo: `${P}-CM` }, { descricao: 'CLINICA MEDICA F24PF' }),
          ids.medico,
          fonte,
          agora,
        ],
      );
      const prescricao = await e.inserir(
        `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id, situacao,
           prescrito_em, vigencia_inicio_em, vigencia_fim_em, criado_em)
         VALUES (?, 924001, ?, ?, ?, 'vigente', NOW(3) - INTERVAL 1 HOUR, NOW(3) - INTERVAL 1 HOUR, NOW(3) + INTERVAL 23 HOUR, ?)`,
        [ids.est, ids.paciente, ids.atendimento, ids.medico, agora],
      );
      const tipoItem = await g(
        'tipo_item_prescricao',
        { codigo: `${P}-MED` },
        { descricao: 'MEDICAMENTO F24PF', categoria: 'medicamento' },
      );
      const prescritivel = (codigo: string, descricao: string, ins: number) =>
        g('item_prescritivel', { codigo }, { descricao, tipo_item_prescricao_id: tipoItem, insumo_id: ins });
      const situacao = await g(
        'situacao_checagem',
        { codigo: `${P}-P` },
        { descricao: 'PENDENTE F24PF', categoria: 'pendente' },
      );
      let seq = 0;
      for (const [ip, horas] of [
        [await prescritivel(`${P}-DIPI`, 'DIPIRONA 1 G (SINTETICO)', ids.dipirona), [1, 2, 3]],
        [await prescritivel(`${P}-MORF`, 'MORFINA 10 MG (SINTETICO)', ids.morfina), [1]],
      ] as const) {
        seq += 1;
        const item = await e.inserir(
          `INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, item_prescritivel_id, quantidade,
             inicio_em, lancamento_profissional_id, situacao, criado_em) VALUES (?, ?, ?, ?, 1, NOW(3) - INTERVAL 1 HOUR, ?, 'ativo', ?)`,
          [prescricao, seq, tipoItem, ip, ids.medico, agora],
        );
        for (const h of horas)
          ids.horarios.push(
            await e.inserir(
              `INSERT INTO horario_administracao (estabelecimento_id, atendimento_id, prescricao_id, prescricao_item_id, previsto_em,
                 situacao_checagem_id, criado_em) VALUES (?, ?, ?, ?, NOW(3) + INTERVAL ${h} HOUR, ?, ?)`,
              [ids.est, ids.atendimento, prescricao, item, situacao, agora],
            ),
          );
      }
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.farma, correlacao: 'teste-f24pf' };
    ctxEnf = { ...ctx, usuario: ids.enf };
    porta = new PortaFarmaciaPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-f24pf' }, limpar);
    await nucleo.encerrar();
  });

  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f24pf' }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );
  const contar = async (sql: string, p: unknown[]) => Number((await ler(sql, p))?.['n']);
  const saldo = async (insumo: number) =>
    Number(
      (
        await ler('SELECT quantidade FROM saldo_estoque WHERE insumo_id = ? AND estabelecimento_id = ?', [
          insumo,
          ids.est,
        ])
      )?.['quantidade'],
    );
  const outbox = (ponto: string) =>
    contar('SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = ? AND estabelecimento_id = ?', [
      ponto,
      ids.est,
    ]);
  const dispensar = (horarios: number[], q = 1) =>
    op(ctx, 'suprimentos.dispensarHorario', {
      atendimento: ids.atendimento,
      local: ids.farmacia,
      centroCusto: ids.centro,
      doses: horarios.map((horario) => ({
        horario,
        quantidade: q,
        lotes: [{ lote: 'DP-1', validade: '2099-12-31', quantidade: q }],
      })),
    });
  const estado = { doses: [] as number[], saida: 0, controle: 0 };

  it('fila e dispensação por horário: dispensação, item, dose, documento, razão, saldos, entrega, trilha e outbox', async () => {
    const [h1, h2, , h4] = ids.horarios as [number, number, number, number];
    const agora = Date.now();
    const fila = await porta.filaDaUnidade(ctx, {
      unidade: 'UTI-F24PF',
      inicio: new Date(agora - 3_600_000),
      fim: new Date(agora + 5 * 3_600_000),
    });
    expect(fila.cortada).toBe(false);
    expect(fila.doses.map((d) => d.horario.id).sort((a, b) => a - b)).toEqual(ids.horarios);
    expect(fila.doses[0]).toMatchObject({
      atendimento: ids.atendimento,
      paciente: ids.paciente,
      iniciais: 'PSF',
      dispensada: false,
      validadaAntes: false,
    });
    expect(fila.doses[0]!.horario).toMatchObject({
      produto: ids.dipirona,
      dose: 1,
      suspenso: false,
      tipo: 'medicamento',
    });
    // Outro estabelecimento não vê a fila.
    expect(
      (
        await porta.filaDaUnidade(
          { ...ctx, estabelecimento: ids.est + 100_000 },
          { unidade: 'UTI-F24PF', inicio: new Date(0), fim: new Date(agora + 9e7) },
        )
      ).doses,
    ).toEqual([]);

    // C2-024 (05-SUP linha 14): a etiqueta de identificação lida da dose sai consumida com o movimento da dispensação.
    const etiqueta = `EF${P}`.toUpperCase().slice(0, 40);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'etiqueta-teste-f24pf' }, (e) =>
      e.executar(
        `INSERT INTO etiqueta_identificacao (estabelecimento_id, identificador, insumo_id, unidade_medida_id, quantidade, criado_em)
         SELECT ?, ?, id, estoque_unidade_medida_id, 1, ? FROM insumo WHERE id = ?`,
        [ids.est, etiqueta, new Date(), ids.dipirona],
      ),
    );
    const r = await op(ctx, 'suprimentos.dispensarHorario', {
      atendimento: ids.atendimento,
      local: ids.farmacia,
      centroCusto: ids.centro,
      doses: [
        {
          horario: h1,
          quantidade: 2,
          lotes: [{ lote: 'DP-1', validade: '2099-12-31', quantidade: 2 }],
          etiquetas: [etiqueta.toLowerCase()],
        },
        { horario: h2, quantidade: 1, lotes: [{ lote: 'DP-1', validade: '2099-12-31', quantidade: 1 }] },
      ],
    });
    expect(r.repetida).toBe(false);
    expect(r.resultado).toMatchObject({ doses: 2, ocupadas: 0, doc: 1, docSaida: 1 });
    estado.doses = String(r.resultado['idsDoses']).split(',').map(Number);
    estado.saida = Number(r.resultado['saida']);
    estado.controle = Number(r.resultado['controle']);
    expect(
      await ler(
        `SELECT e.situacao, m.insumo_id AS insumo, m.atendimento_id AS atendimento FROM etiqueta_identificacao e
           JOIN movimento_estoque m ON m.id = e.movimento_consumo_id WHERE e.estabelecimento_id = ? AND e.identificador = ?`,
        [ids.est, etiqueta],
      ),
    ).toMatchObject({ situacao: 'consumida', insumo: ids.dipirona, atendimento: ids.atendimento });
    expect(await saldo(ids.dipirona)).toBe(47);
    expect(
      Number(
        (
          await ler(
            'SELECT quantidade FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id WHERE li.numero_lote = ? AND sl.estabelecimento_id = ?',
            ['DP-1', ids.est],
          )
        )?.['quantidade'],
      ),
    ).toBe(47);
    expect(
      await ler('SELECT situacao, tipo, versao FROM dispensacao WHERE id = ?', [r.resultado['dispensacao']]),
    ).toMatchObject({ situacao: 'dispensada', tipo: 'horario', versao: 1 });
    expect(
      await ler('SELECT tipo, situacao, valor_total FROM documento_estoque WHERE id = ?', [estado.saida]),
    ).toMatchObject({ tipo: 'saida_paciente', situacao: 'concluido' });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM movimento_estoque WHERE documento_estoque_id = ? AND natureza = 'saida' AND faturavel",
        [estado.saida],
      ),
    ).toBe(2);
    expect(await ler('SELECT situacao FROM entrega_setor WHERE id = ?', [estado.controle])).toMatchObject({
      situacao: 'em_transito',
    });
    expect(
      await ler('SELECT dispensacao_id, versao FROM horario_administracao WHERE id = ?', [h1]),
    ).toMatchObject({ dispensacao_id: r.resultado['dispensacao'], versao: 2 });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'dispensacao' AND entidade_id = ? AND estabelecimento_id = ?",
        [r.resultado['dispensacao'], ids.est],
      ),
    ).toBe(1);
    expect(await outbox('farmacia.dispensacao.registrada')).toBe(1);

    // O mesmo horário de novo (outra chave) é recusado; o controlado sem registro do prescritor no conselho também.
    expect(codigoDe(await dispensar([h1]).catch((e: unknown) => e))).toBe('dose-ja-dispensada');
    const controlado = await op(ctx, 'suprimentos.dispensarHorario', {
      atendimento: ids.atendimento,
      local: ids.farmacia,
      centroCusto: ids.centro,
      doses: [
        { horario: h4, quantidade: 1, lotes: [{ lote: 'MF-1', validade: '2099-12-31', quantidade: 1 }] },
      ],
    }).catch((e: unknown) => e);
    expect(codigoDe(controlado)).toBe('sem-prescritor');
    expect(await saldo(ids.morfina)).toBe(20);

    // As leituras: doses do atendimento, entregas em trânsito, doses da saída, leito e a fila marcada.
    const doses = await porta.dosesDoAtendimento(ctx, ids.atendimento, new Date(agora - 86_400_000));
    expect(doses.map((d) => d.dose)).toEqual(estado.doses);
    expect(doses[0]).toMatchObject({
      horario: h1,
      item: ids.dipirona,
      quantidade: 2,
      lote: 'DP-1',
      validade: '2099-12-31',
      situacaoEntrega: 7,
      devolvido: 0,
      barras: '7890000024001',
    });
    expect(doses[0]!.saida).toMatchObject({ id: estado.saida, doc: 1 });
    const entregas = await porta.entregas(ctx, { situacao: 7 });
    expect(entregas.find((x) => x.controle === estado.controle)).toMatchObject({
      atendimento: ids.atendimento,
      centroCusto: ids.centro,
      usuario: 'f24pf.farma',
      itens: 2,
    });
    expect((await porta.dosesDaSaida(ctx, estado.saida)).map((d) => d.dose)).toEqual(estado.doses);
    expect((await porta.leitos(ctx, [ids.atendimento])).get(ids.atendimento)).toEqual({
      leito: '',
      iniciais: 'PSF',
    });
    expect((await porta.janelaEntregas(ctx)).desde).not.toBeNull();
    const depois = await porta.filaDaUnidade(ctx, {
      unidade: 'UTI-F24PF',
      inicio: new Date(agora - 3_600_000),
      fim: new Date(agora + 5 * 3_600_000),
    });
    expect(depois.doses.find((d) => d.horario.id === h1)?.dispensada).toBe(true);
    expect(codigoDe(await porta.entregas(ctx, { situacao: 3 }).catch((e: unknown) => e))).toBe(
      'situacao-invalida',
    );
  });

  it('entrega ao setor: aceite pela leitura da etiqueta, entregue com quem recebeu, e recusas', async () => {
    const [dose1] = estado.doses as [number];
    const etiqueta = etiquetasAceitas(
      codigoEtiquetaDose({
        dose: dose1,
        item: ids.dipirona,
        barras: '7890000024001',
        lote: 'DP-1',
        validade: '2099-12-31',
      }),
    )[0]!;
    expect(
      codigoDe(
        await op(ctxEnf, 'suprimentos.confirmarEntrega', { controle: 999_999_999, modo: 'tablet' }).catch(
          (e: unknown) => e,
        ),
      ),
    ).toBe('controle-inexistente');
    const r = await op(ctxEnf, 'suprimentos.confirmarEntrega', {
      controle: estado.controle,
      modo: 'leitura',
      leitura: etiqueta,
    });
    expect(r.resultado).toMatchObject({ controle: estado.controle, saida: estado.saida });
    expect(
      await ler('SELECT situacao, recebedor_usuario_id, modo_confirmacao FROM entrega_setor WHERE id = ?', [
        estado.controle,
      ]),
    ).toMatchObject({
      situacao: 'entregue',
      recebedor_usuario_id: ids.enf,
      modo_confirmacao: 'leitura',
    });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM dose_dispensada WHERE id IN (?, ?) AND situacao = 'entregue'",
        estado.doses,
      ),
    ).toBe(2);
    expect((await porta.aceites(ctx, [estado.controle])).get(estado.controle)).toMatchObject({
      autor: 'f24pf.enf',
      modo: 'leitura',
    });
    expect((await porta.entregas(ctx, { situacao: 8 })).map((x) => x.controle)).toContain(estado.controle);
    // A segunda confirmação é recusada pela regra (a entrega já foi recebida).
    expect(
      await op(ctxEnf, 'suprimentos.confirmarEntrega', { controle: estado.controle, modo: 'tablet' }).catch(
        (e: unknown) => e,
      ),
    ).toBeInstanceOf(ErroOperacao);
    expect(await outbox('farmacia.entrega.confirmada')).toBe(1);
  });

  it('devolução da dose: documento de entrada, devolução conferida, saldo de volta e recusa acima do dispensado', async () => {
    const [dose1] = estado.doses as [number];
    const r = await op(ctxEnf, 'suprimentos.devolverDose', {
      dose: dose1,
      local: ids.farmacia,
      quantidade: 1,
      lote: 'DP-1',
      motivo: 'nao-administrado',
    });
    expect(r.resultado).toMatchObject({ dose: dose1, itens: 1 });
    expect(await saldo(ids.dipirona)).toBe(48);
    expect(
      await ler(
        'SELECT situacao, documento_estoque_id FROM devolucao_dispensacao WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 1',
        [ids.est],
      ),
    ).toMatchObject({
      situacao: 'conferida',
      documento_estoque_id: r.resultado['id'],
    });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM movimento_estoque WHERE documento_estoque_id = ? AND natureza = 'entrada'",
        [r.resultado['id']],
      ),
    ).toBe(1);
    expect(
      (await porta.dosesDoAtendimento(ctx, ids.atendimento, new Date(0))).find((d) => d.dose === dose1),
    ).toMatchObject({ devolvido: 1 });
    expect(
      codigoDe(
        await op(ctxEnf, 'suprimentos.devolverDose', {
          dose: dose1,
          local: ids.farmacia,
          quantidade: 2,
          lote: 'DP-1',
          motivo: 'sobra',
        }).catch((e: unknown) => e),
      ),
    ).toBe('quantidade-maior-que-a-saida');
    expect(
      codigoDe(
        await op(ctxEnf, 'suprimentos.devolverDose', {
          dose: dose1,
          local: ids.farmacia,
          quantidade: 1,
          lote: 'OUTRO',
          motivo: 'sobra',
        }).catch((e: unknown) => e),
      ),
    ).toBe('lote-diferente');
  });

  it('cancelamento antes da entrega: estorno no razão, horário de volta à fila, entrega estornada e recusas', async () => {
    const [, , h3] = ids.horarios as [number, number, number];
    const r = await dispensar([h3]);
    const dose = Number(r.resultado['idsDoses']);
    expect(await saldo(ids.dipirona)).toBe(47);
    const c = await op(ctx, 'suprimentos.cancelarDispensacao', {
      dose,
      motivo: 'Item suspenso pelo médico (texto sintético)',
    });
    expect(c.resultado).toMatchObject({ dose, saida: r.resultado['saida'] });
    expect(await saldo(ids.dipirona)).toBe(48);
    expect(
      await ler('SELECT estorno_movimento_estoque_id FROM movimento_estoque WHERE id = ?', [
        c.resultado['id'],
      ]),
    ).not.toMatchObject({ estorno_movimento_estoque_id: null });
    expect(await ler('SELECT dispensacao_id FROM horario_administracao WHERE id = ?', [h3])).toMatchObject({
      dispensacao_id: null,
    });
    expect(
      await ler('SELECT situacao FROM entrega_setor WHERE id = ?', [r.resultado['controle']]),
    ).toMatchObject({ situacao: 'estornada' });
    expect(
      await ler('SELECT situacao FROM dispensacao WHERE id = ?', [r.resultado['dispensacao']]),
    ).toMatchObject({ situacao: 'cancelada' });
    expect(
      await ler('SELECT situacao FROM documento_estoque WHERE id = ?', [r.resultado['saida']]),
    ).toMatchObject({ situacao: 'estornado' });
    expect((await porta.entregas(ctx, { situacao: 9 })).map((x) => x.controle)).toContain(
      Number(r.resultado['controle']),
    );
    expect(
      codigoDe(
        await op(ctx, 'suprimentos.cancelarDispensacao', {
          dose,
          motivo: 'Outra tentativa (texto sintético)',
        }).catch((e: unknown) => e),
      ),
    ).toBe('nao-dispensada');
    expect(
      codigoDe(
        await op(ctx, 'suprimentos.cancelarDispensacao', {
          dose: estado.doses[1],
          motivo: 'Já entregue (texto sintético)',
        }).catch((e: unknown) => e),
      ),
    ).toBe('ja-entregue');
  });

  it('controlado: perda com testemunha, dupla conferência por documento e lote, movimentos e conferências', async () => {
    const hoje = (await porta.relogio(ctx)).hoje;
    const perda = {
      item: ids.morfina,
      local: ids.farmacia,
      centroCusto: ids.centro,
      lote: 'MF-1',
      validade: '2099-12-31',
      quantidade: 1,
      motivo: 'Ampola quebrada na bancada (texto sintético)',
    };
    expect(
      codigoDe(
        await op(
          ctx,
          'suprimentos.registrarPerdaControlado',
          { ...perda, testemunha: 'f24pf.farma' },
          { reautenticadoEm: Date.now() },
        ).catch((e: unknown) => e),
      ),
    ).toBe('sem-testemunha');
    expect(
      codigoDe(
        await op(ctx, 'suprimentos.registrarPerdaControlado', {
          ...perda,
          item: ids.dipirona,
          lote: 'DP-1',
          testemunha: 'f24pf.enf',
        }).catch((e: unknown) => e),
      ),
    ).toBe('nao-controlado');
    const r = await op(
      ctx,
      'suprimentos.registrarPerdaControlado',
      { ...perda, testemunha: 'f24pf.enf' },
      { reautenticadoEm: Date.now() },
    );
    const doc = Number(r.resultado['id']);
    expect(await saldo(ids.morfina)).toBe(19);
    expect(await ler('SELECT tipo, situacao FROM documento_estoque WHERE id = ?', [doc])).toMatchObject({
      tipo: 'baixa',
      situacao: 'concluido',
    });
    expect(
      await ler(
        'SELECT documento_tipo, conferente_usuario_id FROM conferencia_controlado WHERE documento_estoque_id = ?',
        [doc],
      ),
    ).toMatchObject({
      documento_tipo: 'perda',
      conferente_usuario_id: ids.enf,
    });
    const movs = await porta.movimentos(ctx, {
      itens: [ids.morfina],
      inicio: new Date(`${hoje}T00:00:00`),
      fim: new Date(`${hoje}T00:00:00`),
    });
    expect(movs).toEqual([
      {
        item: ids.morfina,
        data: hoje,
        tipo: 'perda',
        quantidade: 1,
        documento: `P ${r.resultado['doc']}`,
        documentoId: doc,
        prescritor: null,
      },
    ]);
    // O período do livro é o dia civil do estabelecimento: um movimento às 23:30 locais fica no seu dia, não no seguinte.
    const fuso = String(
      (await ler('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [ids.est]))?.['fuso_horario'] ||
        FUSO_PADRAO,
    );
    const original = (await ler(
      'SELECT id, ocorrido_em FROM movimento_estoque WHERE documento_estoque_id = ?',
      [doc],
    ))!;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f24pf' }, (e) =>
      e.executar('UPDATE movimento_estoque SET ocorrido_em = ? WHERE id = ?', [
        instanteCivil('2026-03-10', '23:30', fuso),
        original['id'],
      ]),
    );
    const doDia = (dia: string) =>
      porta.movimentos(ctx, {
        itens: [ids.morfina],
        inicio: new Date(`${dia}T00:00:00`),
        fim: new Date(`${dia}T00:00:00`),
      });
    expect((await doDia('2026-03-10')).map((x) => x.data)).toEqual(['2026-03-10']);
    expect(await doDia('2026-03-11')).toEqual([]);
    expect(await doDia('2026-03-09')).toEqual([]);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f24pf' }, (e) =>
      e.executar('UPDATE movimento_estoque SET ocorrido_em = ? WHERE id = ?', [
        original['ocorrido_em'],
        original['id'],
      ]),
    );
    expect(
      (await porta.conferencias(ctx, new Date(Date.now() - 86_400_000))).filter(
        (x) => x.item === ids.morfina,
      ),
    ).toEqual([{ item: ids.morfina, docTipo: 'perda', docId: doc, tipo: 'perda' }]);
    // A dupla conferência da saída da dispensação: o conferente é outra pessoa, reautenticada; uma vez por documento e lote.
    const conferir = (c: ContextoNucleo, conferente: string) =>
      porta.gravarSgh(c, null, (g) =>
        g.conferirControlado({
          item: ids.dipirona,
          documento: { tipo: 'saida', id: estado.saida },
          lote: 'DP-1',
          quantidadeDocumento: 3,
          quantidadeContada: 3,
          justificativa: '',
          conferente,
          reautenticadoEm: Date.now(),
          agora: Date.now(),
        }),
      );
    expect(codigoDe(await conferir(ctx, 'f24pf.farma').catch((e: unknown) => e))).toBe('conferente-igual');
    const cf = await conferir(ctxEnf, 'f24pf.enf');
    expect(
      await ler(
        'SELECT documento_tipo, conferente_usuario_id, versao FROM conferencia_controlado WHERE id = ?',
        [cf.id],
      ),
    ).toMatchObject({
      documento_tipo: 'saida',
      conferente_usuario_id: ids.enf,
      versao: 1,
    });
    expect(codigoDe(await conferir(ctxEnf, 'f24pf.enf').catch((e: unknown) => e))).toBe('ja-conferido');
  });

  it('livro de controlados: fechamento de conferência com hash e guarda, lido de volta; o oficial espera o armazenamento', async () => {
    const livro = (modo: 'conferencia' | 'oficial') =>
      ({
        livro: 1,
        inicio: '2026-11-01',
        fim: '2026-11-07',
        modo,
        titulo: 'LIVRO SINTETICO',
        paginas: [],
        termoAbertura: '',
        termoEncerramento: '',
      }) as unknown as LivroMontado;
    const fechar = (modo: 'conferencia' | 'oficial') =>
      porta.gravarSgh(ctx, null, (g) =>
        g.fecharLivro({
          livro: livro(modo),
          usuario: 'f24pf.farma',
          responsavelTecnico: true,
          chaveOficialLigada: true,
        }),
      );
    const r = await fechar('conferencia');
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.guardaAte > '2026-11-07').toBe(true);
    expect(await porta.livroFechado(ctx, 1, new Date('2026-11-01T00:00:00'))).toMatchObject({
      hash: r.hash,
      guardaAte: r.guardaAte,
      por: 'f24pf.farma',
      modo: 'conferencia',
      // O estabelecimento do teste não tem CNPJ: o de conferência fecha sem termo, e a leitura não inventa.
      termos: [],
    });
    expect(await porta.livroFechado(ctx, 2, new Date('2026-11-01T00:00:00'))).toBeNull();
    expect(await fechar('conferencia').catch((e: unknown) => e)).toBeInstanceOf(ErroOperacao);
    expect(codigoDe(await fechar('oficial').catch((e: unknown) => e))).toBe('armazenamento-indisponivel');
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM livro_controlado WHERE estabelecimento_id = ? AND modo_fechamento = 'oficial'",
        [ids.est],
      ),
    ).toBe(0);
  });

  it('livro oficial: conteúdo guardado no disco local (ADR 0004) com o hash, termos de abertura e encerramento e o emitente exigido', async () => {
    const raizAntes = process.env['ARQUIVOS_RAIZ'];
    const raiz = await mkdtemp(join(tmpdir(), 'f36-livro-'));
    process.env['ARQUIVOS_RAIZ'] = raiz;
    const livro = {
      livro: 2,
      inicio: '2026-11-08',
      fim: '2026-11-14',
      modo: 'oficial',
      titulo: 'LIVRO SINTETICO OFICIAL',
      paginas: [{ pagina: 1 }, { pagina: 2 }, { pagina: 3 }],
      termoAbertura: 'ABERTURA SINTETICA',
      termoEncerramento: 'ENCERRAMENTO SINTETICO',
    } as unknown as LivroMontado;
    const fechar = (conteudo: { arquivo: number; hash: string } | null) =>
      porta.gravarSgh(ctx, null, (g) =>
        g.fecharLivro({
          livro,
          usuario: 'f24pf.farma',
          responsavelTecnico: true,
          chaveOficialLigada: true,
          conteudo,
        }),
      );
    const cnpj = (v: string | null) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f36-livro' }, (e) =>
        e.executar('UPDATE estabelecimento SET cnpj = ? WHERE id = ?', [v, ids.est]),
      );
    try {
      const arq = await porta.guardarConteudoLivro(ctx, livro);
      expect(arq.hash).toMatch(/^[0-9a-f]{64}$/);
      // Sem CNPJ no cadastro o oficial recusa, e nada fica no livro.
      expect(codigoDe(await fechar(arq).catch((e: unknown) => e))).toBe('estabelecimento-sem-cnpj');
      await cnpj('92400000000155');
      // O arquivo de outro conteúdo não serve: o hash tem de ser o deste livro.
      const outro = await porta.guardarConteudoLivro(ctx, { ...livro, titulo: 'OUTRO' } as LivroMontado);
      expect(
        codigoDe(await fechar({ arquivo: outro.arquivo, hash: arq.hash }).catch((e: unknown) => e)),
      ).toBe('conteudo-divergente');
      const r = await fechar(arq);
      expect(r.hash).toBe(arq.hash);
      expect(
        await ler(
          'SELECT modo_fechamento, conteudo_arquivo_id, hash_conteudo, situacao, guarda_ate FROM livro_controlado WHERE id = ?',
          [r.id],
        ),
      ).toMatchObject({
        modo_fechamento: 'oficial',
        conteudo_arquivo_id: arq.arquivo,
        hash_conteudo: arq.hash,
        situacao: 'encerrado',
      });
      const termos = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f36-livro' }, (l) =>
        l.consultar<Record<string, unknown>>(
          'SELECT tipo, sequencia, pagina_inicial, pagina_final, cnpj, arquivo_id FROM termo_livro_controlado WHERE livro_controlado_id = ? ORDER BY sequencia',
          [r.id],
        ),
      );
      expect(
        termos.map((t) => [t['tipo'], Number(t['sequencia']), Number(t['pagina_final']), t['cnpj']]),
      ).toEqual([
        ['abertura', 1, 3, '92400000000155'],
        ['encerramento', 2, 3, '92400000000155'],
      ]);
      expect(termos[0]?.['arquivo_id']).toBeNull();
      expect(Number(termos[1]?.['arquivo_id'])).toBe(arq.arquivo);
      // O arquivo no disco é o conteúdo do livro (hash conferido) e tem a guarda legal do livro.
      const meta = await ler(
        'SELECT chave_armazenamento, hash_sha256, retencao_ate, tipo_mime FROM arquivo WHERE id = ?',
        [arq.arquivo],
      );
      expect(meta).toMatchObject({ hash_sha256: arq.hash, tipo_mime: 'application/json' });
      expect(
        String(
          meta?.['retencao_ate'] instanceof Date
            ? (meta['retencao_ate'] as Date).toISOString()
            : meta?.['retencao_ate'],
        ).slice(0, 10),
      ).toBe('2028-11-14');
      // A leitura pela porta confere o hash no disco (falta ou divergência: erro); o conteúdo é o livro montado.
      const lido = await criarArmazemLocal(nucleo, { raiz }).ler(
        { cliente: CLIENTE, estabelecimento: ids.est, usuario: null, correlacao: 't-f36-livro' },
        arq.arquivo,
      );
      expect(createHash('sha256').update(lido.conteudo).digest('hex')).toBe(arq.hash);
      expect(JSON.parse(lido.conteudo.toString('utf8'))).toMatchObject({ titulo: 'LIVRO SINTETICO OFICIAL' });
      // A leitura do livro fechado devolve os termos GRAVADOS (emitente e responsável da época), abertura primeiro;
      // só o de encerramento cita o conteúdo guardado.
      const responsavel = await ler(
        `SELECT COALESCE(NULLIF(pr.nome_exibicao, ''), pf.nome) AS nome
           FROM livro_controlado lc JOIN profissional pr ON pr.id = lc.responsavel_tecnico_profissional_id
           JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id WHERE lc.id = ?`,
        [r.id],
      );
      const fechado = await porta.livroFechado(ctx, 2, new Date('2026-11-08T00:00:00'));
      expect(fechado).toMatchObject({ modo: 'oficial', hash: arq.hash });
      expect(String(responsavel?.['nome'] ?? '')).not.toBe('');
      expect(fechado?.termos).toEqual([
        {
          tipo: 'abertura',
          paginaInicial: 1,
          paginaFinal: 3,
          razaoSocial: expect.stringMatching(/\S/),
          cnpj: '92400000000155',
          responsavel: responsavel?.['nome'],
          emitidoEm: fechado?.em,
          conteudoGuardado: false,
        },
        {
          tipo: 'encerramento',
          paginaInicial: 1,
          paginaFinal: 3,
          razaoSocial: expect.stringMatching(/\S/),
          cnpj: '92400000000155',
          responsavel: responsavel?.['nome'],
          emitidoEm: fechado?.em,
          conteudoGuardado: true,
        },
      ]);
      // O cadastro muda depois (o CNPJ sai no finally): o termo gravado continua o da época do fechamento.
      await cnpj(null);
      expect(
        (await porta.livroFechado(ctx, 2, new Date('2026-11-08T00:00:00')))?.termos.map((t) => t.cnpj),
      ).toEqual(['92400000000155', '92400000000155']);
      await cnpj('92400000000155');
      // Fechar de novo o mesmo período recusa.
      expect(codigoDe(await fechar(arq).catch((e: unknown) => e))).toBe('livro-fechado');
    } finally {
      await cnpj(null);
      if (raizAntes === undefined) delete process.env['ARQUIVOS_RAIZ'];
      else process.env['ARQUIVOS_RAIZ'] = raizAntes;
      await rm(raiz, { recursive: true, force: true });
    }
  });

  it('rotas do livro oficial: a tela pela HTTP sobre a porta própria, a chave e a permissão, o fechamento gravado e relido', async () => {
    // A app com o módulo da farmácia e a sessão sintética; a porta é a própria, com o contexto da massa (o
    // estabelecimento e o usuário sintéticos da sessão não existem no banco do cliente de teste). A chave do livro
    // oficial (aprovação prévia da Vigilância Sanitária) vem da configuração e começa desligada.
    const raizAntes = process.env['ARQUIVOS_RAIZ'];
    const raiz = await mkdtemp(join(tmpdir(), 'f36-livro-rota-'));
    process.env['ARQUIVOS_RAIZ'] = raiz;
    let oficialLigada = false;
    const chaveCfg = (id: string, recurso: string, ligada: () => boolean) => ({
      id,
      tipo: 'recurso' as const,
      chave: recurso,
      escopo: 'hospital' as const,
      valor: '*',
      get ligada() {
        return ligada();
      },
      ligadaAntes: null,
      lote: null,
      justificativa: 'Teste sintético do livro oficial',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-11-25T00:00:00.000Z',
    });
    const configuracao = fonteConfiguracaoMemoria(new RegistradorTrilhaMemoria(), {
      chavesIniciais: () => [
        chaveCfg('f36-rota-1', 'suprimentos.controlados', () => true),
        chaveCfg('f36-rota-2', 'suprimentos.livroControlados', () => oficialLigada),
      ],
      // As aprovações prévias declaradas das duas funcionalidades (conferência dos controlados e Vigilância Sanitária).
      prerequisitosIniciais: () =>
        ['suprimentos.controlados', 'suprimentos.livroControlados'].map((recurso) => ({
          recurso,
          tipo: 'aprovacao' as const,
          situacao: 'cumprido' as const,
          validade: null,
          evidencia: 'aprovação sintética do teste (sem dado real)',
          alteradoPor: 'SINT.ADMIN',
          alteradoEm: '2026-11-25T00:00:00.000Z',
        })),
    });
    const real = porta;
    const daMassa = new Proxy(real, {
      get(alvo, k) {
        const v = (alvo as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === 'function'
          ? (_c: unknown, ...resto: unknown[]) =>
              (v as (...a: unknown[]) => unknown).call(alvo, ctx, ...resto)
          : v;
      },
    });
    const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'farmacia' };
    const app = await criarApp(lerConfiguracao(env), null, env, {
      registro: {
        farmacia: async () => ({
          modulo: (c) => moduloFarmacia(c, { porta: daMassa, configuracao }),
        }),
      },
    });
    const cnpj = (v: string | null) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f36-rota' }, (e) =>
        e.executar('UPDATE estabelecimento SET cnpj = ? WHERE id = ?', [v, ids.est]),
      );
    try {
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      const entrar = async (login: string) => {
        const r = await app.inject({
          method: 'POST',
          url: '/api/sessao',
          payload: { estabelecimento: 'aa', login, senha: SENHA },
        });
        expect(r.statusCode).toBe(201);
        const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
        return {
          cookie: set.map((x) => x.split(';')[0]).join('; '),
          'x-csrf':
            set
              .find((x) => x.startsWith('sgh_csrf='))
              ?.split(';')[0]
              ?.slice(9) ?? '',
        };
      };
      let n = 0;
      const PERIODO = 'livro=1&inicio=2026-11-15&fim=2026-11-21';
      const lerLivro = (h: Record<string, string>) =>
        app.inject({
          method: 'GET',
          url: `/api/farmacia/livro?${PERIODO}`,
          headers: { cookie: h['cookie']! },
        });
      const fechar = (h: Record<string, string>, oficial: boolean) =>
        app.inject({
          method: 'POST',
          url: '/api/farmacia/livro/fechar',
          headers: { ...h, 'idempotency-key': `t-f36-rota-${Date.now()}-${++n}` },
          payload: { livro: 1, inicio: '2026-11-15', fim: '2026-11-21', oficial },
        });
      const cod = (r: { json(): unknown }) => (r.json() as { codigo?: string }).codigo;
      const oficiais = () =>
        contar(
          "SELECT COUNT(*) AS n FROM livro_controlado WHERE estabelecimento_id = ? AND modo_fechamento = 'oficial' AND periodo_inicio = '2026-11-15'",
          [ids.est],
        );
      const arquivos = () =>
        contar(
          "SELECT COUNT(*) AS n FROM arquivo WHERE estabelecimento_id = ? AND finalidade = 'livro_controlado'",
          [ids.est],
        );

      // Sem a permissão de fechar: 403, nada gravado.
      const outro = await entrar('SINT.AGENDA');
      expect((await fechar(outro, true)).statusCode).toBe(403);
      const farma = await entrar('SINT.FARMACEUTICO');
      // A tela lê o período aberto em modo conferência, sem fechamento.
      let r = await lerLivro(farma);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({
        modo: 'conferencia',
        fechado: null,
        inicio: '2026-11-15',
        fim: '2026-11-21',
      });
      // O formato que a tela lê (e que o E2E f36-livro-oficial @C1-038 simula sobre a fonte sintética) é o da API real.
      expect(Object.keys(r.json() as object)).toEqual(
        expect.arrayContaining([
          'livro',
          'titulo',
          'termoAbertura',
          'termoEncerramento',
          'paginas',
          'fechado',
        ]),
      );
      // A tela lê a chave do oficial desligada; o fechamento oficial é recusado pela chave e nada fica no banco.
      expect(
        (
          (
            await app.inject({
              method: 'GET',
              url: '/api/farmacia/gravacao',
              headers: { cookie: farma.cookie },
            })
          ).json() as {
            funcionalidades: Record<string, { ligada: boolean }>;
          }
        ).funcionalidades['livroOficial']?.ligada,
      ).toBe(false);
      const antesArquivos = await arquivos();
      r = await fechar(farma, true);
      expect(cod(r)).toBe('livro-oficial-desligado');
      expect(await oficiais()).toBe(0);
      expect(await arquivos()).toBe(antesArquivos);
      // A chave ligada pela configuração; sem CNPJ no cadastro o servidor recusa e nada fica no livro.
      oficialLigada = true;
      expect(
        (
          (
            await app.inject({
              method: 'GET',
              url: '/api/farmacia/gravacao',
              headers: { cookie: farma.cookie },
            })
          ).json() as {
            funcionalidades: Record<string, { ligada: boolean }>;
          }
        ).funcionalidades['livroOficial']?.ligada,
      ).toBe(true);
      const gravacao = (
        await app.inject({ method: 'GET', url: '/api/farmacia/gravacao', headers: { cookie: farma.cookie } })
      ).json() as { operacoes: Record<string, { ligada: boolean }> };
      expect(gravacao.operacoes['fecharLivro']?.ligada).toBe(true);
      expect(gravacao.operacoes['fecharLivroOficial']?.ligada).toBe(true);
      await cnpj(null);
      r = await fechar(farma, true);
      expect([r.statusCode, cod(r)]).toEqual([409, 'estabelecimento-sem-cnpj']);
      expect(r.headers['content-type']).toMatch(/problem\+json/);
      expect((r.json() as { detail?: string }).detail).toContain('CNPJ do estabelecimento');
      expect(await oficiais()).toBe(0);
      // Com o CNPJ: o fechamento oficial grava o livro, o arquivo do conteúdo com o hash e os dois termos.
      await cnpj('92400000000155');
      r = await fechar(farma, true);
      expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
      const feito = r.json() as { mensagem: string; ids: { livro: number; hash: string } };
      expect(Object.keys(feito)).toEqual(expect.arrayContaining(['mensagem', 'repetida', 'ids', 'avisos']));
      expect(feito.mensagem).toMatch(/oficial/);
      expect(feito.ids.hash).toMatch(/^[0-9a-f]{64}$/);
      const linha = await ler(
        'SELECT modo_fechamento, hash_conteudo, conteudo_arquivo_id, situacao FROM livro_controlado WHERE id = ?',
        [feito.ids.livro],
      );
      expect(linha).toMatchObject({
        modo_fechamento: 'oficial',
        hash_conteudo: feito.ids.hash,
        situacao: 'encerrado',
      });
      expect(
        await ler('SELECT hash_sha256 FROM arquivo WHERE id = ?', [Number(linha?.['conteudo_arquivo_id'])]),
      ).toMatchObject({ hash_sha256: feito.ids.hash });
      expect(
        await contar(
          'SELECT COUNT(*) AS n FROM termo_livro_controlado WHERE livro_controlado_id = ? AND cnpj = ?',
          [feito.ids.livro, '92400000000155'],
        ),
      ).toBe(2);
      // A tela relê do servidor: o período como oficial, com os termos gravados (abertura e encerramento) e o texto.
      r = await lerLivro(farma);
      const lido = r.json() as {
        modo: string;
        termoAbertura: string;
        fechado: {
          modo: string;
          hash: string;
          termos: { tipo: string; cnpj: string; conteudoGuardado: boolean; texto: string }[];
        };
      };
      expect(lido.modo).toBe('oficial');
      expect(lido.fechado).toMatchObject({ modo: 'oficial', hash: feito.ids.hash });
      expect(Object.keys(lido.fechado)).toEqual(expect.arrayContaining(['em', 'por', 'guardaAte', 'termos']));
      expect(Object.keys(lido.fechado.termos[0]!)).toEqual(
        expect.arrayContaining(['paginaInicial', 'paginaFinal', 'razaoSocial', 'responsavel', 'emitidoEm']),
      );
      expect(lido.fechado.termos.map((t) => [t.tipo, t.cnpj, t.conteudoGuardado])).toEqual([
        ['abertura', '92400000000155', false],
        ['encerramento', '92400000000155', true],
      ]);
      expect(lido.fechado.termos[0]?.texto).toMatch(/^Termo de abertura/);
      expect(lido.fechado.termos[1]?.texto).toMatch(/^Termo de encerramento/);
      expect(lido.fechado.termos[1]?.texto).toContain('92.400.000/0001-55');
      // O refechamento do mesmo período (oficial ou conferência) é recusado e nada muda.
      r = await fechar(farma, true);
      expect(cod(r)).toBe('livro-fechado');
      r = await fechar(farma, false);
      expect(cod(r), `${r.statusCode} ${r.body}`).toBe('livro-fechado');
      expect(await oficiais()).toBe(1);
    } finally {
      await app.close();
      await cnpj(null);
      if (raizAntes === undefined) delete process.env['ARQUIVOS_RAIZ'];
      else process.env['ARQUIVOS_RAIZ'] = raizAntes;
      await rm(raiz, { recursive: true, force: true });
    }
  }, 120_000);

  it('farmácia ambulatorial: receita retida, saída do lote, envio nacional e a leitura escriturada', async () => {
    const hoje = (await porta.relogio(ctx)).hoje;
    const dispensar = (extra: Record<string, unknown> = {}) =>
      porta.gravarSgh(ctx, null, (g) =>
        g.dispensarAmbulatorial({
          paciente: ids.paciente,
          item: ids.amoxicilina,
          lote: 'AX-1',
          validade: '2099-12-31',
          quantidade: 2,
          receitaNumero: 'RX-F24PF-1',
          receitaData: hoje,
          prescritor: ids.medico,
          autor: 'f24pf.farma',
          hoje,
          ...extra,
        }),
      );
    expect(codigoDe(await dispensar({ item: ids.dipirona, lote: 'DP-1' }).catch((e: unknown) => e))).toBe(
      'fora-da-escrituracao',
    );
    expect(codigoDe(await dispensar({ quantidade: 999 }).catch((e: unknown) => e))).toBe(
      'saldo-insuficiente',
    );
    // A reserva da separação (C1-118) protege o saldo: a dispensação só usa o livre, no local e no lote.
    const reservar = (tabela: 'saldo_estoque' | 'saldo_lote', quantidade: number) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f24pf' }, (e) =>
        tabela === 'saldo_estoque'
          ? e.executar(
              'UPDATE saldo_estoque SET quantidade_reservada = ? WHERE insumo_id = ? AND estabelecimento_id = ?',
              [quantidade, ids.amoxicilina, ids.est],
            )
          : e.executar(
              `UPDATE saldo_lote SET quantidade_reservada = ? WHERE estabelecimento_id = ? AND lote_insumo_id IN
                 (SELECT id FROM lote_insumo WHERE insumo_id = ? AND numero_lote = 'AX-1' AND estabelecimento_id = ?)`,
              [quantidade, ids.est, ids.amoxicilina, ids.est],
            ),
      );
    await reservar('saldo_estoque', 29);
    expect(codigoDe(await dispensar().catch((e: unknown) => e))).toBe('saldo-insuficiente');
    await reservar('saldo_estoque', 0);
    await reservar('saldo_lote', 29);
    // Nenhuma farmácia tem o lote livre: a escolha do local já recusa, e a tela não oferece o lote.
    expect(codigoDe(await dispensar().catch((e: unknown) => e))).toBe('saldo-insuficiente');
    expect((await porta.lotes(ctx, ids.amoxicilina, ids.farmacia)).map((x) => x.quantidade)).toEqual([1]);
    await reservar('saldo_lote', 30);
    expect(await porta.lotes(ctx, ids.amoxicilina, ids.farmacia)).toEqual([]);
    await reservar('saldo_lote', 0);
    expect(await saldo(ids.amoxicilina)).toBe(30);
    const r = await dispensar();
    expect(await saldo(ids.amoxicilina)).toBe(28);
    expect(
      await ler(
        'SELECT d.tipo, rc.tipo_receita, rc.situacao FROM dispensacao d JOIN receita_controlada rc ON rc.id = d.receita_controlada_id WHERE d.id = ?',
        [r.id],
      ),
    ).toMatchObject({
      tipo: 'ambulatorial',
      tipo_receita: 'receita_antimicrobiano',
      situacao: 'retida',
    });
    expect(
      (await porta.ambulatoriais(ctx, new Date(Date.now() - 86_400_000))).find((x) => x.id === r.id),
    ).toMatchObject({
      paciente: ids.paciente,
      item: ids.amoxicilina,
      lote: 'AX-1',
      quantidade: 2,
      escriturada: false,
    });
    const env = await porta.gravarSgh(ctx, null, (g) =>
      g.escriturarSngpc({ inicio: hoje, fim: hoje, autor: 'f24pf.farma' }),
    );
    expect(env.dispensacoes).toBe(1);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM envio_controlado_nacional_item WHERE envio_controlado_nacional_id = ?',
        [env.lote],
      ),
    ).toBe(1);
    expect(
      (await porta.ambulatoriais(ctx, new Date(Date.now() - 86_400_000))).find((x) => x.id === r.id)
        ?.escriturada,
    ).toBe(true);
    expect(
      await ler('SELECT situacao FROM receita_controlada WHERE dispensacao_id = ?', [r.id]),
    ).toMatchObject({ situacao: 'escriturada' });
    expect(
      codigoDe(
        await porta
          .gravarSgh(ctx, null, (g) => g.escriturarSngpc({ inicio: hoje, fim: hoje, autor: 'f24pf.farma' }))
          .catch((e: unknown) => e),
      ),
    ).toBe('nada-a-escriturar');
    // Duas farmácias: o lote todo reservado na central e livre na satélite; a dispensação sai pela satélite.
    const lugar = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f24pf' }, async (e) => {
      const agora = new Date();
      const satelite = await garantir(
        e,
        'SELECT id FROM local_estoque WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-FS`],
        'INSERT INTO local_estoque (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ?, ?)',
        [ids.est, `${P}-FS`, 'FARMACIA SATELITE SINTETICA F24PF', 'farmacia_satelite', agora],
      );
      const lote = await e.uma<{ id: number }>(
        "SELECT id FROM lote_insumo WHERE insumo_id = ? AND numero_lote = 'AX-1' AND estabelecimento_id = ?",
        [ids.amoxicilina, ids.est],
      );
      await e.inserir(
        `INSERT INTO saldo_lote (estabelecimento_id, local_estoque_id, lote_insumo_id, quantidade, competencia, criado_em)
         VALUES (?, ?, ?, 5, '2026-11-01', ?)`,
        [ids.est, satelite, lote?.id, agora],
      );
      await e.inserir(
        'INSERT INTO saldo_estoque (estabelecimento_id, local_estoque_id, insumo_id, quantidade, custo_medio, criado_em) VALUES (?, ?, ?, 5, 1, ?)',
        [ids.est, satelite, ids.amoxicilina, agora],
      );
      await e.executar(
        'UPDATE saldo_lote SET quantidade_reservada = quantidade WHERE local_estoque_id = ? AND lote_insumo_id = ?',
        [ids.farmacia, lote?.id],
      );
      return { satelite, lote: Number(lote?.id) };
    });
    const saldoLote = async (local: number) =>
      ler(
        'SELECT quantidade, quantidade_reservada FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ?',
        [local, lugar.lote],
      );
    const r2 = await dispensar({ receitaNumero: 'RX-F24PF-2' });
    expect(
      Number(
        (await ler('SELECT local_estoque_id FROM dispensacao WHERE id = ?', [r2.id]))?.['local_estoque_id'],
      ),
    ).toBe(lugar.satelite);
    expect(Number((await saldoLote(ids.farmacia))?.['quantidade'])).toBe(28);
    expect(Number((await saldoLote(ids.farmacia))?.['quantidade_reservada'])).toBe(28);
    expect(Number((await saldoLote(lugar.satelite))?.['quantidade'])).toBe(3);
  });

  it('avaliação pelo horário: a decisão vale para o item prescrito do horário e a fila a mostra validada', async () => {
    const [, h2] = ids.horarios as [number, number];
    expect(
      codigoDe(
        await op(ctx, 'suprimentos.avaliarPrescricao', { horario: 999_999_999, decisao: 'valido' }).catch(
          (e: unknown) => e,
        ),
      ),
    ).toBe('horario-inexistente');
    const r = await op(ctx, 'suprimentos.avaliarPrescricao', { horario: h2, decisao: 'valido' });
    expect(
      await ler('SELECT parecer FROM avaliacao_farmaceutica_item WHERE id = ?', [r.resultado['id']]),
    ).toMatchObject({ parecer: 'aprovado' });
    const agora = Date.now();
    const fila = await porta.filaDaUnidade(ctx, {
      unidade: 'UTI-F24PF',
      inicio: new Date(agora - 3_600_000),
      fim: new Date(agora + 5 * 3_600_000),
    });
    expect(fila.doses.find((d) => d.horario.id === h2)?.validadaAntes).toBe(true);
    expect((await porta.situacoes(ctx, [h2])).get(h2)).toEqual({ situacao: 'P', em: null });
    expect(await porta.substituicoes(ctx, ids.horarios)).toEqual([]);
  });
});
