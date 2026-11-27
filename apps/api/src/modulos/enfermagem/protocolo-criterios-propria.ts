// C2-042 (03-PEP L134): os critérios de entrada e as etapas com meta dos protocolos gerenciados, no banco PRÓPRIO:
//   - protocolo_gerenciado_criterio: incluir (o tipo do critério em tipo_criterio_clinico pela categoria) e inativar
//     com o motivo na trilha (nunca apagar); a fórmula de entrada em protocolo_gerenciado.formula_entrada;
//   - protocolo_gerenciado_etapa: incluir e ajustar a meta; o modelo de mercado (sepse, dor torácica, AVC) aplicado ao
//     protocolo sem duplicar o que já existe;
//   - o alerta de paciente elegível: os atendimentos abertos do estabelecimento com dado clínico nas últimas 24 h
//     (aferição, escala, diagnóstico) avaliados contra os protocolos ativos, sem o protocolo aberto;
//   - inclusao_protocolo_etapa: as etapas da inclusão com o prazo de cada meta a partir do horário zero, e o retrato
//     dos critérios avaliados em inclusao_protocolo_criterio; a conclusão (meta atingida ou perdida, com justificativa)
//     e o cancelamento da etapa opcional com motivo.
// As regras são do domínio (criterios-etapas); aqui só a leitura, a trava e a gravação, dentro da operação do Executor
// (trilha e idempotência na mesma transação).
import {
  alertasDeElegiveis,
  avaliarEntrada,
  type AlertaElegivel,
  type CandidatoAvaliado,
  type CategoriaCriterio,
  type CriterioEntrada,
  type CriterioProtocolo,
  type EtapaEntrada,
  type EtapaProtocolo,
  type FatoClinico,
  formulaPadrao,
  grupoDoCriterio,
  idadeEmDias,
  MENSAGENS_CRITERIO,
  MENSAGENS_ETAPA,
  MODELOS_PROTOCOLO,
  type PacienteAvaliado,
  planoDasEtapas,
  problemaDaConclusao,
  problemaDaEtapa,
  problemaDaFormula,
  problemaDoCancelamento,
  problemasDoCriterio,
  type ProtocoloParaAvaliar,
  type PublicoProtocolo,
  relogioDaEtapa,
  type SituacaoEtapa,
  situacaoAoConcluir,
  situacaoAoSairDoProtocolo,
  somarMinutos,
} from '@sgh/dominio-enfermagem';
import { type Escritor, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import {
  booleano,
  civilDe,
  dataDe,
  fusoDe,
  instanteDe,
  type Linha,
  marcadores,
  num,
  numOuNulo,
  texto,
  textoOuNulo,
} from './banco-apoio.js';
import type { AnotacaoGravacao } from './gravacao-direta.js';

export const TABELAS_CONFIG_PROTOCOLO = [
  'protocolo_gerenciado',
  'protocolo_gerenciado_criterio',
  'protocolo_gerenciado_etapa',
  'tipo_criterio_clinico',
] as const;
export const TABELAS_ETAPAS_INCLUSAO = ['inclusao_protocolo_etapa', 'inclusao_protocolo_criterio'] as const;

const T_PROTOCOLO = 'protocolo_gerenciado';
const T_CRITERIO = 'protocolo_gerenciado_criterio';
const T_ETAPA = 'protocolo_gerenciado_etapa';
const T_TIPO = 'tipo_criterio_clinico';
const T_INC_ETAPA = 'inclusao_protocolo_etapa';
const T_INC_CRITERIO = 'inclusao_protocolo_criterio';

const decimal = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const civil16 = (v: unknown, fuso: string): string | null => civilDe(v, fuso)?.slice(0, 16) ?? null;

// ---------------------------------------------------------------- leitura da definição

export interface ProtocoloResumo {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: string;
  readonly situacao: string;
  readonly publico: PublicoProtocolo;
  readonly formula: string | null;
  readonly mensagem: string | null;
  readonly versao: number;
  readonly temModelo: boolean;
}

export interface CriterioLido extends CriterioProtocolo {
  readonly versao: number;
}
export interface EtapaLida extends EtapaProtocolo {
  readonly versao: number;
}
export interface DefinicaoProtocolo {
  readonly protocolo: ProtocoloResumo;
  readonly criterios: readonly CriterioLido[];
  readonly etapas: readonly EtapaLida[];
  /** A fórmula que vale (a gravada ou a padrão) e o problema dela, se houver. */
  readonly formulaVigente: string;
  readonly problemaFormula: string | null;
  /** Os parâmetros vitais ativos do cliente: as opções do campo do critério de sinal vital (o código é o gravado). */
  readonly sinaisVitais: readonly { readonly codigo: string; readonly descricao: string }[];
}

const SQL_PROTOCOLO = `SELECT id, codigo, nome, tipo, situacao, publico, formula_entrada, mensagem_alerta, versao
  FROM protocolo_gerenciado WHERE excluido_em IS NULL AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`;

const protocoloDe = (r: Linha): ProtocoloResumo => ({
  id: num(r['id']),
  codigo: texto(r['codigo']),
  nome: texto(r['nome']),
  tipo: texto(r['tipo']),
  situacao: texto(r['situacao']),
  publico: texto(r['publico']) as PublicoProtocolo,
  formula: textoOuNulo(r['formula_entrada']),
  mensagem: textoOuNulo(r['mensagem_alerta']),
  versao: num(r['versao']),
  temModelo: MODELOS_PROTOCOLO[texto(r['tipo'])] !== undefined,
});

export async function protocolosGerenciados(l: Leitor, est: number): Promise<ProtocoloResumo[]> {
  const rs = await l.consultar(`${SQL_PROTOCOLO} ORDER BY ordem, nome`, [est]);
  return rs.map(protocoloDe);
}

const SQL_CRITERIOS = `SELECT c.*, t.categoria FROM protocolo_gerenciado_criterio c
  JOIN tipo_criterio_clinico t ON t.id = c.tipo_criterio_clinico_id
 WHERE c.excluido_em IS NULL AND c.protocolo_gerenciado_id IN`;

const criterioDe = (r: Linha): CriterioLido => ({
  id: num(r['id']),
  sequencia: num(r['sequencia']),
  finalidade: texto(r['finalidade']) as CriterioProtocolo['finalidade'],
  grupo: textoOuNulo(r['grupo']),
  categoria: texto(r['categoria']) as CategoriaCriterio,
  campo: textoOuNulo(r['campo']),
  termo: numOuNulo(r['termo_terminologia_id']),
  valorTexto: textoOuNulo(r['valor_texto']),
  valorMinimo: decimal(r['valor_minimo']),
  valorMaximo: decimal(r['valor_maximo']),
  sexo: texto(r['sexo']) as CriterioProtocolo['sexo'],
  idadeMinimaDias: numOuNulo(r['idade_minima_dias']),
  idadeMaximaDias: numOuNulo(r['idade_maxima_dias']),
  validadeHoras: numOuNulo(r['validade_horas']),
  descricao: textoOuNulo(r['descricao_exibicao']),
  ativo: booleano(r['ativo']),
  versao: num(r['versao']),
});

const etapaDe = (r: Linha): EtapaLida => ({
  id: num(r['id']),
  sequencia: num(r['sequencia']),
  nome: texto(r['nome']),
  tipo: texto(r['tipo']) as EtapaProtocolo['tipo'],
  metaMinutos: numOuNulo(r['meta_minutos']),
  faixaEtaria: texto(r['faixa_etaria']) as EtapaProtocolo['faixaEtaria'],
  obrigatoria: booleano(r['obrigatoria']),
  versao: num(r['versao']),
});

async function criteriosDe(l: Leitor, ids: readonly number[]): Promise<Map<number, CriterioLido[]>> {
  const m = new Map<number, CriterioLido[]>();
  if (ids.length === 0) return m;
  const rs = await l.consultar(`${SQL_CRITERIOS} (${marcadores(ids.length)}) ORDER BY c.sequencia`, [...ids]);
  for (const r of rs) {
    const k = num(r['protocolo_gerenciado_id']);
    m.set(k, [...(m.get(k) ?? []), criterioDe(r)]);
  }
  return m;
}

async function etapasDe(l: Leitor, protocolo: number): Promise<EtapaLida[]> {
  const rs = await l.consultar(
    'SELECT * FROM protocolo_gerenciado_etapa WHERE protocolo_gerenciado_id = ? AND excluido_em IS NULL ORDER BY sequencia',
    [protocolo],
  );
  return rs.map(etapaDe);
}

async function protocoloDoEstabelecimento(l: Leitor, est: number, id: number): Promise<ProtocoloResumo> {
  const r = await l.uma(`${SQL_PROTOCOLO} AND id = ?`, [est, id]);
  if (!r) throw recusa('protocolo-inexistente', 'O protocolo gerenciado não existe neste estabelecimento.');
  return protocoloDe(r);
}

export async function definicaoProtocolo(l: Leitor, est: number, id: number): Promise<DefinicaoProtocolo> {
  const protocolo = await protocoloDoEstabelecimento(l, est, id);
  const criterios = (await criteriosDe(l, [id])).get(id) ?? [];
  const [etapas, sinais] = await Promise.all([
    etapasDe(l, id),
    l.consultar<{ codigo: unknown; descricao: unknown }>(
      'SELECT codigo, descricao FROM parametro_vital WHERE ativo ORDER BY descricao, codigo',
      [],
    ),
  ]);
  const grupos = criterios.filter((c) => c.ativo && c.finalidade === 'entrada').map(grupoDoCriterio);
  const formulaVigente = protocolo.formula?.trim() || formulaPadrao(grupos);
  return {
    protocolo,
    criterios,
    etapas,
    formulaVigente,
    problemaFormula: grupos.length ? problemaDaFormula(formulaVigente, grupos) : null,
    sinaisVitais: sinais.map((r) => ({ codigo: String(r.codigo), descricao: String(r.descricao) })),
  };
}

// ---------------------------------------------------------------- configuração

export interface PedidoCriterio extends CriterioEntrada {
  readonly descricao: string | null;
}

/** O tipo do critério pela categoria (catálogo da base; criado na primeira vez que a categoria é usada). */
async function tipoDaCategoria(tx: TxOperacao, categoria: CategoriaCriterio): Promise<number> {
  const identificador = `protocolo.${categoria}`;
  const r = await tx.uma<{ id: unknown }>('SELECT id FROM tipo_criterio_clinico WHERE identificador = ?', [
    identificador,
  ]);
  if (r) return num(r.id);
  return tx.incluir(T_TIPO, {
    codigo: `protocolo_${categoria}`,
    descricao: `Protocolo gerenciado: ${categoria.replace('_', ' ')}`,
    ativo: true,
    categoria,
    identificador,
    valida_valor_unico: false,
    valida_faixa_valor: categoria !== 'diagnostico',
  });
}

async function travarProtocolo(tx: TxOperacao, est: number, id: number): Promise<Linha> {
  const [p] = await tx.consultarParaAtualizar(
    `SELECT id, tipo, versao, formula_entrada FROM protocolo_gerenciado WHERE id = ? AND excluido_em IS NULL
        AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
    [id, est],
  );
  if (!p) throw recusa('protocolo-inexistente', 'O protocolo gerenciado não existe neste estabelecimento.');
  return p;
}

async function proximaSequencia(tx: TxOperacao, tabela: 'criterio' | 'etapa', protocolo: number) {
  const sql =
    tabela === 'criterio'
      ? 'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM protocolo_gerenciado_criterio WHERE protocolo_gerenciado_id = ?'
      : 'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM protocolo_gerenciado_etapa WHERE protocolo_gerenciado_id = ?';
  const r = await tx.uma<{ n: unknown }>(sql, [protocolo]);
  return num(r?.n ?? 1);
}

async function incluirCriterioNoProtocolo(tx: TxOperacao, protocolo: number, e: PedidoCriterio) {
  const p = problemasDoCriterio(e)[0];
  if (p) throw recusa(p, MENSAGENS_CRITERIO[p]);
  if (e.categoria === 'sinal_vital') {
    const pv = await tx.uma('SELECT id FROM parametro_vital WHERE codigo = ? AND ativo', [e.campo]);
    if (!pv) throw recusa('sinal-inexistente', 'O sinal vital escolhido não está no cadastro.');
  }
  if (e.categoria === 'diagnostico') {
    const t = await tx.uma('SELECT id FROM termo_terminologia WHERE id = ?', [e.termo]);
    if (!t) throw recusa('diagnostico-inexistente', 'O diagnóstico escolhido não está na terminologia.');
  }
  const tipo = await tipoDaCategoria(tx, e.categoria);
  const sequencia = await proximaSequencia(tx, 'criterio', protocolo);
  return tx.incluir(T_CRITERIO, {
    protocolo_gerenciado_id: protocolo,
    sequencia,
    finalidade: e.finalidade,
    grupo: e.grupo,
    tipo_criterio_clinico_id: tipo,
    termo_terminologia_id: e.categoria === 'diagnostico' ? e.termo : null,
    campo: e.categoria === 'diagnostico' || e.categoria === 'idade' ? null : e.campo,
    valor_texto: e.valorTexto,
    valor_minimo: e.valorMinimo,
    valor_maximo: e.valorMaximo,
    sexo: e.sexo,
    idade_minima_dias: e.idadeMinimaDias,
    idade_maxima_dias: e.idadeMaximaDias,
    validade_horas: e.validadeHoras,
    descricao_exibicao: e.descricao,
    ativo: true,
  });
}

export async function incluirCriterioTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  protocolo: number,
  e: PedidoCriterio,
): Promise<{ id: number }> {
  await travarProtocolo(tx, est, protocolo);
  const id = await incluirCriterioNoProtocolo(tx, protocolo, e);
  an.dados = { protocolo, categoria: e.categoria, finalidade: e.finalidade, grupo: e.grupo };
  return { id };
}

export async function inativarCriterioTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  id: number,
  versao: number,
  motivo: string,
): Promise<{ id: number; versao: number }> {
  const c = await tx.uma<{ protocolo_gerenciado_id: unknown; ativo: unknown }>(
    'SELECT protocolo_gerenciado_id, ativo FROM protocolo_gerenciado_criterio WHERE id = ? AND excluido_em IS NULL',
    [id],
  );
  if (!c) throw recusa('criterio-inexistente', 'O critério não existe.');
  const p = await travarProtocolo(tx, est, num(c.protocolo_gerenciado_id));
  if (!booleano(c.ativo)) throw recusa('criterio-ja-inativo', 'O critério já está inativo.');
  const nova = await tx.alterar(T_CRITERIO, id, versao, { ativo: false });
  // A fórmula gravada não pode ficar apontando para um grupo sem critério ativo.
  const restantes = (await criteriosDe(tx, [num(p['id'])])).get(num(p['id'])) ?? [];
  const grupos = restantes.filter((x) => x.ativo && x.finalidade === 'entrada').map(grupoDoCriterio);
  const formula = textoOuNulo(p['formula_entrada']);
  if (formula && grupos.length && problemaDaFormula(formula, grupos) !== null)
    throw recusa(
      'formula-quebrada',
      'A fórmula de entrada usa o grupo deste critério: ajuste a fórmula antes de inativá-lo.',
    );
  an.motivo = motivo;
  an.dados = { protocolo: num(p['id']) };
  return { id, versao: nova };
}

export async function gravarFormulaTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  protocolo: number,
  versao: number,
  formula: string | null,
): Promise<{ id: number; versao: number }> {
  await travarProtocolo(tx, est, protocolo);
  const criterios = (await criteriosDe(tx, [protocolo])).get(protocolo) ?? [];
  const grupos = criterios.filter((x) => x.ativo && x.finalidade === 'entrada').map(grupoDoCriterio);
  const f = formula?.trim() || null;
  if (f !== null) {
    const problema = problemaDaFormula(f, grupos);
    if (problema) throw recusa('formula-invalida', problema);
  }
  const nova = await tx.alterar(T_PROTOCOLO, protocolo, versao, { formula_entrada: f });
  an.dados = { formula: f };
  return { id: protocolo, versao: nova };
}

async function incluirEtapaNoProtocolo(tx: TxOperacao, protocolo: number, e: EtapaEntrada) {
  const p = problemaDaEtapa(e);
  if (p) throw recusa('etapa-invalida', p);
  const sequencia = await proximaSequencia(tx, 'etapa', protocolo);
  return tx.incluir(T_ETAPA, {
    protocolo_gerenciado_id: protocolo,
    sequencia,
    nome: e.nome.trim(),
    tipo: e.tipo,
    meta_minutos: e.metaMinutos,
    faixa_etaria: e.faixaEtaria,
    obrigatoria: e.obrigatoria,
  });
}

export async function incluirEtapaTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  protocolo: number,
  e: EtapaEntrada,
): Promise<{ id: number }> {
  await travarProtocolo(tx, est, protocolo);
  const id = await incluirEtapaNoProtocolo(tx, protocolo, e);
  an.dados = { protocolo, meta: e.metaMinutos, obrigatoria: e.obrigatoria };
  return { id };
}

export async function ajustarMetaEtapaTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  id: number,
  e: { versao: number; metaMinutos: number | null; obrigatoria: boolean },
): Promise<{ id: number; versao: number }> {
  const r = await tx.uma('SELECT * FROM protocolo_gerenciado_etapa WHERE id = ? AND excluido_em IS NULL', [
    id,
  ]);
  if (!r) throw recusa('etapa-inexistente', 'A etapa não existe.');
  await travarProtocolo(tx, est, num(r['protocolo_gerenciado_id']));
  const atual = etapaDe(r);
  const p = problemaDaEtapa({ ...atual, metaMinutos: e.metaMinutos, obrigatoria: e.obrigatoria });
  if (p) throw recusa('etapa-invalida', p);
  // A meta nova vale para as próximas inclusões: as etapas já iniciadas guardam o prazo calculado na inclusão.
  const nova = await tx.alterar(T_ETAPA, id, e.versao, {
    meta_minutos: e.metaMinutos,
    obrigatoria: e.obrigatoria,
  });
  an.dados = { antes: atual.metaMinutos, depois: e.metaMinutos, obrigatoria: e.obrigatoria };
  return { id, versao: nova };
}

/** Aplica o modelo de mercado do tipo: inclui as etapas e os critérios que faltam (pelo nome e pela descrição). */
export async function aplicarModeloTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  protocolo: number,
): Promise<{ etapas: number; criterios: number; formula: boolean }> {
  const p = await travarProtocolo(tx, est, protocolo);
  const modelo = MODELOS_PROTOCOLO[texto(p['tipo'])];
  if (!modelo) throw recusa('sem-modelo', 'Não há modelo de mercado para este tipo de protocolo.');
  const etapas = await etapasDe(tx, protocolo);
  const criterios = (await criteriosDe(tx, [protocolo])).get(protocolo) ?? [];
  let ne = 0;
  for (const e of modelo.etapas)
    if (!etapas.some((x) => x.nome.toLowerCase() === e.nome.toLowerCase())) {
      await incluirEtapaNoProtocolo(tx, protocolo, e);
      ne++;
    }
  let nc = 0;
  for (const c of modelo.criterios)
    if (!criterios.some((x) => x.ativo && x.descricao === c.descricao)) {
      await incluirCriterioNoProtocolo(tx, protocolo, { ...c, finalidade: 'entrada' });
      nc++;
    }
  let formula = false;
  if (modelo.formula && !textoOuNulo(p['formula_entrada'])) {
    await tx.alterar(T_PROTOCOLO, protocolo, num(p['versao']), { formula_entrada: modelo.formula });
    formula = true;
  }
  an.dados = { tipo: texto(p['tipo']), etapas: ne, criterios: nc, formula };
  return { etapas: ne, criterios: nc, formula };
}

// ---------------------------------------------------------------- alerta de elegível

/** A janela do dado que põe o atendimento na avaliação (o alerta é do que está acontecendo). */
const JANELA_CANDIDATO_HORAS = 24;

interface Demografia {
  readonly dados: PacienteAvaliado;
  readonly paciente: number;
  readonly nome: string;
  readonly numero: string;
}

async function demografiaDe(l: Leitor, atendimentos: readonly number[], agora: string) {
  const m = new Map<number, Demografia>();
  if (atendimentos.length === 0) return m;
  const rs = await l.consultar(
    `SELECT a.id, a.numero, a.paciente_id, s.codigo AS sexo, pf.data_nascimento,
            CASE WHEN pf.usa_nome_social AND pf.nome_social IS NOT NULL THEN pf.nome_social ELSE pf.nome END AS nome
       FROM atendimento a JOIN paciente p ON p.id = a.paciente_id JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
       LEFT JOIN sexo s ON s.id = pf.sexo_id WHERE a.id IN (${marcadores(atendimentos.length)})`,
    [...atendimentos],
  );
  for (const r of rs) {
    const sexo = r['sexo'] === 'feminino' || r['sexo'] === 'masculino' ? r['sexo'] : null;
    m.set(num(r['id']), {
      paciente: num(r['paciente_id']),
      nome: texto(r['nome']),
      numero: texto(r['numero']),
      dados: { sexo, idadeDias: idadeEmDias(dataDe(r['data_nascimento']), agora) },
    });
  }
  return m;
}

/** Os fatos clínicos dos atendimentos: aferições e escalas da janela, diagnósticos ativos do atendimento. */
async function fatosDe(
  l: Leitor,
  atendimentos: readonly number[],
  desde: Date,
  fuso: string,
): Promise<Map<number, FatoClinico[]>> {
  const m = new Map<number, FatoClinico[]>();
  if (atendimentos.length === 0) return m;
  const ids = marcadores(atendimentos.length);
  const [sv, esc, dx] = await Promise.all([
    l.consultar(
      `SELECT a.atendimento_id, p.codigo, v.valor_numerico, v.valor_texto, a.aferido_em
         FROM afericao a JOIN afericao_valor v ON v.afericao_id = a.id JOIN parametro_vital p ON p.id = v.parametro_vital_id
        WHERE a.atendimento_id IN (${ids}) AND a.excluido_em IS NULL AND a.aferido_em >= ?
          AND (v.valor_numerico IS NOT NULL OR v.valor_texto IS NOT NULL)`,
      [...atendimentos, desde],
    ),
    l.consultar(
      `SELECT a.atendimento_id, e.codigo, a.pontuacao_total, a.aplicado_em FROM aplicacao_escala a
         JOIN escala_clinica e ON e.id = a.escala_clinica_id
        WHERE a.atendimento_id IN (${ids}) AND a.excluido_em IS NULL AND a.situacao = 'finalizada' AND a.aplicado_em >= ?`,
      [...atendimentos, desde],
    ),
    l.consultar(
      `SELECT atendimento_id, cid_termo_terminologia_id, diagnosticado_em FROM diagnostico_atendimento
        WHERE atendimento_id IN (${ids}) AND situacao = 'ativo'`,
      [...atendimentos],
    ),
  ]);
  const por = (k: number, f: FatoClinico) => m.set(k, [...(m.get(k) ?? []), f]);
  for (const r of sv)
    por(num(r['atendimento_id']), {
      categoria: 'sinal_vital',
      chave: texto(r['codigo']),
      valor: decimal(r['valor_numerico']),
      texto: textoOuNulo(r['valor_texto']),
      em: civil16(r['aferido_em'], fuso) ?? '',
    });
  for (const r of esc)
    por(num(r['atendimento_id']), {
      categoria: 'escala',
      chave: texto(r['codigo']),
      valor: decimal(r['pontuacao_total']),
      texto: null,
      em: civil16(r['aplicado_em'], fuso) ?? '',
    });
  for (const r of dx)
    por(num(r['atendimento_id']), {
      categoria: 'diagnostico',
      chave: String(num(r['cid_termo_terminologia_id'])),
      valor: null,
      texto: null,
      em: civil16(r['diagnosticado_em'], fuso) ?? '',
    });
  return m;
}

/** Os protocolos ativos do estabelecimento com critério de entrada ativo. */
async function protocolosParaAvaliar(l: Leitor, est: number): Promise<ProtocoloParaAvaliar[]> {
  const ps = (await protocolosGerenciados(l, est)).filter((p) => p.situacao === 'ativo');
  const cs = await criteriosDe(
    l,
    ps.map((p) => p.id),
  );
  return ps
    .map((p) => ({
      id: p.id,
      nome: p.nome,
      tipo: p.tipo,
      publico: p.publico,
      formula: p.formula,
      mensagem: p.mensagem,
      criterios: cs.get(p.id) ?? [],
    }))
    .filter((p) => p.criterios.some((c) => c.ativo && c.finalidade === 'entrada'));
}

export interface AlertaComPaciente extends AlertaElegivel {
  readonly nomePaciente: string;
  readonly numeroAtendimento: string;
}

export async function elegiveisDoEstabelecimento(
  l: Leitor,
  est: number,
  agora: string,
): Promise<{ avaliados: number; alertas: AlertaComPaciente[] }> {
  const fuso = await fusoDe(l, est);
  const protocolos = await protocolosParaAvaliar(l, est);
  if (protocolos.length === 0) return { avaliados: 0, alertas: [] };
  const desde = instanteDe(somarMinutos(agora, -JANELA_CANDIDATO_HORAS * 60), fuso);
  const cands = await l.consultar<{ id: unknown }>(
    `SELECT a.id FROM atendimento a
      WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.alta_medica_em IS NULL
        AND (EXISTS (SELECT 1 FROM afericao f WHERE f.atendimento_id = a.id AND f.excluido_em IS NULL AND f.aferido_em >= ?)
          OR EXISTS (SELECT 1 FROM aplicacao_escala x WHERE x.atendimento_id = a.id AND x.excluido_em IS NULL
                       AND x.aplicado_em >= ?)
          OR EXISTS (SELECT 1 FROM diagnostico_atendimento d WHERE d.atendimento_id = a.id AND d.situacao = 'ativo'
                       AND d.diagnosticado_em >= ?))
      ORDER BY a.id DESC LIMIT 500`,
    [est, desde, desde, desde],
  );
  const ids = cands.map((r) => num(r.id));
  if (ids.length === 0) return { avaliados: 0, alertas: [] };
  const [demo, fatos, abertos] = await Promise.all([
    demografiaDe(l, ids, agora),
    fatosDe(l, ids, desde, fuso),
    l.consultar(
      `SELECT atendimento_id, protocolo_gerenciado_id FROM inclusao_protocolo_paciente
        WHERE atendimento_id IN (${marcadores(ids.length)}) AND excluido_em IS NULL AND situacao IN ('sugerido', 'ativo')`,
      [...ids],
    ),
  ]);
  const candidatos: CandidatoAvaliado[] = ids.flatMap((id) => {
    const d = demo.get(id);
    return d ? [{ atendimento: id, paciente: d.paciente, dados: d.dados, fatos: fatos.get(id) ?? [] }] : [];
  });
  const chaves = new Set(
    abertos.map((r) => `${num(r['atendimento_id'])}|${num(r['protocolo_gerenciado_id'])}`),
  );
  const alertas = alertasDeElegiveis(candidatos, protocolos, chaves, agora).map((a) => ({
    ...a,
    nomePaciente: demo.get(a.atendimento)?.nome ?? '',
    numeroAtendimento: demo.get(a.atendimento)?.numero ?? '',
  }));
  return { avaliados: candidatos.length, alertas };
}

// ---------------------------------------------------------------- etapas da inclusão

export interface EtapaDaInclusao {
  readonly id: number;
  readonly sequencia: number;
  readonly etapa: number;
  readonly nome: string;
  readonly tipo: string;
  readonly obrigatoria: boolean;
  readonly metaMinutos: number | null;
  readonly iniciadaEm: string;
  readonly prazoMetaEm: string | null;
  readonly concluidaEm: string | null;
  readonly situacao: SituacaoEtapa;
  readonly observacao: string | null;
  readonly estado: ReturnType<typeof relogioDaEtapa>['estado'];
  readonly minutosRestantes: number | null;
  readonly versao: number;
}

export interface EtapasDaInclusao {
  readonly inclusao: number;
  readonly protocolo: number;
  readonly nomeProtocolo: string;
  readonly horarioZero: string;
  readonly etapas: readonly EtapaDaInclusao[];
  readonly criterios: readonly { descricao: string; valorEncontrado: string | null; atendido: boolean }[];
  readonly cumpridas: number;
  readonly perdidas: number;
}

const SQL_INCLUSAO = `SELECT ip.id, ip.protocolo_gerenciado_id, ip.atendimento_id, ip.paciente_id, ip.horario_zero_em,
         ip.situacao, g.nome FROM inclusao_protocolo_paciente ip JOIN protocolo_gerenciado g ON g.id = ip.protocolo_gerenciado_id
   WHERE ip.id = ? AND ip.estabelecimento_id = ? AND ip.excluido_em IS NULL`;

async function inclusaoDe(l: Leitor, est: number, id: number, tx: TxOperacao | null = null) {
  const r = tx
    ? ((await tx.consultarParaAtualizar(SQL_INCLUSAO, [id, est]))[0] ?? null)
    : await l.uma(SQL_INCLUSAO, [id, est]);
  if (!r) throw recusa('inclusao-inexistente', 'O protocolo do paciente não existe neste estabelecimento.');
  return r;
}

export async function etapasDaInclusao(
  l: Leitor,
  est: number,
  id: number,
  agora: string,
): Promise<EtapasDaInclusao> {
  const fuso = await fusoDe(l, est);
  const inc = await inclusaoDe(l, est, id);
  const [rs, cs] = await Promise.all([
    l.consultar(
      `SELECT ie.*, e.nome, e.tipo, e.obrigatoria, e.meta_minutos FROM inclusao_protocolo_etapa ie
         JOIN protocolo_gerenciado_etapa e ON e.id = ie.protocolo_gerenciado_etapa_id
        WHERE ie.inclusao_protocolo_paciente_id = ? AND ie.excluido_em IS NULL ORDER BY ie.sequencia`,
      [id],
    ),
    l.consultar(
      `SELECT descricao, valor_encontrado, atendido FROM inclusao_protocolo_criterio
        WHERE inclusao_protocolo_paciente_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [id],
    ),
  ]);
  const etapas = rs.map((r): EtapaDaInclusao => {
    const situacao = texto(r['situacao']) as SituacaoEtapa;
    const prazo = civil16(r['prazo_meta_em'], fuso);
    return {
      id: num(r['id']),
      sequencia: num(r['sequencia']),
      etapa: num(r['protocolo_gerenciado_etapa_id']),
      nome: texto(r['nome']),
      tipo: texto(r['tipo']),
      obrigatoria: booleano(r['obrigatoria']),
      metaMinutos: numOuNulo(r['meta_minutos']),
      iniciadaEm: civil16(r['iniciada_em'], fuso) ?? '',
      prazoMetaEm: prazo,
      concluidaEm: civil16(r['concluida_em'], fuso),
      situacao,
      observacao: textoOuNulo(r['observacao']),
      ...relogioDaEtapa(situacao, prazo, agora),
      versao: num(r['versao']),
    };
  });
  return {
    inclusao: id,
    protocolo: num(inc['protocolo_gerenciado_id']),
    nomeProtocolo: texto(inc['nome']),
    horarioZero: civil16(inc['horario_zero_em'], fuso) ?? '',
    etapas,
    criterios: cs.map((r) => ({
      descricao: texto(r['descricao']),
      valorEncontrado: textoOuNulo(r['valor_encontrado']),
      atendido: booleano(r['atendido']),
    })),
    cumpridas: etapas.filter((e) => e.situacao === 'meta_atingida').length,
    perdidas: etapas.filter((e) => e.situacao === 'meta_perdida').length,
  };
}

