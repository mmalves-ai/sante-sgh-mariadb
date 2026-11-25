// Porta do SESMT (M52.5) sobre o banco do cliente, pelo @sgh/nucleo: leituras numa transação somente leitura; gravações
// diretas numa operação do Executor (gravacaoDireta: trilha, outbox e idempotência na mesma transação, com as tabelas
// declaradas). Tabelas: aso e exame_ocupacional (prontuário ocupacional), vacina_colaborador e vacina_ocupacional,
// comunicacao_acidente e exposicao_biologica (acidente, CAT e profilaxia), risco_funcao e epi_funcao (mapa de riscos,
// pela função e pelo ambiente de trabalho), entrega_epi e equipamento_protecao, e os domínios oficiais do eSocial
// (codigo_esocial, fator_risco_ocupacional). Toda leitura filtra o estabelecimento da sessão e os registros excluídos;
// a vacina é do colaborador (vale na rede inteira) e os domínios oficiais não têm estabelecimento.
// Melhoria: retificação do ASO e da vacina sem apagar nada: o registro anterior sai da lista (excluido_em, com quem e
// quando) e o motivo, o valor anterior e o novo ficam na trilha da mesma transação.
// Melhoria: as horas trabalhadas antes do acidente são guardadas em minutos; a CAT emitida fica com quem emitiu (usuário)
// e o recibo; o prazo da CAT é recalculado pela regra do domínio (prazoCat), nunca guardado à mão.
// Melhoria: a linha do mapa de riscos liga a função, o ambiente e o fator oficial por chave (nada de texto solto); o
// ambiente é o do setor informado ou o do setor da função, casado pelo id, e sem um único ambiente a linha é recusada
// (`ambiente-inexistente` ou `ambiente-ambiguo`), nunca gravada num ambiente qualquer; a entrega de EPI leva o CA do
// cadastro do equipamento quando a tela não o informa.
// Melhoria: datas e horas pelo fuso do estabelecimento (estabelecimento.fuso_horario): o instante vai ao banco em UTC
// (instanteCivil) e volta à tela na hora civil (civil); a data da alta é a do relógio do estabelecimento.
// Melhoria: a retificação do ASO religa ao ASO novo os exames ocupacionais do anterior (na mesma transação, versão e
// trilha de cada exame), e eles continuam no prontuário.
// Melhoria: as correções (valor anterior e novo) são lidas pela chave da trilha (entidade e entidade_id, indexada),
// nunca varrendo a trilha do estabelecimento.
// O acompanhamento sorológico é sorologia_exposicao; o encerramento do acidente (com ou sem material biológico) fica
// na comunicação (encerrado_em, quem e o motivo) e, com exposição, a exposição recebe a alta; a profilaxia guarda a
// situação, a data e a observação; o anti-HBs é a dose "sorologia" com o título; a retificação liga o registro novo ao
// anterior (retifica_aso_id com o motivo, retifica_vacina_colaborador_id).
// C1-119: a leitura do dosímetro (leitura_dosimetria: período, dosímetro e dose em mSv) e a exposição a quimioterápico
// (exposicao_quimioterapico: agente e duração) têm tabela própria; o registro de proteção é endereçado pelo tipo junto
// do id (o id se repete entre as três tabelas). O cancelamento marca a linha (situacao 'cancelado' com o motivo), nunca
// apaga; a leitura cancelada libera o mesmo período para a leitura certa (migração 15_RH/94).
import { DOSES_VACINA_SESMT, type DoseVacinaSesmt, VACINAS_SESMT, type VacinaSesmt } from '@sgh/contratos';
import { chaveFuncao, prazoCat } from '@sgh/dominio-pessoas';
import {
  type Carimbo,
  type ContextoNucleo,
  type ContextoOperacao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { type AnotacaoGravacao, gravacaoDireta } from '../../enfermagem/gravacao-direta.js';
import type { GravacaoFeita, LiberacaoGravacao, TrilhaDaGravacao } from '../../exames/public-api.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import { civil, FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../../exames/relogio.js';
import {
  type AcidenteTrabalho,
  type ContextoSesmt,
  type CorrecaoSesmt,
  type DadosCat,
  type DominiosSesmt,
  type DoseVacinaColaborador,
  type FiltroAcidentesPorta,
  type FiltroRiscosPorta,
  type GravadorSesmt,
  type LinhaRiscoFuncao,
  METODOS_PORTA_SESMT,
  type OpcaoDominioSesmt,
  type OpcaoDominioSesmtTexto,
  type PortaSesmt,
  type RegistroOcupacional,
  type RegistroProtecao,
  type ResumoSesmt,
  type TipoProtecao,
  type SorologiaAcidente,
  type VinculoAtivoSesmt,
} from './porta-sesmt.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoSesmt = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
type Ler = Pick<Leitor, 'consultar' | 'uma'>;

/** Tabelas que as gravações do SESMT declaram ao Executor. */
export const TABELAS_SESMT = [
  'aso',
  'exame_ocupacional',
  'vacina_colaborador',
  'vacina_ocupacional',
  'comunicacao_acidente',
  'exposicao_biologica',
  'sorologia_exposicao',
  'risco_funcao',
  'epi_funcao',
  'entrega_epi',
  'leitura_dosimetria',
  'exposicao_quimioterapico',
  'sequencia_negocio',
] as const;

// ── Conversões ────────────────────────────────────────────────────────────────────────────────────────────────

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const ou = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const sim = (v: unknown) => v === true || v === 1 || v === '1';
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
/** Instante do banco (DATETIME em UTC) → "AAAA-MM-DDTHH:MM" na hora civil do estabelecimento. */
const dataHora = (v: unknown, fuso: string): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return null;
  const c = civil(d, fuso);
  return `${c.data}T${c.hora}`;
};
/** A data civil (no fuso do estabelecimento) de um instante do banco. */
const dataCivil = (v: unknown, fuso: string): string | null => dataHora(v, fuso)?.slice(0, 10) ?? null;
/** "AAAA-MM-DD" ou "AAAA-MM-DDTHH:MM" civil da tela → instante (UTC) pelo fuso do estabelecimento. */
const paraInstante = (v: string, fuso: string): Date =>
  instanteCivil(v.slice(0, 10), v.length > 10 ? v.slice(11, 16).replace(':', '') : '0000', fuso);
