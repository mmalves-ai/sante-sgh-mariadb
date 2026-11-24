// Complemento Q3 da porta PRÓPRIA da gestão da qualidade (modulos-proprios-3, família qualidade-q3): a revisão de
// prontuários pela comissão, no terceiro quarto (ordem alfabética) dos métodos que ainda falhavam fechados. Classe
// auxiliar: a porta própria completa delega a ela (a ligação fica com o integrador). Mesmo contrato da porta de memória.
// Mapeamento para o modelo próprio:
// - Checklist da revisão: um modelo_checklist_qualidade por comissão (código `revisao_prontuario_<comissão>`, finalidade
//   revisao_prontuario); cada publicação é uma modelo_checklist_qualidade_versao (o id do checklist no contrato é o id
//   da versão; a revisão é o numero_versao) com os itens em modelo_checklist_qualidade_item (código estável do item,
//   migração 18_QUA/99, e o título no enunciado). A versão vigente passa a substituída (com o fim da vigência) na mesma
//   transação; publicar sem citar a vigente quando há uma recusa (versão desatualizada), nunca duas vigentes.
// - Prontuário da amostra: revisao_prontuario do sorteio. A ordem é a posição pela chave dentro do sorteio; a situação
//   do contrato sai do modelo (sem data de revisão: aRevisar; depois, o resultado: conforme ou naoConforme); as
//   respostas são as linhas de revisao_prontuario_item (código do item, resultado e observação) em JSON, na ordem da
//   sequência; a alta, a clínica (especialidade) e o médico assistente vêm da internação do atendimento.
// - Pendência da revisão: pendencia_prontuario apontada pelo item da revisão (revisao_prontuario_item.
//   pendencia_prontuario_id). A situação do contrato: aberta (aberta ou em resolução), resolvida (resolvida ou
//   justificada) e cancelada. O modelo não tem colunas próprias do cancelamento: na pendência cancelada, quem e quando
//   ficam em resolvida_por_usuario_id e resolvida_em, e o motivo em resolucao (convenção da gravação do cancelamento).
//   O login do profissional é o da conta vigente ligada a ele (usuario_profissional).
// - Responder a pendência: só a aberta, travada e conferida pela versão; grava a resposta, quem e quando.
import { recusa, type TxOperacao } from '@sgh/nucleo';
import type { L, Linha, NucleoQualidade } from './apoio-propria.js';
import {
  dataIso,
  exigirUsuario,
  instanteN,
  instante,
  json,
  lerNoEstabelecimento,
  marcas,
  n,
  nn,
  paraBanco,
  texto,
  textoN,
} from './apoio-propria.js';
import type { ContextoGestao, GravadorGestao } from './porta-gestao.js';
import {
  type PendenciaRevisaoRegistrada,
  type ProntuarioRevisaoRegistrado,
  type PublicacaoChecklist,
  recusaVersaoGestao,
} from './tipos.js';

/** Os métodos da porta da gestão que este complemento cobre (a ligação na porta completa é do integrador). */
export const METODOS_COMPLEMENTO_Q3 = [
  'pendenciaRevisao',
  'pendenciasDoLogin',
  'pendenciasDosProntuarios',
  'prontuarioRevisao',
  'prontuariosDoSorteio',
  'publicarChecklistRevisao',
  'responderPendenciaRevisao',
] as const;

/** As tabelas que as gravações deste complemento tocam (vão à lista da transação da gestão completa). */
export const TABELAS_COMPLEMENTO_Q3 = [
  'modelo_checklist_qualidade',
  'modelo_checklist_qualidade_versao',
  'modelo_checklist_qualidade_item',
  'pendencia_prontuario',
] as const;

/** Teto das pendências por login (abertas primeiro) e dos ids por consulta. */
export const TETO_PENDENCIAS = 2000;
const LOTE_IDS = 500;

/** O código do checklist da revisão de prontuários de uma comissão. */
export const codigoChecklistRevisao = (comissao: number): string => `revisao_prontuario_${comissao}`;

const RESULTADO_CONTRATO: Record<string, string> = {
  conforme: 'conforme',
  nao_conforme: 'naoConforme',
  nao_se_aplica: 'naoAplicavel',
};