/**
 * Inicia as etapas da inclusão com os prazos a partir do horário zero e guarda o retrato dos critérios de entrada
 * avaliados naquele momento (o que fez o paciente entrar). Uma vez só por inclusão.
 */
export async function iniciarEtapasTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  id: number,
  agora: string,
): Promise<{ inclusao: number; etapas: number; criterios: number; elegivel: boolean }> {
  const r = await iniciarEtapasDaInclusao(tx, est, id, agora, true);
  an.dados = { protocolo: r.protocolo, etapas: r.etapas, criterios: r.criterios, elegivel: r.elegivel };
  return { inclusao: id, etapas: r.etapas, criterios: r.criterios, elegivel: r.elegivel };
}

/**
 * As etapas com meta e o retrato dos critérios nascem na mesma transação da inclusão (PA e internado): o relógio das
 * metas começa no horário zero sem depender de outro clique. Protocolo sem etapas configuradas: a inclusão segue e as
 * etapas podem ser iniciadas depois, quando a diretoria configurar as metas. Devolve quantas etapas e critérios gravou.
 */
export async function etapasNaInclusaoTx(
  tx: TxOperacao,
  est: number,
  id: number,
): Promise<{ etapas: number; criterios: number }> {
  const agora = civil16(new Date(), await fusoDe(tx, est))!;
  const r = await iniciarEtapasDaInclusao(tx, est, id, agora, false);
  return { etapas: r.etapas, criterios: r.criterios };
}

