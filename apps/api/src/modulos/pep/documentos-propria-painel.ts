// Porta PRÓPRIA dos documentos do prontuário, família "painel" (M23, rodada pep-gravacao): o painel de pacientes, o
// episódio do sumário, os alertas de completude, as preferências do painel, a leitura das receitas, atestados e exames
// externos, a lista por família, as fichas e os modelos em uso, o cabeçalho do documento, os tempos do atendimento, a
// fila e o fluxo dos pareceres, a liberação da gravação (podeGravar) e o despacho das gravações pelo executor.
// Funções sobre (nucleo, cliente, ...args do método da porta); o integrador troca os métodos pendentes de
// documentos-porta-propria.ts por estas chamadas. A especificação é a porta de memória (documentos-porta-memoria.ts).
// Leitura pelo Leitor (somente leitura), sempre no estabelecimento da sessão e sem linha excluída logicamente.
// Registro clínico nunca é apagado: a suspensão grava situação, quem, quando e o motivo (nova versão da linha) e a
// versão do documento emitido; nenhuma exclusão física.
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { situacaoDoPaciente, tipoDaClasse, tiposBaseDoFiltro } from '@sgh/dominio-pep';
import type { ContextoDocs } from './documentos-porta.js';
import { type NucleoDocumentosPep, recusaPendente } from './documentos-propria-comum.js';
import { dataHora, fusoValido } from './registro-propria-comum.js';
import {
  type CabecalhoDocumentoLido,
  type CompletudePainelLida,
  type DocumentoHistoricoLido,
  type DocumentoResumoLido,
  type EpisodioLido,
  esquemaSuspensaoDocumento,
  type FichaImpressao,
  type FluxoLido,
  type LiberacaoConsultada,
  type LinhaPainelLida,
  type RecortePainel,
} from './tipos-pep.js';

/** Teto de linhas do painel (o serviço calcula os alertas de até 300 linhas de uma vez). */
export const TETO_PAINEL = 300;
/** Teto de documentos por paciente, de itens da fila e de tempos. */
export const TETO_LISTA = 500;
/** Teto de ids por lote (completude do painel). */
export const TETO_IDS = 300;

/** O tipo de receita que o serviço trata como "controle especial" (tpPadrao 4) e o simples (1). */
export const TP_PADRAO_CONTROLADA = 4;
export const TP_PADRAO_SIMPLES = 1;
/** Tipo do documento de cada receituário próprio (o mesmo do emitir). */
const TIPO_DOCUMENTO_DA_RECEITA = {
  simples: 'receita',
  'controle-especial': 'receita-controlada',
  antimicrobiano: 'receita-antimicrobiano',
} as const;

interface Est {
  readonly id: number;
  readonly fuso: string;
  readonly nome: string;
}

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
const idsValidos = (ids: readonly number[]): number[] =>
  [...new Set(ids)].filter((i) => Number.isSafeInteger(i) && i > 0).slice(0, TETO_IDS);
const valido = (id: number): boolean => Number.isSafeInteger(id) && id > 0;

function jsonDe(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !Buffer.isBuffer(v)) return v;
  try {
    return JSON.parse(String(v)) as unknown;
  } catch {
    return null;
  }
}

/** Número de negócio do atendimento (texto) como número; sem dígitos, o id. */
function numeroDeNegocio(numero: unknown, id: unknown): number {
  const n = Number(String(numero ?? '').replace(/\D/g, ''));
  return Number.isSafeInteger(n) && n > 0 ? n : num(id);
}

const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, 'Operação recusada', detalhe);

async function estabelecimento(l: Leitor, codigo: string): Promise<Est> {
  const e = await l.uma(
    'SELECT id, fuso_horario, nome_fantasia FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
    [codigo],
  );
  if (!e)
    throw new ErroOperacao(
      404,
      'estabelecimento-inexistente',
      'Estabelecimento não encontrado',
      'O estabelecimento da sessão não existe neste cliente.',
    );
  return { id: num(e['id']), fuso: fusoValido(e['fuso_horario']), nome: String(e['nome_fantasia'] ?? '') };
}

function ler<T>(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  rotulo: string,
  fn: (l: Leitor, est: Est) => Promise<T>,
): Promise<T> {
  return nucleo.lerSomente(
    { cliente: c.cliente || cliente, correlacao: `pep.documentos.${rotulo}` },
    async (l) => fn(l, await estabelecimento(l, c.hospital)),
  );
}

/** Usuário e profissional (vínculo vigente no estabelecimento) do login; sem conta: null. */
const SQL_PROFISSIONAL_DO_LOGIN = `
  SELECT u.id AS usuario, p.id AS profissional
    FROM usuario u
    LEFT JOIN usuario_vinculo_profissional v ON v.usuario_id = u.id AND v.estabelecimento_id = ?
          AND v.profissional_id IS NOT NULL AND v.excluido_em IS NULL
          AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
    LEFT JOIN profissional p ON p.id = v.profissional_id AND p.excluido_em IS NULL
   WHERE u.login = ? AND u.excluido_em IS NULL
   ORDER BY (p.id IS NULL), v.vigencia_inicio DESC, v.id DESC LIMIT 1`;

/** Login de um profissional no estabelecimento: o vínculo vigente primeiro; sem ele, o mais recente. */
const SQL_LOGIN_DO_PROFISSIONAL = (coluna: string) => `
  (SELECT u.login FROM usuario_vinculo_profissional v JOIN usuario u ON u.id = v.usuario_id
    WHERE v.profissional_id = ${coluna} AND v.estabelecimento_id = x.estabelecimento_id
    ORDER BY (v.excluido_em IS NULL AND v.vigencia_inicio <= CURRENT_DATE
              AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)) DESC,
             v.vigencia_inicio DESC, v.id DESC LIMIT 1)`;

/** Código CBO 2002 da inscrição principal do profissional (categoria do autor; sigilo). */
const SQL_CBO_DO_PROFISSIONAL = (coluna: string) => `
  (SELECT o.codigo_cbo FROM inscricao_conselho i JOIN ocupacao_cbo o ON o.id = i.ocupacao_cbo_id
    WHERE i.profissional_id = ${coluna} AND i.excluido_em IS NULL
    ORDER BY i.principal DESC, i.sequencia, i.id LIMIT 1)`;

// ── Painel ───────────────────────────────────────────────────────────────────────────────────────

