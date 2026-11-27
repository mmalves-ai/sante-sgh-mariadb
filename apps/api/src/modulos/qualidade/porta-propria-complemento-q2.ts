// Complemento Q2 da porta PRÓPRIA da gestão da qualidade (modulos-proprios-3, família qualidade-q2): as leituras do
// segundo quarto (ordem alfabética) dos métodos que ainda falhavam fechados, sobre o DDL que já existe, com o mesmo
// contrato da porta de memória. Classe auxiliar: a porta própria completa delega a ela (a ligação é do integrador).
//
// - Documentos controlados: o "documento" do contrato é a REVISÃO publicada (documento_qualidade_versao), com o código,
//   o título, o tipo (tipo_documento_qualidade.codigo), a área (setor do documento) e a exigência de ciência do
//   documento_qualidade. Só entram as versões publicadas (vigente, obsoleta e cancelada); rascunho e fluxo de aprovação
//   não são documento publicado. Situação: vigente → 'vigente', obsoleta → 'obsoleto' (substituída por revisão nova),
//   cancelada → 'retirado'. O resumo SHA-256 é o do arquivo (arquivo.hash_sha256, imutável no armazenamento) ou, no
//   formato texto, o resumo FIXADO NA PUBLICAÇÃO no retrato da versão (dados.resumoSha256, gravado pela publicação com
//   o resumo do texto em UTF-8). Nunca é recalculado do conteúdo atual: um texto alterado depois de publicado continua
//   com o resumo da publicação, e a divergência prova a alteração. Sem resumo guardado, o resumo sai vazio (sem prova).
//   O motivo da retirada é o da anotação da versão (dados.motivoRetirada); o encerramento é o instante da última
//   alteração da versão já não vigente.
// - Ciências: documento_qualidade_ciencia da revisão, pelo login da conta que registrou (a do colaborador, quando a
//   conta não está na linha), em maiúsculas como o contrato.
// - Comissões: comissao_hospitalar do estabelecimento, com o tipo (tipo_comissao.codigo), a periodicidade, a composição
//   vigente (comissao_membro: nome do colaborador, do profissional ou o externo, a função escrita (ou o papel) e o login quando há conta, pelo colaborador ou pelo vínculo do profissional) no
//   JSON do contrato e as datas da última reunião realizada (ordinária e qualquer).
// - Histórico da análise crítica de um indicador: analise_critica_indicador pela apuração (competência, numerador,
//   denominador, valor e meta copiada da apuração; a situação da meta é o resultado do período registrado na própria
//   análise), uma análise por competência (a de maior sequência; empate, a mais nova), as 24 competências mais recentes; o responsável e o
//   prazo são os do plano de ação ligado à análise (nulos sem plano).
// - Contagem do painel: documentos vigentes, revisão vencida, ciências pendentes da sessão, riscos críticos
//   (pontuação ≥ 64 ainda identificados ou em tratamento), não conformidades e manifestações abertas e vencidas.
// - historicoRiscos (porta da segurança do paciente) segue 503 `modelo-pendente`: pede a decisão do marcador do modelo
//   de documento do formulário de gerenciamento de riscos (ver porta-propria-complemento-c.ts).
// - checklistsRevisao e checklistRevisao seguem 503: modelo_checklist_qualidade não tem a comissão dona nem a
//   inativação (quem, quando, motivo); pedem migração (ver relatório da família).
import type { L, Linha, NucleoQualidade } from './apoio-propria.js';
import {
  camelo,
  dataIso,
  instante,
  instanteN,
  lerNoEstabelecimento,
  marcas,
  n,
  nn,
  relogioDoEstabelecimento,
  texto,
  textoN,
  verdadeiro,
} from './apoio-propria.js';
import { pendentesDeCiencia } from './ciencia-distribuicao.js';
import type { ContextoGestao } from './porta-gestao.js';
import type {
  AnaliseIndicadorRegistrada,
  ComissaoRegistrada,
  DocumentoQualidadeRegistrado,
  FiltroDocumentos,
  PaginaGestao,
} from './tipos.js';

