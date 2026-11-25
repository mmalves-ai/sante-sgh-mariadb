// Oncologia sobre o banco do cliente (C2-090, 03-PEP L111): o protocolo de quimioterapia versionado, o ciclo dentro do
// tratamento oncológico, a validação farmacêutica, a ligação com a prescrição geral e os eventos (revogação da versão,
// inativação do protocolo, ajuste, suspensão, retomada e cancelamento do ciclo, desligamento da prescrição). As regras
// clínicas (dose, intervalo, curso, oferta) ficam no domínio (`@sgh/dominio-pep`, oncologia e cálculo de dose) e são
// aplicadas pela API antes da gravação; aqui ficam a leitura e a gravação no modelo próprio:
//   - protocolo_quimioterapia: uma linha por versão publicada (codigo + versao_protocolo), imutável, com o conteúdo
//     publicado (farmacos_publicados) conferido pelo hash_conteudo; a revogação marca a versão (revogado_em) e fica no
//     evento. Os protocolos anteriores à versão (carga) leem os fármacos de protocolo_quimioterapia_droga;
//   - tratamento_oncologico: o curso do paciente com o protocolo (o primeiro ciclo de um curso abre o tratamento, com o
//     diagnóstico oncológico e a intenção); o número do curso é a ordem dos tratamentos do paciente com o mesmo código;
//   - ciclo_quimioterapia: o ciclo com as doses calculadas, a versão do protocolo usada e a validação (outra pessoa,
//     uma vez); o andamento é a situação (previsto/liberado = ativo; suspenso; cancelado);
//   - ciclo_quimioterapia_prescricao: a ligação com a prescrição geral (desligar guarda a data e o motivo);
//   - evento_tratamento_oncologico: os eventos, nunca apagados, com a versão anterior do ciclo ajustado.
// Toda leitura filtra o estabelecimento da sessão (os protocolos da rede, sem estabelecimento, valem para todos).
import type { CicloDependente, DoseCalculada, FarmacoProtocolo, VersaoCicloAnterior } from '@sgh/contratos';
import { type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { civil } from '../exames/relogio.js';
import type {
  AjusteCiclo,
  AndamentoCicloLido,
  CicloOncologicoRegistrado,
  EventoOncologicoRegistrado,
  NovoCicloOncologico,
  NovoEventoOncologico,
  NovoProtocoloOncologico,
  ProtocoloOncologicoRegistrado,
  RevogacaoVersaoProtocolo,
  ValidacaoCiclo,
  VinculoPrescricaoCiclo,
} from './tipos.js';

/** As tabelas que a oncologia grava (declaradas na operação da gravação direta). */
export const TABELAS_ONCOLOGIA = [
  'protocolo_quimioterapia',
  'tratamento_oncologico',
  'ciclo_quimioterapia',
  'ciclo_quimioterapia_prescricao',
  'evento_tratamento_oncologico',
] as const;

/** O teto da lista dos ciclos de uma versão (a revogação mostra a lista e a contagem). */
export const TETO_CICLOS_DA_VERSAO = 500;

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
function minuto(v: unknown, fuso: string): string {
  const c = civil(v instanceof Date ? v : new Date(String(v)), fuso);
  return `${c.data}T${c.hora}`;
}
function json<T>(v: unknown, padrao: T): T {
  if (v === null || v === undefined) return padrao;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return padrao;
  }
}

/** A base do cálculo do modelo ↔ a unidade da dose da tela. */
const UNIDADE_DA_BASE: Readonly<Record<string, FarmacoProtocolo['unidade']>> = {
  superficie_corporal: 'mg/m2',
  peso: 'mg/kg',
  auc: 'auc',
  fixa: 'mg',
};
const VIAS = new Set(['iv', 'vo', 'sc', 'im', 'it']);

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────────────

const SQL_PROTOCOLOS = `
  SELECT p.id, p.codigo, p.versao_protocolo, p.nome, p.tipo_protocolo_oncologico_id, p.intervalo_dias, p.numero_ciclos,
         p.indicacao, p.referencia_bibliografica, p.farmacos_publicados, p.hash_conteudo, p.criado_em, u.login,
         (SELECT MAX(p2.versao_protocolo) FROM protocolo_quimioterapia p2
           WHERE p2.codigo = p.codigo AND p2.excluido_em IS NULL) AS versao_vigente
    FROM protocolo_quimioterapia p
    LEFT JOIN usuario u ON u.id = p.criado_por
   WHERE (p.estabelecimento_id = ? OR p.estabelecimento_id IS NULL) AND p.excluido_em IS NULL`;

