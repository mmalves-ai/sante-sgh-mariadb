// Porta PRÓPRIA da gestão da qualidade (M48, etapa 5, e a revisão de prontuários do W0-04) sobre o MariaDB do cliente,
// pelo @sgh/nucleo. Toda leitura fica no estabelecimento da sessão; toda gravação roda numa operação do Executor
// (gravacaoDireta: trilha, idempotência e as tabelas declaradas na mesma transação).
// Construído sobre o modelo próprio (F2.4, 3ª etapa):
// - a matriz de riscos (risco_institucional): leitura paginada, o risco e o registro com a pontuação e a prioridade;
// - as não conformidades (nao_conformidade_qualidade, o evento da situação e o plano de ação em plano_acao_qualidade):
//   leitura paginada, por origem e o registro;
// - a ouvidoria (manifestacao_ouvidoria e o evento de cada passo): leitura, registro, encaminhamento à área, resposta
//   com a procedência, correção e cancelamento;
// - as notificações de incidente do período por tipo e classificação e as do envio ao sistema nacional;
// - o nome do paciente, o relógio, os feriados e as dependências por origem (auditoria, manifestação e risco).
// O que o modelo ainda não cobre (documentos com o resumo e a retirada, análise de indicador com o texto livre,
// auditoria com o referencial e os auditores em texto, comissões com os membros em texto, pesquisa de satisfação,
// envios regulatórios, revisão de prontuários, versões anteriores e o cancelamento das não conformidades) segue falhando fechado: a leitura responde 503 `modelo-pendente` e a gravação recusa 409
// `modelo-pendente` dentro da transação (nada é gravado pela metade). Pedidos em docs/obra/fatias/f24/saida/p-qualidade-gestao.json.
import { type Executor, recusa, type TxOperacao } from '@sgh/nucleo';
import { type AnotacaoGravacao, gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { GravacaoFeita, TrilhaDaGravacao } from '../exames/public-api.js';
import {
  camelo,
  cobra,
  dataIso,
  exigirUsuario,
  feriadosDoEstabelecimento,
  instante,
  instanteN,
  type L,
  type Linha,
  lerNoEstabelecimento,
  leituraPendente,
  marcas,
  modeloPendente,
  n,
  type NucleoQualidade,
  paraBanco,
  relogioDoEstabelecimento,
  texto,
  textoN,
  verdadeiro,
} from './apoio-propria.js';
import type {
  ContextoGestao,
  GravadorGestao,
  IncidenteParaNotivisaLido,
  PortaGestao,
} from './porta-gestao.js';
import {
  type DependentesRegistro,
  type EnvioRegulatorioRegistrado,
  type ManifestacaoRegistrada,
  type NaoConformidadeNova,
  type NaoConformidadeRegistrada,
  PROTOCOLO_OUVIDORIA,
  recusaVersaoGestao,
  type RiscoNovo,
  type RiscoRegistrado,
  type TabelaCorrigivel,
} from './tipos.js';

const RECURSO = 'A gestão da qualidade';
const PENDENTE = {
  documentos: `${RECURSO}: documentos (resumo SHA-256 e retirada da versão)`,
  indicadores: `${RECURSO}: análise crítica de indicador (texto livre por competência)`,
  auditorias: `${RECURSO}: auditoria interna (referencial e auditores em texto)`,
  comissoes: `${RECURSO}: comissões e reuniões (membros e presentes em texto)`,
  pesquisas: `${RECURSO}: pesquisa de satisfação ligada à agenda`,
  envios: `${RECURSO}: envios regulatórios`,
  versoes: `${RECURSO}: versões anteriores dos registros corrigidos`,
  protocolos: `${RECURSO}: protocolos gerenciados do paciente`,
  revisao: `${RECURSO}: revisão de prontuários (checklist, sorteio, revisão e pendência)`,
  contagem: `${RECURSO}: painel de contagens (depende de documentos e ouvidoria)`,
  cancelamentoNc: `${RECURSO}: cancelamento da não conformidade (situação cancelada e a duplicada)`,
  controlesRisco: `${RECURSO}: controles existentes do risco em texto`,
} as const;

/** As tabelas que as gravações da gestão tocam (a transação do Executor recusa as outras). */
export const TABELAS_GESTAO = [
  'risco_institucional',
  'nao_conformidade_qualidade',
  'nao_conformidade_qualidade_evento',
  'plano_acao_qualidade',
  'manifestacao_ouvidoria',
  'manifestacao_ouvidoria_evento',
  'resposta_pesquisa_satisfacao',
  'sequencia_negocio',
] as const;

// ── Vocabulário: contrato (camelCase) ↔ banco (snake_case) ──────────────────────────────────────────────────────

const SITUACAO_NC_BANCO: Readonly<Record<string, string>> = {
  aberta: 'aberta',
  emTratamento: 'em_tratamento',
  verificacao: 'em_verificacao',
  encerrada: 'encerrada',
};
const situacaoNcContrato = (v: unknown): string => {
  const s = texto(v);
  if (s === 'em_verificacao') return 'verificacao';
  if (s === 'reaberta') return 'aberta';
  return camelo(s);
};

/** A coluna da origem da não conformidade (externa e outra não têm registro de origem no modelo). */
const COLUNA_ORIGEM_NC: Readonly<Record<string, string>> = {
  auditoria: 'auditoria_interna_id',
  indicador: 'indicador_id',
  notificacao: 'notificacao_incidente_id',
  ouvidoria: 'manifestacao_ouvidoria_id',
  risco: 'risco_institucional_id',
};
const TABELA_ORIGEM_NC: Readonly<Record<string, string>> = {
  auditoria: 'auditoria_interna',
  notificacao: 'notificacao_incidente',
  ouvidoria: 'manifestacao_ouvidoria',
  risco: 'risco_institucional',
};

/** A prioridade da matriz pela pontuação GUT (gravidade × urgência × tendência, 1 a 125). */
export function prioridadeDoRisco(pontuacao: number): 'critica' | 'alta' | 'moderada' | 'baixa' {
  if (pontuacao >= 64) return 'critica';
  if (pontuacao >= 27) return 'alta';
  if (pontuacao >= 8) return 'moderada';
  return 'baixa';
}

// ── Consultas ───────────────────────────────────────────────────────────────────────────────────────────────

const SQL_RISCO = `
  SELECT r.id, r.versao, r.titulo, r.descricao, sf.nome AS area, cr.codigo AS categoria, r.gravidade, r.urgencia,
         r.tendencia, r.pontuacao, ru.nome AS responsavel, r.situacao, r.reavaliar_em, r.justificativa,
         uc.login AS registrado_por, r.criado_em, ua.login AS atualizado_por, r.alterado_em,
         (SELECT GROUP_CONCAT(COALESCE(NULLIF(co.descricao, ''), co.nome) ORDER BY co.nome SEPARATOR ', ')
            FROM risco_institucional_controle rc JOIN controle_risco co ON co.id = rc.controle_risco_id
           WHERE rc.risco_institucional_id = r.id) AS controles
    FROM risco_institucional r
    JOIN categoria_risco_institucional cr ON cr.id = r.categoria_risco_institucional_id
    LEFT JOIN setor_funcional sf ON sf.id = r.setor_funcional_id
    LEFT JOIN usuario ru ON ru.id = r.responsavel_usuario_id
    LEFT JOIN usuario uc ON uc.id = r.criado_por
    LEFT JOIN usuario ua ON ua.id = r.alterado_por
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL`;

function risco(r: Linha): RiscoRegistrado {
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    titulo: texto(r['titulo']),
    descricao: texto(r['descricao']),
    area: texto(r['area']),
    categoria: camelo(r['categoria']),
    gravidade: n(r['gravidade']),
    urgencia: n(r['urgencia']),
    tendencia: n(r['tendencia']),
    pontuacao: n(r['pontuacao']),
    controles: textoN(r['controles']),
    responsavel: texto(r['responsavel']),
    situacao: camelo(r['situacao']),
    reavaliarEm: dataIso(r['reavaliar_em']) ?? '',
    justificativa: textoN(r['justificativa']),
    registradoPor: texto(r['registrado_por']),
    registradoEm: instante(r['criado_em']),
    atualizadoPor: textoN(r['atualizado_por']),
    atualizadoEm: instanteN(r['alterado_em']),
  };
}