/** Os métodos da porta da gestão que este complemento cobre (a ligação na porta completa é do integrador). */
export const METODOS_COMPLEMENTO_Q2 = [
  'ciencias',
  'cientes',
  'pendentesCiencia',
  'comissao',
  'comissoes',
  'contagem',
  'documento',
  'documentos',
  'documentosDoCodigo',
  'historicoAnalises',
] as const;

/** Competências devolvidas no histórico da análise de um indicador (as mais recentes). */
export const TETO_HISTORICO_ANALISES = 24;
/** Pontuação a partir da qual o risco é crítico (gravidade × urgência × tendência). */
export const PONTUACAO_RISCO_CRITICO = 64;

const SITUACAO_DOCUMENTO: Readonly<Record<string, string>> = {
  vigente: 'vigente',
  obsoleta: 'obsoleto',
  cancelada: 'retirado',
};
const SITUACAO_DOCUMENTO_BANCO: Readonly<Record<string, string>> = {
  vigente: 'vigente',
  obsoleto: 'obsoleta',
  retirado: 'cancelada',
};

const SQL_DOCUMENTO = (comConteudo: boolean) => `
  SELECT v.id, v.versao, d.codigo, v.numero_versao, td.codigo AS tipo, d.titulo, sf.nome AS area, v.motivo_alteracao,
         ue.login AS elaborado_por, ur.login AS revisado_por, COALESCE(ua.login, uu.login) AS aprovado_por,
         v.publicado_em, COALESCE(v.proxima_revisao, d.proxima_revisao, v.vigencia_fim) AS vigencia_ate,
         d.exige_ciencia, COALESCE(a.hash_sha256, v.resumo_sha256, JSON_UNQUOTE(JSON_EXTRACT(v.dados, '$.resumoSha256'))) AS hash, v.situacao,
         COALESCE(v.motivo_retirada, JSON_UNQUOTE(JSON_EXTRACT(v.dados, '$.motivoRetirada'))) AS motivo_retirada,
         CASE WHEN v.situacao <> 'vigente' THEN COALESCE(v.retirada_em, v.alterado_em, v.ocorrido_em) END AS encerrado_em
         ${comConteudo ? ', v.conteudo' : ''}
    FROM documento_qualidade_versao v
    JOIN documento_qualidade d ON d.id = v.documento_qualidade_id
    JOIN tipo_documento_qualidade td ON td.id = d.tipo_documento_qualidade_id
    LEFT JOIN setor_funcional sf ON sf.id = d.setor_funcional_id
    LEFT JOIN arquivo a ON a.id = v.arquivo_id
    LEFT JOIN usuario ue ON ue.id = v.elaborador_usuario_id
    LEFT JOIN usuario ur ON ur.id = v.revisor_usuario_id
    LEFT JOIN usuario ua ON ua.id = v.aprovador_usuario_id
    LEFT JOIN usuario uu ON uu.id = v.usuario_id
   WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND v.publicado_em IS NOT NULL
     AND v.situacao IN ('vigente', 'obsoleta', 'cancelada')`;

/** A revisão de número inteiro (o rótulo "3" ou "3.0"); o rótulo fora disso fica 0, nunca erro. */
function revisaoDoRotulo(v: unknown): number {
  const m = /^\s*(\d+)/.exec(texto(v));
  return m ? Number(m[1]) : 0;
}

function documento(r: Linha, comConteudo: boolean): DocumentoQualidadeRegistrado {
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    codigo: texto(r['codigo']),
    revisao: revisaoDoRotulo(r['numero_versao']),
    tipo: texto(r['tipo']),
    titulo: texto(r['titulo']),
    area: texto(r['area']),
    resumoAlteracao: textoN(r['motivo_alteracao']),
    elaboradoPor: texto(r['elaborado_por']).toUpperCase(),
    revisadoPor: textoN(r['revisado_por'])?.toUpperCase() ?? null,
    aprovadoPor: texto(r['aprovado_por']).toUpperCase(),
    publicadoEm: instante(r['publicado_em']),
    vigenciaAte: dataIso(r['vigencia_ate']) ?? '',
    exigeCiencia: verdadeiro(r['exige_ciencia']),
    hash: texto(r['hash']).toLowerCase(),
    situacao: SITUACAO_DOCUMENTO[texto(r['situacao'])] ?? texto(r['situacao']),
    motivoRetirada: textoN(r['motivo_retirada']),
    encerradoEm: instanteN(r['encerrado_em']),
    conteudo: comConteudo ? textoN(r['conteudo']) : null,
  };
}

