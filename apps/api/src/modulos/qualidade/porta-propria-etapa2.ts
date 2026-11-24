// Porta PRÓPRIA da segurança do paciente, etapa 2 (modulos-proprios-1, família qualidade-a), sobre o MariaDB do cliente:
// a análise da notificação (analise_incidente e as causas com o fator contribuinte), o plano de ação 5W2H
// (plano_acao_qualidade da notificação e acao_plano_qualidade), a vigilância de produto (queixa_tecnica_produto e a
// linha do tempo dela, queixa_tecnica_produto_evento) e a sugestão de notificação resolvida
// (sugestao_notificacao_resolvida, pelo resumo). As gravações rodam dentro da gravação direta da notificação
// (porta-propria.ts): mesma transação, trilha e conferência de versão; as leituras, no estabelecimento da sessão.
// Melhoria: a análise e as ações nunca são apagadas; o fator contribuinte retirado da análise é marcado como excluído
// (excluido_em), e a causa nova entra com a sequência seguinte.
// Melhoria: o plano de ação da notificação nasce na primeira ação, numerado pela mesma sequência anual dos planos da
// gestão (PA-AAAA-NNNNNN); o prazo do plano acompanha a ação de prazo mais longo, e a prorrogação da ação é contada.
// Melhoria: a queixa técnica aberta por outra tela (a ordem de serviço do equipamento, o conector) aparece na lista:
// a área vem do tipo do item quando não foi informada, e o tipo do registro vem da natureza.
import { ErroOperacao, recusa, type TxOperacao } from '@sgh/nucleo';
import {
  camelo,
  cobra,
  dataIso,
  exigirUsuario,
  instante,
  instanteN,
  type L,
  type Linha,
  marcas,
  n,
  nn,
  paraBanco,
  texto,
  textoN,
  verdadeiro,
} from './apoio-propria.js';
import type { GravadorQualidade } from './porta.js';
import type {
  AcaoPlanoRegistrada,
  AnaliseRegistrada,
  EventoNotificacaoNovo,
  EventoQueixaRegistrado,
  NotificacaoRegistrada,
  QueixaTecnicaRegistrada,
} from './tipos.js';

/** As tabelas que a etapa 2 grava (somadas às da notificação na transação). */
export const TABELAS_ETAPA2 = [
  'analise_incidente',
  'analise_incidente_causa',
  'plano_acao_qualidade',
  'acao_plano_qualidade',
  'queixa_tecnica_produto',
  'queixa_tecnica_produto_evento',
  'sugestao_notificacao_resolvida',
] as const;

const FATOR_DO_BANCO: Readonly<Record<string, string>> = { profissional: 'individuo', externo: 'institucional' };
const FATOR_PARA_BANCO: Readonly<Record<string, string>> = { individuo: 'profissional', institucional: 'externo' };

const versaoMudou = (o: string) => recusa('versao-desatualizada', `${o} mudou desde que você abriu a tela.`);
const naoEncontrado = (o: string) =>
  new ErroOperacao(404, 'nao-encontrado', `${o} não encontrado`, `${o} não existe neste estabelecimento.`);
const seg = (agora: string) => paraBanco(agora.length === 16 ? `${agora}:00` : agora);

