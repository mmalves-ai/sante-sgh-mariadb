// Microbiologia estruturada no banco do cliente (F7, 05-SADT linha 12): a cultura do resultado do exame com os
// isolados e o antibiograma por painel, interpretado pelo ponto de corte vigente; o laudo da cultura; a ligação do
// isolado ao caso de infecção da comissão de controle de infecção hospitalar (CCIH). A regra mora em
// @sgh/dominio-sadt (microbiologia/antibiograma.ts); aqui fica a leitura do cadastro e a gravação do que a regra decide.
// Nada se apaga: o isolado ou o teste que sai da cultura recebe exclusão lógica (volta se for informado de novo), a
// cultura final só muda por retificação com motivo, e a retificação guarda antes a cultura inteira que vigorava (com o
// laudo emitido) em resultado_cultura_versao, consultável. Toda gravação depois da primeira exige a versão lida
// (conflito de edição). O isolado da cultura final que a regra manda notificar entra na fila de busca ativa da CCIH
// (sinal_vigilancia_iras, uma vez por isolado). Cada gravação vai à trilha na mesma transação (Executor).
import {
  conferirCultura,
  type Crescimento,
  exibidosNoLaudo,
  interpretarAntibiograma,
  type ItemPainel,
  laudoDaCultura,
  multirresistente,
  notificaControleInfeccao,
  type PontoCorte,
  RecusaMicrobiologia,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FUSO_PADRAO, relogioNoFuso } from '../../exames/relogio.js';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const tx_ = (v: unknown) => (v === null || v === undefined ? null : String(v));
const sim = (v: unknown) => Boolean(Number(v ?? 0));
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');

export const TABELAS_MICROBIOLOGIA = [
  'resultado_exame',
  'resultado_cultura',
  'isolado_microbiano',
  'resultado_sensibilidade',
  'caso_infeccao_microrganismo',
  'resultado_cultura_versao',
  'sinal_vigilancia_iras',
] as const;

const id = z.number().int().positive();
const interpretacao = z.enum([
  'sensivel',
  'sensivel_dose_dependente',
  'intermediario',
  'resistente',
  'nao_testado',
]);

export const esquemaTeste = z.object({
  antimicrobiano: id,
  metodo: z.enum(['cim', 'disco_difusao', 'gradiente', 'automatizado']).default('cim'),
  cim: z.number().min(0).max(1_000_000).nullable().default(null),
  halo: z.number().min(0).max(999).nullable().default(null),
  valorTexto: z.string().trim().max(20).nullable().default(null),
  interpretacao: interpretacao.nullable().default(null),
  observacao: z.string().trim().max(500).nullable().default(null),
});

export const esquemaIsolado = z.object({
  sequencia: z.number().int().min(1).max(99),
  microrganismo: id,
  painel: id.nullable().default(null),
  contagemUfcMl: z.number().min(0).nullable().default(null),
  descricaoColonia: z.string().trim().max(150).nullable().default(null),
  betalactamaseEspectroEstendido: z.boolean().default(false),
  carbapenemase: z.boolean().default(false),
  resistenteMeticilina: z.boolean().default(false),
  resistenteVancomicina: z.boolean().default(false),
  contaminanteProvavel: z.boolean().default(false),
  observacao: z.string().trim().max(2000).nullable().default(null),
  testes: z.array(esquemaTeste).max(80).default([]),
});

export const esquemaCultura = z.object({
  material: id,
  crescimento: z.enum(['em_andamento', 'sem_crescimento', 'com_crescimento', 'contaminada', 'flora_normal']),
  contagemColonias: z.string().trim().max(50).nullable().default(null),
  conclusao: z.string().trim().max(4000).nullable().default(null),
  observacao: z.string().trim().max(4000).nullable().default(null),
  notificaControleInfeccao: z.boolean().default(false),
  final: z.boolean().default(false),
  /** Obrigatório para mudar a cultura já final (retificação). */
  motivoRetificacao: z.string().trim().min(5).max(500).nullable().default(null),
  /** Versão lida da cultura (conflito de edição): nula só na primeira gravação; depois, obrigatória. */
  versao: z.number().int().min(1).nullable().default(null),
  isolados: z.array(esquemaIsolado).max(10).default([]),
});