/** O login de quem registrou a ciência: a conta da linha ou a do colaborador. */
const SQL_CIENCIA = `
  SELECT c.documento_qualidade_versao_id AS documento, UPPER(u.login) AS usuario, c.ciencia_em
    FROM documento_qualidade_ciencia c
    JOIN documento_qualidade_versao v ON v.id = c.documento_qualidade_versao_id
    JOIN documento_qualidade d ON d.id = v.documento_qualidade_id
    LEFT JOIN colaborador co ON co.id = c.colaborador_id
    LEFT JOIN usuario u ON u.id = COALESCE(c.usuario_id, co.usuario_id)
   WHERE d.estabelecimento_id = ? AND c.excluido_em IS NULL`;

const SQL_COMISSAO = `
  SELECT ch.id, ch.versao, tc.codigo AS tipo, ch.nome, ch.periodicidade_reuniao, ch.situacao, ch.criado_em,
         (SELECT MAX(rc.realizada_em) FROM reuniao_comissao rc
           WHERE rc.comissao_hospitalar_id = ch.id AND rc.excluido_em IS NULL AND rc.situacao = 'realizada'
             AND rc.tipo = 'ordinaria') AS ultima_ordinaria,
         (SELECT MAX(rc.realizada_em) FROM reuniao_comissao rc
           WHERE rc.comissao_hospitalar_id = ch.id AND rc.excluido_em IS NULL AND rc.situacao = 'realizada') AS ultima_reuniao
    FROM comissao_hospitalar ch
    JOIN tipo_comissao tc ON tc.id = ch.tipo_comissao_id
   WHERE ch.estabelecimento_id = ? AND ch.excluido_em IS NULL`;

/** A composição vigente na data (vigência aberta ou ainda não terminada): a data do relógio do estabelecimento, o mesmo
 *  da gravação da reunião (nunca o relógio do banco), para a tela mostrar a composição que a gravação confere. */
const SQL_MEMBROS = (k: number) => `
  SELECT m.comissao_hospitalar_id AS comissao, COALESCE(co.nome, pf.nome, m.nome_externo) AS nome,
         COALESCE(m.funcao, REPLACE(m.papel, '_', ' ')) AS funcao, u.login
    FROM comissao_membro m
    LEFT JOIN colaborador co ON co.id = m.colaborador_id
    LEFT JOIN profissional p ON p.id = COALESCE(m.profissional_id, co.profissional_id)
    LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN usuario u ON u.id = COALESCE(co.usuario_id,
                                           (SELECT MIN(cu.usuario_id) FROM colaborador cu
                                             WHERE cu.profissional_id = m.profissional_id AND cu.usuario_id IS NOT NULL),
                                           (SELECT MAX(up.usuario_id) FROM usuario_profissional up
                                             WHERE up.profissional_id = m.profissional_id AND up.vigencia_fim IS NULL
                                               AND up.excluido_em IS NULL))
   WHERE m.comissao_hospitalar_id IN (${marcas(k)}) AND m.excluido_em IS NULL
     AND m.vigencia_inicio <= ? AND (m.vigencia_fim IS NULL OR m.vigencia_fim >= ?)
   ORDER BY m.comissao_hospitalar_id, FIELD(m.papel, 'presidente', 'vice_presidente', 'secretario', 'membro_executor',
            'membro', 'consultor'), m.id`;