// ── Análise ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A análise vigente da notificação (a última não cancelada), com os fatores contribuintes ativos. */
export async function lerAnalise(l: L, est: number, notificacao: number): Promise<AnaliseRegistrada | null> {
  const a = await l.uma(
    `SELECT a.id, a.notificacao_incidente_id, a.metodo, a.conteudo, a.causa_raiz, a.licoes_aprendidas,
            a.sem_acao_justificativa, a.situacao, a.versao, uc.login AS registrada_por, a.criado_em, a.alterado_em,
            a.concluida_em, ua.login AS alterada_por
       FROM analise_incidente a
       LEFT JOIN usuario uc ON uc.id = a.criado_por
       LEFT JOIN usuario ua ON ua.id = a.alterado_por
      WHERE a.notificacao_incidente_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL
        AND a.situacao <> 'cancelada'
      ORDER BY a.id DESC LIMIT 1`,
    [notificacao, est],
  );
  if (!a) return null;
  const fatores = await l.consultar(
    `SELECT DISTINCT f.categoria FROM analise_incidente_causa ca JOIN fator_contribuinte f ON f.id = ca.fator_contribuinte_id
      WHERE ca.analise_incidente_id = ? AND ca.excluido_em IS NULL ORDER BY f.categoria`,
    [a['id']],
    { teto: 100 },
  );
  const bruto = a['conteudo'];
  const concluida = texto(a['situacao']) === 'concluida';
  return {
    id: n(a['id']),
    notificacao: n(a['notificacao_incidente_id']),
    metodo: camelo(a['metodo']),
    conteudo:
      bruto === null || bruto === undefined ? '' : typeof bruto === 'string' ? bruto : JSON.stringify(bruto),
    causaRaiz: textoN(a['causa_raiz']),
    // O fator do contrato é a categoria do fator contribuinte (o profissional é o indivíduo; o externo, o institucional).
    fatores: fatores.map((f) => FATOR_DO_BANCO[texto(f['categoria'])] ?? texto(f['categoria'])),
    licoes: textoN(a['licoes_aprendidas']),
    semAcaoJustificativa: textoN(a['sem_acao_justificativa']),
    situacao: concluida ? 'concluida' : 'rascunho',
    versao: n(a['versao']),
    registradaPor: texto(a['registrada_por']),
    registradaEm: instante(a['criado_em']),
    atualizadaEm: instanteN(a['alterado_em']),
    concluidaEm: concluida ? instanteN(a['concluida_em']) : null,
    // A análise concluída não muda mais: quem a alterou por último é quem a concluiu.
    concluidaPor: concluida ? textoN(a['alterada_por']) : null,
  };
}

// ── Ações do plano ────────────────────────────────────────────────────────────────────────────────────────────────

export const SQL_ACAO = `
  SELECT ap.id, COALESCE(pa.notificacao_incidente_id, ai.notificacao_incidente_id) AS notificacao, ap.sequencia, ap.o_que,
         ap.por_que, ap.onde, ap.prazo, ru.login AS quem, ap.como, ap.quanto_descricao, ap.situacao, ap.evidencia_execucao,
         ap.concluida_em, ap.eficacia, ap.eficacia_descricao, ap.eficacia_verificada_em, ue.login AS eficacia_por,
         ap.versao, uc.login AS criada_por, ap.criado_em
    FROM acao_plano_qualidade ap
    JOIN plano_acao_qualidade pa ON pa.id = ap.plano_acao_qualidade_id AND pa.excluido_em IS NULL
    LEFT JOIN analise_incidente ai ON ai.id = pa.analise_incidente_id
    LEFT JOIN usuario ru ON ru.id = ap.responsavel_usuario_id
    LEFT JOIN usuario ue ON ue.id = ap.eficacia_verificador_usuario_id
    LEFT JOIN usuario uc ON uc.id = ap.criado_por
   WHERE pa.estabelecimento_id = ? AND ap.excluido_em IS NULL`;

export function acaoPlano(r: Linha): AcaoPlanoRegistrada {
  return {
    id: n(r['id']),
    notificacao: n(r['notificacao']),
    sequencia: n(r['sequencia']),
    oQue: texto(r['o_que']),
    porQue: texto(r['por_que']),
    onde: texto(r['onde']),
    quando: dataIso(r['prazo']) ?? '',
    quem: texto(r['quem']),
    como: texto(r['como']),
    quanto: textoN(r['quanto_descricao']),
    situacao: camelo(r['situacao']),
    texto: textoN(r['evidencia_execucao']),
    concluidaEm: instanteN(r['concluida_em']),
    eficacia: textoN(r['eficacia']),
    eficaciaTexto: textoN(r['eficacia_descricao']),
    eficaciaEm: instanteN(r['eficacia_verificada_em']),
    eficaciaPor: textoN(r['eficacia_por']),
    versao: n(r['versao']),
    criadaPor: texto(r['criada_por']),
    criadaEm: instante(r['criado_em']),
  };
}

export function lerAcoes(l: L, est: number, notificacao: number): Promise<AcaoPlanoRegistrada[]> {
  return l
    .consultar(
      `${SQL_ACAO} AND COALESCE(pa.notificacao_incidente_id, ai.notificacao_incidente_id) = ? ORDER BY ap.sequencia, ap.id`,
      [est, notificacao],
      { teto: 500 },
    )
    .then((r) => r.map(acaoPlano));
}

