// Parâmetros da integração prescrição × estoque (F3.6, 05-SUP linha 7), gravados numa operação do Executor (trilha,
// outbox, idempotência e trava de versão na mesma transação): a regra de integração (qual local atende a prescrição de
// cada escopo, em que momento e de que forma) e a grade de horários padrão de cada frequência. As regras puras moram em
// `regras/farmacia-parametros.ts`; aqui ficam só a conferência das referências no banco e a escrita. Nada é apagado: a
// regra se inativa e o horário que sai da grade fica inativo (o histórico das doses geradas continua explicável).
import {
  chaveRegraIntegracao,
  conferirHorariosPadrao,
  conferirRegraIntegracao,
  diasDoTexto,
  diasParaTexto,
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

export const TABELAS_PARAMETROS = ['regra_integracao_prescricao', 'horario_padrao_medicacao'] as const;

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
      'SELECT id, doses_por_dia FROM frequencia_administracao WHERE id = ? AND ativo',
      [e.frequencia],
    );
    if (!f)
      throw recusa('referencia-inexistente', 'Escolha uma frequência ativa.', { campos: ['frequencia'] });
    await conferirDoEstabelecimento(tx, est, 'setor_funcional', e.setor, 'setor');
    recusarTodas(conferirHorariosPadrao(e.horarios, idOuNulo(f['doses_por_dia'])));
    const atuais = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, ordem_dose, TIME_FORMAT(horario, '%H:%i') AS hora, dias_semana, ativo
         FROM horario_padrao_medicacao
        WHERE estabelecimento_id = ? AND frequencia_administracao_id = ? AND setor_funcional_id <=> ?
        ORDER BY ordem_dose`,
      [est, e.frequencia, e.setor],
    );
    const porOrdem = new Map(atuais.map((r) => [n(r['ordem_dose']), r]));
    let incluidos = 0;
    let alterados = 0;
    let inativados = 0;
    for (const [i, h] of e.horarios.entries()) {
      const ordem = i + 1;
      const dias = diasParaTexto(h.dias);
      const r = porOrdem.get(ordem);
      if (!r) {
        await tx.incluir('horario_padrao_medicacao', {
          estabelecimento_id: est,
          frequencia_administracao_id: e.frequencia,
          setor_funcional_id: e.setor,
          ordem_dose: ordem,
          horario: `${h.hora}:00`,
          dias_semana: dias,
          ativo: true,
        });
        incluidos += 1;
      } else if (
        texto(r['hora']) !== h.hora ||
        diasParaTexto(diasDoTexto(r['dias_semana'] === null ? null : texto(r['dias_semana']))) !== dias ||
        !verdadeiro(r['ativo'])
      ) {
        await tx.alterar('horario_padrao_medicacao', n(r['id']), n(r['versao']), {
          horario: `${h.hora}:00`,
          dias_semana: dias,
          ativo: true,
        });
        alterados += 1;
      }
    }
    for (const r of atuais)
      if (n(r['ordem_dose']) > e.horarios.length && verdadeiro(r['ativo'])) {
        await tx.alterar('horario_padrao_medicacao', n(r['id']), n(r['versao']), { ativo: false });
        inativados += 1;
      }
    extras.alvo = { tabela: 'horario_padrao_medicacao', id: null };
    extras.eventos.push({
      tipo: 'farmacia.horarios_padrao.gravados',
      carga: { frequencia: e.frequencia, setor: e.setor, horarios: e.horarios.length },
    });
    return { frequencia: e.frequencia, incluidos, alterados, inativados };
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
  const horarios = await l.consultar<Linha>(
    `SELECT h.frequencia_administracao_id, h.setor_funcional_id, TIME_FORMAT(h.horario, '%H:%i') AS hora,
            h.dias_semana, f.descricao AS frequencia_nome, f.doses_por_dia, sf.nome AS setor_nome
       FROM horario_padrao_medicacao h
       JOIN frequencia_administracao f ON f.id = h.frequencia_administracao_id
       LEFT JOIN setor_funcional sf ON sf.id = h.setor_funcional_id
      WHERE h.estabelecimento_id = ? AND h.ativo
      ORDER BY f.descricao, sf.nome, h.ordem_dose LIMIT 2000`,
    [est],
  );
  const grades = new Map<string, GradeHorarioPadrao & { horarios: { hora: string; dias: number[] }[] }>();
  for (const h of horarios) {
    const k = `${n(h['frequencia_administracao_id'])}|${texto(h['setor_funcional_id'])}`;
    let g = grades.get(k);
    if (!g) {
      g = {
        frequencia: n(h['frequencia_administracao_id']),
        frequenciaNome: texto(h['frequencia_nome']),
        dosesPorDia: idOuNulo(h['doses_por_dia']),
        setor: idOuNulo(h['setor_funcional_id']),
        setorNome: h['setor_nome'] === null || h['setor_nome'] === undefined ? null : texto(h['setor_nome']),
        horarios: [],
      };
      grades.set(k, g);
    }
    g.horarios.push({
      hora: texto(h['hora']),
      dias: diasDoTexto(h['dias_semana'] === null ? null : texto(h['dias_semana'])),
    });
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
      frequencias: await opcoes(
        'SELECT id, descricao AS nome, doses_por_dia AS doses FROM frequencia_administracao WHERE ativo ORDER BY descricao',
      ),
    },
  };
}