/** A data de hoje (AAAA-MM-DD) no fuso do estabelecimento, para a alta prevista. */
const hojeNoFuso = (fuso: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/**
 * Pacientes com atendimento aberto no estabelecimento (sem saída, nem encerrado nem cancelado), o mais recente de cada
 * paciente. Unidade: a da internação ou a do atendimento. Busca: parte do nome (maiúsculas) ou o número do prontuário.
 * "Meus": quem registrou no episódio (a conta do login) ou aceitou parecer do paciente; "equipe": a especialidade da
 * internação está entre as do profissional. Lista vazia de recorte = nenhuma linha (falha fechada).
 */
export function painel(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  f: { unidade: number | null; busca: string | null } & RecortePainel,
): Promise<{ linhas: LinhaPainelLida[]; limitado: boolean }> {
  return ler(nucleo, cliente, c, 'painel', async (l, est) => {
    const filtros: string[] = [];
    const p: unknown[] = [est.id, est.id];
    if (f.unidade !== null) {
      // A unidade é a assistencial: a que a unidade de internação especializa ou, sem internação, a do atendimento.
      filtros.push('COALESCE(uin.unidade_assistencial_id, a.unidade_assistencial_id) = ?');
      p.push(f.unidade);
    }
    const termo = f.busca?.trim().toUpperCase() ?? '';
    if (termo) {
      filtros.push("(UPPER(pf.nome) LIKE CONCAT('%', ?, '%') OR CAST(pc.numero_prontuario AS CHAR) = ?)");
      p.push(
        termo.replace(/[\\%_]/g, (m) => `\\${m}`),
        termo,
      );
    }
    if (f.meus) {
      filtros.push(`(EXISTS (SELECT 1 FROM registro_assistencial r JOIN usuario u ON u.id = r.autor_usuario_id
                              WHERE r.atendimento_id = a.id AND u.login = ? AND r.excluido_em IS NULL)
                  OR EXISTS (SELECT 1 FROM interconsulta ic
                              JOIN usuario_vinculo_profissional v ON v.profissional_id = ic.aceito_por_profissional_id
                                   AND v.estabelecimento_id = ic.estabelecimento_id AND v.excluido_em IS NULL
                              JOIN usuario u ON u.id = v.usuario_id
                              WHERE ic.paciente_id = a.paciente_id AND ic.estabelecimento_id = a.estabelecimento_id
                                AND u.login = ? AND ic.excluido_em IS NULL))`);
      p.push(f.meus.login, f.meus.login);
    }
    if (f.equipe) {
      const esp = idsValidos(f.equipe.especialidades);
      if (esp.length === 0) return { linhas: [], limitado: false };
      // A especialidade da internação; sem internação (pronto atendimento, ambulatório), a do atendimento.
      filtros.push(
        `COALESCE(i.especialidade_medica_id, a.especialidade_medica_id) IN (${marcadores(esp.length)})`,
      );
      p.push(...esp);
    }
    const r = f.filtro;
    // A situação do paciente é regra do domínio (situacaoDoPaciente): o SQL só traz o estado do atendimento, e o
    // recorte é aplicado depois da leitura, antes do teto.
    let situacaoPedida: string | null = null;
    if (r) {
      // Recortes do filtro salvo (F3.3, L90): setor da unidade de internação ou, sem ela, o do atendimento; acomodação
      // e leito da internação; especialidade como no recorte da equipe; tipo e situação pelas regras do domínio.
      if (r.setor !== null) {
        filtros.push('COALESCE(uin.setor_funcional_id, a.setor_funcional_id) = ?');
        p.push(r.setor);
      }
      if (r.acomodacao !== null) {
        filtros.push('COALESCE(i.acomodacao_id, lh.acomodacao_id) = ?');
        p.push(r.acomodacao);
      }
      if (r.leito !== null) {
        filtros.push('i.leito_hospitalar_id = ?');
        p.push(r.leito);
      }
      if (r.especialidade !== null) {
        filtros.push('COALESCE(i.especialidade_medica_id, a.especialidade_medica_id) = ?');
        p.push(r.especialidade);
      }
      if (r.tipoAtendimento === 'domiciliar')
        filtros.push(`EXISTS (SELECT 1 FROM internacao_domiciliar d WHERE d.paciente_id = a.paciente_id
                         AND d.estabelecimento_id = a.estabelecimento_id AND d.situacao = 'ativa'
                         AND d.excluido_em IS NULL)`);
      else if (r.tipoAtendimento !== null && r.tipoAtendimento !== 'todos') {
        const tipos = tiposBaseDoFiltro(r.tipoAtendimento);
        filtros.push(`k.tipo_base IN (${marcadores(tipos.length)})`);
        p.push(...tipos);
      }
      if (r.situacao !== null && r.situacao !== 'todos') situacaoPedida = r.situacao;
    }
    const lote = (limite: number, desde: number) =>
      l.consultar(
        `SELECT a.id, a.numero, a.paciente_id, k.tipo_base, a.entrada_em, pf.nome,
              CASE WHEN pc.usa_nome_social THEN COALESCE(pc.nome_social, pf.nome_social) END AS nome_social,
              DATE_FORMAT(pf.data_nascimento, '%Y-%m-%d') AS nascimento, sx.sigla AS sexo, pc.numero_prontuario,
              COALESCE(ui.id, ua.id) AS id_unidade, COALESCE(ui.nome, ua.nome) AS unidade, lh.codigo AS leito,
              fp.nome AS convenio, pfm.nome AS medico,
              (SELECT COUNT(*) FROM alergia_paciente al
                WHERE al.paciente_id = a.paciente_id AND al.ativa = TRUE AND al.excluido_em IS NULL
                  AND al.tipo_registro IN ('alergia','intolerancia')) AS alergias,
              (a.alta_medica_em IS NOT NULL OR i.situacao = 'alta_medica') AS alta_medica,
              DATE_FORMAT(i.data_prevista_alta, '%Y-%m-%d') AS alta_prevista, i.id AS internacao_id,
              a.situacao AS situacao_atendimento
         FROM atendimento a
         JOIN categoria_atendimento k ON k.id = a.categoria_atendimento_id
         JOIN paciente pc ON pc.id = a.paciente_id AND pc.excluido_em IS NULL AND pc.situacao <> 'unificado'
         JOIN pessoa_fisica pf ON pf.id = pc.pessoa_fisica_id
         LEFT JOIN sexo sx ON sx.id = pf.sexo_id
         LEFT JOIN unidade_assistencial ua ON ua.id = a.unidade_assistencial_id
         LEFT JOIN internacao i ON i.atendimento_id = a.id AND i.excluido_em IS NULL
         LEFT JOIN unidade_internacao uin ON uin.id = i.unidade_internacao_id
         LEFT JOIN unidade_assistencial ui ON ui.id = uin.unidade_assistencial_id
         LEFT JOIN leito_hospitalar lh ON lh.id = i.leito_hospitalar_id
         LEFT JOIN fonte_pagadora fp ON fp.id = a.fonte_pagadora_id
         LEFT JOIN profissional pm ON pm.id = COALESCE(i.medico_assistente_profissional_id, a.profissional_id)
         LEFT JOIN pessoa_fisica pfm ON pfm.id = pm.pessoa_fisica_id
        WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.saida_em IS NULL
          AND a.situacao NOT IN ('encerrado','cancelado')
          AND a.id = (SELECT a2.id FROM atendimento a2
                       WHERE a2.paciente_id = a.paciente_id AND a2.estabelecimento_id = ? AND a2.excluido_em IS NULL
                         AND a2.saida_em IS NULL AND a2.situacao NOT IN ('encerrado','cancelado')
                       ORDER BY a2.entrada_em DESC, a2.id DESC LIMIT 1)
          ${filtros.map((x) => `AND ${x}`).join(' ')}
        ORDER BY pf.nome, a.id LIMIT ${limite} OFFSET ${desde}`,
        p,
      );
    let ls: Record<string, unknown>[];
    if (situacaoPedida === null) ls = await lote(TETO_PAINEL + 1, 0);
    else {
      // Lê em lotes e fica com as linhas cuja situação (domínio) é a pedida, até passar do teto.
      const hoje = hojeNoFuso(est.fuso);
      const LOTE = 1000;
      ls = [];
      for (let desde = 0; ls.length <= TETO_PAINEL; desde += LOTE) {
        const parte = await lote(LOTE, desde);
        for (const x of parte)
          if (
            situacaoDoPaciente(
              {
                altaMedica: Number(x['alta_medica']) === 1,
                altaPrevista: textoOuNull(x['alta_prevista']),
                internado: x['internacao_id'] !== null && x['internacao_id'] !== undefined,
                situacaoAtendimento: String(x['situacao_atendimento']),
              },
              hoje,
            ) === situacaoPedida
          )
            ls.push(x);
        if (parte.length < LOTE) break;
      }
    }
    return {
      linhas: ls.slice(0, TETO_PAINEL).map((x) => ({
        paciente: num(x['paciente_id']),
        nome: String(x['nome']),
        nomeSocial: textoOuNull(x['nome_social']),
        nascimento: textoOuNull(x['nascimento']),
        sexo: textoOuNull(x['sexo']),
        prontuario: num(x['numero_prontuario']),
        atendimento: num(x['id']),
        registro: numeroDeNegocio(x['numero'], x['id']),
        tipo: String(x['tipo_base']) === 'internacao' ? ('internacao' as const) : ('externo' as const),
        entrada: dataHora(x['entrada_em'], est.fuso),
        unidade: textoOuNull(x['unidade']),
        idUnidade: numOuNull(x['id_unidade']),
        leito: textoOuNull(x['leito']),
        convenio: textoOuNull(x['convenio']),
        medico: textoOuNull(x['medico']),
        alergiasAtivas: num(x['alergias']),
      })),
      limitado: ls.length > TETO_PAINEL,
    };
  });
}

/**
 * O episódio do atendimento para o sumário de alta: o CID principal da internação ("código - descrição"), as
 * cirurgias realizadas (só o que foi feito; diagnósticos não entram) e os exames liberados e externos. Sem
 * internação: tudo vazio (como a memória faz com o atendimento externo).
 */
export function episodio(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  atendimento: number,
): Promise<EpisodioLido> {
  const vazio: EpisodioLido = { motivoInternacao: null, procedimentos: [], exames: [] };
  if (!valido(atendimento)) return Promise.resolve(vazio);
  return ler(nucleo, cliente, c, 'episodio', async (l, est) => {
    const i = await l.uma(
      `SELECT t.codigo_termo, t.descricao
         FROM internacao i
         LEFT JOIN termo_terminologia t ON t.id = i.cid_principal_termo_terminologia_id
        WHERE i.atendimento_id = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL
        ORDER BY i.id DESC LIMIT 1`,
      [atendimento, est.id],
    );
    if (!i) return vazio;
    const codigo = textoOuNull(i['codigo_termo']);
    // Cirurgias do atendimento: atos realizados (nunca o cancelado nem o em andamento), os procedimentos não excluídos,
    // na ordem do ato e da sequência; o CID do procedimento ou, sem ele, o pós-operatório do ato.
    const cirurgias = await l.consultar(
      `SELECT pc.descricao, COALESCE(ap.codigo_cid10, ac.codigo_cid10_pos_operatorio) AS cid,
              COALESCE(ac.inicio_cirurgia_em, ac.entrada_sala_em, ac.criado_em) AS em
         FROM ato_cirurgico ac
         JOIN ato_cirurgico_procedimento ap ON ap.ato_cirurgico_id = ac.id AND ap.excluido_em IS NULL
         JOIN procedimento_cirurgico pc ON pc.id = ap.procedimento_cirurgico_id
        WHERE ac.atendimento_id = ? AND ac.estabelecimento_id = ? AND ac.excluido_em IS NULL
          AND ac.situacao = 'realizado'
        ORDER BY ac.inicio_cirurgia_em, ac.id, ap.sequencia, ap.id LIMIT 50`,
      [atendimento, est.id],
    );
    // Exames do atendimento: os resultados liberados (laboratório e imagem do próprio hospital, sem exclusão lógica)
    // e os exames externos lançados no prontuário (ativos). O corte é pelo momento clínico, do mais recente para o mais
    // antigo (as janelas das seções contam para trás a partir da alta), e cada ocorrência ocupa uma linha, por isso o
    // corte é maior que o dos nomes; a ordem alfabética é da apresentação, depois do corte.
    const exames = await l.consultar(
      `SELECT nome, em FROM (
         SELECT ex.nome AS nome, re.resultado_em AS em
           FROM resultado_exame re
           JOIN exame_item it ON it.id = re.exame_item_id
           JOIN requisicao_exame rq ON rq.id = it.requisicao_exame_id
           JOIN exame ex ON ex.id = it.exame_id
          WHERE rq.atendimento_id = ? AND rq.estabelecimento_id = ? AND re.situacao = 'liberado'
            AND re.excluido_em IS NULL AND it.excluido_em IS NULL AND rq.excluido_em IS NULL
         UNION
         SELECT COALESCE(e.nome_exame, 'Exame externo') AS nome, e.realizado_em AS em FROM exame_lancado_prontuario e
          WHERE e.atendimento_id = ? AND e.estabelecimento_id = ? AND e.excluido_em IS NULL AND e.situacao = 'ativo'
       ) x ORDER BY em IS NULL, em DESC, nome LIMIT 500`,
      [atendimento, est.id, atendimento, est.id],
    );
    const quando = (v: unknown): Date | null =>
      v === null || v === undefined ? null : new Date(v as string | Date);
    const procDatados = cirurgias.map((x) => {
      const cid = textoOuNull(x['cid']);
      const texto = cid ? `${String(x['descricao'])} (${cid})` : String(x['descricao']);
      return { texto, em: quando(x['em']) };
    });
    const exDatados = exames
      .map((e) => ({ texto: String(e['nome']), em: quando(e['em']) }))
      .sort(
        (a, b) => a.texto.localeCompare(b.texto, 'pt-BR') || (a.em?.getTime() ?? 0) - (b.em?.getTime() ?? 0),
      );
    return {
      motivoInternacao: codigo ? `${codigo} - ${String(i['descricao'] ?? '')}`.trim() : null,
      procedimentos: [...new Set(procDatados.map((p) => p.texto))],
      exames: [...new Set(exDatados.map((e) => e.texto))],
      // F3.3 (L124): com o momento clínico, para a janela de cada seção do sumário.
      datados: { procedimentos: procDatados, exames: exDatados },
    };
  });
}

/**
 * O que os alertas de completude das linhas do painel precisam, de uma vez: a última evolução médica (CBO 225*) não
 * suspensa por atendimento, o último registro de alergia e o último "nega alergias" por paciente, as ciências de
 * resultado crítico e os pareceres abertos (solicitado ou aceito). `valores` (resultados de laboratório) é da família
 * de exames: vazio aqui (o serviço não marca crítico sem valor; nunca inventa).
 */
export function completudePainel(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  pacientes: readonly number[],
  atendimentos: readonly number[],
  desde: Date,
): Promise<CompletudePainelLida> {
  const ps = idsValidos(pacientes);
  const ats = idsValidos(atendimentos);
  const vazio: CompletudePainelLida = {
    evolucoesMedicas: [],
    alergiasInformadas: [],
    negas: [],
    valores: [],
    ciencias: [],
    pareceres: [],
  };
  // `desde` recorta os valores de resultado (família de exames); data inválida recusa (falha fechada).
  if (Number.isNaN(desde.getTime()))
    return Promise.reject(recusar(400, 'entrada-invalida', 'A data inicial é inválida.'));
  if (ps.length === 0 && ats.length === 0) return Promise.resolve(vazio);
  return ler(nucleo, cliente, c, 'completude', async (l, est) => {
    const evol =
      ats.length === 0
        ? []
        : await l.consultar(
            `SELECT r.atendimento_id, MAX(r.data_hora_clinica) AS em
               FROM registro_assistencial r
               JOIN inscricao_conselho ic ON ic.profissional_id = r.autor_profissional_id AND ic.excluido_em IS NULL
               JOIN ocupacao_cbo o ON o.id = COALESCE(r.ocupacao_cbo_id, ic.ocupacao_cbo_id)
              WHERE r.estabelecimento_id = ? AND r.atendimento_id IN (${marcadores(ats.length)})
                AND r.excluido_em IS NULL AND r.suspenso_em IS NULL AND o.codigo_cbo LIKE '225%'
              GROUP BY r.atendimento_id`,
            [est.id, ...ats],
          );
    const porPac = ps.length === 0;
    const al = porPac
      ? []
      : await l.consultar(
          `SELECT paciente_id, (tipo_registro IN ('nega_alergias')) AS nega, MAX(registrado_em) AS em
             FROM alergia_paciente
            WHERE paciente_id IN (${marcadores(ps.length)}) AND excluido_em IS NULL
              AND tipo_registro IN ('alergia','intolerancia','nega_alergias')
            GROUP BY paciente_id, (tipo_registro IN ('nega_alergias'))`,
          ps,
        );
    const ci = porPac
      ? []
      : await l.consultar(
          `SELECT paciente_id, resultado_exame_id FROM ciencia_resultado_critico
            WHERE estabelecimento_id = ? AND paciente_id IN (${marcadores(ps.length)}) AND excluido_em IS NULL
              AND ciente_em IS NOT NULL`,
          [est.id, ...ps],
        );
    const pa = porPac
      ? []
      : await l.consultar(
          `SELECT paciente_id, situacao, prazo_em FROM interconsulta
            WHERE estabelecimento_id = ? AND paciente_id IN (${marcadores(ps.length)}) AND excluido_em IS NULL
              AND situacao IN ('solicitado','aceito')
            ORDER BY solicitado_em, id`,
          [est.id, ...ps],
        );
    const quando = (v: unknown) => dataHora(v, est.fuso) ?? '';
    return {
      evolucoesMedicas: evol.map((x) => ({ atendimento: num(x['atendimento_id']), em: quando(x['em']) })),
      alergiasInformadas: al
        .filter((x) => !Number(x['nega']))
        .map((x) => ({ paciente: num(x['paciente_id']), em: quando(x['em']) })),
      negas: al
        .filter((x) => Number(x['nega']))
        .map((x) => ({ paciente: num(x['paciente_id']), em: quando(x['em']) })),
      valores: [],
      ciencias: ci.map((x) => ({ paciente: num(x['paciente_id']), exame: num(x['resultado_exame_id']) })),
      pareceres: pa.map((x) => ({
        paciente: num(x['paciente_id']),
        situacao: String(x['situacao']) as FluxoLido['situacao'],
        prazo: dataHora(x['prazo_em'], est.fuso),
      })),
    };
  });
}

/**
 * As preferências do painel do login no estabelecimento: o filtro padrão (a unidade) e as colunas dele (exibir e
 * ordem); sem filtro padrão, as colunas avulsas do usuário. Sem conta ou sem preferência: unidade nula, sem campos.
 */
export function preferenciasPainel(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  login: string,
): Promise<{ unidade: number | null; campos: { campo: string; exibir: boolean; ordem: number | null }[] }> {
  return ler(nucleo, cliente, c, 'preferencias', async (l, est) => {
    const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [login]);
    if (!u) return { unidade: null, campos: [] };
    const filtro = await l.uma(
      `SELECT f.id, COALESCE(f.unidade_assistencial_id, ui.unidade_assistencial_id) AS unidade
         FROM painel_filtro_usuario f LEFT JOIN unidade_internacao ui ON ui.id = f.unidade_internacao_id
        WHERE f.usuario_id = ? AND f.estabelecimento_id = ? ORDER BY f.padrao DESC, f.id LIMIT 1`,
      [u['id'], est.id],
    );
    const campos = await l.consultar(
      `SELECT coluna, exibir, ordem FROM painel_coluna_usuario
        WHERE usuario_id = ? AND ${filtro ? 'painel_filtro_usuario_id = ?' : 'painel_filtro_usuario_id IS NULL'}
        ORDER BY ordem, id`,
      filtro ? [u['id'], filtro['id']] : [u['id']],
    );
    return {
      unidade: filtro ? numOuNull(filtro['unidade']) : null,
      campos: campos.map((x) => ({
        campo: String(x['coluna']),
        exibir: Boolean(Number(x['exibir'])),
        ordem: numOuNull(x['ordem']),
      })),
    };
  });
}