// ── Vigilância de produto ─────────────────────────────────────────────────────────────────────────────────────────

/** A situação do contrato no banco (a notificada é a enviada à vigilância sanitária). */
const SITUACAO_QUEIXA_BANCO: Readonly<Record<string, string>> = {
  aberta: 'aberta',
  emInvestigacao: 'em_investigacao',
  notificada: 'enviada_vigilancia',
  encerrada: 'encerrada',
};
/** As situações do banco que a tela lê como cada situação do contrato (as das outras telas entram na investigação). */
const SITUACOES_QUEIXA_LIDAS: Readonly<Record<string, readonly string[]>> = {
  aberta: ['aberta'],
  emInvestigacao: ['em_investigacao', 'lote_segregado', 'enviada_fabricante'],
  notificada: ['enviada_vigilancia'],
  encerrada: ['encerrada'],
};
const SITUACAO_QUEIXA_CONTRATO: Readonly<Record<string, string>> = {
  aberta: 'aberta',
  em_investigacao: 'emInvestigacao',
  lote_segregado: 'emInvestigacao',
  enviada_fabricante: 'emInvestigacao',
  enviada_vigilancia: 'notificada',
  encerrada: 'encerrada',
};
const NATUREZA_DO_TIPO: Readonly<Record<string, string>> = {
  queixaTecnica: 'queixa_tecnica',
  eventoAdverso: 'evento_adverso',
  reacaoAdversa: 'evento_adverso',
  inefetividade: 'evento_adverso',
  alertaSanitario: 'alerta_sanitario',
};
const AREA_LIDA = `COALESCE(q.area_vigilancia, CASE WHEN i.tipo = 'medicamento' THEN 'farmacovigilancia' ELSE 'tecnovigilancia' END)`;

const SQL_QUEIXA = `
  SELECT q.id, ${AREA_LIDA} AS area, COALESCE(q.tipo_vigilancia, q.natureza) AS tipo, i.codigo AS item,
         COALESCE(q.produto_descricao, i.nome) AS produto, COALESCE(q.lote_descricao, li.numero_lote) AS lote,
         q.numero_serie, COALESCE(q.fabricante_descricao, f.nome) AS fabricante, q.registro_sanitario, q.descricao,
         q.notificacao_incidente_id, q.alerta_descricao, q.conduta, q.situacao, q.protocolo_vigilancia, q.versao,
         un.login AS registrada_por, q.criado_em, q.alterado_em, q.encerrada_em
    FROM queixa_tecnica_produto q
    LEFT JOIN insumo i ON i.id = q.insumo_id
    LEFT JOIN lote_insumo li ON li.id = q.lote_insumo_id
    LEFT JOIN fabricante f ON f.id = q.fabricante_id
    LEFT JOIN usuario un ON un.id = q.notificante_usuario_id
   WHERE q.estabelecimento_id = ? AND q.excluido_em IS NULL`;

function queixaDe(r: Linha): QueixaTecnicaRegistrada {
  const item = textoN(r['item']);
  const situacao = texto(r['situacao']);
  return {
    id: n(r['id']),
    area: texto(r['area']),
    tipo: camelo(r['tipo']),
    item: item !== null && /^\d+$/.test(item) ? Number(item) : null,
    produto: textoN(r['produto']),
    lote: textoN(r['lote']),
    serie: textoN(r['numero_serie']),
    fabricante: textoN(r['fabricante']),
    registroAnvisa: textoN(r['registro_sanitario']),
    descricao: texto(r['descricao']),
    notificacao: nn(r['notificacao_incidente_id']),
    alerta: textoN(r['alerta_descricao']),
    conduta: camelo(r['conduta']),
    situacao: SITUACAO_QUEIXA_CONTRATO[situacao] ?? camelo(situacao),
    notivisaNumero: textoN(r['protocolo_vigilancia']),
    versao: n(r['versao']),
    registradaPor: texto(r['registrada_por']),
    registradaEm: instante(r['criado_em']),
    atualizadaEm: instanteN(r['alterado_em']),
    encerradaEm: instanteN(r['encerrada_em']),
  };
}

