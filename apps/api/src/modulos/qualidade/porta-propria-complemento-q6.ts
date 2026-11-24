// Complemento Q6 da porta PRÓPRIA da gestão da qualidade (F3.9-Q2): as três gravações que ainda recusavam no ramo
// próprio, com o mesmo contrato da porta de memória e as leituras dos complementos Q2 e Q5 (que já leem o que aqui se
// grava).
// - registrarAnaliseIndicador: a análise crítica do indicador na competência. O indicador do catálogo do sistema entra
//   no banco na primeira análise (indicador, grupo e a ficha técnica em indicador_versao, pela ficha que a API calculou);
//   a apuração da competência (apuracao_indicador, sem recorte) guarda o valor, a meta e a situação apurados no
//   registro, fechada pela pessoa que analisou; a análise (analise_critica_indicador) guarda o texto, as causas e o plano
//   em texto, e o plano com responsável e prazo vira plano_acao_qualidade de origem `indicador`, que a leitura do Q2 lê.
//   Uma análise por indicador e competência (a segunda recusa `analise-ja-registrada`); a alteração confere a versão,
//   reapura o valor e guarda a análise anterior inteira na trilha da operação (dados.analiseAnterior). O plano retirado
//   da análise fica cancelado (nunca apagado).
// - registrarAuditoria: auditoria_interna concluída, com o número do ano (AUD-AAAA-NNNNNN), a área no setor funcional do
//   estabelecimento (como risco e não conformidade: inexistente ou ambígua recusa), o referencial na categoria
//   (catálogo do sistema; entra no banco no primeiro uso), quem registrou como auditor líder (auditoria_interna_auditor)
//   e os demais auditores em texto, o checklist em auditoria_interna_item (requisito, seção, resultado, evidência; o item
//   fora de "conforme" leva a evidência como justificativa, pelo CHECK), as contagens e o percentual de conformidade.
// - alterarAuditoria: a auditoria não cancelada, na versão vista; a linha anterior e o checklist anterior vão a
//   anotacao.dados.versaoAnterior (ação `correcao`, que `versoes` lê); o checklist novo reescreve os itens pela
//   sequência (os que sobram saem com excluido_em, nunca apagados).
// Ligação: a porta completa espalha gravacoesComplementoQ6(tx, est, anotacao) no gravador e soma
// TABELAS_COMPLEMENTO_Q6 às tabelas dela.
import { recusa, type TxOperacao } from '@sgh/nucleo';
import { rotuloReferencialAuditoria, type FichaIndicadorQualidade } from '@sgh/contratos';
import type { AnotacaoGravacao } from '../enfermagem/gravacao-direta.js';
import { cobra, exigirUsuario, instante, type Linha, n, paraBanco, texto, textoN } from './apoio-propria.js';
import type { GravadorGestao } from './porta-gestao.js';
import { numeroDoAno, responsavelPeloNome, setorDaArea } from './porta-gestao-propria.js';
import { type AnaliseIndicadorNova, recusaVersaoGestao } from './tipos.js';

/** As tabelas que as gravações deste complemento escrevem (somadas às da porta completa). */
export const TABELAS_COMPLEMENTO_Q6 = [
  'grupo_indicador',
  'indicador',
  'indicador_versao',
  'apuracao_indicador',
  'analise_critica_indicador',
  'plano_acao_qualidade',
  'categoria_auditoria_interna',
  'auditoria_interna',
  'auditoria_interna_item',
  'auditoria_interna_auditor',
  'sequencia_negocio',
] as const;

// ── Regras puras (testadas em porta-propria-complemento-q6.spec.ts) ─────────────────────────────────────────────

/**
 * O plano de ação com dono da análise: responsável e prazo andam juntos (o plano no banco exige os dois). Só o texto do
 * plano, sem responsável nem prazo, fica na análise (ação proposta) e não abre plano; um sem o outro recusa.
 */
