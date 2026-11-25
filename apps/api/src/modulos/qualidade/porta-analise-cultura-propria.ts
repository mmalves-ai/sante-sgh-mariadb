// Porta PRÓPRIA da análise da cultura positiva pela comissão de controle de infecção (F7, 09-AREA linha 68) sobre o
// MariaDB do cliente, pelo @sgh/nucleo. Lê as culturas com crescimento do estabelecimento (resultado_cultura,
// resultado_exame, exame_item, requisicao_exame, com os germes de isolado_microbiano e microrganismo) e as condutas do
// cadastro (conduta_analise_cultura). Grava, numa operação do Executor (gravacaoDireta: trilha, outbox e idempotência
// na mesma transação), a análise (analise_cultura_positiva) e a conduta do cadastro.
// Melhoria: a fila mostra só o que falta analisar (cultura ou germe sem análise ativa), por paciente; a regra
// (avaliarAnaliseCultura) decide na hora a precaução e as pendências; a correção trava a linha, confere a versão vista e
// guarda a versão anterior na trilha (nada é apagado); a análise é uma por germe (ou por cultura sem germe).
// Melhoria: as pendências (ficha de IRAS a abrir, precaução sem precaução ativa do paciente, laudo retificado depois da
// análise) são recalculadas a cada leitura (pendenciasDaAnalise): a cultura analisada segue na fila enquanto houver
// pendência. A retificação posterior do laudo é lida pela data de alteração da cultura contra a última revisão da
// análise; a correção feita depois dela grava laudo_retificado=TRUE, que nunca é desfeito.
import {
  avaliarAnaliseCultura,
  type ClassificacaoCultura,
  type CondutaCultura,
  type CulturaParaAnalise,
  type EntradaAnaliseCultura,
  laudoRetificadoDepois,
  MENSAGENS_ANALISE_CULTURA,
  type PendenciaAnaliseCultura,
  pendenciasDaAnalise,
} from '@sgh/dominio-qualidade';
import { type Executor, recusa, type TxOperacao } from '@sgh/nucleo';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import {
  exigirUsuario,
  instante,
  type L,
  lerNoEstabelecimento,
  type Linha,
  marcas,
  n,
  nn,
  type NucleoQualidade,
  relogioDoEstabelecimento,
  texto,
  textoN,
  verdadeiro,
} from './apoio-propria.js';

export const TABELAS_ANALISE_CULTURA = ['analise_cultura_positiva', 'conduta_analise_cultura'] as const;
const TETO = 500;

export interface GermeCultura {
  readonly id: number;
  readonly microrganismo: string;
  readonly multirresistente: boolean;
  readonly analisado: boolean;
}

export interface CulturaPositiva {
  readonly id: number;
  readonly paciente: number;
  readonly nome: string;
  readonly atendimento: number | null;
  readonly exame: string;
  readonly material: string;
  readonly resultadoEm: string;
  readonly situacao: CulturaParaAnalise['situacao'];
  readonly germes: readonly GermeCultura[];
  /** Ainda falta analisar a cultura (sem germe) ou algum germe dela. */
  readonly faltaAnalisar: boolean;
  /** As pendências das análises já gravadas desta cultura (sem repetição). */
  readonly pendencias: readonly PendenciaAnaliseCultura[];
  /** Falta analisar ou há pendência: a cultura fica na fila. */
  readonly pendente: boolean;
}

export interface CondutaCadastrada extends CondutaCultura {
  readonly codigo: string;
  readonly descricao: string;
}

export interface AnaliseCulturaRegistrada {
  readonly id: number;
  readonly cultura: number;
  readonly isolado: number | null;
  readonly paciente: number;
  readonly classificacao: ClassificacaoCultura;
  readonly conduta: number | null;
  readonly condutaDescricao: string | null;
  readonly precaucaoIndicada: boolean;
  readonly prescritorOrientado: boolean;
  /** Gravado na correção feita depois da retificação, ou o laudo mudou depois da última revisão. */
  readonly laudoRetificado: boolean;
  readonly casoInfeccao: number | null;
  readonly analisadaEm: string;
  readonly analista: string;
  readonly versao: number;
  readonly pendencias: readonly PendenciaAnaliseCultura[];
}

