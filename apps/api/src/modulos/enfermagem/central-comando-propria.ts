// C2-053 (01-ADM L117): a central de comando assistencial no banco PRÓPRIO.
//   - regras de risco clínico como dado do hospital: tema_clinico, regra_risco_clinico e regra_risco_clinico_criterio
//     (exame, medicamento, dose, diagnóstico CID-10, sinal vital, permanência; presença ou ausência);
//   - a apuração: os pacientes em acompanhamento do estabelecimento (internação ativa ou dado clínico nas últimas 24 h)
//     cruzados com as regras vigentes; abre a ocorrência_risco_clinico com a evidência, não duplica a aberta e encerra a
//     que deixou de ocorrer (resolvida pelo sistema, com o motivo); nada é apagado;
//   - reconhecer, resolver e descartar a ocorrência (com a conduta);
//   - alertas de fluxo da unidade (alerta_fluxo_unidade) medidos agora: espera, ocupação, alta pendente, leitos
//     bloqueados e em higienização;
//   - metas das 24 horas (meta_cuidado_24h): incluir, cumprir, não cumprir ou cancelar com justificativa;
//   - o quadro da unidade: pacientes na ordem de quem precisa primeiro, com riscos, metas, o último NEWS2 e os
//     protocolos gerenciados abertos (os sinais que já existem entram como fontes).
// As regras são do domínio (@sgh/dominio-enfermagem, central-comando); aqui só a leitura, a trava e a gravação,
// dentro da operação do Executor (trilha e idempotência na mesma transação).
import {
  acaoDaApuracao,
  type AlertaFluxo,
  avaliarRegraRisco,
  type CategoriaMeta24h,
  type CriterioRisco,
  cumprimentoMetas,
  type FatosRisco,
  type GravidadeOcorrencia,
  gravidadeDaOcorrencia,
  type GravidadeRegraRisco,
  horasAntes,
  MENSAGENS_ALERTA_FLUXO,
  MENSAGENS_META_24H,
  MENSAGENS_OCORRENCIA,
  MENSAGENS_REGRA_RISCO,
  metaAtrasada,
  nivelDoAlerta,
  ordemDoQuadro,
  PESO_GRAVIDADE,
  percentualOcupacao,
  problemaDaNovaMeta,
  problemaDaPassagem,
  problemaDoEncerramentoMeta,
  problemasDaRegraRisco,
  problemasDoAlertaFluxo,
  type RegraRisco,
  type SituacaoMeta24h,
  type SituacaoOcorrenciaRisco,
  type TipoAlertaFluxo,
  type TipoCriterioRisco,
  type UnidadeLimite,
} from '@sgh/dominio-enfermagem';
import { type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { booleano, type Linha, marcadores, num, numOuNulo, texto, textoOuNulo } from './banco-apoio.js';
import type { AnotacaoGravacao } from './gravacao-direta.js';

export const TABELAS_REGRA_RISCO = [
  'tema_clinico',
  'regra_risco_clinico',
  'regra_risco_clinico_criterio',
] as const;
export const TABELAS_ALERTA_FLUXO = ['alerta_fluxo_unidade'] as const;
export const TABELAS_OCORRENCIA_RISCO = ['ocorrencia_risco_clinico'] as const;
export const TABELAS_META_24H = ['meta_cuidado_24h'] as const;

const T_TEMA = 'tema_clinico';
const T_REGRA = 'regra_risco_clinico';
const T_CRITERIO = 'regra_risco_clinico_criterio';
const T_ALERTA = 'alerta_fluxo_unidade';
const T_OCORRENCIA = 'ocorrencia_risco_clinico';
const T_META = 'meta_cuidado_24h';

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();
const decimal = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

// ---------------------------------------------------------------------------------------------------------------
// Configuração: temas e regras.

export interface TemaLido {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly categoria: string;
  readonly ativo: boolean;
}

export async function temasClinicos(l: Leitor): Promise<TemaLido[]> {
  return (
    await l.consultar(
      `SELECT id, codigo, descricao, categoria, ativo FROM ${T_TEMA} ORDER BY ordem, descricao`,
    )
  ).map((r) => ({
    id: num(r['id']),
    codigo: texto(r['codigo']),
    descricao: texto(r['descricao']),
    categoria: texto(r['categoria']),
    ativo: booleano(r['ativo']),
  }));
}

export interface CriterioLido extends CriterioRisco {
  readonly id: number;
  readonly sequencia: number;
  readonly alvo: string | null;
}
export interface RegraLida extends RegraRisco {
  readonly id: number;
  readonly tema: number;
  readonly temaDescricao: string;
  readonly fichaTecnica: string | null;
  readonly ativo: boolean;
  readonly versao: number;
  readonly criterios: readonly CriterioLido[];
}

async function criteriosDasRegras(l: Leitor, ids: readonly number[]): Promise<Map<number, CriterioLido[]>> {
  const m = new Map<number, CriterioLido[]>();
  if (ids.length === 0) return m;
  const linhas = await l.consultar(
    `SELECT c.id, c.regra_risco_clinico_id, c.sequencia, c.tipo_criterio, c.exame_id, c.item_prescritivel_id,
            c.codigo_cid10, c.parametro_vital_id, c.valor_minimo, c.valor_maximo, c.permanencia_minima_horas, c.negado,
            COALESCE(e.nome, i.descricao, p.descricao, c.codigo_cid10) AS alvo
       FROM ${T_CRITERIO} c
       LEFT JOIN exame e ON e.id = c.exame_id
       LEFT JOIN item_prescritivel i ON i.id = c.item_prescritivel_id
       LEFT JOIN parametro_vital p ON p.id = c.parametro_vital_id
      WHERE c.regra_risco_clinico_id IN (${marcadores(ids.length)}) AND c.ativo AND c.excluido_em IS NULL
      ORDER BY c.regra_risco_clinico_id, c.sequencia`,
    [...ids],
  );
  for (const r of linhas) {
    const k = num(r['regra_risco_clinico_id']);
    m.set(k, [
      ...(m.get(k) ?? []),
      {
        id: num(r['id']),
        sequencia: num(r['sequencia']),
        tipo: texto(r['tipo_criterio']) as TipoCriterioRisco,
        exame: numOuNulo(r['exame_id']),
        item: numOuNulo(r['item_prescritivel_id']),
        cid: textoOuNulo(r['codigo_cid10']),
        parametroVital: numOuNulo(r['parametro_vital_id']),
        valorMinimo: decimal(r['valor_minimo']),
        valorMaximo: decimal(r['valor_maximo']),
        permanenciaMinimaHoras: numOuNulo(r['permanencia_minima_horas']),
        negado: booleano(r['negado']),
        alvo: textoOuNulo(r['alvo']),
      },
    ]);
  }
  return m;
}

/** As regras do estabelecimento (e as da rede inteira), com os critérios ativos. `soAtivas`: só as que valem. */
export async function regrasRisco(l: Leitor, est: number, soAtivas = false): Promise<RegraLida[]> {
  const linhas = await l.consultar(
    `SELECT r.id, r.codigo, r.nome, r.tema_clinico_id, t.descricao AS tema, r.ficha_tecnica, r.gravidade,
            r.sexo_aplicavel, r.idade_minima_dias, r.idade_maxima_dias, r.combinacao_criterios,
            r.janela_avaliacao_horas, r.vigencia_inicio, r.vigencia_fim, r.ativo, r.versao
       FROM ${T_REGRA} r JOIN ${T_TEMA} t ON t.id = r.tema_clinico_id
      WHERE (r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?) ${soAtivas ? 'AND r.ativo AND t.ativo' : ''}
      ORDER BY r.ativo DESC, t.ordem, r.nome LIMIT 1000`,
    [est],
  );
  const cs = await criteriosDasRegras(
    l,
    linhas.map((r) => num(r['id'])),
  );
  return linhas.map((r) => ({
    id: num(r['id']),
    codigo: texto(r['codigo']),
    nome: texto(r['nome']),
    tema: num(r['tema_clinico_id']),
    temaDescricao: texto(r['tema']),
    fichaTecnica: textoOuNulo(r['ficha_tecnica']),
    gravidade: texto(r['gravidade']) as GravidadeRegraRisco,
    sexo: texto(r['sexo_aplicavel']) as RegraRisco['sexo'],
    idadeMinimaDias: numOuNulo(r['idade_minima_dias']),
    idadeMaximaDias: numOuNulo(r['idade_maxima_dias']),
    combinacao: texto(r['combinacao_criterios']) as RegraRisco['combinacao'],
    janelaHoras: numOuNulo(r['janela_avaliacao_horas']),
    vigenciaInicio: dataIso(r['vigencia_inicio']),
    vigenciaFim: r['vigencia_fim'] ? dataIso(r['vigencia_fim']) : null,
    ativo: booleano(r['ativo']),
    versao: num(r['versao']),
    criterios: cs.get(num(r['id'])) ?? [],
  }));
}

/** Os combos da tela de regras: exames, itens prescritíveis, sinais vitais e unidades. */
export async function apoioCentral(l: Leitor, est: number) {
  const [exames, itens, sinais, unidades] = await Promise.all([
    l.consultar('SELECT id, nome AS rotulo FROM exame WHERE ativo ORDER BY nome LIMIT 2000'),
    l.consultar(
      'SELECT id, descricao AS rotulo FROM item_prescritivel WHERE ativo ORDER BY descricao LIMIT 5000',
    ),
    l.consultar('SELECT id, descricao AS rotulo FROM parametro_vital WHERE ativo ORDER BY descricao'),
    l.consultar(
      'SELECT id, nome AS rotulo FROM unidade_assistencial WHERE estabelecimento_id = ? AND ativo ORDER BY nome',
      [est],
    ),
  ]);
  const op = (xs: Linha[]) => xs.map((r) => ({ id: num(r['id']), rotulo: texto(r['rotulo']) }));
  return { exames: op(exames), itens: op(itens), sinais: op(sinais), unidades: op(unidades) };
}

export interface PedidoTema {
  readonly codigo: string;
  readonly descricao: string;
  readonly categoria: 'risco_assistencial' | 'seguranca_paciente' | 'protocolo_gerenciado' | 'gestao_leito';
}

export async function incluirTemaTx(
  tx: TxOperacao,
  an: AnotacaoGravacao,
  e: PedidoTema,
): Promise<{ id: number }> {
  const ja = await tx.uma(`SELECT id FROM ${T_TEMA} WHERE codigo = ?`, [e.codigo]);
  if (ja) throw recusa('tema-repetido', 'Já existe um tema clínico com este código.');
  const id = await tx.incluir(T_TEMA, {
    codigo: e.codigo,
    descricao: e.descricao,
    categoria: e.categoria,
    ativo: true,
  });
  an.dados = { codigo: e.codigo, categoria: e.categoria };
  return { id };
}

export interface PedidoRegra extends Omit<RegraRisco, 'criterios'> {
  readonly tema: number;
  readonly fichaTecnica: string | null;
  readonly paraTodaRede: boolean;
  readonly criterios: readonly CriterioRisco[];
}

/** Inclui a regra com os critérios (a regra do domínio confere tudo antes; os alvos têm de existir no cadastro). */
export async function incluirRegraTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  e: PedidoRegra,
): Promise<{ id: number }> {
  const p = problemasDaRegraRisco(e)[0];
  if (p) throw recusa(p, MENSAGENS_REGRA_RISCO[p]);
  const tema = await tx.uma(`SELECT id FROM ${T_TEMA} WHERE id = ? AND ativo`, [e.tema]);
  if (!tema) throw recusa('tema-inexistente', 'O tema clínico escolhido não existe ou está inativo.');
  const dono = e.paraTodaRede ? null : est;
  const ja = await tx.uma(`SELECT id FROM ${T_REGRA} WHERE codigo = ? AND (estabelecimento_id <=> ?)`, [
    e.codigo,
    dono,
  ]);
  if (ja) throw recusa('regra-repetida', 'Já existe uma regra com este código.');
  for (const c of e.criterios) {
    const alvo =
      c.tipo === 'exame'
        ? await tx.uma('SELECT id FROM exame WHERE id = ?', [c.exame])
        : c.tipo === 'medicamento' || c.tipo === 'dose'
          ? await tx.uma('SELECT id FROM item_prescritivel WHERE id = ?', [c.item])
          : c.tipo === 'sinal_vital'
            ? await tx.uma('SELECT id FROM parametro_vital WHERE id = ?', [c.parametroVital])
            : { id: 0 };
    if (!alvo)
      throw recusa('alvo-inexistente', 'Um critério aponta para exame, item ou sinal vital que não existe.');
  }
  const id = await tx.incluir(T_REGRA, {
    estabelecimento_id: dono,
    codigo: e.codigo,
    nome: e.nome,
    tema_clinico_id: e.tema,
    ficha_tecnica: e.fichaTecnica,
    gravidade: e.gravidade,
    sexo_aplicavel: e.sexo,
    idade_minima_dias: e.idadeMinimaDias,
    idade_maxima_dias: e.idadeMaximaDias,
    combinacao_criterios: e.combinacao,
    janela_avaliacao_horas: e.janelaHoras,
    vigencia_inicio: e.vigenciaInicio,
    vigencia_fim: e.vigenciaFim,
    ativo: true,
  });
  let sequencia = 0;
  for (const c of e.criterios)
    await tx.incluir(T_CRITERIO, {
      regra_risco_clinico_id: id,
      sequencia: ++sequencia,
      tipo_criterio: c.tipo,
      exame_id: c.tipo === 'exame' ? c.exame : null,
      item_prescritivel_id: c.tipo === 'medicamento' || c.tipo === 'dose' ? c.item : null,
      codigo_cid10: c.tipo === 'diagnostico' ? c.cid!.trim().toUpperCase().replace(/[.\s]/g, '') : null,
      parametro_vital_id: c.tipo === 'sinal_vital' ? c.parametroVital : null,
      valor_minimo: c.tipo === 'diagnostico' || c.tipo === 'permanencia' ? null : c.valorMinimo,
      valor_maximo: c.tipo === 'diagnostico' || c.tipo === 'permanencia' ? null : c.valorMaximo,
      permanencia_minima_horas: c.tipo === 'permanencia' ? c.permanenciaMinimaHoras : null,
      negado: c.negado,
      ativo: true,
    });
  an.dados = { codigo: e.codigo, gravidade: e.gravidade, criterios: e.criterios.length };
  return { id };
}

