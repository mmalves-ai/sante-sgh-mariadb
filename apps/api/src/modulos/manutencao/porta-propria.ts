// Porta PRÓPRIA da manutenção e engenharia clínica (M55) sobre o MariaDB do cliente, pelo @sgh/nucleo:
// equipamento_saude, ordem_servico_manutencao (+ _evento e _item), plano_preventivo (+ _equipamento), execucao_preventiva,
// contrato_servico_terceirizado (+ _item) e notificacao_usuario; os cadastros lidos de centro_custo, setor_funcional,
// unidade_assistencial, recurso_agendavel, usuario, empresa_fornecedora, fabricante, causa_falha_equipamento e curso.
// Leituras somente leitura; gravações diretas numa operação do Executor (gravacaoDireta: trilha, outbox e idempotência na
// mesma transação), com a OS, o plano e o contrato relidos e travados (FOR UPDATE) e conferidos pela versão vista.
// Toda leitura do estabelecimento filtra `estabelecimento_id` e `excluido_em IS NULL`; o fornecedor, o fabricante, a
// causa da falha e o curso são cadastros do cliente (rede inteira, sem estabelecimento).
// Melhoria: instantes no fuso do estabelecimento (estabelecimento.fuso_horario), não no relógio do servidor.
// Melhoria: o "setor" da tela é o centro de custo (id); o setor funcional e a unidade vêm dele (sem código digitado).
// Melhoria: o fabricante e a causa da falha são cadastros (FK), não texto livre; o digitado entra no cadastro uma vez.
// Melhoria: a parada do equipamento é o próprio estado da OS (equipamento_parado) e o fim da parada é o evento
// "devolução do equipamento" no histórico da OS; o início e o fim do reparo são o item de serviço da OS.
// Melhoria: o número da OS vem da sequencia_negocio do estabelecimento (ano + sequencial), não do id.
// Melhoria: as versões anteriores do plano e do contrato vêm da trilha de auditoria (o retrato de antes, com o motivo),
// sem tabela de versões à parte; a exclusão do contrato é lógica (excluido_em), auditável.
// Melhoria: a execução reprovada ou com restrição exige justificativa de 10 caracteres (CHECK do banco, conferido antes).
// Melhoria: o aceite do solicitante fica na própria OS (aceite_resultado, aceite_em, aceite_usuario_id e a justificativa
// da recusa) e no histórico como "aceite" ou "recusa_aceite"; quem encerrou fica registrado (o solicitante ou o técnico
// no aceite vencido). A recusa exige justificativa de 10 caracteres (CHECK do banco, conferido antes).
// Melhoria: o laudo e a OS corretiva da execução são conferidos (do estabelecimento, não excluídos) antes de gravar.
// Melhoria: o número do contrato é único por fornecedor (a mesma regra da porta de memória e da UNIQUE do banco,
// uq_contrato_servico_terceirizado_fornecedor_numero, F2.2 onda 3).
// Decisão (registrada em saida/03-03.json): esta API trata o plano como de UM equipamento. O plano com vários alvos
// (vindo do conector ou de outra tela) é lido uma vez, com o menor equipamento, e a execução dele é recusada
// (`plano-varios-alvos`); o plano só de ambiente climatizado ou de bem patrimonial não é desta tela e não aparece.
// Tecnovigilância ligada ao parque: o alerta é o alerta_sanitario da área `equipamento` (fabricante, modelo e faixa de
// série), as OS de ação de campo ficam em alerta_sanitario_equipamento e a queixa técnica do equipamento é a
// queixa_tecnica_produto ligada à OS (com o andamento em queixa_tecnica_produto_evento). O número digitado do alerta é a
// identificação do emissor; o número interno vem da sequencia_negocio. A exclusão do alerta é lógica e só sem vínculo.
// Treinamento e ciclo de vida: o curso exigido por modelo é o modelo_equipamento_curso (fabricante do cadastro e modelo
// normalizado; desvincular é exclusão lógica, e vincular de novo reativa a mesma linha); os eventos são o
// evento_ciclo_equipamento, com o valor contábil lido do patrimônio na data (última cota de depreciação até a data ou,
// sem cota, o valor de aquisição). A desativação grava a data no equipamento (desativado_em).
// A OS guarda o laudo próprio (laudo_arquivo_id, arquivo do estabelecimento) e o plano guarda o modelo pronto de origem
// (modelo_plano_codigo e modelo_plano_versao).
import {
  type AlertaEquipamento,
  ATIVIDADES_PLANO,
  CAUSAS_FALHA,
  type CausaFalha,
  COBERTURAS_CONTRATO,
  type ConclusaoDeCurso,
  type CursoDoModelo,
  type EventoCicloVida,
  type SituacaoAlertaEquipamento,
  SITUACOES_OS_ABERTAS,
  type SituacaoOs,
  type TipoRecursoAgenda,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type Executor,
  garantirSequencia,
  type Leitor,
  type NucleoProprio,
  recusa,
  restricaoUnicaViolada,
  type TxOperacao,
} from '@sgh/nucleo';
import { type AnotacaoGravacao, gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import { civil, FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../exames/relogio.js';
import type { CursoDoCatalogo, FiltroPeriodoPorta, GravadorManutencao, PortaManutencao } from './porta.js';
import type {
  AcaoDeCampo,
  AlertaParaAlterar,
  AlertaParaIncluir,
  CamposOs,
  CoberturaManutencao,
  EquipamentoDoParque,
  EquipamentoManutencao,
  EquipamentoParaGravar,
  EventoOrdem,
  ExecucaoDoPlano,
  FiltroEquipamentos,
  FiltroOrdens,
  OcorrenciasDoPeriodo,
  OrdemServico,
  PlanoManutencao,
  RecursoDeAgenda,
  SetorManutencao,
  UnidadeManutencao,
  UsuarioDaOs,
  VersaoDaCobertura,
  VersaoDoPlano,
} from './tipos.js';
import { numeroDaOs, recusaAlerta, recusaCicloVida } from './tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoManutencao = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
type L = Pick<Leitor, 'consultar' | 'uma'>;

/** Natureza da queixa no modelo próprio, pelo tipo escolhido na OS. */
const NATUREZA_QUEIXA = {
  queixaTecnica: 'queixa_tecnica',
  eventoAdverso: 'evento_adverso',
  alertaSanitario: 'alerta_sanitario',
} as const;

const TETO = 500;
const TETO_LISTA = 200;
const SEM_EXECUTOR =
  'A manutenção não usa operação de tela do executor: as gravações são diretas, pela própria tela.';

/** As tabelas que a gravação direta da manutenção pode escrever (a transação recusa as outras). */
export const TABELAS_MANUTENCAO = [
  'equipamento_saude',
  'fabricante',
  'ordem_servico_manutencao',
  'ordem_servico_manutencao_evento',
  'ordem_servico_manutencao_item',
  'causa_falha_equipamento',
  'plano_preventivo',
  'plano_preventivo_equipamento',
  'execucao_preventiva',
  'oficina_manutencao',
  'sequencia_negocio',
  'contrato_servico_terceirizado',
  'contrato_servico_terceirizado_item',
  'notificacao_usuario',
  'alerta_sanitario',
  'alerta_sanitario_equipamento',
  'queixa_tecnica_produto',
  'queixa_tecnica_produto_evento',
  'modelo_equipamento_curso',
  'evento_ciclo_equipamento',
] as const;

// ── Conversões ──────────────────────────────────────────────────────────────────────────────────────────────────
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoN = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const corte = (v: string | null | undefined, max: number) => (v ? v.slice(0, max) : null);
/** "emAtendimento" → "em_atendimento" (o vocabulário do contrato para o do banco). */
const snake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
/** "em_atendimento" → "emAtendimento". */
const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const centavosN = (v: unknown) => (v === null || v === undefined ? null : centavos(v));
const reais = (c: number | null | undefined) => (c === null || c === undefined ? null : (c / 100).toFixed(2));
const json = (v: unknown): Record<string, unknown> => {
  if (v === null || v === undefined) return {};
  if (typeof v === 'string') {
    try {
      return json(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return typeof v === 'object' ? (v as Record<string, unknown>) : {};
};

/** Instante do banco (UTC) → "AAAA-MM-DDTHH:MM" no fuso do estabelecimento. */
function instante(v: unknown, fuso: string): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const c = civil(d, fuso);
  return `${c.data}T${c.hora}`;
}
/** "AAAA-MM-DDTHH:MM" (no fuso do estabelecimento) → instante do banco. */
function paraInstante(v: string, fuso: string): Date {
  const hh = v.length >= 16 ? `${v.slice(11, 13)}${v.slice(14, 16)}` : '0000';
  return instanteCivil(v.slice(0, 10), hh, fuso);
}
const paraInstanteN = (v: string | null | undefined, fuso: string) => (v ? paraInstante(v, fuso) : null);

/** O tipo de recurso de agenda da tela ↔ o tipo do recurso agendável. */
const TIPOS_DO_RECURSO: Readonly<Record<TipoRecursoAgenda, readonly string[]>> = {
  agendaConsulta: ['consultorio'],
  agendaExame: ['equipamento', 'cadeira', 'poltrona', 'leito_dia', 'outro'],
  salaCirurgica: ['sala'],
};
function tipoDoRecurso(t: unknown): TipoRecursoAgenda {
  const s = texto(t);
  if (s === 'consultorio') return 'agendaConsulta';
  if (s === 'sala') return 'salaCirurgica';
  return 'agendaExame';
}

const SITUACOES_ABERTAS_BANCO = SITUACOES_OS_ABERTAS.map(snake);
const GRAVIDADE_AVISO = { grave: 'alta', atencao: 'atencao', informacao: 'informativa' } as const;

const desatualizado = (o: string) =>
  recusa(
    'desatualizado',
    `${o} mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.`,
  );

function contextoDe(c: ContextoPortaM18): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: c.correlacao.slice(0, 64),
  };
}

async function fusoDe(l: L, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}

function relogio(fuso: string): { hoje: string; agora: string } {
  const r = relogioNoFuso(fuso);
  return { hoje: r.hoje, agora: `${r.hoje}T${r.hora}` };
}

// ── Leituras (as mesmas na consulta e dentro da gravação) ───────────────────────────────────────────────────────

const SQL_EQUIPAMENTO = `
  SELECT e.id, e.versao, e.codigo, e.nome, e.tipo, e.criticidade, e.classe_risco, f.nome AS fabricante, e.modelo,
         e.numero_serie, e.registro_anvisa, sf.unidade_assistencial_id AS unidade, e.centro_custo_id, e.localizacao,
         e.recurso_agendavel_id, r.tipo AS recurso_tipo, e.bem_patrimonial_id, e.instalado_em, e.garantia_ate,
         e.situacao, e.motivo_desativacao, e.desativado_em,
         (SELECT COUNT(*) FROM ordem_servico_manutencao o
           WHERE o.equipamento_saude_id = e.id AND o.excluido_em IS NULL
             AND o.situacao IN (${marcas(SITUACOES_ABERTAS_BANCO.length)})) AS os_abertas,
         (SELECT COUNT(*) FROM ordem_servico_manutencao o
           WHERE o.equipamento_saude_id = e.id AND o.excluido_em IS NULL AND o.equipamento_parado
             AND o.situacao <> 'cancelada') AS paradas
    FROM equipamento_saude e
    LEFT JOIN fabricante f ON f.id = e.fabricante_id
    LEFT JOIN setor_funcional sf ON sf.id = e.setor_funcional_id AND sf.excluido_em IS NULL
    LEFT JOIN recurso_agendavel r ON r.id = e.recurso_agendavel_id
   WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL`;

function equipamentoDe(x: Linha, fuso: string): EquipamentoManutencao {
  void fuso; // reservado às datas e horas do equipamento no fuso do estabelecimento
  const situacao = texto(x['situacao']) as EquipamentoManutencao['situacao'];
  return {
    id: n(x['id']),
    versao: n(x['versao']),
    codigo: texto(x['codigo']),
    nome: texto(x['nome']),
    tipo: texto(x['tipo']) as EquipamentoManutencao['tipo'],
    criticidade: texto(x['criticidade']) as EquipamentoManutencao['criticidade'],
    classeRisco: textoN(x['classe_risco']) as EquipamentoManutencao['classeRisco'],
    fabricante: textoN(x['fabricante']),
    modelo: textoN(x['modelo']),
    numeroSerie: textoN(x['numero_serie']),
    registroAnvisa: textoN(x['registro_anvisa']),
    unidade: nn(x['unidade']),
    centroCusto: n(x['centro_custo_id']),
    localizacao: textoN(x['localizacao']),
    recurso:
      x['recurso_agendavel_id'] === null || x['recurso_agendavel_id'] === undefined
        ? null
        : { tipo: tipoDoRecurso(x['recurso_tipo']), id: n(x['recurso_agendavel_id']) },
    bemPatrimonial: nn(x['bem_patrimonial_id']),
    instalacao: dataIso(x['instalado_em']),
    garantiaAte: dataIso(x['garantia_ate']),
    situacao,
    desativadoEm: situacao === 'desativado' ? dataIso(x['desativado_em']) : null,
    motivo: textoN(x['motivo_desativacao']),
    parado: n(x['paradas']) > 0,
    osAbertas: n(x['os_abertas']),
  };
}

async function lerEquipamentos(
  l: L,
  est: number,
  fuso: string,
  f: FiltroEquipamentos,
): Promise<{ itens: EquipamentoManutencao[]; proxima: number | null }> {
  const limite = Math.min(Math.max(f.limite ?? 50, 1), TETO);
  const onde: string[] = [];
  const p: unknown[] = [...SITUACOES_ABERTAS_BANCO, est];
  const termo = f.termo?.trim();
  if (termo) {
    onde.push('(e.codigo LIKE ? OR e.nome LIKE ? OR e.numero_serie LIKE ?)');
    const t = `%${termo.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    p.push(t, t, t);
  }
  if (f.centroCusto != null) {
    onde.push('e.centro_custo_id = ?');
    p.push(f.centroCusto);
  }
  if (f.tipo) {
    onde.push('e.tipo = ?');
    p.push(f.tipo);
  }
  if (f.criticidade) {
    onde.push('e.criticidade = ?');
    p.push(f.criticidade);
  }
  if (f.situacao) {
    onde.push('e.situacao = ?');
    p.push(f.situacao);
  }
  if (f.ids) {
    if (f.ids.length === 0) return { itens: [], proxima: null };
    onde.push(`e.id IN (${marcas(f.ids.length)})`);
    p.push(...f.ids);
  }
  if (f.antesDe != null) {
    onde.push('e.id < ?');
    p.push(f.antesDe);
  }
  const ls = await l.consultar(
    `${SQL_EQUIPAMENTO}${onde.map((o) => ` AND ${o}`).join('')} ORDER BY e.id DESC LIMIT ${limite + 1}`,
    p,
  );
  const itens = ls.slice(0, limite).map((x) => equipamentoDe(x, fuso));
  return { itens, proxima: ls.length > limite ? (itens.at(-1)?.id ?? null) : null };
}

async function lerEquipamento(
  l: L,
  est: number,
  fuso: string,
  filtro: { id: number } | { codigo: string },
): Promise<EquipamentoManutencao | null> {
  const [onde, valor] =
    'id' in filtro ? ['e.id = ?', filtro.id] : ['e.codigo = ?', filtro.codigo.trim().toUpperCase()];
  const x = await l.uma(`${SQL_EQUIPAMENTO} AND ${onde}`, [...SITUACOES_ABERTAS_BANCO, est, valor]);
  return x ? equipamentoDe(x, fuso) : null;
}

const SQL_OS = `
  SELECT o.id, o.versao, o.numero, o.natureza, o.equipamento_saude_id, o.centro_custo_id, o.local_descricao,
         o.descricao, o.contato, o.prioridade_sugerida, o.prioridade, o.situacao, us.login AS solicitante,
         ut.login AS tecnico, o.executor, o.contrato_servico_terceirizado_id, o.plano_preventivo_id, o.solicitado_em,
         o.assumido_em, o.concluido_em, o.encerrado_em, o.cancelado_em, o.justificativa_cancelamento,
         o.equipamento_parado, cf.codigo AS causa, o.solucao, o.custo_pecas, o.custo_mao_obra, o.custo_terceiros,
         o.laudo_arquivo_id,
         (SELECT MAX(v.ocorrido_em) FROM ordem_servico_manutencao_evento v
           WHERE v.ordem_servico_manutencao_id = o.id AND v.tipo_evento = 'devolucao_equipamento') AS parada_fim,
         (SELECT MIN(i.iniciado_em) FROM ordem_servico_manutencao_item i
           WHERE i.ordem_servico_manutencao_id = o.id AND i.tipo_item = 'servico' AND i.excluido_em IS NULL) AS inicio_reparo,
         (SELECT MAX(i.finalizado_em) FROM ordem_servico_manutencao_item i
           WHERE i.ordem_servico_manutencao_id = o.id AND i.tipo_item = 'servico' AND i.excluido_em IS NULL) AS fim_reparo
    FROM ordem_servico_manutencao o
    JOIN usuario us ON us.id = o.solicitante_usuario_id
    LEFT JOIN usuario ut ON ut.id = o.responsavel_usuario_id
    LEFT JOIN causa_falha_equipamento cf ON cf.id = o.causa_falha_equipamento_id
   WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL`;

function osDe(x: Linha, fuso: string): OrdemServico {
  const registro = instante(x['solicitado_em'], fuso) ?? '';
  const paradaFim = instante(x['parada_fim'], fuso);
  const prioridadeSugerida = texto(x['prioridade_sugerida']) as OrdemServico['prioridade'];
  return {
    id: n(x['id']),
    versao: n(x['versao']),
    numero: texto(x['numero']),
    natureza: camel(texto(x['natureza'])) as OrdemServico['natureza'],
    equipamento: nn(x['equipamento_saude_id']),
    centroCusto: n(x['centro_custo_id']),
    local: textoN(x['local_descricao']),
    descricao: texto(x['descricao']),
    contato: textoN(x['contato']),
    prioridadeSugerida,
    prioridade: (textoN(x['prioridade']) ?? prioridadeSugerida) as OrdemServico['prioridade'],
    situacao: camel(texto(x['situacao'])) as SituacaoOs,
    solicitante: texto(x['solicitante']),
    tecnico: textoN(x['tecnico']),
    executor: (textoN(x['executor']) ?? 'interno') as OrdemServico['executor'],
    cobertura: nn(x['contrato_servico_terceirizado_id']),
    plano: nn(x['plano_preventivo_id']),
    registro,
    assumidaEm: instante(x['assumido_em'], fuso),
    concluidaEm: instante(x['concluido_em'], fuso),
    encerradaEm: instante(x['encerrado_em'], fuso),
    canceladaEm: instante(x['cancelado_em'], fuso),
    motivoCancelamento: textoN(x['justificativa_cancelamento']),
    paradaInicio: verdadeiro(x['equipamento_parado']) || paradaFim !== null ? registro : null,
    paradaFim,
    causa: x['causa'] ? (camel(texto(x['causa'])) as CausaFalha) : null,
    solucao: textoN(x['solucao']),
    inicioReparo: instante(x['inicio_reparo'], fuso),
    fimReparo: instante(x['fim_reparo'], fuso),
    custoPecasCent: centavos(x['custo_pecas']),
    custoMaoDeObraCent: centavos(x['custo_mao_obra']),
    custoTerceirosCent: centavos(x['custo_terceiros']),
    laudo: nn(x['laudo_arquivo_id']),
  };
}

async function lerOs(l: L, est: number, fuso: string, id: number): Promise<OrdemServico | null> {
  const x = await l.uma(`${SQL_OS} AND o.id = ?`, [est, id]);
  return x ? osDe(x, fuso) : null;
}

const SQL_PLANO = `
  SELECT p.id, p.versao, p.atividade,
         (SELECT MIN(pe.equipamento_saude_id) FROM plano_preventivo_equipamento pe
           WHERE pe.plano_preventivo_id = p.id AND pe.excluido_em IS NULL) AS equipamento_saude_id, p.periodicidade_quantidade, p.periodicidade_unidade,
         p.data_base, p.antecedencia_dias, p.procedimento, p.executor, p.contrato_servico_terceirizado_id, p.ativo,
         p.modelo_plano_codigo, p.modelo_plano_versao,
         (SELECT x.data_execucao FROM execucao_preventiva x WHERE x.plano_preventivo_id = p.id AND x.excluido_em IS NULL
           ORDER BY x.data_execucao DESC, x.id DESC LIMIT 1) AS ultima_execucao,
         (SELECT x.resultado FROM execucao_preventiva x WHERE x.plano_preventivo_id = p.id AND x.excluido_em IS NULL
           ORDER BY x.data_execucao DESC, x.id DESC LIMIT 1) AS ultimo_resultado
    FROM plano_preventivo p
   WHERE p.estabelecimento_id = ?
     AND EXISTS (SELECT 1 FROM plano_preventivo_equipamento pe WHERE pe.plano_preventivo_id = p.id
                    AND pe.excluido_em IS NULL AND pe.equipamento_saude_id IS NOT NULL)`;

function planoDe(x: Linha): PlanoManutencao {
  return {
    id: n(x['id']),
    versao: n(x['versao']),
    equipamento: n(x['equipamento_saude_id']),
    atividade: camel(texto(x['atividade'])) as PlanoManutencao['atividade'],
    periodicidade: {
      quantidade: n(x['periodicidade_quantidade']),
      unidade: texto(x['periodicidade_unidade']) as PlanoManutencao['periodicidade']['unidade'],
    },
    dataBase: dataIso(x['data_base']) ?? '',
    antecedenciaDias: nn(x['antecedencia_dias']),
    procedimento: textoN(x['procedimento']),
    executor: texto(x['executor']) as PlanoManutencao['executor'],
    cobertura: nn(x['contrato_servico_terceirizado_id']),
    ativo: verdadeiro(x['ativo']),
    modelo:
      x['modelo_plano_codigo'] === null || x['modelo_plano_codigo'] === undefined
        ? null
        : { codigo: texto(x['modelo_plano_codigo']), versao: n(x['modelo_plano_versao']) },
    ultimaExecucao: dataIso(x['ultima_execucao']),
    ultimoResultado: x['ultimo_resultado']
      ? (camel(texto(x['ultimo_resultado'])) as PlanoManutencao['ultimoResultado'])
      : null,
  };
}

async function lerPlano(l: L, est: number, id: number): Promise<PlanoManutencao | null> {
  const x = await l.uma(`${SQL_PLANO} AND p.id = ?`, [est, id]);
  return x ? planoDe(x) : null;
}

const SQL_COBERTURA = `
  SELECT c.id, c.versao, c.empresa_fornecedora_id, c.numero, c.cobertura, c.inicio_vigencia, c.fim_vigencia,
         c.prazo_atendimento_horas, c.valor_parcela, c.situacao, c.contrato_fornecedor_id,
         (SELECT t.motivo FROM trilha_auditoria t
           WHERE t.entidade = 'contrato_servico_terceirizado' AND t.entidade_id = c.id
             AND JSON_VALUE(t.dados_depois, '$.dados.operacao') = 'encerramento'
           ORDER BY t.id DESC LIMIT 1) AS motivo_encerramento
    FROM contrato_servico_terceirizado c
   WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL`;

async function equipamentosDoContrato(l: L, contratos: readonly number[]): Promise<Map<number, number[]>> {
  const m = new Map<number, number[]>();
  if (contratos.length === 0) return m;
  const ls = await l.consultar(
    `SELECT contrato_servico_terceirizado_id AS contrato, equipamento_saude_id FROM contrato_servico_terceirizado_item
      WHERE contrato_servico_terceirizado_id IN (${marcas(contratos.length)}) AND tipo_item = 'equipamento'
        AND excluido_em IS NULL ORDER BY equipamento_saude_id`,
    [...contratos],
  );
  for (const x of ls) {
    const k = n(x['contrato']);
    m.set(k, [...(m.get(k) ?? []), n(x['equipamento_saude_id'])]);
  }
  return m;
}

function coberturaDe(x: Linha, equipamentos: readonly number[]): CoberturaManutencao {
  const encerrada = texto(x['situacao']) === 'encerrado';
  return {
    id: n(x['id']),
    versao: n(x['versao']),
    fornecedor: n(x['empresa_fornecedora_id']),
    numero: texto(x['numero']),
    cobertura: camel(texto(x['cobertura'])) as CoberturaManutencao['cobertura'],
    inicio: dataIso(x['inicio_vigencia']) ?? '',
    fim: dataIso(x['fim_vigencia']) ?? '',
    slaHoras: nn(x['prazo_atendimento_horas']),
    valorMensalCent: centavosN(x['valor_parcela']),
    contrato: nn(x['contrato_fornecedor_id']),
    ativa: texto(x['situacao']) === 'vigente',
    equipamentos,
    encerradaEm: encerrada ? dataIso(x['fim_vigencia']) : null,
    motivoEncerramento: encerrada ? textoN(x['motivo_encerramento']) : null,
  };
}

async function lerCoberturas(
  l: L,
  est: number,
  f: { equipamento?: number | null; ids?: readonly number[] | null; id?: number } = {},
): Promise<CoberturaManutencao[]> {
  let sql = SQL_COBERTURA;
  const p: unknown[] = [est];
  if (f.id !== undefined) {
    sql += ' AND c.id = ?';
    p.push(f.id);
  }
  if (f.ids) {
    if (f.ids.length === 0) return [];
    sql += ` AND c.id IN (${marcas(f.ids.length)})`;
    p.push(...f.ids);
  }
  if (f.equipamento != null) {
    sql += ` AND EXISTS (SELECT 1 FROM contrato_servico_terceirizado_item i WHERE i.contrato_servico_terceirizado_id = c.id
               AND i.tipo_item = 'equipamento' AND i.equipamento_saude_id = ? AND i.excluido_em IS NULL)`;
    p.push(f.equipamento);
  }
  sql += ` ORDER BY c.id DESC LIMIT ${TETO}`;
  const ls = await l.consultar(sql, p);
  const eqs = await equipamentosDoContrato(
    l,
    ls.map((x) => n(x['id'])),
  );
  return ls.map((x) => coberturaDe(x, eqs.get(n(x['id'])) ?? []));
}

async function lerSetores(l: L, est: number): Promise<SetorManutencao[]> {
  const ls = await l.consultar(
    `SELECT cc.id, cc.nome, cc.sigla, cc.ativo, sf.unidade_assistencial_id
       FROM centro_custo cc LEFT JOIN setor_funcional sf ON sf.id = cc.setor_funcional_id AND sf.excluido_em IS NULL
      WHERE cc.estabelecimento_id = ? AND cc.excluido_em IS NULL ORDER BY cc.nome LIMIT ${TETO * 4}`,
    [est],
  );
  return ls.map((x) => ({
    codigo: n(x['id']),
    nome: texto(x['nome']),
    sigla: textoN(x['sigla']),
    unidade: nn(x['unidade_assistencial_id']),
    ativo: verdadeiro(x['ativo']),
  }));
}

async function lerRecurso(
  l: L,
  est: number,
  tipo: TipoRecursoAgenda | null,
  id: number | null,
): Promise<RecursoDeAgenda[]> {
  const onde: string[] = ['r.estabelecimento_id = ?', 'r.excluido_em IS NULL'];
  const p: unknown[] = [est];
  if (tipo) {
    onde.push(`r.tipo IN (${marcas(TIPOS_DO_RECURSO[tipo].length)})`);
    p.push(...TIPOS_DO_RECURSO[tipo]);
  }
  if (id !== null) {
    onde.push('r.id = ?');
    p.push(id);
  }
  const ls = await l.consultar(
    `SELECT r.id, r.descricao, r.tipo, r.ativo, sf.centro_custo_id
       FROM recurso_agendavel r LEFT JOIN setor_funcional sf ON sf.id = r.setor_funcional_id AND sf.excluido_em IS NULL
      WHERE ${onde.join(' AND ')} ORDER BY r.descricao LIMIT ${TETO}`,
    p,
  );
  return ls.map((x) => ({
    tipo: tipo ?? tipoDoRecurso(x['tipo']),
    id: n(x['id']),
    nome: texto(x['descricao']),
    ativo: verdadeiro(x['ativo']),
    centroCusto: nn(x['centro_custo_id']),
  }));
}

/** Os logins da unidade do setor (usuario_unidade) e o responsável pelo centro de custo. */
async function loginsDoSetor(l: L, est: number, centro: number): Promise<string[]> {
  const ls = await l.consultar(
    `SELECT u.login FROM centro_custo cc
       JOIN setor_funcional sf ON sf.id = cc.setor_funcional_id AND sf.excluido_em IS NULL
       JOIN usuario_unidade uu ON uu.unidade_assistencial_id = sf.unidade_assistencial_id AND uu.excluido_em IS NULL
       JOIN usuario u ON u.id = uu.usuario_id
      WHERE cc.id = ? AND cc.estabelecimento_id = ? AND cc.excluido_em IS NULL AND u.situacao = 'ativo'
     UNION
     SELECT u.login FROM centro_custo cc JOIN usuario u ON u.id = cc.responsavel_usuario_id
      WHERE cc.id = ? AND cc.estabelecimento_id = ? AND cc.excluido_em IS NULL AND u.situacao = 'ativo'
     ORDER BY login LIMIT 100`,
    [centro, est, centro, est],
  );
  return [...new Set(ls.map((x) => texto(x['login'])).filter(Boolean))];
}

async function equipamentosDoRecurso(l: L, est: number, recurso: number): Promise<number[]> {
  const ls = await l.consultar(
    `SELECT id FROM equipamento_saude WHERE estabelecimento_id = ? AND recurso_agendavel_id = ? AND excluido_em IS NULL
      ORDER BY id LIMIT ${TETO}`,
    [est, recurso],
  );
  return ls.map((x) => n(x['id']));
}

async function osAbertasDoEquipamento(l: L, est: number, eq: number): Promise<number[]> {
  const ls = await l.consultar(
    `SELECT id FROM ordem_servico_manutencao WHERE estabelecimento_id = ? AND equipamento_saude_id = ?
        AND excluido_em IS NULL AND situacao IN (${marcas(SITUACOES_ABERTAS_BANCO.length)}) ORDER BY id LIMIT ${TETO}`,
    [est, eq, ...SITUACOES_ABERTAS_BANCO],
  );
  return ls.map((x) => n(x['id']));
}

async function planosAtivosDoContrato(
  l: L,
  est: number,
  contrato: number,
  equipamentos?: readonly number[],
): Promise<number> {
  const p: unknown[] = [est, contrato];
  let filtro = '';
  if (equipamentos) {
    if (equipamentos.length === 0) return 0;
    filtro = ` AND EXISTS (SELECT 1 FROM plano_preventivo_equipamento pe WHERE pe.plano_preventivo_id = p.id
                 AND pe.excluido_em IS NULL AND pe.equipamento_saude_id IN (${marcas(equipamentos.length)}))`;
    p.push(...equipamentos);
  }
  const r = await l.uma<{ n: number }>(
    `SELECT COUNT(*) AS n FROM plano_preventivo p WHERE p.estabelecimento_id = ? AND p.contrato_servico_terceirizado_id = ?
        AND p.ativo${filtro}`,
    p,
  );
  return n(r?.n);
}

// ── Tecnovigilância, treinamento por modelo e ciclo de vida ────────────────────────────────────────────────────

/** O tipo do alerta da tela ↔ o tipo de ação do alerta sanitário. */
const TIPO_ACAO_ALERTA = { recall: 'recolhimento', alerta: 'alerta_risco' } as const;
/** As situações do alerta sanitário que a tela mostra como encerrado. */
const ALERTA_ENCERRADO = ['concluido', 'nao_se_aplica', 'cancelado'] as const;

const SQL_ALERTA = `
  SELECT a.id, a.versao, a.numero, a.identificacao_externa, a.tipo_acao, a.origem, a.titulo, f.nome AS fabricante,
         a.modelo, a.numero_serie_inicial, a.numero_serie_final, a.registro_anvisa, a.publicado_em, a.descricao,
         a.acao_recomendada, a.situacao, a.concluido_em, a.conclusao, a.criado_em, uc.login AS criado_por_login,
         ua.login AS alterado_por_login,
         (SELECT COUNT(*) FROM alerta_sanitario_equipamento q
           WHERE q.alerta_sanitario_id = a.id AND q.excluido_em IS NULL) AS acoes
    FROM alerta_sanitario a
    LEFT JOIN fabricante f ON f.id = a.fabricante_id
    LEFT JOIN usuario uc ON uc.id = a.criado_por
    LEFT JOIN usuario ua ON ua.id = a.alterado_por
   WHERE a.estabelecimento_id = ? AND a.area = 'equipamento' AND a.excluido_em IS NULL`;

function alertaDe(x: Linha, fuso: string): AlertaEquipamento {
  const situacao: SituacaoAlertaEquipamento = (ALERTA_ENCERRADO as readonly string[]).includes(
    texto(x['situacao']),
  )
    ? 'encerrado'
    : 'aberto';
  const tipoAcao = texto(x['tipo_acao']);
  return {
    id: n(x['id']),
    numero: textoN(x['identificacao_externa']) ?? texto(x['numero']),
    tipo: tipoAcao === 'recolhimento' || tipoAcao === 'correcao_campo' ? 'recall' : 'alerta',
    origem: texto(x['origem']) === 'integracao' ? 'anvisa' : 'manual',
    titulo: texto(x['titulo']),
    fabricante: texto(x['fabricante']),
    modelo: textoN(x['modelo']),
    serieInicio: textoN(x['numero_serie_inicial']),
    serieFim: textoN(x['numero_serie_final']),
    registroAnvisa: textoN(x['registro_anvisa']),
    publicadoEm: dataIso(x['publicado_em']),
    descricao: texto(x['descricao']),
    acao: texto(x['acao_recomendada']),
    situacao,
    encerradoEm: situacao === 'encerrado' ? instante(x['concluido_em'], fuso) : null,
    encerradoPor: situacao === 'encerrado' ? textoN(x['alterado_por_login']) : null,
    motivo: situacao === 'encerrado' ? textoN(x['conclusao']) : null,
    versao: n(x['versao']),
    criadoPor: texto(x['criado_por_login']),
    criadoEm: instante(x['criado_em'], fuso) ?? '',
    acoes: n(x['acoes']),
  };
}

async function lerAlertas(
  l: L,
  est: number,
  fuso: string,
  f: { id?: number; situacao?: SituacaoAlertaEquipamento | null },
): Promise<AlertaEquipamento[]> {
  const p: unknown[] = [est];
  let onde = '';
  if (f.id !== undefined) {
    onde += ' AND a.id = ?';
    p.push(f.id);
  }
  if (f.situacao)
    onde += ` AND a.situacao ${f.situacao === 'encerrado' ? '' : 'NOT '}IN (${marcas(ALERTA_ENCERRADO.length)})`;
  if (f.situacao) p.push(...ALERTA_ENCERRADO);
  return (
    await l.consultar(`${SQL_ALERTA}${onde} ORDER BY a.recebido_em DESC, a.id DESC LIMIT ${TETO}`, p)
  ).map((x) => alertaDe(x, fuso));
}

async function lerAcoesDoAlerta(l: L, est: number, fuso: string, alerta: number): Promise<AcaoDeCampo[]> {
  return (
    await l.consultar(
      `SELECT q.equipamento_saude_id, o.id AS os, o.numero, o.situacao, u.login, q.criado_em,
              (SELECT k.id FROM queixa_tecnica_produto k
                WHERE k.ordem_servico_manutencao_id = o.id AND k.excluido_em IS NULL LIMIT 1) AS queixa
         FROM alerta_sanitario_equipamento q
         JOIN alerta_sanitario a ON a.id = q.alerta_sanitario_id AND a.estabelecimento_id = ? AND a.excluido_em IS NULL
         JOIN ordem_servico_manutencao o ON o.id = q.ordem_servico_manutencao_id
         LEFT JOIN usuario u ON u.id = q.criado_por
        WHERE q.alerta_sanitario_id = ? AND q.excluido_em IS NULL
        ORDER BY q.id LIMIT ${TETO * 4}`,
      [est, alerta],
    )
  ).map((x) => ({
    equipamento: n(x['equipamento_saude_id']),
    os: { id: n(x['os']), numero: texto(x['numero']), situacao: camel(texto(x['situacao'])) },
    queixa: nn(x['queixa']),
    por: texto(x['login']),
    em: instante(x['criado_em'], fuso) ?? '',
  }));
}

/** O parque candidato: os equipamentos com fabricante e não desativados, mais os que já têm OS do alerta. */
async function lerParqueDoAlerta(l: L, est: number, alerta: number): Promise<EquipamentoDoParque[]> {
  if (
    !(await l.uma(
      "SELECT id FROM alerta_sanitario WHERE id = ? AND estabelecimento_id = ? AND area = 'equipamento' AND excluido_em IS NULL",
      [alerta, est],
    ))
  )
    return [];
  return (
    await l.consultar(
      `SELECT e.id, e.codigo, e.nome, f.nome AS fabricante, e.modelo, e.numero_serie, e.centro_custo_id, e.situacao
         FROM equipamento_saude e
         LEFT JOIN fabricante f ON f.id = e.fabricante_id
        WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL
          AND ((e.fabricante_id IS NOT NULL AND e.situacao <> 'desativado')
               OR EXISTS (SELECT 1 FROM alerta_sanitario_equipamento q
                           WHERE q.equipamento_saude_id = e.id AND q.alerta_sanitario_id = ? AND q.excluido_em IS NULL))
        ORDER BY e.codigo LIMIT ${TETO * 4}`,
      [est, alerta],
    )
  ).map((x) => ({
    id: n(x['id']),
    codigo: texto(x['codigo']),
    nome: texto(x['nome']),
    fabricante: textoN(x['fabricante']),
    modelo: textoN(x['modelo']),
    numeroSerie: textoN(x['numero_serie']),
    centroCusto: n(x['centro_custo_id']),
    situacao: texto(x['situacao']),
  }));
}

const SQL_CURSO_MODELO = `
  SELECT m.id, UPPER(f.nome) AS fabricante, m.modelo, m.curso_id, cu.codigo, cu.nome, cu.ativo, cu.validade_meses,
         u.login, m.criado_em
    FROM modelo_equipamento_curso m
    JOIN fabricante f ON f.id = m.fabricante_id
    JOIN curso cu ON cu.id = m.curso_id
    LEFT JOIN usuario u ON u.id = m.criado_por
   WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL`;

async function lerCursosModelo(
  l: L,
  est: number,
  fuso: string,
  f: { id?: number; chave?: { fabricante: string; modelo: string } },
): Promise<CursoDoModelo[]> {
  const p: unknown[] = [est];
  let onde = '';
  if (f.id !== undefined) {
    onde += ' AND m.id = ?';
    p.push(f.id);
  }
  if (f.chave) {
    onde += ' AND UPPER(TRIM(f.nome)) = ? AND m.modelo = ?';
    p.push(f.chave.fabricante.trim().toUpperCase(), f.chave.modelo);
  }
  return (
    await l.consultar(`${SQL_CURSO_MODELO}${onde} ORDER BY f.nome, m.modelo, cu.nome LIMIT ${TETO}`, p)
  ).map((x) => ({
    id: n(x['id']),
    fabricante: texto(x['fabricante']),
    modelo: texto(x['modelo']),
    curso: n(x['curso_id']),
    cursoCodigo: texto(x['codigo']),
    cursoTitulo: texto(x['nome']),
    cursoAtivo: verdadeiro(x['ativo']),
    validadeMeses: n(x['validade_meses']),
    criadoPor: texto(x['login']),
    criadoEm: instante(x['criado_em'], fuso) ?? '',
  }));
}

async function lerEventosCiclo(
  l: L,
  est: number,
  fuso: string,
  equipamento: number,
): Promise<EventoCicloVida[]> {
  return (
    await l.consultar(
      `SELECT v.id, v.equipamento_saude_id, v.tipo, v.data_evento, v.motivo, v.documento, v.destino, v.valor_contabil,
              v.valor_obtido, v.autorizado_por, u.login, v.criado_em
         FROM evento_ciclo_equipamento v
         JOIN equipamento_saude e ON e.id = v.equipamento_saude_id AND e.estabelecimento_id = ? AND e.excluido_em IS NULL
         LEFT JOIN usuario u ON u.id = v.criado_por
        WHERE v.equipamento_saude_id = ? AND v.excluido_em IS NULL
        ORDER BY v.data_evento, v.id`,
      [est, equipamento],
    )
  ).map((x) => ({
    id: n(x['id']),
    equipamento: n(x['equipamento_saude_id']),
    tipo: texto(x['tipo']) as EventoCicloVida['tipo'],
    data: dataIso(x['data_evento']) ?? '',
    motivo: texto(x['motivo']),
    documento: textoN(x['documento']),
    destino: textoN(x['destino']) as EventoCicloVida['destino'],
    valorContabilCent: centavosN(x['valor_contabil']),
    valorObtidoCent: centavosN(x['valor_obtido']),
    autorizadoPor: texto(x['autorizado_por']),
    por: texto(x['login']),
    em: instante(x['criado_em'], fuso) ?? '',
  }));
}

async function lerVinculosTecnovigDaOs(l: L, est: number, os: number) {
  const k = await l.uma<{ id: number }>(
    'SELECT id FROM queixa_tecnica_produto WHERE ordem_servico_manutencao_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL LIMIT 1',
    [os, est],
  );
  const a = await l.uma(
    `SELECT a.id, COALESCE(a.identificacao_externa, a.numero) AS numero
       FROM alerta_sanitario_equipamento q
       JOIN alerta_sanitario a ON a.id = q.alerta_sanitario_id AND a.estabelecimento_id = ? AND a.excluido_em IS NULL
      WHERE q.ordem_servico_manutencao_id = ? AND q.excluido_em IS NULL LIMIT 1`,
    [est, os],
  );
  return {
    queixa: k ? n(k.id) : null,
    alerta: a ? { id: n(a['id']), numero: texto(a['numero']) } : null,
  };
}

// ── Gravação ────────────────────────────────────────────────────────────────────────────────────────────────────

/** O usuário pelo login (a tela fala login; o banco guarda o id). */
async function usuarioPorLogin(l: L, login: string | null | undefined): Promise<number | null> {
  if (!login) return null;
  const r = await l.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ? LIMIT 1', [login.trim()]);
  return r ? n(r.id) : null;
}

/** O centro de custo do estabelecimento e o setor funcional ligado a ele. */
async function centroDe(l: L, est: number, centro: number): Promise<{ id: number; setor: number | null }> {
  const r = await l.uma(
    'SELECT id, setor_funcional_id FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [centro, est],
  );
  if (!r)
    throw recusa('setor-invalido', 'O setor (centro de custo) não é deste estabelecimento.', {
      campos: ['centroCusto'],
    });
  return { id: n(r['id']), setor: nn(r['setor_funcional_id']) };
}

function gravador(
  tx: TxOperacao,
  est: number,
  an: AnotacaoGravacao,
  c: ContextoPortaM18,
): GravadorManutencao {
  let fusoP: Promise<string> | null = null;
  const fuso = () => (fusoP ??= fusoDe(tx, est));
  const usuario = c.usuario;

  const travarLinha = async (sql: string, id: number, versaoVista: number | null, rotulo: string) => {
    const [r] = await tx.consultarParaAtualizar(sql, [id, est]);
    if (!r || (versaoVista !== null && n(r['versao']) !== versaoVista)) throw desatualizado(rotulo);
    return r;
  };

  const fabricanteId = async (nome: string | null): Promise<number | null> => {
    const t = nome?.trim();
    if (!t) return null;
    const r = await tx.uma<{ id: number }>(
      'SELECT id FROM fabricante WHERE nome = ? AND excluido_em IS NULL LIMIT 1',
      [t],
    );
    return r ? n(r.id) : tx.incluir('fabricante', { nome: t.slice(0, 150) });
  };

  const causaId = async (causa: CausaFalha | null): Promise<number | null> => {
    if (!causa) return null;
    const codigo = snake(causa);
    const r = await tx.uma<{ id: number }>('SELECT id FROM causa_falha_equipamento WHERE codigo = ?', [
      codigo,
    ]);
    // Semente: a causa do vocabulário entra no cadastro do cliente na primeira OS que a usa.
    return r
      ? n(r.id)
      : tx.incluir('causa_falha_equipamento', {
          codigo,
          descricao: CAUSAS_FALHA[causa],
          atribuivel_ao_uso: causa === 'usoInadequado' || causa === 'acidente',
        });
  };

  const recursoId = async (r: EquipamentoParaGravar['recurso']): Promise<number | null> => {
    if (!r) return null;
    const [x] = await lerRecurso(tx, est, r.tipo, r.id);
    if (!x)
      throw recusa('recurso-invalido', 'O recurso de agenda não é deste estabelecimento.', {
        campos: ['recurso'],
      });
    return x.id;
  };

  const valoresEquipamento = async (x: EquipamentoParaGravar) => {
    const centro = await centroDe(tx, est, x.centroCusto);
    return {
      codigo: x.codigo.trim().toUpperCase().slice(0, 30),
      nome: x.nome.trim().slice(0, 150),
      tipo: x.tipo,
      criticidade: x.criticidade,
      classe_risco: x.tipo === 'medico' ? x.classeRisco : null,
      fabricante_id: await fabricanteId(x.fabricante),
      modelo: corte(x.modelo?.trim(), 60),
      numero_serie: corte(x.numeroSerie?.trim(), 40),
      registro_anvisa: x.registroAnvisa?.trim() || null,
      centro_custo_id: centro.id,
      setor_funcional_id: centro.setor,
      localizacao: corte(x.localizacao?.trim(), 150),
      recurso_agendavel_id: await recursoId(x.recurso),
      bem_patrimonial_id: x.bemPatrimonial,
      instalado_em: x.instalacao,
      garantia_ate: x.garantiaAte,
      situacao: x.situacao,
      motivo_desativacao: x.situacao === 'desativado' ? corte(x.motivo?.trim(), 500) : null,
      // A data da desativação (CHECK: só o desativado tem data); quem já estava desativado guarda a data que tinha.
      desativado_em: x.situacao === 'desativado' ? relogio(await fuso()).hoje : null,
    };
  };

  const comCodigoUnico = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (erro) {
      if (restricaoUnicaViolada(erro) === 'uq_equipamento_saude_codigo')
        throw recusa('codigo-repetido', 'Já há um equipamento com este código no estabelecimento.', {
          campos: ['codigo'],
        });
      throw erro;
    }
  };

  const evento = async (
    os: number,
    x: {
      tipo: string;
      de: string | null;
      para: string | null;
      nota: string | null;
      em: Date;
    },
  ) =>
    tx.incluir('ordem_servico_manutencao_evento', {
      ordem_servico_manutencao_id: os,
      tipo_evento: x.tipo,
      situacao_anterior: x.de,
      situacao_nova: x.para,
      nota: corte(x.nota, 2000),
      ocorrido_em: x.em,
      usuario_id: usuario,
    });

  const proximoNumero = async (tipo: string): Promise<number> => {
    await garantirSequencia(tx, { tipo, estabelecimento: est }, { usuario, agora: new Date() });
    return (await tx.proximoNumero(tipo)).valor;
  };

  /** A oficina padrão do estabelecimento (semente na primeira gravação de plano, quando não há nenhuma). */
  const oficinaPadrao = async (): Promise<number> => {
    const r = await tx.uma<{ id: number }>(
      'SELECT id FROM oficina_manutencao WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY id LIMIT 1',
      [est],
    );
    if (r) return n(r.id);
    return tx.incluir('oficina_manutencao', {
      estabelecimento_id: est,
      codigo: 'MANUTENCAO',
      nome: 'Manutenção',
    });
  };

  const SQL_TRAVA_OS =
    'SELECT id, versao, situacao, responsavel_usuario_id, assumido_em, equipamento_saude_id FROM ordem_servico_manutencao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL';
  const SQL_TRAVA_PLANO =
    'SELECT id, versao, ativo, atividade, periodicidade_quantidade, periodicidade_unidade, data_base, antecedencia_dias, procedimento, executor, contrato_servico_terceirizado_id FROM plano_preventivo WHERE id = ? AND estabelecimento_id = ?';
  const SQL_TRAVA_CONTRATO =
    'SELECT id, versao, situacao, inicio_vigencia, fim_vigencia, prazo_atendimento_horas, valor_parcela FROM contrato_servico_terceirizado WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL';

  const equipamentoDoEstabelecimento = async (id: number) => {
    const r = await tx.uma(
      'SELECT id, setor_funcional_id FROM equipamento_saude WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
    );
    if (!r)
      throw recusa('equipamento-invalido', 'O equipamento não é deste estabelecimento.', {
        campos: ['equipamento'],
      });
    return { id: n(r['id']), setor: nn(r['setor_funcional_id']) };
  };

  const contratoValido = async (executor: string, contrato: number | null): Promise<number | null> => {
    if (executor !== 'contrato' || contrato === null) return null;
    const r = await tx.uma(
      'SELECT id FROM contrato_servico_terceirizado WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [contrato, est],
    );
    if (!r)
      throw recusa('contrato-invalido', 'O contrato de manutenção não é deste estabelecimento.', {
        campos: ['cobertura'],
      });
    return contrato;
  };

  const retratoContrato = async (r: Linha) => ({
    versao: n(r['versao']),
    inicio: dataIso(r['inicio_vigencia']),
    fim: dataIso(r['fim_vigencia']),
    slaHoras: nn(r['prazo_atendimento_horas']),
    valorMensalCent: centavosN(r['valor_parcela']),
    equipamentos: (await equipamentosDoContrato(tx, [n(r['id'])])).get(n(r['id'])) ?? [],
  });

  /** O número digitado do alerta (a identificação do emissor) é único entre os alertas de equipamento ativos. */
  const identificacaoLivre = async (numero: string, proprio: number | null) => {
    const r = await tx.uma(
      "SELECT id FROM alerta_sanitario WHERE estabelecimento_id = ? AND area = 'equipamento' AND excluido_em IS NULL AND UPPER(TRIM(identificacao_externa)) = ? AND id <> ? LIMIT 1",
      [est, numero.trim().toUpperCase(), proprio ?? 0],
    );
    if (r) throw recusaAlerta('numero-repetido');
  };
  const camposAlerta = async (x: AlertaParaIncluir | AlertaParaAlterar) => {
    const fabricante = x.fabricante.trim();
    return {
      identificacao_externa: x.numero.trim().slice(0, 60),
      emissor: x.tipo === 'recall' ? 'fabricante' : 'vigilancia_nacional',
      tipo_acao: TIPO_ACAO_ALERTA[x.tipo],
      titulo: x.titulo.trim().slice(0, 200),
      descricao: x.descricao,
      fabricante_id: await fabricanteId(fabricante),
      modelo: corte(x.modelo?.trim(), 60),
      produto_descricao: `${fabricante}${x.modelo ? ` ${x.modelo.trim()}` : ''}`.slice(0, 300),
      numero_serie_inicial: corte(x.serieInicio?.trim(), 40),
      numero_serie_final: corte(x.serieFim?.trim(), 40),
      registro_anvisa: x.registroAnvisa?.trim() || null,
      publicado_em: x.publicadoEm,
      acao_recomendada: x.acao,
    };
  };
  /** O alerta de equipamento do estabelecimento, relido e travado até o fim da transação. */
  const alertaTravado = async (id: number): Promise<AlertaEquipamento | null> => {
    const [r] = await tx.consultarParaAtualizar(
      "SELECT id FROM alerta_sanitario WHERE id = ? AND estabelecimento_id = ? AND area = 'equipamento' AND excluido_em IS NULL",
      [id, est],
    );
    if (!r) return null;
    return (await lerAlertas(tx, est, await fuso(), { id }))[0] ?? null;
  };
  /** O valor contábil do bem na data: a última cota de depreciação societária até a data ou, sem cota, o valor de aquisição. */
  const valorContabilDoBem = async (bem: number | null, data: string): Promise<number | null> => {
    if (bem === null) return null;
    const cota = await tx.uma(
      // Só a base societária (a contábil): a fiscal e a gerencial têm outro sentido e não entram no valor do evento.
      `SELECT valor_residual FROM cota_depreciacao
        WHERE bem_patrimonial_id = ? AND competencia <= ? AND base = 'societaria' AND excluido_em IS NULL
        ORDER BY competencia DESC, id DESC LIMIT 1`,
      [bem, data],
    );
    if (cota) return centavos(cota['valor_residual']);
    const b = await tx.uma(
      'SELECT valor_aquisicao FROM bem_patrimonial WHERE id = ? AND estabelecimento_id = ?',
      [bem, est],
    );
    return b ? centavos(b['valor_aquisicao']) : null;
  };

  const g: GravadorManutencao = {
    relogio: async () => relogio(await fuso()),
    setores: () => lerSetores(tx, est),
    equipamento: async (id) => lerEquipamento(tx, est, await fuso(), { id }),
    equipamentoPorCodigo: async (codigo) => lerEquipamento(tx, est, await fuso(), { codigo }),
    os: async (id) => {
      // A OS relida e travada até o fim da transação.
      await tx.consultarParaAtualizar(
        'SELECT id FROM ordem_servico_manutencao WHERE id = ? AND estabelecimento_id = ?',
        [id, est],
      );
      return lerOs(tx, est, await fuso(), id);
    },
    osAbertasDoEquipamento: (eq) => osAbertasDoEquipamento(tx, est, eq),
    plano: async (id) => {
      await tx.consultarParaAtualizar(
        'SELECT id FROM plano_preventivo WHERE id = ? AND estabelecimento_id = ?',
        [id, est],
      );
      return lerPlano(tx, est, id);
    },
    cobertura: async (id) => (await lerCoberturas(tx, est, { id }))[0] ?? null,
    recurso: async (tipo, id) => (await lerRecurso(tx, est, tipo, id))[0] ?? null,
    fornecedorExiste: async (codigo) =>
      !!(await tx.uma('SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL', [codigo])),
    loginsDoSetor: (centro) => loginsDoSetor(tx, est, centro),
    equipamentosDoRecurso: (r) => equipamentosDoRecurso(tx, est, r.id),

    incluirEquipamento: (x) =>
      comCodigoUnico(async () => {
        const id = await tx.incluir('equipamento_saude', {
          estabelecimento_id: est,
          ...(await valoresEquipamento(x)),
        });
        return { id, versao: 1 };
      }),
    alterarEquipamento: (x) =>
      comCodigoUnico(async () => {
        const atual = await travarLinha(
          'SELECT id, versao, situacao, desativado_em FROM equipamento_saude WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          x.id,
          x.versaoVista,
          'O equipamento',
        );
        const valores = await valoresEquipamento(x);
        if (
          x.situacao === 'desativado' &&
          texto(atual['situacao']) === 'desativado' &&
          atual['desativado_em']
        )
          valores.desativado_em = dataIso(atual['desativado_em']) ?? valores.desativado_em;
        const versao = await tx.alterar('equipamento_saude', x.id, x.versaoVista, valores);
        return { id: x.id, versao };
      }),

    abrirOs: async (x) => {
      const f = await fuso();
      const centro = await centroDe(tx, est, x.centroCusto);
      const eq = x.equipamento === null ? null : await equipamentoDoEstabelecimento(x.equipamento);
      const setor = centro.setor ?? eq?.setor ?? null;
      if (setor === null)
        throw recusa(
          'setor-sem-cadastro',
          'O setor (centro de custo) não tem setor funcional ligado: ligue-o no cadastro antes de abrir a OS.',
          { campos: ['centroCusto'] },
        );
      const solicitante = (await usuarioPorLogin(tx, x.solicitante)) ?? usuario;
      if (solicitante === null) throw recusa('sem-usuario', 'A abertura da OS exige o usuário da sessão.');
      const registro = paraInstante(x.registro, f);
      const numero = numeroDaOs(x.registro, await proximoNumero('ordem_servico_manutencao'));
      const id = await tx.incluir('ordem_servico_manutencao', {
        estabelecimento_id: est,
        numero,
        natureza: snake(x.natureza),
        equipamento_saude_id: eq?.id ?? null,
        solicitante_setor_funcional_id: setor,
        local_descricao: corte(x.local?.trim(), 150),
        solicitante_usuario_id: solicitante,
        contato: corte(x.contato?.trim(), 30),
        descricao: x.descricao.slice(0, 65_000),
        prioridade_sugerida: x.prioridadeSugerida,
        prioridade: x.prioridade,
        equipamento_parado: x.parado && eq !== null,
        executor: 'interno',
        plano_preventivo_id: x.plano,
        solicitado_em: registro,
        situacao: 'aberta',
        centro_custo_id: centro.id,
      });
      await evento(id, { tipo: 'abertura', de: null, para: 'aberta', nota: x.nota, em: registro });
      return { id, numero, versao: 1 };
    },

    mudarOs: async (x) => {
      const f = await fuso();
      const atual = await travarLinha(SQL_TRAVA_OS, x.id, x.versaoVista, 'A ordem de serviço');
      if (texto(atual['situacao']) !== snake(x.de)) throw desatualizado('A ordem de serviço');
      const k: CamposOs = x.campos;
      const v: Record<string, unknown> = { situacao: snake(x.para) };
      if (k.laudo !== undefined) {
        if (
          k.laudo !== null &&
          !(await tx.uma(
            'SELECT id FROM arquivo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [k.laudo, est],
          ))
        )
          throw recusa('laudo-invalido', 'O laudo não é um arquivo deste estabelecimento.', {
            campos: ['laudo'],
          });
        v['laudo_arquivo_id'] = k.laudo;
      }
      if (k.prioridade !== undefined) v['prioridade'] = k.prioridade;
      if (k.tecnico !== undefined)
        v['responsavel_usuario_id'] = k.tecnico === null ? null : await usuarioPorLogin(tx, k.tecnico);
      if (k.executor !== undefined) v['executor'] = k.executor;
      if (k.executor === 'interno') v['contrato_servico_terceirizado_id'] = null;
      else if (k.cobertura !== undefined)
        v['contrato_servico_terceirizado_id'] = await contratoValido('contrato', k.cobertura);
      if (k.assumidaEm !== undefined) v['assumido_em'] = paraInstanteN(k.assumidaEm, f);
      if (k.concluidaEm !== undefined) v['concluido_em'] = paraInstanteN(k.concluidaEm, f);
      if (k.encerradaEm !== undefined) v['encerrado_em'] = paraInstanteN(k.encerradaEm, f);
      if (k.canceladaEm !== undefined) {
        v['cancelado_em'] = paraInstanteN(k.canceladaEm, f);
        v['cancelado_por_usuario_id'] = k.canceladaEm === null ? null : usuario;
      }
      if (k.motivoCancelamento !== undefined)
        v['justificativa_cancelamento'] = corte(k.motivoCancelamento, 500);
      if (k.causa !== undefined) v['causa_falha_equipamento_id'] = await causaId(k.causa);
      if (k.solucao !== undefined) v['solucao'] = k.solucao;
      if (k.custoPecasCent !== undefined) v['custo_pecas'] = reais(k.custoPecasCent);
      if (k.custoMaoDeObraCent !== undefined) v['custo_mao_obra'] = reais(k.custoMaoDeObraCent);
      if (k.custoTerceirosCent !== undefined) v['custo_terceiros'] = reais(k.custoTerceirosCent);
      if (k.paradaFim) v['equipamento_parado'] = false;
      const de = snake(x.de);
      const para = snake(x.para);
      const recusaAceite = de === 'concluida' && para !== 'encerrada' && para !== 'cancelada';
      if (de === 'concluida' && para === 'encerrada') {
        v['aceite_resultado'] = 'aprovado';
        v['aceite_em'] = k.encerradaEm ? paraInstante(k.encerradaEm, f) : new Date();
        v['aceite_usuario_id'] = usuario;
        v['aceite_justificativa'] = null;
      } else if (recusaAceite) {
        const porque = x.nota?.trim() ?? '';
        if (porque.length < 10)
          throw recusa(
            'justificativa-curta',
            'Explique o que não ficou resolvido em pelo menos 10 caracteres.',
            { campos: ['nota'] },
          );
        v['aceite_resultado'] = 'reprovado';
        v['aceite_em'] = new Date();
        v['aceite_usuario_id'] = usuario;
        v['aceite_justificativa'] = corte(porque, 500);
      } else if (para === 'concluida') {
        // Nova conclusão: o aceite volta a ficar pendente (a recusa anterior segue no histórico).
        Object.assign(v, {
          aceite_resultado: null,
          aceite_em: null,
          aceite_usuario_id: null,
          aceite_justificativa: null,
        });
      }
      const versao = await tx.alterar('ordem_servico_manutencao', x.id, x.versaoVista, v);
      if (k.inicioReparo !== undefined || k.fimReparo !== undefined) {
        const [item] = await tx.consultarParaAtualizar(
          "SELECT id, versao FROM ordem_servico_manutencao_item WHERE ordem_servico_manutencao_id = ? AND tipo_item = 'servico' AND excluido_em IS NULL ORDER BY sequencia LIMIT 1",
          [x.id],
        );
        const reparo = {
          ...(k.inicioReparo !== undefined ? { iniciado_em: paraInstanteN(k.inicioReparo, f) } : {}),
          ...(k.fimReparo !== undefined ? { finalizado_em: paraInstanteN(k.fimReparo, f) } : {}),
        };
        if (item) await tx.alterar('ordem_servico_manutencao_item', n(item['id']), n(item['versao']), reparo);
        else {
          const seq = await tx.uma<{ s: number }>(
            'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM ordem_servico_manutencao_item WHERE ordem_servico_manutencao_id = ?',
            [x.id],
          );
          await tx.incluir('ordem_servico_manutencao_item', {
            ordem_servico_manutencao_id: x.id,
            sequencia: n(seq?.s),
            tipo_item: 'servico',
            descricao: 'Reparo',
            executor_usuario_id: usuario,
            ...reparo,
          });
        }
      }
      const tipo =
        para === 'cancelada'
          ? 'cancelamento'
          : para === 'concluida'
            ? 'conclusao'
            : para === 'encerrada'
              ? 'aceite'
              : recusaAceite
                ? 'recusa_aceite'
                : para === 'aberta' && de !== 'aberta'
                  ? 'reabertura'
                  : de === 'aberta'
                    ? 'triagem'
                    : 'andamento';
      const agora = new Date();
      await evento(x.id, { tipo, de, para, nota: x.nota, em: agora });
      if (k.paradaFim)
        await evento(x.id, {
          tipo: 'devolucao_equipamento',
          de: null,
          para: null,
          nota: 'Fim da parada do equipamento',
          em: paraInstante(k.paradaFim, f),
        });
      return { id: x.id, versao };
    },

    corrigirOs: async (x) => {
      const atual = await travarLinha(SQL_TRAVA_OS, x.id, x.versaoVista, 'A ordem de serviço');
      if (
        texto(atual['situacao']) !== 'aberta' ||
        atual['responsavel_usuario_id'] != null ||
        atual['assumido_em'] != null
      )
        throw desatualizado('A ordem de serviço');
      const centro = await centroDe(tx, est, x.centroCusto);
      const eq = x.equipamento === null ? null : await equipamentoDoEstabelecimento(x.equipamento);
      const setor = centro.setor ?? eq?.setor ?? null;
      if (setor === null)
        throw recusa('setor-sem-cadastro', 'O setor (centro de custo) não tem setor funcional ligado.', {
          campos: ['centroCusto'],
        });
      const versao = await tx.alterar('ordem_servico_manutencao', x.id, x.versaoVista, {
        equipamento_saude_id: eq?.id ?? null,
        centro_custo_id: centro.id,
        solicitante_setor_funcional_id: setor,
        local_descricao: corte(x.local?.trim(), 150),
        descricao: x.descricao,
        prioridade_sugerida: x.prioridadeSugerida,
        prioridade: x.prioridadeSugerida,
      });
      await evento(x.id, { tipo: 'triagem', de: 'aberta', para: 'aberta', nota: x.nota, em: new Date() });
      return { id: x.id, versao };
    },

    incluirPlano: async (x) => {
      const eq = await equipamentoDoEstabelecimento(x.equipamento);
      const nome = await tx.uma<{ nome: string }>('SELECT nome FROM equipamento_saude WHERE id = ?', [eq.id]);
      const codigo = `PM-${await proximoNumero('plano_preventivo')}`;
      const id = await tx.incluir('plano_preventivo', {
        estabelecimento_id: est,
        codigo,
        descricao: `${ATIVIDADES_PLANO[x.atividade]} — ${texto(nome?.nome)}`.slice(0, 150),
        atividade: snake(x.atividade),
        oficina_manutencao_id: await oficinaPadrao(),
        periodicidade_quantidade: x.periodicidade.quantidade,
        periodicidade_unidade: x.periodicidade.unidade,
        data_base: x.dataBase,
        antecedencia_dias: x.antecedenciaDias,
        procedimento: x.procedimento,
        executor: x.executor,
        contrato_servico_terceirizado_id: await contratoValido(x.executor, x.cobertura),
        ativo: true,
        modelo_plano_codigo: x.modelo ? x.modelo.codigo.slice(0, 30) : null,
        modelo_plano_versao: x.modelo ? x.modelo.versao : null,
      });
      await tx.incluir('plano_preventivo_equipamento', {
        plano_preventivo_id: id,
        equipamento_saude_id: eq.id,
      });
      return { id, versao: 1 };
    },
    ativarPlano: async (x) => {
      await travarLinha(SQL_TRAVA_PLANO, x.id, x.versaoVista, 'O plano de manutenção');
      const versao = await tx.alterar('plano_preventivo', x.id, x.versaoVista, { ativo: x.ativo });
      return { id: x.id, versao };
    },
    alterarPlano: async (x) => {
      const r = await travarLinha(SQL_TRAVA_PLANO, x.id, x.versaoVista, 'O plano de manutenção');
      if (!verdadeiro(r['ativo'])) throw desatualizado('O plano de manutenção');
      an.motivo = x.motivo.slice(0, 500);
      an.dados = {
        operacao: 'alteracao',
        antes: {
          versao: n(r['versao']),
          periodicidade: {
            quantidade: n(r['periodicidade_quantidade']),
            unidade: texto(r['periodicidade_unidade']),
          },
          dataBase: dataIso(r['data_base']),
          antecedenciaDias: nn(r['antecedencia_dias']),
          procedimento: textoN(r['procedimento']),
          executor: texto(r['executor']),
          cobertura: nn(r['contrato_servico_terceirizado_id']),
        },
      };
      const versao = await tx.alterar('plano_preventivo', x.id, x.versaoVista, {
        periodicidade_quantidade: x.periodicidade.quantidade,
        periodicidade_unidade: x.periodicidade.unidade,
        data_base: x.dataBase,
        antecedencia_dias: x.antecedenciaDias,
        procedimento: x.procedimento,
        executor: x.executor,
        contrato_servico_terceirizado_id: await contratoValido(x.executor, x.cobertura),
      });
      return { id: x.id, versao };
    },
    registrarExecucao: async (x) => {
      const r = await travarLinha(SQL_TRAVA_PLANO, x.plano, x.versaoVista, 'O plano de manutenção');
      if (!verdadeiro(r['ativo'])) throw desatualizado('O plano de manutenção');
      if (x.resultado !== 'aprovado' && (x.observacao?.trim().length ?? 0) < 10)
        throw recusa(
          'observacao-curta',
          'Descreva a restrição ou a reprovação em pelo menos 10 caracteres.',
          { campos: ['observacao'] },
        );
      const alvos = await tx.consultar(
        'SELECT equipamento_saude_id FROM plano_preventivo_equipamento WHERE plano_preventivo_id = ? AND excluido_em IS NULL AND equipamento_saude_id IS NOT NULL ORDER BY equipamento_saude_id LIMIT 2',
        [x.plano],
      );
      if (alvos.length !== 1)
        throw recusa(
          'plano-varios-alvos',
          'Este plano cobre mais de um equipamento: a execução dele não é registrada por esta tela.',
          { campos: ['plano'] },
        );
      if (
        x.laudo != null &&
        !(await tx.uma(
          'SELECT id FROM arquivo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [x.laudo, est],
        ))
      )
        throw recusa('laudo-invalido', 'O laudo não é um arquivo deste estabelecimento.', {
          campos: ['laudo'],
        });
      if (
        x.osCorretiva != null &&
        !(await tx.uma(
          'SELECT id FROM ordem_servico_manutencao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [x.osCorretiva, est],
        ))
      )
        throw recusa('os-invalida', 'A OS corretiva não é deste estabelecimento.', {
          campos: ['osCorretiva'],
        });
      const versaoPlano = await tx.alterar('plano_preventivo', x.plano, x.versaoVista, {
        ultima_execucao: x.data,
      });
      const id = await tx.incluir('execucao_preventiva', {
        estabelecimento_id: est,
        plano_preventivo_id: x.plano,
        versao_plano: x.versaoVista,
        equipamento_saude_id: n(alvos[0]?.['equipamento_saude_id']),
        data_execucao: x.data,
        executor: texto(r['executor']) || 'interno',
        tecnico_usuario_id: usuario,
        contrato_servico_terceirizado_id: nn(r['contrato_servico_terceirizado_id']),
        resultado: snake(x.resultado),
        laudo_arquivo_id: x.laudo,
        certificado_padrao: corte(x.certificadoPadrao?.trim(), 60),
        observacao: corte(x.observacao?.trim(), 2000),
        ordem_servico_manutencao_id: x.osCorretiva,
      });
      return { id, versaoPlano };
    },

    incluirCobertura: async (x) => {
      if (
        !(await tx.uma('SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL', [
          x.fornecedor,
        ]))
      )
        throw recusa('fornecedor-invalido', 'O fornecedor não está no cadastro.', { campos: ['fornecedor'] });
      // O contrato de suprimentos ligado é do mesmo fornecedor e deste estabelecimento.
      if (
        x.contrato !== null &&
        !(await tx.uma(
          'SELECT id FROM contrato_fornecedor WHERE id = ? AND estabelecimento_id = ? AND empresa_fornecedora_id = ? AND excluido_em IS NULL',
          [x.contrato, est, x.fornecedor],
        ))
      )
        throw recusa(
          'contrato-fornecedor-invalido',
          'O contrato de suprimentos não é deste fornecedor neste estabelecimento.',
          {
            campos: ['contrato'],
          },
        );
      const numero = x.numero.trim().slice(0, 30);
      // Número único por fornecedor. Sem filtro de excluido_em, de propósito: a unicidade do banco conta o excluído.
      if (
        await tx.uma(
          'SELECT id FROM contrato_servico_terceirizado WHERE estabelecimento_id = ? AND empresa_fornecedora_id = ? AND numero = ?',
          [est, x.fornecedor, numero],
        )
      )
        throw recusa('contrato-repetido', 'Este fornecedor já tem contrato de manutenção com este número.', {
          campos: ['numero'],
        });
      let id: number;
      try {
        id = await tx.incluir('contrato_servico_terceirizado', {
          estabelecimento_id: est,
          numero,
          objeto: `Manutenção de equipamentos — ${COBERTURAS_CONTRATO[x.cobertura]}`.slice(0, 300),
          empresa_fornecedora_id: x.fornecedor,
          cobertura: snake(x.cobertura),
          inicio_vigencia: x.inicio,
          fim_vigencia: x.fim,
          valor_parcela: reais(x.valorMensalCent),
          periodicidade_pagamento: x.valorMensalCent === null ? 'sob_demanda' : 'mensal',
          prazo_atendimento_horas: x.slaHoras,
          situacao: 'vigente',
          contrato_fornecedor_id: x.contrato,
        });
      } catch (erro) {
        // Corrida com outra inclusão do mesmo fornecedor e número: a UNIQUE do banco decide.
        if (restricaoUnicaViolada(erro) === 'uq_contrato_servico_terceirizado_fornecedor_numero')
          throw recusa(
            'contrato-repetido',
            'Este fornecedor já tem contrato de manutenção com este número.',
            { campos: ['numero'] },
          );
        throw erro;
      }
      let seq = 0;
      for (const eq of [...new Set(x.equipamentos)]) {
        await equipamentoDoEstabelecimento(eq);
        await tx.incluir('contrato_servico_terceirizado_item', {
          contrato_servico_terceirizado_id: id,
          sequencia: ++seq,
          tipo_item: 'equipamento',
          equipamento_saude_id: eq,
          inicio_cobertura: x.inicio,
          fim_cobertura: x.fim,
        });
      }
      return { id, versao: 1 };
    },
    planosAtivosDoContrato: (cob, eqs) => planosAtivosDoContrato(tx, est, cob, eqs),
    alterarCobertura: async (x) => {
      const r = await travarLinha(SQL_TRAVA_CONTRATO, x.id, x.versaoVista, 'O contrato de manutenção');
      if (texto(r['situacao']) !== 'vigente') throw desatualizado('O contrato de manutenção');
      const antes = await retratoContrato(r);
      an.motivo = x.motivo.slice(0, 500);
      an.dados = { operacao: 'alteracao', antes };
      const versao = await tx.alterar('contrato_servico_terceirizado', x.id, x.versaoVista, {
        inicio_vigencia: x.inicio,
        fim_vigencia: x.fim,
        prazo_atendimento_horas: x.slaHoras,
        valor_parcela: reais(x.valorMensalCent),
        periodicidade_pagamento: x.valorMensalCent === null ? 'sob_demanda' : 'mensal',
      });
      const depois = [...new Set(x.equipamentos)];
      const retirados = antes.equipamentos.filter((q) => !depois.includes(q));
      const incluidos = depois.filter((q) => !antes.equipamentos.includes(q));
      const agora = new Date();
      for (const q of retirados) {
        const [it] = await tx.consultarParaAtualizar(
          "SELECT id, versao FROM contrato_servico_terceirizado_item WHERE contrato_servico_terceirizado_id = ? AND tipo_item = 'equipamento' AND equipamento_saude_id = ? AND excluido_em IS NULL",
          [x.id, q],
        );
        if (it)
          await tx.alterar('contrato_servico_terceirizado_item', n(it['id']), n(it['versao']), {
            excluido_em: agora,
            excluido_por: usuario,
          });
      }
      let seq = n(
        (
          await tx.uma<{ s: number }>(
            'SELECT COALESCE(MAX(sequencia), 0) AS s FROM contrato_servico_terceirizado_item WHERE contrato_servico_terceirizado_id = ?',
            [x.id],
          )
        )?.s,
      );
      for (const q of incluidos) {
        await equipamentoDoEstabelecimento(q);
        await tx.incluir('contrato_servico_terceirizado_item', {
          contrato_servico_terceirizado_id: x.id,
          sequencia: ++seq,
          tipo_item: 'equipamento',
          equipamento_saude_id: q,
          inicio_cobertura: x.inicio,
          fim_cobertura: x.fim,
        });
      }
      return { id: x.id, versao, retirados, incluidos };
    },
    encerrarCobertura: async (x) => {
      const r = await travarLinha(SQL_TRAVA_CONTRATO, x.id, x.versaoVista, 'O contrato de manutenção');
      if (texto(r['situacao']) !== 'vigente') throw desatualizado('O contrato de manutenção');
      an.motivo = x.motivo.slice(0, 500);
      an.dados = {
        operacao: 'encerramento',
        antes: await retratoContrato(r),
        encerramento: { data: x.data },
      };
      const versao = await tx.alterar('contrato_servico_terceirizado', x.id, x.versaoVista, {
        situacao: 'encerrado',
        fim_vigencia: x.data,
      });
      return { id: x.id, versao };
    },
    excluirCobertura: async (x) => {
      await travarLinha(SQL_TRAVA_CONTRATO, x.id, x.versaoVista, 'O contrato de manutenção');
      const contar = async (sql: string) => n((await tx.uma<{ n: number }>(sql, [x.id]))?.n);
      const grupos = [
        {
          rotulo: 'Ordens de serviço',
          quantidade: await contar(
            'SELECT COUNT(*) AS n FROM ordem_servico_manutencao WHERE contrato_servico_terceirizado_id = ? AND excluido_em IS NULL',
          ),
        },
        {
          rotulo: 'Planos de manutenção',
          quantidade: await contar(
            'SELECT COUNT(*) AS n FROM plano_preventivo WHERE contrato_servico_terceirizado_id = ?',
          ),
        },
        {
          rotulo: 'Execuções de plano',
          quantidade: await contar(
            'SELECT COUNT(*) AS n FROM execucao_preventiva WHERE contrato_servico_terceirizado_id = ? AND excluido_em IS NULL',
          ),
        },
      ].filter((g) => g.quantidade > 0);
      if (grupos.length > 0)
        throw recusa(
          'com-dependentes',
          `O contrato de manutenção tem vínculos (${grupos.map((g) => `${g.rotulo}: ${g.quantidade}`).join('; ')}). Encerre o contrato com motivo em vez de excluir.`,
          {
            dependentes: grupos.map((g) => ({ ...g, amostra: [], origem: 'fk' as const })),
            podeInativar: true,
          },
        );
      an.motivo = x.motivo.slice(0, 500);
      an.dados = { operacao: 'exclusao' };
      const agora = new Date();
      const itens = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM contrato_servico_terceirizado_item WHERE contrato_servico_terceirizado_id = ? AND excluido_em IS NULL',
        [x.id],
      );
      for (const it of itens)
        await tx.alterar('contrato_servico_terceirizado_item', n(it['id']), n(it['versao']), {
          excluido_em: agora,
          excluido_por: usuario,
        });
      await tx.alterar('contrato_servico_terceirizado', x.id, x.versaoVista, {
        excluido_em: agora,
        excluido_por: usuario,
      });
      return { id: x.id, versao: x.versaoVista };
    },

    // Tecnovigilância ligada ao parque (alerta_sanitario da área `equipamento`).
    incluirAlerta: async (x) => {
      const r = x.conferir();
      if (r) throw recusaAlerta(r);
      await identificacaoLivre(x.numero, null);
      const numero = `ALE-${await proximoNumero('alerta_sanitario')}`;
      const id = await tx.incluir('alerta_sanitario', {
        estabelecimento_id: est,
        numero,
        ...(await camposAlerta(x)),
        area: 'equipamento',
        recebido_em: new Date(),
        responsavel_usuario_id: usuario,
        situacao: 'recebido',
      });
      return { id, versao: 1 };
    },
    alterarAlerta: async (x) => {
      const antes = await alertaTravado(x.id);
      if (!antes) throw recusaAlerta('desatualizado');
      const r = x.conferir(antes);
      if (r) throw recusaAlerta(r);
      if (antes.versao !== x.versaoVista || antes.situacao !== 'aberto') throw recusaAlerta('desatualizado');
      await identificacaoLivre(x.numero, x.id);
      an.motivo = x.motivo.slice(0, 500);
      an.dados = { operacao: 'alteracao', antes };
      const versao = await tx.alterar('alerta_sanitario', x.id, x.versaoVista, await camposAlerta(x));
      return { id: x.id, versao, antes };
    },
    encerrarAlerta: async (x) => {
      const a = await alertaTravado(x.id);
      if (!a) throw recusaAlerta('desatualizado');
      if (a.situacao === 'encerrado') throw recusaAlerta('alerta-encerrado');
      if (a.versao !== x.versaoVista) throw recusaAlerta('desatualizado');
      an.motivo = x.motivo.slice(0, 500);
      an.dados = { operacao: 'encerramento', antes: a };
      const versao = await tx.alterar('alerta_sanitario', x.id, x.versaoVista, {
        situacao: 'concluido',
        concluido_em: new Date(),
        conclusao: x.motivo.slice(0, 65_000),
      });
      return { id: x.id, versao };
    },
    excluirAlerta: async (x) => {
      const a = await alertaTravado(x.id);
      if (!a || a.versao !== x.versaoVista) throw recusaAlerta('desatualizado');
      const os = (
        await tx.consultar(
          'SELECT ordem_servico_manutencao_id AS id FROM alerta_sanitario_equipamento WHERE alerta_sanitario_id = ? AND excluido_em IS NULL ORDER BY id',
          [x.id],
        )
      ).map((q) => n(q['id']));
      const queixas = os.length
        ? (
            await tx.consultar(
              `SELECT id FROM queixa_tecnica_produto WHERE ordem_servico_manutencao_id IN (${marcas(os.length)}) AND excluido_em IS NULL ORDER BY id`,
              os,
            )
          ).map((q) => n(q['id']))
        : [];
      const grupos = [
        { rotulo: 'OS de ação de campo do alerta', ids: os },
        { rotulo: 'Queixas técnicas da vigilância de produto', ids: queixas },
      ].filter((q) => q.ids.length > 0);
      if (grupos.length > 0) {
        const total = grupos.reduce((t, q) => t + q.ids.length, 0);
        throw recusa(
          'com-dependentes',
          `O alerta tem ${total} ${total === 1 ? 'registro dependente' : 'registros dependentes'}: ${grupos
            .map((q) => `${q.ids.length} ${q.ids.length === 1 ? 'registro' : 'registros'} em ${q.rotulo}`)
            .join('; ')}. Encerre o alerta com motivo em vez de excluir.`,
          {
            dependentes: grupos.map((q) => ({
              rotulo: q.rotulo,
              quantidade: q.ids.length,
              amostra: q.ids.slice(0, 5).map(String),
              origem: 'fk' as const,
            })),
            podeInativar: true,
          },
        );
      }
      an.motivo = x.motivo.slice(0, 500);
      an.dados = { operacao: 'exclusao', antes: a };
      await tx.alterar('alerta_sanitario', x.id, x.versaoVista, {
        excluido_em: new Date(),
        excluido_por: usuario,
      });
      return { id: x.id, versao: x.versaoVista };
    },
    gerarAcaoDeCampo: async (x) => {
      const alerta = await alertaTravado(x.id);
      if (!alerta) throw recusaAlerta('desatualizado');
      const f = await fuso();
      const p = x.planejar(
        alerta,
        await lerParqueDoAlerta(tx, est, x.id),
        await lerAcoesDoAlerta(tx, est, f, x.id),
      );
      if (!p.ok) throw recusaAlerta(p.motivo);
      if (alerta.versao !== x.versaoVista) throw recusaAlerta('desatualizado');
      const geradas: { equipamento: number; os: number; numero: string }[] = [];
      for (const q of p.equipamentos) {
        const os = await g.abrirOs({
          natureza: 'inspecao',
          equipamento: q.equipamento,
          centroCusto: q.centroCusto,
          local: null,
          descricao: q.descricao,
          contato: null,
          prioridadeSugerida: x.prioridade,
          prioridade: x.prioridade,
          solicitante: x.usuario,
          registro: x.registro,
          parado: false,
          plano: null,
          nota: `Ação de campo do alerta ${alerta.numero}.`,
        });
        await tx.incluir('alerta_sanitario_equipamento', {
          alerta_sanitario_id: x.id,
          equipamento_saude_id: q.equipamento,
          ordem_servico_manutencao_id: os.id,
        });
        geradas.push({ equipamento: q.equipamento, os: os.id, numero: os.numero });
      }
      const versao = await tx.alterar('alerta_sanitario', x.id, x.versaoVista, {
        situacao: 'em_verificacao',
      });
      return { versao, geradas };
    },
    abrirQueixaDaOs: async (x) => {
      const [o] = await tx.consultarParaAtualizar(
        `SELECT o.id, o.equipamento_saude_id, e.fabricante_id, e.setor_funcional_id
           FROM ordem_servico_manutencao o LEFT JOIN equipamento_saude e ON e.id = o.equipamento_saude_id
          WHERE o.id = ? AND o.estabelecimento_id = ? AND o.excluido_em IS NULL`,
        [x.os, est],
      );
      if (!o) throw desatualizado('A ordem de serviço');
      if (o['equipamento_saude_id'] === null || o['equipamento_saude_id'] === undefined)
        throw recusaAlerta('os-sem-equipamento');
      // A queixa é única por OS (a UNIQUE do banco conta a excluída também).
      if (await tx.uma('SELECT id FROM queixa_tecnica_produto WHERE ordem_servico_manutencao_id = ?', [x.os]))
        throw recusaAlerta('queixa-ja-aberta');
      // A natureza separa a queixa técnica do evento adverso e do alerta sanitário. O evento adverso (dano ou risco ao
      // paciente) nasce da notificação de incidente da gestão de riscos, com tipo, dano percebido e prazo próprios, que
      // a OS não traz nem liga: aberto pela OS, viraria uma queixa comum sem notificação nem prazo. Por isso recusa e
      // orienta notificar o incidente (a queixa ligada à notificação guarda notificacao_incidente_id). O alerta é o da
      // ação de campo que gerou a OS; sem ele, a abertura como alerta sanitário recusa.
      const natureza = NATUREZA_QUEIXA[x.tipo];
      if (natureza === 'evento_adverso')
        throw recusa(
          'evento-adverso-pela-notificacao',
          'O evento adverso com equipamento é aberto pela notificação de incidente (gestão de riscos), que registra o dano e o prazo: notifique o incidente; pela OS, abra como queixa técnica.',
        );
      const acao = await tx.uma(
        `SELECT ae.alerta_sanitario_id FROM alerta_sanitario_equipamento ae
           JOIN alerta_sanitario a ON a.id = ae.alerta_sanitario_id AND a.estabelecimento_id = ?
          WHERE ae.ordem_servico_manutencao_id = ? ORDER BY ae.id LIMIT 1`,
        [est, x.os],
      );
      const alertaId = acao ? n(acao['alerta_sanitario_id']) : null;
      if (natureza === 'alerta_sanitario' && alertaId === null)
        throw recusa('os-sem-alerta', 'Esta OS não foi gerada pela ação de campo de um alerta sanitário: abra como queixa técnica ou evento adverso.');
      const f = await fuso();
      const em = paraInstante(x.agora, f);
      const segregado = x.conduta !== 'nenhuma';
      const situacao = segregado ? 'lote_segregado' : 'aberta';
      const id = await tx.incluir('queixa_tecnica_produto', {
        estabelecimento_id: est,
        numero: `QT-${await proximoNumero('queixa_tecnica_produto')}`,
        insumo_id: null,
        equipamento_saude_id: n(o['equipamento_saude_id']),
        ordem_servico_manutencao_id: x.os,
        fabricante_id: nn(o['fabricante_id']),
        setor_funcional_id: nn(o['setor_funcional_id']),
        tipo_desvio: 'falha_funcionamento',
        natureza,
        alerta_sanitario_id: alertaId,
        descricao: x.descricao.slice(0, 65_000),
        identificada_em: em,
        lote_segregado: segregado,
        segregado_em: segregado ? em : null,
        notificante_usuario_id: usuario,
        situacao,
      });
      await tx.incluir('queixa_tecnica_produto_evento', {
        queixa_tecnica_produto_id: id,
        operacao: 'inclusao',
        dados: JSON.stringify({ tipo: x.tipo, conduta: x.conduta, os: x.os }),
        ocorrido_em: em,
        usuario_id: usuario,
        situacao,
        observacao: `Aberta pela OS ${x.os}.`,
      });
      return { id, versao: 1, os: x.os };
    },

    // Treinamento por modelo e ciclo de vida.
    cursoDoModelo: async (id) => (await lerCursosModelo(tx, est, await fuso(), { id }))[0] ?? null,
    vincularCursoModelo: async (x) => {
      const curso = await tx.uma('SELECT id, ativo FROM curso WHERE id = ? AND excluido_em IS NULL', [
        x.curso,
      ]);
      if (!curso || !verdadeiro(curso['ativo'])) throw recusaCicloVida('curso-inativo');
      const fabricante = await fabricanteId(x.fabricante);
      if (fabricante === null)
        throw recusa('fabricante-obrigatorio', 'Informe o fabricante.', { campos: ['fabricante'] });
      const modelo = x.modelo.trim().toUpperCase().slice(0, 60);
      const [ja] = await tx.consultarParaAtualizar(
        'SELECT id, versao, excluido_em FROM modelo_equipamento_curso WHERE estabelecimento_id = ? AND fabricante_id = ? AND modelo = ? AND curso_id = ?',
        [est, fabricante, modelo, x.curso],
      );
      if (ja && (ja['excluido_em'] === null || ja['excluido_em'] === undefined))
        throw recusaCicloVida('vinculo-repetido');
      if (ja) {
        // Vincular de novo reativa a mesma linha (a UNIQUE conta a excluída); a trilha guarda as duas pontas.
        await tx.alterar('modelo_equipamento_curso', n(ja['id']), n(ja['versao']), {
          excluido_em: null,
          excluido_por: null,
        });
        return { id: n(ja['id']) };
      }
      const id = await tx.incluir('modelo_equipamento_curso', {
        estabelecimento_id: est,
        fabricante_id: fabricante,
        modelo,
        curso_id: x.curso,
      });
      return { id };
    },
    desvincularCursoModelo: async (x) => {
      const [r] = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM modelo_equipamento_curso WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.id, est],
      );
      if (!r) throw recusaCicloVida('desatualizado');
      an.motivo = x.motivo.slice(0, 500);
      an.dados = { operacao: 'exclusao' };
      await tx.alterar('modelo_equipamento_curso', x.id, n(r['versao']), {
        excluido_em: new Date(),
        excluido_por: usuario,
      });
      return { id: x.id };
    },
    eventosCiclo: async (eq) => lerEventosCiclo(tx, est, await fuso(), eq),
    registrarEventoCiclo: async (x) => {
      const [eq] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao, bem_patrimonial_id FROM equipamento_saude WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.equipamento, est],
      );
      if (!eq) throw recusaCicloVida('desatualizado');
      if (x.tipo === 'descarte' && (!x.documento || !x.destino)) throw recusaCicloVida('descarte-incompleto');
      const f = await fuso();
      const r = x.conferir(await lerEventosCiclo(tx, est, f, x.equipamento), relogio(f).hoje);
      if (r) throw recusaCicloVida(r);
      const valorContabil = await valorContabilDoBem(nn(eq['bem_patrimonial_id']), x.data);
      let id: number;
      try {
        id = await tx.incluir('evento_ciclo_equipamento', {
          equipamento_saude_id: x.equipamento,
          tipo: x.tipo,
          data_evento: x.data,
          motivo: x.motivo.slice(0, 500),
          documento: corte(x.documento?.trim(), 60),
          destino: x.tipo === 'descarte' ? x.destino : null,
          valor_contabil: reais(valorContabil),
          valor_obtido: reais(x.valorObtidoCent),
          autorizado_por: x.autorizadoPor.trim().slice(0, 150),
        });
      } catch (erro) {
        if (restricaoUnicaViolada(erro) === 'uq_evento_ciclo_equipamento_tipo')
          throw recusaCicloVida('evento-repetido');
        throw erro;
      }
      if (x.tipo === 'desativacao' && texto(eq['situacao']) !== 'desativado')
        await tx.alterar('equipamento_saude', x.equipamento, n(eq['versao']), {
          situacao: 'desativado',
          desativado_em: x.data,
          motivo_desativacao: x.motivo.slice(0, 500),
        });
      return { id, valorContabilCent: valorContabil };
    },

    avisar: async (a) => {
      const destinatario = await usuarioPorLogin(tx, a.login);
      if (destinatario === null) return null;
      const chave = `${a.evento}:${a.objetoChave}`.slice(0, 100);
      const ja = await tx.uma(
        'SELECT id FROM notificacao_usuario WHERE estabelecimento_id = ? AND usuario_id = ? AND chave_agrupamento = ? AND excluido_em IS NULL LIMIT 1',
        [est, destinatario, chave],
      );
      if (ja) return null;
      const entidadeId = /^\d+$/.test(a.objetoChave) ? Number(a.objetoChave) : null;
      return tx.incluir('notificacao_usuario', {
        estabelecimento_id: est,
        usuario_id: destinatario,
        titulo: a.titulo.slice(0, 200),
        texto: a.titulo,
        link: corte(a.link, 500),
        gravidade: GRAVIDADE_AVISO[a.gravidade],
        entidade: corte(a.objetoTabela, 64),
        entidade_id: entidadeId,
        chave_agrupamento: chave,
        gerada_em: new Date(),
      });
    },
  };
  return g;
}

// ── A porta ─────────────────────────────────────────────────────────────────────────────────────────────────────

export class PortaManutencaoPropria implements PortaManutencao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoManutencao,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(
    c: ContextoPortaM18,
    fn: (l: Leitor, est: number, fuso: () => Promise<string>) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => {
      let f: Promise<string> | null = null;
      return fn(l, est, () => (f ??= fusoDe(l, est)));
    });
  }

  async podeGravar() {
    return { pode: false, codigo: 'sem-operacao', motivo: SEM_EXECUTOR };
  }

  async executar(): Promise<never> {
    throw recusa('operacao-desconhecida', SEM_EXECUTOR);
  }

  gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorManutencao) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'manutencao.gravacao-direta',
      tabelas: TABELAS_MANUTENCAO,
      trilha,
      gravador: (tx, est, an) => gravador(tx, est, an, c),
      fn,
    });
  }

  relogio(c: ContextoPortaM18) {
    return this.ler(c, async (_l, _est, fuso) => relogio(await fuso()));
  }
  setores(c: ContextoPortaM18) {
    return this.ler(c, (l, est) => lerSetores(l, est));
  }
  unidades(c: ContextoPortaM18): Promise<UnidadeManutencao[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT id, nome FROM unidade_assistencial WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome LIMIT ${TETO}`,
          [est],
        )
      ).map((x) => ({ codigo: n(x['id']), nome: texto(x['nome']) })),
    );
  }
  recursos(c: ContextoPortaM18, tipo: TipoRecursoAgenda) {
    return this.ler(c, (l, est) => lerRecurso(l, est, tipo, null));
  }
  recurso(c: ContextoPortaM18, tipo: TipoRecursoAgenda, id: number) {
    return this.ler(c, async (l, est) => (await lerRecurso(l, est, tipo, id))[0] ?? null);
  }
  nomesDosUsuarios(c: ContextoPortaM18, logins: readonly string[]): Promise<UsuarioDaOs[]> {
    const ls = [...new Set(logins.map((x) => x.trim()).filter(Boolean))].slice(0, TETO);
    if (ls.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l) =>
      (await l.consultar(`SELECT login, nome FROM usuario WHERE login IN (${marcas(ls.length)})`, ls)).map(
        (x) => ({
          login: texto(x['login']),
          nome: texto(x['nome']),
        }),
      ),
    );
  }
  /** Fornecedores pelo nome ou código, sem documento nem dado bancário (cadastro do cliente: rede inteira). */
  fornecedores(c: ContextoPortaM18, termo: string) {
    const t = termo.trim();
    const like = `%${t.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT id, razao_social, nome_fantasia FROM empresa_fornecedora
            WHERE excluido_em IS NULL AND situacao = 'ativo' AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR id = ?)
            ORDER BY razao_social LIMIT 50`,
          [like, like, /^\d+$/.test(t) ? Number(t) : -1],
        )
      ).map((x) => ({ codigo: n(x['id']), nome: texto(x['nome_fantasia']) || texto(x['razao_social']) })),
    );
  }
  nomesDosFornecedores(c: ContextoPortaM18, codigos: readonly number[]) {
    const cs = [...new Set(codigos)].slice(0, TETO);
    if (cs.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT id, razao_social, nome_fantasia FROM empresa_fornecedora WHERE id IN (${marcas(cs.length)})`,
          cs,
        )
      ).map((x) => ({ codigo: n(x['id']), nome: texto(x['nome_fantasia']) || texto(x['razao_social']) })),
    );
  }
  equipamentos(c: ContextoPortaM18, f: FiltroEquipamentos) {
    return this.ler(c, async (l, est, fuso) => lerEquipamentos(l, est, await fuso(), f));
  }
  equipamento(c: ContextoPortaM18, id: number) {
    return this.ler(c, async (l, est, fuso) => lerEquipamento(l, est, await fuso(), { id }));
  }
  equipamentoPorCodigo(c: ContextoPortaM18, codigo: string) {
    return this.ler(c, async (l, est, fuso) => lerEquipamento(l, est, await fuso(), { codigo }));
  }
  ordens(c: ContextoPortaM18, f: FiltroOrdens) {
    return this.ler(c, async (l, est, fuso) => {
      const limite = Math.min(Math.max(f.limite ?? 50, 1), TETO_LISTA);
      const onde: string[] = [];
      const p: unknown[] = [est];
      if (f.centroCusto != null) {
        onde.push('o.centro_custo_id = ?');
        p.push(f.centroCusto);
      }
      if (f.equipamento != null) {
        onde.push('o.equipamento_saude_id = ?');
        p.push(f.equipamento);
      }
      if (f.situacoes && f.situacoes.length > 0) {
        onde.push(`o.situacao IN (${marcas(f.situacoes.length)})`);
        p.push(...f.situacoes.map(snake));
      }
      if (f.natureza) {
        onde.push('o.natureza = ?');
        p.push(snake(f.natureza));
      }
      if (f.prioridade) {
        onde.push('o.prioridade = ?');
        p.push(f.prioridade);
      }
      if (f.solicitante) {
        onde.push('us.login = ?');
        p.push(f.solicitante.trim());
      }
      if (f.restricao) {
        const r = f.restricao;
        if (r.centros.length > 0) {
          onde.push(`(us.login = ? OR o.centro_custo_id IN (${marcas(r.centros.length)}))`);
          p.push(r.login.trim(), ...r.centros);
        } else {
          onde.push('us.login = ?');
          p.push(r.login.trim());
        }
      }
      if (f.antesDe != null) {
        onde.push('o.id < ?');
        p.push(f.antesDe);
      }
      const ls = await l.consultar(
        `${SQL_OS}${onde.map((o) => ` AND ${o}`).join('')} ORDER BY o.id DESC LIMIT ${limite + 1}`,
        p,
      );
      const fz = await fuso();
      const itens = ls.slice(0, limite).map((x) => osDe(x, fz));
      return { itens, proxima: ls.length > limite ? (itens.at(-1)?.id ?? null) : null };
    });
  }
  os(c: ContextoPortaM18, id: number) {
    return this.ler(c, async (l, est, fuso) => lerOs(l, est, await fuso(), id));
  }
  eventos(c: ContextoPortaM18, os: number): Promise<EventoOrdem[]> {
    return this.ler(c, async (l, est, fuso) => {
      const fz = await fuso();
      const ls = await l.consultar(
        `SELECT v.id, v.ocorrido_em, u.login, v.situacao_anterior, v.situacao_nova, v.nota
           FROM ordem_servico_manutencao_evento v
           JOIN ordem_servico_manutencao o ON o.id = v.ordem_servico_manutencao_id
           LEFT JOIN usuario u ON u.id = v.usuario_id
          WHERE v.ordem_servico_manutencao_id = ? AND o.estabelecimento_id = ? AND v.situacao_nova IS NOT NULL
          ORDER BY v.id LIMIT ${TETO}`,
        [os, est],
      );
      return ls.map((x) => ({
        id: n(x['id']),
        em: instante(x['ocorrido_em'], fz) ?? '',
        ator: texto(x['login']),
        de: x['situacao_anterior'] ? (camel(texto(x['situacao_anterior'])) as SituacaoOs) : null,
        para: camel(texto(x['situacao_nova'])) as SituacaoOs,
        nota: textoN(x['nota']),
      }));
    });
  }
  planos(c: ContextoPortaM18, f: { equipamento?: number | null; soAtivos?: boolean } = {}) {
    return this.ler(c, async (l, est) => {
      let sql = SQL_PLANO;
      const p: unknown[] = [est];
      if (f.equipamento != null) {
        sql += ` AND EXISTS (SELECT 1 FROM plano_preventivo_equipamento pf WHERE pf.plano_preventivo_id = p.id
                    AND pf.excluido_em IS NULL AND pf.equipamento_saude_id = ?)`;
        p.push(f.equipamento);
      }
      if (f.soAtivos) sql += ' AND p.ativo';
      return (await l.consultar(`${sql} ORDER BY p.id LIMIT ${TETO}`, p)).map(planoDe);
    });
  }
  planoPorId(c: ContextoPortaM18, id: number) {
    return this.ler(c, (l, est) => lerPlano(l, est, id));
  }
  execucoes(c: ContextoPortaM18, plano: number): Promise<ExecucaoDoPlano[]> {
    return this.ler(c, async (l, est, fuso) => {
      const fz = await fuso();
      const ls = await l.consultar(
        `SELECT x.id, x.plano_preventivo_id, x.data_execucao, x.resultado, x.laudo_arquivo_id, x.certificado_padrao,
                x.observacao, x.ordem_servico_manutencao_id, u.login, x.criado_em
           FROM execucao_preventiva x LEFT JOIN usuario u ON u.id = x.criado_por
          WHERE x.plano_preventivo_id = ? AND x.estabelecimento_id = ? AND x.excluido_em IS NULL
          ORDER BY x.data_execucao DESC, x.id DESC LIMIT ${TETO}`,
        [plano, est],
      );
      return ls.map((x) => ({
        id: n(x['id']),
        plano: n(x['plano_preventivo_id']),
        data: dataIso(x['data_execucao']) ?? '',
        resultado: camel(texto(x['resultado'])) as ExecucaoDoPlano['resultado'],
        laudo: nn(x['laudo_arquivo_id']),
        certificadoPadrao: textoN(x['certificado_padrao']),
        observacao: textoN(x['observacao']),
        osCorretiva: nn(x['ordem_servico_manutencao_id']),
        por: texto(x['login']),
        em: instante(x['criado_em'], fz) ?? '',
      }));
    });
  }
  /** As versões anteriores do plano: o retrato de antes de cada alteração, na trilha de auditoria. */
  versoesPlano(c: ContextoPortaM18, plano: number): Promise<VersaoDoPlano[]> {
    return this.ler(c, async (l, est, fuso) => {
      const fz = await fuso();
      const ls = await l.consultar(
        `SELECT t.dados_depois, t.motivo, u.login, t.ocorrido_em FROM trilha_auditoria t
           JOIN plano_preventivo p ON p.id = t.entidade_id AND p.estabelecimento_id = ?
           LEFT JOIN usuario u ON u.id = t.usuario_id
          WHERE t.entidade = 'plano_preventivo' AND t.entidade_id = ?
            AND JSON_VALUE(t.dados_depois, '$.dados.operacao') = 'alteracao'
          ORDER BY t.id DESC LIMIT ${TETO}`,
        [est, plano],
      );
      return ls.map((x) => {
        const a = json(json(json(x['dados_depois'])['dados'])['antes']);
        const per = json(a['periodicidade']);
        return {
          versao: n(a['versao']),
          periodicidade: {
            quantidade: n(per['quantidade']),
            unidade: texto(per['unidade']) as VersaoDoPlano['periodicidade']['unidade'],
          },
          dataBase: texto(a['dataBase']),
          antecedenciaDias: nn(a['antecedenciaDias']),
          procedimento: textoN(a['procedimento']),
          executor: texto(a['executor']) as VersaoDoPlano['executor'],
          cobertura: nn(a['cobertura']),
          motivo: texto(x['motivo']),
          por: texto(x['login']),
          em: instante(x['ocorrido_em'], fz) ?? '',
        };
      });
    });
  }
  coberturas(c: ContextoPortaM18, f: { equipamento?: number | null; ids?: readonly number[] | null } = {}) {
    return this.ler(c, (l, est) => lerCoberturas(l, est, f));
  }
  /** As versões anteriores do contrato (alteração e encerramento), na trilha de auditoria. */
  versoesCobertura(c: ContextoPortaM18, cobertura: number): Promise<VersaoDaCobertura[]> {
    return this.ler(c, async (l, est, fuso) => {
      const fz = await fuso();
      const ls = await l.consultar(
        `SELECT t.dados_depois, t.motivo, u.login, t.ocorrido_em FROM trilha_auditoria t
           JOIN contrato_servico_terceirizado k ON k.id = t.entidade_id AND k.estabelecimento_id = ?
           LEFT JOIN usuario u ON u.id = t.usuario_id
          WHERE t.entidade = 'contrato_servico_terceirizado' AND t.entidade_id = ?
            AND JSON_VALUE(t.dados_depois, '$.dados.operacao') IN ('alteracao', 'encerramento')
          ORDER BY t.id DESC LIMIT ${TETO}`,
        [est, cobertura],
      );
      return ls.map((x) => {
        const d = json(json(x['dados_depois'])['dados']);
        const a = json(d['antes']);
        return {
          versao: n(a['versao']),
          operacao:
            texto(d['operacao']) === 'encerramento' ? ('encerramento' as const) : ('alteracao' as const),
          inicio: texto(a['inicio']),
          fim: texto(a['fim']),
          slaHoras: nn(a['slaHoras']),
          valorMensalCent: nn(a['valorMensalCent']),
          equipamentos: Array.isArray(a['equipamentos']) ? (a['equipamentos'] as unknown[]).map(n) : [],
          motivo: texto(x['motivo']),
          por: texto(x['login']),
          em: instante(x['ocorrido_em'], fz) ?? '',
        };
      });
    });
  }
  ocorrencias(c: ContextoPortaM18, f: FiltroPeriodoPorta): Promise<OcorrenciasDoPeriodo> {
    return this.ler(c, async (l, est, fuso) => {
      const fz = await fuso();
      const onde = ['estabelecimento_id = ?', 'excluido_em IS NULL'];
      const p: unknown[] = [est];
      if (f.equipamento != null) {
        onde.push('id = ?');
        p.push(f.equipamento);
      }
      if (f.centroCusto != null) {
        onde.push('centro_custo_id = ?');
        p.push(f.centroCusto);
      }
      if (f.criticidade) {
        onde.push('criticidade = ?');
        p.push(f.criticidade);
      }
      const eqs = await l.consultar(
        `SELECT id, codigo, nome, instalado_em, situacao, alterado_em FROM equipamento_saude WHERE ${onde.join(' AND ')}
          ORDER BY id LIMIT ${TETO * 10}`,
        p,
      );
      const equipamentos = eqs.map((x) => ({
        id: n(x['id']),
        codigo: texto(x['codigo']),
        nome: texto(x['nome']),
        instalacao: dataIso(x['instalado_em']),
        desativacao:
          texto(x['situacao']) === 'desativado'
            ? (instante(x['alterado_em'], fz)?.slice(0, 10) ?? null)
            : null,
      }));
      if (equipamentos.length === 0) return { equipamentos, paradas: [], corretivas: [] };
      const ids = new Set(equipamentos.map((e) => e.id));
      const de = instanteCivil(f.inicio, '0000', fz);
      const ate = new Date(instanteCivil(f.fim, '0000', fz).getTime() + 86_400_000);
      const paradas = await l.consultar(
        `SELECT q.equipamento_saude_id, q.solicitado_em, q.parada_fim FROM (
           SELECT o.equipamento_saude_id, o.solicitado_em, o.equipamento_parado,
                  (SELECT MAX(v.ocorrido_em) FROM ordem_servico_manutencao_evento v
                    WHERE v.ordem_servico_manutencao_id = o.id AND v.tipo_evento = 'devolucao_equipamento') AS parada_fim
             FROM ordem_servico_manutencao o
            WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL AND o.situacao <> 'cancelada'
              AND o.equipamento_saude_id IS NOT NULL AND o.solicitado_em < ?) q
          WHERE (q.equipamento_parado OR q.parada_fim IS NOT NULL) AND (q.parada_fim IS NULL OR q.parada_fim >= ?)
          LIMIT ${TETO * 10}`,
        [est, ate, de],
      );
      const corretivas = await l.consultar(
        `SELECT o.equipamento_saude_id, o.solicitado_em, cf.codigo AS causa,
                (SELECT MIN(i.iniciado_em) FROM ordem_servico_manutencao_item i
                  WHERE i.ordem_servico_manutencao_id = o.id AND i.tipo_item = 'servico' AND i.excluido_em IS NULL) AS inicio_reparo,
                (SELECT MAX(i.finalizado_em) FROM ordem_servico_manutencao_item i
                  WHERE i.ordem_servico_manutencao_id = o.id AND i.tipo_item = 'servico' AND i.excluido_em IS NULL) AS fim_reparo
           FROM ordem_servico_manutencao o LEFT JOIN causa_falha_equipamento cf ON cf.id = o.causa_falha_equipamento_id
          WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL AND o.natureza = 'corretiva'
            AND o.situacao <> 'cancelada' AND o.equipamento_saude_id IS NOT NULL
            AND o.solicitado_em >= ? AND o.solicitado_em < ?
          LIMIT ${TETO * 10}`,
        [est, de, ate],
      );
      return {
        equipamentos,
        paradas: paradas
          .map((x) => ({
            equipamento: n(x['equipamento_saude_id']),
            inicio: instante(x['solicitado_em'], fz) ?? '',
            fim: instante(x['parada_fim'], fz),
          }))
          .filter((x) => ids.has(x.equipamento)),
        corretivas: corretivas
          .map((x) => ({
            equipamento: n(x['equipamento_saude_id']),
            registro: instante(x['solicitado_em'], fz) ?? '',
            causa: x['causa'] ? (camel(texto(x['causa'])) as CausaFalha) : null,
            inicioReparo: instante(x['inicio_reparo'], fz),
            fimReparo: instante(x['fim_reparo'], fz),
          }))
          .filter((x) => ids.has(x.equipamento)),
      };
    });
  }

  // Tecnovigilância ligada ao parque.
  alertas(
    c: ContextoPortaM18,
    f?: { situacao?: SituacaoAlertaEquipamento | null },
  ): Promise<AlertaEquipamento[]> {
    return this.ler(c, async (l, est, fuso) =>
      lerAlertas(l, est, await fuso(), { situacao: f?.situacao ?? null }),
    );
  }
  alerta(c: ContextoPortaM18, id: number): Promise<AlertaEquipamento | null> {
    return this.ler(c, async (l, est, fuso) => (await lerAlertas(l, est, await fuso(), { id }))[0] ?? null);
  }
  acoesDoAlerta(c: ContextoPortaM18, alerta: number): Promise<AcaoDeCampo[]> {
    return this.ler(c, async (l, est, fuso) => lerAcoesDoAlerta(l, est, await fuso(), alerta));
  }
  parqueDoAlerta(c: ContextoPortaM18, alerta: number): Promise<EquipamentoDoParque[]> {
    return this.ler(c, (l, est) => lerParqueDoAlerta(l, est, alerta));
  }
  vinculosTecnovigDaOs(c: ContextoPortaM18, os: number) {
    return this.ler(c, (l, est) => lerVinculosTecnovigDaOs(l, est, os));
  }

  // Treinamento dos operadores: o catálogo e as conclusões vêm do treinamento (curso, turma, presença); o curso exigido
  // por modelo é o modelo_equipamento_curso do estabelecimento.
  cursosDosModelos(
    c: ContextoPortaM18,
    chave?: { fabricante: string; modelo: string },
  ): Promise<CursoDoModelo[]> {
    return this.ler(c, async (l, est, fuso) => lerCursosModelo(l, est, await fuso(), chave ? { chave } : {}));
  }
  catalogoCursos(c: ContextoPortaM18): Promise<CursoDoCatalogo[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT id, codigo, nome, validade_meses, ativo FROM curso WHERE excluido_em IS NULL ORDER BY nome LIMIT ${TETO}`,
        )
      ).map((x) => ({
        id: n(x['id']),
        codigo: texto(x['codigo']),
        titulo: texto(x['nome']),
        // 0: o curso não vence.
        validadeMeses: n(x['validade_meses']),
        ativo: verdadeiro(x['ativo']),
      })),
    );
  }
  conclusoesDosCursos(c: ContextoPortaM18, cursos: readonly number[]): Promise<ConclusaoDeCurso[]> {
    const cs = [...new Set(cursos)].slice(0, TETO);
    if (cs.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT p.colaborador_id, col.nome, u.matricula, t.curso_id, t.data_fim,
                  COALESCE(p.certificado_valido_ate,
                           IF(cu.validade_meses IS NULL, NULL, DATE_ADD(t.data_fim, INTERVAL cu.validade_meses MONTH))) AS valido_ate
             FROM presenca_treinamento p
             JOIN turma_treinamento t ON t.id = p.turma_treinamento_id
             JOIN curso cu ON cu.id = t.curso_id
             JOIN colaborador col ON col.id = p.colaborador_id
             LEFT JOIN usuario u ON u.id = col.usuario_id
            WHERE t.curso_id IN (${marcas(cs.length)}) AND t.estabelecimento_id = ? AND t.situacao = 'concluida'
              AND p.situacao = 'presente' AND p.aproveitamento IN ('aprovado', 'nao_avaliado')
              AND p.excluido_em IS NULL AND t.excluido_em IS NULL
            ORDER BY t.data_fim DESC LIMIT ${TETO * 4}`,
          [...cs, est],
        )
      ).map((x) => ({
        vinculo: n(x['colaborador_id']),
        nome: texto(x['nome']),
        matricula: textoN(x['matricula']),
        curso: n(x['curso_id']),
        conclusao: dataIso(x['data_fim']) ?? '',
        validoAte: dataIso(x['valido_ate']),
      })),
    );
  }
  /** Os eventos do ciclo de vida do equipamento do estabelecimento (incorporação, desativação e descarte). */
  eventosCiclo(c: ContextoPortaM18, equipamento: number): Promise<EventoCicloVida[]> {
    return this.ler(c, async (l, est, fuso) => lerEventosCiclo(l, est, await fuso(), equipamento));
  }
  /** A base do índice de obsolescência: o custo e as corretivas das OS do equipamento desde a data. */
  baseObsolescencia(c: ContextoPortaM18, equipamento: number, desde: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT COALESCE(SUM(custo_pecas + custo_mao_obra + custo_terceiros), 0) AS custo,
                COALESCE(SUM(natureza = 'corretiva'), 0) AS corretivas
           FROM ordem_servico_manutencao
          WHERE estabelecimento_id = ? AND equipamento_saude_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'
            AND solicitado_em >= ?`,
        [est, equipamento, desde],
      );
      return { custoCent: centavos(r?.['custo']), corretivas: n(r?.['corretivas']) };
    });
  }
}