export function planoComDono(a: {
  readonly responsavel: string | null;
  readonly prazo: string | null;
}): { readonly responsavel: string; readonly prazo: string } | null {
  const r = a.responsavel?.trim() || null;
  if (r === null && a.prazo === null) return null;
  if (r === null || a.prazo === null)
    throw recusa(
      'plano-incompleto',
      'O plano de ação da análise precisa do responsável e do prazo juntos (ou de nenhum dos dois).',
    );
  return { responsavel: r, prazo: a.prazo };
}

/** Conformes mais metade dos parciais sobre os avaliados (o não aplicável fica fora), em 4 casas; nulo sem avaliado. */
export function percentualConformidade(c: {
  readonly conformes: number;
  readonly parciais: number;
  readonly naoConformes: number;
}): number | null {
  const avaliados = c.conformes + c.parciais + c.naoConformes;
  if (avaliados <= 0) return null;
  return Math.round(((c.conformes + 0.5 * c.parciais) / avaliados) * 100 * 10_000) / 10_000;
}

const RESULTADO_BANCO: Readonly<Record<string, string>> = {
  conforme: 'conforme',
  parcial: 'parcial',
  naoConforme: 'nao_conforme',
  naoAplicavel: 'nao_se_aplica',
};

export interface ItemAuditoriaBanco {
  readonly sequencia: number;
  readonly pergunta: string;
  readonly secao: string | null;
  readonly resultado: string;
  readonly evidencia: string | null;
  readonly justificativa: string | null;
  readonly exigeAcao: boolean;
}

/** O checklist do contrato (JSON) nas linhas do banco, na ordem da tela; item ou resultado fora do contrato recusa. */
export function itensDoChecklist(json: string): ItemAuditoriaBanco[] {
  let lista: unknown;
  try {
    lista = JSON.parse(json);
  } catch {
    lista = null;
  }
  if (!Array.isArray(lista) || lista.length === 0)
    throw recusa('checklist-invalido', 'O checklist da auditoria veio vazio ou ilegível.');
  return lista.map((x: Record<string, unknown>, i) => {
    const resultado = RESULTADO_BANCO[texto(x?.['resultado'])];
    const pergunta = texto(x?.['requisito']).trim();
    if (!resultado || pergunta.length < 3)
      throw recusa('checklist-invalido', `O item ${i + 1} do checklist está incompleto.`);
    const evidencia = textoN(texto(x['evidencia']).trim());
    return {
      sequencia: i + 1,
      pergunta,
      secao: textoN(texto(x['secao']).trim()),
      resultado,
      evidencia,
      // O item fora de "conforme" leva o porquê (CHECK ck_auditoria_interna_item_justificativa): a evidência do achado,
      // ou, no não aplicável sem evidência, a própria marcação.
      justificativa:
        resultado === 'conforme'
          ? null
          : (evidencia ?? (resultado === 'nao_se_aplica' ? 'Não se aplica ao escopo da auditoria.' : null)),
      exigeAcao: resultado === 'nao_conforme' || resultado === 'parcial',
    };
  });
}

const UNIDADE_BANCO: Readonly<Record<FichaIndicadorQualidade['unidade'], string>> = {
  percentual: 'percentual',
  dias: 'dias',
  razao: 'razao',
  quantidade: 'quantidade',
  densidade: 'taxa_por_mil',
  minutos: 'minutos',
};

const GRUPO_DA_ORIGEM: Readonly<Record<FichaIndicadorQualidade['origem'], string>> = {
  censo: 'Censo hospitalar',
  qualidade: 'Controle de infecção',
  seguranca: 'Segurança do paciente',
  linhaCuidado: 'Linhas de cuidado',
  higienizacao: 'Higienização',
  atendimento: 'Pronto atendimento',
};

/** A situação da meta do contrato no vocabulário do banco (CHECK ck_analise_critica_indicador_resultado_periodo). */
export const resultadoDoPeriodo = (s: AnaliseIndicadorNova['situacaoMeta']): string => s.replace(/-/g, '_');

// ── Apoio da gravação ────────────────────────────────────────────────────────────────────────────────────────

