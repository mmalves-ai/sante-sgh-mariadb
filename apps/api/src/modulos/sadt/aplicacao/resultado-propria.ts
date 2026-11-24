// Digitação, liberação e retificação do resultado no banco do cliente (F3.5, 05-SADT linha 10), pelo contrato novo: o
// exame pedido pelo id do exame_item do estabelecimento da sessão. A decisão é do domínio (dominio-sadt/resultado/ciclo):
// a faixa de referência vigente é copiada para cada analito no momento da digitação (fica congelada), o exame retido na
// bancada não recebe resultado nem é liberado, a liberação grava o profissional habilitado (assinatura do ato) e a
// retificação guarda a versão anterior inteira em resultado_exame_versao com o motivo. Nada é apagado; tudo pelo
// Executor, com a trilha na mesma transação.
import {
  avaliarValor,
  conferirDigitacao,
  conferirLiberacao,
  conferirRetificacao,
  type FaixaDoAnalito,
  liberacaoPrivativaDeMedico,
  MENSAGEM_RESULTADO,
  type ValorDigitado,
} from '@sgh/dominio-sadt';
import { ehMedico, ehResponsavelLaboratorio } from '@sgh/contratos';
import { type ContextoNucleo, definirOperacao, type Executor, type Leitor, recusa } from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';

const n = (v: unknown) => Number(v);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const esquemaValor = z
  .object({
    analito: z.number().int().positive(),
    numero: z.number().finite().nullable().default(null),
    texto: z.string().trim().max(2000).nullable().default(null),
  })
  .strict();

export const esquemaRegistrarResultadoBanco = z
  .object({
    valores: z.array(esquemaValor).min(1).max(200),
    observacao: z.string().trim().max(4000).optional(),
  })
  .strict();
export const esquemaLiberarResultadoBanco = z.object({}).strict();
export const esquemaRetificarResultadoBanco = z
  .object({ valores: z.array(esquemaValor).min(1).max(200), motivo: z.string().trim().min(10).max(1000) })
  .strict();

export interface ResultadoGravado {
  readonly resultado: number;
  readonly exame: number;
  readonly situacao: string;
  readonly numeroVersao: number;
  readonly critico: boolean;
  readonly anormal: boolean;
}

const TABELAS = [
  'resultado_exame',
  'resultado_analito',
  'resultado_exame_versao',
  'resultado_observacao',
  'exame_item',
];

type Tx = Parameters<Parameters<typeof definirOperacao>[0]['gravar']>[0];

export class ServicoResultadoSadt {
  private readonly executor: Executor;

  constructor(private readonly nucleo: NucleoSadt) {
    this.executor = nucleo.criarExecutor();
  }