/** Liga ou desliga a regra (nunca apaga: as ocorrências antigas continuam apontando para ela). */
export async function ativarRegraTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  id: number,
  versao: number,
  ativo: boolean,
  motivo: string,
): Promise<{ id: number; versao: number }> {
  const r = await tx.uma(
    `SELECT id FROM ${T_REGRA} WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
    [id, est],
  );
  if (!r) throw recusa('regra-inexistente', 'A regra de risco não existe neste estabelecimento.');
  const nova = await tx.alterar(T_REGRA, id, versao, { ativo });
  an.motivo = motivo;
  an.dados = { ativo };
  return { id, versao: nova };
}

// ---------------------------------------------------------------------------------------------------------------
// Alertas de fluxo.

export interface AlertaFluxoLido extends AlertaFluxo {
  readonly id: number;
  readonly unidade: number | null;
  readonly unidadeNome: string | null;
  readonly alertarPainel: boolean;
  readonly ativo: boolean;
  readonly versao: number;
}

export async function alertasFluxo(l: Leitor, est: number, soAtivos = false): Promise<AlertaFluxoLido[]> {
  return (
    await l.consultar(
      `SELECT a.id, a.unidade_assistencial_id, u.nome, a.indicador_id, a.tipo_alerta, a.unidade_limite,
              a.limite_atencao, a.limite_critico, a.alertar_painel, a.ativo, a.versao
         FROM ${T_ALERTA} a LEFT JOIN unidade_assistencial u ON u.id = a.unidade_assistencial_id
        WHERE (a.unidade_assistencial_id IS NULL OR u.estabelecimento_id = ?) ${soAtivos ? 'AND a.ativo' : ''}
        ORDER BY a.ativo DESC, u.nome, a.tipo_alerta`,
      [est],
    )
  ).map((r) => ({
    id: num(r['id']),
    unidade: numOuNulo(r['unidade_assistencial_id']),
    unidadeNome: textoOuNulo(r['nome']),
    tipo: texto(r['tipo_alerta']) as TipoAlertaFluxo,
    unidadeLimite: texto(r['unidade_limite']) as UnidadeLimite,
    limiteAtencao: decimal(r['limite_atencao']),
    limiteCritico: Number(r['limite_critico']),
    indicador: numOuNulo(r['indicador_id']),
    alertarPainel: booleano(r['alertar_painel']),
    ativo: booleano(r['ativo']),
    versao: num(r['versao']),
  }));
}

export interface PedidoAlertaFluxo extends AlertaFluxo {
  readonly unidade: number | null;
}

export async function incluirAlertaFluxoTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  e: PedidoAlertaFluxo,
): Promise<{ id: number }> {
  const p = problemasDoAlertaFluxo(e)[0];
  if (p) throw recusa(p, MENSAGENS_ALERTA_FLUXO[p]);
  if (e.unidade !== null) {
    const u = await tx.uma('SELECT id FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ?', [
      e.unidade,
      est,
    ]);
    if (!u) throw recusa('unidade-inexistente', 'A unidade não é deste estabelecimento.');
  }
  const ja = await tx.uma(
    `SELECT id FROM ${T_ALERTA} WHERE ativo AND tipo_alerta = ? AND (unidade_assistencial_id <=> ?) AND (indicador_id <=> ?)`,
    [e.tipo, e.unidade, e.indicador],
  );
  if (ja)
    throw recusa(
      'alerta-repetido',
      'Já existe um alerta ativo deste tipo para a unidade: ajuste ou inative-o.',
    );
  const id = await tx.incluir(T_ALERTA, {
    unidade_assistencial_id: e.unidade,
    indicador_id: e.indicador,
    tipo_alerta: e.tipo,
    unidade_limite: e.unidadeLimite,
    limite_atencao: e.limiteAtencao,
    limite_critico: e.limiteCritico,
    alertar_painel: true,
    ativo: true,
  });
  an.dados = { tipo: e.tipo, unidade: e.unidade };
  return { id };
}

export async function inativarAlertaFluxoTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  id: number,
  versao: number,
  motivo: string,
): Promise<{ id: number; versao: number }> {
  const a = (await alertasFluxo(tx, est)).find((x) => x.id === id);
  if (!a) throw recusa('alerta-inexistente', 'O alerta não existe neste estabelecimento.');
  if (!a.ativo) throw recusa('alerta-ja-inativo', 'O alerta já está inativo.');
  const nova = await tx.alterar(T_ALERTA, id, versao, { ativo: false });
  an.motivo = motivo;
  return { id, versao: nova };
}

/** A medida de cada tipo de alerta, agora, na unidade (nula: tudo o estabelecimento). */
async function medidaDoAlerta(
  l: Leitor,
  est: number,
  a: AlertaFluxoLido,
  agora: Date,
): Promise<number | null> {
  const porUnidade = a.unidade !== null;
  const leitos = async (bases: string) => {
    const r = await l.uma(
      `SELECT SUM(s.situacao_base IN (${bases})) AS n, SUM(s.situacao_base = 'ocupado') AS ocupados,
              SUM(s.conta_como_operacional) AS operacionais
         FROM leito_hospitalar lh JOIN situacao_leito s ON s.id = lh.situacao_leito_id
         JOIN unidade_internacao ui ON ui.id = lh.unidade_internacao_id
        WHERE lh.estabelecimento_id = ? AND lh.ativo AND lh.excluido_em IS NULL
          AND (? = 0 OR ui.unidade_assistencial_id = ?)`,
      [est, porUnidade ? 1 : 0, a.unidade ?? 0],
    );
    return r;
  };
  switch (a.tipo) {
    case 'ocupacao': {
      const r = await leitos("'ocupado'");
      return percentualOcupacao(num(r?.['ocupados']), num(r?.['operacionais']));
    }
    case 'leito_bloqueado':
      return num((await leitos("'bloqueado','interditado','manutencao'"))?.['n']);
    case 'leito_higienizacao':
      return num((await leitos("'higienizacao'"))?.['n']);
    case 'alta_pendente': {
      const r = await l.uma(
        `SELECT MIN(i.data_hora_alta_medica) AS desde FROM internacao i
           JOIN unidade_internacao ui ON ui.id = i.unidade_internacao_id
           JOIN atendimento a ON a.id = i.atendimento_id
          WHERE a.estabelecimento_id = ? AND i.situacao = 'ativa' AND i.data_hora_alta_medica IS NOT NULL
            AND i.data_hora_alta IS NULL AND (? = 0 OR ui.unidade_assistencial_id = ?)`,
        [est, porUnidade ? 1 : 0, a.unidade ?? 0],
      );
      const d = iso(r?.['desde']);
      return d ? Math.max(0, Math.round((agora.getTime() - Date.parse(d)) / 60_000)) : 0;
    }
    case 'tempo_espera': {
      // A maior espera agora: atendimento aberto, sem alta e sem internação ativa (aguardando vaga ou conduta).
      const r = await l.uma(
        `SELECT MIN(a.entrada_em) AS desde FROM atendimento a
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.alta_medica_em IS NULL AND a.saida_em IS NULL
            AND a.entrada_em >= ? AND (? = 0 OR a.unidade_assistencial_id = ?)
            AND NOT EXISTS (SELECT 1 FROM internacao i WHERE i.atendimento_id = a.id AND i.situacao = 'ativa')`,
        [est, new Date(agora.getTime() - 3 * 86_400_000), porUnidade ? 1 : 0, a.unidade ?? 0],
      );
      const d = iso(r?.['desde']);
      return d ? Math.max(0, Math.round((agora.getTime() - Date.parse(d)) / 60_000)) : 0;
    }
    case 'indicador':
      return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Apuração dos riscos.

interface PacienteEmAcompanhamento {
  readonly atendimento: number;
  readonly paciente: number;
  readonly nome: string;
  readonly numero: string;
  readonly unidade: number | null;
  readonly leito: number | null;
  readonly leitoCodigo: string | null;
  readonly entradaEm: string;
  readonly sexo: 'feminino' | 'masculino' | null;
  readonly nascimento: string | null;
}

/** Os pacientes em acompanhamento: internação ativa, ou atendimento aberto com dado clínico nas últimas 24 horas. */
async function pacientesEmAcompanhamento(
  l: Leitor,
  est: number,
  agora: Date,
  unidade: number | null = null,
): Promise<PacienteEmAcompanhamento[]> {
  const desde = new Date(agora.getTime() - 24 * 3_600_000);
  const linhas = await l.consultar(
    `SELECT a.id, a.paciente_id, pf.nome, a.numero, a.entrada_em, pf.data_nascimento, sx.codigo AS sexo,
            COALESCE(ui.unidade_assistencial_id, a.unidade_assistencial_id) AS unidade,
            ol.leito_hospitalar_id, lh.codigo AS leito
       FROM atendimento a
       JOIN paciente p ON p.id = a.paciente_id
       JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
       LEFT JOIN sexo sx ON sx.id = pf.sexo_id
       LEFT JOIN internacao i ON i.atendimento_id = a.id AND i.situacao = 'ativa'
       LEFT JOIN unidade_internacao ui ON ui.id = i.unidade_internacao_id
       LEFT JOIN ocupacao_leito ol ON ol.internacao_vigente_id = i.id
       LEFT JOIN leito_hospitalar lh ON lh.id = ol.leito_hospitalar_id
      WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.saida_em IS NULL AND a.alta_medica_em IS NULL
        AND (i.id IS NOT NULL
          OR EXISTS (SELECT 1 FROM afericao f WHERE f.atendimento_id = a.id AND f.excluido_em IS NULL AND f.aferido_em >= ?)
          OR EXISTS (SELECT 1 FROM prescricao pr WHERE pr.atendimento_id = a.id AND pr.excluido_em IS NULL
                       AND pr.situacao <> 'rascunho' AND pr.vigencia_fim_em >= ?))
      ORDER BY a.id DESC LIMIT 500`,
    [est, desde, agora],
  );
  return linhas
    .map((r) => ({
      atendimento: num(r['id']),
      paciente: num(r['paciente_id']),
      nome: texto(r['nome']),
      numero: texto(r['numero']),
      unidade: numOuNulo(r['unidade']),
      leito: numOuNulo(r['leito_hospitalar_id']),
      leitoCodigo: textoOuNulo(r['leito']),
      entradaEm: iso(r['entrada_em'])!,
      sexo: (['feminino', 'masculino'].includes(texto(r['sexo'])) ? texto(r['sexo']) : null) as
        'feminino' | 'masculino' | null,
      nascimento: r['data_nascimento'] ? dataIso(r['data_nascimento']) : null,
    }))
    .filter((p) => unidade === null || p.unidade === unidade);
}

/** Os achados de cada atendimento (resultados liberados, itens prescritos vigentes, CID-10 ativos, aferições). */
async function fatosDosPacientes(
  l: Leitor,
  ps: readonly PacienteEmAcompanhamento[],
  agora: Date,
  janelaHoras: number,
): Promise<Map<number, FatosRisco>> {
  const m = new Map<number, FatosRisco>();
  if (ps.length === 0) return m;
  const ats = ps.map((p) => p.atendimento);
  const pacs = [...new Set(ps.map((p) => p.paciente))];
  const desde = new Date(agora.getTime() - janelaHoras * 3_600_000);
  const [ex, it, dx, sv] = await Promise.all([
    l.consultar(
      `SELECT r.paciente_id, ei.exame_id, MAX(ra.valor_numerico) AS valor, MAX(ra.critico OR r.critico) AS critico,
              r.liberado_em
         FROM resultado_exame r JOIN exame_item ei ON ei.id = r.exame_item_id
         LEFT JOIN resultado_analito ra ON ra.resultado_exame_id = r.id
        WHERE r.paciente_id IN (${marcadores(pacs.length)}) AND r.situacao = 'liberado' AND r.liberado_em >= ?
        GROUP BY r.id, r.paciente_id, ei.exame_id, r.liberado_em`,
      [...pacs, desde],
    ),
    l.consultar(
      `SELECT pr.atendimento_id, pi.item_prescritivel_id, pi.quantidade, pi.inicio_em
         FROM prescricao pr JOIN prescricao_item pi ON pi.prescricao_id = pr.id
        WHERE pr.atendimento_id IN (${marcadores(ats.length)}) AND pr.excluido_em IS NULL AND pr.situacao <> 'rascunho'
          AND pr.vigencia_fim_em >= ? AND pi.excluido_em IS NULL AND pi.situacao = 'ativo'
          AND pi.item_prescritivel_id IS NOT NULL AND (pi.fim_em IS NULL OR pi.fim_em >= ?)`,
      [...ats, agora, agora],
    ),
    l.consultar(
      `SELECT d.atendimento_id, t.codigo_termo FROM diagnostico_atendimento d
         JOIN termo_terminologia t ON t.id = d.cid_termo_terminologia_id
        WHERE d.atendimento_id IN (${marcadores(ats.length)}) AND d.situacao = 'ativo'
       UNION ALL
       SELECT a.id, t.codigo_termo FROM atendimento a JOIN termo_terminologia t ON t.id = a.cid_principal_termo_terminologia_id
        WHERE a.id IN (${marcadores(ats.length)})`,
      [...ats, ...ats],
    ),
    l.consultar(
      `SELECT f.atendimento_id, v.parametro_vital_id, v.valor_numerico, f.aferido_em
         FROM afericao f JOIN afericao_valor v ON v.afericao_id = f.id
        WHERE f.atendimento_id IN (${marcadores(ats.length)}) AND f.excluido_em IS NULL AND f.aferido_em >= ?
          AND v.valor_numerico IS NOT NULL`,
      [...ats, desde],
    ),
  ]);
  for (const p of ps) {
    const idade =
      p.nascimento !== null ? Math.floor((agora.getTime() - Date.parse(p.nascimento)) / 86_400_000) : null;
    m.set(p.atendimento, {
      sexo: p.sexo,
      idadeDias: idade,
      permanenciaHoras: Math.max(0, Math.floor((agora.getTime() - Date.parse(p.entradaEm)) / 3_600_000)),
      exames: ex
        .filter((r) => num(r['paciente_id']) === p.paciente)
        .map((r) => ({
          exame: num(r['exame_id']),
          valor: decimal(r['valor']),
          critico: booleano(Number(r['critico'] ?? 0) ? 1 : 0),
          em: iso(r['liberado_em'])!,
        })),
      itens: it
        .filter((r) => num(r['atendimento_id']) === p.atendimento)
        .map((r) => ({
          item: num(r['item_prescritivel_id']),
          dose: decimal(r['quantidade']),
          em: iso(r['inicio_em'])!,
        })),
      cids: dx.filter((r) => num(r['atendimento_id']) === p.atendimento).map((r) => texto(r['codigo_termo'])),
      sinais: sv
        .filter((r) => num(r['atendimento_id']) === p.atendimento)
        .map((r) => ({
          parametro: num(r['parametro_vital_id']),
          valor: decimal(r['valor_numerico']),
          em: iso(r['aferido_em'])!,
        })),
    });
  }
  return m;
}

export interface ResultadoApuracao {
  readonly avaliados: number;
  readonly regras: number;
  readonly abertas: number;
  readonly mantidas: number;
  readonly encerradas: number;
}

/**
 * Apura as regras vigentes contra os pacientes em acompanhamento: abre a ocorrência com a evidência (gravidade da
 * regra), não duplica a aberta ou reconhecida, e encerra pelo sistema a que deixou de ocorrer (resolvida, com o
 * motivo; nunca apagada).
 */
export async function apurarRiscosTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  usuario: number,
  agora: Date,
): Promise<ResultadoApuracao> {
  const regras = (await regrasRisco(tx, est, true)).filter((r) => r.criterios.length > 0);
  const ps = await pacientesEmAcompanhamento(tx, est, agora);
  const janela = Math.max(24, ...regras.map((r) => r.janelaHoras ?? 24));
  const fatos = await fatosDosPacientes(tx, ps, agora, janela);
  const abertas =
    ps.length && regras.length
      ? await tx.consultarParaAtualizar(
          `SELECT id, regra_risco_clinico_id, atendimento_id, situacao, versao FROM ${T_OCORRENCIA}
            WHERE estabelecimento_id = ? AND situacao IN ('aberta','reconhecida') AND excluido_em IS NULL
              AND atendimento_id IN (${marcadores(ps.length)})`,
          [est, ...ps.map((p) => p.atendimento)],
        )
      : [];
  const chave = (regra: number, atendimento: number) => `${regra}|${atendimento}`;
  const porChave = new Map(
    abertas.map((o) => [chave(num(o['regra_risco_clinico_id']), num(o['atendimento_id'])), o]),
  );
  const agoraIso = agora.toISOString();
  let n = { abertas: 0, mantidas: 0, encerradas: 0 };
  for (const p of ps)
    for (const r of regras) {
      const f = fatos.get(p.atendimento)!;
      const av = avaliarRegraRisco(r, f, agoraIso);
      const o = porChave.get(chave(r.id, p.atendimento)) ?? null;
      const acao = acaoDaApuracao(av.acende, o !== null);
      if (acao === 'abrir') {
        await tx.incluir(T_OCORRENCIA, {
          estabelecimento_id: est,
          regra_risco_clinico_id: r.id,
          paciente_id: p.paciente,
          atendimento_id: p.atendimento,
          unidade_assistencial_id: p.unidade,
          leito_hospitalar_id: p.leito,
          detectado_em: agora,
          gravidade: gravidadeDaOcorrencia(r.gravidade),
          situacao: 'aberta',
          evidencia: JSON.stringify({ regra: r.codigo, combinacao: r.combinacao, criterios: av.evidencia }),
          origem: 'sistema',
        });
        n = { ...n, abertas: n.abertas + 1 };
      } else if (acao === 'manter') n = { ...n, mantidas: n.mantidas + 1 };
      else if (acao === 'encerrar' && o) {
        const reconhecida = texto(o['situacao']) === 'reconhecida';
        await tx.alterar(T_OCORRENCIA, num(o['id']), num(o['versao']), {
          situacao: 'resolvida',
          ...(reconhecida ? {} : { reconhecido_em: agora, reconhecido_por_usuario_id: usuario }),
          resolvido_em: agora,
          resolvido_por_usuario_id: usuario,
          resolucao: 'Encerrada pela apuração: os critérios da regra deixaram de ocorrer.',
        });
        n = { ...n, encerradas: n.encerradas + 1 };
      }
    }
  const r = { avaliados: ps.length, regras: regras.length, ...n };
  an.dados = { ...r };
  return r;
}

export interface PedidoPassagem {
  readonly acao: 'reconhecer' | 'resolver' | 'descartar';
  readonly versao: number;
  readonly resolucao: string | null;
}

export async function passarOcorrenciaTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  usuario: number,
  id: number,
  e: PedidoPassagem,
  agora: Date,
): Promise<{ id: number; versao: number; situacao: SituacaoOcorrenciaRisco }> {
  const [o] = await tx.consultarParaAtualizar(
    `SELECT id, situacao FROM ${T_OCORRENCIA} WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!o) throw recusa('ocorrencia-inexistente', 'A ocorrência de risco não existe neste estabelecimento.');
  const atual = texto(o['situacao']) as SituacaoOcorrenciaRisco;
  const p = problemaDaPassagem(atual, e.acao, e.resolucao);
  if (p) throw recusa(p, MENSAGENS_OCORRENCIA[p]);
  const reconhecer = atual === 'aberta' ? { reconhecido_em: agora, reconhecido_por_usuario_id: usuario } : {};
  const situacao: SituacaoOcorrenciaRisco =
    e.acao === 'reconhecer' ? 'reconhecida' : e.acao === 'resolver' ? 'resolvida' : 'descartada';
  const nova = await tx.alterar(T_OCORRENCIA, id, e.versao, {
    situacao,
    ...reconhecer,
    ...(e.acao === 'reconhecer'
      ? {}
      : { resolvido_em: agora, resolvido_por_usuario_id: usuario, resolucao: e.resolucao!.trim() }),
  });
  an.motivo = e.resolucao;
  an.dados = { de: atual, para: situacao };
  return { id, versao: nova, situacao };
}