async function iniciarEtapasDaInclusao(
  tx: TxOperacao,
  est: number,
  id: number,
  agora: string,
  exigirEtapas: boolean,
): Promise<{ protocolo: number; etapas: number; criterios: number; elegivel: boolean }> {
  const fuso = await fusoDe(tx, est);
  const inc = await inclusaoDe(tx, est, id, tx);
  if (!['sugerido', 'ativo'].includes(texto(inc['situacao'])))
    throw recusa('protocolo-encerrado', 'O protocolo deste paciente já foi encerrado.');
  const ja = await tx.uma(
    'SELECT id FROM inclusao_protocolo_etapa WHERE inclusao_protocolo_paciente_id = ? AND excluido_em IS NULL LIMIT 1',
    [id],
  );
  if (ja) throw recusa('etapas-ja-iniciadas', 'As etapas deste protocolo já foram iniciadas.');
  const protocolo = num(inc['protocolo_gerenciado_id']);
  const atendimento = num(inc['atendimento_id']);
  const etapas = await etapasDe(tx, protocolo);
  if (etapas.length === 0 && exigirEtapas)
    throw recusa('protocolo-sem-etapas', 'O protocolo não tem etapas: configure as etapas e as metas antes.');
  const zero = civil16(inc['horario_zero_em'], fuso) ?? agora;
  const demo = (await demografiaDe(tx, [atendimento], agora)).get(atendimento);
  const plano = planoDasEtapas(etapas, zero, demo?.dados.idadeDias ?? null);
  for (const p of plano)
    await tx.incluir(T_INC_ETAPA, {
      inclusao_protocolo_paciente_id: id,
      sequencia: p.sequencia,
      protocolo_gerenciado_etapa_id: p.etapa,
      iniciada_em: instanteDe(p.iniciadaEm, fuso),
      prazo_meta_em: p.prazoMetaEm === null ? null : instanteDe(p.prazoMetaEm, fuso),
      situacao: 'em_andamento',
    });
  // O retrato dos critérios de entrada no momento da inclusão (só se ainda não houver).
  let criterios = 0;
  let elegivel = false;
  const temRetrato = await tx.uma(
    'SELECT id FROM inclusao_protocolo_criterio WHERE inclusao_protocolo_paciente_id = ? LIMIT 1',
    [id],
  );
  const definidos = (await criteriosDe(tx, [protocolo])).get(protocolo) ?? [];
  if (!temRetrato && definidos.length) {
    const g = await tx.uma('SELECT formula_entrada FROM protocolo_gerenciado WHERE id = ?', [protocolo]);
    const desde = instanteDe(somarMinutos(agora, -JANELA_CANDIDATO_HORAS * 60), fuso);
    const fatos = (await fatosDe(tx, [atendimento], desde, fuso)).get(atendimento) ?? [];
    const a = avaliarEntrada(
      textoOuNulo(g?.['formula_entrada']),
      definidos,
      fatos,
      demo?.dados ?? { sexo: null, idadeDias: null },
      agora,
    );
    elegivel = a.elegivel;
    for (const [i, r] of a.resultados.entries()) {
      await tx.incluir(T_INC_CRITERIO, {
        inclusao_protocolo_paciente_id: id,
        sequencia: i + 1,
        protocolo_gerenciado_criterio_id: r.criterio,
        descricao: r.descricao.slice(0, 1000),
        identificador: r.chave,
        valor_encontrado: r.valorEncontrado,
        atendido: r.atendido,
        motivo: r.motivo,
      });
      criterios++;
    }
  }
  return { protocolo, etapas: plano.length, criterios, elegivel };
}