const SQL_NC = `
  SELECT nc.id, nc.versao, nc.tipo_origem, nc.auditoria_interna_id, nc.indicador_id, nc.notificacao_incidente_id,
         nc.manifestacao_ouvidoria_id, nc.risco_institucional_id, nc.descricao, sf.nome AS area, nc.classificacao,
         nc.acao_imediata, nc.causa, pa.descricao AS plano, ru.nome AS responsavel, nc.prazo, nc.situacao, nc.eficacia,
         nc.eficacia_descricao, ua.login AS registrada_por, nc.aberta_em, uv.login AS encerrada_por, nc.encerrada_em
    FROM nao_conformidade_qualidade nc
    JOIN setor_funcional sf ON sf.id = nc.setor_funcional_id
    LEFT JOIN plano_acao_qualidade pa ON pa.id = nc.plano_acao_qualidade_id AND pa.excluido_em IS NULL
    LEFT JOIN usuario ru ON ru.id = nc.responsavel_usuario_id
    LEFT JOIN usuario ua ON ua.id = COALESCE(nc.abertura_usuario_id, nc.criado_por)
    LEFT JOIN usuario uv ON uv.id = nc.verificador_usuario_id
   WHERE nc.estabelecimento_id = ? AND nc.excluido_em IS NULL`;

function naoConformidade(r: Linha): NaoConformidadeRegistrada {
  const origem = texto(r['tipo_origem']);
  const coluna = COLUNA_ORIGEM_NC[origem];
  const encerrada = texto(r['situacao']) === 'encerrada';
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    origem,
    idOrigem: coluna && r[coluna] !== null && r[coluna] !== undefined ? n(r[coluna]) : null,
    descricao: texto(r['descricao']),
    area: texto(r['area']),
    classificacao: texto(r['classificacao']),
    acaoImediata: textoN(r['acao_imediata']),
    causa: textoN(r['causa']),
    plano: textoN(r['plano']),
    responsavel: textoN(r['responsavel']),
    prazo: dataIso(r['prazo']),
    situacao: situacaoNcContrato(r['situacao']),
    eficacia: textoN(r['eficacia']),
    eficaciaTexto: textoN(r['eficacia_descricao']),
    registradaPor: texto(r['registrada_por']),
    registradaEm: instante(r['aberta_em']),
    encerradaPor: encerrada ? textoN(r['encerrada_por']) : null,
    encerradaEm: encerrada ? instanteN(r['encerrada_em']) : null,
    canceladaEm: null,
    motivoCancelamento: null,
    duplicadaDe: null,
  };
}

/** O último evento de cada tipo da manifestação (a transferência à área, a resposta e o cancelamento). */
const ULTIMO_EVENTO = (tipo: string, extra = '') => `(SELECT ev.id FROM manifestacao_ouvidoria_evento ev
   WHERE ev.manifestacao_ouvidoria_id = m.id AND ev.tipo_evento = '${tipo}'${extra} ORDER BY ev.ocorrido_em DESC, ev.id DESC LIMIT 1)`;

const SQL_MANIFESTACAO = `
  SELECT m.id, m.versao, m.numero, co.codigo AS canal, tm.codigo AS tipo, m.identificada, m.paciente_id,
         m.nome_manifestante, COALESCE(m.email_contato, m.telefone_contato) AS contato, sf.nome AS area, m.relato,
         m.recebida_em, m.prazo_resposta, m.situacao, m.resposta, m.respondida_em,
         COALESCE(me.procedente, CASE er.motivo WHEN 'procedente' THEN 1 WHEN 'improcedente' THEN 0 END) AS procedente,
         sd.nome AS encaminhada_a, et.motivo AS observacao, ur.login AS respondida_por, ps.id AS pesquisa,
         ug.login AS registrada_por, m.criado_em, ec.ocorrido_em AS cancelada_em, ec.motivo AS motivo_cancelamento,
         CASE WHEN m.situacao IN ('respondida', 'encerrada') OR (m.situacao = 'cancelada' AND m.resposta IS NOT NULL) THEN 'respondida'
              WHEN m.situacao = 'encaminhada' OR (m.situacao = 'cancelada' AND et.id IS NOT NULL) THEN 'encaminhada'
              ELSE 'aberta' END AS situacao_contrato
    FROM manifestacao_ouvidoria m
    JOIN canal_ouvidoria co ON co.id = m.canal_ouvidoria_id
    JOIN tipo_manifestacao_ouvidoria tm ON tm.id = m.tipo_manifestacao_ouvidoria_id
    LEFT JOIN setor_funcional sf ON sf.id = m.setor_funcional_id
    LEFT JOIN motivo_encerramento_manifestacao me ON me.id = m.motivo_encerramento_manifestacao_id
    LEFT JOIN manifestacao_ouvidoria_evento et ON et.id = ${ULTIMO_EVENTO('transferencia_setor')}
    LEFT JOIN setor_funcional sd ON sd.id = et.destino_setor_funcional_id
    LEFT JOIN manifestacao_ouvidoria_evento er ON er.id = ${ULTIMO_EVENTO('resposta')}
    LEFT JOIN usuario ur ON ur.id = er.usuario_id
    LEFT JOIN manifestacao_ouvidoria_evento ec ON m.situacao = 'cancelada' AND ec.id = ${ULTIMO_EVENTO('situacao', " AND ev.situacao_nova = 'cancelada'")}
    LEFT JOIN usuario ug ON ug.id = COALESCE(m.registrante_usuario_id, m.criado_por)
    LEFT JOIN resposta_pesquisa_satisfacao ps ON ps.id = (SELECT MIN(rp.id) FROM resposta_pesquisa_satisfacao rp
                                                          WHERE rp.manifestacao_ouvidoria_id = m.id AND rp.excluido_em IS NULL)
   WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL`;

function manifestacao(r: Linha): ManifestacaoRegistrada {
  const cancelada = texto(r['situacao']) === 'cancelada';
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    protocolo: texto(r['numero']),
    canal: camelo(r['canal']),
    tipo: camelo(r['tipo']),
    identificada: verdadeiro(r['identificada']),
    paciente: r['paciente_id'] === null || r['paciente_id'] === undefined ? null : n(r['paciente_id']),
    manifestante: textoN(r['nome_manifestante']),
    contato: textoN(r['contato']),
    area: texto(r['area']),
    relato: texto(r['relato']),
    recebidaEm: instante(r['recebida_em']),
    // O prazo do modelo é a data da resposta: vence ao fim do dia.
    prazoEm: `${dataIso(r['prazo_resposta']) ?? ''}T23:59:59`,
    situacao: texto(r['situacao_contrato']),
    encaminhadaA: textoN(r['encaminhada_a']),
    observacao: textoN(r['observacao']),
    resposta: textoN(r['resposta']),
    procedente:
      r['procedente'] === null || r['procedente'] === undefined ? null : verdadeiro(r['procedente']),
    respondidaPor: textoN(r['respondida_por']),
    respondidaEm: instanteN(r['respondida_em']),
    pesquisa: r['pesquisa'] === null || r['pesquisa'] === undefined ? null : n(r['pesquisa']),
    registradaPor: texto(r['registrada_por']),
    registradaEm: instante(r['criado_em']),
    canceladaEm: cancelada ? instanteN(r['cancelada_em']) : null,
    motivoCancelamento: cancelada ? textoN(r['motivo_cancelamento']) : null,
  };
}