// ── Receitas, atestados e exames externos ────────────────────────────────────────────────────────

function tituloDaReceita(x: Record<string, unknown>): string {
  if (Number(x['controle_especial'])) return 'Receita de controle especial';
  if (Number(x['antimicrobiano'])) return 'Receita de antimicrobiano';
  return 'Receita simples';
}

const TITULO_ATESTADO: Readonly<Record<string, string>> = {
  atestado: 'Atestado',
  declaracao: 'Declaração',
  requerimento: 'Requerimento',
  declaracao_comparecimento: 'Declaração de comparecimento',
  declaracao_acompanhante: 'Declaração de acompanhante',
};

const SQL_RECEITA = `
  SELECT x.id, x.estabelecimento_id, x.paciente_id, x.atendimento_id, x.emitida_em, x.situacao, x.suspensa_em,
         x.justificativa_suspensao, x.conteudo, x.orientacoes, x.origem_receita_medica_id, t.controle_especial,
         t.antimicrobiano,
         pf.nome AS profissional, ${SQL_CBO_DO_PROFISSIONAL('x.prescritor_profissional_id')} AS cbo
    FROM receita_medica x
    JOIN tipo_receita t ON t.id = x.tipo_receita_id
    LEFT JOIN profissional p ON p.id = x.prescritor_profissional_id
    LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
   WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL AND x.situacao <> 'rascunho'`;