// ── Prontuários da amostra ──────────────────────────────────────────────────────────────────────────────────────

const SQL_PRONTUARIO = `
  SELECT r.id, r.sorteio_revisao_prontuario_id AS sorteio, r.atendimento_id, r.paciente_id, r.resultado,
         r.situacao, r.observacao, r.revisada_em, r.avalizada_em, r.versao,
         ROW_NUMBER() OVER (PARTITION BY r.sorteio_revisao_prontuario_id ORDER BY r.id) AS ordem,
         COALESCE(i.data_hora_alta, i.data_hora_alta_medica) AS alta, em.descricao AS clinica,
         i.medico_assistente_profissional_id AS medico, pfm.nome AS medico_nome,
         ur.login AS revisor, ua.login AS aval_por
    FROM revisao_prontuario r
    LEFT JOIN internacao i ON i.id = r.internacao_id
    LEFT JOIN especialidade_medica em ON em.id = i.especialidade_medica_id
    LEFT JOIN profissional pm ON pm.id = i.medico_assistente_profissional_id
    LEFT JOIN pessoa_fisica pfm ON pfm.id = pm.pessoa_fisica_id
    JOIN usuario ur ON ur.id = r.revisor_usuario_id
    LEFT JOIN usuario ua ON ua.id = r.avalizada_por_usuario_id
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL`;

function situacaoProntuario(r: Linha): string {
  if (r['revisada_em'] === null || r['revisada_em'] === undefined) return 'aRevisar';
  return texto(r['resultado']) === 'nao_conforme' ? 'naoConforme' : 'conforme';
}

export function prontuario(r: Linha, respostas: string | null): ProntuarioRevisaoRegistrado {
  const revisado = r['revisada_em'] !== null && r['revisada_em'] !== undefined;
  return {
    id: n(r['id']),
    sorteio: n(r['sorteio']),
    ordem: n(r['ordem']),
    reg: n(r['atendimento_id']),
    paciente: nn(r['paciente_id']),
    alta: dataIso(r['alta']) ?? '',
    clinica: texto(r['clinica']),
    medicoRegistro: nn(r['medico']),
    medicoNome: textoN(r['medico_nome']),
    situacao: situacaoProntuario(r),
    respostas,
    observacao: textoN(r['observacao']),
    revisadoPor: revisado ? textoN(r['revisor']) : null,
    revisadoEm: revisado ? instanteN(r['revisada_em']) : null,
    avalPor: textoN(r['aval_por']),
    avalEm: instanteN(r['avalizada_em']),
    versao: n(r['versao']),
  };
}

/** As respostas de cada revisão (JSON do contrato: item, resultado e observação, na ordem da sequência). */
async function respostasDas(l: L, ids: readonly number[]): Promise<Map<number, string>> {
  const porRevisao = new Map<number, { item: string; resultado: string; observacao: string | null }[]>();
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const lote = ids.slice(i, i + LOTE_IDS);
    const linhas = await l.consultar(
      `SELECT ri.revisao_prontuario_id AS revisao, ri.sequencia, ri.resultado, ri.observacao,
              COALESCE(mi.codigo, CONCAT('item', ri.sequencia)) AS item
         FROM revisao_prontuario_item ri
         JOIN modelo_checklist_qualidade_item mi ON mi.id = ri.modelo_checklist_qualidade_item_id
        WHERE ri.revisao_prontuario_id IN (${marcas(lote.length)}) AND ri.excluido_em IS NULL
        ORDER BY ri.revisao_prontuario_id, ri.sequencia`,
      lote,
      { teto: lote.length * 60 + 1 },
    );
    for (const x of linhas) {
      const k = n(x['revisao']);
      const lista = porRevisao.get(k) ?? [];
      lista.push({
        item: texto(x['item']),
        resultado: RESULTADO_CONTRATO[texto(x['resultado'])] ?? texto(x['resultado']),
        observacao: textoN(x['observacao']),
      });
      porRevisao.set(k, lista);
    }
  }
  return new Map([...porRevisao].map(([k, v]) => [k, JSON.stringify(v)]));
}