/**
 * Saída da inclusão (encerramento do protocolo ou inativação por engano): cada etapa ainda em andamento recebe a
 * situação final pela regra do domínio, com a hora da saída e o motivo na observação. Nada é apagado. Pela transação
 * do executor (TxOperacao: versão e auditoria pelo alterar) ou pelo escritor direto (colunas de auditoria explícitas).
 */
export async function fecharEtapasNaSaida(
  e: Escritor | TxOperacao,
  est: number,
  inclusao: number,
  saida: { em: Date; forma: 'encerramento' | 'inativacao'; motivo: string | null; usuario: number | null },
): Promise<number> {
  const fuso = await fusoDe(e, est);
  const pendentes = await e.consultarParaAtualizar(
    `SELECT id, versao, iniciada_em, prazo_meta_em FROM inclusao_protocolo_etapa
      WHERE inclusao_protocolo_paciente_id = ? AND situacao = 'em_andamento' AND excluido_em IS NULL ORDER BY sequencia`,
    [inclusao],
  );
  const saidaCivil = civil16(saida.em, fuso)!;
  const rotulo = saida.forma === 'encerramento' ? 'Protocolo encerrado' : 'Inclusão inativada por engano';
  const observacao = (saida.motivo?.trim() ? `${rotulo}: ${saida.motivo.trim()}` : rotulo).slice(0, 2000);
  for (const r of pendentes) {
    const v = r['iniciada_em'];
    const inicio = v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
    const concluida = saida.em < inicio ? inicio : saida.em;
    const situacao = situacaoAoSairDoProtocolo(civil16(r['prazo_meta_em'], fuso), saidaCivil, saida.forma);
    const valores = { concluida_em: concluida, situacao, responsavel_usuario_id: saida.usuario, observacao };
    if ('alterar' in e) await e.alterar(T_INC_ETAPA, num(r['id']), num(r['versao']), valores);
    else
      await e.executar(
        `UPDATE inclusao_protocolo_etapa SET concluida_em = ?, situacao = ?, responsavel_usuario_id = ?, observacao = ?,
                alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ? AND versao = ?`,
        [
          concluida,
          situacao,
          saida.usuario,
          observacao,
          new Date(),
          saida.usuario,
          num(r['id']),
          num(r['versao']),
        ],
      );
  }
  return pendentes.length;
}