/** O fuso do cadastro do estabelecimento (o padrão sem ele). */
async function fusoDe(l: Pick<Leitor, 'uma'>, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}
const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const inverter = <K extends string | number, V extends string>(m: Readonly<Record<K, V>>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<string, string>;

/** Natureza do ASO: o código da tela (o mesmo do contrato, naturezaAso) e o tipo do modelo. */
const TIPO_ASO: Readonly<Record<number, string>> = {
  0: 'admissional',
  1: 'periodico',
  2: 'retorno_trabalho',
  3: 'mudanca_risco',
  4: 'monitoracao_pontual',
  9: 'demissional',
};
const ROTULO_TIPO_ASO: Readonly<Record<number, string>> = {
  0: 'Admissional',
  1: 'Periódico',
  2: 'Retorno ao trabalho',
  3: 'Mudança de risco ocupacional',
  4: 'Monitoração pontual',
  9: 'Demissional',
};
const CODIGO_TIPO_ASO = inverter(TIPO_ASO);
const CONCLUSAO_ASO: Readonly<Record<number, string>> = { 1: 'apto', 2: 'inapto' };
const CODIGO_CONCLUSAO = inverter(CONCLUSAO_ASO);
/** Tipo da CAT (tpCat do S-2210) e iniciativa (indCatObito/iniciat do leiaute). */
const TIPO_CAT: Readonly<Record<number, string>> = { 1: 'inicial', 2: 'reabertura', 3: 'obito' };
const CODIGO_TIPO_CAT = inverter(TIPO_CAT);
const INICIATIVA_CAT: Readonly<Record<number, string>> = {
  1: 'empregador',
  2: 'ordem_judicial',
  3: 'determinacao_orgao',
};
const CODIGO_INICIATIVA = inverter(INICIATIVA_CAT);
/** Tipo de local do acidente (tpLocal do S-2210). */
const LOCAL_CAT: Readonly<Record<number, string>> = {
  1: 'estabelecimento_empregador',
  2: 'exterior',
  3: 'estabelecimento_terceiro',
  4: 'via_publica',
  5: 'area_rural',
  6: 'embarcacao',
  9: 'outros',
};
const CODIGO_LOCAL = inverter(LOCAL_CAT);
const LATERALIDADE: Readonly<Record<number, string>> = {
  0: 'nao_aplicavel',
  1: 'esquerda',
  2: 'direita',
  3: 'ambas',
};
const CODIGO_LATERALIDADE = inverter(LATERALIDADE);
/** Uso e eficácia do EPC (risco_funcao.situacao_epc). */
const EPC: Readonly<Record<number, string>> = {
  0: 'nao_aplicavel',
  1: 'nao_utiliza',
  2: 'utiliza_eficaz',
  3: 'utiliza_ineficaz',
};
const ROTULO_EPC: Readonly<Record<number, string>> = {
  0: 'Não se aplica',
  1: 'Não utiliza',
  2: 'Utiliza, eficaz',
  3: 'Utiliza, ineficaz',
};
const CODIGO_EPC = inverter(EPC);
const GRUPOS_RISCO: readonly OpcaoDominioSesmtTexto[] = [
  { codigo: 'fisico', rotulo: 'Físico' },
  { codigo: 'quimico', rotulo: 'Químico' },
  { codigo: 'biologico', rotulo: 'Biológico' },
  { codigo: 'ergonomico', rotulo: 'Ergonômico' },
  { codigo: 'mecanico_acidente', rotulo: 'Mecânico ou de acidente' },
  { codigo: 'associacao', rotulo: 'Associação de fatores' },
  { codigo: 'ausencia', rotulo: 'Ausência de fator de risco' },
];
/** Dose da tela (DOSES_VACINA_SESMT) → dose do modelo. */
const DOSE_MODELO: Readonly<Record<string, string>> = {
  '1': 'primeira',
  '2': 'segunda',
  '3': 'terceira',
  reforco: 'reforco',
  unica: 'unica',
};
const DOSE_TELA = inverter(DOSE_MODELO);
const CODIGOS_DOSE = Object.keys(DOSES_VACINA_SESMT) as DoseVacinaSesmt[];
/** Exposição e material biológico: o vocabulário da tela usa hífen, o do modelo, sublinhado. */
const MATERIAL_MODELO: Readonly<Record<string, string>> = {
  sangue: 'sangue',
  'fluido-com-sangue': 'fluido_com_sangue',
  'fluido-sem-sangue': 'secrecao',
  outro: 'outro',
};
const MATERIAL_TELA = inverter(MATERIAL_MODELO);
const TESTE_FONTE: Readonly<Record<string, string>> = {
  reagente: 'positivo',
  'nao-reagente': 'negativo',
  'nao-testada': 'nao_realizado',
};
const TESTE_TELA = inverter(TESTE_FONTE);
const SITUACOES_PROFILAXIA = new Set(['nao-indicada', 'indicada', 'iniciada', 'recusada']);
/** Tabelas oficiais do eSocial dos domínios do acidente. */
const TABELA_PARTES = '13';
const TABELAS_AGENTES = ['14', '15'];
const TABELA_SITUACOES = '16';
const TABELA_NATUREZAS = '17';

/** Duração "HH:MM" do contrato (até 99:59) → minutos guardados (e o caminho de volta). */
function minutosDe(duracao: string | null): number | null {
  const m = duracao === null ? null : /^(\d{2}):([0-5]\d)$/.exec(duracao);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function duracaoDe(min: unknown): string | null {
  if (min === null || min === undefined) return null;
  const m = Number(min);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const naoEncontrado = (o: string) =>
  new ErroOperacao(404, 'nao-encontrado', `${o} não encontrado`, `${o} não existe neste estabelecimento.`);

// ── SQL das leituras ──────────────────────────────────────────────────────────────────────────────────────────

const SQL_ASO = `
  SELECT a.id, a.vinculo_trabalho_id, a.tipo, a.data_exame, a.conclusao, a.restricoes, a.medico_nome,
         a.medico_registro_conselho, a.validade_ate, a.observacao, a.criado_em, a.retifica_aso_id,
         a.motivo_retificacao, u.login AS criado_login
    FROM aso a LEFT JOIN usuario u ON u.id = a.criado_por
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.vinculo_trabalho_id IS NOT NULL`;

const SQL_EXAME = `
  SELECT x.id, x.aso_id, a.vinculo_trabalho_id, x.descricao, x.data_exame, x.indicacao_resultado, x.criado_em,
         u.login AS criado_login
    FROM exame_ocupacional x JOIN aso a ON a.id = x.aso_id LEFT JOIN usuario u ON u.id = x.criado_por
   WHERE a.estabelecimento_id = ? AND x.excluido_em IS NULL AND a.excluido_em IS NULL`;

/** A vacina é do colaborador (vale na rede inteira); o vínculo da sessão filtra o estabelecimento. */
const SQL_VACINA = `
  SELECT vc.id, v.id AS vinculo, vc.dose, vc.data_aplicacao, vc.lote, vc.validade_lote, vc.observacao,
         vc.titulo_anti_hbs, vc.retifica_vacina_colaborador_id, vo.codigo AS vacina, u.login AS criado_login
    FROM vacina_colaborador vc
    JOIN vacina_ocupacional vo ON vo.id = vc.vacina_ocupacional_id
    JOIN vinculo_trabalho v ON v.colaborador_id = vc.colaborador_id
    LEFT JOIN usuario u ON u.id = vc.criado_por
   WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL AND vc.excluido_em IS NULL`;

const SQL_ACIDENTE = `
  SELECT ca.id, ca.vinculo_trabalho_id, ca.tipo, ca.iniciativa, ca.tipo_acidente, ca.acidente_em,
         ca.minutos_trabalhados_antes, ca.houve_afastamento, ca.ultimo_dia_trabalhado, ca.houve_obito, ca.obito_em,
         ca.comunicado_policia, ca.tipo_local, ca.local_descricao, ca.local_cep, ca.local_logradouro, ca.local_numero,
         ca.agente_causador_codigo_esocial_id, ca.situacao_geradora_codigo_esocial_id,
         ca.parte_atingida_codigo_esocial_id, ca.lateralidade, ca.natureza_lesao_codigo_esocial_id, ca.descricao_lesao,
         ca.descricao_acidente, ca.atendido_em, ca.duracao_tratamento_dias, ca.internacao, ca.cid_codigo,
         ca.diagnostico_provavel, ca.medico_nome, ca.medico_registro_conselho, ca.medico_uf_conselho, ca.emitida_em,
         ca.numero_recibo, ca.situacao, ca.versao, ca.alterado_em,
         e.id AS exposicao_id, e.tipo_exposicao, e.material_biologico, e.fonte_conhecida, e.fonte_hiv,
         e.profilaxia_antirretroviral, e.conduta, e.situacao AS situacao_exposicao, e.data_alta,
         e.situacao_profilaxia, e.profilaxia_em, e.observacao_profilaxia, ca.encerrado_em, ca.motivo_encerramento,
         uc.login AS criado_login, ue.login AS emissor_login, ua.login AS alterado_login, un.login AS encerrado_login
    FROM comunicacao_acidente ca
    LEFT JOIN exposicao_biologica e ON e.comunicacao_acidente_id = ca.id AND e.excluido_em IS NULL
    LEFT JOIN usuario uc ON uc.id = ca.criado_por
    LEFT JOIN usuario ue ON ue.id = ca.emissor_usuario_id
    LEFT JOIN usuario ua ON ua.id = ca.alterado_por
    LEFT JOIN usuario un ON un.id = ca.encerrado_por
   WHERE ca.estabelecimento_id = ? AND ca.excluido_em IS NULL AND ca.vinculo_trabalho_id IS NOT NULL`;

const SQL_ENTREGA = `
  SELECT x.id, x.vinculo_trabalho_id, x.data_entrega, ep.nome AS epi, x.numero_ca, x.validade_ca, x.quantidade,
         x.ciencia_conferida, x.ciencia_em, x.observacao, x.situacao, x.motivo_cancelamento, x.alterado_em,
         uc.login AS criado_login, ua.login AS alterado_login
    FROM entrega_epi x
    JOIN vinculo_trabalho v ON v.id = x.vinculo_trabalho_id
    JOIN equipamento_protecao ep ON ep.id = x.equipamento_protecao_id
    LEFT JOIN usuario uc ON uc.id = x.criado_por
    LEFT JOIN usuario ua ON ua.id = x.alterado_por
   WHERE v.estabelecimento_id = ? AND x.excluido_em IS NULL`;

const SQL_DOSIMETRIA = `
  SELECT x.id, x.vinculo_trabalho_id, x.periodo_inicio, x.periodo_fim, x.dosimetro, x.dose_msv, x.observacao,
         x.situacao, x.motivo_cancelamento, x.alterado_em, uc.login AS criado_login, ua.login AS alterado_login
    FROM leitura_dosimetria x
    JOIN vinculo_trabalho v ON v.id = x.vinculo_trabalho_id
    LEFT JOIN usuario uc ON uc.id = x.criado_por
    LEFT JOIN usuario ua ON ua.id = x.alterado_por
   WHERE v.estabelecimento_id = ? AND x.excluido_em IS NULL`;

const SQL_QUIMIO = `
  SELECT x.id, x.vinculo_trabalho_id, x.data_exposicao, x.agente, x.duracao_minutos, x.observacao,
         x.situacao, x.motivo_cancelamento, x.alterado_em, uc.login AS criado_login, ua.login AS alterado_login
    FROM exposicao_quimioterapico x
    JOIN vinculo_trabalho v ON v.id = x.vinculo_trabalho_id
    LEFT JOIN usuario uc ON uc.id = x.criado_por
    LEFT JOIN usuario ua ON ua.id = x.alterado_por
   WHERE v.estabelecimento_id = ? AND x.excluido_em IS NULL`;

const SQL_RISCO = `
  SELECT r.id, r.vigencia_inicio, r.vigencia_fim, r.situacao_epc, r.descricao_epc, f.nome AS funcao,
         s.unidade_assistencial_id AS unidade, s.nome AS setor, fr.codigo_esocial, fr.grupo
    FROM risco_funcao r
    JOIN ambiente_trabalho a ON a.id = r.ambiente_trabalho_id
    JOIN funcao f ON f.id = r.funcao_id
    JOIN fator_risco_ocupacional fr ON fr.id = r.fator_risco_ocupacional_id
    LEFT JOIN setor_funcional s ON s.id = a.setor_funcional_id
   WHERE a.estabelecimento_id = ? AND r.excluido_em IS NULL`;

const SQL_EPI_FUNCAO = `
  SELECT ef.id, ef.vigencia_inicio, ef.vigencia_fim, f.nome AS funcao, s.unidade_assistencial_id AS unidade,
         s.nome AS setor, ep.nome AS epi
    FROM epi_funcao ef
    JOIN funcao f ON f.id = ef.funcao_id
    JOIN equipamento_protecao ep ON ep.id = ef.equipamento_protecao_id
    LEFT JOIN setor_funcional s ON s.id = f.setor_funcional_id
   WHERE f.estabelecimento_id = ? AND ef.excluido_em IS NULL`;

const SQL_SOROLOGIA = `
  SELECT so.id, ca.id AS acidente, so.marco, so.data_prevista, so.data_realizada, so.resultado, so.observacao
    FROM sorologia_exposicao so
    JOIN exposicao_biologica e ON e.id = so.exposicao_biologica_id
    JOIN comunicacao_acidente ca ON ca.id = e.comunicacao_acidente_id
   WHERE ca.estabelecimento_id = ? AND so.excluido_em IS NULL`;

// ── Montagem dos tipos de negócio ─────────────────────────────────────────────────────────────────────────────

function asoDe(r: Linha, fuso: string): RegistroOcupacional {
  return {
    id: Number(r['id']),
    vinculo: Number(r['vinculo_trabalho_id']),
    registro: 'aso',
    aso: null,
    tipo: CODIGO_TIPO_ASO[texto(r['tipo'])] === undefined ? null : Number(CODIGO_TIPO_ASO[texto(r['tipo'])]),
    data: dataIso(r['data_exame']) ?? '',
    exame: null,
    resultadoExame: null,
    conclusao:
      CODIGO_CONCLUSAO[texto(r['conclusao'])] === undefined
        ? null
        : Number(CODIGO_CONCLUSAO[texto(r['conclusao'])]),
    restricoes: ou(r['restricoes']),
    medico: ou(r['medico_nome']),
    medicoConselho: ou(r['medico_registro_conselho']),
    proximo: dataIso(r['validade_ate']),
    observacao: ou(r['observacao']),
    retifica: num(r['retifica_aso_id']),
    motivoRetificacao: ou(r['motivo_retificacao']),
    criadoPor: texto(r['criado_login']),
    criadoEm: dataHora(r['criado_em'], fuso) ?? '',
  };
}

function exameDe(r: Linha, fuso: string): RegistroOcupacional {
  const res = texto(r['indicacao_resultado']);
  return {
    id: Number(r['id']),
    vinculo: Number(r['vinculo_trabalho_id']),
    registro: 'exame',
    aso: Number(r['aso_id']),
    tipo: null,
    data: dataIso(r['data_exame']) ?? '',
    exame: ou(r['descricao']),
    resultadoExame: res === 'normal' || res === 'alterado' ? res : null,
    conclusao: null,
    restricoes: null,
    medico: null,
    medicoConselho: null,
    proximo: null,
    observacao: null,
    retifica: null,
    motivoRetificacao: null,
    criadoPor: texto(r['criado_login']),
    criadoEm: dataHora(r['criado_em'], fuso) ?? '',
  };
}

function vacinaDe(r: Linha): DoseVacinaColaborador {
  const dose = texto(r['dose']);
  const antiHbs = dose === 'sorologia';
  return {
    id: Number(r['id']),
    vinculo: Number(r['vinculo']),
    registro: antiHbs ? 'anti-hbs' : 'dose',
    vacina: texto(r['vacina']),
    dose: antiHbs ? null : (DOSE_TELA[dose] ?? null),
    data: dataIso(r['data_aplicacao']) ?? '',
    lote: ou(r['lote']),
    validadeLote: dataIso(r['validade_lote']),
    antiHbs: antiHbs ? num(r['titulo_anti_hbs']) : null,
    observacao: ou(r['observacao']),
    retifica: num(r['retifica_vacina_colaborador_id']),
    motivoRetificacao: null,
    criadoPor: texto(r['criado_login']),
  };
}

function catDe(r: Linha, fuso: string): DadosCat {
  const atendido = dataHora(r['atendido_em'], fuso);
  return {
    horasAntes: duracaoDe(r['minutos_trabalhados_antes']),
    lateralidade: num(CODIGO_LATERALIDADE[texto(r['lateralidade'])] ?? null),
    comunicouPolicia: sim(r['comunicado_policia']),
    dataObito: dataIso(r['obito_em']),
    ultimoDiaTrabalhado: dataIso(r['ultimo_dia_trabalhado']),
    observacao: null,
    reciboOrigem: null,
    localTipo: num(CODIGO_LOCAL[texto(r['tipo_local'])] ?? null),
    logradouro: ou(r['local_logradouro']),
    numero: ou(r['local_numero']),
    cep: ou(r['local_cep']),
    municipio: null,
    uf: null,
    atestadoData: atendido ? atendido.slice(0, 10) : null,
    atestadoHora: atendido ? atendido.slice(11, 16) : null,
    internacao: sim(r['internacao']),
    duracaoDias: num(r['duracao_tratamento_dias']),
    complementoLesao: ou(r['descricao_lesao']),
    diagnostico: ou(r['diagnostico_provavel']),
    cid: ou(r['cid_codigo']),
    emitenteNome: ou(r['medico_nome']),
    emitenteConselho: null,
    emitenteNumero: ou(r['medico_registro_conselho']),
    emitenteUf: ou(r['medico_uf_conselho']),
  };
}

function profilaxiaDe(r: Linha): string {
  const situacao = texto(r['situacao_profilaxia']).replace(/_/g, '-');
  // A situação gravada vale; a linha anterior à coluna fica com o padrão do banco e cai na conduta.
  if (SITUACOES_PROFILAXIA.has(situacao) && (situacao !== 'nao-indicada' || r['profilaxia_em'] !== null))
    return situacao;
  const conduta = texto(r['conduta']);
  if (SITUACOES_PROFILAXIA.has(conduta)) return conduta;
  return sim(r['profilaxia_antirretroviral']) ? 'iniciada' : 'nao-indicada';
}

function acidenteDe(r: Linha, fuso: string): AcidenteTrabalho {
  const biologico = r['exposicao_id'] !== null && r['exposicao_id'] !== undefined;
  const situacao = texto(r['situacao']);
  const emitida = situacao !== 'rascunho' && situacao !== 'cancelada' && r['emitida_em'] !== null;
  const exposicao = texto(r['tipo_exposicao']);
  const ocorridoEm = dataHora(r['acidente_em'], fuso) ?? '';
  const encerradoNaComunicacao = r['encerrado_em'] !== null && r['encerrado_em'] !== undefined;
  const encerrado = encerradoNaComunicacao || (biologico && texto(r['situacao_exposicao']) === 'alta');
  return {
    id: Number(r['id']),
    vinculo: Number(r['vinculo_trabalho_id']),
    ocorridoEm,
    tipo: texto(r['tipo_acidente']),
    unidade: null,
    local: texto(r['local_descricao']),
    descricao: texto(r['descricao_acidente']),
    biologico,
    perfurocortante: biologico && exposicao === 'percutanea',
    exposicao: biologico ? exposicao.replace(/_/g, '-') : null,
    material: biologico ? (MATERIAL_TELA[texto(r['material_biologico'])] ?? 'outro') : null,
    fonte: biologico ? (sim(r['fonte_conhecida']) ? 'conhecida' : 'desconhecida') : null,
    fonteTeste: biologico ? (TESTE_TELA[texto(r['fonte_hiv'])] ?? null) : null,
    parteCorpo: num(r['parte_atingida_codigo_esocial_id']),
    natureza: num(r['natureza_lesao_codigo_esocial_id']),
    agente: num(r['agente_causador_codigo_esocial_id']),
    situacao: num(r['situacao_geradora_codigo_esocial_id']),
    afastamento: sim(r['houve_afastamento']),
    obito: sim(r['houve_obito']),
    profilaxia: biologico ? profilaxiaDe(r) : 'nao-indicada',
    profilaxiaEm: biologico ? dataIso(r['profilaxia_em']) : null,
    profilaxiaObs: biologico ? ou(r['observacao_profilaxia']) : null,
    catPrazo: ocorridoEm ? prazoCat(ocorridoEm, sim(r['houve_obito'])) : '',
    tipoCat: emitida ? num(CODIGO_TIPO_CAT[texto(r['tipo'])] ?? null) : null,
    iniciativaCat: emitida ? num(CODIGO_INICIATIVA[texto(r['iniciativa'])] ?? null) : null,
    catNumero: emitida ? ou(r['numero_recibo']) : null,
    catEmitidaEm: emitida ? dataCivil(r['emitida_em'], fuso) : null,
    catEmitidaPor: emitida ? ou(r['emissor_login']) : null,
    estado: encerrado ? 'encerrado' : 'aberto',
    encerradoEm: encerradoNaComunicacao
      ? dataCivil(r['encerrado_em'], fuso)
      : encerrado
        ? dataIso(r['data_alta'])
        : null,
    encerradoPor: encerradoNaComunicacao ? ou(r['encerrado_login']) : null,
    motivoEncerramento: encerradoNaComunicacao ? ou(r['motivo_encerramento']) : null,
    versao: Number(r['versao']),
    criadoPor: texto(r['criado_login']),
    cat: catDe(r, fuso),
    anuladoEm: situacao === 'cancelada' ? dataHora(r['alterado_em'], fuso) : null,
    anuladoPor: situacao === 'cancelada' ? ou(r['alterado_login']) : null,
  };
}

function entregaDe(r: Linha, fuso: string): RegistroProtecao {
  const cancelada = texto(r['situacao']) === 'cancelado';
  return {
    id: Number(r['id']),
    vinculo: Number(r['vinculo_trabalho_id']),
    tipo: 'epi',
    data: dataIso(r['data_entrega']) ?? '',
    epi: ou(r['epi']),
    caNumero: ou(r['numero_ca']),
    caValidade: dataIso(r['validade_ca']),
    quantidade: num(r['quantidade']),
    assinatura: sim(r['ciencia_conferida']) ? 'assinada' : 'pendente',
    assinadaEm: dataHora(r['ciencia_em'], fuso),
    periodoInicio: null,
    doseMsv: null,
    dosimetro: null,
    agente: null,
    duracaoMin: null,
    observacao: ou(r['observacao']),
    criadoPor: texto(r['criado_login']),
    canceladoEm: cancelada ? dataHora(r['alterado_em'], fuso) : null,
    canceladoPor: cancelada ? ou(r['alterado_login']) : null,
    motivoCancelamento: ou(r['motivo_cancelamento']),
  };
}

/** A leitura do dosímetro ou a exposição a quimioterápico no formato do registro de proteção. */
function protecaoDe(r: Linha, tipo: 'dosimetria' | 'quimio', fuso: string): RegistroProtecao {
  const cancelada = texto(r['situacao']) === 'cancelado';
  const dose = tipo === 'dosimetria';
  return {
    id: Number(r['id']),
    vinculo: Number(r['vinculo_trabalho_id']),
    tipo,
    data: dataIso(dose ? r['periodo_fim'] : r['data_exposicao']) ?? '',
    epi: null,
    caNumero: null,
    caValidade: null,
    quantidade: null,
    assinatura: null,
    assinadaEm: null,
    periodoInicio: dose ? dataIso(r['periodo_inicio']) : null,
    doseMsv: dose ? num(r['dose_msv']) : null,
    dosimetro: dose ? ou(r['dosimetro']) : null,
    agente: dose ? null : ou(r['agente']),
    duracaoMin: dose ? null : num(r['duracao_minutos']),
    observacao: ou(r['observacao']),
    criadoPor: texto(r['criado_login']),
    canceladoEm: cancelada ? dataHora(r['alterado_em'], fuso) : null,
    canceladoPor: cancelada ? ou(r['alterado_login']) : null,
    motivoCancelamento: ou(r['motivo_cancelamento']),
  };
}

/** Os registros de proteção do estabelecimento (as três tabelas), com o filtro opcional do vínculo, por data e id. */
async function protecoesDe(l: Ler, est: number, vinculo: number | null): Promise<RegistroProtecao[]> {
  const fuso = await fusoDe(l, est);
  const filtro = vinculo === null ? '' : ' AND x.vinculo_trabalho_id = ?';
  const p = vinculo === null ? [est] : [est, vinculo];
  const [entregas, leituras, exposicoes] = await Promise.all([
    l.consultar(`${SQL_ENTREGA}${filtro}`, p),
    l.consultar(`${SQL_DOSIMETRIA}${filtro}`, p),
    l.consultar(`${SQL_QUIMIO}${filtro}`, p),
  ]);
  return [
    ...entregas.map((r) => entregaDe(r, fuso)),
    ...leituras.map((r) => protecaoDe(r, 'dosimetria', fuso)),
    ...exposicoes.map((r) => protecaoDe(r, 'quimio', fuso)),
  ].sort((a, b) => (a.data === b.data ? a.id - b.id : a.data < b.data ? -1 : 1));
}

function riscoDe(r: Linha): LinhaRiscoFuncao {
  const funcao = texto(r['funcao']);
  return {
    id: Number(r['id']),
    unidade: num(r['unidade']),
    setor: ou(r['setor']),
    funcao,
    funcaoChave: chaveFuncao(funcao),
    tipo: 'risco',
    fatorRisco: ou(r['codigo_esocial']),
    grupoRisco: ou(r['grupo']),
    epc: num(CODIGO_EPC[texto(r['situacao_epc'])] ?? null),
    epi: null,
    descricao: ou(r['descricao_epc']),
    inicio: dataIso(r['vigencia_inicio']) ?? '',
    fim: dataIso(r['vigencia_fim']),
    motivoFim: null,
  };
}

/** A linha de EPI exigido no mapa: o id é o de epi_funcao com o sinal trocado (o mapa junta duas tabelas). */
function epiFuncaoDe(r: Linha): LinhaRiscoFuncao {
  const funcao = texto(r['funcao']);
  return {
    id: -Number(r['id']),
    unidade: num(r['unidade']),
    setor: ou(r['setor']),
    funcao,
    funcaoChave: chaveFuncao(funcao),
    tipo: 'epi',
    fatorRisco: null,
    grupoRisco: null,
    epc: null,
    epi: ou(r['epi']),
    descricao: null,
    inicio: dataIso(r['vigencia_inicio']) ?? '',
    fim: dataIso(r['vigencia_fim']),
    motivoFim: null,
  };
}

function sorologiaDe(r: Linha): SorologiaAcidente {
  return {
    id: Number(r['id']),
    acidente: Number(r['acidente']),
    marco: texto(r['marco']),
    prevista: dataIso(r['data_prevista']) ?? '',
    realizada: dataIso(r['data_realizada']),
    // No banco o resultado é snake_case (ADR 0002); no contrato, com hífen.
    resultado: ou(r['resultado'])?.replace(/_/g, '-') ?? null,
    observacao: ou(r['observacao']),
  };
}

// ── Leituras comuns à transação de leitura e à de gravação ────────────────────────────────────────────────────

async function ocupacionalDe(l: Ler, est: number, vinculo: number): Promise<RegistroOcupacional[]> {
  const fuso = await fusoDe(l, est);
  const [asos, exames] = await Promise.all([
    l.consultar(`${SQL_ASO} AND a.vinculo_trabalho_id = ? ORDER BY a.data_exame, a.id`, [est, vinculo]),
    l.consultar(`${SQL_EXAME} AND a.vinculo_trabalho_id = ? ORDER BY x.data_exame, x.id`, [est, vinculo]),
  ]);
  return [...asos.map((r) => asoDe(r, fuso)), ...exames.map((r) => exameDe(r, fuso))];
}

async function vacinasDe(l: Ler, est: number, vinculo: number): Promise<DoseVacinaColaborador[]> {
  return (
    await l.consultar(`${SQL_VACINA} AND v.id = ? ORDER BY vc.data_aplicacao, vc.id`, [est, vinculo])
  ).map(vacinaDe);
}

async function acidentePorId(l: Ler, est: number, id: number): Promise<AcidenteTrabalho | null> {
  const r = await l.uma(`${SQL_ACIDENTE} AND ca.id = ?`, [est, id]);
  return r ? acidenteDe(r, await fusoDe(l, est)) : null;
}

async function sorologiasDe(l: Ler, est: number, acidentes: readonly number[]): Promise<SorologiaAcidente[]> {
  if (acidentes.length === 0) return [];
  return (
    await l.consultar(
      `${SQL_SOROLOGIA} AND ca.id IN (${marcas(acidentes.length)}) ORDER BY so.data_prevista, so.id`,
      [est, ...acidentes],
    )
  ).map(sorologiaDe);
}

async function entregaPorId(l: Ler, est: number, id: number): Promise<RegistroProtecao | null> {
  const r = await l.uma(`${SQL_ENTREGA} AND x.id = ?`, [est, id]);
  return r ? entregaDe(r, await fusoDe(l, est)) : null;
}

/** O registro de proteção pelo id e pelo tipo (o id só é único dentro da tabela do tipo). */
async function protecaoPorId(
  l: Ler,
  est: number,
  id: number,
  tipo: TipoProtecao,
): Promise<RegistroProtecao | null> {
  if (tipo === 'epi') return entregaPorId(l, est, id);
  const r = await l.uma(`${tipo === 'dosimetria' ? SQL_DOSIMETRIA : SQL_QUIMIO} AND x.id = ?`, [est, id]);
  return r ? protecaoDe(r, tipo, await fusoDe(l, est)) : null;
}

function contextoDe(c: ContextoSesmt): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'sesmt').slice(0, 64),
  };
}