// ---------------------------------------------------------------------------------------------------------------
// Metas das 24 horas.

export interface PedidoMeta {
  readonly atendimento: number;
  readonly categoria: CategoriaMeta24h;
  readonly descricao: string;
  readonly prazoEm: string;
  readonly ocorrencia: number | null;
}

export async function incluirMetaTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  e: PedidoMeta,
  agora: Date,
): Promise<{ id: number }> {
  const p = problemaDaNovaMeta(e.descricao, e.prazoEm, agora.toISOString());
  if (p) throw recusa(p, MENSAGENS_META_24H[p]);
  const a = await tx.uma(
    `SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
        AND saida_em IS NULL`,
    [e.atendimento, est],
  );
  if (!a) throw recusa('atendimento-fechado', 'O atendimento não está aberto neste estabelecimento.');
  if (e.ocorrencia !== null) {
    const o = await tx.uma(`SELECT id FROM ${T_OCORRENCIA} WHERE id = ? AND atendimento_id = ?`, [
      e.ocorrencia,
      e.atendimento,
    ]);
    if (!o) throw recusa('ocorrencia-de-outro', 'O risco escolhido não é deste atendimento.');
  }
  const id = await tx.incluir(T_META, {
    estabelecimento_id: est,
    atendimento_id: e.atendimento,
    paciente_id: num(a['paciente_id']),
    data_referencia: agora.toISOString().slice(0, 10),
    categoria: e.categoria,
    descricao: e.descricao.trim(),
    prazo_em: new Date(e.prazoEm),
    situacao: 'pendente',
    ocorrencia_risco_clinico_id: e.ocorrencia,
  });
  an.dados = { atendimento: e.atendimento, categoria: e.categoria };
  return { id };
}