const SQL_ATESTADO = `
  SELECT x.id, x.estabelecimento_id, x.paciente_id, x.atendimento_id, x.tipo, x.emitido_em, x.situacao,
         x.suspenso_em, x.justificativa_suspensao, x.texto, x.corrige_documento_emitido_id, m.titulo AS modelo,
         pf.nome AS profissional, ${SQL_CBO_DO_PROFISSIONAL('x.profissional_id')} AS cbo
    FROM documento_emitido x
    LEFT JOIN modelo_documento_clinico m ON m.id = x.modelo_documento_clinico_id
    LEFT JOIN profissional p ON p.id = x.profissional_id
    LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
   WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL`;

function receitaLida(x: Record<string, unknown>, fuso: string): DocumentoHistoricoLido {
  return {
    tipo: 'receita',
    id: num(x['id']),
    titulo: tituloDaReceita(x),
    emitidoEm: dataHora(x['emitida_em'], fuso),
    profissional: textoOuNull(x['profissional']),
    cbo: textoOuNull(x['cbo']),
    paciente: num(x['paciente_id']),
    atendimento: numOuNull(x['atendimento_id']),
    suspensoEm: dataHora(x['suspensa_em'], fuso),
    justificativaSuspensao: textoOuNull(x['justificativa_suspensao']),
    // O documento emitido e gravado (C2-021: já nas vias do receituário); a receita sem ele mostra as orientações.
    rtf: textoOuNull(x['conteudo']) ?? textoOuNull(x['orientacoes']),
    xml: null,
    retratos: { htPaciente: num(x['paciente_id']), htAtendimento: num(x['atendimento_id']) },
    modelo: null,
    corrige: numOuNull(x['origem_receita_medica_id']),
  };
}