  private ctxNucleo(c: ContextoSadt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'sadt').slice(0, 64),
    };
  }

  async registrar(c: ContextoSadt, exame: number, entrada: unknown): Promise<ResultadoGravado> {
    const e = esquemaRegistrarResultadoBanco.parse(entrada);
    return this.gravar(c, 'sadt.resultado.registrar', exame, null, async (tx, ctx) => {
      const faixas = await this.faixas(tx, ctx.exameId, ctx.paciente, ctx.agora);
      const falha = conferirDigitacao({
        situacaoExame: ctx.situacaoExame,
        retido: ctx.retido,
        situacaoResultado: ctx.resultado ? String(ctx.resultado['situacao']) : null,
        valores: e.valores,
        analitosDoExame: ctx.analitos,
        faixas,
      });
      if (falha) throw recusa(falha, MENSAGEM_RESULTADO[falha]);
      let id: number;
      if (ctx.resultado) {
        id = n(ctx.resultado['id']);
        await tx.alterar('resultado_exame', id, n(ctx.resultado['versao']), {
          situacao: 'digitado',
          digitado_por_usuario_id: tx.contexto.usuario,
          digitado_em: ctx.agora,
        });
      } else {
        id = await tx.incluir('resultado_exame', {
          exame_item_id: exame,
          paciente_id: ctx.paciente,
          setor_diagnostico_id: ctx.setor,
          forma_entrada: 'digitado',
          situacao: 'digitado',
          resultado_em: ctx.agora,
          digitado_por_usuario_id: tx.contexto.usuario,
          digitado_em: ctx.agora,
        });
      }
      const marcas = await this.gravarValores(tx, id, e.valores, faixas, ctx.analitos, null);
      await tx.alterar('resultado_exame', id, await this.versaoDe(tx, id), marcas);
      if (e.observacao) {
        const s = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM resultado_observacao WHERE resultado_exame_id = ?',
          [id],
        );
        await tx.incluir('resultado_observacao', {
          resultado_exame_id: id,
          sequencia: n(s?.['s'] ?? 1),
          texto: e.observacao,
        });
      }
      await tx.alterar('exame_item', exame, ctx.versaoExame, { situacao: 'resultado_digitado' });
      return id;
    });
  }

  async liberar(c: ContextoSadt, exame: number, entrada: unknown): Promise<ResultadoGravado> {
    esquemaLiberarResultadoBanco.parse(entrada ?? {});
    return this.gravar(c, 'sadt.resultado.liberar', exame, null, async (tx, ctx) => {
      const prof = await this.habilitado(tx, ctx.tipoSetor);
      const falha = conferirLiberacao({
        situacaoResultado: ctx.resultado ? String(ctx.resultado['situacao']) : null,
        retido: ctx.retido,
        habilitado: prof !== null,
      });
      if (falha) throw recusa(falha, MENSAGEM_RESULTADO[falha]);
      const id = n(ctx.resultado!['id']);
      await tx.alterar('resultado_exame', id, n(ctx.resultado!['versao']), {
        situacao: 'liberado',
        liberado_em: ctx.agora,
        liberado_por_profissional_id: prof,
      });
      await tx.alterar('exame_item', exame, ctx.versaoExame, {
        situacao: 'liberado',
        liberado_em: ctx.agora,
        liberado_por_usuario_id: tx.contexto.usuario,
      });
      return id;
    });
  }

  async retificar(c: ContextoSadt, exame: number, entrada: unknown): Promise<ResultadoGravado> {
    const e = esquemaRetificarResultadoBanco.parse(entrada);
    return this.gravar(c, 'sadt.resultado.retificar', exame, e.motivo, async (tx, ctx) => {
      const prof = await this.habilitado(tx, ctx.tipoSetor);
      const r = ctx.resultado;
      const id = r ? n(r['id']) : 0;
      const antes = r
        ? await tx.consultar(
            `SELECT id, versao, analito_id, sequencia, valor_numerico, valor_texto, faixa_referencia_id, referencia_minimo,
                    referencia_maximo, referencia_texto, critico_minimo, critico_maximo, interpretacao, anormal, critico
               FROM resultado_analito WHERE resultado_exame_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
            [id],
          )
        : [];
      const porAnalito = new Map(antes.map((a) => [n(a['analito_id']), a]));
      const mudou = e.valores.some((v) => {
        const a = porAnalito.get(v.analito);
        return !a || num(a['valor_numerico']) !== v.numero || (a['valor_texto'] ?? null) !== v.texto;
      });
      const falha = conferirRetificacao({
        situacaoResultado: r ? String(r['situacao']) : null,
        motivo: e.motivo,
        habilitado: prof !== null,
        mudou,
      });
      if (falha) throw recusa(falha, MENSAGEM_RESULTADO[falha]);
      const faixas = await this.faixas(tx, ctx.exameId, ctx.paciente, ctx.agora);
      const fora = conferirDigitacao({
        situacaoExame: 'em_analise',
        retido: false,
        situacaoResultado: null,
        valores: e.valores,
        analitosDoExame: ctx.analitos,
        faixas,
      });
      if (fora) throw recusa(fora, MENSAGEM_RESULTADO[fora]);
      const versaoAnterior = n(r!['numero_versao']);
      await tx.incluir('resultado_exame_versao', {
        resultado_exame_id: id,
        operacao: 'alteracao',
        numero_versao: versaoAnterior,
        dados: JSON.stringify({
          situacao: r!['situacao'],
          liberadoPor: num(r!['liberado_por_profissional_id']),
          anormal: Boolean(n(r!['anormal'])),
          critico: Boolean(n(r!['critico'])),
          analitos: antes.map((a) => ({
            analito: n(a['analito_id']),
            numero: num(a['valor_numerico']),
            texto: a['valor_texto'] ?? null,
            faixa: num(a['faixa_referencia_id']),
            referenciaMinimo: num(a['referencia_minimo']),
            referenciaMaximo: num(a['referencia_maximo']),
            interpretacao: a['interpretacao'] ?? null,
          })),
        }),
        motivo: e.motivo,
        liberado_em_original: r!['liberado_em'],
        ocorrido_em: ctx.agora,
        usuario_id: tx.contexto.usuario,
      });
      const marcas = await this.gravarValores(tx, id, e.valores, faixas, ctx.analitos, e.motivo);
      await tx.alterar('resultado_exame', id, n(r!['versao']), {
        ...marcas,
        situacao: 'retificado',
        numero_versao: versaoAnterior + 1,
        liberado_em: ctx.agora,
        liberado_por_profissional_id: prof,
      });
      return id;
    });
  }

  /** A faixa vigente de cada analito do exame para o paciente (sexo e idade), a mais específica primeiro. */
  private async faixas(tx: Tx, exameId: number, paciente: number, agora: Date) {
    const linhas = await tx.consultar(
      `SELECT ea.analito_id, f.id, f.referencia_minima, f.referencia_maxima, f.critico_minimo, f.critico_maximo,
              f.absurdo_minimo, f.absurdo_maximo, f.referencia_texto
         FROM exame_analito ea
         JOIN faixa_referencia f ON f.exame_analito_id = ea.id AND f.ativo = TRUE AND f.condicao = 'nenhuma'
                                AND f.vigencia_inicio <= ? AND (f.vigencia_fim IS NULL OR f.vigencia_fim >= ?)
         JOIN paciente p ON p.id = ?
         JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
        WHERE ea.exame_id = ? AND ea.excluido_em IS NULL
          AND (f.sexo_id IS NULL OR f.sexo_id = pf.sexo_id)
          AND (pf.data_nascimento IS NULL OR (
               (f.idade_minima_dias IS NULL OR DATEDIFF(?, pf.data_nascimento) >= f.idade_minima_dias)
           AND (f.idade_maxima_dias IS NULL OR DATEDIFF(?, pf.data_nascimento) <= f.idade_maxima_dias)))
        ORDER BY ea.analito_id, (f.sexo_id IS NULL), (f.idade_minima_dias IS NULL AND f.idade_maxima_dias IS NULL), f.id`,
      [agora, agora, paciente, exameId, agora, agora],
    );
    const m = new Map<number, FaixaDoAnalito>();
    for (const l of linhas) {
      const a = n(l['analito_id']);
      if (m.has(a)) continue;
      m.set(a, {
        faixa: n(l['id']),
        minimo: num(l['referencia_minima']),
        maximo: num(l['referencia_maxima']),
        criticoMinimo: num(l['critico_minimo']),
        criticoMaximo: num(l['critico_maximo']),
        absurdoMinimo: num(l['absurdo_minimo']),
        absurdoMaximo: num(l['absurdo_maximo']),
        texto: (l['referencia_texto'] as string | null) ?? null,
      });
    }
    return m;
  }

  /** Grava (ou corrige) o valor de cada analito com a faixa congelada; devolve as marcas do resultado. */
  private async gravarValores(
    tx: Tx,
    resultado: number,
    valores: readonly ValorDigitado[],
    faixas: ReadonlyMap<number, FaixaDoAnalito>,
    ordem: readonly number[],
    justificativa: string | null,
  ): Promise<{ anormal: boolean; critico: boolean }> {
    let anormal = false;
    let critico = false;
    for (const v of valores) {
      const f = faixas.get(v.analito) ?? null;
      const av = avaliarValor(v.numero, f);
      anormal ||= av.anormal;
      critico ||= av.critico;
      const campos = {
        valor_numerico: v.numero,
        valor_texto: v.texto,
        faixa_referencia_id: f?.faixa ?? null,
        referencia_minimo: f?.minimo ?? null,
        referencia_maximo: f?.maximo ?? null,
        referencia_texto: f?.texto ?? null,
        critico_minimo: f?.criticoMinimo ?? null,
        critico_maximo: f?.criticoMaximo ?? null,
        interpretacao: av.interpretacao,
        anormal: av.anormal,
        critico: av.critico,
      };
      const [ja] = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM resultado_analito WHERE resultado_exame_id = ? AND analito_id = ? AND excluido_em IS NULL',
        [resultado, v.analito],
      );
      if (ja)
        await tx.alterar('resultado_analito', n(ja['id']), n(ja['versao']), {
          ...campos,
          justificativa_alteracao: justificativa ? justificativa.slice(0, 500) : null,
        });
      else
        await tx.incluir('resultado_analito', {
          resultado_exame_id: resultado,
          sequencia: ordem.indexOf(v.analito) + 1,
          analito_id: v.analito,
          ...campos,
        });
    }
    // As marcas do resultado contam os analitos que não vieram nesta gravação (continuam como estavam).
    const resto = await tx.uma(
      `SELECT COALESCE(MAX(anormal), 0) AS a, COALESCE(MAX(critico), 0) AS c FROM resultado_analito
        WHERE resultado_exame_id = ? AND excluido_em IS NULL`,
      [resultado],
    );
    return { anormal: anormal || n(resto?.['a']) === 1, critico: critico || n(resto?.['c']) === 1 };
  }

  private async versaoDe(tx: Tx, id: number): Promise<number> {
    return n((await tx.uma('SELECT versao FROM resultado_exame WHERE id = ?', [id]))?.['versao']);
  }

  /** O profissional da sessão habilitado para liberar no setor (pelo vínculo com o conselho ativo e o CBO). */
  private async habilitado(tx: Tx, tipoSetor: string): Promise<number | null> {
    const vs = await tx.consultar(
      `SELECT pr.id, COALESCE(oc.codigo_cbo, '') AS cbo
         FROM usuario_vinculo_profissional uvp
         JOIN profissional pr ON pr.id = uvp.profissional_id AND pr.excluido_em IS NULL AND pr.situacao = 'ativo'
         JOIN inscricao_conselho ic ON ic.profissional_id = pr.id AND ic.excluido_em IS NULL AND ic.situacao = 'ativa'
         LEFT JOIN ocupacao_cbo oc ON oc.id = ic.ocupacao_cbo_id
        WHERE uvp.usuario_id = ? AND uvp.estabelecimento_id = ? AND uvp.excluido_em IS NULL
          AND uvp.vigencia_inicio <= CURRENT_DATE AND (uvp.vigencia_fim IS NULL OR uvp.vigencia_fim >= CURRENT_DATE)
        ORDER BY ic.principal DESC, ic.id`,
      [tx.contexto.usuario, tx.contexto.estabelecimento],
    );
    const medico = liberacaoPrivativaDeMedico(tipoSetor);
    const v = vs.find((x) =>
      medico
        ? ehMedico(String(x['cbo']))
        : ehResponsavelLaboratorio(String(x['cbo'])) || ehMedico(String(x['cbo'])),
    );
    return v ? n(v['id']) : null;
  }

  private async gravar(
    c: ContextoSadt,
    nome: string,
    exame: number,
    motivo: string | null,
    aplicar: (
      tx: Tx,
      ctx: {
        agora: Date;
        situacaoExame: string;
        versaoExame: number;
        exameId: number;
        paciente: number;
        setor: number;
        tipoSetor: string;
        retido: boolean;
        analitos: number[];
        resultado: Record<string, unknown> | undefined;
      },
    ) => Promise<number>,
  ): Promise<ResultadoGravado> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let id = 0;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        const [ei] = await tx.consultarParaAtualizar(
          `SELECT ei.id, ei.versao, ei.situacao, ei.exame_id, r.paciente_id, sd.id AS setor, sd.tipo
             FROM exame_item ei
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.excluido_em IS NULL
             JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id)
            WHERE ei.id = ? AND r.estabelecimento_id = ? AND ei.excluido_em IS NULL`,
          [exame, est],
        );
        if (!ei) throw recusa('exame-inexistente', 'O exame não existe neste estabelecimento.');
        const [resultado] = await tx.consultarParaAtualizar(
          'SELECT * FROM resultado_exame WHERE exame_item_id = ? AND excluido_em IS NULL',
          [exame],
        );
        const retido = await tx.uma(
          `SELECT COUNT(*) AS q FROM grupo_trabalho_bancada_item gi
             JOIN grupo_trabalho_bancada g ON g.id = gi.grupo_trabalho_bancada_id AND g.excluido_em IS NULL
            WHERE gi.exame_item_id = ? AND gi.situacao = 'retido' AND gi.excluido_em IS NULL`,
          [exame],
        );
        const analitos = (
          await tx.consultar(
            `SELECT analito_id FROM exame_analito WHERE exame_id = ? AND excluido_em IS NULL AND titulo = FALSE
              ORDER BY ordem, id`,
            [ei['exame_id']],
          )
        ).map((a) => n(a['analito_id']));
        id = await aplicar(tx, {
          agora: new Date(),
          situacaoExame: String(ei['situacao']),
          versaoExame: n(ei['versao']),
          exameId: n(ei['exame_id']),
          paciente: n(ei['paciente_id']),
          setor: n(ei['setor']),
          tipoSetor: String(ei['tipo']),
          retido: n(retido?.['q']) > 0,
          analitos,
          resultado,
        });
        return { id };
      },
      alvo: () => ({ tabela: 'resultado_exame', id: id || null }),
      trilha: () => ({ dados: { evento: nome, exame }, motivo }),
    });
    const chave = `sadt:${c.chaveIdempotencia ?? randomUUID()}`;
    await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    return this.nucleo.lerSomente(this.ctxNucleo(c), (l) => this.ler(l, exame));
  }

  private async ler(l: Leitor, exame: number): Promise<ResultadoGravado> {
    const r = await l.uma(
      'SELECT id, situacao, numero_versao, critico, anormal FROM resultado_exame WHERE exame_item_id = ? AND excluido_em IS NULL',
      [exame],
    );
    return {
      resultado: n(r?.['id'] ?? 0),
      exame,
      situacao: String(r?.['situacao'] ?? ''),
      numeroVersao: n(r?.['numero_versao'] ?? 0),
      critico: n(r?.['critico']) === 1,
      anormal: n(r?.['anormal']) === 1,
    };
  }
}