export interface NovaConduta {
  readonly codigo: string;
  readonly descricao: string;
  readonly classificacaoAplicavel: ClassificacaoCultura | null;
  readonly abreCaso: boolean;
  readonly indicaPrecaucao: boolean;
  readonly exigeResposta: boolean;
}

const recusaAnalise = (r: keyof typeof MENSAGENS_ANALISE_CULTURA) => recusa(r, MENSAGENS_ANALISE_CULTURA[r]);

const SQL_CULTURA = `
  SELECT rc.id, rc.crescimento, rc.situacao, rc.alterado_em AS cultura_alterada_em, rq.paciente_id, rq.atendimento_id, rq.estabelecimento_id,
         ex.nome AS exame, mb.descricao AS material, re.resultado_em, COALESCE(p.nome_social, pf.nome) AS nome
    FROM resultado_cultura rc
    JOIN resultado_exame re ON re.id = rc.resultado_exame_id AND re.excluido_em IS NULL
    JOIN exame_item ei ON ei.id = re.exame_item_id AND ei.excluido_em IS NULL
    JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id AND rq.excluido_em IS NULL
    JOIN exame ex ON ex.id = ei.exame_id
    JOIN material_biologico mb ON mb.id = rc.material_biologico_id
    JOIN paciente p ON p.id = rq.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
   WHERE rq.estabelecimento_id = ? AND rc.excluido_em IS NULL AND rc.crescimento = 'com_crescimento'`;

/** A análise com o que a leitura precisa para recalcular as pendências (mesmo relógio: o do banco). */
const SQL_ANALISE = `
  SELECT a.*, u.login AS analista, ca.abre_caso AS conduta_abre_caso, rc.situacao AS cultura_situacao,
         rc.alterado_em AS cultura_alterada_em, COALESCE(a.alterado_em, a.criado_em) AS revista_em,
         EXISTS (SELECT 1 FROM isolamento_paciente ip
                  WHERE ip.estabelecimento_id = a.estabelecimento_id AND ip.paciente_id = a.paciente_id
                    AND ip.situacao = 'ativo' AND ip.data_hora_fim IS NULL AND ip.excluido_em IS NULL) AS precaucao_ativa
    FROM analise_cultura_positiva a
    JOIN usuario u ON u.id = a.analista_usuario_id
    JOIN resultado_cultura rc ON rc.id = a.resultado_cultura_id
    LEFT JOIN conduta_analise_cultura ca ON ca.id = a.conduta_analise_cultura_id`;

/** O instante com milissegundos, para comparar dois instantes do mesmo relógio. */
const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v).replace(' ', 'T');

const laudoMudouDepois = (r: Linha) =>
  laudoRetificadoDepois(iso(r['revista_em']) ?? '', {
    situacao: texto(r['cultura_situacao']) as CulturaParaAnalise['situacao'],
    alteradaEm: iso(r['cultura_alterada_em']),
  });

const condutaDe = (r: Linha): CondutaCadastrada => ({
  id: n(r['id']),
  codigo: texto(r['codigo']),
  descricao: texto(r['descricao']),
  ativo: verdadeiro(r['ativo']),
  classificacaoAplicavel: textoN(r['classificacao_aplicavel']) as ClassificacaoCultura | null,
  abreCaso: verdadeiro(r['abre_caso']),
  indicaPrecaucao: verdadeiro(r['indica_precaucao']),
  exigeResposta: verdadeiro(r['exige_resposta']),
});