export class PortaSesmtPropria implements PortaSesmt {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSesmt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoSesmt, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: true, codigo: null, motivo: null };
  }

  /* eslint-disable @typescript-eslint/no-unused-vars -- assinatura da porta; a operação aguarda o modelo */
  async executar(
    _c: ContextoSesmt,
    _op: string,
    _e: unknown,
    _ctx: ContextoOperacao,
  ): Promise<GravacaoFeita> {
    /* eslint-enable @typescript-eslint/no-unused-vars */
    throw new ErroOperacao(
      409,
      'operacao-desconhecida',
      'Operação recusada',
      'O SESMT não usa operações de tela do executor.',
    );
  }

  gravarSgh<T>(
    c: ContextoSesmt,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorSesmt) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'pessoas.sesmt',
      tabelas: TABELAS_SESMT,
      trilha,
      gravador: (tx, est, anotacao) => gravador(tx, est, anotacao),
      fn,
    });
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoSesmt): Promise<{ hoje: string; agora: string }> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<{ fuso_horario: string | null }>(
        'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
        [est],
      );
      const rel = relogioNoFuso(r?.fuso_horario || FUSO_PADRAO);
      return { hoje: rel.hoje, agora: `${rel.hoje}T${rel.hora}` };
    });
  }

  dominios(c: ContextoSesmt): Promise<DominiosSesmt> {
    // Domínios oficiais do eSocial (rede inteira) e o cadastro de vacinas ocupacionais (do cliente).
    return this.ler(c, async (l) => {
      const tabelas = [TABELA_PARTES, ...TABELAS_AGENTES, TABELA_SITUACOES, TABELA_NATUREZAS];
      const [codigos, vacinas] = await Promise.all([
        l.consultar(
          `SELECT c.id, c.codigo_esocial, c.descricao, t.codigo_oficial
             FROM codigo_esocial c JOIN tabela_esocial t ON t.id = c.tabela_esocial_id
            WHERE t.fonte = 'esocial' AND t.codigo_oficial IN (${marcas(tabelas.length)})
              AND (c.vigencia_fim IS NULL OR c.vigencia_fim >= CURRENT_DATE)
            ORDER BY t.codigo_oficial, c.codigo_esocial`,
          tabelas,
        ),
        l.consultar('SELECT id, descricao FROM vacina_ocupacional WHERE ativo = TRUE ORDER BY descricao', []),
      ]);
      const de = (...ts: string[]): OpcaoDominioSesmt[] =>
        codigos
          .filter((r) => ts.includes(texto(r['codigo_oficial'])))
          .map((r) => ({
            codigo: Number(r['id']),
            rotulo: `${texto(r['codigo_esocial'])} - ${texto(r['descricao'])}`,
          }));
      const lista = (m: Readonly<Record<number, string>>): OpcaoDominioSesmt[] =>
        Object.entries(m).map(([k, v]) => ({ codigo: Number(k), rotulo: v }));
      return {
        tiposAso: lista(ROTULO_TIPO_ASO),
        conclusoesAso: lista({ 1: 'Apto', 2: 'Inapto' }),
        tiposCat: lista({ 1: 'Inicial', 2: 'Reabertura', 3: 'Comunicação de óbito' }),
        iniciativasCat: lista({
          1: 'Iniciativa do empregador',
          2: 'Ordem judicial',
          3: 'Determinação de órgão fiscalizador',
        }),
        partesCorpo: de(TABELA_PARTES),
        naturezas: de(TABELA_NATUREZAS),
        agentes: de(...TABELAS_AGENTES),
        situacoes: de(TABELA_SITUACOES),
        gruposRisco: [...GRUPOS_RISCO],
        eficaciasEpc: lista(ROTULO_EPC),
        vacinasCadastro: vacinas.map((v) => ({ codigo: Number(v['id']), rotulo: texto(v['descricao']) })),
        dosesVacinaCadastro: CODIGOS_DOSE.map((d, i) => ({
          codigo: i + 1,
          rotulo: DOSES_VACINA_SESMT[d].rotulo,
        })),
      };
    });
  }

  fatoresRisco(c: ContextoSesmt, termo: string): Promise<OpcaoDominioSesmtTexto[]> {
    // Tabela 24 do eSocial: rede inteira.
    const t = `%${termo.trim().replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT codigo_esocial, descricao FROM fator_risco_ocupacional
            WHERE ativo = TRUE AND (descricao LIKE ? OR codigo_esocial LIKE ?)
            ORDER BY codigo_esocial LIMIT 30`,
          [t, t],
        )
      ).map((r) => ({ codigo: texto(r['codigo_esocial']), rotulo: texto(r['descricao']) })),
    );
  }

  fatoresPorCodigo(c: ContextoSesmt, codigos: readonly string[]): Promise<Map<string, string>> {
    const cs = [...new Set(codigos.filter((x) => x))];
    if (cs.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l) => {
      const r = await l.consultar(
        `SELECT codigo_esocial, descricao FROM fator_risco_ocupacional WHERE codigo_esocial IN (${marcas(cs.length)})`,
        cs,
      );
      return new Map(r.map((x) => [texto(x['codigo_esocial']), texto(x['descricao'])]));
    });
  }

  ocupacional(c: ContextoSesmt, vinculo: number): Promise<RegistroOcupacional[]> {
    return this.ler(c, (l, est) => ocupacionalDe(l, est, vinculo));
  }

  vacinas(c: ContextoSesmt, vinculo: number): Promise<DoseVacinaColaborador[]> {
    return this.ler(c, (l, est) => vacinasDe(l, est, vinculo));
  }

  acidente(c: ContextoSesmt, id: number): Promise<AcidenteTrabalho | null> {
    return this.ler(c, (l, est) => acidentePorId(l, est, id));
  }

  listarAcidentes(
    c: ContextoSesmt,
    f: FiltroAcidentesPorta,
  ): Promise<{ itens: AcidenteTrabalho[]; depois: number | null }> {
    return this.ler(c, async (l, est) => {
      const onde: string[] = [];
      const p: unknown[] = [est];
      if (f.vinculo !== undefined) {
        onde.push('ca.vinculo_trabalho_id = ?');
        p.push(f.vinculo);
      }
      if (f.depois !== undefined) {
        onde.push('ca.id < ?');
        p.push(f.depois);
      }
      if (f.estado === 'encerrado') onde.push("(ca.encerrado_em IS NOT NULL OR e.situacao = 'alta')");
      if (f.estado === 'aberto')
        onde.push("ca.encerrado_em IS NULL AND (e.id IS NULL OR e.situacao <> 'alta')");
      const limite = Math.max(1, Math.min(200, f.limite));
      const linhas = await l.consultar(
        `${SQL_ACIDENTE}${onde.map((o) => ` AND ${o}`).join('')} ORDER BY ca.id DESC LIMIT ${limite + 1}`,
        p,
      );
      const fuso = await fusoDe(l, est);
      const itens = linhas.slice(0, limite).map((r) => acidenteDe(r, fuso));
      return { itens, depois: linhas.length > limite ? (itens[itens.length - 1]?.id ?? null) : null };
    });
  }

  sorologias(c: ContextoSesmt, acidentes: readonly number[]): Promise<SorologiaAcidente[]> {
    if (acidentes.length === 0) return Promise.resolve([]);
    return this.ler(c, (l, est) => sorologiasDe(l, est, acidentes));
  }

  mapaRiscos(c: ContextoSesmt, f: FiltroRiscosPorta): Promise<LinhaRiscoFuncao[]> {
    return this.ler(c, async (l, est) => {
      const hoje = relogioNoFuso(await fusoDe(l, est)).hoje;
      const vig = f.vigentes ? ' AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= ?)' : '';
      const vigEpi = f.vigentes ? ' AND (ef.vigencia_fim IS NULL OR ef.vigencia_fim >= ?)' : '';
      const uni = f.unidade !== undefined ? ' AND s.unidade_assistencial_id = ?' : '';
      const p: unknown[] = [
        est,
        ...(f.vigentes ? [hoje] : []),
        ...(f.unidade !== undefined ? [f.unidade] : []),
      ];
      const [riscos, epis] = await Promise.all([
        l.consultar(`${SQL_RISCO}${vig}${uni} ORDER BY f.nome, r.vigencia_inicio, r.id`, p),
        l.consultar(`${SQL_EPI_FUNCAO}${vigEpi}${uni} ORDER BY f.nome, ef.vigencia_inicio, ef.id`, p),
      ]);
      const linhas = [...riscos.map(riscoDe), ...epis.map(epiFuncaoDe)];
      return f.funcaoChave ? linhas.filter((x) => x.funcaoChave === f.funcaoChave) : linhas;
    });
  }

  registrosEpi(c: ContextoSesmt, vinculo: number): Promise<RegistroProtecao[]> {
    return this.ler(c, (l, est) => protecoesDe(l, est, vinculo));
  }

  registroEpi(c: ContextoSesmt, id: number, tipo: TipoProtecao = 'epi'): Promise<RegistroProtecao | null> {
    return this.ler(c, (l, est) => protecaoPorId(l, est, id, tipo));
  }

  resumo(c: ContextoSesmt, ano: number): Promise<ResumoSesmt> {
    void ano; // O painel lê as pendências em aberto de todos os anos (o ano só recorta a dose anual, no domínio).
    return this.ler(c, async (l, est) => {
      const fuso = await fusoDe(l, est);
      const [vinculos, asos, vacinas, epis, acidentes] = await Promise.all([
        l.consultar(
          `SELECT v.id, c.nome, v.matricula, cg.nome AS cargo, f.nome AS funcao, s.unidade_assistencial_id AS unidade,
                  s.nome AS setor, v.data_admissao
             FROM vinculo_trabalho v
             JOIN colaborador c ON c.id = v.colaborador_id
             JOIN cargo cg ON cg.id = v.cargo_id
             LEFT JOIN funcao f ON f.id = v.funcao_id
             LEFT JOIN setor_funcional s ON s.id = v.setor_funcional_id
            WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL AND v.situacao IN ('ativo', 'afastado')
            ORDER BY c.nome, v.id`,
          [est],
        ),
        l.consultar(`${SQL_ASO} ORDER BY a.data_exame, a.id`, [est]),
        l.consultar(
          `${SQL_VACINA} AND v.situacao IN ('ativo', 'afastado') ORDER BY vc.data_aplicacao, vc.id`,
          [est],
        ),
        protecoesDe(l, est, null),
        l.consultar(`${SQL_ACIDENTE} ORDER BY ca.id`, [est]),
      ]);
      const ac = acidentes.map((r) => acidenteDe(r, fuso));
      const ativos: VinculoAtivoSesmt[] = vinculos.map((v) => ({
        id: Number(v['id']),
        nome: texto(v['nome']),
        matricula: ou(v['matricula']),
        cargo: texto(v['cargo']),
        funcao: ou(v['funcao']),
        unidade: num(v['unidade']),
        setor: ou(v['setor']),
        admissao: dataIso(v['data_admissao']) ?? '',
      }));
      return {
        vinculos: ativos,
        asos: asos.map((r) => asoDe(r, fuso)),
        vacinas: vacinas.map(vacinaDe),
        epis,
        acidentes: ac,
        sorologias: await sorologiasDe(
          l,
          est,
          ac.filter((a) => a.biologico).map((a) => a.id),
        ),
      };
    });
  }

  correcoes(c: ContextoSesmt, tabela: string, registros: readonly number[]): Promise<CorrecaoSesmt[]> {
    if (registros.length === 0) return Promise.resolve([]);
    const ids = new Set(registros);
    if (!(TABELAS_SESMT as readonly string[]).includes(tabela)) return Promise.resolve([]);
    const lista = [...ids];
    return this.ler(c, async (l, est) => {
      const fuso = await fusoDe(l, est);
      // A gravação com correção tem como alvo da trilha a própria linha corrigida (entidade = tabela, entidade_id =
      // registro): a leitura vai pelo índice (entidade, entidade_id), só nas linhas pedidas.
      const linhas = await l.consultar(
        `SELECT t.id, t.dados_depois, t.motivo, t.ocorrido_em, u.login
           FROM trilha_auditoria t LEFT JOIN usuario u ON u.id = t.usuario_id
          WHERE t.entidade = ? AND t.entidade_id IN (${marcas(lista.length)}) AND t.estabelecimento_id = ?
            AND JSON_EXTRACT(t.dados_depois, '$.dados.correcoes') IS NOT NULL
          ORDER BY t.id`,
        [tabela, ...lista, est],
      );
      const saida: CorrecaoSesmt[] = [];
      for (const r of linhas) {
        const bruto = r['dados_depois'];
        // A linha da operação guarda os dados da gravação em dados_depois.dados (o Executor do núcleo).
        const depois = (typeof bruto === 'string' ? JSON.parse(bruto) : bruto) as {
          dados?: {
            correcoes?: {
              tabela: string;
              registro: number;
              operacao: string;
              antes: object;
              depois: object;
            }[];
          };
        };
        for (const x of depois?.dados?.correcoes ?? [])
          if (x.tabela === tabela && ids.has(Number(x.registro)))
            saida.push({
              id: Number(r['id']),
              tabela: x.tabela,
              registro: Number(x.registro),
              operacao: x.operacao,
              antes: x.antes as Record<string, unknown>,
              depois: x.depois as Record<string, unknown>,
              motivo: texto(r['motivo']),
              por: texto(r['login']),
              em: dataHora(r['ocorrido_em'], fuso) ?? '',
            });
      }
      return saida;
    });
  }
}