const SQL_DROGAS = `
  SELECT d.protocolo_quimioterapia_id, i.descricao, d.dose, d.base_dose, d.dias_ciclo, v.codigo AS via, d.observacao
    FROM protocolo_quimioterapia_droga d
    JOIN item_prescritivel i ON i.id = d.item_prescritivel_id
    JOIN via_de_uso v ON v.id = d.via_de_uso_id
   WHERE d.excluido_em IS NULL AND d.papel = 'antineoplasico' AND d.protocolo_quimioterapia_id IN`;

/** Os protocolos (todas as versões) do estabelecimento e da rede, com a marca da versão vigente. */
export async function lerProtocolos(
  l: Leitor,
  est: number,
  fuso: string,
  id: number | null,
): Promise<(ProtocoloOncologicoRegistrado & { vigente: boolean })[]> {
  const linhas = await l.consultar(
    `${SQL_PROTOCOLOS} ${id === null ? '' : 'AND p.id = ?'} ORDER BY p.codigo, p.versao_protocolo DESC LIMIT 1000`,
    id === null ? [est] : [est, id],
    { teto: 1000 },
  );
  // Os anteriores à versão (sem conteúdo publicado) leem os antineoplásicos do cadastro de fármacos do protocolo.
  const semConteudo = linhas.filter((r) => r['farmacos_publicados'] === null).map((r) => n(r['id']));
  const drogas = semConteudo.length
    ? await l.consultar(
        `${SQL_DROGAS} (${semConteudo.map(() => '?').join(', ')}) ORDER BY d.protocolo_quimioterapia_id, d.sequencia`,
        semConteudo,
        { teto: 10_000 },
      )
    : [];
  return linhas.map((r) => {
    const pid = n(r['id']);
    const farmacos: FarmacoProtocolo[] =
      r['farmacos_publicados'] !== null
        ? json<FarmacoProtocolo[]>(r['farmacos_publicados'], [])
        : drogas
            .filter((d) => n(d['protocolo_quimioterapia_id']) === pid)
            .map((d) => ({
              nome: texto(d['descricao']).slice(0, 60),
              dose: n(d['dose']),
              unidade: UNIDADE_DA_BASE[texto(d['base_dose'])] ?? 'mg',
              via: (VIAS.has(texto(d['via'])) ? texto(d['via']) : 'iv') as FarmacoProtocolo['via'],
              dias: json<number[]>(d['dias_ciclo'], [1]),
              ...(d['observacao'] ? { administracao: texto(d['observacao']).slice(0, 120) } : {}),
            }));
    return {
      id: pid,
      codigo: texto(r['codigo']),
      versao: n(r['versao_protocolo']),
      nome: texto(r['nome']),
      tipo: n(r['tipo_protocolo_oncologico_id']),
      intervaloDias: n(r['intervalo_dias']),
      ciclos: n(r['numero_ciclos']),
      indicacao: textoOuNulo(r['indicacao']),
      referencia: texto(r['referencia_bibliografica']),
      farmacos,
      hash: texto(r['hash_conteudo']),
      por: texto(r['login']),
      em: minuto(r['criado_em'], fuso),
      vigente: n(r['versao_vigente']) === n(r['versao_protocolo']),
    };
  });
}

const SQL_CICLOS = `
  SELECT c.id, c.numero_ciclo, DATE_FORMAT(c.data_prevista, '%Y-%m-%d') AS data_prevista, c.peso_kg, c.altura_cm,
         c.superficie_corporal_m2, c.creatinina_mg_dl, c.clearance_creatinina, c.reducao_dose_percentual,
         c.motivo_reducao, c.justificativa_intervalo, c.doses_calculadas, c.situacao, c.validado_em, c.criado_em,
         uc.login AS por, uv.login AS validado_por, t.paciente_id, t.justificativa_protocolo, i.id AS internacao,
         p.id AS protocolo, p.codigo,
         (SELECT COUNT(*) FROM tratamento_oncologico t2
            JOIN protocolo_quimioterapia p2 ON p2.id = t2.protocolo_quimioterapia_id
           WHERE t2.paciente_id = t.paciente_id AND t2.estabelecimento_id = t.estabelecimento_id
             AND p2.codigo = p.codigo AND t2.id <= t.id AND t2.excluido_em IS NULL) AS curso,
         (SELECT GROUP_CONCAT(cp.prescricao_id ORDER BY cp.prescricao_id) FROM ciclo_quimioterapia_prescricao cp
           WHERE cp.ciclo_quimioterapia_id = c.id AND cp.desligado_em IS NULL) AS prescricoes
    FROM ciclo_quimioterapia c
    JOIN tratamento_oncologico t ON t.id = c.tratamento_oncologico_id
    JOIN protocolo_quimioterapia p ON p.id = COALESCE(c.protocolo_quimioterapia_id, t.protocolo_quimioterapia_id)
    LEFT JOIN internacao i ON i.atendimento_id = c.atendimento_id AND i.estabelecimento_id = t.estabelecimento_id
    LEFT JOIN usuario uc ON uc.id = c.criado_por
    LEFT JOIN usuario uv ON uv.id = c.validado_por_usuario_id
   WHERE t.estabelecimento_id = ? AND c.excluido_em IS NULL AND t.excluido_em IS NULL`;