export const SQL_ANALISE = `
  SELECT a.id, a.versao, i.codigo AS indicador, ap.competencia, ap.numerador, ap.denominador, ap.valor, ap.valor_meta,
         a.resultado_periodo, a.analise, a.causa, a.acao_proposta, ur.login AS responsavel, pa.prazo,
         ug.login AS registrada_por, a.analisado_em, uu.login AS atualizada_por, a.alterado_em
    FROM analise_critica_indicador a
    JOIN apuracao_indicador ap ON ap.id = a.apuracao_indicador_id
    JOIN indicador i ON i.id = ap.indicador_id
    LEFT JOIN plano_acao_qualidade pa ON pa.id = a.plano_acao_qualidade_id AND pa.excluido_em IS NULL
    LEFT JOIN usuario ur ON ur.id = pa.responsavel_usuario_id
    LEFT JOIN usuario ug ON ug.id = a.responsavel_usuario_id
    LEFT JOIN usuario uu ON uu.id = a.alterado_por
   WHERE ap.estabelecimento_id = ? AND a.excluido_em IS NULL AND ap.excluido_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM analise_critica_indicador a2
                       JOIN apuracao_indicador ap2 ON ap2.id = a2.apuracao_indicador_id
                      WHERE ap2.estabelecimento_id = ap.estabelecimento_id AND ap2.indicador_id = ap.indicador_id
                        AND ap2.competencia = ap.competencia AND ap2.excluido_em IS NULL AND a2.excluido_em IS NULL
                        AND (a2.sequencia > a.sequencia OR (a2.sequencia = a.sequencia AND a2.id > a.id)))`;

/** O resultado do período da análise (CHECK: na_meta, fora_da_meta, sem_meta) na união do contrato. */
const SITUACAO_META: Readonly<Record<string, AnaliseIndicadorRegistrada['situacaoMeta']>> = {
  na_meta: 'na-meta',
  fora_da_meta: 'fora-da-meta',
  sem_meta: 'sem-meta',
};

export function analise(r: Linha): AnaliseIndicadorRegistrada {
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    indicador: texto(r['indicador']),
    competencia: (dataIso(r['competencia']) ?? '').slice(0, 7),
    numerador: r['numerador'] === null ? null : n(r['numerador']),
    denominador: nn(r['denominador']),
    valor: nn(r['valor']),
    meta: nn(r['valor_meta']),
    situacaoMeta: SITUACAO_META[texto(r['resultado_periodo'])] ?? 'sem-meta',
    texto: texto(r['analise']),
    causas: textoN(r['causa']),
    plano: textoN(r['acao_proposta']),
    responsavel: textoN(r['responsavel'])?.toUpperCase() ?? null,
    prazo: dataIso(r['prazo']),
    registradaPor: texto(r['registrada_por']).toUpperCase(),
    registradaEm: instante(r['analisado_em']),
    atualizadaPor: textoN(r['atualizada_por'])?.toUpperCase() ?? null,
    atualizadaEm: instanteN(r['alterado_em']),
  };
}

export class LeiturasGestaoComplementoQ2 {
  constructor(private readonly nucleo: NucleoQualidade) {}