/** A linha como estava (datas no formato local), para a versão anterior na trilha. */
function retrato(r: Linha): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? instante(v) : v]));
}

const competenciaBanco = (c: string): string => `${c.slice(0, 7)}-01`;
function fimDaCompetencia(c: string): string {
  const [a, m] = c.slice(0, 7).split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${c.slice(0, 7)}-${String(ultimo).padStart(2, '0')}`;
}

/** Busca no catálogo pelo código; sem a linha, inclui (o catálogo do sistema entra no banco no primeiro uso). */
async function garantirCatalogo(
  tx: TxOperacao,
  tabela: 'grupo_indicador' | 'categoria_auditoria_interna',
  codigo: string,
  descricao: string,
): Promise<number> {
  const r = await tx.uma<{ id: number }>(`SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo]);
  return r ? n(r.id) : tx.incluir(tabela, { codigo, descricao });
}

/** O indicador do catálogo pelo código, com a ficha técnica vigente; sem ele, inclui pela ficha que a API calculou. */
async function indicadorDoCatalogo(
  tx: TxOperacao,
  a: AnaliseIndicadorNova,
  usuario: number,
): Promise<{ id: number; versao: number }> {
  const atual = await tx.uma<Linha>(
    `SELECT i.id, (SELECT v.id FROM indicador_versao v WHERE v.indicador_id = i.id
                    ORDER BY v.numero_versao DESC LIMIT 1) AS versao_id
       FROM indicador i WHERE i.codigo = ? AND i.excluido_em IS NULL`,
    [a.indicador],
  );
  if (atual && atual['versao_id'] !== null) return { id: n(atual['id']), versao: n(atual['versao_id']) };
  const f = a.ficha;
  if (!f || f.codigo !== a.indicador)
    throw recusa('indicador-inexistente', 'O indicador não está no catálogo deste cliente.');
  const id = atual
    ? n(atual['id'])
    : await tx.incluir('indicador', {
        codigo: f.codigo,
        nome: f.nome,
        definicao: f.referencia || null,
        grupo_indicador_id: await garantirCatalogo(
          tx,
          'grupo_indicador',
          cobra(f.origem),
          GRUPO_DA_ORIGEM[f.origem],
        ),
        unidade: UNIDADE_BANCO[f.unidade],
        polaridade: f.polaridade.replace(/-/g, '_'),
        periodicidade: f.periodicidade,
        regulatorio: f.programas.includes('pmQualiss'),
      });
  const versao = await tx.incluir('indicador_versao', {
    indicador_id: id,
    numero_versao: 1,
    operacao: 'inclusao',
    dados: JSON.stringify(f),
    ocorrido_em: paraBanco(a.agora),
    usuario_id: usuario,
    formula: f.formula,
    numerador_descricao: f.numerador,
    denominador_descricao: f.denominador,
    multiplicador: f.fator,
    fonte_dados: f.fonte,
    vigencia_inicio: competenciaBanco(a.competencia),
  });
  return { id, versao };
}

/** Os valores apurados no registro (a apuração da competência, sem recorte, fechada por quem analisou). */
function valoresApurados(a: AnaliseIndicadorNova, usuario: number) {
  return {
    numerador: a.numerador,
    denominador: a.denominador,
    valor: a.valor,
    valor_meta: a.meta,
    situacao_meta: a.valor === null ? 'sem_valor' : resultadoDoPeriodo(a.situacaoMeta),
    situacao: 'fechada',
    fechada_em: paraBanco(a.agora),
    fechada_por_usuario_id: usuario,
  };
}

