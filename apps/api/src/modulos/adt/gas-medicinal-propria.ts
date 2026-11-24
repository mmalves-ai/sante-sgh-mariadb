// Gases medicinais por tempo de uso (F3.4, 04-INT linha 82), no banco do cliente. As regras são as puras de
// @sgh/dominio-internacao (gas-cobranca.ts); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - iniciar: `uso_gas_medicinal` em uso (atendimento, gás, item faturável do gás, local, fluxo, início, quem
//     registrou); a troca de fluxo ou de local encerra o uso anterior no mesmo instante (horas apuradas) e o novo
//     aponta o anterior (`uso_anterior_id`);
//   - encerrar: fim, `horas_uso` apuradas pelo domínio e situação 'encerrado', com a versão lida;
//   - cancelar: situação 'cancelado' com o motivo (registro lançado por engano; nunca apagado; o faturado não cancela);
//   - regra de cobrança: `regra_cobranca_gas` com as faixas (`_faixa`) e o uso simultâneo (`_simultaneo`), conferida
//     pelo domínio; encerrar a vigência grava o fim (nada apagado);
//   - lançar na conta: por gás, os usos encerrados e não faturados viram um `conta_hospitalar_item` (quantidade da
//     regra que vale para a fonte e o plano da conta, preço vigente pelas tabelas da conta, período do uso) com a
//     memória (`conta_hospitalar_item_memoria`, passos do cálculo), os usos ficam faturados apontando a conta e a
//     conta fica "não calculada". Gás sem regra vigente recusa (422) sem lançar nada.
import {
  calcularCobrancaGas,
  conferirFimUsoGas,
  conferirInicioUsoGas,
  conferirRegraCobrancaGas,
  horasDeUso,
  LOCAIS_USO_GAS,
  ARREDONDAMENTOS_GAS,
  type RegraCobrancaGas,
  regraGasQueVale,
  TRATAMENTOS_SIMULTANEO_GAS,
  UNIDADES_COBRANCA_GAS,
  type UsoGasPeriodo,
} from '@sgh/dominio-internacao';
import { SITUACOES_CONTA_LANCAVEL } from '@sgh/contratos/regras-faturamento';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';
import { precoVigente, tabelasDePreco } from '../faturamento/public-api.js';

export const PORTA_GAS_MEDICINAL = Symbol('PORTA_GAS_MEDICINAL');

const TABELAS = [
  'uso_gas_medicinal',
  'regra_cobranca_gas',
  'regra_cobranca_gas_faixa',
  'regra_cobranca_gas_simultaneo',
  'conta_hospitalar',
  'conta_hospitalar_item',
  'conta_hospitalar_item_memoria',
];

export interface UsoGasLido {
  readonly id: number;
  readonly insumo: number;
  readonly gasNome: string;
  readonly item: number | null;
  readonly local: string;
  readonly fluxoLitrosMinuto: number | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly horasUso: number | null;
  readonly usoAnterior: number | null;
  readonly situacao: string;
  readonly faturado: boolean;
  readonly conta: number | null;
  readonly observacao: string | null;
  readonly versao: number;
}

const dataHoraIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v)).toISOString();
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
const quando = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

const esquemaIniciar = z
  .object({
    atendimento: z.number().int().positive(),
    insumo: z.number().int().positive(),
    local: z.enum(LOCAIS_USO_GAS).default('leito'),
    fluxoLitrosMinuto: z.number().nonnegative().max(1000).nullable().default(null),
    inicio: quando.optional(),
    usoAnterior: z.number().int().positive().nullable().default(null),
    setor: z.number().int().positive().nullable().default(null),
    leito: z.number().int().positive().nullable().default(null),
    observacao: z.string().max(500).nullable().default(null),
  })
  .strict();