export const esquemaLigacaoCaso = z.object({ caso: id });

const daRegra = <T>(f: () => T): T => {
  try {
    return f();
  } catch (e) {
    if (e instanceof RecusaMicrobiologia) throw recusa(e.codigo, e.message);
    throw e;
  }
};

const pontoDe = (r: Linha): PontoCorte => ({
  id: n(r['id']),
  microrganismo: n(r['microrganismo_id']),
  antimicrobiano: n(r['antimicrobiano_id']),
  material: nn(r['material_biologico_id']),
  metodo: String(r['metodo']) as PontoCorte['metodo'],
  norma: String(r['norma'] ?? ''),
  sensivelAte: nn(r['sensivel_ate']),
  resistenteAcima: nn(r['resistente_acima']),
  haloSensivelMinimo: nn(r['halo_sensivel_minimo_mm']),
  haloResistenteMaximo: nn(r['halo_resistente_maximo_mm']),
  vigenciaInicio: dataIso(r['vigencia_inicio']),
  vigenciaFim: r['vigencia_fim'] ? dataIso(r['vigencia_fim']) : null,
  ativo: sim(r['ativo']),
});

const itemDe = (r: Linha): ItemPainel & { sequencia: number } => ({
  antimicrobiano: n(r['antimicrobiano_id']),
  exibeNoLaudo: sim(r['exibe_no_laudo']),
  liberacaoRestrita: sim(r['liberacao_restrita']),
  indicaMultirresistencia: sim(r['indica_multirresistencia']),
  sequencia: n(r['sequencia']),
});

