// Gases medicinais: consumo por setor (C1-050, 05-SUP linha 30), no banco do cliente. As regras são as puras de
// @sgh/dominio-internacao (gas-consumo-setor.ts); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - registrar: `consumo_gas_medicinal` do setor SEM paciente (atendimento nulo; o CHECK da tabela exige o setor), com
//     gás, setor, leito ou ponto de consumo opcionais, fluxo, início, fim e o volume (medido ou fluxo × minutos), quem
//     registrou e a situação ('em_uso' sem fim, 'encerrado' com fim);
//   - encerrar: fim, volume apurado e situação 'encerrado', com a versão lida;
//   - cancelar: situação 'cancelado' com o motivo na observação (lançado por engano; nunca apagado);
//   - apurar: por setor e gás no período, o uso dos pacientes (`uso_gas_medicinal`, registro à beira do leito) e o
//     consumo do setor sem paciente, cada um recortado ao período, com as parcelas impressas (cancelados fora).
import {
  apurarConsumoGasPorSetor,
  conferirConsumoGasSetor,
  conferirVinculoConsumoGasSetor,
  litrosPeloFluxo,
  type RegistroConsumoGas,
} from '@sgh/dominio-internacao';
import type { Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_GAS_SETOR = Symbol('PORTA_GAS_SETOR');

const TABELAS = ['consumo_gas_medicinal'];

export interface ConsumoGasSetorLido {
  readonly id: number;
  readonly setor: number;
  readonly setorNome: string;
  readonly insumo: number;
  readonly gasNome: string;
  readonly leito: number | null;
  readonly ponto: number | null;
  readonly fluxoLitrosMinuto: number | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly quantidadeLitros: number | null;
  readonly situacao: string;
  readonly observacao: string | null;
  readonly versao: number;
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();
const quando = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const esquemaRegistrar = z
  .object({
    setor: z.number().int().positive(),
    insumo: z.number().int().positive(),
    leito: z.number().int().positive().nullable().default(null),
    ponto: z.number().int().positive().nullable().default(null),
    fluxoLitrosMinuto: z.number().max(1000).nullable().default(null),
    quantidadeLitros: z.number().max(100_000_000).nullable().default(null),
    inicio: quando.optional(),
    fim: quando.nullable().default(null),
    observacao: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

const esquemaPeriodo = z
  .object({ de: dia, ate: dia, setor: z.coerce.number().int().positive().optional() })
  .strict()
  .refine((p) => p.de <= p.ate, { message: 'O início do período não pode ser depois do fim.', path: ['de'] })
  .refine((p) => (Date.parse(p.ate) - Date.parse(p.de)) / 86_400_000 <= 366, {
    message: 'O período vai até um ano.',
    path: ['ate'],
  });

function consumoLido(x: Record<string, unknown>): ConsumoGasSetorLido {
  return {
    id: num(x['id']),
    setor: num(x['setor_funcional_id']),
    setorNome: String(x['setor_nome'] ?? ''),
    insumo: num(x['insumo_id']),
    gasNome: String(x['gas_nome'] ?? ''),
    leito: numOuNull(x['leito_hospitalar_id']),
    ponto: numOuNull(x['ponto_consumo_gas_id']),
    fluxoLitrosMinuto: numOuNull(x['fluxo_litros_minuto']),
    inicio: iso(x['inicio_em'])!,
    fim: iso(x['fim_em']),
    quantidadeLitros: numOuNull(x['quantidade']),
    situacao: String(x['situacao']),
    observacao: txtOuNull(x['observacao']),
    versao: num(x['versao']),
  };
}

/** Início do dia civil no fuso do estabelecimento, em UTC (o período da apuração é em dias civis do hospital). */
function inicioDoDia(diaIso: string, fuso: string): Date {
  const base = new Date(`${diaIso}T00:00:00Z`);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(base);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'));
  return new Date(base.getTime() - (local - base.getTime()));
}

async function exigir(l: Leitor, sql: string, p: unknown[], oQue: string): Promise<Record<string, unknown>> {
  const r = await l.uma(sql, p);
  if (!r) throw naoEncontrado(oQue);
  return r;
}

export class PortaGasSetorPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.gas-setor');
  }

  /** Setores do estabelecimento e gases cadastrados, para as escolhas da tela. */
  opcoes(c: ContextoPortaPropria) {
    return this.ler(c, 'opcoes', async (l, est) => ({
      setores: (
        await l.consultar(
          `SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL
            ORDER BY nome LIMIT 2000`,
          [est.id],
        )
      ).map((s) => ({ id: num(s['id']), nome: String(s['nome']) })),
      gases: (
        await l.consultar(
          `SELECT id, nome FROM insumo WHERE tipo = 'gas_medicinal' AND excluido_em IS NULL ORDER BY nome LIMIT 500`,
        )
      ).map((s) => ({ id: num(s['id']), nome: String(s['nome']) })),
    }));
  }

  /** Consumos do setor sem paciente que tocam o período (o mais recente primeiro). */
  async consumos(c: ContextoPortaPropria, filtro: unknown): Promise<ConsumoGasSetorLido[]> {
    const f = entradaValida(esquemaPeriodo, filtro);
    return this.ler(c, 'consumos', async (l, est) => {
      const de = inicioDoDia(f.de, est.fuso);
      const ate = new Date(inicioDoDia(f.ate, est.fuso).getTime() + 86_400_000);
      const rs = await l.consultar(
        `SELECT g.*, s.nome AS setor_nome, i.nome AS gas_nome FROM consumo_gas_medicinal g
           JOIN setor_funcional s ON s.id = g.setor_funcional_id JOIN insumo i ON i.id = g.insumo_id
          WHERE g.estabelecimento_id = ? AND g.atendimento_id IS NULL AND g.excluido_em IS NULL
            AND g.inicio_em < ? AND (g.fim_em IS NULL OR g.fim_em >= ?) AND (? IS NULL OR g.setor_funcional_id = ?)
          ORDER BY g.inicio_em DESC, g.id DESC LIMIT 1000`,
        [est.id, ate, de, f.setor ?? null, f.setor ?? null],
      );
      return rs.map(consumoLido);
    });
  }

  async registrar(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; quantidadeLitros: number | null }> {
    const e = entradaValida(esquemaRegistrar, entrada);
    return this.gravar(c, 'internacao.gas-setor.registrar', TABELAS, async (tx, est) => {
      const agora = new Date();
      const inicio = e.inicio ?? agora;
      const p = conferirConsumoGasSetor({
        setor: e.setor,
        gas: e.insumo,
        fluxoLitrosMinuto: e.fluxoLitrosMinuto,
        quantidadeLitros: e.quantidadeLitros,
        inicio,
        fim: e.fim,
        agora,
      });
      if (p.length) throw recusaRegra('Consumo do setor recusado', p);
      await exigir(
        tx,
        'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.setor, est.id],
        'Setor',
      );
      await exigir(
        tx,
        "SELECT id FROM insumo WHERE id = ? AND tipo = 'gas_medicinal' AND excluido_em IS NULL",
        [e.insumo],
        'Gás medicinal',
      );
      // Ponto e leito: só do mesmo estabelecimento (outro estabelecimento é 404, sem revelar que existe); o vínculo
      // com o setor do consumo é regra do domínio (422).
      const ponto =
        e.ponto === null
          ? null
          : await exigir(
              tx,
              `SELECT setor_funcional_id, leito_hospitalar_id, ativo FROM ponto_consumo_gas
                WHERE id = ? AND estabelecimento_id = ?`,
              [e.ponto, est.id],
              'Ponto de consumo',
            );
      const leito =
        e.leito === null
          ? null
          : await exigir(
              tx,
              `SELECT u.setor_funcional_id FROM leito_hospitalar h
                 JOIN unidade_internacao u ON u.id = h.unidade_internacao_id
                WHERE h.id = ? AND h.estabelecimento_id = ?`,
              [e.leito, est.id],
              'Leito',
            );
      const v = conferirVinculoConsumoGasSetor({
        setor: e.setor,
        ponto: ponto && {
          setor: num(ponto['setor_funcional_id']),
          leito: numOuNull(ponto['leito_hospitalar_id']),
          ativo: Boolean(Number(ponto['ativo'])),
        },
        leito: e.leito,
        setorDoLeito: leito && numOuNull(leito['setor_funcional_id']),
      });
      if (v.problemas.length) throw recusaRegra('Consumo do setor recusado', v.problemas);
      const quantidade =
        e.quantidadeLitros ??
        (e.fim !== null && e.fluxoLitrosMinuto !== null
          ? litrosPeloFluxo(e.fluxoLitrosMinuto, inicio, e.fim)
          : null);
      const id = await tx.incluir('consumo_gas_medicinal', {
        estabelecimento_id: est.id,
        insumo_id: e.insumo,
        atendimento_id: null,
        setor_funcional_id: e.setor,
        leito_hospitalar_id: v.leito,
        ponto_consumo_gas_id: e.ponto,
        fluxo_litros_minuto: e.fluxoLitrosMinuto,
        inicio_em: inicio,
        fim_em: e.fim,
        quantidade,
        registrado_por_profissional_id: null,
        situacao: e.fim === null ? 'em_uso' : 'encerrado',
        observacao: e.observacao,
      });
      return { tabela: 'consumo_gas_medicinal', id, quantidadeLitros: quantidade };
    });
  }

  async encerrar(
    c: ContextoPortaPropria,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; quantidadeLitros: number | null }> {
    const x = entradaValida(
      z
        .object({
          fim: quando.optional(),
          quantidadeLitros: z.number().max(100_000_000).nullable().default(null),
          versao: z.number().int().positive(),
        })
        .strict(),
      entrada,
    );
    return this.gravar(c, 'internacao.gas-setor.encerrar', TABELAS, async (tx, est) => {
      const g = await exigir(
        tx,
        `SELECT setor_funcional_id, insumo_id, inicio_em, fluxo_litros_minuto, situacao FROM consumo_gas_medicinal
          WHERE id = ? AND estabelecimento_id = ? AND atendimento_id IS NULL AND excluido_em IS NULL`,
        [id, est.id],
        'Consumo do setor',
      );
      if (g['situacao'] !== 'em_uso')
        throw recusaRegra('Encerramento recusado', [
          { campo: 'situacao', mensagem: 'O consumo não está em andamento.' },
        ]);
      const agora = new Date();
      const fim = x.fim ?? agora;
      const inicio = g['inicio_em'] as Date;
      const fluxo = numOuNull(g['fluxo_litros_minuto']);
      const p = conferirConsumoGasSetor({
        setor: num(g['setor_funcional_id']),
        gas: num(g['insumo_id']),
        fluxoLitrosMinuto: fluxo,
        quantidadeLitros: x.quantidadeLitros,
        inicio,
        fim,
        agora,
      });
      if (p.length) throw recusaRegra('Encerramento recusado', p);
      const quantidade = x.quantidadeLitros ?? (fluxo !== null ? litrosPeloFluxo(fluxo, inicio, fim) : null);
      await tx.alterar('consumo_gas_medicinal', id, x.versao, {
        fim_em: fim,
        quantidade,
        situacao: 'encerrado',
      });
      return { tabela: 'consumo_gas_medicinal', id, quantidadeLitros: quantidade };
    });
  }

  async cancelar(c: ContextoPortaPropria, id: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(
      z.object({ motivo: z.string().trim().min(5).max(400), versao: z.number().int().positive() }).strict(),
      entrada,
    );
    return this.gravar(c, 'internacao.gas-setor.cancelar', TABELAS, async (tx, est) => {
      const g = await exigir(
        tx,
        `SELECT situacao, conta_hospitalar_item_id FROM consumo_gas_medicinal
          WHERE id = ? AND estabelecimento_id = ? AND atendimento_id IS NULL AND excluido_em IS NULL`,
        [id, est.id],
        'Consumo do setor',
      );
      if (g['situacao'] === 'cancelado' || g['situacao'] === 'faturado')
        throw recusaRegra('Cancelamento recusado', [
          { campo: 'situacao', mensagem: 'Consumo já cancelado ou faturado.' },
        ]);
      await tx.alterar('consumo_gas_medicinal', id, x.versao, {
        situacao: 'cancelado',
        observacao: `Cancelado: ${x.motivo}`.slice(0, 500),
      });
      return { tabela: 'consumo_gas_medicinal', id };
    });
  }

  /** Apuração por setor e gás no período (dias civis do estabelecimento), com as parcelas. */
  async apurar(c: ContextoPortaPropria, filtro: unknown) {
    const f = entradaValida(esquemaPeriodo, filtro);
    return this.ler(c, 'apurar', async (l, est) => {
      const de = inicioDoDia(f.de, est.fuso);
      const ate = new Date(inicioDoDia(f.ate, est.fuso).getTime() + 86_400_000);
      const setor = f.setor ?? null;
      const usos = await l.consultar(
        `SELECT u.setor_funcional_id, s.nome AS setor_nome, u.insumo_id, i.nome AS gas_nome, u.iniciado_em AS inicio,
                u.encerrado_em AS fim, u.fluxo_litros_minuto
           FROM uso_gas_medicinal u JOIN insumo i ON i.id = u.insumo_id
           LEFT JOIN setor_funcional s ON s.id = u.setor_funcional_id
          WHERE u.estabelecimento_id = ? AND u.excluido_em IS NULL AND u.situacao <> 'cancelado'
            AND u.iniciado_em < ? AND (u.encerrado_em IS NULL OR u.encerrado_em >= ?)
            AND (? IS NULL OR u.setor_funcional_id = ?)
          LIMIT 50000`,
        [est.id, ate, de, setor, setor],
      );
      const doSetor = await l.consultar(
        `SELECT g.setor_funcional_id, s.nome AS setor_nome, g.insumo_id, i.nome AS gas_nome, g.inicio_em AS inicio,
                g.fim_em AS fim, g.fluxo_litros_minuto, g.quantidade
           FROM consumo_gas_medicinal g JOIN insumo i ON i.id = g.insumo_id
           LEFT JOIN setor_funcional s ON s.id = g.setor_funcional_id
          WHERE g.estabelecimento_id = ? AND g.atendimento_id IS NULL AND g.excluido_em IS NULL
            AND g.situacao <> 'cancelado' AND g.inicio_em < ? AND (g.fim_em IS NULL OR g.fim_em >= ?)
            AND (? IS NULL OR g.setor_funcional_id = ?)
          LIMIT 50000`,
        [est.id, ate, de, setor, setor],
      );
      const registro =
        (origem: RegistroConsumoGas['origem']) =>
        (x: Record<string, unknown>): RegistroConsumoGas => ({
          origem,
          setor: numOuNull(x['setor_funcional_id']),
          setorNome: txtOuNull(x['setor_nome']),
          gas: num(x['insumo_id']),
          gasNome: String(x['gas_nome'] ?? ''),
          inicio: new Date(iso(x['inicio'])!),
          fim: x['fim'] === null || x['fim'] === undefined ? null : new Date(iso(x['fim'])!),
          fluxoLitrosMinuto: numOuNull(x['fluxo_litros_minuto']),
          quantidadeLitros: origem === 'setor' ? numOuNull(x['quantidade']) : null,
        });
      return {
        de: f.de,
        ate: f.ate,
        itens: apurarConsumoGasPorSetor({
          de,
          ate,
          agora: new Date(),
          registros: [...usos.map(registro('paciente')), ...doSetor.map(registro('setor'))],
        }),
      };
    });
  }
}