function atestadoLido(x: Record<string, unknown>, fuso: string): DocumentoHistoricoLido {
  const modelo = textoOuNull(x['modelo']);
  return {
    tipo: 'atestado',
    id: num(x['id']),
    titulo: modelo ?? TITULO_ATESTADO[String(x['tipo'])] ?? 'Atestado',
    emitidoEm: dataHora(x['emitido_em'], fuso),
    profissional: textoOuNull(x['profissional']),
    cbo: textoOuNull(x['cbo']),
    paciente: num(x['paciente_id']),
    atendimento: numOuNull(x['atendimento_id']),
    suspensoEm: dataHora(x['suspenso_em'], fuso),
    justificativaSuspensao: textoOuNull(x['justificativa_suspensao']),
    rtf: null,
    xml: textoOuNull(x['texto']),
    retratos: { htPaciente: num(x['paciente_id']), htAtendimento: num(x['atendimento_id']) },
    modelo,
    corrige: numOuNull(x['corrige_documento_emitido_id']),
  };
}

export function lerReceita(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  id: number,
): Promise<DocumentoHistoricoLido | null> {
  if (!valido(id)) return Promise.resolve(null);
  return ler(nucleo, cliente, c, 'receita', async (l, est) => {
    // Registro clínico emitido: serve o documento gravado na emissão, sem remontar dos itens (C2-021).
    const x = await l.uma(`${SQL_RECEITA} AND x.id = ?`, [est.id, id]);
    return x ? receitaLida(x, est.fuso) : null;
  });
}

export function lerAtestado(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  id: number,
): Promise<DocumentoHistoricoLido | null> {
  if (!valido(id)) return Promise.resolve(null);
  return ler(nucleo, cliente, c, 'atestado', async (l, est) => {
    const x = await l.uma(`${SQL_ATESTADO} AND x.id = ?`, [est.id, id]);
    return x ? atestadoLido(x, est.fuso) : null;
  });
}

export function lerExameExterno(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  id: number,
): Promise<(DocumentoHistoricoLido & { elementos: { elemento: string; tipo: string }[] }) | null> {
  if (!valido(id)) return Promise.resolve(null);
  return ler(nucleo, cliente, c, 'exame-externo', async (l, est) => {
    const x = await l.uma(
      `SELECT x.id, x.paciente_id, x.atendimento_id, x.nome_exame, x.realizado_em, x.resultado, x.suspenso_em,
              x.motivo_suspensao, pf.nome AS profissional,
              COALESCE(oc.codigo_cbo, ${SQL_CBO_DO_PROFISSIONAL('x.profissional_id')}) AS cbo
         FROM exame_lancado_prontuario x
         LEFT JOIN ocupacao_cbo oc ON oc.id = x.ocupacao_cbo_id
         LEFT JOIN profissional p ON p.id = x.profissional_id
         LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
        WHERE x.id = ? AND x.estabelecimento_id = ? AND x.excluido_em IS NULL`,
      [id, est.id],
    );
    if (!x) return null;
    const vs = await l.consultar(
      `SELECT elemento, tipo_resultado FROM exame_lancado_valor
        WHERE exame_lancado_prontuario_id = ? AND excluido_em IS NULL ORDER BY sequencia, id`,
      [id],
    );
    const atendimento = numOuNull(x['atendimento_id']);
    return {
      tipo: 'exame-externo',
      id: num(x['id']),
      titulo: textoOuNull(x['nome_exame']) ?? 'Exame externo',
      emitidoEm: dataHora(x['realizado_em'], est.fuso),
      profissional: textoOuNull(x['profissional']),
      cbo: textoOuNull(x['cbo']),
      paciente: num(x['paciente_id']),
      atendimento,
      suspensoEm: dataHora(x['suspenso_em'], est.fuso),
      justificativaSuspensao: textoOuNull(x['motivo_suspensao']),
      rtf: null,
      xml: textoOuNull(x['resultado']),
      retratos:
        atendimento === null ? null : { htPaciente: num(x['paciente_id']), htAtendimento: atendimento },
      modelo: null,
      corrige: null,
      elementos: vs.map((v) => ({ elemento: String(v['elemento']), tipo: String(v['tipo_resultado']) })),
    };
  });
}