export async function encerrarMetaTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  usuario: number,
  id: number,
  e: { versao: number; situacao: Exclude<SituacaoMeta24h, 'pendente'>; justificativa: string | null },
  agora: Date,
): Promise<{ id: number; versao: number }> {
  const [m] = await tx.consultarParaAtualizar(
    `SELECT id, situacao FROM ${T_META} WHERE id = ? AND estabelecimento_id = ?`,
    [id, est],
  );
  if (!m) throw recusa('meta-inexistente', 'A meta não existe neste estabelecimento.');
  const p = problemaDoEncerramentoMeta(texto(m['situacao']) as SituacaoMeta24h, e.situacao, e.justificativa);
  if (p) throw recusa(p, MENSAGENS_META_24H[p]);
  const nova = await tx.alterar(T_META, id, e.versao, {
    situacao: e.situacao,
    encerrada_em: agora,
    encerrada_por_usuario_id: usuario,
    justificativa: e.justificativa?.trim() || null,
  });
  an.motivo = e.justificativa;
  an.dados = { situacao: e.situacao };
  return { id, versao: nova };
}

// ---------------------------------------------------------------------------------------------------------------
// Leituras do quadro e do paciente.

export interface OcorrenciaLida {
  readonly id: number;
  readonly regra: string;
  readonly tema: string;
  readonly atendimento: number;
  readonly gravidade: GravidadeOcorrencia;
  readonly situacao: SituacaoOcorrenciaRisco;
  readonly detectadoEm: string;
  readonly evidencia: unknown;
  readonly resolucao: string | null;
  readonly versao: number;
}
export interface MetaLida {
  readonly id: number;
  readonly atendimento: number;
  readonly data: string;
  readonly categoria: CategoriaMeta24h;
  readonly descricao: string;
  readonly prazoEm: string;
  readonly situacao: SituacaoMeta24h;
  readonly atrasada: boolean;
  readonly justificativa: string | null;
  readonly ocorrencia: number | null;
  readonly versao: number;
}