export class ServicoMicrobiologia {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ctxNucleo(c: ContextoSadt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'sadt-micro').slice(0, 64),
    };
  }

  private est(c: ContextoSadt): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private async gravar<T extends Record<string, unknown>>(
    c: ContextoSadt,
    nome: string,
    tabela: string,
    motivo: string | null,
    fn: (tx: TxOperacao, est: number) => Promise<T & { id: number }>,
    dadosTrilha: (feito: T & { id: number }) => Record<string, unknown> = () => ({}),
  ): Promise<T & { id: number }> {
    const est = this.est(c);
    let feito: (T & { id: number }) | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS_MICROBIOLOGIA,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        feito = await fn(tx, est);
        return { id: feito.id };
      },
      alvo: () => ({ tabela, id: feito?.id ?? null }),
      trilha: () => ({ dados: { evento: nome, ...(feito ? dadosTrilha(feito) : {}) }, motivo }),
    });
    const chave = `sadt-micro:${c.chaveIdempotencia ?? randomUUID()}`;
    await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    return feito!;
  }

  /** O cadastro que a tela usa: materiais, microrganismos (com o painel padrão), antimicrobianos e painéis com itens. */
  cadastro(c: ContextoSadt) {
    this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const op = (rs: Linha[]) => rs.map((r) => ({ id: n(r['id']), nome: String(r['descricao'] ?? '') }));
      const materiais = op(
        await l.consultar(
          'SELECT id, descricao FROM material_biologico WHERE ativo = TRUE ORDER BY descricao LIMIT 2000',
          [],
        ),
      );
      const microrganismos = (
        await l.consultar(
          'SELECT id, descricao, painel_antibiograma_id FROM microrganismo WHERE ativo = TRUE ORDER BY descricao LIMIT 5000',
          [],
        )
      ).map((r) => ({
        id: n(r['id']),
        nome: String(r['descricao'] ?? ''),
        painel: nn(r['painel_antibiograma_id']),
      }));
      const antimicrobianos = op(
        await l.consultar(
          'SELECT id, descricao FROM antimicrobiano WHERE ativo = TRUE ORDER BY descricao LIMIT 2000',
          [],
        ),
      );
      const ps = await l.consultar(
        'SELECT id, codigo, descricao, microrganismo_id, material_biologico_id, metodo, norma_referencia, versao FROM painel_antibiograma WHERE ativo = TRUE ORDER BY descricao LIMIT 500',
        [],
      );
      const its = ps.length
        ? await l.consultar(
            `SELECT * FROM painel_antibiograma_item WHERE excluido_em IS NULL AND painel_antibiograma_id IN (${marcas(ps.length)}) ORDER BY sequencia`,
            ps.map((p) => p['id']),
          )
        : [];
      const paineis = ps.map((p) => ({
        id: n(p['id']),
        codigo: String(p['codigo'] ?? ''),
        versao: n(p['versao']),
        nome: String(p['descricao'] ?? ''),
        microrganismo: nn(p['microrganismo_id']),
        material: nn(p['material_biologico_id']),
        metodo: String(p['metodo']),
        norma: String(p['norma_referencia']),
        itens: its.filter((i) => n(i['painel_antibiograma_id']) === n(p['id'])).map(itemDe),
      }));
      return { materiais, microrganismos, antimicrobianos, paineis };
    });
  }

  /** O resultado do exame no estabelecimento, com o paciente; recusa o de outro estabelecimento. */
  private async resultadoDoEstabelecimento(l: Leitor, resultado: number, est: number) {
    const r = await l.uma(
      `SELECT re.id, re.paciente_id, rq.atendimento_id FROM resultado_exame re
         JOIN exame_item ei ON ei.id = re.exame_item_id
         JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id
        WHERE re.id = ? AND rq.estabelecimento_id = ? AND re.excluido_em IS NULL`,
      [resultado, est],
    );
    if (!r) throw recusa('nao-encontrado', 'O resultado do exame não existe neste estabelecimento.');
    return { paciente: n(r['paciente_id']), atendimento: n(r['atendimento_id']) };
  }

  /** A cultura pelo exame pedido (a tela da digitação): o resultado, quando já existe, e a cultura dele. */
  culturaDoExame(c: ContextoSadt, exameItem: number) {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const ei = await l.uma(
        `SELECT ei.id FROM exame_item ei JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id
          WHERE ei.id = ? AND rq.estabelecimento_id = ? AND ei.excluido_em IS NULL`,
        [exameItem, est],
      );
      if (!ei) throw recusa('nao-encontrado', 'O exame não existe neste estabelecimento.');
      const re = await l.uma(
        'SELECT id FROM resultado_exame WHERE exame_item_id = ? AND excluido_em IS NULL',
        [exameItem],
      );
      return {
        resultado: re ? n(re['id']) : null,
        cultura: re ? await this.lerCultura(l, n(re['id'])) : null,
      };
    });
  }

  /** O resultado do exame pedido no estabelecimento; sem ele, nasce em digitação (o exame cancelado recusa). */
  private async resultadoDoExame(tx: TxOperacao, exameItem: number, est: number): Promise<number> {
    const [ei] = await tx.consultarParaAtualizar(
      `SELECT ei.id, ei.situacao, rq.paciente_id, COALESCE(ei.setor_diagnostico_id, rq.setor_diagnostico_id) AS setor
         FROM exame_item ei JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id AND rq.excluido_em IS NULL
        WHERE ei.id = ? AND rq.estabelecimento_id = ? AND ei.excluido_em IS NULL`,
      [exameItem, est],
    );
    if (!ei) throw recusa('nao-encontrado', 'O exame não existe neste estabelecimento.');
    if (['cancelado', 'recusado'].includes(String(ei['situacao'])))
      throw recusa('exame-cancelado', 'O exame foi cancelado ou recusado: não recebe cultura.');
    const re = await tx.uma(
      'SELECT id FROM resultado_exame WHERE exame_item_id = ? AND excluido_em IS NULL',
      [exameItem],
    );
    if (re) return n(re['id']);
    if (ei['setor'] === null) throw recusa('sem-setor', 'O exame não tem setor de execução.');
    const agora = new Date();
    return tx.incluir('resultado_exame', {
      exame_item_id: exameItem,
      paciente_id: n(ei['paciente_id']),
      setor_diagnostico_id: n(ei['setor']),
      forma_entrada: 'digitado',
      situacao: 'em_digitacao',
      resultado_em: agora,
      digitado_por_usuario_id: tx.contexto.usuario,
      digitado_em: agora,
    });
  }

  /** A cultura do resultado com isolados, antibiograma e o texto do laudo; nula quando ainda não foi digitada. */
  cultura(c: ContextoSadt, resultado: number) {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      await this.resultadoDoEstabelecimento(l, resultado, est);
      return this.lerCultura(l, resultado);
    });
  }

  /** As versões substituídas da cultura (retificações), da mais recente à mais antiga, com o laudo que vigorava. */
  versoes(c: ContextoSadt, resultado: number) {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      await this.resultadoDoEstabelecimento(l, resultado, est);
      const rs = await l.consultar(
        `SELECT v.* FROM resultado_cultura_versao v JOIN resultado_cultura rc ON rc.id = v.resultado_cultura_id
          WHERE rc.resultado_exame_id = ? ORDER BY v.versao_cultura DESC LIMIT 200`,
        [resultado],
      );
      return rs.map((r) => ({
        id: n(r['id']),
        versaoCultura: n(r['versao_cultura']),
        situacao: String(r['situacao']),
        motivo: String(r['motivo']),
        substituidaEm: r['substituida_em'],
        substituidaPor: nn(r['substituida_por']),
        conteudo: JSON.parse(String(r['conteudo'])) as unknown,
      }));
    });
  }

  /** A cultura do resultado com isolados, antibiograma e o texto do laudo; nula quando ainda não foi digitada. */
  private async lerCultura(l: Leitor, resultado: number) {
    const rc = await l.uma(
      `SELECT rc.*, mb.descricao AS material_nome FROM resultado_cultura rc
           JOIN material_biologico mb ON mb.id = rc.material_biologico_id
          WHERE rc.resultado_exame_id = ? AND rc.excluido_em IS NULL`,
      [resultado],
    );
    if (!rc) return null;
    const isos = await l.consultar(
      `SELECT im.*, mo.descricao AS microrganismo_nome FROM isolado_microbiano im
           JOIN microrganismo mo ON mo.id = im.microrganismo_id
          WHERE im.resultado_cultura_id = ? AND im.excluido_em IS NULL ORDER BY im.sequencia`,
      [rc['id']],
    );
    const ts = isos.length
      ? await l.consultar(
          `SELECT rs.*, am.descricao AS antimicrobiano_nome FROM resultado_sensibilidade rs
               JOIN antimicrobiano am ON am.id = rs.antimicrobiano_id
              WHERE rs.excluido_em IS NULL AND rs.isolado_microbiano_id IN (${marcas(isos.length)}) ORDER BY rs.sequencia`,
          isos.map((i) => i['id']),
        )
      : [];
    const isolados = isos.map((i) => ({
      id: n(i['id']),
      sequencia: n(i['sequencia']),
      microrganismo: n(i['microrganismo_id']),
      microrganismoNome: String(i['microrganismo_nome'] ?? ''),
      contagemUfcMl: nn(i['contagem_ufc_ml']),
      multirresistente: sim(i['multirresistente']),
      betalactamaseEspectroEstendido: sim(i['produtor_betalactamase_espectro_estendido']),
      carbapenemase: sim(i['produtor_carbapenemase']),
      resistenteMeticilina: sim(i['resistente_meticilina']),
      resistenteVancomicina: sim(i['resistente_vancomicina']),
      contaminanteProvavel: sim(i['contaminante_provavel']),
      notificadoControleInfeccao: i['notificado_controle_infeccao_em'] !== null,
      testes: ts
        .filter((t) => n(t['isolado_microbiano_id']) === n(i['id']))
        .map((t) => ({
          antimicrobiano: n(t['antimicrobiano_id']),
          antimicrobianoNome: String(t['antimicrobiano_nome'] ?? ''),
          metodo: tx_(t['metodo']),
          cim: nn(t['concentracao_inibitoria_minima']),
          halo: nn(t['halo_mm']),
          valorTexto: tx_(t['valor_medido_texto']),
          interpretacao: String(t['interpretacao']) as z.infer<typeof interpretacao>,
          pontoCorte: nn(t['ponto_corte_antimicrobiano_id']),
          exibeNoLaudo: sim(t['exibe_no_laudo']),
        })),
    }));
    const base = {
      id: n(rc['id']),
      versao: n(rc['versao']),
      material: n(rc['material_biologico_id']),
      materialNome: String(rc['material_nome'] ?? ''),
      crescimento: String(rc['crescimento']) as Crescimento,
      contagemColonias: tx_(rc['contagem_colonias']),
      conclusao: tx_(rc['conclusao']),
      observacao: tx_(rc['observacao']),
      notificaControleInfeccao: sim(rc['notifica_controle_infeccao']),
      situacao: String(rc['situacao']),
      isolados,
    };
    const laudo = laudoDaCultura({
      material: base.materialNome,
      crescimento: base.crescimento,
      contagemColonias: base.contagemColonias,
      conclusao: base.conclusao,
      situacao: base.situacao,
      isolados: isolados.map((i) => ({
        sequencia: i.sequencia,
        microrganismo: i.microrganismoNome,
        contagem: i.contagemUfcMl === null ? null : `${i.contagemUfcMl} UFC/mL`,
        multirresistente: i.multirresistente,
        testes: i.testes.map((t) => ({
          antimicrobiano: t.antimicrobianoNome,
          medida:
            t.valorTexto ?? (t.cim !== null ? `CIM ${t.cim}` : t.halo !== null ? `halo ${t.halo} mm` : null),
          interpretacao: t.interpretacao,
          exibeNoLaudo: t.exibeNoLaudo,
        })),
      })),
    });
    return { ...base, laudo };
  }

  /** Grava a cultura inteira do resultado (cabeçalho, isolados e antibiograma) numa transação. */
  async registrar(
    c: ContextoSadt,
    alvo: number | { readonly exameItem: number },
    entrada: unknown,
    o: { readonly retificacao: boolean } = { retificacao: false },
  ) {
    const e = esquemaCultura.parse(entrada);
    daRegra(() =>
      conferirCultura({
        crescimento: e.crescimento,
        isolados: e.isolados.length,
        final: e.final,
        conclusao: e.conclusao,
        sequencias: e.isolados.map((i) => i.sequencia),
      }),
    );
    const usuario = c.usuario;
    return this.gravar(
      c,
      'sadt.microbiologia.cultura.registrada',
      'resultado_cultura',
      e.motivoRetificacao,
      async (tx, est) => {
        // Pela digitação, a cultura chega pelo exame pedido: o resultado ainda não digitado nasce aqui, em digitação.
        const resultado =
          typeof alvo === 'number' ? alvo : await this.resultadoDoExame(tx, alvo.exameItem, est);
        const doResultado = await this.resultadoDoEstabelecimento(tx, resultado, est);
        const f = await tx.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
        const hoje = relogioNoFuso(String(f?.['fuso_horario'] ?? '') || FUSO_PADRAO).hoje;
        const agora = new Date();
        const mat = await tx.uma('SELECT id FROM material_biologico WHERE id = ?', [e.material]);
        if (!mat) throw recusa('material-inexistente', 'O material biológico não existe.');
        const atual = await tx.uma(
          'SELECT id, versao, situacao FROM resultado_cultura WHERE resultado_exame_id = ?',
          [resultado],
        );
        const jaFinal = atual && ['final', 'retificado'].includes(String(atual['situacao']));
        if (jaFinal && (!o.retificacao || !e.motivoRetificacao))
          throw recusa('cultura-final', 'A cultura já é final: só a retificação, com motivo, a altera.');
        if (atual && (e.versao === null || e.versao !== n(atual['versao'])))
          throw recusa(
            'conflito-versao',
            e.versao === null
              ? 'Informe a versão lida da cultura para gravar por cima dela.'
              : 'A cultura mudou desde a leitura; abra de novo.',
          );
        // Retificação: a cultura que vigorava (com o laudo emitido) fica guardada inteira antes da mudança.
        const versaoSubstituida = jaFinal
          ? await tx.incluir('resultado_cultura_versao', {
              resultado_cultura_id: n(atual['id']),
              versao_cultura: n(atual['versao']),
              situacao: String(atual['situacao']),
              conteudo: JSON.stringify(await this.lerCultura(tx, resultado)),
              motivo: e.motivoRetificacao,
              substituida_em: agora,
              substituida_por: usuario,
            })
          : null;
        const situacao = jaFinal ? 'retificado' : e.final ? 'final' : 'parcial';
        const cab = {
          material_biologico_id: e.material,
          crescimento: e.crescimento,
          contagem_colonias: e.contagemColonias,
          conclusao: e.conclusao,
          observacao: e.observacao,
          notifica_controle_infeccao: e.notificaControleInfeccao,
          situacao,
          leitura_final_em: situacao === 'parcial' ? null : agora,
        };
        const cultura = atual
          ? (await tx.alterar('resultado_cultura', n(atual['id']), n(atual['versao']), cab), n(atual['id']))
          : await tx.incluir('resultado_cultura', {
              resultado_exame_id: resultado,
              ...cab,
              incubacao_inicio_em: null,
            });

        // Cadastro que a regra usa: painéis dos isolados e pontos de corte dos pares germe × antimicrobiano.
        const germes = [...new Set(e.isolados.map((i) => i.microrganismo))];
        const moRows = germes.length
          ? await tx.consultar(
              `SELECT id, painel_antibiograma_id FROM microrganismo WHERE id IN (${marcas(germes.length)})`,
              germes,
            )
          : [];
        if (moRows.length !== germes.length)
          throw recusa('microrganismo-inexistente', 'Microrganismo não cadastrado.');
        const pontos = germes.length
          ? (
              await tx.consultar(
                `SELECT * FROM ponto_corte_antimicrobiano WHERE microrganismo_id IN (${marcas(germes.length)})`,
                germes,
              )
            ).map(pontoDe)
          : [];
        const painelPadrao = new Map(moRows.map((r) => [n(r['id']), nn(r['painel_antibiograma_id'])]));

        const isoAntigos = await tx.consultar(
          'SELECT * FROM isolado_microbiano WHERE resultado_cultura_id = ?',
          [cultura],
        );
        const porSeq = new Map(isoAntigos.map((r) => [n(r['sequencia']), r]));
        let testesGravados = 0;
        let multirresistentes = 0;
        let notificados = 0;
        for (const i of e.isolados) {
          const painelId = i.painel ?? painelPadrao.get(i.microrganismo) ?? null;
          const cabPainel = painelId
            ? await tx.uma('SELECT id, norma_referencia FROM painel_antibiograma WHERE id = ?', [painelId])
            : null;
          if (painelId && !cabPainel)
            throw recusa('painel-inexistente', 'O painel de antibiograma não existe.');
          const painel = painelId
            ? (
                await tx.consultar(
                  'SELECT * FROM painel_antibiograma_item WHERE painel_antibiograma_id = ? AND excluido_em IS NULL',
                  [painelId],
                )
              ).map(itemDe)
            : [];
          const testes = daRegra(() =>
            interpretarAntibiograma(i.testes, pontos, {
              microrganismo: i.microrganismo,
              material: e.material,
              data: hoje,
              norma: cabPainel ? String(cabPainel['norma_referencia']) : null,
            }),
          );
          const mr = multirresistente(testes, painel, i);
          if (mr) multirresistentes++;
          const exibidos = exibidosNoLaudo(testes, painel);
          const notificar = notificaControleInfeccao({
            culturaFinal: situacao !== 'parcial',
            multirresistente: mr,
            marcadoManual: e.notificaControleInfeccao,
            contaminanteProvavel: i.contaminanteProvavel,
          });
          const antigo = porSeq.get(i.sequencia);
          porSeq.delete(i.sequencia);
          const valores = {
            microrganismo_id: i.microrganismo,
            contagem_ufc_ml: i.contagemUfcMl,
            descricao_colonia: i.descricaoColonia,
            multirresistente: mr,
            produtor_betalactamase_espectro_estendido: i.betalactamaseEspectroEstendido,
            produtor_carbapenemase: i.carbapenemase,
            resistente_meticilina: i.resistenteMeticilina,
            resistente_vancomicina: i.resistenteVancomicina,
            contaminante_provavel: i.contaminanteProvavel,
            observacao: i.observacao,
            notificado_controle_infeccao_em: notificar
              ? (antigo?.['notificado_controle_infeccao_em'] ?? agora)
              : (antigo?.['notificado_controle_infeccao_em'] ?? null),
            excluido_em: null,
            excluido_por: null,
          };
          const isolado = antigo
            ? (await tx.alterar('isolado_microbiano', n(antigo['id']), n(antigo['versao']), valores),
              n(antigo['id']))
            : await tx.incluir('isolado_microbiano', {
                resultado_cultura_id: cultura,
                sequencia: i.sequencia,
                ...valores,
              });
          if (notificar) {
            // Fila de busca ativa da CCIH: um sinal por isolado (a chave única do fato garante); quem decide é a CCIH.
            const ja = await tx.uma(
              `SELECT id FROM sinal_vigilancia_iras
                WHERE tipo_sinal = 'cultura_positiva' AND fato_entidade = 'isolado_microbiano' AND fato_id = ?`,
              [isolado],
            );
            if (!ja) {
              await tx.incluir('sinal_vigilancia_iras', {
                estabelecimento_id: est,
                paciente_id: doResultado.paciente,
                atendimento_id: doResultado.atendimento,
                tipo_sinal: 'cultura_positiva',
                detectado_em: agora,
                fato_entidade: 'isolado_microbiano',
                fato_id: isolado,
                resultado_exame_id: resultado,
                descricao: mr
                  ? `Cultura final com isolado ${i.sequencia} multirresistente: avaliar precaução de contato e caso de infecção.`
                  : `Cultura final com isolado ${i.sequencia} marcado para o controle de infecção.`,
                situacao: 'pendente',
              });
              notificados++;
            }
          }
          const tAntigos = await tx.consultar(
            'SELECT * FROM resultado_sensibilidade WHERE isolado_microbiano_id = ?',
            [isolado],
          );
          const porAm = new Map(tAntigos.map((r) => [n(r['antimicrobiano_id']), r]));
          // Ordem do teste: a do painel; fora dele, depois.
          const ordem = new Map(painel.map((p) => [p.antimicrobiano, p.sequencia]));
          const ordenados = testes
            .map((t, k) => ({ t, k, o: ordem.get(t.antimicrobiano) ?? 1000 + k }))
            .sort((a, b) => a.o - b.o);
          // As sequências livres: as antigas saem de cena primeiro (evita colisão na chave única de ordem).
          let seq = Math.max(0, ...tAntigos.map((r) => n(r['sequencia']))) + 1;
          for (const { t } of ordenados) {
            const original = i.testes.find((x) => x.antimicrobiano === t.antimicrobiano)!;
            const v = {
              ponto_corte_antimicrobiano_id: t.ponto,
              metodo: t.metodo,
              valor_medido_texto: original.valorTexto,
              concentracao_inibitoria_minima: t.cim,
              halo_mm: t.halo,
              interpretacao: t.interpretacao,
              exibe_no_laudo: exibidos.has(t.antimicrobiano),
              observacao: original.observacao,
              excluido_em: null,
              excluido_por: null,
            };
            const a = porAm.get(t.antimicrobiano);
            porAm.delete(t.antimicrobiano);
            if (a) await tx.alterar('resultado_sensibilidade', n(a['id']), n(a['versao']), v);
            else
              await tx.incluir('resultado_sensibilidade', {
                isolado_microbiano_id: isolado,
                sequencia: seq++,
                antimicrobiano_id: t.antimicrobiano,
                ...v,
              });
            testesGravados++;
          }
          for (const a of porAm.values())
            if (a['excluido_em'] === null)
              await tx.alterar('resultado_sensibilidade', n(a['id']), n(a['versao']), {
                excluido_em: agora,
                excluido_por: usuario,
              });
        }
        for (const r of porSeq.values())
          if (r['excluido_em'] === null)
            await tx.alterar('isolado_microbiano', n(r['id']), n(r['versao']), {
              excluido_em: agora,
              excluido_por: usuario,
            });
        return {
          id: cultura,
          situacao,
          isolados: e.isolados.length,
          testes: testesGravados,
          multirresistentes,
          notificados,
          versaoSubstituida,
        };
      },
      (r) => ({ situacao: r.situacao, versaoSubstituida: r.versaoSubstituida }),
    );
  }

  /** Liga o isolado da cultura final ao caso de infecção do mesmo paciente, no estabelecimento (CCIH). */
  async ligarAoCaso(c: ContextoSadt, isolado: number, entrada: unknown) {
    const e = esquemaLigacaoCaso.parse(entrada);
    return this.gravar(
      c,
      'sadt.microbiologia.isolado.ligado-caso',
      'caso_infeccao_microrganismo',
      null,
      async (tx, est) => {
        const i = await tx.uma(
          `SELECT im.id, im.microrganismo_id, im.multirresistente, im.resultado_cultura_id, rc.situacao, re.paciente_id,
                rq.estabelecimento_id, DATE(COALESCE(rc.leitura_final_em, rc.criado_em)) AS isolado_em
           FROM isolado_microbiano im
           JOIN resultado_cultura rc ON rc.id = im.resultado_cultura_id
           JOIN resultado_exame re ON re.id = rc.resultado_exame_id
           JOIN exame_item ei ON ei.id = re.exame_item_id
           JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id
          WHERE im.id = ? AND im.excluido_em IS NULL`,
          [isolado],
        );
        if (!i || n(i['estabelecimento_id']) !== est)
          throw recusa('nao-encontrado', 'O isolado não existe neste estabelecimento.');
        if (String(i['situacao']) === 'parcial')
          throw recusa('cultura-parcial', 'Só o isolado da cultura final vai ao caso de infecção.');
        const caso = await tx.uma(
          'SELECT id, paciente_id FROM caso_infeccao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.caso, est],
        );
        if (!caso) throw recusa('caso-inexistente', 'O caso de infecção não existe neste estabelecimento.');
        if (n(caso['paciente_id']) !== n(i['paciente_id']))
          throw recusa('outro-paciente', 'O caso de infecção é de outro paciente.');
        const ja = await tx.uma(
          `SELECT id FROM caso_infeccao_microrganismo WHERE caso_infeccao_id = ? AND microrganismo_id = ?
            AND resultado_cultura_id = ? AND excluido_em IS NULL`,
          [e.caso, i['microrganismo_id'], i['resultado_cultura_id']],
        );
        if (ja) throw recusa('ja-ligado', 'O microrganismo desta cultura já está no caso.');
        const novo = await tx.incluir('caso_infeccao_microrganismo', {
          caso_infeccao_id: e.caso,
          microrganismo_id: i['microrganismo_id'],
          resultado_cultura_id: i['resultado_cultura_id'],
          isolado_microbiano_id: isolado,
          isolado_em: dataIso(i['isolado_em']),
          multirresistente: sim(i['multirresistente']),
        });
        return { id: novo };
      },
    );
  }
}
