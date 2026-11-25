// Parâmetros da integração prescrição × estoque (F3.6, 05-SUP linha 7), gravados numa operação do Executor (trilha,
// outbox, idempotência e trava de versão na mesma transação): a regra de integração (qual local atende a prescrição de
// cada escopo, em que momento e de que forma) e a grade de horários padrão. A grade é a UNIFICADA, a mesma que o
// aprazamento lê (horario_padrao_dose: por grade de horário da unidade, nula = o estabelecimento, e por número de doses
// ao dia; a frequência escolhida dá o número de doses); horario_padrao_medicacao ficou só como histórico (migração
// 11_SUP/97_grade_padrao_unificada). As regras puras moram em
// `regras/farmacia-parametros.ts`; aqui ficam só a conferência das referências no banco e a escrita. Nada é apagado: a
// regra se inativa e o horário que sai da grade fica inativo (o histórico das doses geradas continua explicável).
import {
  chaveRegraIntegracao,
  conferirGradePadrao,
  conferirRegraIntegracao,
  dosesDaFrequencia,
  type RecusaSuprimentos,
} from '@sgh/contratos/regras-suprimentos';
import type {
  GradeHorarioPadrao,
  GravarHorariosPadraoEntrada,
  GravarRegraIntegracaoEntrada,
  ParametrosIntegracaoEditaveis,
  RegraIntegracaoLida,
} from '@sgh/contratos';
import { recusa, type Leitor, type ResultadoOperacao, type TxOperacao } from '@sgh/nucleo';
import type { ExtrasGravacaoFarmacia } from './gravador-avaliacao.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const idOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';

/**
 * A grade de horário que o aprazamento escolhe (CatalogoPrescricaoPropria.regras): a do bloco, a da unidade ou a do
 * estabelecimento (sem unidade, bloco nem setor). A grade só de setor nunca é escolhida, e por isso não é oferecida
 * nem aceita para a grade padrão.
 */
const GRADE_RESOLVIDA =
  '(g.unidade_internacao_id IS NOT NULL OR g.bloco_internacao_id IS NOT NULL OR g.setor_funcional_id IS NULL)';

export const TABELAS_PARAMETROS = ['regra_integracao_prescricao', 'horario_padrao_dose'] as const;

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const [r] = rs;
  if (r)
    throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
    });
}

/** As referências que pertencem ao estabelecimento (ativas): o id existe, ou a recusa com o campo. */
async function conferirDoEstabelecimento(
  tx: TxOperacao,
  est: number,
  tabela: 'centro_custo' | 'setor_funcional' | 'unidade_internacao' | 'local_estoque',
  id: number | null,
  campo: string,
): Promise<void> {
  if (id === null) return;
  const r = await tx.uma<Linha>(
    `SELECT id FROM ${tabela} WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL`,
    [id, est],
  );
  if (!r)
    throw recusa('referencia-inexistente', 'Escolha uma opção ativa deste estabelecimento.', {
      campos: [campo],
    });
}

async function conferirAtivo(
  tx: TxOperacao,
  tabela: 'tipo_item_prescricao' | 'grupo_insumo' | 'subgrupo_insumo' | 'insumo',
  id: number | null,
  campo: string,
): Promise<void> {
  if (id === null) return;
  const cond = tabela === 'insumo' ? "situacao = 'ativo' AND excluido_em IS NULL" : 'ativo';
  const r = await tx.uma<Linha>(`SELECT id FROM ${tabela} WHERE id = ? AND ${cond}`, [id]);
  if (!r) throw recusa('referencia-inexistente', 'Escolha uma opção ativa.', { campos: [campo] });
}