const ocorrenciaDe = (r: Linha): OcorrenciaLida => ({
  id: num(r['id']),
  regra: texto(r['regra']),
  tema: texto(r['tema']),
  atendimento: num(r['atendimento_id']),
  gravidade: texto(r['gravidade']) as GravidadeOcorrencia,
  situacao: texto(r['situacao']) as SituacaoOcorrenciaRisco,
  detectadoEm: iso(r['detectado_em'])!,
  evidencia: typeof r['evidencia'] === 'string' ? JSON.parse(r['evidencia']) : (r['evidencia'] ?? null),
  resolucao: textoOuNulo(r['resolucao']),
  versao: num(r['versao']),
});
const metaDe = (r: Linha, agora: string): MetaLida => ({
  id: num(r['id']),
  atendimento: num(r['atendimento_id']),
  data: dataIso(r['data_referencia']),
  categoria: texto(r['categoria']) as CategoriaMeta24h,
  descricao: texto(r['descricao']),
  prazoEm: iso(r['prazo_em'])!,
  situacao: texto(r['situacao']) as SituacaoMeta24h,
  atrasada: metaAtrasada(texto(r['situacao']) as SituacaoMeta24h, iso(r['prazo_em'])!, agora),
  justificativa: textoOuNulo(r['justificativa']),
  ocorrencia: numOuNulo(r['ocorrencia_risco_clinico_id']),
  versao: num(r['versao']),
});
const SQL_OCORRENCIA = `SELECT o.id, o.atendimento_id, o.gravidade, o.situacao, o.detectado_em, o.evidencia, o.resolucao,
       o.versao, r.nome AS regra, t.descricao AS tema
  FROM ${T_OCORRENCIA} o JOIN ${T_REGRA} r ON r.id = o.regra_risco_clinico_id JOIN ${T_TEMA} t ON t.id = r.tema_clinico_id`;
