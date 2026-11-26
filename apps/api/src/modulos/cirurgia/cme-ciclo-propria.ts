// Ciclo de esterilização pelos testes dos indicadores e rejeição no reprocessamento (CME; F7, 04-CME linha 116;
// RDC 15/2012) no banco do cliente, pelo @sgh/nucleo, sempre no estabelecimento da sessão. Regras em
// @sgh/dominio-cirurgia (cme/ciclo-testes). Estende a porta da CME (05-SUP linha 29), que já abre a carga no
// equipamento com número e lote e aplica o desfecho aos pacotes. Contrato de efeito:
//   - teste: cada indicador do ciclo (teste_ciclo_esterilizacao com sequência, tipo, lote e validade do indicador,
//     incubação, leitura, resultado, controle positivo, valor medido e responsável);
//   - encerrar: o desfecho sai dos testes registrados, nunca do que a tela manda: o ciclo em andamento só se conclui
//     com físico e químico lidos e só se libera com indicador APROVADO (o biológico na carga com implante, que fica
//     concluída aguardando); indicador reprovado reprova a carga e rejeita os pacotes; o ciclo guarda os parâmetros e
//     os indicadores aprovados;
//   - rejeitar: o pacote ou o ciclo (rejeicao_reprocessamento com motivo, fase, setor, retorno e responsável); o pacote
//     fica rejeitado; o ciclo concluído ou liberado fica reprovado e os pacotes ainda na CME ficam rejeitados; os já
//     distribuídos do mesmo ciclo entram em recolhimento (recall), com a rejeição "em_recolhimento";
//   - recolher: o pacote distribuído volta e fica rejeitado; a rejeição conta o recolhido e se conclui sozinha quando
//     não sobra pacote fora.
// Nada é apagado. Recusa da regra: 422, sem escrita. Outro estabelecimento: 404.
import {
  CATEGORIAS_INDICADOR,
  type CategoriaIndicador,
  conferirRecolhimento,
  conferirRejeicao,
  conferirTeste,
  desfechoDaLiberacao,
  desfechoDoCiclo,
  exigeRecolhimento,
  indicadoresDosTestes,
  type ProblemaCme,
  RESULTADOS_TESTE,
  type ResultadoTeste,
  situacaoDaRejeicao,
} from '@sgh/dominio-cirurgia';
import type { TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';
import { hojeNo, type Linha, PortaCmePropria, TABELAS_CME } from './cme-propria.js';

export const PORTA_CME_CICLO = Symbol('PORTA_CME_CICLO');

export const TABELAS_CME_CICLO = [
  ...TABELAS_CME,
  'teste_ciclo_esterilizacao',
  'rejeicao_reprocessamento',
  'caixa_instrumental',
] as const;

const id = z.number().int().positive();
const instanteTela = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
const esquemaTeste = z
  .object({
    tipo: id,
    resultado: z.enum(RESULTADOS_TESTE),
    lote: z.string().trim().max(30).nullable().default(null),
    validade: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    incubacaoInicio: instanteTela.nullable().default(null),
    leitura: instanteTela.nullable().default(null),
    controlePositivoOk: z.boolean().nullable().default(null),
    valorMedido: z.string().trim().max(100).nullable().default(null),
    observacao: z.string().trim().max(500).nullable().default(null),
  })
  .strict();
const esquemaEncerrar = z
  .object({
    versao: id,
    temperatura: z.number().min(0).max(999).nullable().default(null),
    pressao: z.number().min(0).max(99999).nullable().default(null),
    tempoExposicao: z.number().int().min(0).max(1440).nullable().default(null),
    observacao: z.string().trim().max(500).nullable().default(null),
  })
  .strict();
const esquemaRejeitar = z
  .object({
    objeto: z.enum(['pacote', 'ciclo']),
    pacote: id.nullable().default(null),
    ciclo: id.nullable().default(null),
    motivo: id,
    fase: id,
    setor: id.nullable().default(null),
    descricao: z.string().trim().max(500).nullable().default(null),
    retorna: z.boolean().default(true),
    faseRetorno: id.nullable().default(null),
  })
  .strict()
  .refine((e) => (e.objeto === 'pacote' ? e.pacote !== null : e.ciclo !== null), {
    message: 'Informe o pacote ou o ciclo rejeitado.',
  });
const esquemaRecolher = z.object({ pacote: id }).strict();

const recusa = (titulo: string, p: readonly ProblemaCme[]) => {
  if (p.length) throw recusaRegra(titulo, p);
};
const instante = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 16) : v ? String(v).replace(' ', 'T').slice(0, 16) : null;
const dia = (v: unknown): string | null => (v ? (instante(v) ?? '').slice(0, 10) || null : null);
const quando = (v: string | null): Date | null => (v ? new Date(`${v.slice(0, 16)}:00`) : null);