const esquemaRegra = z
  .object({
    gas: z.number().int().positive(),
    cobranca: z.number().int().positive().nullable().default(null),
    fonte: z.number().int().positive().nullable().default(null),
    plano: z.number().int().positive().nullable().default(null),
    unidade: z.enum(UNIDADES_COBRANCA_GAS),
    toleranciaMinutos: z.number().int().nonnegative().max(1440).default(0),
    fracaoMinimaMinutos: z.number().int().positive().max(60).nullable().default(null),
    arredondamento: z.enum(ARREDONDAMENTOS_GAS).default('para_cima'),
    percentualSimultaneo: z.number().min(0).max(100).nullable().default(null),
    vigenciaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    vigenciaFim: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    faixas: z
      .array(
        z
          .object({
            horasInicio: z.number().nonnegative(),
            horasFim: z.number().positive().nullable(),
            item: z.number().int().positive().nullable().default(null),
            quantidade: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    simultaneos: z
      .array(
        z
          .object({
            gas: z.number().int().positive(),
            tratamento: z.enum(TRATAMENTOS_SIMULTANEO_GAS),
            percentual: z.number().min(0).max(100).nullable().default(null),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict();

function usoLido(x: Record<string, unknown>): UsoGasLido {
  return {
    id: num(x['id']),
    insumo: num(x['insumo_id']),
    gasNome: String(x['gas_nome'] ?? ''),
    item: numOuNull(x['item_faturavel_id']),
    local: String(x['local']),
    fluxoLitrosMinuto: numOuNull(x['fluxo_litros_minuto']),
    inicio: dataHoraIso(x['iniciado_em'])!,
    fim: dataHoraIso(x['encerrado_em']),
    horasUso: numOuNull(x['horas_uso']),
    usoAnterior: numOuNull(x['uso_anterior_id']),
    situacao: String(x['situacao']),
    faturado: bool(x['faturado']),
    conta: numOuNull(x['conta_hospitalar_id']),
    observacao: txtOuNull(x['observacao']),
    versao: num(x['versao']),
  };
}

async function regrasDoGas(l: Leitor, est: number, gas: number) {
  const rs = await l.consultar(
    `SELECT * FROM regra_cobranca_gas WHERE estabelecimento_id = ? AND gas_item_faturavel_id = ? AND ativo
      ORDER BY vigencia_inicio DESC, id DESC`,
    [est, gas],
  );
  const saida = [];
  for (const r of rs) {
    const faixas = await l.consultar(
      `SELECT horas_inicio, horas_fim, item_faturavel_id, quantidade_cobrada FROM regra_cobranca_gas_faixa
        WHERE regra_cobranca_gas_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [r['id']],
    );
    const sims = await l.consultar(
      `SELECT simultaneo_item_faturavel_id, tratamento, percentual_cobrado FROM regra_cobranca_gas_simultaneo
        WHERE regra_cobranca_gas_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [r['id']],
    );
    const regra: RegraCobrancaGas = {
      unidade: String(r['unidade_cobranca']) as RegraCobrancaGas['unidade'],
      toleranciaMinutos: num(r['tolerancia_minutos']),
      fracaoMinimaMinutos: numOuNull(r['fracao_minima_minutos']),
      arredondamento: String(r['arredondamento']) as RegraCobrancaGas['arredondamento'],
      percentualSimultaneo: numOuNull(r['percentual_simultaneo']),
      faixas: faixas.map((f) => ({
        horasInicio: num(f['horas_inicio']),
        horasFim: numOuNull(f['horas_fim']),
        item: numOuNull(f['item_faturavel_id']),
        quantidade: num(f['quantidade_cobrada']),
      })),
      simultaneos: sims.map((s) => ({
        gas: num(s['simultaneo_item_faturavel_id']),
        tratamento: String(s['tratamento']) as RegraCobrancaGas['simultaneos'][number]['tratamento'],
        percentual: numOuNull(s['percentual_cobrado']),
      })),
    };
    saida.push({
      id: num(r['id']),
      gas,
      cobranca: numOuNull(r['cobranca_item_faturavel_id']),
      fonte: numOuNull(r['fonte_pagadora_id']),
      plano: numOuNull(r['plano_fonte_pagadora_id']),
      vigenciaInicio: dataIso(r['vigencia_inicio']),
      vigenciaFim: r['vigencia_fim'] === null ? null : dataIso(r['vigencia_fim']),
      versao: num(r['versao']),
      regra,
    });
  }
  return saida;
}

const SQL_USOS = `
  SELECT u.*, i.nome AS gas_nome FROM uso_gas_medicinal u JOIN insumo i ON i.id = u.insumo_id
   WHERE u.atendimento_id = ? AND u.estabelecimento_id = ? AND u.excluido_em IS NULL`;

export class PortaGasMedicinalPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.gas');
  }

  /** Os usos do atendimento (visão por paciente), do mais recente ao mais antigo. */
  usos(c: ContextoPortaPropria, atendimento: number): Promise<UsoGasLido[]> {
    return this.ler(c, 'usos', async (l, est) =>
      (
        await l.consultar(`${SQL_USOS} ORDER BY u.iniciado_em DESC, u.id DESC LIMIT 1000`, [
          atendimento,
          est.id,
        ])
      ).map(usoLido),
    );
  }

  iniciar(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaIniciar, entrada);
    return this.gravar(c, 'internacao.gas.iniciar', ['uso_gas_medicinal'], async (tx, est, usuario) => {
      const agora = new Date();
      const inicio = e.inicio ?? agora;
      const atd = await tx.uma('SELECT id FROM atendimento WHERE id = ? AND estabelecimento_id = ?', [
        e.atendimento,
        est.id,
      ]);
      if (!atd) throw naoEncontrado('Atendimento');
      const ins = await tx.uma(
        `SELECT i.id, COALESCE(i.item_faturavel_id,
                (SELECT f.id FROM item_faturavel f WHERE f.insumo_id = i.id AND f.excluido_em IS NULL
                   AND f.situacao = 'ativo' ORDER BY f.id LIMIT 1)) AS item
           FROM insumo i WHERE i.id = ?`,
        [e.insumo],
      );
      if (!ins) throw naoEncontrado('Gás medicinal');
      const internacao = await tx.uma(
        'SELECT id FROM internacao WHERE atendimento_id = ? ORDER BY id DESC LIMIT 1',
        [e.atendimento],
      );
      const abertos = await tx.consultarParaAtualizar<Record<string, unknown>>(
        `SELECT id, iniciado_em, versao FROM uso_gas_medicinal
          WHERE atendimento_id = ? AND insumo_id = ? AND situacao = 'em_uso' AND excluido_em IS NULL`,
        [e.atendimento, e.insumo],
      );
      let anterior: Record<string, unknown> | null = null;
      if (e.usoAnterior !== null) {
        anterior =
          (
            await tx.consultarParaAtualizar<Record<string, unknown>>(
              `SELECT id, iniciado_em, versao FROM uso_gas_medicinal
                WHERE id = ? AND atendimento_id = ? AND situacao = 'em_uso' AND excluido_em IS NULL`,
              [e.usoAnterior, e.atendimento],
            )
          )[0] ?? null;
        if (!anterior)
          throw recusaRegra('Troca recusada', [
            { campo: 'usoAnterior', mensagem: 'O uso a continuar não está em uso neste atendimento.' },
          ]);
      }
      const continuaOutro = anterior !== null && abertos.every((a) => num(a['id']) === num(anterior!['id']));
      const p = conferirInicioUsoGas({ inicio, agora, abertosMesmoGas: abertos.length, continuaOutro });
      if (anterior)
        p.push(...conferirFimUsoGas({ inicio: anterior['iniciado_em'] as Date, fim: inicio, agora }));
      if (p.length) throw recusaRegra('Uso do gás recusado', p);
      if (anterior)
        await tx.alterar('uso_gas_medicinal', num(anterior['id']), num(anterior['versao']), {
          encerrado_em: inicio,
          horas_uso: horasDeUso(anterior['iniciado_em'] as Date, inicio),
          situacao: 'encerrado',
        });
      const id = await tx.incluir('uso_gas_medicinal', {
        estabelecimento_id: est.id,
        atendimento_id: e.atendimento,
        internacao_id: internacao ? num(internacao['id']) : null,
        insumo_id: e.insumo,
        item_faturavel_id: numOuNull(ins['item']),
        local: e.local,
        setor_funcional_id: e.setor,
        leito_hospitalar_id: e.leito,
        fluxo_litros_minuto: e.fluxoLitrosMinuto,
        iniciado_em: inicio,
        uso_anterior_id: anterior ? num(anterior['id']) : null,
        registrado_por_usuario_id: usuario,
        situacao: 'em_uso',
        observacao: e.observacao,
      });
      return { tabela: 'uso_gas_medicinal', id };
    });
  }

  encerrar(c: ContextoPortaPropria, id: number, entrada: unknown): Promise<{ id: number; horasUso: number }> {
    const x = entradaValida(
      z.object({ fim: quando.optional(), versao: z.number().int().positive() }).strict(),
      entrada,
    );
    return this.gravar(c, 'internacao.gas.encerrar', ['uso_gas_medicinal'], async (tx, est) => {
      const u = await tx.uma(
        `SELECT iniciado_em, situacao FROM uso_gas_medicinal WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, est.id],
      );
      if (!u) throw naoEncontrado('Uso de gás');
      if (u['situacao'] !== 'em_uso')
        throw recusaRegra('Encerramento recusado', [
          { campo: 'situacao', mensagem: 'O uso não está em andamento.' },
        ]);
      const agora = new Date();
      const fim = x.fim ?? agora;
      const p = conferirFimUsoGas({ inicio: u['iniciado_em'] as Date, fim, agora });
      if (p.length) throw recusaRegra('Encerramento recusado', p);
      const horasUso = horasDeUso(u['iniciado_em'] as Date, fim);
      await tx.alterar('uso_gas_medicinal', id, x.versao, {
        encerrado_em: fim,
        horas_uso: horasUso,
        situacao: 'encerrado',
      });
      return { tabela: 'uso_gas_medicinal', id, horasUso };
    });
  }

  cancelar(c: ContextoPortaPropria, id: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(
      z.object({ motivo: z.string().trim().min(5).max(400), versao: z.number().int().positive() }).strict(),
      entrada,
    );
    return this.gravar(c, 'internacao.gas.cancelar', ['uso_gas_medicinal'], async (tx, est) => {
      const u = await tx.uma(
        `SELECT situacao, faturado FROM uso_gas_medicinal WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, est.id],
      );
      if (!u) throw naoEncontrado('Uso de gás');
      if (bool(u['faturado']) || u['situacao'] === 'cancelado')
        throw recusaRegra('Cancelamento recusado', [
          { campo: 'situacao', mensagem: 'Uso já lançado na conta ou já cancelado: o acerto é pela conta.' },
        ]);
      await tx.alterar('uso_gas_medicinal', id, x.versao, {
        situacao: 'cancelado',
        observacao: `Cancelado: ${x.motivo}`.slice(0, 500),
      });
      return { tabela: 'uso_gas_medicinal', id };
    });
  }

  regras(c: ContextoPortaPropria, gas: number) {
    return this.ler(c, 'regras', (l, est) => regrasDoGas(l, est.id, gas));
  }

  incluirRegra(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaRegra, entrada);
    const regra: RegraCobrancaGas = {
      unidade: e.unidade,
      toleranciaMinutos: e.toleranciaMinutos,
      fracaoMinimaMinutos: e.fracaoMinimaMinutos,
      arredondamento: e.arredondamento,
      percentualSimultaneo: e.percentualSimultaneo,
      faixas: e.faixas,
      simultaneos: e.simultaneos,
    };
    const p = conferirRegraCobrancaGas(regra, e.gas);
    if (e.plano !== null && e.fonte === null)
      p.push({ campo: 'plano', mensagem: 'O plano exige a fonte pagadora.' });
    if (e.vigenciaFim !== null && e.vigenciaFim < e.vigenciaInicio)
      p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência vem depois do início.' });
    if (p.length) throw recusaRegra('Regra de cobrança recusada', p);
    return this.gravar(
      c,
      'internacao.gas.regra',
      ['regra_cobranca_gas', 'regra_cobranca_gas_faixa', 'regra_cobranca_gas_simultaneo'],
      async (tx, est) => {
        const itens = [
          e.gas,
          e.cobranca,
          ...e.faixas.map((f) => f.item),
          ...e.simultaneos.map((s) => s.gas),
        ].filter((x): x is number => x !== null);
        const achados = await tx.consultar(
          `SELECT id FROM item_faturavel WHERE id IN (${itens.map(() => '?').join(', ')}) AND excluido_em IS NULL`,
          itens,
        );
        if (new Set(achados.map((a) => num(a['id']))).size !== new Set(itens).size)
          throw naoEncontrado('Item faturável');
        const choque = await tx.uma(
          `SELECT id FROM regra_cobranca_gas
            WHERE estabelecimento_id = ? AND gas_item_faturavel_id = ? AND ativo
              AND fonte_pagadora_id <=> ? AND plano_fonte_pagadora_id <=> ?
              AND vigencia_inicio <= COALESCE(?, '9999-12-31') AND COALESCE(vigencia_fim, '9999-12-31') >= ?`,
          [est.id, e.gas, e.fonte, e.plano, e.vigenciaFim, e.vigenciaInicio],
        );
        if (choque)
          throw new ErroOperacao(
            409,
            'vigencia-sobreposta',
            'Vigência sobreposta',
            'Já há regra deste gás para a mesma fonte e plano nesse período: encerre a vigência da atual antes.',
          );
        const id = await tx.incluir('regra_cobranca_gas', {
          estabelecimento_id: est.id,
          fonte_pagadora_id: e.fonte,
          plano_fonte_pagadora_id: e.plano,
          gas_item_faturavel_id: e.gas,
          cobranca_item_faturavel_id: e.cobranca,
          unidade_cobranca: e.unidade,
          tolerancia_minutos: e.toleranciaMinutos,
          fracao_minima_minutos: e.fracaoMinimaMinutos,
          arredondamento: e.arredondamento,
          percentual_simultaneo: e.percentualSimultaneo,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
          ativo: true,
        });
        const faixas = [...e.faixas].sort((a, b) => a.horasInicio - b.horasInicio);
        for (const [i, f] of faixas.entries())
          await tx.incluir('regra_cobranca_gas_faixa', {
            regra_cobranca_gas_id: id,
            sequencia: i + 1,
            horas_inicio: f.horasInicio,
            horas_fim: f.horasFim,
            item_faturavel_id: f.item,
            quantidade_cobrada: f.quantidade,
          });
        for (const [i, s] of e.simultaneos.entries())
          await tx.incluir('regra_cobranca_gas_simultaneo', {
            regra_cobranca_gas_id: id,
            sequencia: i + 1,
            simultaneo_item_faturavel_id: s.gas,
            tratamento: s.tratamento,
            percentual_cobrado: s.percentual,
          });
        return { tabela: 'regra_cobranca_gas', id };
      },
    );
  }

  /** Encerra a vigência da regra (nada é apagado; a conta já lançada guarda a regra na memória). */
  encerrarRegra(c: ContextoPortaPropria, id: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(
      z
        .object({ vigenciaFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), versao: z.number().int().positive() })
        .strict(),
      entrada,
    );
    return this.gravar(c, 'internacao.gas.regraFim', ['regra_cobranca_gas'], async (tx, est) => {
      const r = await tx.uma(
        'SELECT vigencia_inicio FROM regra_cobranca_gas WHERE id = ? AND estabelecimento_id = ?',
        [id, est.id],
      );
      if (!r) throw naoEncontrado('Regra de cobrança');
      if (x.vigenciaFim < dataIso(r['vigencia_inicio']))
        throw recusaRegra('Fim recusado', [
          { campo: 'vigenciaFim', mensagem: 'O fim vem depois do início.' },
        ]);
      await tx.alterar('regra_cobranca_gas', id, x.versao, { vigencia_fim: x.vigenciaFim });
      return { tabela: 'regra_cobranca_gas', id };
    });
  }

  /** Lança na conta aberta do atendimento os usos encerrados e não faturados, um item por gás. */
  lancarNaConta(
    c: ContextoPortaPropria,
    atendimento: number,
  ): Promise<{ id: number | null; itens: number[] }> {
    return this.gravar(
      c,
      'internacao.gas.lancar',
      ['uso_gas_medicinal', 'conta_hospitalar', 'conta_hospitalar_item', 'conta_hospitalar_item_memoria'],
      async (tx: TxOperacao, est, usuario) => {
        const [conta] = await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT id, versao, calculada, fonte_pagadora_id, plano_fonte_pagadora_id, tabela_preco_id
             FROM conta_hospitalar
            WHERE atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
              AND situacao IN (${SITUACOES_CONTA_LANCAVEL.map(() => '?').join(', ')})
            ORDER BY (tipo_cobranca = 'total') DESC, id DESC LIMIT 1`,
          [atendimento, est.id, ...SITUACOES_CONTA_LANCAVEL],
        );
        if (!conta)
          throw recusaRegra('Lançamento recusado', [
            { campo: 'conta', mensagem: 'O atendimento não tem conta aberta para lançar.' },
          ]);
        const usos = await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT u.id, u.versao, u.insumo_id, u.item_faturavel_id, u.iniciado_em, u.encerrado_em, u.fluxo_litros_minuto,
                  u.faturado, u.situacao, u.setor_funcional_id
             FROM uso_gas_medicinal u
            WHERE u.atendimento_id = ? AND u.estabelecimento_id = ? AND u.excluido_em IS NULL AND u.situacao <> 'cancelado'`,
          [atendimento, est.id],
        );
        const gasDe = (u: Record<string, unknown>) =>
          numOuNull(u['item_faturavel_id']) ?? -num(u['insumo_id']);
        const periodos: UsoGasPeriodo[] = usos.map((u) => ({
          gas: gasDe(u),
          inicio: u['iniciado_em'] as Date,
          fim: (u['encerrado_em'] as Date | null) ?? null,
          fluxoLitrosMinuto: numOuNull(u['fluxo_litros_minuto']),
        }));
        const pendentes = usos.filter((u) => u['situacao'] === 'encerrado' && !bool(u['faturado']));
        if (!pendentes.length)
          throw recusaRegra('Nada a lançar', [
            { campo: 'usos', mensagem: 'Não há uso encerrado a lançar na conta.' },
          ]);
        if (pendentes.some((u) => u['item_faturavel_id'] === null))
          throw recusaRegra('Lançamento recusado', [
            {
              campo: 'usos',
              mensagem: 'Há gás sem item faturável no cadastro: ligue o item ao gás antes de lançar.',
            },
          ]);
        const tabelas = await tabelasDePreco(
          tx,
          est.id,
          num(conta['fonte_pagadora_id']),
          numOuNull(conta['plano_fonte_pagadora_id']),
          numOuNull(conta['tabela_preco_id']),
        );
        const itens: number[] = [];
        const semRegra: number[] = [];
        const gases = [...new Set(pendentes.map(gasDe))];
        const calculos = [];
        for (const gas of gases) {
          const meus = pendentes.filter((u) => gasDe(u) === gas);
          const ultimoFim = meus.map((u) => u['encerrado_em'] as Date).reduce((a, b) => (a > b ? a : b));
          const data = ultimoFim.toISOString().slice(0, 10);
          const vale = regraGasQueVale(
            await regrasDoGas(tx, est.id, gas),
            {
              fonte: numOuNull(conta['fonte_pagadora_id']),
              plano: numOuNull(conta['plano_fonte_pagadora_id']),
            },
            data,
          );
          if (!vale) {
            semRegra.push(gas);
            continue;
          }
          // Só os pendentes deste gás entram no tempo; os outros gases (lançados ou não) contam para a sobreposição.
          const ids = new Set(meus.map((u) => num(u['id'])));
          const usosCalculo = periodos.filter((p, i) => p.gas !== gas || ids.has(num(usos[i]!['id'])));
          calculos.push({
            gas,
            meus,
            data,
            vale,
            cobranca: calcularCobrancaGas({ regra: vale.regra, gas, usos: usosCalculo }),
          });
        }
        if (semRegra.length)
          throw recusaRegra('Lançamento recusado', [
            {
              campo: 'regra',
              mensagem: `Gás sem regra de cobrança vigente para a fonte e o plano da conta (item ${semRegra.join(', ')}).`,
            },
          ]);
        const origem = await tx.uma(
          "SELECT id FROM origem_lancamento WHERE codigo = 'estoque' AND ativo LIMIT 1",
          [],
        );
        for (const k of calculos) {
          if (k.cobranca.quantidade > 0) {
            const itemFat = k.cobranca.itemFaixa ?? k.vale.cobranca ?? k.gas;
            const preco = await precoVigente(tx, tabelas, itemFat, k.data);
            const fat = await tx.uma('SELECT grupo_faturamento_id FROM item_faturavel WHERE id = ?', [
              itemFat,
            ]);
            const seq = await tx.uma(
              'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
              [num(conta['id'])],
            );
            const unitario = preco?.unitario ?? 0;
            const inicio = k.meus.map((u) => u['iniciado_em'] as Date).reduce((a, b) => (a < b ? a : b));
            const fim = k.meus.map((u) => u['encerrado_em'] as Date).reduce((a, b) => (a > b ? a : b));
            const item = await tx.incluir('conta_hospitalar_item', {
              conta_hospitalar_id: num(conta['id']),
              sequencia: num(seq?.['s']),
              item_faturavel_id: itemFat,
              grupo_faturamento_id: numOuNull(fat?.['grupo_faturamento_id']),
              origem_lancamento_id: numOuNull(origem?.['id']),
              realizado_em: inicio,
              realizado_fim_em: fim,
              quantidade: k.cobranca.quantidade,
              valor_unitario: unitario,
              percentual_cobranca: 100,
              valor_total: Math.round(unitario * k.cobranca.quantidade * 100) / 100,
              setor_funcional_id: numOuNull(k.meus[0]!['setor_funcional_id']),
              tipo_valorizacao: 'tabela',
              situacao: 'lancado',
              observacao: (
                `Gás medicinal por tempo de uso (${k.cobranca.minutosCobraveis} min cobráveis).` +
                (preco ? '' : ' Sem preço vigente na tabela da conta: valor a conferir.')
              ).slice(0, 2000),
            });
            await tx.incluir('conta_hospitalar_item_memoria', {
              conta_hospitalar_item_id: item,
              operacao: 'inclusao',
              dados: JSON.stringify({
                regra: 'gas_tempo_uso',
                regraCobrancaGas: k.vale.id,
                usos: k.meus.map((u) => num(u['id'])),
                passos: k.cobranca.passos,
              }),
              ocorrido_em: new Date(),
              usuario_id: usuario,
              tabela_preco_id: preco?.tabela ?? null,
              percentual_aplicado: 100,
              valor_unitario_calculado: preco?.unitario ?? null,
              valor_total_calculado: preco ? Math.round(unitario * k.cobranca.quantidade * 100) / 100 : null,
            });
            itens.push(item);
          }
          // Sem quantidade (tolerância ou sobreposição não cobrada) o uso também sai da fila: foi apurado e não cobra.
          for (const u of k.meus)
            await tx.alterar('uso_gas_medicinal', num(u['id']), num(u['versao']), {
              faturado: true,
              conta_hospitalar_id: num(conta['id']),
            });
        }
        if (bool(conta['calculada']))
          await tx.alterar('conta_hospitalar', num(conta['id']), num(conta['versao']), { calculada: false });
        return { tabela: 'conta_hospitalar', id: num(conta['id']), itens };
      },
    );
  }
}