/** Andamento lido da situação do ciclo. */
function andamentoDe(situacao: string): AndamentoCicloLido {
  return situacao === 'suspenso' ? 'suspenso' : situacao === 'cancelado' ? 'cancelado' : 'ativo';
}

/** Os ciclos do estabelecimento pelo filtro (paciente, id, a validar ou versão do protocolo). */
export async function lerCiclos(
  l: Leitor,
  est: number,
  fuso: string,
  filtro: 'paciente' | 'id' | 'a-validar' | 'versao',
  valor: number | null,
  teto = 1000,
): Promise<CicloOncologicoRegistrado[]> {
  const condicao =
    filtro === 'paciente'
      ? 'AND t.paciente_id = ?'
      : filtro === 'id'
        ? 'AND c.id = ?'
        : filtro === 'versao'
          ? 'AND COALESCE(c.protocolo_quimioterapia_id, t.protocolo_quimioterapia_id) = ?'
          : "AND c.situacao = 'previsto' AND c.validado_em IS NULL";
  const linhas = await l.consultar(
    `${SQL_CICLOS} ${condicao} ORDER BY c.data_prevista DESC, c.numero_ciclo DESC, c.id DESC LIMIT ${teto + 1}`,
    valor === null ? [est] : [est, valor],
    { teto: teto + 1 },
  );
  return linhas.map((r) => ({
    id: n(r['id']),
    internacao: n(r['internacao']),
    paciente: n(r['paciente_id']),
    protocolo: n(r['protocolo']),
    codigoProtocolo: texto(r['codigo']),
    numero: n(r['numero_ciclo']),
    dataPrevista: texto(r['data_prevista']),
    pesoKg: n(r['peso_kg']),
    alturaCm: n(r['altura_cm']),
    superficieM2: n(r['superficie_corporal_m2']),
    creatininaMgDl: nn(r['creatinina_mg_dl']),
    clearanceMlMin: nn(r['clearance_creatinina']),
    reducaoPct: n(r['reducao_dose_percentual']),
    motivoReducao: textoOuNulo(r['motivo_reducao']),
    justificativaIntervalo: textoOuNulo(r['justificativa_intervalo']),
    doses: json<DoseCalculada[]>(r['doses_calculadas'], []),
    situacao: r['validado_em'] ? 'validado' : 'prescrito',
    por: texto(r['por']),
    em: minuto(r['criado_em'], fuso),
    validadoPor: textoOuNulo(r['validado_por']),
    validadoEm: r['validado_em'] ? minuto(r['validado_em'], fuso) : null,
    curso: Math.max(1, n(r['curso'])),
    motivoCurso: n(r['curso']) > 1 ? textoOuNulo(r['justificativa_protocolo']) : null,
    prescricoes: texto(r['prescricoes'])
      .split(',')
      .filter((x) => x !== '')
      .map(Number),
    andamento: andamentoDe(texto(r['situacao'])),
  }));
}

/** Os ciclos que usam a versão (a contagem e a lista da revogação). */
export async function lerCiclosDaVersao(
  l: Leitor,
  est: number,
  fuso: string,
  protocolo: number,
): Promise<{ total: number; emAndamento: number; cortada: boolean; itens: CicloDependente[] }> {
  const cont = await l.uma(
    `SELECT COUNT(*) AS total, COALESCE(SUM(c.situacao <> 'cancelado'), 0) AS em_andamento
       FROM ciclo_quimioterapia c JOIN tratamento_oncologico t ON t.id = c.tratamento_oncologico_id
      WHERE t.estabelecimento_id = ? AND c.excluido_em IS NULL AND t.excluido_em IS NULL
        AND COALESCE(c.protocolo_quimioterapia_id, t.protocolo_quimioterapia_id) = ?`,
    [est, protocolo],
  );
  const ciclos = await lerCiclos(l, est, fuso, 'versao', protocolo, TETO_CICLOS_DA_VERSAO);
  const itens = ciclos.slice(0, TETO_CICLOS_DA_VERSAO).map((x) => ({
    id: x.id,
    paciente: x.paciente,
    internacao: x.internacao,
    numero: x.numero,
    curso: x.curso,
    dataPrevista: x.dataPrevista,
    situacao: x.situacao,
    andamento: x.andamento,
  }));
  const total = n(cont?.['total']);
  return { total, emAndamento: n(cont?.['em_andamento']), cortada: total > itens.length, itens };
}