export interface TipoIndicadorLido {
  readonly id: number;
  readonly descricao: string;
  readonly categoria: CategoriaIndicador;
  readonly exigeLote: boolean;
  readonly exigeControle: boolean;
  readonly liberacaoDepende: boolean;
}
export interface TesteLido {
  readonly id: number;
  readonly sequencia: number;
  readonly tipo: number;
  readonly descricao: string;
  readonly categoria: CategoriaIndicador;
  readonly resultado: ResultadoTeste;
  readonly lote: string | null;
  readonly validade: string | null;
  readonly leitura: string | null;
  readonly responsavel: string | null;
}
export interface RejeicaoLida {
  readonly id: number;
  readonly motivo: string;
  readonly fase: string;
  readonly pacote: number | null;
  readonly etiqueta: string | null;
  readonly ciclo: number | null;
  readonly numeroCiclo: string | null;
  readonly situacao: string;
  readonly exigeRecolhimento: boolean;
  readonly recolhidos: number;
  readonly pendentes: number;
  readonly rejeitadoEm: string | null;
}
export interface CicloComTestes {
  readonly id: number;
  readonly numero: string;
  readonly lote: string;
  readonly equipamento: string;
  readonly metodo: string;
  readonly situacao: string;
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly versao: number;
  readonly implante: boolean;
  readonly indicadores: ReturnType<typeof indicadoresDosTestes>;
  readonly testes: TesteLido[];
  readonly pacotes: { id: number; etiqueta: string; situacao: string }[];
}
export interface PainelCiclos {
  readonly ciclos: { id: number; numero: string; lote: string; situacao: string; inicio: string | null }[];
  readonly tipos: TipoIndicadorLido[];
  readonly motivos: { id: number; descricao: string; fase: number | null; exigeRecolhimento: boolean }[];
  readonly fases: { id: number; descricao: string; ordem: number }[];
  readonly rejeicoes: RejeicaoLida[];
}

const categoria = (v: unknown): CategoriaIndicador =>
  (CATEGORIAS_INDICADOR as readonly string[]).includes(String(v)) ? (String(v) as CategoriaIndicador) : 'fisico';

type Fonte = Pick<TxOperacao, 'consultar' | 'uma'>;

export class PortaCmeCicloPropria extends PortaCmePropria {
  constructor(nucleo: ConstructorParameters<typeof PortaCmePropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS_CME_CICLO);
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────────

  painelCiclos(c: ContextoPortaPropria): Promise<PainelCiclos> {
    return this.ler(c, 'ciclos', async (l, est) => {
      const ciclos = await l.consultar(
        `SELECT id, numero, numero_lote, situacao, inicio_em FROM ciclo_esterilizacao
          WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY inicio_em DESC, id DESC LIMIT 100`,
        [est.id],
      );
      const tipos = await l.consultar(
        `SELECT id, descricao, categoria, exige_lote, exige_controle, liberacao_depende
           FROM tipo_indicador_esterilizacao WHERE ativo = TRUE ORDER BY categoria, descricao`,
      );
      const motivos = await l.consultar(
        `SELECT id, descricao, fase_reprocessamento_id, exige_recolhimento FROM motivo_rejeicao_reprocessamento
          WHERE ativo = TRUE ORDER BY descricao`,
      );
      const fases = await l.consultar(
        'SELECT id, descricao, ordem FROM fase_reprocessamento WHERE ativo = TRUE ORDER BY ordem',
      );
      return {
        ciclos: ciclos.map((r) => ({
          id: num(r['id']),
          numero: String(r['numero']),
          lote: String(r['numero_lote']),
          situacao: String(r['situacao']),
          inicio: instante(r['inicio_em']),
        })),
        tipos: tipos.map((r) => this.tipoLido(r)),
        motivos: motivos.map((r) => ({
          id: num(r['id']),
          descricao: String(r['descricao']),
          fase: numOuNull(r['fase_reprocessamento_id']),
          exigeRecolhimento: bool(r['exige_recolhimento']),
        })),
        fases: fases.map((r) => ({ id: num(r['id']), descricao: String(r['descricao']), ordem: num(r['ordem']) })),
        rejeicoes: await this.rejeicoes(l, est.id),
      };
    });
  }