/** A apuração da competência travada (inclui na primeira análise); a do recorte por unidade fica fora. */
async function apuracaoDaCompetencia(
  tx: TxOperacao,
  est: number,
  indicador: { id: number; versao: number },
  a: AnaliseIndicadorNova,
  usuario: number,
): Promise<number> {
  const [ap] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, excluido_em FROM apuracao_indicador
      WHERE estabelecimento_id = ? AND indicador_id = ? AND competencia = ? AND escopo_chave = '0-0'`,
    [est, indicador.id, competenciaBanco(a.competencia)],
    { teto: 1 },
  );
  if (ap && ap['excluido_em'] !== null)
    throw recusa('apuracao-excluida', 'A apuração desta competência foi excluída: não recebe análise.');
  if (ap) {
    await tx.alterar('apuracao_indicador', n(ap['id']), n(ap['versao']), valoresApurados(a, usuario));
    return n(ap['id']);
  }
  return tx.incluir('apuracao_indicador', {
    estabelecimento_id: est,
    indicador_id: indicador.id,
    indicador_versao_id: indicador.versao,
    competencia: competenciaBanco(a.competencia),
    periodo_inicio: competenciaBanco(a.competencia),
    periodo_fim: fimDaCompetencia(a.competencia),
    forma_insercao: 'carga',
    ...valoresApurados(a, usuario),
  });
}

/** Inclui, altera ou cancela o plano de ação com dono da análise; devolve o id do plano que fica ligado. */
async function planoDaAnalise(
  tx: TxOperacao,
  est: number,
  a: AnaliseIndicadorNova,
  indicador: number,
  atual: number | null,
): Promise<number | null> {
  const dono = planoComDono(a);
  const linhaAtual = atual
    ? await tx.uma<Linha>(
        'SELECT id, versao, responsavel_usuario_id FROM plano_acao_qualidade WHERE id = ?',
        [atual],
      )
    : null;
  if (!dono) {
    if (linhaAtual)
      await tx.alterar('plano_acao_qualidade', atual!, n(linhaAtual['versao']), { situacao: 'cancelado' });
    return null;
  }
  const responsavel = await responsavelPeloNome(
    tx,
    dono.responsavel,
    linhaAtual ? n(linhaAtual['responsavel_usuario_id']) : null,
  );
  const dados = {
    descricao: a.plano,
    responsavel_usuario_id: responsavel,
    prazo: dono.prazo,
    situacao: 'planejado',
  };
  if (linhaAtual) {
    await tx.alterar('plano_acao_qualidade', atual!, n(linhaAtual['versao']), dados);
    return atual;
  }
  return tx.incluir('plano_acao_qualidade', {
    estabelecimento_id: est,
    numero: await numeroDoAno(tx, est, 'plano_acao_qualidade', 'PA', a.agora),
    titulo: `Plano de ação da análise do indicador ${a.indicador} (${a.competencia.slice(0, 7)})`,
    tipo_origem: 'indicador',
    indicador_id: indicador,
    ...dados,
  });
}

/** Reescreve o checklist pela sequência: atualiza a linha que existe (até a excluída volta), inclui a nova e exclui a sobra. */
async function gravarChecklist(
  tx: TxOperacao,
  auditoria: number,
  itens: readonly ItemAuditoriaBanco[],
  usuario: number,
  agora: string,
): Promise<void> {
  const atuais = await tx.consultar(
    'SELECT id, versao, sequencia, excluido_em FROM auditoria_interna_item WHERE auditoria_interna_id = ?',
    [auditoria],
    { teto: 1000 },
  );
  const porSequencia = new Map(atuais.map((r) => [n(r['sequencia']), r]));
  for (const i of itens) {
    const dados = {
      pergunta: i.pergunta,
      secao: i.secao,
      resultado: i.resultado,
      evidencia: i.evidencia,
      justificativa: i.justificativa,
      exige_acao: i.exigeAcao,
      respondido_em: paraBanco(agora),
      respondente_usuario_id: usuario,
    };
    const r = porSequencia.get(i.sequencia);
    if (r)
      await tx.alterar('auditoria_interna_item', n(r['id']), n(r['versao']), {
        ...dados,
        excluido_em: null,
        excluido_por: null,
      });
    else
      await tx.incluir('auditoria_interna_item', {
        auditoria_interna_id: auditoria,
        sequencia: i.sequencia,
        ...dados,
      });
  }
  for (const r of atuais)
    if (n(r['sequencia']) > itens.length && r['excluido_em'] === null)
      await tx.alterar('auditoria_interna_item', n(r['id']), n(r['versao']), {
        excluido_em: paraBanco(agora),
        excluido_por: usuario,
      });
}

type GravacoesQ6 = Pick<
  GravadorGestao,
  'registrarAnaliseIndicador' | 'registrarAuditoria' | 'alterarAuditoria'
>;

/** As gravações do Q6 dentro da transação da gestão (a recusa desfaz tudo). */
export function gravacoesComplementoQ6(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao = { motivo: null, dados: null },
): GravacoesQ6 {
  return {
    registrarAnaliseIndicador: async (a) => {
      const x = a as AnaliseIndicadorNova;
      const usuario = await exigirUsuario(tx, x.usuario);
      planoComDono(x);
      const analise = {
        resultado_periodo: resultadoDoPeriodo(x.situacaoMeta),
        analise: x.texto,
        causa: x.causas,
        acao_proposta: x.plano,
        situacao: 'concluida',
      };
      if (x.id === null) {
        const indicador = await indicadorDoCatalogo(tx, x, usuario);
        const apuracao = await apuracaoDaCompetencia(tx, est, indicador, x, usuario);
        const ja = await tx.uma(
          'SELECT id FROM analise_critica_indicador WHERE apuracao_indicador_id = ? AND excluido_em IS NULL LIMIT 1',
          [apuracao],
        );
        if (ja)
          throw recusa(
            'analise-ja-registrada',
            'Outra pessoa registrou a análise deste indicador nesta competência: recarregue e altere a registrada.',
          );
        const seq = await tx.uma<{ s: number }>(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM analise_critica_indicador WHERE apuracao_indicador_id = ?',
          [apuracao],
        );
        const id = await tx.incluir('analise_critica_indicador', {
          apuracao_indicador_id: apuracao,
          sequencia: n(seq?.s ?? 1),
          responsavel_usuario_id: usuario,
          analisado_em: paraBanco(x.agora),
          plano_acao_qualidade_id: await planoDaAnalise(tx, est, x, indicador.id, null),
          ...analise,
        });
        return { id, versao: 1, criada: true };
      }
      const [antes] = await tx.consultarParaAtualizar<Linha>(
        `SELECT a.*, ap.indicador_id AS ap_indicador_id, i.codigo AS ap_indicador_codigo,
                DATE_FORMAT(ap.competencia, '%Y-%m') AS ap_competencia
           FROM analise_critica_indicador a
           JOIN apuracao_indicador ap ON ap.id = a.apuracao_indicador_id
           JOIN indicador i ON i.id = ap.indicador_id
          WHERE a.id = ? AND ap.estabelecimento_id = ? AND a.excluido_em IS NULL AND ap.excluido_em IS NULL`,
        [x.id, est],
        { teto: 1 },
      );
      if (
        !antes ||
        n(antes['versao']) !== x.versao ||
        texto(antes['ap_indicador_codigo']) !== x.indicador ||
        texto(antes['ap_competencia']) !== x.competencia.slice(0, 7)
      )
        throw recusaVersaoGestao('A análise');
      const apuracao = await tx.uma<Linha>('SELECT id, versao FROM apuracao_indicador WHERE id = ?', [
        n(antes['apuracao_indicador_id']),
      ]);
      await tx.alterar(
        'apuracao_indicador',
        n(apuracao?.['id']),
        n(apuracao?.['versao']),
        valoresApurados(x, usuario),
      );
      const plano = await planoDaAnalise(
        tx,
        est,
        x,
        n(antes['ap_indicador_id']),
        antes['plano_acao_qualidade_id'] === null ? null : n(antes['plano_acao_qualidade_id']),
      );
      const versao = await tx.alterar('analise_critica_indicador', x.id, x.versao!, {
        ...analise,
        plano_acao_qualidade_id: plano,
      });
      anotacao.dados = { ...(anotacao.dados ?? {}), analiseAnterior: retrato(antes) };
      return { id: x.id, versao, criada: false };
    },

    registrarAuditoria: async (a) => {
      const usuario = await exigirUsuario(tx, a.usuario);
      const itens = itensDoChecklist(a.itens);
      const setor = await setorDaArea(tx, est, a.area);
      const categoria = await garantirCatalogo(
        tx,
        'categoria_auditoria_interna',
        cobra(a.referencial),
        rotuloReferencialAuditoria(a.referencial as Parameters<typeof rotuloReferencialAuditoria>[0]),
      );
      const id = await tx.incluir('auditoria_interna', {
        estabelecimento_id: est,
        numero: await numeroDoAno(tx, est, 'auditoria_interna', 'AUD', a.agora),
        titulo: a.titulo,
        categoria_auditoria_interna_id: categoria,
        setor_funcional_id: setor,
        inicio_previsto: a.realizadaEm,
        fim_previsto: a.realizadaEm,
        inicio_realizado: a.realizadaEm,
        fim_realizado: a.realizadaEm,
        auditor_lider_usuario_id: usuario,
        auditores_descricao: a.auditores,
        situacao: 'concluida',
        itens_conformes: a.conformes,
        itens_parciais: a.parciais,
        itens_nao_conformes: a.naoConformes,
        itens_nao_aplicaveis: a.naoAplicaveis,
        percentual_conformidade: percentualConformidade(a),
        fechada_em: paraBanco(a.agora),
        fechamento: a.conclusao,
      });
      await tx.incluir('auditoria_interna_auditor', {
        auditoria_interna_id: id,
        usuario_id: usuario,
        papel: 'auditor_lider',
      });
      await gravarChecklist(tx, id, itens, usuario, a.agora);
      return { id };
    },

    alterarAuditoria: async (a) => {
      const [antes] = await tx.consultarParaAtualizar<Linha>(
        'SELECT * FROM auditoria_interna WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [a.id, est],
        { teto: 1 },
      );
      if (!antes || n(antes['versao']) !== a.versao || texto(antes['situacao']) === 'cancelada')
        throw recusaVersaoGestao('A auditoria');
      const usuario = await exigirUsuario(tx, a.usuario);
      const itens = itensDoChecklist(a.itens);
      const setorAtual = antes['setor_funcional_id'] === null ? null : n(antes['setor_funcional_id']);
      const setor = await setorDaArea(tx, est, a.area, setorAtual);
      const checklistAnterior = await tx.consultar(
        `SELECT sequencia, pergunta, secao, resultado, evidencia, justificativa FROM auditoria_interna_item
          WHERE auditoria_interna_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [a.id],
        { teto: 1000 },
      );
      const versao = await tx.alterar('auditoria_interna', a.id, a.versao, {
        titulo: a.titulo,
        setor_funcional_id: setor,
        inicio_previsto: a.realizadaEm,
        fim_previsto: a.realizadaEm,
        inicio_realizado: a.realizadaEm,
        fim_realizado: a.realizadaEm,
        auditores_descricao: a.auditores,
        itens_conformes: a.contagens.conformes,
        itens_parciais: a.contagens.parciais,
        itens_nao_conformes: a.contagens.naoConformes,
        itens_nao_aplicaveis: a.contagens.naoAplicaveis,
        percentual_conformidade: percentualConformidade(a.contagens),
        fechamento: a.conclusao,
      });
      await gravarChecklist(tx, a.id, itens, usuario, a.agora);
      anotacao.motivo = a.justificativa;
      anotacao.dados = {
        ...(anotacao.dados ?? {}),
        versaoAnterior: {
          tabela: 'auditoria_interna',
          id: a.id,
          versao: a.versao,
          acao: 'correcao',
          motivo: a.justificativa,
          dados: { ...retrato(antes), checklist: checklistAnterior.map(retrato) },
        },
      };
      return { versao };
    },
  };
}