async function prontuarios(l: L, linhas: Linha[]): Promise<ProntuarioRevisaoRegistrado[]> {
  const respostas = await respostasDas(
    l,
    linhas.map((r) => n(r['id'])),
  );
  return linhas.map((r) => prontuario(r, respostas.get(n(r['id'])) ?? null));
}

// ── Pendências da revisão ───────────────────────────────────────────────────────────────────────────────────────

const SQL_PENDENCIA = `
  SELECT p.id, ri.revisao_prontuario_id AS prontuario, p.atendimento_id,
         COALESCE(mi.codigo, CONCAT('item', ri.sequencia)) AS item, p.descricao,
         p.responsavel_profissional_id AS profissional, pfp.nome AS profissional_nome,
         (SELECT u.login FROM usuario_profissional up JOIN usuario u ON u.id = up.usuario_id
           WHERE up.profissional_id = p.responsavel_profissional_id AND up.vigencia_fim IS NULL
             AND up.excluido_em IS NULL
           ORDER BY up.id DESC LIMIT 1) AS profissional_login,
         p.prazo_em, p.situacao, p.resolucao, p.resolvida_em, ures.login AS resolvida_por, p.apontada_em, p.versao
    FROM pendencia_prontuario p
    JOIN revisao_prontuario_item ri ON ri.pendencia_prontuario_id = p.id AND ri.excluido_em IS NULL
    JOIN modelo_checklist_qualidade_item mi ON mi.id = ri.modelo_checklist_qualidade_item_id
    LEFT JOIN profissional pp ON pp.id = p.responsavel_profissional_id
    LEFT JOIN pessoa_fisica pfp ON pfp.id = pp.pessoa_fisica_id
    LEFT JOIN usuario ures ON ures.id = p.resolvida_por_usuario_id
   WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL`;

function situacaoPendencia(s: string): string {
  if (s === 'aberta' || s === 'em_resolucao') return 'aberta';
  if (s === 'resolvida' || s === 'justificada') return 'resolvida';
  return 'cancelada';
}

export function pendencia(r: Linha): PendenciaRevisaoRegistrada {
  const situacao = situacaoPendencia(texto(r['situacao']));
  const resolvida = situacao === 'resolvida';
  const cancelada = situacao === 'cancelada';
  return {
    id: n(r['id']),
    prontuario: n(r['prontuario']),
    reg: n(r['atendimento_id']),
    item: texto(r['item']),
    descricao: texto(r['descricao']),
    profissionalRegistro: nn(r['profissional']),
    profissionalLogin: textoN(r['profissional_login']),
    profissionalNome: textoN(r['profissional_nome']),
    prazo: dataIso(r['prazo_em']) ?? '',
    situacao,
    resposta: resolvida ? textoN(r['resolucao']) : null,
    resolvidaPor: resolvida ? textoN(r['resolvida_por']) : null,
    resolvidaEm: resolvida ? instanteN(r['resolvida_em']) : null,
    canceladaPor: cancelada ? textoN(r['resolvida_por']) : null,
    canceladaEm: cancelada ? instanteN(r['resolvida_em']) : null,
    motivoCancelamento: cancelada ? textoN(r['resolucao']) : null,
    criadaEm: instante(r['apontada_em']),
    versao: n(r['versao']),
  };
}

/** As leituras da revisão de prontuários (prontuários da amostra e pendências) no banco do cliente. */
export class LeiturasRevisaoComplementoQ3 {
  constructor(private readonly nucleo: NucleoQualidade) {}

