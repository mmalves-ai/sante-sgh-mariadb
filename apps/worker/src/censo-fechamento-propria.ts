// Porta própria do fechamento do censo diário (internacao.fecharCenso; M16, ficha, seções 5 e 12; lote F2.2 05-15)
// sobre o banco do cliente, pelo @sgh/nucleo. Leitura (somente leitura, filtrada pelo estabelecimento e pelos excluídos):
// a chave `internacao.censo.fechamento` (liberacao_chave, recurso_prerequisito), o parâmetro de hora de fechamento
// (parametro_valor), as categorias de terapia intensiva (categoria_acomodacao), os dias já fechados (fechamento_censo)
// e o movimento do motor do censo (internacao, ocupacao_leito, leito_hospitalar, acomodacao, unidade_internacao,
// categoria_acomodacao). Gravação: o retrato do dia por unidade de internação (fechamento_censo e
// fechamento_censo_unidade) numa operação do Executor (a trilha e a idempotência na mesma transação).
// Melhoria: o retrato fica nas tabelas próprias do censo, uma linha por unidade de internação e dia com os totais e as
// linhas do motor (resumo), sob a chave única (estabelecimento, unidade, data): dois processos não fecham o mesmo dia.
// Melhoria: o dia reaberto pela tela não é refechado pelo worker (conta como já tratado).
// Melhoria: o corte do dia é gravado (corte_em, no fuso do estabelecimento) e a versão do cálculo vai no resumo.
// Melhoria: o agrupamento do motor é a unidade de internação do cadastro (código da unidade no lugar do antigo "bloco"),
// a da acomodação de cada leito (NOT NULL no modelo): duas unidades no mesmo andar ou bloco não se misturam, a
// acomodação sem bloco conta, e a acomodação é chaveada por (unidade, código), a chave única do cadastro. A internação
// ainda sem leito conta na unidade dela (internacao.unidade_internacao_id).
// Melhoria: a terapia intensiva é o que a acomodação é (categoria_acomodacao.tipo = 'terapia_intensiva' ou
// categoria_acomodacao.terapia_intensiva), não uma lista de códigos numéricos; o tipo do trecho é a categoria da
// acomodação física do leito, não a da acomodação cobrada.
import { randomUUID } from 'node:crypto';
import {
  esquemaLinhaCenso,
  type InternacaoMovimento,
  type LinhaCenso,
  type MovimentoInternacao,
  type PosicaoLeito,
  type TransferenciaMovimento,
  type TrechoMovimento,
} from '@sgh/contratos';
import { grupoDoTipoSaida } from '@sgh/dominio-internacao';
import { definirOperacao, type Executor, type Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import { valorDoParametro } from './clientes-worker.js';
import {
  type AlvoEstabelecimento,
  conflitoConcorrente,
  diaEHoraLocal,
  estabelecimentosAtivos,
  instanteLocal,
  type NucleoWorker,
  recursoLigadoAqui,
} from './servico-worker.js';

export const CHAVE_FECHAMENTO = 'internacao.censo.fechamento';
const TETO_MOVIMENTO = 500_000;

export interface ConfiguracaoCenso {
  readonly ligada: boolean;
  readonly horaFechamento: number | null;
  /** As categorias de acomodação de terapia intensiva (ids de categoria_acomodacao, o "tipo" do trecho no motor). */
  readonly categoriasIntensivas: readonly number[];
}

export interface DiaCensoParaGravar {
  readonly data: string;
  readonly horaFechamento: number;
  readonly versaoCalculo: number;
  readonly linhas: readonly LinhaCenso[];
}

export interface DiaCensoGravado {
  /** Unidades de internação gravadas (0: o dia não tem nenhuma linha, estabelecimento sem acomodação; nada gravado). */
  readonly unidades: number;
  readonly linhas: number;
  readonly internados: number;
}

export interface PortaCenso {
  estabelecimentos(): Promise<AlvoEstabelecimento[]>;
  configuracao(est: AlvoEstabelecimento, agora: Date): Promise<ConfiguracaoCenso>;
  /** Os dias da janela já fechados (ou reabertos pela tela), AAAA-MM-DD. */
  diasFechados(est: AlvoEstabelecimento, de: string, ate: string): Promise<string[]>;
  movimento(est: AlvoEstabelecimento): Promise<MovimentoInternacao>;
  /** null: outro processo fechou o dia antes (ou está fechando agora). */
  gravarDia(est: AlvoEstabelecimento, dia: DiaCensoParaGravar): Promise<DiaCensoGravado | null>;
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const dia = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

/**
 * A posição de cada leito para o motor: o "bloco" é o código da unidade de internação da acomodação do leito e a
 * acomodação é o código dela (único por unidade). O leito excluído entra na posição (a ocupação antiga continua no
 * lugar dela); a capacidade conta só o não excluído.
 */
const SQL_POSICAO = `
  SELECT lh.id, lh.acomodacao_id, ui.codigo AS unidade, ac.codigo AS acomodacao, lh.codigo AS leito, lh.ativo,
         lh.excluido_em IS NOT NULL AS excluido
    FROM leito_hospitalar lh
    JOIN acomodacao ac ON ac.id = lh.acomodacao_id
    JOIN unidade_internacao ui ON ui.id = ac.unidade_internacao_id
   WHERE lh.estabelecimento_id = ?`;

/**
 * Código e id das unidades de internação do estabelecimento. A excluída entra de propósito: a internação antiga e o
 * retrato do dia continuam na unidade em que aconteceram.
 */
const SQL_UNIDADES = 'SELECT id, codigo FROM unidade_internacao WHERE estabelecimento_id = ?';

/**
 * Categorias de acomodação de terapia intensiva (cadastro do cliente inteiro: a tabela não tem estabelecimento nem
 * exclusão lógica; a inativa entra, porque a permanência antiga nela continua sendo de terapia intensiva).
 */
const SQL_INTENSIVAS = `
  SELECT id FROM categoria_acomodacao
   WHERE tipo = 'terapia_intensiva' OR terapia_intensiva = TRUE
   ORDER BY id`;

/** A linha do motor cuja unidade não existe no cadastro: quebra de integridade, nunca descartada em silêncio. */
export class ErroCensoSemUnidade extends Error {
  override readonly name = 'ErroCensoSemUnidade';
}

const ENTRADA = z.object({
  estabelecimento: z.number().int().positive(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  corte: z.string().min(20),
  horaFechamento: z.number().int().min(1).max(24),
  versaoCalculo: z.number().int(),
  unidades: z
    .array(z.object({ unidade: z.number().int().positive(), linhas: z.array(esquemaLinhaCenso) }))
    .min(1),
});

function somar(linhas: readonly LinhaCenso[]) {
  const s = (f: (l: LinhaCenso) => number) => linhas.reduce((a, l) => a + f(l), 0);
  return {
    internados: s((l) => l.internados),
    admissoes: s((l) => l.admissoes),
    saidas: s((l) => l.saidas),
    obitos: s((l) => l.obitos),
    entrada: s((l) => l.transferenciasEntrada),
    saida: s((l) => l.transferenciasSaida),
    leitos: s((l) => l.leitosOperacionais),
  };
}

export class PortaCensoPropria implements PortaCenso {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoWorker,
    readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(est: number | null, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, estabelecimento: est, correlacao: 'censo-fechamento' },
      fn,
    );
  }

  estabelecimentos(): Promise<AlvoEstabelecimento[]> {
    return this.ler(null, (l) => estabelecimentosAtivos(l, this.cliente));
  }

  configuracao(est: AlvoEstabelecimento, agora: Date): Promise<ConfiguracaoCenso> {
    const alvo = { cliente: this.cliente, estabelecimento: { id: est.id, codigo: est.codigo } };
    return this.ler(est.id, async (l) => {
      const hora = await valorDoParametro(l, 'internacao.censo.horaFechamento', alvo, agora);
      return {
        ligada: await recursoLigadoAqui(l, CHAVE_FECHAMENTO, est.id, agora),
        horaFechamento: typeof hora === 'number' ? hora : null,
        categoriasIntensivas: (await l.consultar(SQL_INTENSIVAS, [], { teto: 1000 })).map((r) => n(r['id'])),
      };
    });
  }

  diasFechados(est: AlvoEstabelecimento, de: string, ate: string): Promise<string[]> {
    return this.ler(est.id, async (l) =>
      (
        await l.consultar(
          `SELECT DISTINCT data_referencia FROM fechamento_censo
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN ('fechado', 'reaberto')
              AND data_referencia BETWEEN ? AND ?
            ORDER BY data_referencia`,
          [est.id, de, ate],
          { teto: 400 },
        )
      ).map((r) => dia(r['data_referencia'])),
    );
  }

  movimento(est: AlvoEstabelecimento): Promise<MovimentoInternacao> {
    return this.ler(est.id, async (l) => {
      const fuso = est.fuso;
      const posLinhas = await l.consultar(SQL_POSICAO, [est.id], { teto: 50_000 });
      const posicoes = new Map<number, PosicaoLeito>(
        posLinhas.map((r) => [
          n(r['id']),
          { bloco: texto(r['unidade']), acomodacao: texto(r['acomodacao']), leito: texto(r['leito']) },
        ]),
      );
      const categoriaDoLeito = new Map<number, number>();
      const codigoUnidade = new Map(
        (await l.consultar(SQL_UNIDADES, [est.id], { teto: 5000 })).map((r) => [
          n(r['id']),
          texto(r['codigo']),
        ]),
      );
      const tipos = new Map(
        (
          await l.consultar('SELECT id, descricao FROM categoria_acomodacao ORDER BY id', [], { teto: 1000 })
        ).map((r) => [n(r['id']), texto(r['descricao'])]),
      );
      const acomodacoes = await l.consultar(
        `SELECT ac.id, ui.codigo AS unidade, ac.codigo AS acomodacao, ac.nome, ac.categoria_acomodacao_id,
                ac.tipo_atendimento, ac.excluido_em IS NOT NULL AS excluida
           FROM acomodacao ac JOIN unidade_internacao ui ON ui.id = ac.unidade_internacao_id
          WHERE ac.estabelecimento_id = ?
          ORDER BY ui.codigo, ac.codigo`,
        [est.id],
        { teto: 20_000 },
      );
      const categoriaAcomodacao = new Map(
        acomodacoes.map((a) => [n(a['id']), nn(a['categoria_acomodacao_id'])]),
      );
      for (const r of posLinhas) {
        const c = categoriaAcomodacao.get(n(r['acomodacao_id']));
        if (c !== null && c !== undefined) categoriaDoLeito.set(n(r['id']), c);
      }
      const intern = await l.consultar(
        `SELECT i.id, i.paciente_id, i.data_hora_entrada, i.data_hora_alta, i.leito_hospitalar_id, i.unidade_internacao_id,
                ms.tipo_saida, ca.urgencia, em.descricao AS clinica
           FROM internacao i
           JOIN carater_admissao ca ON ca.id = i.carater_admissao_id
           JOIN especialidade_medica em ON em.id = i.especialidade_medica_id
           LEFT JOIN motivo_saida_hospitalar ms ON ms.id = i.motivo_saida_hospitalar_id
          WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.situacao <> 'cancelada'
          ORDER BY i.data_hora_entrada, i.id`,
        [est.id],
        { teto: TETO_MOVIMENTO },
      );
      const ocup = await l.consultar(
        `SELECT o.id, o.internacao_id, o.leito_hospitalar_id, o.data_hora_inicio, o.data_hora_fim,
                o.anterior_ocupacao_leito_id
           FROM ocupacao_leito o
          WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL AND o.situacao <> 'cancelada'
          ORDER BY o.data_hora_inicio, o.id`,
        [est.id],
        { teto: TETO_MOVIMENTO },
      );
      const vazio: PosicaoLeito = { bloco: '', acomodacao: '', leito: '' };
      const pos = (id: unknown): PosicaoLeito => posicoes.get(n(id)) ?? vazio;
      /** A internação sem ocupação: o leito dela, ou, ainda sem leito, a unidade dela (sem acomodação). */
      const posInternacao = (r: Record<string, unknown>): PosicaoLeito =>
        r['leito_hospitalar_id'] !== null && r['leito_hospitalar_id'] !== undefined
          ? pos(r['leito_hospitalar_id'])
          : { bloco: codigoUnidade.get(n(r['unidade_internacao_id'])) ?? '', acomodacao: '', leito: '' };
      const primeiroLeito = new Map<number, unknown>();
      for (const o of ocup)
        if (!primeiroLeito.has(n(o['internacao_id'])))
          primeiroLeito.set(n(o['internacao_id']), o['leito_hospitalar_id']);
      const internacoes: InternacaoMovimento[] = intern.map((r) => {
        const e = diaEHoraLocal(r['data_hora_entrada'] as Date, fuso);
        const a = r['data_hora_alta'] instanceof Date ? diaEHoraLocal(r['data_hora_alta'], fuso) : null;
        return {
          ...(primeiroLeito.has(n(r['id'])) ? pos(primeiroLeito.get(n(r['id']))) : posInternacao(r)),
          reg: n(r['id']),
          paciente: n(r['paciente_id']),
          entrada: e.dia,
          horaEntrada: e.hora,
          alta: a?.dia ?? null,
          horaAlta: a?.hora ?? null,
          motivo: null,
          grupoSaida: grupoDoTipoSaida(r['tipo_saida'] === null ? null : texto(r['tipo_saida'])),
          carater: verdadeiro(r['urgencia']) ? '2' : '1',
          clinica: r['clinica'] === null ? null : texto(r['clinica']),
          permanencia: null,
        };
      });
      const porId = new Map(ocup.map((o) => [n(o['id']), o]));
      const trechos: TrechoMovimento[] = ocup.map((o) => {
        const e = diaEHoraLocal(o['data_hora_inicio'] as Date, fuso);
        const s = o['data_hora_fim'] instanceof Date ? diaEHoraLocal(o['data_hora_fim'], fuso) : null;
        return {
          ...pos(o['leito_hospitalar_id']),
          reg: n(o['internacao_id']),
          cod: n(o['id']),
          entrada: e.dia,
          horaEntrada: e.hora,
          saida: s?.dia ?? null,
          horaSaida: s?.hora ?? null,
          tipo: categoriaDoLeito.get(n(o['leito_hospitalar_id'])) ?? 0,
        };
      });
      const transferencias: TransferenciaMovimento[] = ocup.flatMap((o) => {
        const anterior = porId.get(n(o['anterior_ocupacao_leito_id']));
        if (!anterior) return [];
        const e = diaEHoraLocal(o['data_hora_inicio'] as Date, fuso);
        return [
          {
            reg: n(o['internacao_id']),
            data: e.dia,
            hora: e.hora,
            origem: pos(anterior['leito_hospitalar_id']),
            destino: pos(o['leito_hospitalar_id']),
          },
        ];
      });
      const leitosDa = new Map<number, Record<string, unknown>[]>();
      for (const x of posLinhas)
        if (!verdadeiro(x['excluido']))
          leitosDa.set(n(x['acomodacao_id']), [...(leitosDa.get(n(x['acomodacao_id'])) ?? []), x]);
      const unidades = acomodacoes
        .filter((a) => a['tipo_atendimento'] !== 'observacao' && !verdadeiro(a['excluida']))
        .map((a) => {
          const daqui = leitosDa.get(n(a['id'])) ?? [];
          return {
            bloco: texto(a['unidade']),
            acomodacao: texto(a['acomodacao']),
            nome: texto(a['nome']),
            tipo: nn(a['categoria_acomodacao_id']),
            leitos: daqui.length,
            leitosAtivos: daqui.filter((x) => verdadeiro(x['ativo'])).length,
          };
        });
      const hoje = diaEHoraLocal(new Date(), fuso).data;
      return {
        internacoes,
        trechos,
        transferencias,
        unidades,
        tipos,
        dadosAte: new Date(`${hoje}T00:00:00Z`),
      };
    });
  }

  async gravarDia(est: AlvoEstabelecimento, d: DiaCensoParaGravar): Promise<DiaCensoGravado | null> {
    const mapa = new Map(
      (await this.ler(est.id, (l) => l.consultar(SQL_UNIDADES, [est.id], { teto: 5000 }))).map((r) => [
        texto(r['codigo']),
        n(r['id']),
      ]),
    );
    const grupos = new Map<number, LinhaCenso[]>();
    for (const linha of d.linhas) {
      const u = mapa.get(linha.bloco);
      // O modelo garante a unidade (leito, acomodação e internação têm unidade NOT NULL): faltar é quebra de integridade.
      if (u === undefined)
        throw new ErroCensoSemUnidade(`censo: linha sem unidade de internação (${est.codigo}, ${d.data})`);
      grupos.set(u, [...(grupos.get(u) ?? []), linha]);
    }
    const base = {
      linhas: d.linhas.length,
      internados: d.linhas.reduce((a, l) => a + l.internados, 0),
    };
    if (grupos.size === 0) return { unidades: 0, ...base };
    const op = definirOperacao<z.infer<typeof ENTRADA>, { unidades: number; jaFechado: boolean }>({
      nome: 'internacao.fechar_censo',
      tabelas: ['fechamento_censo', 'fechamento_censo_unidade'],
      entrada: ENTRADA,
      gravar: async (tx, e) => {
        const ja = await tx.consultarParaAtualizar(
          'SELECT id FROM fechamento_censo WHERE estabelecimento_id = ? AND data_referencia = ? AND excluido_em IS NULL',
          [e.estabelecimento, e.data],
          { teto: 10_000 },
        );
        if (ja.length > 0) return { unidades: 0, jaFechado: true };
        const agora = new Date();
        let unidades = 0;
        for (const u of e.unidades) {
          const s = somar(u.linhas);
          const id = await tx.incluir('fechamento_censo', {
            estabelecimento_id: e.estabelecimento,
            unidade_internacao_id: u.unidade,
            data_referencia: e.data,
            corte_em: new Date(e.corte),
            situacao: 'fechado',
            fechado_em: agora,
            leitos_operacionais: Math.min(s.leitos, 65_535),
            pacientes_dia: s.internados,
            internacoes: s.admissoes,
            altas: Math.max(0, s.saidas - s.obitos),
            obitos: s.obitos,
            transferencias_entrada: s.entrada,
            transferencias_saida: s.saida,
            resumo: JSON.stringify({
              horaFechamento: e.horaFechamento,
              versaoCalculo: e.versaoCalculo,
              linhas: u.linhas,
            }),
          });
          await tx.incluir('fechamento_censo_unidade', {
            fechamento_censo_id: id,
            sequencia: 1,
            unidade_internacao_id: u.unidade,
            admissoes: s.admissoes,
            transferencias_entrada: s.entrada,
            altas: Math.max(0, s.saidas - s.obitos),
            transferencias_saida: s.saida,
            obitos: s.obitos,
            pacientes_fim_dia: s.internados,
            pacientes_dia: s.internados,
            leitos_dia: s.leitos,
            leitos_operacionais: s.leitos,
          });
          unidades++;
        }
        return { unidades, jaFechado: false };
      },
      alvo: () => ({ tabela: 'fechamento_censo', id: null }),
    });
    try {
      const r = await this.executor.executar(
        op,
        this.cliente,
        {
          estabelecimento: est.id,
          data: d.data,
          corte: instanteLocal(d.data, d.horaFechamento, est.fuso).toISOString(),
          horaFechamento: d.horaFechamento,
          versaoCalculo: d.versaoCalculo,
          unidades: [...grupos.entries()].map(([unidade, linhas]) => ({ unidade, linhas })),
        },
        {
          cliente: this.cliente,
          estabelecimento: est.id,
          usuario: null,
          correlacao: `censo-${est.codigo}-${d.data}`.slice(0, 64),
          chaveIdempotencia: `worker.censo.${est.id}.${d.data}.${randomUUID()}`,
        },
      );
      if (r.resultado.jaFechado) return null;
      return { unidades: r.resultado.unidades, ...base };
    } catch (x) {
      if (conflitoConcorrente(x)) return null;
      throw x;
    }
  }
}