/**
 * O documento da trilha pelo tipo de ato e a origem: no banco próprio não há documento de trilha à parte (a prova é o
 * documento do prontuário, lido por documentoSghDaOrigem). Igual à memória: null.
 */
export function documentoDaTrilha(): Promise<{ id: number; situacao: number; xml: string } | null> {
  return Promise.resolve(null);
}

/** Receitas ou atestados do paciente no estabelecimento, do mais recente ao mais antigo. */
export function documentos(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  paciente: number,
  familia: 'receita' | 'atestado',
): Promise<DocumentoResumoLido[]> {
  if (!valido(paciente)) return Promise.resolve([]);
  return ler(nucleo, cliente, c, `lista-${familia}`, async (l, est) => {
    const receita = familia === 'receita';
    const ls = await l.consultar(
      `${receita ? SQL_RECEITA : SQL_ATESTADO} AND x.paciente_id = ?
        ORDER BY ${receita ? 'x.emitida_em' : 'x.emitido_em'} DESC, x.id DESC LIMIT ${TETO_LISTA}`,
      [est.id, paciente],
    );
    return ls.map((x) => {
      const d = receita ? receitaLida(x, est.fuso) : atestadoLido(x, est.fuso);
      return {
        id: d.id,
        familia,
        titulo: d.titulo,
        em: d.emitidoEm,
        profissional: d.profissional,
        atendimento: d.atendimento,
        suspenso: String(x['situacao']) !== (receita ? 'emitida' : 'valido'),
        corrige: d.corrige,
        // Tipo próprio pela classe gravada (C2-021: o antimicrobiano não vira receita simples na lista).
        tipo: receita
          ? TIPO_DOCUMENTO_DA_RECEITA[
              tipoDaClasse({ controleEspecial: x['controle_especial'], antimicrobiano: x['antimicrobiano'] })
            ]
          : null,
        tpPadrao: receita
          ? Number(x['controle_especial'])
            ? TP_PADRAO_CONTROLADA
            : TP_PADRAO_SIMPLES
          : null,
      };
    });
  });
}

// ── Fichas, modelos e cabeçalho ──────────────────────────────────────────────────────────────────

/** Componentes da ficha: `conteudo.componentes` [{nome, modelo}]; sem eles, o modelo de documento ligado. */
export function componentesDaFicha(conteudo: unknown, modelo: string | null): FichaImpressao['componentes'] {
  const j = jsonDe(conteudo);
  const cs = j && typeof j === 'object' ? (j as Record<string, unknown>)['componentes'] : null;
  if (Array.isArray(cs))
    return cs
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .filter((x) => typeof x['nome'] === 'string' && x['nome'] !== '')
      .map((x) => ({
        nome: String(x['nome']),
        modelo: typeof x['modelo'] === 'string' ? x['modelo'] : null,
      }));
  return modelo ? [{ nome: modelo, modelo }] : [];
}

/** As fichas (modelos de impressão clínica) ativas, por nome. */
export function fichas(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
): Promise<FichaImpressao[]> {
  return ler(nucleo, cliente, c, 'fichas', async (l) => {
    const ls = await l.consultar(
      `SELECT f.id, f.nome, f.tipo_modelo_impressao_id, f.conteudo, m.titulo AS modelo
         FROM modelo_impressao_clinica f
         LEFT JOIN modelo_documento_clinico m ON m.id = f.modelo_documento_clinico_id
        WHERE f.ativo = TRUE ORDER BY f.nome, f.id LIMIT ${TETO_LISTA}`,
    );
    return ls.map((x) => ({
      codigo: num(x['id']),
      nome: String(x['nome']),
      tipo: numOuNull(x['tipo_modelo_impressao_id']),
      componentes: componentesDaFicha(x['conteudo'], textoOuNull(x['modelo'])),
    }));
  });
}

/** Modelos de registro em uso no estabelecimento desde a data (AAAA-MM-DD), do mais usado ao menos. */
export function modelosEmUso(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  desde: string,
): Promise<{ nome: string; usos: number }[]> {
  if (!/^\d{4}-\d{2}-\d{2}/.test(desde))
    return Promise.reject(recusar(400, 'entrada-invalida', 'A data inicial é inválida.'));
  return ler(nucleo, cliente, c, 'modelos-em-uso', async (l, est) => {
    const ls = await l.consultar(
      `SELECT m.titulo AS nome, COUNT(*) AS usos
         FROM registro_assistencial r JOIN modelo_documento_clinico m ON m.id = r.modelo_documento_clinico_id
        WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.data_hora_lancamento >= ?
        GROUP BY m.id, m.titulo ORDER BY usos DESC, m.titulo LIMIT 200`,
      [est.id, desde.slice(0, 10)],
    );
    return ls.map((x) => ({ nome: String(x['nome']), usos: num(x['usos']) }));
  });
}

/**
 * O cabeçalho do documento: o estabelecimento, o paciente (retrato = id vigente), o atendimento e o profissional da
 * inscrição no conselho (cbo = id da inscrição), com o tipo de assinatura e a situação pedidos.
 */