export function gravadorParametros(tx: TxOperacao, est: number, extras: ExtrasGravacaoFarmacia) {
  async function gravarRegraIntegracao(e: GravarRegraIntegracaoEntrada): Promise<ResultadoOperacao> {
    recusarTodas(
      conferirRegraIntegracao({
        centroCusto: e.centroCusto,
        setor: e.setor,
        unidade: e.unidade,
        grupo: e.grupo,
        subgrupo: e.subgrupo,
        item: e.item,
        localAtendente: e.localAtendente,
        localSubstituto: e.localSubstituto,
        tipoIntegracao: e.tipoIntegracao,
        momento: e.momento,
        antecedenciaMinutos: e.antecedenciaMinutos,
        geraManipulacao: e.geraManipulacao,
      }),
    );
    await conferirDoEstabelecimento(tx, est, 'centro_custo', e.centroCusto, 'centroCusto');
    await conferirDoEstabelecimento(tx, est, 'setor_funcional', e.setor, 'setor');
    await conferirDoEstabelecimento(tx, est, 'unidade_internacao', e.unidade, 'unidade');
    await conferirDoEstabelecimento(tx, est, 'local_estoque', e.localAtendente, 'localAtendente');
    await conferirDoEstabelecimento(tx, est, 'local_estoque', e.localSubstituto, 'localSubstituto');
    await conferirAtivo(tx, 'tipo_item_prescricao', e.tipoItem, 'tipoItem');
    await conferirAtivo(tx, 'grupo_insumo', e.grupo, 'grupo');
    await conferirAtivo(tx, 'subgrupo_insumo', e.subgrupo, 'subgrupo');
    await conferirAtivo(tx, 'insumo', e.item, 'item');
    if (e.ativo) {
      // Duas regras ativas com o mesmo escopo, os mesmos filtros e a mesma prioridade: a prescrição não saberia qual
      // usar. A regra recusa na hora, com o número da outra.
      const chave = chaveRegraIntegracao(e);
      const ativas = await tx.consultar<Linha>(
        `SELECT id, centro_custo_id, setor_funcional_id, unidade_internacao_id, tipo_item_prescricao_id,
                grupo_insumo_id, subgrupo_insumo_id, insumo_id, prioridade
           FROM regra_integracao_prescricao WHERE estabelecimento_id = ? AND ativo AND id <> ?`,
        [est, e.regra ?? 0],
      );
      const igual = ativas.find(
        (r) =>
          chaveRegraIntegracao({
            centroCusto: idOuNulo(r['centro_custo_id']),
            setor: idOuNulo(r['setor_funcional_id']),
            unidade: idOuNulo(r['unidade_internacao_id']),
            tipoItem: idOuNulo(r['tipo_item_prescricao_id']),
            grupo: idOuNulo(r['grupo_insumo_id']),
            subgrupo: idOuNulo(r['subgrupo_insumo_id']),
            item: idOuNulo(r['insumo_id']),
            prioridade: n(r['prioridade']),
          }) === chave,
      );
      if (igual)
        throw recusa(
          'regra-duplicada',
          `Já existe a regra ${n(igual['id'])} ativa com o mesmo escopo e a mesma prioridade: altere-a ou mude a prioridade.`,
          { campos: ['prioridade'] },
        );
    }
    const valores = {
      centro_custo_id: e.centroCusto,
      setor_funcional_id: e.setor,
      unidade_internacao_id: e.unidade,
      tipo_item_prescricao_id: e.tipoItem,
      grupo_insumo_id: e.grupo,
      subgrupo_insumo_id: e.subgrupo,
      insumo_id: e.item,
      atendente_local_estoque_id: e.localAtendente,
      substituto_local_estoque_id: e.localSubstituto,
      tipo_integracao: e.tipoIntegracao,
      momento_integracao: e.momento,
      antecedencia_minutos: e.antecedenciaMinutos,
      forma_dispensacao: e.forma,
      gera_autorizacao_manipulacao: e.geraManipulacao,
      prioridade: e.prioridade,
      ativo: e.ativo,
    };
    let regra: number;
    if (e.regra === undefined) {
      regra = await tx.incluir('regra_integracao_prescricao', { estabelecimento_id: est, ...valores });
    } else {
      const [atual] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id FROM regra_integracao_prescricao WHERE id = ? AND estabelecimento_id = ?',
        [e.regra, est],
      );
      if (!atual)
        throw recusa('regra-inexistente', 'A regra não existe neste estabelecimento.', { campos: ['regra'] });
      regra = e.regra;
      await tx.alterar('regra_integracao_prescricao', regra, e.versao ?? 0, valores);
    }
    extras.alvo = { tabela: 'regra_integracao_prescricao', id: regra };
    extras.eventos.push({ tipo: 'farmacia.regra_integracao.gravada', carga: { regra, ativo: e.ativo } });
    return { regra };
  }

  async function gravarHorariosPadrao(e: GravarHorariosPadraoEntrada): Promise<ResultadoOperacao> {
    const f = await tx.uma<Linha>(
      'SELECT id, doses_por_dia, intervalo_minutos FROM frequencia_administracao WHERE id = ? AND ativo',
      [e.frequencia],
    );
    if (!f)
      throw recusa('referencia-inexistente', 'Escolha uma frequência ativa.', { campos: ['frequencia'] });
    if (e.grade !== null) {
      const g = await tx.uma<Linha>(
        `SELECT id, ${GRADE_RESOLVIDA} AS resolvida FROM grade_horario_unidade g
          WHERE id = ? AND estabelecimento_id = ? AND ativo`,
        [e.grade, est],
      );
      if (!g)
        throw recusa('referencia-inexistente', 'Escolha uma grade de horário ativa deste estabelecimento.', {
          campos: ['grade'],
        });
      // A grade só de setor (sem unidade nem bloco) o aprazamento não escolhe: gravada ali, ficaria sem efeito.
      if (!verdadeiro(g['resolvida']))
        throw recusa(
          'grade-sem-aprazamento',
          'Esta grade é só de um setor e o aprazamento não a usa: escolha a grade da unidade, do bloco ou do estabelecimento.',
          { campos: ['grade'] },
        );
    }
    const doses = dosesDaFrequencia({
      dosesPorDia: idOuNulo(f['doses_por_dia']),
      intervaloMinutos: idOuNulo(f['intervalo_minutos']),
    });
    recusarTodas(conferirGradePadrao(e.horarios, doses));
    const atuais = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, ordem_dose, TIME_FORMAT(horario, '%H:%i') AS hora, ativo
         FROM horario_padrao_dose
        WHERE estabelecimento_id = ? AND grade_horario_unidade_id <=> ? AND doses_por_dia = ?
        ORDER BY ordem_dose`,
      [est, e.grade, doses],
    );
    const porOrdem = new Map(atuais.map((r) => [n(r['ordem_dose']), r]));
    let incluidos = 0;
    let alterados = 0;
    let inativados = 0;
    for (const [i, h] of e.horarios.entries()) {
      const ordem = i + 1;
      const r = porOrdem.get(ordem);
      if (!r) {
        await tx.incluir('horario_padrao_dose', {
          estabelecimento_id: est,
          grade_horario_unidade_id: e.grade,
          doses_por_dia: doses,
          ordem_dose: ordem,
          horario: `${h.hora}:00`,
          ativo: true,
        });
        incluidos += 1;
      } else if (texto(r['hora']) !== h.hora || !verdadeiro(r['ativo'])) {
        await tx.alterar('horario_padrao_dose', n(r['id']), n(r['versao']), {
          horario: `${h.hora}:00`,
          ativo: true,
        });
        alterados += 1;
      }
    }
    // A grade tem sempre o número de doses (o CHECK da ordem e a regra garantem); a posição que sobrar de uma carga
    // antiga fica inativa, nunca apagada.
    for (const r of atuais)
      if (n(r['ordem_dose']) > e.horarios.length && verdadeiro(r['ativo'])) {
        await tx.alterar('horario_padrao_dose', n(r['id']), n(r['versao']), { ativo: false });
        inativados += 1;
      }
    extras.alvo = { tabela: 'horario_padrao_dose', id: null };
    extras.eventos.push({
      tipo: 'farmacia.horarios_padrao.gravados',
      carga: { frequencia: e.frequencia, grade: e.grade, doses, horarios: e.horarios.length },
    });
    return { frequencia: e.frequencia, doses: doses ?? 0, incluidos, alterados, inativados };
  }

  return { gravarRegraIntegracao, gravarHorariosPadrao };
}

const escopoNome = (r: Linha) =>
  [r['centro_nome'], r['setor_nome'], r['unidade_nome']]
    .filter((x) => x !== null && x !== undefined)
    .join(' · ');

/** A leitura da tela de parâmetros: as regras, as grades ativas e as opções do estabelecimento. */
export async function lerParametrosEditaveis(l: Leitor, est: number): Promise<ParametrosIntegracaoEditaveis> {
  const regras = await l.consultar<Linha>(
    `SELECT r.*, cc.nome AS centro_nome, sf.nome AS setor_nome, ui.descricao AS unidade_nome, le.nome AS local_nome
       FROM regra_integracao_prescricao r
       LEFT JOIN centro_custo cc ON cc.id = r.centro_custo_id
       LEFT JOIN setor_funcional sf ON sf.id = r.setor_funcional_id
       LEFT JOIN unidade_internacao ui ON ui.id = r.unidade_internacao_id
       JOIN local_estoque le ON le.id = r.atendente_local_estoque_id
      WHERE r.estabelecimento_id = ? ORDER BY r.ativo DESC, r.prioridade, r.id LIMIT 500`,
    [est],
  );
  // A grade unificada (a do aprazamento): por grade de horário (nula = o estabelecimento) e número de doses.
  const horarios = await l.consultar<Linha>(
    `SELECT h.grade_horario_unidade_id, h.doses_por_dia, TIME_FORMAT(h.horario, '%H:%i') AS hora
       FROM horario_padrao_dose h
      WHERE h.estabelecimento_id = ? AND h.ativo
      ORDER BY h.grade_horario_unidade_id, h.doses_por_dia, h.ordem_dose LIMIT 2000`,
    [est],
  );
  const gradesHorario = (
    await l.consultar<Linha>(
      `SELECT g.id, CONCAT_WS(' · ', ui.descricao, bi.nome, sf.nome, g.tipo_atendimento) AS nome
         FROM grade_horario_unidade g
         LEFT JOIN unidade_internacao ui ON ui.id = g.unidade_internacao_id
         LEFT JOIN bloco_internacao bi ON bi.id = g.bloco_internacao_id
         LEFT JOIN setor_funcional sf ON sf.id = g.setor_funcional_id
        WHERE g.estabelecimento_id = ? AND g.ativo AND ${GRADE_RESOLVIDA}
        ORDER BY nome LIMIT 1000`,
      [est],
    )
  ).map((r) => ({ id: n(r['id']), nome: texto(r['nome']) }));
  const frequencias = (
    await l.consultar<Linha>(
      `SELECT id, descricao AS nome, doses_por_dia, intervalo_minutos FROM frequencia_administracao
        WHERE ativo ORDER BY descricao LIMIT 1000`,
    )
  ).map((r) => ({
    id: n(r['id']),
    nome: texto(r['nome']),
    dosesPorDia: dosesDaFrequencia({
      dosesPorDia: idOuNulo(r['doses_por_dia']),
      intervaloMinutos: idOuNulo(r['intervalo_minutos']),
    }),
  }));
  const grades = new Map<string, GradeHorarioPadrao & { horarios: { hora: string }[] }>();
  for (const h of horarios) {
    const grade = idOuNulo(h['grade_horario_unidade_id']);
    const doses = n(h['doses_por_dia']);
    const k = `${grade ?? ''}|${doses}`;
    let g = grades.get(k);
    if (!g) {
      const usam = frequencias.filter((f) => f.dosesPorDia === doses);
      g = {
        grade,
        gradeNome:
          grade === null ? null : (gradesHorario.find((x) => x.id === grade)?.nome ?? `Grade ${grade}`),
        dosesPorDia: doses,
        frequencia: usam[0]?.id ?? null,
        frequenciaNome: usam.length ? usam.map((f) => f.nome).join(', ') : `${doses} dose(s) ao dia`,
        horarios: [],
      };
      grades.set(k, g);
    }
    g.horarios.push({ hora: texto(h['hora']) });
  }
  const opcoes = async (sql: string, p: unknown[] = []) =>
    (await l.consultar<Linha>(`${sql} LIMIT 1000`, p)).map((r) => ({
      id: n(r['id']),
      nome: texto(r['nome']),
      ...(r['doses'] !== undefined ? { dosesPorDia: idOuNulo(r['doses']) } : {}),
    }));
  const doEst = (t: string, col = 'nome') =>
    opcoes(
      `SELECT id, ${col} AS nome FROM ${t} WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY ${col}`,
      [est],
    );
  return {
    regras: regras.map((r): RegraIntegracaoLida => ({
      regra: n(r['id']),
      versao: n(r['versao']),
      centroCusto: idOuNulo(r['centro_custo_id']),
      setor: idOuNulo(r['setor_funcional_id']),
      unidade: idOuNulo(r['unidade_internacao_id']),
      tipoItem: idOuNulo(r['tipo_item_prescricao_id']),
      grupo: idOuNulo(r['grupo_insumo_id']),
      subgrupo: idOuNulo(r['subgrupo_insumo_id']),
      item: idOuNulo(r['insumo_id']),
      localAtendente: n(r['atendente_local_estoque_id']),
      localSubstituto: idOuNulo(r['substituto_local_estoque_id']),
      tipoIntegracao: texto(r['tipo_integracao']) as RegraIntegracaoLida['tipoIntegracao'],
      momento: texto(r['momento_integracao']) as RegraIntegracaoLida['momento'],
      antecedenciaMinutos: idOuNulo(r['antecedencia_minutos']),
      forma: texto(r['forma_dispensacao']) as RegraIntegracaoLida['forma'],
      geraManipulacao: verdadeiro(r['gera_autorizacao_manipulacao']),
      prioridade: n(r['prioridade']),
      ativo: verdadeiro(r['ativo']),
      escopoNome: escopoNome(r),
      localNome: texto(r['local_nome']),
    })),
    grades: [...grades.values()],
    opcoes: {
      centros: await doEst('centro_custo'),
      setores: await doEst('setor_funcional'),
      unidades: await doEst('unidade_internacao', 'descricao'),
      locais: await doEst('local_estoque'),
      tiposItem: await opcoes(
        'SELECT id, descricao AS nome FROM tipo_item_prescricao WHERE ativo ORDER BY descricao',
      ),
      grupos: await opcoes('SELECT id, descricao AS nome FROM grupo_insumo WHERE ativo ORDER BY descricao'),
      subgrupos: (
        await l.consultar<Linha>(
          'SELECT id, descricao AS nome, grupo_insumo_id FROM subgrupo_insumo WHERE ativo ORDER BY descricao LIMIT 2000',
        )
      ).map((r) => ({ id: n(r['id']), nome: texto(r['nome']), grupo: n(r['grupo_insumo_id']) })),
      itens: (
        await l.consultar<Linha>(
          `SELECT id, CONCAT(codigo, ' · ', nome) AS nome, subgrupo_insumo_id FROM insumo
            WHERE situacao = 'ativo' AND excluido_em IS NULL AND subgrupo_insumo_id IS NOT NULL
            ORDER BY nome LIMIT 20000`,
        )
      ).map((r) => ({ id: n(r['id']), nome: texto(r['nome']), subgrupo: idOuNulo(r['subgrupo_insumo_id']) })),
      frequencias,
      gradesHorario,
    },
  };
}