  prontuariosDoSorteio(c: ContextoGestao, sorteio: number): Promise<ProntuarioRevisaoRegistrado[]> {
    return lerNoEstabelecimento(this.nucleo, c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT x.* FROM (${SQL_PRONTUARIO} AND r.sorteio_revisao_prontuario_id = ?) x ORDER BY x.ordem`,
        [est, sorteio],
        { teto: 65_536 },
      );
      return prontuarios(l, linhas);
    });
  }

  prontuarioRevisao(c: ContextoGestao, id: number): Promise<ProntuarioRevisaoRegistrado | null> {
    return lerNoEstabelecimento(this.nucleo, c, async (l, est) => {
      // A ordem é a posição dentro do sorteio: a janela corre sobre o sorteio inteiro, e o filtro vem depois.
      const r = await l.uma(
        `SELECT x.* FROM (${SQL_PRONTUARIO}
            AND r.sorteio_revisao_prontuario_id <=> (SELECT s.sorteio_revisao_prontuario_id FROM revisao_prontuario s
                                                      WHERE s.id = ?)) x
          WHERE x.id = ?`,
        [est, id, id],
      );
      return r ? ((await prontuarios(l, [r]))[0] ?? null) : null;
    });
  }

  pendenciasDosProntuarios(c: ContextoGestao, ids: readonly number[]): Promise<PendenciaRevisaoRegistrada[]> {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) return Promise.resolve([]);
    return lerNoEstabelecimento(this.nucleo, c, async (l, est) => {
      const todas: PendenciaRevisaoRegistrada[] = [];
      for (let i = 0; i < unicos.length; i += LOTE_IDS) {
        const lote = unicos.slice(i, i + LOTE_IDS);
        const linhas = await l.consultar(
          `${SQL_PENDENCIA} AND ri.revisao_prontuario_id IN (${marcas(lote.length)}) ORDER BY p.id`,
          [est, ...lote],
          { teto: lote.length * 60 + 1 },
        );
        todas.push(...linhas.map(pendencia));
      }
      return todas.sort((a, b) => a.id - b.id);
    });
  }

  pendenciaRevisao(c: ContextoGestao, id: number): Promise<PendenciaRevisaoRegistrada | null> {
    return lerNoEstabelecimento(this.nucleo, c, async (l, est) => {
      const r = await l.uma(`${SQL_PENDENCIA} AND p.id = ?`, [est, id]);
      return r ? pendencia(r) : null;
    });
  }

  /** As pendências do login (as abertas primeiro, pelo prazo e pela chave); o excedente do teto recusa, nunca corta. */
  pendenciasDoLogin(c: ContextoGestao, login: string): Promise<PendenciaRevisaoRegistrada[]> {
    return lerNoEstabelecimento(this.nucleo, c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT x.* FROM (${SQL_PENDENCIA}) x
          WHERE x.profissional_login = ?
          ORDER BY x.situacao NOT IN ('aberta', 'em_resolucao'), x.prazo_em, x.id
          LIMIT ${TETO_PENDENCIAS + 1}`,
        [est, login.trim()],
        { teto: TETO_PENDENCIAS + 1 },
      );
      if (linhas.length > TETO_PENDENCIAS)
        throw recusa(
          'pendencias-acima-do-teto',
          `O login tem mais de ${TETO_PENDENCIAS} pendências de revisão: a lista não cabe numa leitura.`,
        );
      return linhas.map(pendencia);
    });
  }
}

// ── Gravações ───────────────────────────────────────────────────────────────────────────────────────────────────

interface ItemPublicado {
  readonly codigo: string;
  readonly titulo: string;
}

