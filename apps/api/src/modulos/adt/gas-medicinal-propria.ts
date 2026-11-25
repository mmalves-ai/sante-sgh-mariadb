// Gases medicinais por tempo de uso (F3.4, 04-INT linha 82), no banco do cliente. As regras são as puras de
// @sgh/dominio-internacao (gas-cobranca.ts); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - iniciar: `uso_gas_medicinal` em uso (atendimento, gás, item faturável do gás, local, fluxo, início, quem
//     registrou); a troca de fluxo ou de local encerra o uso anterior no mesmo instante (horas apuradas) e o novo
//     aponta o anterior (`uso_anterior_id`);
//   - encerrar: fim, `horas_uso` apuradas pelo domínio e situação 'encerrado', com a versão lida;
//   - cancelar: situação 'cancelado' com o motivo (registro lançado por engano; nunca apagado; o faturado não cancela);
//   - regra de cobrança: `regra_cobranca_gas` com as faixas (`_faixa`) e o uso simultâneo (`_simultaneo`), conferida
//     pelo domínio; encerrar a vigência grava o fim (nada apagado);
//   - lançar na conta: o uso que atravessa a virada de uma conta parcial é dividido (domínio,
//     gas-reparticao-conta.ts) e cada parte vai à conta do seu período (trecho sem conta lançável recusa tudo); em
//     cada conta, por gás, a cobrança do tempo ACUMULADO na conta (usos encerrados do gás recortados ao período da
//     conta; tolerância, arredondamento e faixa uma vez só) e um `conta_hospitalar_item` só com a diferença para o já
//     lançado do gás (preço vigente pelas tabelas da conta) com a memória (`conta_hospitalar_item_memoria`, passos,
//     gás, partes de cada uso e acumulado); os usos ficam faturados apontando a conta (o dividido, a da última parte)
//     e cada conta tocada fica "não calculada". Sem regra vigente, sem preço vigente, faixa que troca de item depois
//     de lançada ou acumulado menor que o lançado: recusa (422) sem lançar nem marcar nada.
import {
  calcularCobrancaGas,
  conferirFimUsoGas,
  conferirInicioUsoGas,
  conferirRegraCobrancaGas,
  diferencaALancarGas,
  horasDeUso,
  periodosEfetivosContas,
  repartirUsosGasPorConta,
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

/**
 * Os trechos do gás já apurados numa conta, lidos da memória dos itens dela (partes gravadas em cada lançamento). A
 * memória anterior à divisão por conta parcial, sem as partes, vale pelo uso inteiro.
 */
function trechosCobradosNaConta(
  registros: readonly Record<string, unknown>[],
  usoPorId: ReadonlyMap<number, Record<string, unknown>>,
  periodoDe: (u: Record<string, unknown>) => UsoGasPeriodo,
  gas: number,
): { uso: number; periodo: UsoGasPeriodo }[] {
  const vistos = new Set<string>();
  const r: { uso: number; periodo: UsoGasPeriodo }[] = [];
  const somar = (uso: number, inicio: Date, fim: Date | null) => {
    const chave = `${uso}|${inicio.getTime()}|${fim?.getTime() ?? ''}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    const u = usoPorId.get(uso);
    r.push({
      uso,
      periodo: { gas, inicio, fim, fluxoLitrosMinuto: u ? numOuNull(u['fluxo_litros_minuto']) : null },
    });
  };
  for (const x of registros) {
    const bruto = x['dados'];
    const d = (typeof bruto === 'string' ? JSON.parse(bruto) : bruto) as {
      partes?: { uso: number; inicio: string; fim: string }[];
      usos?: number[];
    } | null;
    if (Array.isArray(d?.partes))
      for (const p of d.partes) somar(Number(p.uso), new Date(p.inicio), new Date(p.fim));
    else
      for (const id of d?.usos ?? []) {
        const u = usoPorId.get(Number(id));
        if (u) {
          const per = periodoDe(u);
          somar(Number(id), per.inicio, per.fim);
        }
      }
  }
  return r;
}

export class PortaGasMedicinalPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.gas');
  }

  /** O atendimento da internação (atalho da internação e da enfermagem para os gases do paciente; C1-074). */
  atendimentoDaInternacao(c: ContextoPortaPropria, internacao: number): Promise<{ atendimento: number }> {
    return this.ler(c, 'atendimentoDaInternacao', async (l, est) => {
      const [r] = await l.consultar(
        `SELECT i.atendimento_id FROM internacao i JOIN atendimento a ON a.id = i.atendimento_id
          WHERE i.id = ? AND a.estabelecimento_id = ?`,
        [internacao, est.id],
      );
      if (!r?.['atendimento_id']) throw naoEncontrado('Internação');
      return { atendimento: num(r['atendimento_id']) };
    });
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

  async iniciar(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
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
           FROM insumo i WHERE i.id = ? AND i.tipo = 'gas_medicinal'`,
        [e.insumo],
      );
      if (!ins) throw naoEncontrado('Gás medicinal');
      if (e.setor !== null) {
        const st = await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
          e.setor,
          est.id,
        ]);
        if (!st) throw naoEncontrado('Setor');
      }
      if (e.leito !== null) {
        const lt = await tx.uma('SELECT id FROM leito_hospitalar WHERE id = ? AND estabelecimento_id = ?', [
          e.leito,
          est.id,
        ]);
        if (!lt) throw naoEncontrado('Leito');
      }
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

  async encerrar(
    c: ContextoPortaPropria,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; horasUso: number }> {
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

  async cancelar(c: ContextoPortaPropria, id: number, entrada: unknown): Promise<{ id: number }> {
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

  async incluirRegra(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
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
  async encerrarRegra(c: ContextoPortaPropria, id: number, entrada: unknown): Promise<{ id: number }> {
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

  /**
   * Lança na conta do período os usos encerrados do atendimento. A cobrança é do tempo ACUMULADO do gás na conta
   * (usos já faturados nela e os pendentes), e o item lançado é só a diferença para o que a conta já tem do gás.
   */
  lancarNaConta(
    c: ContextoPortaPropria,
    atendimento: number,
  ): Promise<{ id: number | null; itens: number[] }> {
    return this.gravar(
      c,
      'internacao.gas.lancar',
      ['uso_gas_medicinal', 'conta_hospitalar', 'conta_hospitalar_item', 'conta_hospitalar_item_memoria'],
      async (tx: TxOperacao, est, usuario) => {
        const usos = await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT u.id, u.versao, u.insumo_id, u.item_faturavel_id, u.iniciado_em, u.encerrado_em, u.fluxo_litros_minuto,
                  u.faturado, u.situacao, u.setor_funcional_id, u.conta_hospitalar_id
             FROM uso_gas_medicinal u
            WHERE u.atendimento_id = ? AND u.estabelecimento_id = ? AND u.excluido_em IS NULL AND u.situacao <> 'cancelado'`,
          [atendimento, est.id],
        );
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
        // As contas lançáveis do atendimento (conta parcial por período na internação longa): o uso que atravessa a
        // virada de uma conta é dividido e cada parte é cobrada na conta do seu período (domínio, C1-074).
        const contas = await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT id, versao, calculada, fonte_pagadora_id, plano_fonte_pagadora_id, tabela_preco_id, inicio_em, fim_em
             FROM conta_hospitalar
            WHERE atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
              AND situacao IN (${SITUACOES_CONTA_LANCAVEL.map(() => '?').join(', ')})
            ORDER BY inicio_em, id`,
          [atendimento, est.id, ...SITUACOES_CONTA_LANCAVEL],
        );
        const periodosContas = periodosEfetivosContas(
          contas.map((k) => ({
            conta: num(k['id']),
            inicio: k['inicio_em'] as Date,
            fim: (k['fim_em'] as Date | null) ?? null,
          })),
        );
        const rep = repartirUsosGasPorConta(
          pendentes.map((u) => ({
            id: num(u['id']),
            inicio: u['iniciado_em'] as Date,
            fim: u['encerrado_em'] as Date,
          })),
          periodosContas,
        );
        if (rep.problemas.length) throw recusaRegra('Lançamento recusado', rep.problemas);
        const gasDe = (u: Record<string, unknown>) =>
          numOuNull(u['item_faturavel_id']) ?? -num(u['insumo_id']);
        const usoPorId = new Map(usos.map((u) => [num(u['id']), u]));
        const periodoDe = (u: Record<string, unknown>): UsoGasPeriodo => ({
          gas: gasDe(u),
          inicio: u['iniciado_em'] as Date,
          fim: (u['encerrado_em'] as Date | null) ?? null,
          fluxoLitrosMinuto: numOuNull(u['fluxo_litros_minuto']),
        });
        const problemas: { campo: string; mensagem: string }[] = [];
        const calculos = [];
        // Partes (uso|conta) apuradas: com item novo, com a apuração gravada no item do gás da conta ou já cobradas.
        const resolvidas = new Set<string>();
        for (const per of periodosContas) {
          const partesConta = rep.partes.filter((p) => p.conta === per.conta);
          if (!partesConta.length) continue;
          const conta = contas.find((k) => num(k['id']) === per.conta)!;
          const contaId = per.conta;
          const tabelas = await tabelasDePreco(
            tx,
            est.id,
            num(conta['fonte_pagadora_id']),
            numOuNull(conta['plano_fonte_pagadora_id']),
            numOuNull(conta['tabela_preco_id']),
          );
          const gases = [...new Set(partesConta.map((p) => gasDe(usoPorId.get(p.uso)!)))];
          for (const gas of gases) {
            // O que esta conta JÁ cobrou do gás: as partes gravadas na memória dos itens dela (a inclusão de cada
            // item e a apuração sem diferença). Nunca o conta_hospitalar_id nem o horário do uso: um uso faturado
            // noutra conta que caia no período desta (período ajustado depois, conta fechada sobreposta) não entra
            // de novo. O item transferido saiu da conta e não conta; o estornado conta no acumulado e sai dos
            // lançados, e a diferença volta a ser cobrada.
            const registros = await tx.consultar(
              `SELECT i.id, i.item_faturavel_id, i.quantidade, i.situacao, m.operacao, m.dados
                 FROM conta_hospitalar_item i
                 JOIN conta_hospitalar_item_memoria m ON m.conta_hospitalar_item_id = i.id
                  AND m.operacao IN ('inclusao', 'alteracao')
                WHERE i.conta_hospitalar_id = ? AND i.excluido_em IS NULL AND i.situacao <> 'transferido'
                  AND JSON_VALUE(m.dados, '$.regra') = 'gas_tempo_uso' AND JSON_VALUE(m.dados, '$.gas') = ?
                ORDER BY i.id, m.id`,
              [contaId, gas],
            );
            const lancados = registros
              .filter((x) => x['operacao'] === 'inclusao' && x['situacao'] !== 'estornado')
              .map((x) => ({ item: num(x['item_faturavel_id']), quantidade: num(x['quantidade']) }));
            const cobrados = trechosCobradosNaConta(registros, usoPorId, periodoDe, gas);
            const jaCobrados = new Set(cobrados.map((x) => x.uso));
            // O trecho de um uso já apurado nesta conta não entra de novo como pendente.
            const partes = partesConta.filter(
              (p) => gasDe(usoPorId.get(p.uso)!) === gas && !jaCobrados.has(p.uso),
            );
            for (const p of partesConta)
              if (gasDe(usoPorId.get(p.uso)!) === gas && jaCobrados.has(p.uso))
                resolvidas.add(`${p.uso}|${p.conta}`);
            if (!partes.length) continue;
            const pend = [...new Set(partes.map((p) => p.uso))].map((id) => usoPorId.get(id)!);
            // O acumulado do gás nesta conta: o já cobrado nela mais as partes pendentes deste período; os outros
            // gases entram inteiros para o uso simultâneo.
            const usosCalculo = [
              ...cobrados.map((x) => x.periodo),
              ...partes.map((p) => ({ ...periodoDe(usoPorId.get(p.uso)!), inicio: p.inicio, fim: p.fim })),
              ...usos.filter((u) => gasDe(u) !== gas).map(periodoDe),
            ];
            const acum = [...new Set([...cobrados.map((x) => x.uso), ...pend.map((u) => num(u['id']))])];
            const ultimoItem = registros.filter((x) => x['situacao'] !== 'estornado').at(-1);
            const ancora = ultimoItem ? num(ultimoItem['id']) : null;
            const fimPartes = partes.map((p) => p.fim).reduce((a, b) => (a > b ? a : b));
            const data = fimPartes.toISOString().slice(0, 10);
            const vale = regraGasQueVale(
              await regrasDoGas(tx, est.id, gas),
              {
                fonte: numOuNull(conta['fonte_pagadora_id']),
                plano: numOuNull(conta['plano_fonte_pagadora_id']),
              },
              data,
            );
            if (!vale) {
              problemas.push({
                campo: 'regra',
                mensagem: `Gás sem regra de cobrança vigente para a fonte e o plano da conta (item ${gas}).`,
              });
              continue;
            }
            const cobranca = calcularCobrancaGas({ regra: vale.regra, gas, usos: usosCalculo });
            const itemFat = cobranca.itemFaixa ?? vale.cobranca ?? gas;
            const dif = diferencaALancarGas({ cobranca, item: itemFat, lancados });
            problemas.push(...dif.problemas);
            const preco = dif.quantidade > 0 ? await precoVigente(tx, tabelas, itemFat, data) : null;
            if (dif.quantidade > 0 && !preco)
              problemas.push({
                campo: 'preco',
                mensagem: `Sem preço vigente nas tabelas da conta para o item ${itemFat}: cadastre o preço antes de lançar.`,
              });
            calculos.push({ contaId, gas, partes, pend, acum, ancora, vale, cobranca, itemFat, dif, preco });
          }
        }
        // Falta de regra, de preço ou diferença sem acerto: recusa tudo, nada é lançado nem marcado.
        if (problemas.length) throw recusaRegra('Lançamento recusado', problemas);
        const origem = await tx.uma(
          "SELECT id FROM origem_lancamento WHERE codigo = 'estoque' AND ativo LIMIT 1",
          [],
        );
        const itens: number[] = [];
        const tocadas = new Set<number>();
        for (const k of calculos) {
          if (k.dif.quantidade > 0 && k.preco) {
            const fat = await tx.uma('SELECT grupo_faturamento_id FROM item_faturavel WHERE id = ?', [
              k.itemFat,
            ]);
            const seq = await tx.uma(
              'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
              [k.contaId],
            );
            const unitario = k.preco.unitario;
            const total = Math.round(unitario * k.dif.quantidade * 100) / 100;
            const inicio = k.partes.map((p) => p.inicio).reduce((a, b) => (a < b ? a : b));
            const fim = k.partes.map((p) => p.fim).reduce((a, b) => (a > b ? a : b));
            const item = await tx.incluir('conta_hospitalar_item', {
              conta_hospitalar_id: k.contaId,
              sequencia: num(seq?.['s']),
              item_faturavel_id: k.itemFat,
              grupo_faturamento_id: numOuNull(fat?.['grupo_faturamento_id']),
              origem_lancamento_id: numOuNull(origem?.['id']),
              realizado_em: inicio,
              realizado_fim_em: fim,
              quantidade: k.dif.quantidade,
              valor_unitario: unitario,
              percentual_cobranca: 100,
              valor_total: total,
              setor_funcional_id: numOuNull(k.pend[0]!['setor_funcional_id']),
              tipo_valorizacao: 'tabela',
              situacao: 'lancado',
              observacao:
                `Gás medicinal por tempo de uso (${k.cobranca.minutosCobraveis} min cobráveis acumulados na conta).`.slice(
                  0,
                  2000,
                ),
            });
            await tx.incluir('conta_hospitalar_item_memoria', {
              conta_hospitalar_item_id: item,
              operacao: 'inclusao',
              dados: JSON.stringify({
                regra: 'gas_tempo_uso',
                gas: k.gas,
                regraCobrancaGas: k.vale.id,
                usos: k.pend.map((u) => num(u['id'])),
                // O trecho de cada uso cobrado nesta conta (o uso que atravessa a virada da conta parcial é dividido).
                partes: k.partes.map((p) => ({
                  uso: p.uso,
                  inicio: p.inicio.toISOString(),
                  fim: p.fim.toISOString(),
                })),
                usosAcumulados: k.acum,
                quantidadeAcumulada: k.cobranca.quantidade,
                passos: [...k.cobranca.passos, ...k.dif.passos],
              }),
              ocorrido_em: new Date(),
              usuario_id: usuario,
              tabela_preco_id: k.preco.tabela ?? null,
              percentual_aplicado: 100,
              valor_unitario_calculado: unitario,
              valor_total_calculado: total,
            });
            itens.push(item);
            for (const p of k.partes) resolvidas.add(`${p.uso}|${p.conta}`);
            tocadas.add(k.contaId);
          } else if (k.ancora !== null) {
            // Sem diferença (tolerância, sobreposição não cobrada ou arredondamento já coberto): a apuração fica na
            // memória do último item do gás nesta conta, com as partes, e entra no acumulado dos próximos lançamentos.
            await tx.incluir('conta_hospitalar_item_memoria', {
              conta_hospitalar_item_id: k.ancora,
              operacao: 'alteracao',
              dados: JSON.stringify({
                regra: 'gas_tempo_uso',
                gas: k.gas,
                apuracao: 'sem_diferenca',
                regraCobrancaGas: k.vale.id,
                usos: k.pend.map((u) => num(u['id'])),
                partes: k.partes.map((p) => ({
                  uso: p.uso,
                  inicio: p.inicio.toISOString(),
                  fim: p.fim.toISOString(),
                })),
                usosAcumulados: k.acum,
                quantidadeAcumulada: k.cobranca.quantidade,
                passos: [...k.cobranca.passos, ...k.dif.passos],
              }),
              ocorrido_em: new Date(),
              usuario_id: usuario,
            });
            for (const p of k.partes) resolvidas.add(`${p.uso}|${p.conta}`);
            tocadas.add(k.contaId);
          }
          // Sem item do gás na conta e nada a cobrar ainda (tudo dentro da tolerância): o uso continua na fila e entra
          // no acumulado do próximo lançamento (não há onde gravar a apuração sem um item).
        }
        // O uso sai da fila quando todas as suas partes foram apuradas; o dividido aponta a conta da última parte.
        for (const u of pendentes) {
          const doUso = rep.partes.filter((p) => p.uso === num(u['id']));
          if (!doUso.every((p) => resolvidas.has(`${p.uso}|${p.conta}`))) continue;
          await tx.alterar('uso_gas_medicinal', num(u['id']), num(u['versao']), {
            faturado: true,
            conta_hospitalar_id: doUso.at(-1)!.conta,
          });
        }
        for (const id of tocadas) {
          const k = contas.find((x) => num(x['id']) === id)!;
          if (bool(k['calculada']))
            await tx.alterar('conta_hospitalar', id, num(k['versao']), { calculada: false });
        }
        const ultimaConta = [...tocadas].at(-1) ?? rep.partes.at(-1)!.conta;
        return { tabela: 'conta_hospitalar', id: ultimaConta, itens };
      },
    );
  }
}