const SQL_EVENTOS = `
  SELECT e.id, e.evento, e.categoria, e.prescricao_id, e.ciclos_afetados, e.versao_anterior, e.motivo, e.ocorrido_em,
         u.login, e.protocolo_quimioterapia_id, e.ciclo_quimioterapia_id, COALESCE(p.codigo, pc.codigo) AS codigo
    FROM evento_tratamento_oncologico e
    LEFT JOIN protocolo_quimioterapia p ON p.id = e.protocolo_quimioterapia_id
    LEFT JOIN ciclo_quimioterapia c ON c.id = e.ciclo_quimioterapia_id
    LEFT JOIN tratamento_oncologico t ON t.id = c.tratamento_oncologico_id
    LEFT JOIN protocolo_quimioterapia pc ON pc.id = COALESCE(c.protocolo_quimioterapia_id, t.protocolo_quimioterapia_id)
    LEFT JOIN usuario u ON u.id = e.usuario_id
   WHERE e.estabelecimento_id = ?`;

/** Os eventos dos protocolos (sem ciclo) ou dos ciclos informados, o mais recente primeiro. */
export async function lerEventos(
  l: Leitor,
  est: number,
  fuso: string,
  ciclos: readonly number[] | null,
): Promise<EventoOncologicoRegistrado[]> {
  if (ciclos !== null && ciclos.length === 0) return [];
  const condicao =
    ciclos === null
      ? "AND e.ciclo_quimioterapia_id IS NULL AND e.evento <> 'prescricao_desligada'"
      : `AND e.ciclo_quimioterapia_id IN (${ciclos.map(() => '?').join(', ')})`;
  const linhas = await l.consultar(
    `${SQL_EVENTOS} ${condicao} ORDER BY e.ocorrido_em DESC, e.id DESC LIMIT 2000`,
    ciclos === null ? [est] : [est, ...ciclos],
    { teto: 2000 },
  );
  return linhas.map((r) => ({
    id: n(r['id']),
    evento: texto(r['evento']).replace(/_/g, '-') as EventoOncologicoRegistrado['evento'],
    categoria: textoOuNulo(r['categoria']) as EventoOncologicoRegistrado['categoria'],
    prescricao: nn(r['prescricao_id']),
    ciclosAfetados: nn(r['ciclos_afetados']),
    antes: textoOuNulo(r['versao_anterior']),
    motivo: texto(r['motivo']),
    por: texto(r['login']),
    em: minuto(r['ocorrido_em'], fuso),
    codigoProtocolo: texto(r['codigo']),
    protocolo: nn(r['protocolo_quimioterapia_id']),
    ciclo: nn(r['ciclo_quimioterapia_id']),
  }));
}

// ── Gravações (na transação da operação) ────────────────────────────────────────────────────────────────────

/** Publica a versão do protocolo: a próxima do código, travando as versões existentes. */
export async function publicarProtocolo(
  tx: TxOperacao,
  est: number,
  x: NovoProtocoloOncologico,
): Promise<{ id: number; versao: number }> {
  const tipo = await tx.uma('SELECT id FROM tipo_protocolo_oncologico WHERE id = ? AND ativo', [x.tipo]);
  if (!tipo) throw recusa('tipo-protocolo-inexistente', 'O tipo de protocolo não está no cadastro.');
  const versoes = await tx.consultarParaAtualizar(
    'SELECT id, versao_protocolo FROM protocolo_quimioterapia WHERE codigo = ?',
    [x.codigo],
  );
  const versao = Math.max(0, ...versoes.map((v) => n(v['versao_protocolo']))) + 1;
  const id = await tx.incluir('protocolo_quimioterapia', {
    estabelecimento_id: est,
    codigo: x.codigo,
    nome: x.nome,
    tipo_protocolo_oncologico_id: x.tipo,
    indicacao: x.indicacao,
    numero_ciclos: x.ciclos,
    intervalo_dias: x.intervaloDias,
    referencia_bibliografica: x.referencia,
    ativo: true,
    versao_protocolo: versao,
    hash_conteudo: x.hash,
    farmacos_publicados: JSON.stringify(x.farmacos),
    origem: 'sistema',
  });
  return { id, versao };
}