async function publicarChecklistRevisao(
  tx: TxOperacao,
  est: number,
  p: Omit<PublicacaoChecklist, 'hospital'>,
): Promise<{ id: number; revisao: number }> {
  const usuario = await exigirUsuario(tx, p.usuario);
  const comissao = await tx.uma<{ id: number }>(
    'SELECT id FROM comissao_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [p.comissao, est],
  );
  if (!comissao)
    throw recusa('comissao-inexistente', 'A comissão não está cadastrada neste estabelecimento.');
  const itens = json<ItemPublicado[]>(p.itens, []);
  if (!Array.isArray(itens) || itens.length === 0)
    throw recusa('checklist-sem-itens', 'O checklist precisa de ao menos um item.');
  const agora = paraBanco(p.agora);
  const hoje = agora.slice(0, 10);
  const codigo = codigoChecklistRevisao(p.comissao);
  const modelo =
    (
      await tx.consultarParaAtualizar(
        'SELECT id FROM modelo_checklist_qualidade WHERE codigo = ?',
        [codigo],
        {
          teto: 1,
        },
      )
    )[0]?.['id'] ??
    (await tx.incluir('modelo_checklist_qualidade', {
      codigo,
      nome: `Revisão de prontuários da comissão ${p.comissao}`,
      finalidade: 'revisao_prontuario',
      situacao: 'publicado',
    }));
  const modeloId = n(modelo);
  const vigentes = await tx.consultarParaAtualizar(
    `SELECT id, versao FROM modelo_checklist_qualidade_versao
      WHERE modelo_checklist_qualidade_id = ? AND situacao = 'vigente'`,
    [modeloId],
    { teto: 10 },
  );
  // Nunca duas vigentes: a publicação cita a vigente (conferida pela versão) ou não pode haver nenhuma.
  if (p.vigente === null) {
    if (vigentes.length > 0) throw recusaVersaoGestao('O checklist');
  } else {
    const v = vigentes.find((x) => n(x['id']) === p.vigente?.id);
    if (!v || n(v['versao']) !== p.vigente.versao || vigentes.length !== 1)
      throw recusaVersaoGestao('O checklist');
    await tx.alterar('modelo_checklist_qualidade_versao', p.vigente.id, p.vigente.versao, {
      situacao: 'substituida',
      vigencia_fim: hoje,
      operacao: 'alteracao',
    });
  }
  const ultima = await tx.uma<{ ultima: number | null }>(
    'SELECT MAX(numero_versao) AS ultima FROM modelo_checklist_qualidade_versao WHERE modelo_checklist_qualidade_id = ?',
    [modeloId],
  );
  const revisao = n(ultima?.ultima) + 1;
  const id = await tx.incluir('modelo_checklist_qualidade_versao', {
    modelo_checklist_qualidade_id: modeloId,
    operacao: 'inclusao',
    dados: JSON.stringify({ comissao: p.comissao, itens }),
    ocorrido_em: agora,
    usuario_id: usuario,
    numero_versao: revisao,
    situacao: 'vigente',
    vigencia_inicio: hoje,
    motivo_publicacao: p.motivo ?? (revisao === 1 ? 'Primeira publicação.' : 'Nova revisão do checklist.'),
    publicado_em: agora,
    publicador_usuario_id: usuario,
  });
  let sequencia = 0;
  for (const item of itens) {
    sequencia += 1;
    await tx.incluir('modelo_checklist_qualidade_item', {
      modelo_checklist_qualidade_versao_id: id,
      sequencia,
      codigo: texto(item.codigo),
      enunciado: texto(item.titulo),
      tipo_resposta: 'conforme_nao_conforme',
    });
  }
  return { id, revisao };
}

async function responderPendenciaRevisao(
  tx: TxOperacao,
  est: number,
  p: Parameters<GravadorGestao['responderPendenciaRevisao']>[0],
): Promise<{ versao: number }> {
  const [r] = await tx.consultarParaAtualizar(
    `SELECT p.id, p.versao, p.situacao FROM pendencia_prontuario p
      WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
        AND EXISTS (SELECT 1 FROM revisao_prontuario_item ri WHERE ri.pendencia_prontuario_id = p.id)`,
    [p.id, est],
    { teto: 1 },
  );
  if (!r || n(r['versao']) !== p.versao || situacaoPendencia(texto(r['situacao'])) !== 'aberta')
    throw recusaVersaoGestao('A pendência');
  const usuario = await exigirUsuario(tx, p.usuario);
  const versao = await tx.alterar('pendencia_prontuario', p.id, p.versao, {
    situacao: 'resolvida',
    resolucao: p.resposta,
    resolvida_em: paraBanco(p.agora),
    resolvida_por_usuario_id: usuario,
  });
  return { versao };
}

/** As gravações deste complemento, para o gravador da gestão completa (a ligação é do integrador). */
export function gravacoesComplementoQ3(
  tx: TxOperacao,
  est: number,
): Pick<GravadorGestao, 'publicarChecklistRevisao' | 'responderPendenciaRevisao'> {
  return {
    publicarChecklistRevisao: (p) => publicarChecklistRevisao(tx, est, p),
    responderPendenciaRevisao: (p) => responderPendenciaRevisao(tx, est, p),
  };
}