async function etapaDaInclusaoTravada(tx: TxOperacao, est: number, id: number) {
  const [r] = await tx.consultarParaAtualizar(
    `SELECT ie.*, e.obrigatoria FROM inclusao_protocolo_etapa ie
       JOIN inclusao_protocolo_paciente ip ON ip.id = ie.inclusao_protocolo_paciente_id
       JOIN protocolo_gerenciado_etapa e ON e.id = ie.protocolo_gerenciado_etapa_id
      WHERE ie.id = ? AND ip.estabelecimento_id = ? AND ie.excluido_em IS NULL AND ip.excluido_em IS NULL`,
    [id, est],
  );
  if (!r)
    throw recusa('etapa-inexistente', 'A etapa do protocolo do paciente não existe neste estabelecimento.');
  return r;
}

export async function concluirEtapaTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  id: number,
  e: { versao: number; concluidaEm: string; justificativa: string | null; usuario: number | null },
  agora: string,
): Promise<{ id: number; situacao: SituacaoEtapa; versao: number }> {
  const fuso = await fusoDe(tx, est);
  const r = await etapaDaInclusaoTravada(tx, est, id);
  const prazo = civil16(r['prazo_meta_em'], fuso);
  const problema = problemaDaConclusao({
    situacaoAtual: texto(r['situacao']) as SituacaoEtapa,
    iniciadaEm: civil16(r['iniciada_em'], fuso) ?? '',
    prazoMetaEm: prazo,
    concluidaEm: e.concluidaEm,
    agora,
    justificativa: e.justificativa,
  });
  if (problema) throw recusa(problema, MENSAGENS_ETAPA[problema]);
  const situacao = situacaoAoConcluir(prazo, e.concluidaEm);
  const versao = await tx.alterar(T_INC_ETAPA, id, e.versao, {
    concluida_em: instanteDe(e.concluidaEm, fuso),
    situacao,
    responsavel_usuario_id: e.usuario,
    observacao: e.justificativa?.trim() || null,
  });
  an.dados = { inclusao: num(r['inclusao_protocolo_paciente_id']), situacao };
  return { id, situacao, versao };
}