  private ler<T>(c: ContextoGestao, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, c, fn);
  }

  /** As revisões publicadas pelo filtro (situação, tipo, busca no código ou título), por código e revisão. */
  documentos(c: ContextoGestao, f: FiltroDocumentos): Promise<PaginaGestao<DocumentoQualidadeRegistrado>> {
    return this.ler(c, async (l, est) => {
      const filtros: string[] = [];
      const args: unknown[] = [est];
      if (f.situacao) {
        filtros.push('v.situacao = ?');
        args.push(SITUACAO_DOCUMENTO_BANCO[f.situacao] ?? f.situacao);
      }
      if (f.tipo) {
        filtros.push('td.codigo = ?');
        args.push(f.tipo);
      }
      const b = f.busca?.trim().toUpperCase();
      if (b) {
        filtros.push('(INSTR(UPPER(d.codigo), ?) > 0 OR INSTR(UPPER(d.titulo), ?) > 0)');
        args.push(b, b);
      }
      const onde = filtros.length ? ` AND ${filtros.join(' AND ')}` : '';
      const total = await l.uma(`SELECT COUNT(*) AS total FROM (${SQL_DOCUMENTO(false)}${onde}) x`, args);
      const porPagina = Math.max(1, Math.trunc(f.porPagina));
      const pagina = Math.max(1, Math.trunc(f.pagina));
      const linhas = await l.consultar(
        `${SQL_DOCUMENTO(false)}${onde}
          ORDER BY d.codigo, CAST(v.numero_versao AS UNSIGNED) DESC, v.id DESC LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`,
        args,
        { teto: porPagina },
      );
      return { itens: linhas.map((r) => documento(r, false)), total: n(total?.['total']) };
    });
  }

  /** A revisão pelo id, com o conteúdo (nulo para a inexistente ou de outro estabelecimento). */
  documento(c: ContextoGestao, id: number): Promise<DocumentoQualidadeRegistrado | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_DOCUMENTO(true)} AND v.id = ?`, [est, id]);
      return r ? documento(r, true) : null;
    });
  }

  /** Todas as revisões publicadas de um código (sem o conteúdo), da mais nova para a mais antiga. */
  documentosDoCodigo(c: ContextoGestao, codigo: string): Promise<DocumentoQualidadeRegistrado[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_DOCUMENTO(false)} AND d.codigo = ? ORDER BY CAST(v.numero_versao AS UNSIGNED) DESC, v.id DESC`,
          [est, codigo],
        )
      ).map((r) => documento(r, false)),
    );
  }

  /** Por revisão: o total de ciências e se o login da sessão já registrou a dele (só as revisões com ciência). */
  ciencias(
    c: ContextoGestao,
    documentos: readonly number[],
    usuario: string,
  ): Promise<Map<number, { total: number; sessao: boolean }>> {
    const ids = [...new Set(documentos)];
    if (!ids.length) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `SELECT x.documento, COUNT(*) AS total, SUM(x.usuario = ?) AS sessao
           FROM (${SQL_CIENCIA} AND c.documento_qualidade_versao_id IN (${marcas(ids.length)})) x
          GROUP BY x.documento`,
        [usuario.trim().toUpperCase(), est, ...ids],
      );
      return new Map(r.map((x) => [n(x['documento']), { total: n(x['total']), sessao: n(x['sessao']) > 0 }]));
    });
  }

  /** Quem registrou ciência na revisão, pela ordem do registro. */
  cientes(c: ContextoGestao, doc: number): Promise<{ usuario: string; cienteEm: string }[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_CIENCIA} AND c.documento_qualidade_versao_id = ? ORDER BY c.ciencia_em, c.id`,
          [est, doc],
        )
      ).map((x) => ({ usuario: texto(x['usuario']), cienteEm: instante(x['ciencia_em']) })),
    );
  }

  /** Quem a distribuição obriga a ler a revisão vigente e ainda não leu (ver ciencia-distribuicao.ts). */
  pendentesCiencia(c: ContextoGestao, doc: number): Promise<{ usuario: string; nome: string }[]> {
    return this.ler(c, async (l, est) =>
      pendentesDeCiencia(l, est, doc, (await relogioDoEstabelecimento(l, est)).slice(0, 10)),
    );
  }

  /** As análises críticas do indicador (código), das competências mais recentes (teto 24). */
  historicoAnalises(c: ContextoGestao, indicador: string): Promise<AnaliseIndicadorRegistrada[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_ANALISE} AND i.codigo = ? ORDER BY ap.competencia DESC, a.sequencia DESC, a.id DESC
            LIMIT ${TETO_HISTORICO_ANALISES}`,
          [est, indicador],
          { teto: TETO_HISTORICO_ANALISES },
        )
      ).map(analise),
    );
  }

  /** As comissões do estabelecimento (ativas primeiro, pelo nome), com a composição vigente e as últimas reuniões. */
  comissoes(c: ContextoGestao, hoje?: string): Promise<ComissaoRegistrada[]> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(`${SQL_COMISSAO} ORDER BY ch.situacao = 'ativa' DESC, ch.nome, ch.id`, [
        est,
      ]);
      return this.comMembros(l, r, hoje ?? (await relogioDoEstabelecimento(l, est)).slice(0, 10));
    });
  }

  /** A comissão com a composição vigente em `hoje` (AAAA-MM-DD; sem ele, a data do relógio do estabelecimento). */
  comissao(c: ContextoGestao, id: number, hoje?: string): Promise<ComissaoRegistrada | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_COMISSAO} AND ch.id = ?`, [est, id]);
      if (!r) return null;
      const dia = hoje ?? (await relogioDoEstabelecimento(l, est)).slice(0, 10);
      return (await this.comMembros(l, [r], dia))[0] ?? null;
    });
  }

  private async comMembros(l: L, linhas: readonly Linha[], hoje: string): Promise<ComissaoRegistrada[]> {
    const membros = new Map<number, { nome: string; funcao: string; login: string | null }[]>();
    if (linhas.length) {
      const ids = linhas.map((r) => n(r['id']));
      for (const m of await l.consultar(SQL_MEMBROS(ids.length), [...ids, hoje, hoje])) {
        const k = n(m['comissao']);
        const lista = membros.get(k) ?? [];
        lista.push({
          nome: texto(m['nome']),
          funcao: texto(m['funcao']),
          login: textoN(m['login'])?.toUpperCase() ?? null,
        });
        membros.set(k, lista);
      }
    }
    return linhas.map((r) => ({
      id: n(r['id']),
      versao: n(r['versao']),
      tipo: camelo(r['tipo']),
      nome: texto(r['nome']),
      periodicidade: texto(r['periodicidade_reuniao']),
      membros: JSON.stringify(membros.get(n(r['id'])) ?? []),
      ativa: texto(r['situacao']) === 'ativa',
      registradaEm: instante(r['criado_em']),
      ultimaOrdinaria: instanteN(r['ultima_ordinaria']),
      ultimaReuniao: instanteN(r['ultima_reuniao']),
    }));
  }

  /** As contagens do painel da gestão (`agora` é a hora civil do estabelecimento; `usuario` o login da sessão). */
  contagem(
    c: ContextoGestao,
    agora: string,
    usuario: string,
  ): Promise<{
    documentosVigentes: number;
    documentosRevisaoVencida: number;
    cienciasPendentesSessao: number;
    riscosCriticos: number;
    naoConformidadesAbertas: number;
    naoConformidadesVencidas: number;
    manifestacoesAbertas: number;
    manifestacoesVencidas: number;
  }> {
    const hoje = agora.slice(0, 10);
    const login = usuario.trim().toUpperCase();
    return this.ler(c, async (l, est) => {
      const doc = await l.uma(
        `SELECT COUNT(*) AS vigentes,
                COALESCE(SUM(x.vigencia_ate IS NOT NULL AND x.vigencia_ate < ?), 0) AS vencidas,
                COALESCE(SUM(x.exige_ciencia AND NOT EXISTS (
                  SELECT 1 FROM (${SQL_CIENCIA}) s WHERE s.documento = x.id AND s.usuario = ?)), 0) AS pendentes
           FROM (${SQL_DOCUMENTO(false)} AND v.situacao = 'vigente') x`,
        [hoje, est, login, est],
      );
      const risco = await l.uma(
        `SELECT COUNT(*) AS criticos FROM risco_institucional r
          WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.pontuacao >= ?
            AND r.situacao IN ('identificado', 'em_tratamento')`,
        [est, PONTUACAO_RISCO_CRITICO],
      );
      const nc = await l.uma(
        `SELECT COUNT(*) AS abertas, COALESCE(SUM(nc.prazo IS NOT NULL AND nc.prazo < ?), 0) AS vencidas
           FROM nao_conformidade_qualidade nc
          WHERE nc.estabelecimento_id = ? AND nc.excluido_em IS NULL AND nc.situacao NOT IN ('encerrada', 'cancelada')`,
        [hoje, est],
      );
      // A manifestação aberta é a sem resposta e não cancelada; vence ao fim do dia do prazo.
      const m = await l.uma(
        `SELECT COUNT(*) AS abertas, COALESCE(SUM(m.prazo_resposta < ?), 0) AS vencidas
           FROM manifestacao_ouvidoria m
          WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL
            AND m.situacao NOT IN ('respondida', 'encerrada', 'cancelada')`,
        [hoje, est],
      );
      return {
        documentosVigentes: n(doc?.['vigentes']),
        documentosRevisaoVencida: n(doc?.['vencidas']),
        cienciasPendentesSessao: n(doc?.['pendentes']),
        riscosCriticos: n(risco?.['criticos']),
        naoConformidadesAbertas: n(nc?.['abertas']),
        naoConformidadesVencidas: n(nc?.['vencidas']),
        manifestacoesAbertas: n(m?.['abertas']),
        manifestacoesVencidas: n(m?.['vencidas']),
      };
    });
  }
}