/** O último evento de inativação ou reativação do código (o protocolo inativo não é oferecido a ciclos novos). */
async function protocoloInativo(tx: TxOperacao, est: number, codigo: string): Promise<boolean> {
  const u = await tx.uma(
    `SELECT e.evento FROM evento_tratamento_oncologico e
       JOIN protocolo_quimioterapia p ON p.id = e.protocolo_quimioterapia_id
      WHERE e.estabelecimento_id = ? AND p.codigo = ? AND e.evento IN ('protocolo_inativado','protocolo_reativado')
      ORDER BY e.ocorrido_em DESC, e.id DESC LIMIT 1`,
    [est, codigo],
  );
  return texto(u?.['evento']) === 'protocolo_inativado';
}

/**
 * O ciclo do paciente: o curso existente recebe o ciclo; o curso seguinte abre o tratamento (diagnóstico oncológico
 * do paciente e intenção exigidos; sem o diagnóstico informado, vale o mais recente ativo do paciente).
 */
export async function registrarCiclo(
  tx: TxOperacao,
  est: number,
  atendimento: number,
  x: NovoCicloOncologico,
): Promise<number> {
  const [p] = await tx.consultarParaAtualizar(
    `SELECT id, codigo, revogado_em, tipo_protocolo_oncologico_id, numero_ciclos, intervalo_dias
       FROM protocolo_quimioterapia
      WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL) AND excluido_em IS NULL`,
    [x.protocolo, est],
  );
  if (!p) throw recusa('protocolo-inexistente', 'O protocolo não existe no estabelecimento.');
  if (p['revogado_em'])
    throw recusa(
      'versao-revogada',
      'Esta versão do protocolo foi revogada: não é oferecida a ciclos novos (os ciclos já registrados continuam com ela).',
    );
  const codigo = texto(p['codigo']);
  if (await protocoloInativo(tx, est, codigo))
    throw recusa('protocolo-inativo', 'O protocolo está inativo: reative-o ou escolha outro protocolo.');
  const tratamentos = await tx.consultarParaAtualizar(
    `SELECT t.id FROM tratamento_oncologico t JOIN protocolo_quimioterapia p ON p.id = t.protocolo_quimioterapia_id
      WHERE t.estabelecimento_id = ? AND t.paciente_id = ? AND p.codigo = ? AND t.excluido_em IS NULL ORDER BY t.id`,
    [est, x.paciente, codigo],
  );
  const curso = x.curso ?? 1;
  let tratamento: number;
  if (curso <= tratamentos.length) tratamento = n(tratamentos[curso - 1]!['id']);
  else if (curso === tratamentos.length + 1)
    tratamento = await abrirTratamento(tx, est, atendimento, x, {
      protocolo: n(p['id']),
      tipo: nn(p['tipo_protocolo_oncologico_id']),
      ciclos: n(p['numero_ciclos']),
      intervalo: n(p['intervalo_dias']),
    });
  else
    throw recusa(
      'curso-invalido',
      `O paciente tem ${tratamentos.length} tratamento(s) com o protocolo ${codigo}: o curso ${curso} não existe.`,
    );
  return tx.incluir('ciclo_quimioterapia', {
    tratamento_oncologico_id: tratamento,
    protocolo_quimioterapia_id: n(p['id']),
    numero_ciclo: x.numero,
    data_prevista: x.dataPrevista,
    peso_kg: x.pesoKg,
    altura_cm: x.alturaCm,
    superficie_corporal_m2: x.superficieM2,
    creatinina_mg_dl: x.creatininaMgDl,
    clearance_creatinina: x.clearanceMlMin,
    reducao_dose_percentual: x.reducaoPct,
    motivo_reducao: x.motivoReducao,
    justificativa_intervalo: x.justificativaIntervalo,
    doses_calculadas: JSON.stringify(x.doses),
    atendimento_id: atendimento,
    situacao: 'previsto',
    origem: 'sistema',
  });
}