async function pagina<T>(
  l: L,
  sqlBase: string,
  p: readonly unknown[],
  ordem: string,
  f: { readonly pagina: number; readonly porPagina: number },
  mapa: (r: Linha) => T,
): Promise<{ itens: T[]; total: number }> {
  const total = await l.uma<{ total: number }>(`SELECT COUNT(*) AS total FROM (${sqlBase}) x`, p);
  const linhas = await l.consultar(
    `${sqlBase} ORDER BY ${ordem} LIMIT ? OFFSET ?`,
    [...p, f.porPagina, (f.pagina - 1) * f.porPagina],
    {
      teto: f.porPagina,
    },
  );
  return { itens: linhas.map(mapa), total: n(total?.total) };
}

// ── Conferências da gravação ────────────────────────────────────────────────────────────────────────────────

/**
 * O setor funcional ativo do estabelecimento pelo nome (ou código) da área informada.
 * Na alteração, `atual` é o setor gravado na linha travada: se o texto ainda é o nome ou o código dele, o setor fica
 * (a leitura devolve o nome, e salvar sem mudar nada não pode trocar de setor homônimo). Nome repetido entre setores
 * ativos recusa com `area-ambigua`, em vez de escolher um deles em silêncio.
 */
export async function setorDaArea(
  tx: L,
  est: number,
  area: string,
  atual: number | null = null,
): Promise<number> {
  const a = area.trim();
  if (atual !== null) {
    const mesmo = await tx.uma<{ id: number }>(
      `SELECT id FROM setor_funcional
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND (UPPER(nome) = UPPER(?) OR UPPER(codigo) = UPPER(?))`,
      [atual, est, a, a],
    );
    if (mesmo) return atual;
  }
  const linhas = await tx.consultar(
    `SELECT id, UPPER(nome) = UPPER(?) AS pelo_nome FROM setor_funcional
      WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL AND (UPPER(nome) = UPPER(?) OR UPPER(codigo) = UPPER(?))
      ORDER BY pelo_nome DESC, id LIMIT 2`,
    [a, est, a, a],
    { teto: 2 },
  );
  if (!linhas.length)
    throw recusa(
      'area-inexistente',
      'A área informada não é um setor ativo deste estabelecimento (cadastre o setor ou escolha outro).',
    );
  const [primeiro, segundo] = linhas;
  // O nome vale antes do código; empate no mesmo critério (dois nomes iguais, ou dois códigos sem nome) é ambíguo.
  if (segundo && verdadeiro(primeiro!['pelo_nome']) === verdadeiro(segundo['pelo_nome']))
    throw recusa('area-ambigua', 'Há mais de um setor ativo com este nome: informe o código do setor.');
  return n(primeiro!['id']);
}

/**
 * A conta do responsável pelo login ou pelo nome (único entre as contas não excluídas).
 * Na alteração, `atual` é o responsável gravado na linha travada: se o texto ainda é o login ou o nome dele, ele fica
 * (a leitura devolve o nome, e salvar sem mudar nada não pode recusar por homônimo).
 */
export async function responsavelPeloNome(tx: L, quem: string, atual: number | null = null): Promise<number> {
  const q = quem.trim();
  if (atual !== null) {
    const mesmo = await tx.uma<{ id: number }>(
      'SELECT id FROM usuario WHERE id = ? AND excluido_em IS NULL AND (login = ? OR UPPER(nome) = UPPER(?))',
      [atual, q, q],
    );
    if (mesmo) return atual;
  }
  const porLogin = await tx.uma<{ id: number }>(
    'SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL',
    [q],
  );
  if (porLogin) return n(porLogin.id);
  const porNome = await tx.consultar(
    'SELECT id FROM usuario WHERE UPPER(nome) = UPPER(?) AND excluido_em IS NULL LIMIT 2',
    [q],
    { teto: 2 },
  );
  if (porNome.length === 1) return n(porNome[0]!['id']);
  if (porNome.length > 1)
    throw recusa(
      'responsavel-ambiguo',
      'Há mais de uma conta com este nome: informe o login do responsável.',
    );
  throw recusa(
    'responsavel-inexistente',
    'O responsável informado não tem conta neste cliente (informe o login ou o nome da conta).',
  );
}

/**
 * O próximo valor da sequência de negócio do ano (a sequência nasce na primeira gravação do ano, sem
 * SELECT-depois-INSERT, com a autoria da sessão).
 */
async function proximoDoAno(tx: TxOperacao, est: number, tipo: string, agora: string): Promise<number> {
  const seq = `${tipo}_${agora.slice(0, 4)}`;
  await tx.executar(
    `INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, incremento, valor_maximo, ativo,
                                    criado_em, criado_por, versao)
     VALUES (?, ?, NULL, 1, 1, 999999, TRUE, ?, ?, 1)
     ON DUPLICATE KEY UPDATE id = id`,
    [est, seq, new Date(), tx.contexto.usuario],
  );
  return (await tx.proximoNumero(seq)).valor;
}

/** O próximo número de negócio do ano no formato `PREFIXO-AAAA-NNNNNN`. */
export async function numeroDoAno(
  tx: TxOperacao,
  est: number,
  tipo: string,
  prefixo: string,
  agora: string,
): Promise<string> {
  const numero = await proximoDoAno(tx, est, tipo, agora);
  return `${prefixo}-${agora.slice(0, 4)}-${String(numero).padStart(6, '0')}`;
}

/** O id de uma coluna de chave estrangeira lida do banco (nulo quando vazia). */
function idOuNulo(v: unknown): number | null {
  return v === null || v === undefined ? null : n(v);
}