// ── O gravador (dentro da operação do Executor) ───────────────────────────────────────────────────────────────

function gravador(tx: TxOperacao, est: number, anotacao: AnotacaoGravacao): GravadorSesmt {
  const usuario = tx.contexto.usuario;
  const carimbo = (): Carimbo => ({ usuario, agora: new Date() });
  let fusoLido: Promise<string> | null = null;
  const fuso = () => (fusoLido ??= fusoDe(tx, est));
  const motivo = (m: string) => {
    anotacao.motivo = anotacao.motivo ? `${anotacao.motivo}; ${m}` : m;
  };

  const vinculoOu = async (id: number) => {
    const [v] = await tx.consultarParaAtualizar<{ id: number; colaborador_id: number }>(
      'SELECT id, colaborador_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
      { teto: 1 },
    );
    if (!v) throw naoEncontrado('Vínculo do colaborador');
    return { id: Number(v.id), colaborador: Number(v.colaborador_id) };
  };

  const numero = async (tipo: string, prefixo: string) => {
    await garantirSequencia(tx, { tipo, estabelecimento: est, prefixo }, carimbo());
    return (await tx.proximoNumero(tipo)).formatado;
  };

  const linhaAcidente = async (id: number) => {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      `SELECT ca.id, ca.versao, ca.situacao, ca.acidente_em, ca.houve_obito, ca.encerrado_em, e.id AS exposicao_id, e.versao AS versao_exposicao
         FROM comunicacao_acidente ca
         LEFT JOIN exposicao_biologica e ON e.comunicacao_acidente_id = ca.id AND e.excluido_em IS NULL
        WHERE ca.id = ? AND ca.estabelecimento_id = ? AND ca.excluido_em IS NULL`,
      [id, est],
      { teto: 1 },
    );
    if (!r) throw naoEncontrado('Acidente');
    return r;
  };

  /** Releva a versão do acidente (a trava otimista da tela é a da comunicação). */
  const tocarAcidente = (id: number, versao: number, situacao: string) =>
    tx.alterar('comunicacao_acidente', id, versao, { situacao });

  const equipamento = async (nome: string) => {
    const ep = await tx.uma<Linha>(
      `SELECT id, numero_ca, validade_ca FROM equipamento_protecao
        WHERE (UPPER(nome) = UPPER(?) OR codigo = ?) AND ativo = TRUE AND excluido_em IS NULL ORDER BY id LIMIT 1`,
      [nome, nome],
    );
    if (!ep)
      throw recusa('epi-nao-cadastrado', `O EPI "${nome}" não está no cadastro de equipamentos de proteção.`);
    return ep;
  };

  const funcaoPorChave = async (chave: string) => {
    const fs = await tx.consultar<Linha>(
      'SELECT id, nome, setor_funcional_id FROM funcao WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL',
      [est],
    );
    const f = fs.find((x) => chaveFuncao(texto(x['nome'])) === chave);
    if (!f)
      throw recusa('funcao-inexistente', 'A função não está no cadastro de funções deste estabelecimento.');
    return f;
  };

  const camposCat = (cat: DadosCat, fz: string): Record<string, unknown> => ({
    minutos_trabalhados_antes: minutosDe(cat.horasAntes),
    lateralidade: LATERALIDADE[cat.lateralidade ?? 0] ?? 'nao_aplicavel',
    comunicado_policia: cat.comunicouPolicia,
    ultimo_dia_trabalhado: cat.ultimoDiaTrabalhado,
    tipo_local: LOCAL_CAT[cat.localTipo ?? 1] ?? 'estabelecimento_empregador',
    local_logradouro: cat.logradouro,
    local_numero: cat.numero,
    local_cep: cat.cep,
    atendido_em: cat.atestadoData
      ? instanteCivil(cat.atestadoData, (cat.atestadoHora ?? '0000').replace(':', '').padStart(4, '0'), fz)
      : null,
    internacao: cat.internacao,
    duracao_tratamento_dias: cat.duracaoDias,
    descricao_lesao: cat.complementoLesao,
    diagnostico_provavel: cat.diagnostico,
    cid_codigo: cat.cid,
    medico_nome: cat.emitenteNome,
    medico_registro_conselho: cat.emitenteNumero,
    medico_uf_conselho: cat.emitenteUf,
  });

  const excluirParaRetificar = async (
    tabela: 'aso' | 'vacina_colaborador',
    id: number,
    motivoRet: string | null,
  ) => {
    const r = await tx.uma<{ versao: number }>(
      `SELECT versao FROM ${tabela} WHERE id = ? AND excluido_em IS NULL`,
      [id],
    );
    if (!r) throw naoEncontrado('Registro a retificar');
    await tx.alterar(tabela, id, Number(r.versao), { excluido_em: new Date(), excluido_por: usuario });
    motivo(`retificação de ${tabela} ${id}${motivoRet ? `: ${motivoRet}` : ''}`);
  };

  return {
    ocupacional: (v) => ocupacionalDe(tx, est, v),
    vacinas: (v) => vacinasDe(tx, est, v),
    acidente: (id) => acidentePorId(tx, est, id),
    sorologias: (a) => sorologiasDe(tx, est, [a]),
    registroEpi: (id, tipo = 'epi') => protecaoPorId(tx, est, id, tipo),

    async incluirAso(a) {
      const v = await vinculoOu(a.vinculo);
      const tipo = TIPO_ASO[a.tipo] ?? (a.tipo === 8 ? 'demissional' : null);
      if (!tipo) throw recusa('tipo-aso-invalido', 'Natureza do ASO desconhecida.');
      const conclusao = CONCLUSAO_ASO[a.conclusao];
      if (!conclusao) throw recusa('conclusao-aso-invalida', 'Conclusão do ASO desconhecida.');
      if (a.retifica !== null) {
        const ant = await tx.uma(
          'SELECT id FROM aso WHERE id = ? AND estabelecimento_id = ? AND vinculo_trabalho_id = ?',
          [a.retifica, est, v.id],
        );
        if (!ant) throw naoEncontrado('ASO a retificar');
        await excluirParaRetificar('aso', a.retifica, a.motivoRetificacao);
      }
      const novo = await tx.incluir('aso', {
        estabelecimento_id: est,
        numero: await numero('aso', 'ASO-'),
        colaborador_id: v.colaborador,
        vinculo_trabalho_id: v.id,
        tipo,
        data_exame: a.data,
        medico_nome: a.medico,
        medico_registro_conselho: a.medicoConselho,
        conclusao,
        restricoes: a.restricoes,
        validade_ate: a.proximo,
        observacao: a.observacao,
        retifica_aso_id: a.retifica,
        motivo_retificacao: a.retifica !== null ? (a.motivoRetificacao ?? 'retificação').slice(0, 500) : null,
      });
      if (a.retifica !== null) {
        // Os exames complementares do ASO retificado passam ao ASO novo (cada um pela própria versão, com a trilha).
        const exames = await tx.consultarParaAtualizar<{ id: number; versao: number }>(
          'SELECT id, versao FROM exame_ocupacional WHERE aso_id = ? AND excluido_em IS NULL ORDER BY id',
          [a.retifica],
          { teto: 500 },
        );
        for (const x of exames)
          await tx.alterar('exame_ocupacional', Number(x.id), Number(x.versao), { aso_id: novo });
        if (exames.length) motivo(`${exames.length} exame(s) ocupacional(is) religado(s) ao ASO ${novo}`);
      }
      return novo;
    },

    async incluirExame(x) {
      const [aso] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, tipo FROM aso WHERE id = ? AND estabelecimento_id = ? AND vinculo_trabalho_id = ? AND excluido_em IS NULL',
        [x.aso, est, x.vinculo],
        { teto: 1 },
      );
      if (!aso) throw naoEncontrado('ASO do exame');
      const seq = await tx.uma<{ s: number }>(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM exame_ocupacional WHERE aso_id = ?',
        [x.aso],
      );
      return tx.incluir('exame_ocupacional', {
        aso_id: x.aso,
        sequencia: Number(seq?.s ?? 1),
        descricao: x.exame,
        data_exame: x.data,
        ordem: texto(aso['tipo']) === 'admissional' ? 'referencial' : 'sequencial',
        indicacao_resultado: x.resultado,
      });
    },

    async incluirVacina(x) {
      if (x.registro === 'anti-hbs' && (x.antiHbs === null || x.antiHbs < 0))
        throw recusa('anti-hbs-sem-titulo', 'Informe o título do anti-HBs (mUI/mL).');
      const v = await vinculoOu(x.vinculo);
      let vacina: number | null = null;
      if (x.codigoVacina !== null) {
        const r = await tx.uma<{ id: number }>('SELECT id FROM vacina_ocupacional WHERE id = ?', [
          x.codigoVacina,
        ]);
        vacina = r ? Number(r.id) : null;
      }
      if (vacina === null) {
        const r = await tx.uma<{ id: number }>('SELECT id FROM vacina_ocupacional WHERE codigo = ?', [
          x.vacina,
        ]);
        vacina = r
          ? Number(r.id)
          : await tx.incluir('vacina_ocupacional', {
              codigo: x.vacina,
              descricao: VACINAS_SESMT[x.vacina as VacinaSesmt]?.rotulo ?? x.vacina,
              quantidade_doses: VACINAS_SESMT[x.vacina as VacinaSesmt]?.esquema ?? 1,
            });
      }
      if (x.retifica !== null) {
        const ant = await tx.uma('SELECT id FROM vacina_colaborador WHERE id = ? AND colaborador_id = ?', [
          x.retifica,
          v.colaborador,
        ]);
        if (!ant) throw naoEncontrado('Dose a retificar');
        await excluirParaRetificar('vacina_colaborador', x.retifica, x.motivoRetificacao);
      }
      await tx.consultarParaAtualizar('SELECT id FROM colaborador WHERE id = ?', [v.colaborador], {
        teto: 1,
      });
      const seq = await tx.uma<{ s: number }>(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM vacina_colaborador WHERE colaborador_id = ?',
        [v.colaborador],
      );
      const antiHbs = x.registro === 'anti-hbs';
      const dose = antiHbs ? 'sorologia' : (DOSE_MODELO[x.dose ?? 'unica'] ?? 'unica');
      return tx.incluir('vacina_colaborador', {
        colaborador_id: v.colaborador,
        sequencia: Number(seq?.s ?? 1),
        vacina_ocupacional_id: vacina,
        dose,
        numero_dose: !antiHbs && /^\d+$/.test(x.dose ?? '') ? Number(x.dose) : null,
        data_aplicacao: x.data,
        lote: antiHbs ? null : x.lote,
        validade_lote: antiHbs ? null : x.validadeLote,
        observacao: x.observacao,
        titulo_anti_hbs: antiHbs ? x.antiHbs : null,
        retifica_vacina_colaborador_id: x.retifica,
      });
    },

    async incluirAcidente(a) {
      const v = await vinculoOu(a.vinculo);
      const id = await tx.incluir('comunicacao_acidente', {
        estabelecimento_id: est,
        numero: await numero('comunicacao_acidente', 'AT-'),
        colaborador_id: v.colaborador,
        vinculo_trabalho_id: v.id,
        tipo: 'inicial',
        iniciativa: 'empregador',
        registrador: 'empregador',
        tipo_acidente: a.tipo,
        acidente_em: paraInstante(a.ocorridoEm, await fuso()),
        houve_afastamento: a.afastamento,
        houve_obito: a.obito,
        obito_em: a.obito ? a.ocorridoEm.slice(0, 10) : null,
        comunicado_policia: false,
        tipo_local: 'estabelecimento_empregador',
        local_descricao: a.local,
        lateralidade: 'nao_aplicavel',
        agente_causador_codigo_esocial_id: a.agente,
        situacao_geradora_codigo_esocial_id: a.situacao,
        parte_atingida_codigo_esocial_id: a.parteCorpo,
        natureza_lesao_codigo_esocial_id: a.natureza,
        descricao_acidente: a.descricao,
        internacao: false,
        situacao: 'rascunho',
      });
      if (a.biologico) {
        const conhecida = a.fonte === 'conhecida';
        await tx.incluir('exposicao_biologica', {
          estabelecimento_id: est,
          vinculo_trabalho_id: v.id,
          ocorrido_em: paraInstante(a.ocorridoEm, await fuso()),
          tipo_exposicao: (a.exposicao ?? (a.perfurocortante ? 'percutanea' : 'outra')).replace(/-/g, '_'),
          material_biologico: MATERIAL_MODELO[a.material ?? ''] ?? 'desconhecido',
          fonte_conhecida: conhecida,
          fonte_hiv: TESTE_FONTE[a.fonteTeste ?? ''] ?? (conhecida ? 'nao_realizado' : 'desconhecido'),
          fonte_hbsag: 'desconhecido',
          fonte_anti_hcv: 'desconhecido',
          situacao_vacinal_hepatite_b: 'desconhecido',
          profilaxia_antirretroviral: a.profilaxia === 'iniciada',
          imunoglobulina_hepatite_b: false,
          vacina_hepatite_b: false,
          conduta: a.profilaxia,
          situacao_profilaxia: SITUACOES_PROFILAXIA.has(a.profilaxia)
            ? a.profilaxia.replace(/-/g, '_')
            : 'nao_indicada',
          comunicacao_acidente_id: id,
          soroconversao: false,
          situacao: 'aberta',
        });
      }
      return id;
    },

    async incluirSorologia(x) {
      const r = await linhaAcidente(x.acidente);
      if (r['exposicao_id'] === null)
        throw recusa('sem-exposicao', 'O acidente não teve material biológico.');
      return tx.incluir('sorologia_exposicao', {
        exposicao_biologica_id: Number(r['exposicao_id']),
        marco: x.marco,
        data_prevista: x.prevista,
      });
    },

    async atualizarProfilaxia(x) {
      const r = await linhaAcidente(x.id);
      if (r['exposicao_id'] === null)
        throw recusa('sem-exposicao', 'O acidente não teve material biológico.');
      await tocarAcidente(x.id, x.versao, texto(r['situacao']));
      await tx.alterar('exposicao_biologica', Number(r['exposicao_id']), Number(r['versao_exposicao']), {
        profilaxia_antirretroviral: x.profilaxia === 'iniciada',
        conduta: x.profilaxia,
        situacao_profilaxia: x.profilaxia.replace(/-/g, '_'),
        profilaxia_em: x.profilaxiaEm,
        observacao_profilaxia: x.observacao?.slice(0, 500) ?? null,
        situacao: 'em_acompanhamento',
      });
      if (x.observacao) motivo(`profilaxia: ${x.observacao}`);
    },

    async registrarSorologia(x) {
      const r = await linhaAcidente(x.acidente);
      if (r['exposicao_id'] === null)
        throw recusa('sem-exposicao', 'O acidente não teve material biológico.');
      {
        const [so] = await tx.consultarParaAtualizar<Linha>(
          'SELECT id, versao, data_realizada FROM sorologia_exposicao WHERE exposicao_biologica_id = ? AND marco = ? AND excluido_em IS NULL',
          [Number(r['exposicao_id']), x.marco],
          { teto: 1 },
        );
        if (!so) throw naoEncontrado('Marco da sorologia');
        if (so['data_realizada'] !== null)
          throw recusa('sorologia-registrada', 'O resultado deste marco já foi registrado.');
        await tx.alterar('sorologia_exposicao', Number(so['id']), Number(so['versao']), {
          data_realizada: x.realizada,
          resultado: String(x.resultado).replace(/-/g, '_'),
          observacao: x.observacao,
        });
        if (x.resultado === 'soroconversao')
          await tx.alterar('exposicao_biologica', Number(r['exposicao_id']), Number(r['versao_exposicao']), {
            soroconversao: true,
          });
        return Number(so['id']);
      }
    },

    async emitirCat(x) {
      const r = await linhaAcidente(x.id);
      const tipo = TIPO_CAT[x.tipoCat];
      if (!tipo) throw recusa('tipo-cat-invalido', 'Tipo de CAT desconhecido.');
      if (tipo !== 'inicial')
        throw recusa(
          'cat-sem-anterior',
          'A CAT de reabertura ou de óbito se liga à CAT inicial: emita pela retificação da comunicação original.',
        );
      void r;
      await tx.alterar('comunicacao_acidente', x.id, x.versao, {
        tipo,
        iniciativa: INICIATIVA_CAT[x.iniciativa ?? 1] ?? 'empregador',
        numero_recibo: x.numero,
        emitida_em: paraInstante(x.emitidaEm, await fuso()),
        emissor_usuario_id: usuario,
        situacao: 'emitida',
      });
    },

    async encerrarAcidente(x) {
      const r = await linhaAcidente(x.id);
      if (r['encerrado_em'] !== null && r['encerrado_em'] !== undefined)
        throw recusa('acidente-encerrado', 'O acidente já foi encerrado.');
      await tx.alterar('comunicacao_acidente', x.id, x.versao, {
        encerrado_em: new Date(),
        encerrado_por: usuario,
        motivo_encerramento: x.motivo.slice(0, 500),
      });
      if (r['exposicao_id'] !== null)
        await tx.alterar('exposicao_biologica', Number(r['exposicao_id']), Number(r['versao_exposicao']), {
          situacao: 'alta',
          data_alta: civil(new Date(), await fuso()).data,
        });
      motivo(`encerramento: ${x.motivo}`);
    },

    async incluirLinhaRisco(x) {
      const f = await funcaoPorChave(x.funcaoChave);
      if (x.tipo === 'epi') {
        const ep = await equipamento(x.epi ?? '');
        const id = await tx.incluir('epi_funcao', {
          equipamento_protecao_id: Number(ep['id']),
          funcao_id: Number(f['id']),
          quantidade_padrao: 1,
          obrigatorio: true,
          vigencia_inicio: x.inicio,
        });
        return -id;
      }
      const fator = await tx.uma<{ id: number }>(
        'SELECT id FROM fator_risco_ocupacional WHERE codigo_esocial = ?',
        [x.fatorRisco ?? ''],
      );
      if (!fator)
        throw recusa('fator-inexistente', 'O fator de risco não está na tabela 24 do eSocial carregada.');
      const ambientes = await tx.consultar<Linha>(
        `SELECT a.id, a.setor_funcional_id, s.nome AS setor FROM ambiente_trabalho a
           LEFT JOIN setor_funcional s ON s.id = a.setor_funcional_id
          WHERE a.estabelecimento_id = ? AND a.ativo = TRUE AND a.excluido_em IS NULL ORDER BY a.id`,
        [est],
      );
      // O ambiente pelo setor informado (nome do setor do estabelecimento) ou pelo setor da função, casado pelo id; sem
      // setor nenhum, só o ambiente único do estabelecimento. Nunca se escolhe um entre vários.
      const setorFuncao =
        f['setor_funcional_id'] === null || f['setor_funcional_id'] === undefined
          ? null
          : Number(f['setor_funcional_id']);
      const candidatos = x.setor
        ? ambientes.filter((a) => texto(a['setor']).toUpperCase() === x.setor!.toUpperCase())
        : setorFuncao !== null
          ? ambientes.filter((a) => Number(a['setor_funcional_id']) === setorFuncao)
          : ambientes;
      if (candidatos.length === 0)
        throw recusa(
          'ambiente-inexistente',
          x.setor || setorFuncao !== null
            ? 'Não há ambiente de trabalho cadastrado para o setor desta função: cadastre-o antes do mapa de riscos.'
            : 'Cadastre o ambiente de trabalho do estabelecimento antes do mapa de riscos.',
        );
      if (candidatos.length > 1)
        throw recusa(
          'ambiente-ambiguo',
          'Há mais de um ambiente de trabalho para este setor: informe o setor do ambiente ou ajuste o cadastro dos ambientes.',
        );
      const ambiente = candidatos[0]!;
      return tx.incluir('risco_funcao', {
        ambiente_trabalho_id: Number(ambiente['id']),
        funcao_id: Number(f['id']),
        fator_risco_ocupacional_id: Number(fator.id),
        tipo_avaliacao: 'qualitativa',
        situacao_epc: EPC[x.epc ?? 0] ?? 'nao_aplicavel',
        descricao_epc: x.descricao,
        vigencia_inicio: x.inicio,
      });
    },

    async encerrarLinhaRisco(x) {
      const epi = x.id < 0;
      const id = Math.abs(x.id);
      const r = epi
        ? await tx.uma<{ versao: number }>(
            `SELECT ef.versao FROM epi_funcao ef JOIN funcao f ON f.id = ef.funcao_id
              WHERE ef.id = ? AND f.estabelecimento_id = ? AND ef.excluido_em IS NULL`,
            [id, est],
          )
        : await tx.uma<{ versao: number }>(
            `SELECT r.versao FROM risco_funcao r JOIN ambiente_trabalho a ON a.id = r.ambiente_trabalho_id
              WHERE r.id = ? AND a.estabelecimento_id = ? AND r.excluido_em IS NULL`,
            [id, est],
          );
      if (!r) throw naoEncontrado('Linha do mapa de riscos');
      await tx.alterar(epi ? 'epi_funcao' : 'risco_funcao', id, Number(r.versao), { vigencia_fim: x.fim });
      motivo(`fim da vigência: ${x.motivo}`);
    },

    async incluirRegistroEpi(x) {
      if (x.tipo === 'dosimetria') {
        const v = await vinculoOu(x.vinculo);
        const dosimetro = (x.dosimetro ?? '').trim();
        // A leitura ativa do mesmo dosímetro e período já existe: recusa com o motivo (a chave única é a garantia).
        const repetida = await tx.uma(
          `SELECT id FROM leitura_dosimetria
            WHERE vinculo_trabalho_id = ? AND dosimetro = ? AND periodo_inicio = ? AND situacao = 'ativo'
              AND excluido_em IS NULL`,
          [v.id, dosimetro, x.periodoInicio],
        );
        if (repetida)
          throw recusa(
            'leitura-repetida',
            'Já há leitura deste dosímetro para o mesmo período: cancele a anterior para lançar a correta.',
          );
        return tx.incluir('leitura_dosimetria', {
          vinculo_trabalho_id: v.id,
          periodo_inicio: x.periodoInicio,
          periodo_fim: x.data,
          dosimetro,
          dose_msv: x.doseMsv,
          observacao: x.observacao,
        });
      }
      if (x.tipo === 'quimio') {
        const v = await vinculoOu(x.vinculo);
        return tx.incluir('exposicao_quimioterapico', {
          vinculo_trabalho_id: v.id,
          data_exposicao: x.data,
          agente: (x.agente ?? '').trim(),
          duracao_minutos: x.duracaoMin,
          observacao: x.observacao,
        });
      }
      const v = await vinculoOu(x.vinculo);
      const ep = await equipamento(x.epi ?? '');
      const seq = await tx.uma<{ s: number }>(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM entrega_epi WHERE vinculo_trabalho_id = ?',
        [v.id],
      );
      return tx.incluir('entrega_epi', {
        vinculo_trabalho_id: v.id,
        sequencia: Number(seq?.s ?? 1),
        equipamento_protecao_id: Number(ep['id']),
        data_entrega: x.data,
        quantidade: x.quantidade ?? 1,
        numero_ca: x.caNumero ?? texto(ep['numero_ca']),
        validade_ca: x.caValidade ?? dataIso(ep['validade_ca']),
        motivo: 'outro',
        responsavel_usuario_id: usuario,
        observacao: x.observacao,
      });
    },

    async assinarEntregaEpi(x) {
      const r = await entregaPorId(tx, est, x.id);
      if (!r) throw naoEncontrado('Entrega de EPI');
      if (r.assinatura !== 'pendente' || r.canceladoEm)
        throw recusa('entrega-assinada', 'A entrega já foi assinada ou está cancelada.');
      const v = await tx.uma<{ versao: number }>('SELECT versao FROM entrega_epi WHERE id = ?', [x.id]);
      await tx.alterar('entrega_epi', x.id, Number(v?.versao ?? 0), {
        ciencia_conferida: true,
        ciencia_em: new Date(),
      });
    },

    async retificarAcidente(x) {
      await linhaAcidente(x.id);
      await tx.alterar('comunicacao_acidente', x.id, x.versao, {
        acidente_em: paraInstante(x.ocorridoEm, await fuso()),
        tipo_acidente: x.tipo,
        local_descricao: x.local,
        descricao_acidente: x.descricao,
        parte_atingida_codigo_esocial_id: x.parteCorpo,
        natureza_lesao_codigo_esocial_id: x.natureza,
        agente_causador_codigo_esocial_id: x.agente,
        situacao_geradora_codigo_esocial_id: x.situacao,
        houve_afastamento: x.afastamento,
        houve_obito: x.obito,
        obito_em: x.obito ? (x.cat.dataObito ?? x.ocorridoEm.slice(0, 10)) : null,
        ...camposCat(x.cat, await fuso()),
      });
    },

    async anularAcidente(x) {
      const r = await linhaAcidente(x.id);
      await tx.alterar('comunicacao_acidente', x.id, x.versao, { situacao: 'cancelada' });
      if (r['exposicao_id'] !== null)
        await tx.alterar('exposicao_biologica', Number(r['exposicao_id']), Number(r['versao_exposicao']), {
          situacao: 'cancelada',
          motivo_cancelamento: x.motivo.slice(0, 255),
        });
      motivo(`anulação: ${x.motivo}`);
    },

    async cancelarEntregaEpi(x) {
      if (x.tipo === 'dosimetria' || x.tipo === 'quimio') {
        const tabela = x.tipo === 'dosimetria' ? 'leitura_dosimetria' : 'exposicao_quimioterapico';
        const sql =
          x.tipo === 'dosimetria'
            ? `SELECT x.versao, x.situacao FROM leitura_dosimetria x
                 JOIN vinculo_trabalho v ON v.id = x.vinculo_trabalho_id
                WHERE x.id = ? AND v.estabelecimento_id = ? AND x.excluido_em IS NULL`
            : `SELECT x.versao, x.situacao FROM exposicao_quimioterapico x
                 JOIN vinculo_trabalho v ON v.id = x.vinculo_trabalho_id
                WHERE x.id = ? AND v.estabelecimento_id = ? AND x.excluido_em IS NULL`;
        const p = await tx.uma<{ versao: number; situacao: string }>(sql, [x.id, est]);
        if (!p)
          throw naoEncontrado(
            x.tipo === 'dosimetria' ? 'Leitura do dosímetro' : 'Exposição a quimioterápico',
          );
        if (p.situacao === 'cancelado') throw recusa('registro-cancelado', 'O registro já está cancelado.');
        await tx.alterar(tabela, x.id, Number(p.versao), {
          situacao: 'cancelado',
          motivo_cancelamento: x.motivo.slice(0, 400),
        });
        return;
      }
      const r = await tx.uma<{ versao: number; situacao: string }>(
        `SELECT x.versao, x.situacao FROM entrega_epi x JOIN vinculo_trabalho v ON v.id = x.vinculo_trabalho_id
          WHERE x.id = ? AND v.estabelecimento_id = ? AND x.excluido_em IS NULL`,
        [x.id, est],
      );
      if (!r) throw naoEncontrado('Entrega de EPI');
      if (r.situacao === 'cancelado') throw recusa('entrega-cancelada', 'A entrega já está cancelada.');
      await tx.alterar('entrega_epi', x.id, Number(r.versao), {
        situacao: 'cancelado',
        motivo_cancelamento: x.motivo.slice(0, 400),
      });
    },

    async registrarCorrecao(x) {
      // O valor anterior e o novo vão na trilha da mesma transação (dados da linha da operação).
      const atual = (anotacao.dados?.['correcoes'] as unknown[] | undefined) ?? [];
      anotacao.dados = {
        ...(anotacao.dados ?? {}),
        correcoes: [
          ...atual,
          { tabela: x.tabela, registro: x.registro, operacao: x.operacao, antes: x.antes, depois: x.depois },
        ],
      };
      motivo(x.motivo);
    },
  };
}

export function portaSesmtIndisponivel(): PortaSesmt {
  return portaIndisponivel<PortaSesmt>(METODOS_PORTA_SESMT);
}