async function abrirTratamento(
  tx: TxOperacao,
  est: number,
  atendimento: number,
  x: NovoCicloOncologico,
  p: { protocolo: number; tipo: number | null; ciclos: number; intervalo: number },
): Promise<number> {
  const diag = await tx.uma(
    `SELECT id FROM diagnostico_oncologico
      WHERE paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'inativado'
        ${x.diagnostico ? 'AND id = ?' : ''}
      ORDER BY diagnosticado_em DESC, id DESC LIMIT 1`,
    x.diagnostico ? [x.paciente, est, x.diagnostico] : [x.paciente, est],
  );
  const intencao = x.intencao
    ? await tx.uma('SELECT id FROM intencao_tratamento_oncologico WHERE id = ? AND ativo', [x.intencao])
    : null;
  if (!diag || !intencao || p.tipo === null)
    throw recusa(
      'tratamento-sem-diagnostico',
      'O ciclo abre um tratamento: informe o diagnóstico oncológico do paciente (registrado e ativo) e a intenção do tratamento; o protocolo precisa do tipo.',
    );
  const qtd = await tx.uma(
    'SELECT COUNT(*) AS n FROM tratamento_oncologico WHERE estabelecimento_id = ? AND paciente_id = ?',
    [est, x.paciente],
  );
  return tx.incluir('tratamento_oncologico', {
    estabelecimento_id: est,
    numero: `QT-${x.paciente}-${n(qtd?.['n']) + 1}`,
    paciente_id: x.paciente,
    atendimento_id: atendimento,
    diagnostico_oncologico_id: n(diag['id']),
    protocolo_quimioterapia_id: p.protocolo,
    tipo_protocolo_oncologico_id: p.tipo,
    intencao_tratamento_oncologico_id: n(intencao['id']),
    responsavel_profissional_id: x.vinculo,
    ciclos_previstos: p.ciclos,
    intervalo_ciclos_dias: p.intervalo,
    justificativa_protocolo: x.motivoCurso ? x.motivoCurso.slice(0, 1000) : null,
    data_inicio: x.dataPrevista,
    situacao: 'em_andamento',
    origem: 'sistema',
  });
}

/** O ciclo travado na transação, do estabelecimento, com as prescrições ligadas. */
async function travarCiclo(tx: TxOperacao, est: number, id: number) {
  const [c] = await tx.consultarParaAtualizar(
    `SELECT c.id, c.versao, c.situacao, c.validado_em, c.criado_por, DATE_FORMAT(c.data_prevista, '%Y-%m-%d') AS data_prevista,
            c.reducao_dose_percentual, c.motivo_reducao, c.justificativa_intervalo, c.doses_calculadas, t.paciente_id
       FROM ciclo_quimioterapia c JOIN tratamento_oncologico t ON t.id = c.tratamento_oncologico_id
      WHERE c.id = ? AND t.estabelecimento_id = ? AND c.excluido_em IS NULL`,
    [id, est],
  );
  if (!c) return null;
  const ligadas = await tx.consultar(
    'SELECT prescricao_id FROM ciclo_quimioterapia_prescricao WHERE ciclo_quimioterapia_id = ? AND desligado_em IS NULL',
    [id],
  );
  return { c, prescricoes: ligadas.map((l) => n(l['prescricao_id'])) };
}
const prescrito = (c: Record<string, unknown>) => texto(c['situacao']) === 'previsto' && !c['validado_em'];

/** A dupla checagem: outra pessoa (não quem prescreveu), uma vez, com a prescrição dos medicamentos ligada. */
export async function validarCiclo(tx: TxOperacao, est: number, x: ValidacaoCiclo): Promise<number> {
  const t = await travarCiclo(tx, est, x.id);
  const usuario = tx.contexto.usuario;
  if (
    !t ||
    !prescrito(t.c) ||
    usuario === null ||
    n(t.c['criado_por']) === usuario ||
    t.prescricoes.length === 0
  )
    throw recusa(
      'ciclo-nao-validavel',
      'O ciclo já foi validado, não existe, foi prescrito por você ou não tem a prescrição ligada: a validação é de outra pessoa, uma vez, com a prescrição dos medicamentos ligada.',
    );
  await tx.alterar('ciclo_quimioterapia', x.id, n(t.c['versao']), {
    situacao: 'liberado',
    validado_por_usuario_id: usuario,
    validado_em: new Date(),
    observacao_validacao: x.observacao ? x.observacao.slice(0, 300) : null,
    doses_validadas: JSON.stringify(x.doses),
  });
  return x.id;
}