export async function lerQueixas(
  l: L,
  est: number,
  f: { readonly situacao?: string; readonly area?: string; readonly pagina: number; readonly porPagina: number },
): Promise<{ itens: QueixaTecnicaRegistrada[]; temMais: boolean }> {
  const filtros: string[] = [];
  const p: unknown[] = [est];
  if (f.situacao) {
    const s = SITUACOES_QUEIXA_LIDAS[f.situacao] ?? [cobra(f.situacao)];
    filtros.push(`AND q.situacao IN (${marcas(s.length)})`);
    p.push(...s);
  }
  if (f.area) {
    filtros.push(`AND ${AREA_LIDA} = ?`);
    p.push(f.area);
  }
  const por = Math.max(1, Math.trunc(f.porPagina));
  const ini = (Math.max(1, Math.trunc(f.pagina)) - 1) * por;
  const r = await l.consultar(
    `${SQL_QUEIXA} ${filtros.join(' ')} ORDER BY q.criado_em DESC, q.id DESC LIMIT ${por + 1} OFFSET ${ini}`,
    p,
    { teto: por + 1 },
  );
  return { itens: r.slice(0, por).map(queixaDe), temMais: r.length > por };
}

export async function lerQueixa(l: L, est: number, id: number): Promise<QueixaTecnicaRegistrada | null> {
  const r = await l.uma(`${SQL_QUEIXA} AND q.id = ?`, [est, id]);
  return r ? queixaDe(r) : null;
}

export async function lerEventosQueixa(l: L, est: number, id: number): Promise<EventoQueixaRegistrado[]> {
  const r = await l.consultar(
    `SELECT e.ocorrido_em, u.login, e.situacao, COALESCE(e.conduta, JSON_VALUE(e.dados, '$.conduta'), 'nenhuma') AS conduta,
            e.observacao
       FROM queixa_tecnica_produto_evento e
       JOIN queixa_tecnica_produto q ON q.id = e.queixa_tecnica_produto_id
       LEFT JOIN usuario u ON u.id = e.usuario_id
      WHERE q.id = ? AND q.estabelecimento_id = ? AND q.excluido_em IS NULL
      ORDER BY e.ocorrido_em, e.id`,
    [id, est],
    { teto: 1000 },
  );
  return r.map((e) => ({
    em: instante(e['ocorrido_em']),
    por: texto(e['login']),
    situacao: SITUACAO_QUEIXA_CONTRATO[texto(e['situacao'])] ?? camelo(e['situacao']),
    conduta: camelo(e['conduta']),
    texto: textoN(e['observacao']),
  }));
}

// ── Sugestão resolvida ────────────────────────────────────────────────────────────────────────────────────────────

export async function lerResolvidas(l: L, est: number, resumos: readonly string[]): Promise<Set<string>> {
  const validos = [...new Set(resumos.filter((r) => /^[0-9a-f]{64}$/.test(r)))];
  if (validos.length === 0) return new Set();
  const r = await l.consultar(
    `SELECT resumo FROM sugestao_notificacao_resolvida WHERE estabelecimento_id = ? AND resumo IN (${marcas(validos.length)})`,
    [est, ...validos],
    { teto: validos.length },
  );
  return new Set(r.map((x) => texto(x['resumo'])));
}

// ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** O que a gravação da etapa 2 usa da notificação (a linha travada, a mudança pela versão e a linha do tempo). */
export interface ApoioEtapa2 {
  travarNotificacao(id: number): Promise<NotificacaoRegistrada>;
  mudarNotificacao(id: number, versao: number, valores: Record<string, unknown>): Promise<{ versao: number }>;
  eventoNotificacao(
    id: number,
    agora: string,
    situacaoAnterior: string,
    situacaoNova: string,
    usuario: number | null,
    e: EventoNotificacaoNovo,
  ): Promise<void>;
}

export type GravadorEtapa2 = Pick<
  GravadorQualidade,
  | 'travarAnalise'
  | 'acoesNaTransacao'
  | 'registrarAnalise'
  | 'travarAcao'
  | 'incluirAcao'
  | 'alterarAcao'
  | 'situacaoAcao'
  | 'eficaciaAcao'
  | 'resolverSugestao'
  | 'abrirQueixa'
  | 'travarQueixa'
  | 'andamentoQueixa'