const SQL_META = `SELECT id, atendimento_id, data_referencia, categoria, descricao, prazo_em, situacao, justificativa,
       ocorrencia_risco_clinico_id, versao FROM ${T_META}`;

/** O quadro da unidade (ou do estabelecimento): pacientes em ordem, alertas de fluxo medidos e o resumo do dia. */
export async function quadroDaUnidade(l: Leitor, est: number, agora: Date, unidade: number | null) {
  const ps = await pacientesEmAcompanhamento(l, est, agora, unidade);
  const ats = ps.map((p) => p.atendimento);
  const agoraIso = agora.toISOString();
  const desde24 = new Date(agora.getTime() - 24 * 3_600_000);
  const [ocs, metas, escores, protocolos] = ats.length
    ? await Promise.all([
        l.consultar(
          `${SQL_OCORRENCIA} WHERE o.estabelecimento_id = ? AND o.situacao IN ('aberta','reconhecida')
              AND o.excluido_em IS NULL AND o.atendimento_id IN (${marcadores(ats.length)}) ORDER BY o.detectado_em`,
          [est, ...ats],
        ),
        l.consultar(
          `${SQL_META} WHERE estabelecimento_id = ? AND atendimento_id IN (${marcadores(ats.length)})
              AND (situacao = 'pendente' OR prazo_em >= ?) ORDER BY prazo_em`,
          [est, ...ats, desde24],
        ),
        l.consultar(
          `SELECT x.atendimento_id, x.pontuacao_total, x.aplicado_em FROM aplicacao_escala x
             JOIN escala_clinica e ON e.id = x.escala_clinica_id
            WHERE x.atendimento_id IN (${marcadores(ats.length)}) AND x.excluido_em IS NULL AND x.situacao = 'finalizada'
              AND e.codigo IN ('news2','pews') AND x.aplicado_em >= ? ORDER BY x.aplicado_em`,
          [...ats, desde24],
        ),
        l.consultar(
          `SELECT atendimento_id, COUNT(*) AS n FROM inclusao_protocolo_paciente
            WHERE atendimento_id IN (${marcadores(ats.length)}) AND excluido_em IS NULL AND situacao = 'ativo'
            GROUP BY atendimento_id`,
          [...ats],
        ),
      ])
    : [[], [], [], []];
  const ocorrencias = ocs.map(ocorrenciaDe);
  const listaMetas = metas.map((r) => metaDe(r, agoraIso));
  const ultimoEscore = new Map<number, number>();
  for (const r of escores) ultimoEscore.set(num(r['atendimento_id']), num(r['pontuacao_total']));
  const nProtocolos = new Map(protocolos.map((r) => [num(r['atendimento_id']), num(r['n'])]));
  const pacientes = ps
    .map((p) => {
      const os = ocorrencias.filter((o) => o.atendimento === p.atendimento);
      const ms = listaMetas.filter((m) => m.atendimento === p.atendimento);
      const maior = os.reduce<GravidadeOcorrencia | null>(
        (g, o) => (g === null || PESO_GRAVIDADE[o.gravidade] > PESO_GRAVIDADE[g] ? o.gravidade : g),
        null,
      );
      return {
        atendimento: p.atendimento,
        paciente: p.paciente,
        nome: p.nome,
        numero: p.numero,
        leito: p.leitoCodigo,
        unidade: p.unidade,
        permanenciaHoras: Math.floor((agora.getTime() - Date.parse(p.entradaEm)) / 3_600_000),
        maiorGravidade: maior,
        riscosAbertos: os.length,
        riscos: os,
        metas: ms,
        metasAtrasadas: ms.filter((m) => m.atrasada).length,
        cumprimento: cumprimentoMetas(ms.map((m) => m.situacao)),
        escorePiora: ultimoEscore.get(p.atendimento) ?? null,
        protocolosAbertos: nProtocolos.get(p.atendimento) ?? 0,
      };
    })
    .sort(ordemDoQuadro);
  const alertas = [];
  for (const a of await alertasFluxo(l, est, true)) {
    if (unidade !== null && a.unidade !== null && a.unidade !== unidade) continue;
    const medida = await medidaDoAlerta(l, est, a, agora);
    alertas.push({ ...a, medida, nivel: nivelDoAlerta(a, medida) });
  }
  return {
    agora: agoraIso,
    pacientes,
    alertas,
    resumo: {
      pacientes: pacientes.length,
      comRisco: pacientes.filter((p) => p.riscosAbertos > 0).length,
      riscosCriticos: ocorrencias.filter((o) => o.gravidade === 'critica').length,
      metas: cumprimentoMetas(listaMetas.map((m) => m.situacao)),
      metasAtrasadas: listaMetas.filter((m) => m.atrasada).length,
      alertasCriticos: alertas.filter((a) => a.nivel === 'critico').length,
    },
  };
}

/** A visão por paciente: o histórico das ocorrências (todas, nunca apagadas) e as metas dos últimos 7 dias. */
export async function centralDoAtendimento(l: Leitor, est: number, atendimento: number, agora: Date) {
  const [ocs, metas] = await Promise.all([
    l.consultar(
      `${SQL_OCORRENCIA} WHERE o.estabelecimento_id = ? AND o.atendimento_id = ? AND o.excluido_em IS NULL
        ORDER BY o.detectado_em DESC LIMIT 500`,
      [est, atendimento],
    ),
    l.consultar(
      `${SQL_META} WHERE estabelecimento_id = ? AND atendimento_id = ? AND data_referencia >= ?
        ORDER BY data_referencia DESC, prazo_em`,
      [est, atendimento, horasAntes(agora.toISOString(), 24 * 7).slice(0, 10)],
    ),
  ]);
  return {
    atendimento,
    ocorrencias: ocs.map(ocorrenciaDe),
    metas: metas.map((r) => metaDe(r, agora.toISOString())),
  };
}