/** Liga a prescrição geral do paciente ao ciclo ainda não validado (a desligada antes volta a valer). */
export async function vincularPrescricao(
  tx: TxOperacao,
  est: number,
  x: VinculoPrescricaoCiclo,
): Promise<number> {
  const t = await travarCiclo(tx, est, x.ciclo);
  if (!t || !prescrito(t.c))
    throw recusa(
      'ciclo-nao-vinculavel',
      'O ciclo não existe ou já foi validado: a prescrição se liga ao ciclo antes da validação.',
    );
  if (x.dataPrevista !== undefined && texto(t.c['data_prevista']) !== x.dataPrevista)
    throw recusa(
      'ciclo-desatualizado',
      'A data prevista do ciclo mudou (outra pessoa o ajustou): abra de novo e escolha a prescrição da data nova.',
    );
  const pr = await tx.uma(
    'SELECT id FROM prescricao WHERE id = ? AND estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL',
    [x.prescricao, est, n(t.c['paciente_id'])],
  );
  if (!pr) throw recusa('prescricao-inexistente', 'A prescrição não é deste paciente no estabelecimento.');
  const [lig] = await tx.consultarParaAtualizar(
    'SELECT id, versao, desligado_em FROM ciclo_quimioterapia_prescricao WHERE ciclo_quimioterapia_id = ? AND prescricao_id = ?',
    [x.ciclo, x.prescricao],
  );
  if (lig && !lig['desligado_em'])
    throw recusa('registro-duplicado', 'A prescrição já está ligada a este ciclo.');
  if (lig)
    await tx.alterar('ciclo_quimioterapia_prescricao', n(lig['id']), n(lig['versao']), {
      ligado_em: new Date(),
      desligado_em: null,
      motivo_desligamento: null,
    });
  else
    await tx.incluir('ciclo_quimioterapia_prescricao', {
      ciclo_quimioterapia_id: x.ciclo,
      prescricao_id: x.prescricao,
      ligado_em: new Date(),
    });
  return x.ciclo;
}

/** Desfaz a ligação (o ciclo ainda não validado), com a data e o motivo; o evento guarda o histórico. */
export async function desligarPrescricao(
  tx: TxOperacao,
  est: number,
  x: { ciclo: number; prescricao: number; motivo?: string },
): Promise<number> {
  const t = await travarCiclo(tx, est, x.ciclo);
  const [lig] = await tx.consultarParaAtualizar(
    'SELECT id, versao FROM ciclo_quimioterapia_prescricao WHERE ciclo_quimioterapia_id = ? AND prescricao_id = ? AND desligado_em IS NULL',
    [x.ciclo, x.prescricao],
  );
  if (!t || texto(t.c['validado_em']) !== '' || !lig)
    throw recusa(
      'ligacao-nao-desfeita',
      'A prescrição não está ligada a este ciclo, ou o ciclo já foi validado.',
    );
  await tx.alterar('ciclo_quimioterapia_prescricao', n(lig['id']), n(lig['versao']), {
    desligado_em: new Date(),
    motivo_desligamento: (x.motivo?.trim() || 'Ligação desfeita (motivo no evento do ciclo)').slice(0, 200),
  });
  return x.ciclo;
}

/** Muda o andamento (suspender, retomar, cancelar) se o atual é um dos esperados. */
export async function mudarAndamentoCiclo(
  tx: TxOperacao,
  est: number,
  x: { id: number; de: readonly AndamentoCicloLido[]; para: AndamentoCicloLido },
): Promise<number> {
  const t = await travarCiclo(tx, est, x.id);
  if (!t || !x.de.includes(andamentoDe(texto(t.c['situacao']))))
    throw recusa('ciclo-desatualizado', 'O andamento do ciclo mudou (outra pessoa agiu nele). Abra de novo.');
  const situacao = x.para === 'ativo' ? (t.c['validado_em'] ? 'liberado' : 'previsto') : x.para;
  await tx.alterar('ciclo_quimioterapia', x.id, n(t.c['versao']), { situacao });
  return x.id;
}

/** Ajusta o ciclo não validado e devolve a versão anterior (a prescrição ligada trava a data e a redução). */
export async function ajustarCiclo(
  tx: TxOperacao,
  est: number,
  x: AjusteCiclo,
): Promise<VersaoCicloAnterior> {
  const t = await travarCiclo(tx, est, x.id);
  if (!t || !prescrito(t.c))
    throw recusa(
      'ciclo-validado',
      'O ciclo já foi validado pelo farmacêutico (ou não está ativo) e não se edita.',
    );
  const c = t.c;
  if (
    t.prescricoes.length > 0 &&
    (texto(c['data_prevista']) !== x.dataPrevista || n(c['reducao_dose_percentual']) !== x.reducaoPct)
  )
    throw recusa(
      'ciclo-com-prescricao',
      'O ciclo tem prescrição ligada, emitida para a data e as doses atuais: desfaça a ligação antes de mudar a data ou a redução e ligue a prescrição nova depois.',
    );
  const antes: VersaoCicloAnterior = {
    dataPrevista: texto(c['data_prevista']),
    reducaoPct: n(c['reducao_dose_percentual']),
    motivoReducao: textoOuNulo(c['motivo_reducao']),
    justificativaIntervalo: textoOuNulo(c['justificativa_intervalo']),
    doses: json<DoseCalculada[]>(c['doses_calculadas'], []).map((d) => ({
      farmaco: d.farmaco,
      final: d.final,
    })),
  };
  await tx.alterar('ciclo_quimioterapia', x.id, n(c['versao']), {
    data_prevista: x.dataPrevista,
    reducao_dose_percentual: x.reducaoPct,
    motivo_reducao: x.motivoReducao,
    justificativa_intervalo: x.justificativaIntervalo,
    doses_calculadas: JSON.stringify(x.doses),
  });
  return antes;
}