  ciclo(c: ContextoPortaPropria, ciclo: number): Promise<CicloComTestes> {
    return this.ler(c, 'ciclo', (l, est) => this.cicloComTestes(l, est.id, ciclo));
  }

  private tipoLido(r: Linha): TipoIndicadorLido {
    return {
      id: num(r['id']),
      descricao: String(r['descricao']),
      categoria: categoria(r['categoria']),
      exigeLote: bool(r['exige_lote']),
      exigeControle: bool(r['exige_controle']),
      liberacaoDepende: bool(r['liberacao_depende']),
    };
  }

  private async rejeicoes(l: Fonte, est: number): Promise<RejeicaoLida[]> {
    const rs = await l.consultar(
      `SELECT r.id, m.descricao AS motivo, f.descricao AS fase, r.pacote_esteril_id, p.codigo_etiqueta,
              r.ciclo_esterilizacao_id, c.numero AS numero_ciclo, r.situacao, r.exige_recolhimento,
              r.pacotes_recolhidos, r.rejeitado_em,
              (SELECT COUNT(*) FROM pacote_esteril d
                WHERE d.ciclo_esterilizacao_id = COALESCE(r.ciclo_esterilizacao_id, p.ciclo_esterilizacao_id)
                  AND d.situacao = 'distribuido' AND d.excluido_em IS NULL) AS pendentes
         FROM rejeicao_reprocessamento r
         JOIN motivo_rejeicao_reprocessamento m ON m.id = r.motivo_rejeicao_reprocessamento_id
         JOIN fase_reprocessamento f ON f.id = r.fase_reprocessamento_id
         LEFT JOIN pacote_esteril p ON p.id = r.pacote_esteril_id
         LEFT JOIN ciclo_esterilizacao c ON c.id = r.ciclo_esterilizacao_id
        WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL
        ORDER BY r.rejeitado_em DESC, r.id DESC LIMIT 100`,
      [est],
    );
    return rs.map((r) => ({
      id: num(r['id']),
      motivo: String(r['motivo']),
      fase: String(r['fase']),
      pacote: numOuNull(r['pacote_esteril_id']),
      etiqueta: txtOuNull(r['codigo_etiqueta']),
      ciclo: numOuNull(r['ciclo_esterilizacao_id']),
      numeroCiclo: txtOuNull(r['numero_ciclo']),
      situacao: String(r['situacao']),
      exigeRecolhimento: bool(r['exige_recolhimento']),
      recolhidos: num(r['pacotes_recolhidos']),
      pendentes: String(r['situacao']) === 'em_recolhimento' ? num(r['pendentes']) : 0,
      rejeitadoEm: instante(r['rejeitado_em']),
    }));
  }