export function cabecalhoDocumento(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  retratos: { readonly htPaciente: number; readonly htAtendimento: number },
  cbo: number,
  situacao: number,
  tipoAto: number,
): Promise<CabecalhoDocumentoLido> {
  return ler(nucleo, cliente, c, 'cabecalho', async (l, est) => {
    const pac = await l.uma(
      `SELECT p.id, pf.nome, p.numero_prontuario FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
        WHERE p.id = ? AND p.excluido_em IS NULL`,
      [retratos.htPaciente],
    );
    const at = await l.uma(
      'SELECT id, numero FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [retratos.htAtendimento, est.id],
    );
    const prof = await l.uma(
      `SELECT pf.nome, i.numero_inscricao, o.codigo_cbo FROM inscricao_conselho i
         JOIN profissional p ON p.id = i.profissional_id
         JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
         LEFT JOIN ocupacao_cbo o ON o.id = i.ocupacao_cbo_id
        WHERE i.id = ? AND i.excluido_em IS NULL`,
      [cbo],
    );
    return {
      hospital: [['nome', est.nome]],
      paciente: pac
        ? [
            ['id', num(pac['id'])],
            ['nome', String(pac['nome'])],
            ['prontuario', num(pac['numero_prontuario'])],
          ]
        : [['id', retratos.htPaciente]],
      atendimento: at
        ? [
            ['id', num(at['id'])],
            ['numero', String(at['numero'])],
          ]
        : [['id', retratos.htAtendimento]],
      profissional: prof
        ? [
            ['id_tbcbopro', cbo],
            ['nome', String(prof['nome'])],
            ['inscricao', String(prof['numero_inscricao'])],
            ['cbo', textoOuNull(prof['codigo_cbo']) ?? ''],
          ]
        : [['id_tbcbopro', cbo]],
      tipoAssinatura: String(tipoAto),
      situacao: String(situacao),
    } as CabecalhoDocumentoLido;
  });
}

// ── Tempos e pareceres ───────────────────────────────────────────────────────────────────────────

/** Os tempos (marcos) válidos dos atendimentos do paciente no estabelecimento, em ordem de ocorrência. */
export function tempos(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  paciente: number,
): Promise<
  {
    id: number;
    quando: string | null;
    situacao: string | null;
    profissional: string | null;
    gravadoEm: string | null;
  }[]
> {
  if (!valido(paciente)) return Promise.resolve([]);
  return ler(nucleo, cliente, c, 'tempos', async (l, est) => {
    const ls = await l.consultar(
      `SELECT r.id, r.ocorrido_em, t.descricao, pf.nome AS profissional, r.registrado_em
         FROM registro_tempo_evento r
         JOIN tipo_evento_tempo t ON t.id = r.tipo_evento_tempo_id
         LEFT JOIN profissional p ON p.id = r.profissional_id
         LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
        WHERE r.paciente_id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.situacao = 'valido'
        ORDER BY r.ocorrido_em, r.id LIMIT ${TETO_LISTA}`,
      [paciente, est.id],
    );
    return ls.map((x) => ({
      id: num(x['id']),
      quando: dataHora(x['ocorrido_em'], est.fuso),
      situacao: textoOuNull(x['descricao']),
      profissional: textoOuNull(x['profissional']),
      gravadoEm: dataHora(x['registrado_em'], est.fuso),
    }));
  });
}

const SQL_FLUXO = `
  SELECT x.id, x.paciente_id, x.atendimento_id, x.pedido_registro_assistencial_id, x.especialidade_medica_id,
         x.categoria_assistencial, x.prioridade, x.prazo_em, x.situacao, x.origem, x.solicitado_em,
         (SELECT rs.registro_assistencial_id FROM interconsulta_resposta rs
           WHERE rs.interconsulta_id = x.id AND rs.excluido_em IS NULL ORDER BY rs.sequencia DESC, rs.id DESC LIMIT 1)
           AS resposta,
         COALESCE((SELECT u.login FROM usuario u WHERE u.id = x.criado_por),
                  ${SQL_LOGIN_DO_PROFISSIONAL('x.solicitante_profissional_id')}) AS solicitante,
         ${SQL_LOGIN_DO_PROFISSIONAL('x.aceito_por_profissional_id')} AS aceito_por
    FROM interconsulta x
   WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL`;

function fluxoLido(x: Record<string, unknown>, fuso: string): FluxoLido {
  return {
    id: num(x['id']),
    tipo: 'parecer',
    paciente: num(x['paciente_id']),
    atendimento: numOuNull(x['atendimento_id']),
    pedido: numOuNull(x['pedido_registro_assistencial_id']),
    resposta: numOuNull(x['resposta']),
    especialidade: numOuNull(x['especialidade_medica_id']),
    categoria: textoOuNull(x['categoria_assistencial']),
    prioridade: String(x['prioridade']) as FluxoLido['prioridade'],
    prazo: dataHora(x['prazo_em'], fuso),
    situacao: String(x['situacao']) as FluxoLido['situacao'],
    // Vindo de importação (continuidade): "legado"; criado no produto: "novo".
    origem: String(x['origem']) === 'sistema' ? 'novo' : 'legado',
    solicitante: textoOuNull(x['solicitante']) ?? '',
    aceitoPor: x['aceito_por'] === null || x['aceito_por'] === undefined ? null : String(x['aceito_por']),
    criadoEm: dataHora(x['solicitado_em'], fuso) ?? '',
  };
}

/** A fila de pareceres do estabelecimento com os filtros pedidos (todos opcionais), em ordem de pedido. */
export function fila(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  f: { especialidade?: number; categoria?: string; situacao?: string; paciente?: number },
): Promise<FluxoLido[]> {
  return ler(nucleo, cliente, c, 'fila', async (l, est) => {
    const filtros: string[] = [];
    const p: unknown[] = [est.id];
    if (f.especialidade !== undefined) {
      filtros.push('x.especialidade_medica_id = ?');
      p.push(f.especialidade);
    }
    if (f.categoria !== undefined) {
      filtros.push('x.categoria_assistencial = ?');
      p.push(f.categoria);
    }
    if (f.situacao !== undefined) {
      filtros.push('x.situacao = ?');
      p.push(f.situacao);
    }
    if (f.paciente !== undefined) {
      filtros.push('x.paciente_id = ?');
      p.push(f.paciente);
    }
    const ls = await l.consultar(
      `${SQL_FLUXO} ${filtros.map((x) => `AND ${x}`).join(' ')} ORDER BY x.solicitado_em, x.id LIMIT ${TETO_LISTA}`,
      p,
    );
    return ls.map((x) => fluxoLido(x, est.fuso));
  });
}

export function fluxo(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  id: number,
): Promise<FluxoLido | null> {
  if (!valido(id)) return Promise.resolve(null);
  return ler(nucleo, cliente, c, 'fluxo', async (l, est) => {
    const x = await l.uma(`${SQL_FLUXO} AND x.id = ?`, [est.id, id]);
    return x ? fluxoLido(x, est.fuso) : null;
  });
}

// ── Liberação da gravação e despacho do executor ─────────────────────────────────────────────────

/** Operações que o executor desta família grava no banco próprio. */
export const OPERACOES_PAINEL: readonly string[] = ['pep.suspenderDocumento'];

/**
 * Passo 0 do executor (como a memória): a operação sem adaptador no
 * banco próprio (fora de `disponiveis`) recusa com `pendente-modelo-proprio`; o login precisa de profissional com
 * vínculo vigente no estabelecimento e inscrição ativa no conselho. Nada é gravado.
 */