export async function cancelarEtapaTx(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  id: number,
  e: { versao: number; motivo: string; usuario: number | null },
  agora: string,
): Promise<{ id: number; situacao: SituacaoEtapa; versao: number }> {
  const fuso = await fusoDe(tx, est);
  const r = await etapaDaInclusaoTravada(tx, est, id);
  const problema = problemaDoCancelamento({
    situacaoAtual: texto(r['situacao']) as SituacaoEtapa,
    obrigatoria: booleano(r['obrigatoria']),
    motivo: e.motivo,
  });
  if (problema) throw recusa(problema, MENSAGENS_ETAPA[problema]);
  const inicio = civil16(r['iniciada_em'], fuso) ?? agora;
  const versao = await tx.alterar(T_INC_ETAPA, id, e.versao, {
    concluida_em: instanteDe(agora < inicio ? inicio : agora, fuso),
    situacao: 'cancelada',
    responsavel_usuario_id: e.usuario,
    observacao: e.motivo.trim(),
  });
  an.motivo = e.motivo.trim();
  an.dados = { inclusao: num(r['inclusao_protocolo_paciente_id']) };
  return { id, situacao: 'cancelada', versao };
}

// ---------------------------------------------------------------- visão por paciente

export interface InclusaoAberta {
  readonly inclusao: number;
  readonly atendimento: number;
  readonly numeroAtendimento: string;
  readonly nomePaciente: string;
  readonly protocolo: string;
  readonly horarioZero: string;
  readonly etapas: number;
  readonly pendentes: number;
  readonly vencidas: number;
}