>;

/** O próximo número do ano no formato `PREFIXO-AAAA-NNNNNN` (a sequência do ano nasce no primeiro uso). */
async function numeroDoAno(
  tx: TxOperacao,
  est: number,
  tipo: string,
  prefixo: string,
  agora: string,
  usuario: number,
): Promise<string> {
  const ano = agora.slice(0, 4);
  const seq = `${tipo}_${ano}`;
  await tx.executar(
    `INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, incremento, valor_maximo, ativo,
                                    criado_em, criado_por, versao)
     VALUES (?, ?, NULL, 1, 1, 999999, TRUE, ?, ?, 1)
     ON DUPLICATE KEY UPDATE id = id`,
    [est, seq, new Date(), usuario],
  );
  const v = (await tx.proximoNumero(seq)).valor;
  return `${prefixo}-${ano}-${String(v).padStart(6, '0')}`;
}

async function fatorDoBanco(tx: TxOperacao, fator: string): Promise<number> {
  const categoria = FATOR_PARA_BANCO[fator] ?? cobra(fator);
  const r = await tx.uma(
    `SELECT id FROM fator_contribuinte WHERE categoria = ? AND ativo = TRUE
      ORDER BY superior_fator_contribuinte_id IS NOT NULL, id LIMIT 1`,
    [categoria],
  );
  if (!r)
    throw recusa(
      'cadastro-pendente',
      `O cadastro de fatores contribuintes não tem a categoria "${fator}": peça ao administrador que carregue o cadastro da qualidade.`,
    );
  return n(r['id']);
}