const analiseDe = (r: Linha): AnaliseCulturaRegistrada => {
  const mudou = laudoMudouDepois(r);
  const classificacao = texto(r['classificacao']) as ClassificacaoCultura;
  const conduta = nn(r['conduta_analise_cultura_id']);
  return {
    id: n(r['id']),
    cultura: n(r['resultado_cultura_id']),
    isolado: nn(r['isolado_microbiano_id']),
    paciente: n(r['paciente_id']),
    classificacao,
    conduta,
    condutaDescricao: textoN(r['conduta_descricao']),
    precaucaoIndicada: verdadeiro(r['precaucao_indicada']),
    prescritorOrientado: verdadeiro(r['prescritor_orientado']),
    laudoRetificado: verdadeiro(r['laudo_retificado']) || mudou,
    casoInfeccao: nn(r['caso_infeccao_id']),
    analisadaEm: instante(r['analisada_em']),
    analista: texto(r['analista']),
    versao: n(r['versao']),
    pendencias: pendenciasDaAnalise({
      classificacao,
      casoInfeccao: nn(r['caso_infeccao_id']),
      condutaAbreCaso: conduta === null ? null : verdadeiro(r['conduta_abre_caso']),
      precaucaoIndicada: verdadeiro(r['precaucao_indicada']),
      precaucaoAtiva: verdadeiro(r['precaucao_ativa']),
      laudoMudouDepois: mudou,
    }),
  };
};

/** Os germes das culturas, com a marca de já analisado. */
async function germesDas(l: L, culturas: readonly number[]): Promise<Map<number, GermeCultura[]>> {
  const m = new Map<number, GermeCultura[]>();
  if (!culturas.length) return m;
  const r = await l.consultar<Linha>(
    `SELECT im.id, im.resultado_cultura_id, mo.descricao AS microrganismo, im.multirresistente,
            EXISTS (SELECT 1 FROM analise_cultura_positiva a WHERE a.isolado_microbiano_id = im.id AND a.excluido_em IS NULL) AS analisado
       FROM isolado_microbiano im JOIN microrganismo mo ON mo.id = im.microrganismo_id
      WHERE im.resultado_cultura_id IN (${marcas(culturas.length)}) AND im.excluido_em IS NULL
      ORDER BY im.resultado_cultura_id, im.sequencia`,
    [...culturas],
    { teto: TETO * 4 },
  );
  for (const x of r) {
    const k = n(x['resultado_cultura_id']);
    m.set(k, [
      ...(m.get(k) ?? []),
      {
        id: n(x['id']),
        microrganismo: texto(x['microrganismo']),
        multirresistente: verdadeiro(x['multirresistente']),
        analisado: verdadeiro(x['analisado']),
      },
    ]);
  }
  return m;
}

export class PortaAnaliseCulturaPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoQualidade,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPortaM18, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, c, fn);
  }

  private gravar<T>(
    c: ContextoPortaM18,
    trilha: (r: T) => TrilhaDaGravacao,
    fn: (tx: TxOperacao, est: number) => Promise<T>,
  ) {
    return gravacaoDireta(this.executor, c, {
      nome: 'qualidade.ccih.analise-cultura',
      tabelas: TABELAS_ANALISE_CULTURA,
      trilha,
      gravador: (tx, est) => ({ tx, est }),
      fn: ({ tx, est }) => fn(tx, est),
    });
  }

  /** As culturas com crescimento do estabelecimento desde a data (as pendentes primeiro), opcionalmente de um paciente. */
  culturas(c: ContextoPortaM18, desde: string, paciente: number | null = null): Promise<CulturaPositiva[]> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar<Linha>(
        `${SQL_CULTURA} AND DATE(re.resultado_em) >= ? ${paciente === null ? '' : 'AND rq.paciente_id = ?'}
          ORDER BY re.resultado_em DESC, rc.id DESC`,
        [est, desde.slice(0, 10), ...(paciente === null ? [] : [paciente])],
        { teto: TETO },
      );
      const ids = r.map((x) => n(x['id']));
      const germes = await germesDas(l, ids);
      const analisadas = new Set<number>();
      const pendenciasDe = new Map<number, Set<PendenciaAnaliseCultura>>();
      if (ids.length)
        for (const a of await l.consultar<Linha>(
          `${SQL_ANALISE} WHERE a.resultado_cultura_id IN (${marcas(ids.length)}) AND a.excluido_em IS NULL`,
          ids,
          { teto: TETO * 4 },
        )) {
          const k = n(a['resultado_cultura_id']);
          if (a['isolado_microbiano_id'] === null || a['isolado_microbiano_id'] === undefined)
            analisadas.add(k);
          const p = pendenciasDe.get(k) ?? new Set<PendenciaAnaliseCultura>();
          for (const x of analiseDe(a).pendencias) p.add(x);
          pendenciasDe.set(k, p);
        }
      const lista = r.map((x): CulturaPositiva => {
        const id = n(x['id']);
        const gs = germes.get(id) ?? [];
        const faltaAnalisar = gs.length ? gs.some((g) => !g.analisado) : !analisadas.has(id);
        const pendencias = [...(pendenciasDe.get(id) ?? [])];
        return {
          id,
          paciente: n(x['paciente_id']),
          nome: texto(x['nome']),
          atendimento: nn(x['atendimento_id']),
          exame: texto(x['exame']),
          material: texto(x['material']),
          resultadoEm: instante(x['resultado_em']),
          situacao: texto(x['situacao']) as CulturaPositiva['situacao'],
          germes: gs,
          faltaAnalisar,
          pendencias,
          pendente: faltaAnalisar || pendencias.length > 0,
        };
      });
      return [...lista.filter((x) => x.pendente), ...lista.filter((x) => !x.pendente)];
    });
  }

  /** As análises gravadas (de uma cultura ou de um paciente), as mais recentes primeiro. */
  analises(
    c: ContextoPortaM18,
    filtro: { cultura?: number; paciente?: number },
  ): Promise<AnaliseCulturaRegistrada[]> {
    return this.ler(c, async (l, est) => {
      const w: string[] = ['a.estabelecimento_id = ?', 'a.excluido_em IS NULL'];
      const p: unknown[] = [est];
      if (filtro.cultura !== undefined) {
        w.push('a.resultado_cultura_id = ?');
        p.push(filtro.cultura);
      }
      if (filtro.paciente !== undefined) {
        w.push('a.paciente_id = ?');
        p.push(filtro.paciente);
      }
      const r = await l.consultar<Linha>(
        `${SQL_ANALISE} WHERE ${w.join(' AND ')} ORDER BY a.analisada_em DESC, a.id DESC`,
        p,
        { teto: TETO },
      );
      return r.map(analiseDe);
    });
  }

  condutas(c: ContextoPortaM18): Promise<CondutaCadastrada[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar<Linha>('SELECT * FROM conduta_analise_cultura ORDER BY ativo DESC, descricao', [], {
          teto: TETO,
        })
      ).map(condutaDe),
    );
  }

  /** Cadastra a conduta (o código é único no cliente). */
  registrarConduta(
    c: ContextoPortaM18,
    login: string,
    e: NovaConduta,
    trilha: (id: number) => TrilhaDaGravacao,
  ) {
    return this.gravar(
      c,
      (r: { id: number }) => trilha(r.id),
      async (tx) => {
        const usuario = await exigirUsuario(tx, login);
        const ja = await tx.uma<Linha>('SELECT id FROM conduta_analise_cultura WHERE codigo = ?', [e.codigo]);
        if (ja) throw recusa('conduta-ja-cadastrada', 'Já existe uma conduta com este código.');
        const id = await tx.inserir(
          `INSERT INTO conduta_analise_cultura (codigo, descricao, ativo, classificacao_aplicavel, abre_caso, indica_precaucao,
             exige_resposta, criado_em, criado_por, versao) VALUES (?, ?, TRUE, ?, ?, ?, ?, NOW(3), ?, 1)`,
          [
            e.codigo,
            e.descricao,
            e.classificacaoAplicavel,
            e.abreCaso,
            e.indicaPrecaucao,
            e.exigeResposta,
            usuario,
          ],
        );
        return { id };
      },
    );
  }

  /** A cultura travada (do estabelecimento, com crescimento) e os germes, para a regra. */
  private async culturaTravada(tx: TxOperacao, est: number, cultura: number) {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      `${SQL_CULTURA.replace("AND rc.crescimento = 'com_crescimento'", '')} AND rc.id = ?`,
      [est, cultura],
      {
        teto: 1,
      },
    );
    if (!r) throw recusa('cultura-inexistente', 'A cultura não é deste estabelecimento.');
    const gs = await tx.consultar<Linha>(
      'SELECT id, multirresistente FROM isolado_microbiano WHERE resultado_cultura_id = ? AND excluido_em IS NULL',
      [cultura],
      { teto: 50 },
    );
    const vista: CulturaParaAnalise = {
      crescimento: texto(r['crescimento']) as CulturaParaAnalise['crescimento'],
      situacao: texto(r['situacao']) as CulturaParaAnalise['situacao'],
      isolados: gs.map((g) => ({ id: n(g['id']), multirresistente: verdadeiro(g['multirresistente']) })),
    };
    return { linha: r, vista };
  }

  private async avaliar(
    tx: TxOperacao,
    est: number,
    cultura: number,
    e: EntradaAnaliseCultura,
    paciente: number,
  ) {
    const { linha, vista } = await this.culturaTravada(tx, est, cultura);
    let conduta: CondutaCultura | null = null;
    if (e.conduta !== null) {
      const r = await tx.uma<Linha>('SELECT * FROM conduta_analise_cultura WHERE id = ?', [e.conduta]);
      if (!r) throw recusa('conduta-inexistente', 'A conduta não está no cadastro.');
      conduta = condutaDe(r);
    }
    const ativa = await tx.uma<Linha>(
      `SELECT 1 AS x FROM isolamento_paciente WHERE estabelecimento_id = ? AND paciente_id = ? AND situacao = 'ativo'
          AND data_hora_fim IS NULL AND excluido_em IS NULL LIMIT 1`,
      [est, paciente],
    );
    const v = avaliarAnaliseCultura(e, vista, conduta, { precaucaoAtiva: Boolean(ativa) });
    if (!v.ok) throw recusaAnalise(v.recusa);
    if (e.casoInfeccao !== null) {
      const caso = await tx.uma<Linha>(
        'SELECT id FROM caso_infeccao WHERE id = ? AND estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL',
        [e.casoInfeccao, est, paciente],
      );
      if (!caso) throw recusa('caso-de-outro-paciente', 'A ficha de IRAS informada não é deste paciente.');
    }
    return { linha, analise: v.analise };
  }

  /** Registra a análise da cultura (uma por germe, ou uma por cultura sem germe). */
  registrar(
    c: ContextoPortaM18,
    login: string,
    cultura: number,
    e: EntradaAnaliseCultura,
    trilha: (r: { id: number; paciente: number }) => TrilhaDaGravacao,
  ): Promise<{ id: number; paciente: number; pendencias: readonly PendenciaAnaliseCultura[] }> {
    return this.gravar(c, trilha, async (tx, est) => {
      const usuario = await exigirUsuario(tx, login);
      const base = await this.culturaTravada(tx, est, cultura);
      const paciente = n(base.linha['paciente_id']);
      const { linha, analise } = await this.avaliar(tx, est, cultura, e, paciente);
      const ja = await tx.uma<Linha>(
        `SELECT id FROM analise_cultura_positiva WHERE resultado_cultura_id = ? AND excluido_em IS NULL
            AND ${analise.isolado === null ? 'isolado_microbiano_id IS NULL' : 'isolado_microbiano_id = ?'}`,
        analise.isolado === null ? [cultura] : [cultura, analise.isolado],
      );
      if (ja)
        throw recusa(
          'analise-ja-registrada',
          'Esta cultura (ou este germe) já foi analisada: corrija a análise.',
        );
      const agora = await relogioDoEstabelecimento(tx, est);
      const id = await tx.inserir(
        `INSERT INTO analise_cultura_positiva (estabelecimento_id, resultado_cultura_id, isolado_microbiano_id, paciente_id,
           atendimento_id, analisada_em, analista_usuario_id, classificacao, conduta_analise_cultura_id, conduta_descricao,
           precaucao_indicada, prescritor_orientado, laudo_retificado, caso_infeccao_id, origem, criado_em, criado_por, versao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sistema', NOW(3), ?, 1)`,
        [
          est,
          cultura,
          analise.isolado,
          paciente,
          nn(linha['atendimento_id']),
          agora.replace('T', ' '),
          usuario,
          analise.classificacao,
          e.conduta,
          e.condutaDescricao?.trim() || null,
          analise.precaucaoIndicada,
          analise.prescritorOrientado,
          false,
          e.casoInfeccao,
          usuario,
        ],
      );
      return { id, paciente, pendencias: analise.pendencias };
    });
  }

  /** Corrige a análise (versão conferida; a versão anterior vai à trilha com o motivo). */
  corrigir(
    c: ContextoPortaM18,
    login: string,
    id: number,
    versao: number,
    e: EntradaAnaliseCultura,
    motivo: string,
    trilha: (r: { id: number; paciente: number }) => TrilhaDaGravacao,
  ): Promise<{
    id: number;
    paciente: number;
    versao: number;
    pendencias: readonly PendenciaAnaliseCultura[];
  }> {
    return gravacaoDireta(this.executor, c, {
      nome: 'qualidade.ccih.analise-cultura',
      tabelas: TABELAS_ANALISE_CULTURA,
      trilha,
      gravador: (tx, est, anotacao) => ({ tx, est, anotacao }),
      fn: async ({ tx, est, anotacao }) => {
        const usuario = await exigirUsuario(tx, login);
        const [trava] = await tx.consultarParaAtualizar<Linha>(
          'SELECT id FROM analise_cultura_positiva WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [id, est],
          { teto: 1 },
        );
        const r = trava ? await tx.uma<Linha>(`${SQL_ANALISE} WHERE a.id = ?`, [id]) : null;
        if (!r || n(r['versao']) !== versao)
          throw recusa('versao-desatualizada', 'A análise mudou desde que foi aberta: recarregue e confira.');
        const paciente = n(r['paciente_id']);
        const cultura = n(r['resultado_cultura_id']);
        const { analise } = await this.avaliar(
          tx,
          est,
          cultura,
          { ...e, isolado: nn(r['isolado_microbiano_id']) },
          paciente,
        );
        // A correção feita depois da retificação do laudo fica marcada (e a marca já gravada nunca é desfeita).
        const laudoRetificado = verdadeiro(r['laudo_retificado']) || laudoMudouDepois(r);
        anotacao.motivo = motivo;
        anotacao.dados = {
          versaoAnterior: {
            tabela: 'analise_cultura_positiva',
            id,
            versao,
            dados: analiseDe({ ...r, analista: '' }),
          },
        };
        await tx.executar(
          `UPDATE analise_cultura_positiva SET classificacao = ?, conduta_analise_cultura_id = ?, conduta_descricao = ?,
              precaucao_indicada = ?, prescritor_orientado = ?, laudo_retificado = ?, caso_infeccao_id = ?,
              alterado_em = NOW(3), alterado_por = ?, versao = versao + 1
            WHERE id = ? AND versao = ?`,
          [
            analise.classificacao,
            e.conduta,
            e.condutaDescricao?.trim() || null,
            analise.precaucaoIndicada,
            analise.prescritorOrientado,
            laudoRetificado,
            e.casoInfeccao,
            usuario,
            id,
            versao,
          ],
        );
        return { id, paciente, versao: versao + 1, pendencias: analise.pendencias };
      },
    });
  }
}