  private async cicloComTestes(l: Fonte, est: number, ciclo: number): Promise<CicloComTestes> {
    const r = await l.uma(
      `SELECT c.id, c.numero, c.numero_lote, c.situacao, c.inicio_em, c.fim_em, c.versao,
              e.descricao AS equipamento, m.descricao AS metodo
         FROM ciclo_esterilizacao c
         JOIN equipamento_esterilizacao e ON e.id = c.equipamento_esterilizacao_id
         JOIN metodo_esterilizacao m ON m.id = c.metodo_esterilizacao_id
        WHERE c.id = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL`,
      [ciclo, est],
    );
    if (!r) throw naoEncontrado('Ciclo de esterilização');
    const ts = await l.consultar(
      `SELECT t.id, t.sequencia, t.tipo_indicador_esterilizacao_id, ti.descricao, ti.categoria, ti.liberacao_depende,
              t.resultado, t.lote_indicador, t.validade_indicador, t.leitura_em, u.login AS responsavel
         FROM teste_ciclo_esterilizacao t
         JOIN tipo_indicador_esterilizacao ti ON ti.id = t.tipo_indicador_esterilizacao_id
         LEFT JOIN usuario u ON u.id = t.responsavel_usuario_id
        WHERE t.ciclo_esterilizacao_id = ? AND t.excluido_em IS NULL ORDER BY t.sequencia`,
      [ciclo],
    );
    const ps = await l.consultar(
      `SELECT p.id, p.codigo_etiqueta, p.situacao, p.material_terceiro_reprocessamento_id
         FROM ciclo_esterilizacao_item i JOIN pacote_esteril p ON p.id = i.pacote_esteril_id
        WHERE i.ciclo_esterilizacao_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
      [ciclo],
    );
    const testes: TesteLido[] = ts.map((t) => ({
      id: num(t['id']),
      sequencia: num(t['sequencia']),
      tipo: num(t['tipo_indicador_esterilizacao_id']),
      descricao: String(t['descricao']),
      categoria: categoria(t['categoria']),
      resultado: String(t['resultado']) as ResultadoTeste,
      lote: txtOuNull(t['lote_indicador']),
      validade: dia(t['validade_indicador']),
      leitura: instante(t['leitura_em']),
      responsavel: txtOuNull(t['responsavel']),
    }));
    return {
      id: num(r['id']),
      numero: String(r['numero']),
      lote: String(r['numero_lote']),
      equipamento: String(r['equipamento']),
      metodo: String(r['metodo']),
      situacao: String(r['situacao']),
      inicio: instante(r['inicio_em']),
      fim: instante(r['fim_em']),
      versao: num(r['versao']),
      implante: ps.some((p) => p['material_terceiro_reprocessamento_id'] !== null),
      indicadores: indicadoresDosTestes(
        ts.map((t) => ({
          categoria: categoria(t['categoria']),
          resultado: String(t['resultado']) as ResultadoTeste,
          liberacaoDepende: bool(t['liberacao_depende']),
          tipo: num(t['tipo_indicador_esterilizacao_id']),
        })),
      ),
      testes,
      pacotes: ps.map((p) => ({
        id: num(p['id']),
        etiqueta: String(p['codigo_etiqueta'] ?? ''),
        situacao: String(p['situacao']),
      })),
    };
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────────────────────

  registrarTeste(c: ContextoPortaPropria, ciclo: number, entrada: unknown) {
    const e = entradaValida(esquemaTeste, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.ciclo.teste',
      ['teste_ciclo_esterilizacao', 'ciclo_esterilizacao'],
      async (tx, est, usuario) => {
        const ci = await this.cicloTravado(tx, est.id, ciclo);
        const inicio = await tx.uma('SELECT inicio_em FROM ciclo_esterilizacao WHERE id = ?', [ciclo]);
        const tipo = await tx.uma(
          `SELECT id, descricao, categoria, exige_lote, exige_controle, liberacao_depende
             FROM tipo_indicador_esterilizacao WHERE id = ? AND ativo = TRUE`,
          [e.tipo],
        );
        if (!tipo) throw naoEncontrado('Tipo de indicador');
        const t = this.tipoLido(tipo);
        recusa(
          'Teste recusado',
          conferirTeste({
            categoria: t.categoria,
            exigeLote: t.exigeLote,
            exigeControle: t.exigeControle,
            resultado: e.resultado,
            lote: e.lote,
            validade: e.validade,
            diaDoCiclo: dia(inicio?.['inicio_em']) ?? hojeNo(est.fuso),
            incubacaoInicio: e.incubacaoInicio,
            leitura: e.leitura,
            controlePositivoOk: e.controlePositivoOk,
            valorMedido: e.valorMedido,
            situacaoCiclo: String(ci['situacao']),
          }),
        );
        const seq = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM teste_ciclo_esterilizacao WHERE ciclo_esterilizacao_id = ?',
          [ciclo],
        );
        const teste = await tx.incluir('teste_ciclo_esterilizacao', {
          ciclo_esterilizacao_id: ciclo,
          sequencia: num(seq?.['s']),
          tipo_indicador_esterilizacao_id: e.tipo,
          lote_indicador: e.lote || null,
          validade_indicador: e.validade,
          incubacao_inicio_em: quando(e.incubacaoInicio),
          leitura_em: quando(e.leitura),
          resultado: e.resultado,
          controle_positivo_ok: t.exigeControle ? e.controlePositivoOk : null,
          valor_medido: e.valorMedido || null,
          responsavel_usuario_id: e.resultado === 'pendente' ? null : usuario,
          observacao: e.observacao,
        });
        return { tabela: 'teste_ciclo_esterilizacao', id: teste, teste };
      },
    );
  }

  /** Conclui ou libera o ciclo pelo que os testes registrados dizem. */
  encerrar(c: ContextoPortaPropria, ciclo: number, entrada: unknown) {
    const e = entradaValida(esquemaEncerrar, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.ciclo.encerrar',
      [
        'ciclo_esterilizacao',
        'pacote_esteril',
        'caixa_instrumental',
        'solicitacao_material_esteril_item',
        'solicitacao_material_esteril',
      ],
      async (tx, est, usuario) => {
        const ci = await this.cicloTravado(tx, est.id, ciclo);
        const atual = await this.cicloComTestes(tx, est.id, ciclo);
        const situacao = String(ci['situacao']);
        const i = atual.indicadores;
        const d =
          situacao === 'em_andamento'
            ? desfechoDoCiclo(i, atual.implante)
            : desfechoDaLiberacao(situacao, i.biologico);
        if (d.situacao === 'recusa') throw recusaRegra('Ciclo recusado', d.problemas);
        const agora = new Date();
        await tx.alterar('ciclo_esterilizacao', ciclo, e.versao, {
          ...(situacao === 'em_andamento'
            ? {
                fim_em: agora,
                encerrado_por_usuario_id: usuario,
                temperatura_c: e.temperatura,
                pressao_kpa: e.pressao,
                tempo_exposicao_minutos: e.tempoExposicao,
              }
            : {}),
          indicador_fisico: i.fisico === 'conforme',
          indicador_quimico: i.quimico === 'conforme',
          indicador_biologico: i.biologico === 'conforme',
          observacao: [txtOuNull(ci['observacao']), e.observacao, d.motivo].filter(Boolean).join(' ').slice(0, 500),
          ...this.marcaDesfecho(d, agora, usuario),
        });
        await this.aplicarAosPacotes(tx, est, ciclo, d, agora);
        return { tabela: 'ciclo_esterilizacao', id: ciclo, situacao: d.situacao, motivo: d.motivo };
      },
    );
  }

  rejeitar(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaRejeitar, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.rejeitar',
      ['rejeicao_reprocessamento', 'pacote_esteril', 'ciclo_esterilizacao'],
      async (tx, est, usuario) => {
        let pacote: Linha | null = null;
        let ciclo: Linha | null = null;
        if (e.objeto === 'pacote') {
          pacote =
            (
              await tx.consultarParaAtualizar<Linha>(
                'SELECT id, situacao, versao, ciclo_esterilizacao_id FROM pacote_esteril WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
                [e.pacote, est.id],
              )
            )[0] ?? null;
          if (!pacote) throw naoEncontrado('Pacote');
        } else ciclo = await this.cicloTravado(tx, est.id, e.ciclo!);
        const motivo = await tx.uma(
          'SELECT id, ativo, fase_reprocessamento_id, exige_recolhimento FROM motivo_rejeicao_reprocessamento WHERE id = ?',
          [e.motivo],
        );
        if (!motivo) throw naoEncontrado('Motivo de rejeição');
        const fase = await tx.uma('SELECT id, ordem FROM fase_reprocessamento WHERE id = ? AND ativo = TRUE', [e.fase]);
        if (!fase) throw naoEncontrado('Fase do reprocessamento');
        const retorno = e.faseRetorno
          ? await tx.uma('SELECT id, ordem FROM fase_reprocessamento WHERE id = ? AND ativo = TRUE', [e.faseRetorno])
          : null;
        if (e.faseRetorno && !retorno) throw naoEncontrado('Fase de retorno');
        if (e.setor) {
          const s = await tx.uma(
            'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [e.setor, est.id],
          );
          if (!s) throw naoEncontrado('Setor');
        }
        recusa(
          'Rejeição recusada',
          conferirRejeicao({
            objeto: e.objeto,
            situacao: String((pacote ?? ciclo)!['situacao']),
            motivoAtivo: bool(motivo['ativo']),
            faseDoMotivo: numOuNull(motivo['fase_reprocessamento_id']),
            fase: e.fase,
            retorna: e.retorna,
            faseRetorno: e.retorna ? e.faseRetorno : null,
            ordemFase: num(fase['ordem']),
            ordemRetorno: retorno ? num(retorno['ordem']) : null,
            descricao: e.descricao,
          }),
        );
        const cicloId = ciclo ? num(ciclo['id']) : numOuNull(pacote!['ciclo_esterilizacao_id']);
        const agora = new Date();
        if (pacote)
          await tx.alterar('pacote_esteril', num(pacote['id']), num(pacote['versao']), { situacao: 'rejeitado' });
        if (ciclo)
          await tx.alterar('ciclo_esterilizacao', num(ciclo['id']), num(ciclo['versao']), {
            situacao: 'reprovado',
            ...(String(ciclo['situacao']) === 'concluido'
              ? { liberado_em: agora, liberado_por_usuario_id: usuario }
              : {}),
            observacao: [txtOuNull(ciclo['observacao']), `Rejeitado: ${e.descricao ?? ''}`.trim()]
              .filter(Boolean)
              .join(' ')
              .slice(0, 500),
          });
        // Os irmãos do mesmo ciclo: no ciclo rejeitado (ou no motivo que obriga), os ainda na CME ficam rejeitados e os
        // distribuídos entram em recolhimento.
        const alcancaIrmaos = cicloId !== null && (ciclo !== null || bool(motivo['exige_recolhimento']));
        let distribuidos = 0;
        if (alcancaIrmaos) {
          const irmaos = await tx.consultarParaAtualizar<Linha>(
            `SELECT id, situacao, versao FROM pacote_esteril
              WHERE ciclo_esterilizacao_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND id <> ?`,
            [cicloId, est.id, pacote ? num(pacote['id']) : 0],
          );
          for (const p of irmaos) {
            const s = String(p['situacao']);
            if (s === 'distribuido') distribuidos++;
            else if (['em_preparo', 'aguardando_esterilizacao', 'esteril', 'vencido'].includes(s))
              await tx.alterar('pacote_esteril', num(p['id']), num(p['versao']), { situacao: 'rejeitado' });
          }
        }
        const recolher = exigeRecolhimento(e.objeto, bool(motivo['exige_recolhimento']), distribuidos);
        const situacao = situacaoDaRejeicao(recolher);
        const rej = await tx.incluir('rejeicao_reprocessamento', {
          estabelecimento_id: est.id,
          motivo_rejeicao_reprocessamento_id: e.motivo,
          fase_reprocessamento_id: e.fase,
          pacote_esteril_id: pacote ? num(pacote['id']) : null,
          ciclo_esterilizacao_id: ciclo ? num(ciclo['id']) : null,
          setor_funcional_id: e.setor,
          descricao: e.descricao,
          rejeitado_em: agora,
          rejeitado_por_usuario_id: usuario,
          retorna_reprocessamento: e.retorna,
          retorno_fase_reprocessamento_id: e.retorna ? e.faseRetorno : null,
          exige_recolhimento: recolher,
          pacotes_recolhidos: 0,
          recolhimento_concluido_em: null,
          situacao,
        });
        return { tabela: 'rejeicao_reprocessamento', id: rej, rejeicao: rej, situacao, distribuidos };
      },
    );
  }

  recolher(c: ContextoPortaPropria, rejeicao: number, entrada: unknown) {
    const e = entradaValida(esquemaRecolher, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.recolher',
      ['rejeicao_reprocessamento', 'pacote_esteril'],
      async (tx, est) => {
        const r =
          (
            await tx.consultarParaAtualizar<Linha>(
              `SELECT r.id, r.situacao, r.versao, r.pacotes_recolhidos,
                      COALESCE(r.ciclo_esterilizacao_id, p.ciclo_esterilizacao_id) AS ciclo
                 FROM rejeicao_reprocessamento r LEFT JOIN pacote_esteril p ON p.id = r.pacote_esteril_id
                WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`,
              [rejeicao, est.id],
            )
          )[0] ?? null;
        if (!r) throw naoEncontrado('Rejeição');
        const p =
          (
            await tx.consultarParaAtualizar<Linha>(
              `SELECT id, situacao, versao FROM pacote_esteril
                WHERE id = ? AND estabelecimento_id = ? AND ciclo_esterilizacao_id = ? AND excluido_em IS NULL`,
              [e.pacote, est.id, r['ciclo']],
            )
          )[0] ?? null;
        if (!p) throw naoEncontrado('Pacote do ciclo rejeitado');
        recusa('Recolhimento recusado', conferirRecolhimento(String(r['situacao']), String(p['situacao'])));
        await tx.alterar('pacote_esteril', num(p['id']), num(p['versao']), { situacao: 'rejeitado' });
        const resta = await tx.uma(
          `SELECT COUNT(*) AS n FROM pacote_esteril
            WHERE ciclo_esterilizacao_id = ? AND situacao = 'distribuido' AND excluido_em IS NULL`,
          [r['ciclo']],
        );
        const pendentes = num(resta?.['n']);
        await tx.alterar('rejeicao_reprocessamento', rejeicao, num(r['versao']), {
          pacotes_recolhidos: num(r['pacotes_recolhidos']) + 1,
          ...(pendentes === 0 ? { situacao: 'concluida', recolhimento_concluido_em: new Date() } : {}),
        });
        return {
          tabela: 'rejeicao_reprocessamento',
          id: rejeicao,
          pendentes,
          situacao: pendentes === 0 ? 'concluida' : 'em_recolhimento',
        };
      },
    );
  }
}