/** O evento do protocolo ou do ciclo (nunca apagado). Sem protocolo nem ciclo, vale a versão mais nova do código. */
export async function registrarEventoOnco(
  tx: TxOperacao,
  est: number,
  x: NovoEventoOncologico,
): Promise<number> {
  const usuario = tx.contexto.usuario;
  if (usuario === null) throw recusa('sem-usuario', 'O evento precisa do usuário da sessão.');
  let protocolo = x.protocolo;
  if (protocolo === null && x.ciclo === null) {
    const p = await tx.uma(
      `SELECT id FROM protocolo_quimioterapia WHERE codigo = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
          AND excluido_em IS NULL ORDER BY versao_protocolo DESC LIMIT 1`,
      [x.codigoProtocolo, est],
    );
    if (!p) throw recusa('protocolo-inexistente', 'O protocolo não existe no estabelecimento.');
    protocolo = n(p['id']);
  }
  return tx.incluir('evento_tratamento_oncologico', {
    estabelecimento_id: est,
    protocolo_quimioterapia_id: protocolo,
    ciclo_quimioterapia_id: x.ciclo,
    prescricao_id: x.prescricao,
    evento: x.evento.replace(/-/g, '_'),
    categoria: x.categoria,
    ciclos_afetados: x.ciclosAfetados,
    versao_anterior: x.antes,
    motivo: x.motivo.slice(0, 300),
    ocorrido_em: new Date(),
    usuario_id: usuario,
  });
}

/** Revoga a versão: recontagem dos ciclos em andamento na transação (mais que na ciência recusa). */
export async function revogarVersao(
  tx: TxOperacao,
  est: number,
  x: RevogacaoVersaoProtocolo,
): Promise<number> {
  const [p] = await tx.consultarParaAtualizar(
    `SELECT id, versao, revogado_em FROM protocolo_quimioterapia
      WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL) AND excluido_em IS NULL`,
    [x.protocolo, est],
  );
  if (!p) throw recusa('protocolo-inexistente', 'O protocolo não existe no estabelecimento.');
  if (p['revogado_em']) throw recusa('versao-ja-revogada', 'A versão do protocolo já foi revogada.');
  const cont = await tx.uma(
    `SELECT COUNT(*) AS total, COALESCE(SUM(c.situacao <> 'cancelado'), 0) AS em_andamento
       FROM ciclo_quimioterapia c JOIN tratamento_oncologico t ON t.id = c.tratamento_oncologico_id
      WHERE t.estabelecimento_id = ? AND c.excluido_em IS NULL
        AND COALESCE(c.protocolo_quimioterapia_id, t.protocolo_quimioterapia_id) = ?`,
    [est, x.protocolo],
  );
  const emAndamento = n(cont?.['em_andamento']);
  if (emAndamento > x.emAndamentoCiente)
    throw recusa(
      'versao-com-ciclos',
      `${emAndamento} ciclo(s) em andamento usam a versão agora (eram ${x.emAndamentoCiente} na ciência): veja a lista de novo e confirme.`,
    );
  await tx.alterar('protocolo_quimioterapia', x.protocolo, n(p['versao']), {
    revogado_em: new Date(),
    motivo_revogacao: x.motivo.slice(0, 200),
  });
  return registrarEventoOnco(tx, est, {
    evento: 'versao-revogada',
    codigoProtocolo: x.codigoProtocolo,
    protocolo: x.protocolo,
    ciclo: null,
    prescricao: null,
    categoria: null,
    ciclosAfetados: n(cont?.['total']),
    antes: null,
    motivo: x.motivo,
    vinculo: x.vinculo,
    usuario: x.usuario,
  });
}