/** Trava a linha do estabelecimento e confere a versão vista na tela. */
async function travar(
  tx: TxOperacao,
  tabela: string,
  est: number,
  id: number,
  versao: number,
  o: string,
): Promise<Linha> {
  const [r] = await tx.consultarParaAtualizar(
    `SELECT * FROM ${tabela} WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
    { teto: 1 },
  );
  if (!r || n(r['versao']) !== versao) throw recusaVersaoGestao(o);
  return r;
}

export class PortaGestaoPropria implements PortaGestao {
  readonly destino = 'banco' as const;
  protected readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoQualidade,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoGestao, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, c, fn);
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  /** A gestão grava direto pela tela (a liberação é a da chave de permissão); o que falta recusa na transação. */
  podeGravar() {
    return Promise.resolve({ pode: true, codigo: null, motivo: null });
  }

  executar(_c: ContextoGestao, op: string): Promise<GravacaoFeita> {
    return Promise.reject(
      recusa('operacao-desconhecida', `Operação ${op} sem receita do executor na gestão da qualidade.`),
    );
  }

  gravarSgh<T>(
    c: ContextoGestao,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorGestao) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'qualidade.gestao',
      tabelas: TABELAS_GESTAO,
      trilha,
      gravador: (tx, est, anotacao) => this.gravador(tx, est, anotacao),
      fn,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected gravador(tx: TxOperacao, est: number, _anotacao?: AnotacaoGravacao): GravadorGestao {
    const pendente = (o: string) => () => Promise.reject(modeloPendente(o));
    return {
      publicarDocumento: pendente(PENDENTE.documentos),
      retirarDocumento: pendente(PENDENTE.documentos),
      registrarCiencia: pendente(PENDENTE.documentos),
      registrarAnaliseIndicador: pendente(PENDENTE.indicadores),
      registrarAuditoria: pendente(PENDENTE.auditorias),
      alterarAuditoria: pendente(PENDENTE.auditorias),
      cancelarAuditoria: pendente(PENDENTE.auditorias),
      registrarComissao: pendente(PENDENTE.comissoes),
      registrarReuniaoComissao: pendente(PENDENTE.comissoes),
      retificarAta: pendente(PENDENTE.comissoes),
      assinarAta: pendente(PENDENTE.comissoes),
      cancelarReuniao: pendente(PENDENTE.comissoes),
      registrarManifestacao: (x) => this.ouvidoria(tx, est).registrar(x),
      encaminharManifestacao: (x) => this.ouvidoria(tx, est).encaminhar(x),
      responderManifestacao: (x) => this.ouvidoria(tx, est).responder(x),
      corrigirManifestacao: (x) => this.ouvidoria(tx, est).corrigir(x),
      cancelarManifestacao: (x) => this.ouvidoria(tx, est).cancelar(x),
      gerarEnvioRegulatorio: pendente(PENDENTE.envios),
      registrarTransmissaoEnvio: pendente(PENDENTE.envios),
      cancelarNaoConformidade: pendente(PENDENTE.cancelamentoNc),
      publicarChecklistRevisao: pendente(PENDENTE.revisao),
      inativarChecklistRevisao: pendente(PENDENTE.revisao),
      sortearRevisao: pendente(PENDENTE.revisao),
      cancelarSorteioRevisao: pendente(PENDENTE.revisao),
      revisarProntuario: pendente(PENDENTE.revisao),
      avalRevisao: pendente(PENDENTE.revisao),
      responderPendenciaRevisao: pendente(PENDENTE.revisao),
      cancelarPendenciaRevisao: pendente(PENDENTE.revisao),
      registrarRisco: (r) => this.registrarRisco(tx, est, r),
      registrarNaoConformidade: (x) => this.registrarNaoConformidade(tx, est, x),
    };
  }

  private async registrarRisco(
    tx: TxOperacao,
    est: number,
    r: Omit<RiscoNovo, 'hospital'>,
  ): Promise<{ id: number; versao: number; criado: boolean }> {
    // Os controles em texto não têm coluna no modelo (pedido de DDL): recusa antes de gravar qualquer parte.
    if (r.controles !== null) throw modeloPendente(PENDENTE.controlesRisco);
    const categoria = await tx.uma<{ id: number }>(
      'SELECT id FROM categoria_risco_institucional WHERE codigo = ? AND ativo = TRUE',
      [cobra(r.categoria)],
    );
    if (!categoria)
      throw recusa(
        'categoria-inexistente',
        'A categoria de risco não está cadastrada (ativa) neste cliente.',
      );
    // Na alteração, a linha é travada antes: o setor e o responsável gravados ficam quando o texto não mudou.
    const atual =
      r.id === null ? null : await travar(tx, 'risco_institucional', est, r.id, r.versao ?? -1, 'O risco');
    if (atual && texto(atual['situacao']) === 'encerrado') throw recusaVersaoGestao('O risco');
    const setor = await setorDaArea(tx, est, r.area, idOuNulo(atual?.['setor_funcional_id']));
    const responsavel = await responsavelPeloNome(
      tx,
      r.responsavel,
      idOuNulo(atual?.['responsavel_usuario_id']),
    );
    const pontuacao = r.gravidade * r.urgencia * r.tendencia;
    const situacao = cobra(r.situacao);
    const dados = {
      titulo: r.titulo,
      descricao: r.descricao,
      setor_funcional_id: setor,
      categoria_risco_institucional_id: n(categoria.id),
      responsavel_usuario_id: responsavel,
      gravidade: r.gravidade,
      urgencia: r.urgencia,
      tendencia: r.tendencia,
      pontuacao,
      prioridade: prioridadeDoRisco(pontuacao),
      situacao,
      reavaliar_em: r.reavaliarEm,
      justificativa: r.justificativa,
      encerrado_em: situacao === 'encerrado' ? r.agora.slice(0, 10) : null,
    };
    if (r.id === null) {
      const numero = await numeroDoAno(tx, est, 'risco_institucional', 'RSC', r.agora);
      const id = await tx.incluir('risco_institucional', {
        estabelecimento_id: est,
        numero,
        identificado_em: r.agora.slice(0, 10),
        ...dados,
      });
      return { id, versao: 1, criado: true };
    }
    const versao = await tx.alterar('risco_institucional', r.id, r.versao ?? -1, dados);
    return { id: r.id, versao, criado: false };
  }

  private async registrarNaoConformidade(
    tx: TxOperacao,
    est: number,
    x: Omit<NaoConformidadeNova, 'hospital'>,
  ): Promise<{ id: number; versao: number; criada: boolean }> {
    const usuario = await exigirUsuario(tx, x.usuario);
    // Na alteração, a linha é travada antes: o setor e o responsável gravados ficam quando o texto não mudou.
    const atual =
      x.id === null
        ? null
        : await travar(tx, 'nao_conformidade_qualidade', est, x.id, x.versao ?? -1, 'A não conformidade');
    if (atual && texto(atual['situacao']) === 'encerrada') throw recusaVersaoGestao('A não conformidade');
    const setor = await setorDaArea(tx, est, x.area, idOuNulo(atual?.['setor_funcional_id']));
    const responsavel = x.responsavel
      ? await responsavelPeloNome(tx, x.responsavel, idOuNulo(atual?.['responsavel_usuario_id']))
      : null;
    const situacao = SITUACAO_NC_BANCO[x.situacao];
    if (!situacao) throw recusa('situacao-invalida', 'Situação da não conformidade desconhecida.');
    if (situacao !== 'aberta' && (responsavel === null || x.prazo === null))
      throw recusa(
        'responsavel-e-prazo',
        'Fora de "aberta", a não conformidade precisa de responsável e prazo.',
      );
    if (x.plano !== null && (responsavel === null || x.prazo === null))
      throw recusa('responsavel-e-prazo', 'O plano de ação precisa de responsável e prazo.');
    const agora = paraBanco(x.agora);
    const encerra = situacao === 'encerrada';
    const verifica = encerra || situacao === 'em_verificacao';
    const campos = {
      setor_funcional_id: setor,
      descricao: x.descricao,
      classificacao: x.classificacao,
      acao_imediata: x.acaoImediata,
      causa: x.causa,
      responsavel_usuario_id: responsavel,
      prazo: x.prazo,
      situacao,
      eficacia: x.eficacia,
      eficacia_descricao: x.eficaciaTexto,
      verificada_em: encerra ? agora : null,
      verificador_usuario_id: encerra ? usuario : null,
      encerrada_em: encerra ? agora : null,
    };
    let id: number;
    let versao: number;
    let anterior: string | null = null;
    let planoAtual: number | null = null;
    if (x.id === null) {
      const coluna = COLUNA_ORIGEM_NC[x.origem];
      const origem: Record<string, number | null> = {};
      if (coluna) {
        if (x.idOrigem === null)
          throw recusa('origem-obrigatoria', 'Informe o registro de origem da não conformidade.');
        const tabela = TABELA_ORIGEM_NC[x.origem];
        const o = tabela
          ? await tx.uma<Linha>(
              `SELECT id${tabela === 'manifestacao_ouvidoria' ? ', situacao' : ''} FROM ${tabela}
                WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
              [x.idOrigem, est],
            )
          : await tx.uma<Linha>('SELECT id FROM indicador WHERE id = ? AND excluido_em IS NULL', [
              x.idOrigem,
            ]);
        if (!o) throw recusa('origem-inexistente', 'O registro de origem não existe neste estabelecimento.');
        if (o['situacao'] === 'cancelada')
          throw recusa('origem-cancelada', 'O registro de origem foi cancelado.');
        origem[coluna] = x.idOrigem;
      }
      const numero = await numeroDoAno(tx, est, 'nao_conformidade_qualidade', 'NC', x.agora);
      id = await tx.incluir('nao_conformidade_qualidade', {
        estabelecimento_id: est,
        numero,
        tipo_origem: x.origem,
        ...origem,
        aberta_em: agora,
        abertura_usuario_id: usuario,
        ...campos,
      });
      versao = 1;
    } else {
      anterior = texto(atual?.['situacao']);
      planoAtual = idOuNulo(atual?.['plano_acao_qualidade_id']);
      id = x.id;
      versao = await tx.alterar('nao_conformidade_qualidade', id, x.versao ?? -1, campos);
    }
    // O plano de ação da não conformidade (o texto vai à descrição do plano; o responsável e o prazo são os dela).
    if (x.plano !== null && responsavel !== null && x.prazo !== null) {
      const plano = {
        descricao: x.plano,
        responsavel_usuario_id: responsavel,
        prazo: x.prazo,
        setor_funcional_id: setor,
        situacao: encerra ? 'concluido' : situacao === 'aberta' ? 'planejado' : 'em_andamento',
        concluido_em: encerra ? agora : null,
        eficacia: encerra ? x.eficacia : null,
      };
      if (planoAtual === null) {
        const numero = await numeroDoAno(tx, est, 'plano_acao_qualidade', 'PA', x.agora);
        const pa = await tx.incluir('plano_acao_qualidade', {
          estabelecimento_id: est,
          numero,
          titulo: `Plano de ação da não conformidade ${id}`,
          tipo_origem: 'nao_conformidade',
          nao_conformidade_qualidade_id: id,
          ...plano,
        });
        versao = await tx.alterar('nao_conformidade_qualidade', id, versao, { plano_acao_qualidade_id: pa });
      } else {
        const v = await tx.uma<{ versao: number }>('SELECT versao FROM plano_acao_qualidade WHERE id = ?', [
          planoAtual,
        ]);
        await tx.alterar('plano_acao_qualidade', planoAtual, n(v?.versao), plano);
      }
    }
    if (anterior !== situacao)
      await tx.incluir('nao_conformidade_qualidade_evento', {
        nao_conformidade_qualidade_id: id,
        operacao: anterior === null ? 'inclusao' : 'alteracao',
        ocorrido_em: agora,
        usuario_id: usuario,
        situacao_anterior: anterior,
        situacao_nova: situacao,
        responsavel_usuario_id: responsavel,
        prazo: x.prazo,
        justificativa: verifica ? x.eficaciaTexto : null,
      });
    return { id, versao, criada: x.id === null };
  }

  /** A ouvidoria: manifestação com o evento de cada passo (abertura, transferência, resposta, correção e cancelamento). */
  private ouvidoria(tx: TxOperacao, est: number) {
    const evento = (
      id: number,
      tipo: string,
      usuario: number | null,
      agora: string,
      v: Record<string, unknown>,
    ) =>
      tx.incluir('manifestacao_ouvidoria_evento', {
        manifestacao_ouvidoria_id: id,
        operacao: tipo === 'abertura' ? 'inclusao' : 'alteracao',
        ocorrido_em: paraBanco(agora),
        usuario_id: usuario,
        tipo_evento: tipo,
        ...v,
      });
    const aberta = async (id: number, versao: number) => {
      const r = await travar(tx, 'manifestacao_ouvidoria', est, id, versao, 'A manifestação');
      if (['encerrada', 'cancelada'].includes(texto(r['situacao'])))
        throw recusaVersaoGestao('A manifestação');
      return r;
    };
    const quem = async (login: string | null) => (login ? exigirUsuario(tx, login) : null);
    return {
      registrar: async (x: Parameters<GravadorGestao['registrarManifestacao']>[0]) => {
        const canal = await tx.uma<{ id: number }>(
          'SELECT id FROM canal_ouvidoria WHERE codigo = ? AND ativo = TRUE',
          [cobra(x.canal)],
        );
        if (!canal)
          throw recusa(
            'canal-inexistente',
            'O canal da ouvidoria não está cadastrado (ativo) neste cliente.',
          );
        const tipo = await tx.uma<{ id: number }>(
          'SELECT id FROM tipo_manifestacao_ouvidoria WHERE codigo = ? AND ativo = TRUE',
          [cobra(x.tipo)],
        );
        if (!tipo)
          throw recusa(
            'tipo-inexistente',
            'O tipo de manifestação não está cadastrado (ativo) neste cliente.',
          );
        const setor = await setorDaArea(tx, est, x.area);
        const usuario = await quem(x.usuario);
        let versaoPesquisa: number | null = null;
        if (x.pesquisa !== null) {
          const [ps] = await tx.consultarParaAtualizar(
            'SELECT manifestacao_ouvidoria_id, versao FROM resposta_pesquisa_satisfacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [x.pesquisa, est],
            { teto: 1 },
          );
          if (!ps)
            throw recusa('pesquisa-inexistente', 'A resposta da pesquisa não é deste estabelecimento.');
          if (ps['manifestacao_ouvidoria_id'] !== null)
            throw recusa('pesquisa-ja-convertida', 'Esta resposta da pesquisa já virou manifestação.');
          versaoPesquisa = n(ps['versao']);
        }
        const contato = x.identificada ? (x.contato?.trim() ?? null) : null;
        const email = contato && contato.includes('@') ? contato : null;
        const protocolo = x.protocoloDe(await proximoDoAno(tx, est, 'manifestacao_ouvidoria', x.agora));
        const id = await tx.incluir('manifestacao_ouvidoria', {
          estabelecimento_id: est,
          numero: protocolo,
          tipo_manifestacao_ouvidoria_id: n(tipo.id),
          canal_ouvidoria_id: n(canal.id),
          identificada: x.identificada,
          paciente_id: x.identificada ? x.paciente : null,
          nome_manifestante: x.identificada ? x.manifestante : null,
          email_contato: email,
          telefone_contato: contato && !email ? contato.slice(0, 20) : null,
          setor_funcional_id: setor,
          relato: x.relato,
          recebida_em: paraBanco(x.recebidaEm),
          registrante_usuario_id: usuario,
          prazo_resposta: x.prazoEm.slice(0, 10),
          situacao: 'aberta',
        });
        // A ligação da resposta da pesquisa passa pelo Executor: a versão sobe e a alteração leva a autoria e a trilha.
        if (x.pesquisa !== null && versaoPesquisa !== null)
          await tx.alterar('resposta_pesquisa_satisfacao', x.pesquisa, versaoPesquisa, {
            manifestacao_ouvidoria_id: id,
          });
        await evento(id, 'abertura', usuario, x.agora, { situacao_nova: 'aberta' });
        return { id, protocolo };
      },
      encaminhar: async (x: Parameters<GravadorGestao['encaminharManifestacao']>[0]) => {
        const r = await aberta(x.id, x.versao);
        const destino = await setorDaArea(tx, est, x.encaminhadaA);
        const versao = await tx.alterar('manifestacao_ouvidoria', x.id, x.versao, {
          situacao: 'encaminhada',
        });
        // O encaminhamento não traz o relógio nem a conta: o instante é o do estabelecimento e a conta, a da sessão.
        await evento(
          x.id,
          'transferencia_setor',
          tx.contexto.usuario,
          await relogioDoEstabelecimento(tx, est),
          {
            situacao_anterior: texto(r['situacao']),
            situacao_nova: 'encaminhada',
            origem_setor_funcional_id: r['setor_funcional_id'],
            destino_setor_funcional_id: destino,
            motivo: x.observacao ?? `Encaminhada a ${x.encaminhadaA}`,
          },
        );
        return { versao };
      },
      responder: async (x: Parameters<GravadorGestao['responderManifestacao']>[0]) => {
        const r = await aberta(x.id, x.versao);
        const usuario = await quem(x.usuario);
        const versao = await tx.alterar('manifestacao_ouvidoria', x.id, x.versao, {
          situacao: 'respondida',
          resposta: x.resposta,
          respondida_em: paraBanco(x.agora),
        });
        await tx.incluir('manifestacao_ouvidoria_evento', {
          manifestacao_ouvidoria_id: x.id,
          operacao: 'alteracao',
          ocorrido_em: paraBanco(x.agora),
          usuario_id: usuario,
          tipo_evento: 'resposta',
          situacao_anterior: texto(r['situacao']),
          situacao_nova: 'respondida',
          texto: x.resposta,
          // A procedência é o juízo da resposta, no motivo do evento (o encerramento formal tem o motivo próprio).
          motivo: x.procedente === null ? null : x.procedente ? 'procedente' : 'improcedente',
        });
        return { versao };
      },
      corrigir: async (x: Parameters<GravadorGestao['corrigirManifestacao']>[0]) => {
        const r = await aberta(x.id, x.versao);
        const tipo = await tx.uma<{ id: number }>(
          'SELECT id FROM tipo_manifestacao_ouvidoria WHERE codigo = ? AND ativo = TRUE',
          [cobra(x.tipo)],
        );
        if (!tipo)
          throw recusa(
            'tipo-inexistente',
            'O tipo de manifestação não está cadastrado (ativo) neste cliente.',
          );
        const setor = await setorDaArea(tx, est, x.area, idOuNulo(r['setor_funcional_id']));
        const usuario = await quem(x.usuario);
        const versao = await tx.alterar('manifestacao_ouvidoria', x.id, x.versao, {
          tipo_manifestacao_ouvidoria_id: n(tipo.id),
          setor_funcional_id: setor,
          relato: x.relato,
        });
        await evento(x.id, 'correcao', usuario, x.agora, {
          situacao_nova: texto(r['situacao']),
          motivo: x.justificativa.slice(0, 1000),
        });
        return { versao };
      },
      cancelar: async (x: Parameters<GravadorGestao['cancelarManifestacao']>[0]) => {
        const r = await aberta(x.id, x.versao);
        const ativas = await tx.uma<{ total: number }>(
          'SELECT COUNT(*) AS total FROM nao_conformidade_qualidade WHERE manifestacao_ouvidoria_id = ? AND excluido_em IS NULL',
          [x.id],
        );
        if (n(ativas?.total) > 0)
          throw recusa(
            'com-dependentes',
            'Há registros ativos que dependem deste: o cancelamento deixaria órfãos.',
          );
        const usuario = await quem(x.usuario);
        const versao = await tx.alterar('manifestacao_ouvidoria', x.id, x.versao, { situacao: 'cancelada' });
        await evento(x.id, 'situacao', usuario, x.agora, {
          situacao_anterior: texto(r['situacao']),
          situacao_nova: 'cancelada',
          motivo: x.justificativa.slice(0, 1000),
        });
        return { versao };
      },
    };
  }

  // ── Leituras construídas ──────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoGestao) {
    return this.ler(c, (l, est) => relogioDoEstabelecimento(l, est));
  }

  feriados(c: ContextoGestao, de: string, ate: string) {
    return this.ler(c, async (l, est) =>
      (await feriadosDoEstabelecimento(l, est, de, ate)).map((f) => ({ data: f.data })),
    );
  }

  notificacaoExiste(c: ContextoGestao, id: number) {
    return this.ler(c, async (l, est) =>
      Boolean(
        await l.uma(
          'SELECT id FROM notificacao_incidente WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [id, est],
        ),
      ),
    );
  }

  /** O nome do paciente do cadastro (nunca vai à trilha). */
  nomesPacientes(c: ContextoGestao, ids: readonly number[]) {
    return this.ler(c, async (l) => {
      const m = new Map<number, string>();
      const unicos = [...new Set(ids)];
      if (!unicos.length) return m;
      const linhas = await l.consultar(
        `SELECT p.id, CASE WHEN p.usa_nome_social AND p.nome_social IS NOT NULL THEN p.nome_social ELSE pf.nome END AS nome
           FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.id IN (${marcas(unicos.length)}) AND p.excluido_em IS NULL`,
        unicos,
        { teto: unicos.length },
      );
      for (const r of linhas) m.set(n(r['id']), texto(r['nome']));
      return m;
    });
  }

  riscos(
    c: ContextoGestao,
    f: { readonly pagina: number; readonly porPagina: number; readonly situacao?: string | undefined },
  ) {
    return this.ler(c, (l, est) => {
      const p: unknown[] = [est];
      let sql = SQL_RISCO;
      if (f.situacao) {
        sql += ' AND r.situacao = ?';
        p.push(cobra(f.situacao));
      }
      return pagina(l, sql, p, 'r.pontuacao DESC, r.id', f, risco);
    });
  }

  risco(c: ContextoGestao, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_RISCO} AND r.id = ?`, [est, id]);
      return r ? risco(r) : null;
    });
  }

  naoConformidades(
    c: ContextoGestao,
    f: {
      readonly pagina: number;
      readonly porPagina: number;
      readonly situacao?: string | undefined;
      readonly origem?: string | undefined;
      readonly idOrigem?: number | undefined;
    },
  ) {
    return this.ler(c, async (l, est) => {
      const p: unknown[] = [est];
      let sql = SQL_NC;
      if (f.situacao) {
        const s = SITUACAO_NC_BANCO[f.situacao];
        if (!s) return { itens: [], total: 0 };
        sql += s === 'aberta' ? " AND nc.situacao IN ('aberta', 'reaberta')" : ' AND nc.situacao = ?';
        if (s !== 'aberta') p.push(s);
      }
      if (f.origem) {
        sql += ' AND nc.tipo_origem = ?';
        p.push(f.origem);
      }
      if (f.idOrigem !== undefined) {
        const coluna = f.origem ? COLUNA_ORIGEM_NC[f.origem] : undefined;
        if (!coluna) return { itens: [], total: 0 };
        sql += ` AND nc.${coluna} = ?`;
        p.push(f.idOrigem);
      }
      return pagina(
        l,
        sql,
        p,
        "nc.situacao = 'encerrada', nc.prazo IS NULL, nc.prazo, nc.id DESC",
        f,
        naoConformidade,
      );
    });
  }

  naoConformidade(c: ContextoGestao, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_NC} AND nc.id = ?`, [est, id]);
      return r ? naoConformidade(r) : null;
    });
  }

  /** Quantas não conformidades ativas cada registro de origem tem (externa e outra não apontam registro). */
  naoConformidadesPorOrigem(c: ContextoGestao, origem: string, ids: readonly number[]) {
    return this.ler(c, async (l, est) => {
      const m = new Map<number, number>();
      const coluna = COLUNA_ORIGEM_NC[origem];
      const unicos = [...new Set(ids)];
      if (!coluna || !unicos.length) return m;
      const linhas = await l.consultar(
        `SELECT ${coluna} AS origem, COUNT(*) AS total FROM nao_conformidade_qualidade
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND tipo_origem = ? AND ${coluna} IN (${marcas(unicos.length)})
          GROUP BY ${coluna}`,
        [est, origem, ...unicos],
        { teto: unicos.length },
      );
      for (const r of linhas) m.set(n(r['origem']), n(r['total']));
      return m;
    });
  }

  /** As dependências ativas pelas origens das não conformidades (auditoria, manifestação e risco). */
  dependentes(c: ContextoGestao, tabela: string, id: number): Promise<DependentesRegistro[]> {
    const porOrigem: Readonly<Record<string, [string, string]>> = {
      auditoria_interna: ['auditoria', 'Não conformidades da auditoria'],
      manifestacao_ouvidoria: ['ouvidoria', 'Não conformidades da manifestação'],
      risco_institucional: ['risco', 'Não conformidades do risco'],
    };
    const alvo = porOrigem[tabela];
    if (!alvo) return Promise.reject(leituraPendente(`${PENDENTE.versoes} (dependências de ${tabela})`));
    const [origem, grupo] = alvo;
    const coluna = COLUNA_ORIGEM_NC[origem]!;
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT id FROM nao_conformidade_qualidade
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND tipo_origem = ? AND ${coluna} = ? ORDER BY id`,
        [est, origem, id],
        { teto: 1000 },
      );
      const ids = linhas.map((r) => n(r['id']));
      return ids.length
        ? [{ grupo, dependente: 'nao_conformidade_qualidade', quantidade: ids.length, ids }]
        : [];
    });
  }

  /** As notificações do período por tipo e classificação, sem as descartadas (`ate` exclusivo). */
  notificacoesPorTipo(c: ContextoGestao, de: string, ate: string) {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT ti.codigo AS tipo, ci.codigo AS classificacao, COUNT(*) AS total
           FROM notificacao_incidente ni
           JOIN tipo_incidente ti ON ti.id = ni.tipo_incidente_id
           LEFT JOIN classificacao_incidente ci ON ci.id = ni.classificacao_incidente_id
          WHERE ni.estabelecimento_id = ? AND ni.excluido_em IS NULL AND ni.situacao <> 'descartada'
            AND ni.ocorrido_em >= ? AND ni.ocorrido_em < ?
          GROUP BY ti.codigo, ci.codigo ORDER BY ti.codigo, ci.codigo`,
        [est, de.slice(0, 10), ate.slice(0, 10)],
        { teto: 5000 },
      );
      return linhas.map((r) => ({
        tipo: camelo(r['tipo']),
        classificacao: camelo(r['classificacao']),
        total: n(r['total']),
      }));
    });
  }

  /** Os incidentes da competência para o envio ao sistema nacional (`de` inclusivo, `ate` exclusivo). */
  incidentesNotivisa(c: ContextoGestao, de: string, ate: string) {
    const TETO = 2000;
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT ni.numero, ni.ocorrido_em, ti.codigo AS tipo, ci.codigo AS classificacao, gd.codigo AS dano, ni.evento_nunca,
                (SELECT e.enviado_em FROM notificacao_incidente_envio e
                  WHERE e.notificacao_incidente_id = ni.id AND e.situacao IN ('enviada', 'transcrita', 'aceita')
                  ORDER BY e.enviado_em DESC, e.id DESC LIMIT 1) AS transcrita_em,
                (SELECT e.protocolo FROM notificacao_incidente_envio e
                  WHERE e.notificacao_incidente_id = ni.id AND e.situacao IN ('enviada', 'transcrita', 'aceita')
                  ORDER BY e.enviado_em DESC, e.id DESC LIMIT 1) AS protocolo
           FROM notificacao_incidente ni
           JOIN tipo_incidente ti ON ti.id = ni.tipo_incidente_id
           LEFT JOIN classificacao_incidente ci ON ci.id = ni.classificacao_incidente_id
           LEFT JOIN grau_dano gd ON gd.id = ni.grau_dano_id
          WHERE ni.estabelecimento_id = ? AND ni.excluido_em IS NULL AND ni.situacao <> 'descartada'
            AND ni.ocorrido_em >= ? AND ni.ocorrido_em < ?
          ORDER BY ni.ocorrido_em, ni.id LIMIT ?`,
        [est, de.slice(0, 10), ate.slice(0, 10), TETO + 1],
        { teto: TETO + 1 },
      );
      const itens: IncidenteParaNotivisaLido[] = linhas.slice(0, TETO).map((r) => ({
        numero: texto(r['numero']),
        ocorridoEm: instante(r['ocorrido_em']),
        tipo: camelo(r['tipo']),
        classificacao: camelo(r['classificacao']),
        dano: camelo(r['dano']),
        neverEvent: verdadeiro(r['evento_nunca']),
        transcritaEm: instanteN(r['transcrita_em']),
        numeroNotivisa: textoN(r['protocolo']),
      }));
      return { itens, cortada: linhas.length > TETO };
    });
  }

  /** As manifestações da ouvidoria do estabelecimento (a situação do contrato derivada da do banco). */
  manifestacoes(
    c: ContextoGestao,
    f: {
      readonly pagina: number;
      readonly porPagina: number;
      readonly situacao?: string | undefined;
      readonly tipo?: string | undefined;
      readonly busca?: string | undefined;
      readonly recebidaDe?: string | undefined;
      readonly recebidaAntes?: string | undefined;
    },
  ) {
    return this.ler(c, (l, est) => {
      const p: unknown[] = [est];
      const filtros: string[] = [];
      if (f.situacao) {
        filtros.push('x.situacao_contrato = ?');
        p.push(f.situacao);
      }
      if (f.tipo) {
        filtros.push('x.tipo = ?');
        p.push(cobra(f.tipo));
      }
      const b = f.busca?.trim();
      if (b) {
        if (PROTOCOLO_OUVIDORIA.test(b.toUpperCase())) {
          filtros.push('x.numero = ?');
          p.push(b.toUpperCase());
        } else {
          filtros.push(
            "(x.numero LIKE CONCAT('%', ?, '%') OR x.area LIKE CONCAT('%', ?, '%') OR x.relato LIKE CONCAT('%', ?, '%'))",
          );
          p.push(b, b, b);
        }
      }
      if (f.recebidaDe) {
        filtros.push('x.recebida_em >= ?');
        p.push(f.recebidaDe.slice(0, 10));
      }
      if (f.recebidaAntes) {
        filtros.push('x.recebida_em < ?');
        p.push(f.recebidaAntes.slice(0, 10));
      }
      const sql = `SELECT x.* FROM (${SQL_MANIFESTACAO}) x${filtros.length ? ` WHERE ${filtros.join(' AND ')}` : ''}`;
      return pagina(
        l,
        sql,
        p,
        "x.situacao_contrato = 'respondida', x.prazo_resposta, x.id DESC",
        f,
        manifestacao,
      );
    });
  }

  manifestacao(c: ContextoGestao, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`SELECT x.* FROM (${SQL_MANIFESTACAO}) x WHERE x.id = ?`, [est, id]);
      return r ? manifestacao(r) : null;
    });
  }

  // ── Leituras que aguardam o modelo: falham fechadas (503 `modelo-pendente`), nunca vazio nem zero ──

  private pendente(o: string): Promise<never> {
    return Promise.reject(leituraPendente(o));
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  documentos(..._a: Parameters<PortaGestao['documentos']>): ReturnType<PortaGestao['documentos']> {
    return this.pendente(PENDENTE.documentos);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  documento(..._a: Parameters<PortaGestao['documento']>): ReturnType<PortaGestao['documento']> {
    return this.pendente(PENDENTE.documentos);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  documentosDoCodigo(
    ..._a: Parameters<PortaGestao['documentosDoCodigo']>
  ): ReturnType<PortaGestao['documentosDoCodigo']> {
    return this.pendente(PENDENTE.documentos);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  ciencias(..._a: Parameters<PortaGestao['ciencias']>): ReturnType<PortaGestao['ciencias']> {
    return this.pendente(PENDENTE.documentos);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  cientes(..._a: Parameters<PortaGestao['cientes']>): ReturnType<PortaGestao['cientes']> {
    return this.pendente(PENDENTE.documentos);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  analises(..._a: Parameters<PortaGestao['analises']>): ReturnType<PortaGestao['analises']> {
    return this.pendente(PENDENTE.indicadores);
  }
  /* eslint-disable @typescript-eslint/no-unused-vars */
  historicoAnalises(
    ..._a: Parameters<PortaGestao['historicoAnalises']>
  ): ReturnType<PortaGestao['historicoAnalises']> {
    return this.pendente(PENDENTE.indicadores);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  auditorias(..._a: Parameters<PortaGestao['auditorias']>): ReturnType<PortaGestao['auditorias']> {
    return this.pendente(PENDENTE.auditorias);
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  auditoria(..._a: Parameters<PortaGestao['auditoria']>): ReturnType<PortaGestao['auditoria']> {
    return this.pendente(PENDENTE.auditorias);
  }
  /* eslint-disable @typescript-eslint/no-unused-vars */
  comissoes(..._a: Parameters<PortaGestao['comissoes']>): ReturnType<PortaGestao['comissoes']> {
    return this.pendente(PENDENTE.comissoes);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  comissao(..._a: Parameters<PortaGestao['comissao']>): ReturnType<PortaGestao['comissao']> {
    return this.pendente(PENDENTE.comissoes);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  reunioes(..._a: Parameters<PortaGestao['reunioes']>): ReturnType<PortaGestao['reunioes']> {
    return this.pendente(PENDENTE.comissoes);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  reuniao(..._a: Parameters<PortaGestao['reuniao']>): ReturnType<PortaGestao['reuniao']> {
    return this.pendente(PENDENTE.comissoes);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  // A assinatura do contrato (a porta completa sobrescreve com a leitura).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pesquisas(_c: ContextoGestao, _de: string, _ate: string): ReturnType<PortaGestao['pesquisas']> {
    return this.pendente(PENDENTE.pesquisas);
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pesquisa(_c: ContextoGestao, _id: number): ReturnType<PortaGestao['pesquisa']> {
    return this.pendente(PENDENTE.pesquisas);
  }
  /* eslint-disable @typescript-eslint/no-unused-vars */
  contagem(..._a: Parameters<PortaGestao['contagem']>): ReturnType<PortaGestao['contagem']> {
    return this.pendente(PENDENTE.contagem);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  // A assinatura do contrato (a porta completa sobrescreve com a leitura).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  envios(_c: ContextoGestao, _desde: string): Promise<EnvioRegulatorioRegistrado[]> {
    return this.pendente(PENDENTE.envios);
  }
  // A assinatura do contrato (a porta completa sobrescreve com a leitura).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  envio(_c: ContextoGestao, _id: number): Promise<EnvioRegulatorioRegistrado | null> {
    return this.pendente(PENDENTE.envios);
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  versoes(_c: ContextoGestao, _tabela: TabelaCorrigivel, _id: number): ReturnType<PortaGestao['versoes']> {
    return this.pendente(PENDENTE.versoes);
  }
  /* eslint-disable @typescript-eslint/no-unused-vars */
  protocolosGerenciados(
    _c: ContextoGestao,
    _inicio: string,
    _fim: string,
  ): ReturnType<PortaGestao['protocolosGerenciados']> {
    return this.pendente(PENDENTE.protocolos);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  checklistsRevisao(
    ..._a: Parameters<PortaGestao['checklistsRevisao']>
  ): ReturnType<PortaGestao['checklistsRevisao']> {
    return this.pendente(PENDENTE.revisao);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  checklistRevisao(
    ..._a: Parameters<PortaGestao['checklistRevisao']>
  ): ReturnType<PortaGestao['checklistRevisao']> {
    return this.pendente(PENDENTE.revisao);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  altasParaRevisao(
    ..._a: Parameters<PortaGestao['altasParaRevisao']>
  ): ReturnType<PortaGestao['altasParaRevisao']> {
    return this.pendente(PENDENTE.revisao);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  loginsDosMedicos(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._a: Parameters<PortaGestao['loginsDosMedicos']>
  ): ReturnType<PortaGestao['loginsDosMedicos']> {
    return this.pendente(PENDENTE.revisao);
  }
  sorteiosRevisao(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._a: Parameters<PortaGestao['sorteiosRevisao']>
  ): ReturnType<PortaGestao['sorteiosRevisao']> {
    return this.pendente(PENDENTE.revisao);
  }
  sorteioRevisao(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._a: Parameters<PortaGestao['sorteioRevisao']>
  ): ReturnType<PortaGestao['sorteioRevisao']> {
    return this.pendente(PENDENTE.revisao);
  }
  /* eslint-disable @typescript-eslint/no-unused-vars */
  prontuariosDoSorteio(
    ..._a: Parameters<PortaGestao['prontuariosDoSorteio']>
  ): ReturnType<PortaGestao['prontuariosDoSorteio']> {
    return this.pendente(PENDENTE.revisao);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  prontuarioRevisao(
    ..._a: Parameters<PortaGestao['prontuarioRevisao']>
  ): ReturnType<PortaGestao['prontuarioRevisao']> {
    return this.pendente(PENDENTE.revisao);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pendenciasDosProntuarios(
    ..._a: Parameters<PortaGestao['pendenciasDosProntuarios']>
  ): ReturnType<PortaGestao['pendenciasDosProntuarios']> {
    return this.pendente(PENDENTE.revisao);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pendenciaRevisao(
    ..._a: Parameters<PortaGestao['pendenciaRevisao']>
  ): ReturnType<PortaGestao['pendenciaRevisao']> {
    return this.pendente(PENDENTE.revisao);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pendenciasDoLogin(
    ..._a: Parameters<PortaGestao['pendenciasDoLogin']>
  ): ReturnType<PortaGestao['pendenciasDoLogin']> {
    return this.pendente(PENDENTE.revisao);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
  revisoesDaCompetencia(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._a: Parameters<PortaGestao['revisoesDaCompetencia']>
  ): ReturnType<PortaGestao['revisoesDaCompetencia']> {
    return this.pendente(PENDENTE.revisao);
  }
  revisoesDaInternacao(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._a: Parameters<PortaGestao['revisoesDaInternacao']>
  ): ReturnType<PortaGestao['revisoesDaInternacao']> {
    return this.pendente(PENDENTE.revisao);
  }
}