export function podeGravar(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  c: ContextoDocs,
  operacao: string,
  login: string,
  disponiveis: readonly string[] = OPERACOES_PAINEL,
): Promise<LiberacaoConsultada> {
  if (!disponiveis.includes(operacao))
    return Promise.resolve({
      pode: false,
      codigo: 'pendente-modelo-proprio',
      motivo: `A gravação "${operacao}" ainda não tem adaptador no banco próprio.`,
    });
  return ler(nucleo, cliente, c, 'pode-gravar', async (l, est) => {
    const u = login ? await l.uma(SQL_PROFISSIONAL_DO_LOGIN, [est.id, login]) : null;
    if (!u || u['profissional'] === null || u['profissional'] === undefined)
      return {
        pode: false,
        codigo: 'sem-profissional',
        motivo: 'A conta da sessão não tem vínculo de profissional vigente neste estabelecimento.',
      };
    const i = await l.uma(
      `SELECT COUNT(*) AS n FROM inscricao_conselho
        WHERE profissional_id = ? AND excluido_em IS NULL AND situacao IN ('ativa','provisoria')`,
      [u['profissional']],
    );
    if (!Number(i?.['n'] ?? 0))
      return {
        pode: false,
        codigo: 'sem-conselho-ativo',
        motivo: 'O profissional da sessão não tem inscrição ativa no conselho.',
      };
    return { pode: true, codigo: null, motivo: null };
  });
}

/** Gravação de outra família, registrada pelo integrador (mesma assinatura de `executar`). */
export type GravacaoDocumentos = (
  c: ContextoDocs,
  entrada: unknown,
  ctx: ContextoOperacao,
) => Promise<Record<string, unknown>>;

function entradaValida<T>(esq: z.ZodType<T>, entrada: unknown): T {
  const r = esq.safeParse(entrada);
  if (!r.success)
    throw new ErroOperacao(400, 'entrada-invalida', 'Entrada inválida', 'Confira os campos indicados.', {
      campos: r.error.issues.map((i) => i.path.map(String).join('.')),
    });
  return r.data;
}

/**
 * Suspende a receita ou o atestado (com o motivo), como a memória: o profissional da sessão com a inscrição (cbo)
 * dele, o documento do paciente no estabelecimento e ainda válido. Grava a situação, quem, quando e o motivo (nova
 * versão da linha, `alterar` com a versão lida), a versão do documento emitido (atestado) e a trilha do executor.
 */
export async function suspenderDocumento(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  executor: Executor,
  c: ContextoDocs,
  entrada: unknown,
  ctx: ContextoOperacao,
): Promise<Record<string, unknown>> {
  const x = entradaValida(esquemaSuspensaoDocumento, entrada);
  const banco = c.cliente || cliente;
  const est = await ler(nucleo, cliente, c, 'suspender-identidade', async (_l, e) => e);
  const receita = x.familia === 'receita';
  const tabela = receita ? 'receita_medica' : 'documento_emitido';
  const contexto: ContextoOperacao = { ...ctx, cliente: banco, estabelecimento: est.id };
  const op = definirOperacao({
    nome: 'pep.documentos.suspender',
    tabelas: receita ? ['receita_medica'] : ['documento_emitido', 'documento_emitido_versao'],
    entrada: z.object({}).passthrough(),
    gravar: async (tx: TxOperacao) => {
      const prof = await tx.uma(
        `SELECT i.profissional_id FROM inscricao_conselho i
           JOIN usuario_vinculo_profissional v ON v.profissional_id = i.profissional_id AND v.usuario_id = ?
                AND v.estabelecimento_id = ? AND v.excluido_em IS NULL AND v.vigencia_inicio <= CURRENT_DATE
                AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
          WHERE i.id = ? AND i.excluido_em IS NULL AND i.situacao IN ('ativa','provisoria') LIMIT 1`,
        [tx.contexto.usuario, est.id, x.cbo],
      );
      if (!prof)
        throw recusar(
          403,
          'cbo-de-outro-profissional',
          'A inscrição informada não é do profissional da sessão.',
        );
      const d = (
        await tx.consultarParaAtualizar(
          `SELECT id, versao, situacao FROM ${tabela}
            WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [x.origem, x.paciente, est.id],
        )
      )[0];
      if (!d)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Documento não encontrado',
          'O documento não é deste paciente.',
        );
      if (String(d['situacao']) !== (receita ? 'emitida' : 'valido'))
        throw new ErroOperacao(422, 'ja-suspenso', 'Já suspenso', 'O documento já foi suspenso.');
      const agora = new Date();
      await tx.alterar(
        tabela,
        num(d['id']),
        num(d['versao']),
        receita
          ? {
              situacao: 'suspensa',
              suspensa_em: agora,
              suspensa_por_profissional_id: num(prof['profissional_id']),
              justificativa_suspensao: x.justificativa,
            }
          : {
              situacao: 'suspenso',
              suspenso_em: agora,
              suspenso_por_profissional_id: num(prof['profissional_id']),
              justificativa_suspensao: x.justificativa,
            },
      );
      if (!receita)
        await tx.incluir('documento_emitido_versao', {
          documento_emitido_id: num(d['id']),
          operacao: 'alteracao',
          acao: 'suspensao',
          motivo: x.justificativa,
          ocorrido_em: agora,
          usuario_id: tx.contexto.usuario,
        });
      return { tabela, id: num(d['id']) };
    },
    alvo: (_e, s) => ({ tabela: String(s['tabela']), id: Number(s['id']) }),
    trilha: () => ({
      motivo: x.justificativa,
      dados: { evento: 'pep.documento.suspenso', familia: x.familia, origem: x.origem, paciente: x.paciente },
    }),
  });
  await executor.executar(op, banco, {}, contexto);
  return { origem: x.origem, trilha: null };
}

/**
 * Despacho das gravações pelo executor: as desta família e as que o integrador registrar em `outras` (de outras
 * famílias, mesma assinatura). Operação sem adaptador: 501 `pendente-modelo-proprio` (falha fechada, nada gravado).
 */
export function executar(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  executor: Executor,
  c: ContextoDocs,
  operacao: string,
  entrada: unknown,
  ctx: ContextoOperacao,
  outras: Readonly<Record<string, GravacaoDocumentos>> = {},
): Promise<Record<string, unknown>> {
  if (operacao === 'pep.suspenderDocumento')
    return suspenderDocumento(nucleo, cliente, executor, c, entrada, ctx);
  const outra = Object.hasOwn(outras, operacao) ? outras[operacao] : undefined;
  if (outra) return outra(c, entrada, ctx);
  return Promise.reject(recusaPendente(operacao));
}