export function gravadorEtapa2(tx: TxOperacao, est: number, apoio: ApoioEtapa2): GravadorEtapa2 {
  const quem = (login: string) => exigirUsuario(tx, login);

  const travarAnaliseLinha = async (notificacao: number) => {
    await tx.consultarParaAtualizar(
      `SELECT id FROM analise_incidente
        WHERE notificacao_incidente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'`,
      [notificacao, est],
      { teto: 10 },
    );
    return lerAnalise(tx, est, notificacao);
  };

  /** Os fatores da análise: os retirados ficam marcados como excluídos; os novos entram na sequência seguinte. */
  const gravarFatores = async (analise: number, fatores: readonly string[], usuario: number, agora: string) => {
    const atuais = await tx.consultar(
      `SELECT ca.id, ca.versao, f.categoria, ca.excluido_em FROM analise_incidente_causa ca
         LEFT JOIN fator_contribuinte f ON f.id = ca.fator_contribuinte_id
        WHERE ca.analise_incidente_id = ?`,
      [analise],
      { teto: 1000 },
    );
    const desejadas = new Set(fatores.map((f) => FATOR_PARA_BANCO[f] ?? cobra(f)));
    const ativas = new Set<string>();
    for (const c of atuais) {
      if (c['excluido_em'] !== null || c['categoria'] === null) continue;
      const cat = texto(c['categoria']);
      if (desejadas.has(cat) && !ativas.has(cat)) ativas.add(cat);
      else
        await tx.alterar('analise_incidente_causa', n(c['id']), n(c['versao']), {
          excluido_em: seg(agora),
          excluido_por: usuario,
        });
    }
    const [mx] = await tx.consultar(
      'SELECT COALESCE(MAX(sequencia), 0) AS s FROM analise_incidente_causa WHERE analise_incidente_id = ?',
      [analise],
      { teto: 1 },
    );
    let seq = n(mx?.['s']);
    for (const f of fatores) {
      const cat = FATOR_PARA_BANCO[f] ?? cobra(f);
      if (ativas.has(cat)) continue;
      ativas.add(cat);
      await tx.incluir('analise_incidente_causa', {
        analise_incidente_id: analise,
        sequencia: ++seq,
        fator_contribuinte_id: await fatorDoBanco(tx, f),
        descricao: `Fator contribuinte: ${f}`,
        causa_raiz: false,
      });
    }
  };

  const travarAcaoLinha = async (notificacao: number | null, id: number): Promise<AcaoPlanoRegistrada> => {
    await tx.consultarParaAtualizar('SELECT id FROM acao_plano_qualidade WHERE id = ? AND excluido_em IS NULL', [id], {
      teto: 1,
    });
    const r = await tx.uma(
      `${SQL_ACAO} AND ap.id = ?${notificacao === null ? '' : ' AND COALESCE(pa.notificacao_incidente_id, ai.notificacao_incidente_id) = ?'}`,
      notificacao === null ? [est, id] : [est, id, notificacao],
    );
    if (!r) throw naoEncontrado('A ação');
    return acaoPlano(r);
  };

  const mudarAcao = async (
    a: { readonly id: number; readonly versao: number },
    valores: Record<string, unknown>,
  ): Promise<{ versao: number }> => {
    const atual = await travarAcaoLinha(null, a.id);
    if (atual.versao !== a.versao) throw versaoMudou('A ação');
    return { versao: await tx.alterar('acao_plano_qualidade', a.id, a.versao, valores) };
  };

  const travarQueixaLinha = async (id: number): Promise<QueixaTecnicaRegistrada> => {
    await tx.consultarParaAtualizar(
      'SELECT id FROM queixa_tecnica_produto WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
      { teto: 1 },
    );
    const q = await lerQueixa(tx, est, id);
    if (!q) throw naoEncontrado('O registro');
    return q;
  };

  const eventoQueixa = async (
    queixa: number,
    operacao: 'inclusao' | 'alteracao',
    agora: string,
    usuario: number,
    situacao: string,
    conduta: string,
    observacao: string | null,
  ) => {
    await tx.incluir('queixa_tecnica_produto_evento', {
      queixa_tecnica_produto_id: queixa,
      operacao,
      dados: JSON.stringify({ situacao, conduta }),
      ocorrido_em: seg(agora),
      usuario_id: usuario,
      situacao,
      conduta,
      observacao: observacao === null ? null : observacao.slice(0, 1000),
    });
  };

  return {
    travarAnalise: (notificacao) => travarAnaliseLinha(notificacao),
    acoesNaTransacao: (notificacao) => lerAcoes(tx, est, notificacao),

    registrarAnalise: async (a) => {
      const usuario = await quem(a.usuario);
      const notificacao = await apoio.travarNotificacao(a.notificacao);
      const atual = await travarAnaliseLinha(a.notificacao);
      const concluir = a.concluir;
      const valores = {
        metodo: cobra(a.metodo),
        conteudo: a.conteudo === '' ? null : a.conteudo,
        causa_raiz: a.causaRaiz,
        licoes_aprendidas: a.licoes,
        sem_acao_justificativa: a.semAcaoJustificativa,
        situacao: concluir ? 'concluida' : 'rascunho',
        concluida_em: concluir ? seg(a.agora) : null,
      };
      let id: number;
      let versao: number;
      if (a.atual === null) {
        if (atual !== null) throw versaoMudou('A análise');
        id = await tx.incluir('analise_incidente', {
          estabelecimento_id: est,
          notificacao_incidente_id: a.notificacao,
          responsavel_usuario_id: usuario,
          ...valores,
        });
        versao = 1;
      } else {
        if (atual === null || atual.id !== a.atual.id || atual.versao !== a.atual.versao || atual.situacao !== 'rascunho')
          throw versaoMudou('A análise');
        id = atual.id;
        versao = await tx.alterar('analise_incidente', id, a.atual.versao, valores);
      }
      await gravarFatores(id, a.fatores, usuario, a.agora);
      let versaoNotificacao = a.versaoNotificacao;
      const antes = cobra(notificacao.situacao);
      const depois = a.situacaoNotificacao === null ? antes : cobra(a.situacaoNotificacao);
      if (a.situacaoNotificacao !== null)
        versaoNotificacao = (
          await apoio.mudarNotificacao(a.notificacao, a.versaoNotificacao, {
            situacao: depois,
            ...(concluir ? { concluida_em: seg(a.agora) } : {}),
          })
        ).versao;
      for (const tipo of a.eventos)
        await apoio.eventoNotificacao(a.notificacao, a.agora, antes, depois, usuario, { tipo, por: a.usuario });
      return { id, versao, versaoNotificacao };
    },

    travarAcao: (notificacao, id) => travarAcaoLinha(notificacao, id),

    incluirAcao: async (a) => {
      const usuario = await quem(a.usuario);
      const responsavel = await quem(a.acao.quem);
      const notificacao = await apoio.travarNotificacao(a.notificacao);
      const prazo = a.acao.quando.slice(0, 10);
      const [plano] = await tx.consultarParaAtualizar(
        `SELECT pa.id, pa.prazo, pa.versao FROM plano_acao_qualidade pa
           LEFT JOIN analise_incidente ai ON ai.id = pa.analise_incidente_id
          WHERE pa.estabelecimento_id = ? AND pa.excluido_em IS NULL
            AND COALESCE(pa.notificacao_incidente_id, ai.notificacao_incidente_id) = ?
          ORDER BY pa.id LIMIT 1`,
        [est, a.notificacao],
        { teto: 1 },
      );
      let planoId: number;
      if (plano) {
        planoId = n(plano['id']);
        if ((dataIso(plano['prazo']) ?? '') < prazo)
          await tx.alterar('plano_acao_qualidade', planoId, n(plano['versao']), { prazo });
      } else {
        planoId = await tx.incluir('plano_acao_qualidade', {
          estabelecimento_id: est,
          numero: await numeroDoAno(tx, est, 'plano_acao_qualidade', 'PA', a.agora, usuario),
          titulo: `Plano de ação da notificação ${notificacao.protocolo}`.slice(0, 200),
          tipo_origem: 'incidente',
          notificacao_incidente_id: a.notificacao,
          responsavel_usuario_id: usuario,
          prazo,
          situacao: 'em_andamento',
        });
      }
      const [mx] = await tx.consultar(
        'SELECT COALESCE(MAX(sequencia), 0) AS s FROM acao_plano_qualidade WHERE plano_acao_qualidade_id = ?',
        [planoId],
        { teto: 1 },
      );
      const sequencia = n(mx?.['s']) + 1;
      const id = await tx.incluir('acao_plano_qualidade', {
        plano_acao_qualidade_id: planoId,
        sequencia,
        o_que: a.acao.oQue,
        por_que: a.acao.porQue,
        onde: a.acao.onde,
        como: a.acao.como,
        quanto_descricao: a.acao.quanto,
        responsavel_usuario_id: responsavel,
        prazo,
        prazo_original: prazo,
        situacao: 'planejada',
      });
      return { id, sequencia, versao: 1 };
    },

    alterarAcao: async (a) => {
      const atual = await travarAcaoLinha(null, a.id);
      if (atual.versao !== a.versao) throw versaoMudou('A ação');
      const prazo = a.acao.quando.slice(0, 10);
      const [linha] = await tx.consultar(
        'SELECT quantidade_prorrogacoes FROM acao_plano_qualidade WHERE id = ?',
        [a.id],
        { teto: 1 },
      );
      return {
        versao: await tx.alterar('acao_plano_qualidade', a.id, a.versao, {
          o_que: a.acao.oQue,
          por_que: a.acao.porQue,
          onde: a.acao.onde,
          como: a.acao.como,
          quanto_descricao: a.acao.quanto,
          responsavel_usuario_id: await quem(a.acao.quem),
          prazo,
          // A prorrogação conta quando o prazo novo passa do vigente.
          quantidade_prorrogacoes: n(linha?.['quantidade_prorrogacoes']) + (prazo > atual.quando ? 1 : 0),
        }),
      };
    },

    situacaoAcao: (a) =>
      mudarAcao(a, {
        situacao: cobra(a.situacao),
        ...(a.encerra ? { evidencia_execucao: a.texto, concluida_em: seg(a.agora) } : {}),
      }),

    eficaciaAcao: async (a) =>
      mudarAcao(a, {
        eficacia: a.eficacia,
        eficacia_descricao: a.texto.slice(0, 1000),
        eficacia_verificada_em: seg(a.agora),
        eficacia_verificador_usuario_id: await quem(a.usuario),
      }),

    resolverSugestao: async (r) => {
      const ja = await tx.consultarParaAtualizar(
        'SELECT id FROM sugestao_notificacao_resolvida WHERE estabelecimento_id = ? AND resumo = ?',
        [est, r.resumo],
        { teto: 1 },
      );
      if (ja.length > 0) return { gravou: false };
      await tx.incluir('sugestao_notificacao_resolvida', {
        estabelecimento_id: est,
        resumo: r.resumo,
        resolvida_em: r.dia.slice(0, 10),
      });
      return { gravou: true };
    },

    abrirQueixa: async (q) => {
      const usuario = await quem(q.usuario);
      let insumo: number | null = null;
      if (q.item !== null) {
        const i = await tx.uma('SELECT id FROM insumo WHERE codigo = ?', [String(q.item)]);
        if (!i) throw recusa('item-inexistente', 'O item informado não está no cadastro de produtos.');
        insumo = n(i['id']);
      }
      if (q.notificacao !== null) {
        const x = await tx.uma(
          'SELECT id FROM notificacao_incidente WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [q.notificacao, est],
        );
        if (!x) throw recusa('notificacao-inexistente', 'A notificação informada não é deste estabelecimento.');
      }
      const conduta = cobra(q.conduta);
      const agora = seg(q.agora);
      const id = await tx.incluir('queixa_tecnica_produto', {
        estabelecimento_id: est,
        numero: await numeroDoAno(tx, est, 'queixa_tecnica_produto', 'QT', q.agora, usuario),
        insumo_id: insumo,
        notificacao_incidente_id: q.notificacao,
        tipo_desvio: q.tipo === 'queixaTecnica' ? 'desvio_qualidade' : 'outro',
        natureza: NATUREZA_DO_TIPO[q.tipo] ?? 'queixa_tecnica',
        area_vigilancia: cobra(q.area),
        tipo_vigilancia: cobra(q.tipo),
        produto_descricao: q.produto?.slice(0, 200) ?? null,
        lote_descricao: q.lote?.slice(0, 60) ?? null,
        numero_serie: q.serie?.slice(0, 60) ?? null,
        fabricante_descricao: q.fabricante?.slice(0, 150) ?? null,
        registro_sanitario: q.registroAnvisa?.slice(0, 30) ?? null,
        alerta_descricao: q.alerta?.slice(0, 200) ?? null,
        conduta,
        descricao: q.descricao,
        identificada_em: agora,
        lote_segregado: conduta === 'segregado',
        segregado_em: conduta === 'segregado' ? agora : null,
        notificante_usuario_id: usuario,
        situacao: 'aberta',
      });
      await eventoQueixa(id, 'inclusao', q.agora, usuario, 'aberta', conduta, null);
      return { id, versao: 1 };
    },

    travarQueixa: (id) => travarQueixaLinha(id),

    andamentoQueixa: async (a) => {
      const atual = await travarQueixaLinha(a.id);
      if (atual.versao !== a.versao || atual.situacao === 'encerrada') throw versaoMudou('O registro');
      const usuario = await quem(a.usuario);
      const situacao = SITUACAO_QUEIXA_BANCO[a.situacao] ?? cobra(a.situacao);
      const conduta = cobra(a.conduta);
      const agora = seg(a.agora);
      const [linha] = await tx.consultar(
        'SELECT enviada_vigilancia_em, lote_segregado FROM queixa_tecnica_produto WHERE id = ?',
        [a.id],
        { teto: 1 },
      );
      const segregaAgora = conduta === 'segregado' && !verdadeiro(linha?.['lote_segregado']);
      const versao = await tx.alterar('queixa_tecnica_produto', a.id, a.versao, {
        situacao,
        conduta,
        protocolo_vigilancia: a.notivisaNumero?.slice(0, 60) ?? null,
        enviada_vigilancia_em:
          situacao === 'enviada_vigilancia' || a.notivisaNumero !== null
            ? (linha?.['enviada_vigilancia_em'] ?? agora)
            : (linha?.['enviada_vigilancia_em'] ?? null),
        encerrada_em: a.encerra ? agora : null,
        ...(segregaAgora ? { lote_segregado: true, segregado_em: agora } : {}),
      });
      await eventoQueixa(a.id, 'alteracao', a.agora, usuario, situacao, conduta, a.texto);
      return { versao };
    },
  };
}