/** Os protocolos abertos do estabelecimento com a contagem das etapas pendentes e das metas vencidas. */
export async function inclusoesAbertas(l: Leitor, est: number, agora: string): Promise<InclusaoAberta[]> {
  const fuso = await fusoDe(l, est);
  const limite = instanteDe(agora, fuso);
  const rs = await l.consultar(
    `SELECT ip.id, ip.atendimento_id, ip.horario_zero_em, g.nome AS protocolo, a.numero,
            CASE WHEN pf.usa_nome_social AND pf.nome_social IS NOT NULL THEN pf.nome_social ELSE pf.nome END AS nome,
            (SELECT COUNT(*) FROM inclusao_protocolo_etapa e WHERE e.inclusao_protocolo_paciente_id = ip.id
                AND e.excluido_em IS NULL) AS etapas,
            (SELECT COUNT(*) FROM inclusao_protocolo_etapa e WHERE e.inclusao_protocolo_paciente_id = ip.id
                AND e.excluido_em IS NULL AND e.situacao = 'em_andamento') AS pendentes,
            (SELECT COUNT(*) FROM inclusao_protocolo_etapa e WHERE e.inclusao_protocolo_paciente_id = ip.id
                AND e.excluido_em IS NULL AND e.situacao = 'em_andamento' AND e.prazo_meta_em < ?) AS vencidas
       FROM inclusao_protocolo_paciente ip JOIN protocolo_gerenciado g ON g.id = ip.protocolo_gerenciado_id
       JOIN atendimento a ON a.id = ip.atendimento_id JOIN paciente p ON p.id = ip.paciente_id
       JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE ip.estabelecimento_id = ? AND ip.excluido_em IS NULL AND ip.situacao = 'ativo'
      ORDER BY ip.horario_zero_em DESC LIMIT 200`,
    [limite, est],
  );
  return rs.map((r) => ({
    inclusao: num(r['id']),
    atendimento: num(r['atendimento_id']),
    numeroAtendimento: texto(r['numero']),
    nomePaciente: texto(r['nome']),
    protocolo: texto(r['protocolo']),
    horarioZero: civil16(r['horario_zero_em'], fuso) ?? '',
    etapas: num(r['etapas']),
    pendentes: num(r['pendentes']),
    vencidas: num(r['vencidas']),
  }));
}
