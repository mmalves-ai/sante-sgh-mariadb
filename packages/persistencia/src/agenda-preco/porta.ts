// Porta de persistência do ADR 0009: regra de preço particular (dona o profissional ou a agenda), credenciamento
// profissional × convênio com as opções do convênio (alerta ou bloqueio; credenciar todos ao criar) e a agenda
// estruturada (cobertura por convênio e plano, restrições, preparo e o texto original íntegro com os trechos).
// Só SQL e conversão: quem escolhe a regra que vence é o domínio (dominio-preco / dominio-agenda). As leituras
// devolvem as regras ativas, não excluídas e não recusadas; "estimada" (extraída do texto) já vale (decisão 27).
import type {
  AgendaEstruturada,
  CampoTextoAgenda,
  Credenciamento,
  EntradaCoberturaAgenda,
  EntradaCredenciamento,
  EntradaPreparoAgenda,
  EntradaRegraPrecoParticular,
  EntradaRestricaoAgenda,
  EntradaTextoOrigemAgenda,
  FiltroRegrasPrecoParticular,
  OpcoesCredenciamentoConvenio,
  RegraPrecoParticular,
  SexoAtendido,
  TextoOrigemAgenda,
  TrechoTexto,
} from '@sgh/contratos';
import type { Escritor, Leitor, Linha } from '@sgh/nucleo';
import {
  bit,
  booleanoDoBanco,
  coberturaDe,
  credenciamentoDe,
  hashTextoAgenda,
  preparoDe,
  regraPrecoParticularDe,
  restricaoDe,
  trechoDe,
} from './linhas.js';

const D = (c: string) => `DATE_FORMAT(${c}, '%Y-%m-%d') AS ${c.replace(/^.*\./, '')}`;
const VIGENTE = (a: string) =>
  `${a}.vigencia_inicio <= ? AND (${a}.vigencia_fim IS NULL OR ${a}.vigencia_fim >= ?)`;

const COLUNAS_REGRA = `r.id, r.estabelecimento_id, r.fonte_pagadora_id, r.profissional_id, r.agenda_servico_id, r.alvo,
  r.item_faturavel_id, r.grupo_faturamento_id, r.valor, r.prioridade, ${D('r.vigencia_inicio')}, ${D('r.vigencia_fim')},
  r.situacao_revisao, r.texto_origem_agenda_id, r.observacao, r.ativo, r.origem, r.versao`;

// ---------------------------------------------------------------- regra de preço particular

export async function incluirRegraPrecoParticular(
  e: Escritor,
  r: EntradaRegraPrecoParticular,
  usuario: number | null,
  origem: 'sistema' | 'migracao' | 'integracao' = 'sistema',
): Promise<number> {
  return e.inserir(
    `INSERT INTO regra_preco_particular (estabelecimento_id, fonte_pagadora_id, profissional_id, agenda_servico_id, alvo,
       item_faturavel_id, grupo_faturamento_id, valor, prioridade, vigencia_inicio, vigencia_fim, situacao_revisao,
       texto_origem_agenda_id, observacao, origem, criado_em, criado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP(3), ?)`,
    [
      r.estabelecimentoId,
      r.fontePagadoraId,
      r.dono.tipo === 'profissional' ? r.dono.profissionalId : null,
      r.dono.tipo === 'agenda' ? r.dono.agendaId : null,
      r.alvo.tipo,
      r.alvo.tipo === 'item' ? r.alvo.itemFaturavelId : null,
      r.alvo.tipo === 'grupo' ? r.alvo.grupoFaturamentoId : null,
      r.valor.toFixed(2),
      r.prioridade,
      r.vigenciaInicio,
      r.vigenciaFim,
      r.situacaoRevisao,
      r.textoOrigemId,
      r.observacao,
      origem,
      usuario,
    ],
  );
}

/** Muda a situação de revisão (confirmar ou recusar a estimada), com controle de versão. Devolve as linhas afetadas. */
export async function revisarRegraPrecoParticular(
  e: Escritor,
  id: number,
  versaoEsperada: number,
  situacao: 'confirmada' | 'recusada',
  usuario: number | null,
): Promise<number> {
  return e.executar(
    `UPDATE regra_preco_particular SET situacao_revisao = ?, versao = versao + 1, alterado_em = CURRENT_TIMESTAMP(3),
       alterado_por = ? WHERE id = ? AND versao = ? AND excluido_em IS NULL`,
    [situacao, usuario, id, versaoEsperada],
  );
}

export async function listarRegrasPrecoParticular(
  l: Leitor,
  f: FiltroRegrasPrecoParticular,
): Promise<RegraPrecoParticular[]> {
  const onde = ['r.excluido_em IS NULL'];
  const p: unknown[] = [];
  const igual = (coluna: string, valor: number | undefined) => {
    if (valor === undefined) return;
    onde.push(`r.${coluna} = ?`);
    p.push(valor);
  };
  igual('profissional_id', f.profissionalId);
  igual('agenda_servico_id', f.agendaId);
  igual('fonte_pagadora_id', f.fontePagadoraId);
  if (f.vigentesEm !== undefined) {
    onde.push("r.ativo AND r.situacao_revisao <> 'recusada'", VIGENTE('r'));
    p.push(f.vigentesEm, f.vigentesEm);
  }
  const ls = await l.consultar(
    `SELECT ${COLUNAS_REGRA} FROM regra_preco_particular r WHERE ${onde.join(' AND ')} ORDER BY r.id`,
    p,
  );
  return ls.map(regraPrecoParticularDe);
}

/**
 * Candidatas ao preço particular de um atendimento: as regras vigentes na data, ativas e não recusadas, do
 * profissional OU da agenda, na fonte particular, no estabelecimento ou na rede (nulo). O domínio escolhe a mais
 * específica (item > grupo > consulta; estabelecimento > rede; prioridade; vigência mais recente; id).
 */
export async function candidatasPrecoParticular(
  l: Leitor,
  q: {
    readonly fontePagadoraId: number;
    readonly profissionalId: number | null;
    readonly agendaId: number | null;
    readonly estabelecimentoId: number;
    readonly data: string;
  },
): Promise<RegraPrecoParticular[]> {
  if (q.profissionalId === null && q.agendaId === null) return [];
  const ls = await l.consultar(
    `SELECT ${COLUNAS_REGRA} FROM regra_preco_particular r
      WHERE r.fonte_pagadora_id = ? AND r.excluido_em IS NULL AND r.ativo AND r.situacao_revisao <> 'recusada'
        AND (r.profissional_id = ? OR r.agenda_servico_id = ?)
        AND (r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?) AND ${VIGENTE('r')}
      ORDER BY r.id`,
    [q.fontePagadoraId, q.profissionalId, q.agendaId, q.estabelecimentoId, q.data, q.data],
  );
  return ls.map(regraPrecoParticularDe);
}

/**
 * O particular padrão do hospital: o código do parâmetro faturamento.fontePagadoraParticularCodigo (lido pelo
 * resolvedor de parâmetros e passado aqui) ou, vazio, a única fonte ativa de tipo particular. Nulo se ambíguo.
 */
export async function fonteParticularPadrao(
  l: Leitor,
  codigoParametro: string | null,
): Promise<number | null> {
  if (codigoParametro) {
    const u = await l.uma(`SELECT id FROM fonte_pagadora WHERE codigo = ? AND tipo = 'particular'`, [
      codigoParametro,
    ]);
    return u ? Number(u['id']) : null;
  }
  const ls = await l.consultar(
    `SELECT id FROM fonte_pagadora WHERE tipo = 'particular' AND situacao = 'ativa' ORDER BY id LIMIT 2`,
  );
  return ls.length === 1 ? Number(ls[0]!['id']) : null;
}

// ---------------------------------------------------------------- credenciamento

export async function opcoesCredenciamentoConvenio(
  l: Leitor,
  fontePagadoraId: number,
): Promise<OpcoesCredenciamentoConvenio | null> {
  const u = await l.uma(
    'SELECT id, bloqueia_sem_credenciamento, credencia_todos_ao_criar FROM fonte_pagadora WHERE id = ?',
    [fontePagadoraId],
  );
  return u
    ? {
        fontePagadoraId: Number(u['id']),
        bloqueiaSemCredenciamento: booleanoDoBanco(u['bloqueia_sem_credenciamento']),
        credenciaTodosAoCriar: booleanoDoBanco(u['credencia_todos_ao_criar']),
      }
    : null;
}

export async function definirOpcoesCredenciamentoConvenio(
  e: Escritor,
  o: OpcoesCredenciamentoConvenio,
  usuario: number | null,
): Promise<number> {
  return e.executar(
    `UPDATE fonte_pagadora SET bloqueia_sem_credenciamento = ?, credencia_todos_ao_criar = ?, versao = versao + 1,
       alterado_em = CURRENT_TIMESTAMP(3), alterado_por = ? WHERE id = ?`,
    [bit(o.bloqueiaSemCredenciamento), bit(o.credenciaTodosAoCriar), usuario, o.fontePagadoraId],
  );
}

const COLUNAS_CRED = `c.id, c.profissional_id, c.fonte_pagadora_id, c.estabelecimento_id, c.plano_fonte_pagadora_id,
  c.credenciado, ${D('c.vigencia_inicio')}, ${D('c.vigencia_fim')}, c.versao,
  COALESCE(cpr.nome_exibicao, cpf.nome) AS profissional_nome, cfp.nome AS fonte_pagadora_nome,
  ces.nome_fantasia AS estabelecimento_nome, cpl.descricao AS plano_nome`;
/** Os nomes do credenciamento (profissional, convênio, estabelecimento e plano), para a tela. */
const NOMES_CRED = `JOIN profissional cpr ON cpr.id = c.profissional_id
  JOIN pessoa_fisica cpf ON cpf.id = cpr.pessoa_fisica_id
  JOIN fonte_pagadora cfp ON cfp.id = c.fonte_pagadora_id
  LEFT JOIN estabelecimento ces ON ces.id = c.estabelecimento_id
  LEFT JOIN plano_fonte_pagadora cpl ON cpl.id = c.plano_fonte_pagadora_id`;

/** Credenciamentos vigentes do par profissional × convênio na data e no estabelecimento (ou na rede). */
export async function credenciamentosVigentes(
  l: Leitor,
  q: {
    readonly profissionalId: number;
    readonly fontePagadoraId: number;
    readonly estabelecimentoId: number;
    readonly data: string;
  },
): Promise<Credenciamento[]> {
  const ls = await l.consultar(
    `SELECT ${COLUNAS_CRED} FROM profissional_fonte_pagadora c ${NOMES_CRED}
      WHERE c.profissional_id = ? AND c.fonte_pagadora_id = ? AND c.excluido_em IS NULL
        AND (c.estabelecimento_id IS NULL OR c.estabelecimento_id = ?) AND ${VIGENTE('c')}
      ORDER BY c.id`,
    [q.profissionalId, q.fontePagadoraId, q.estabelecimentoId, q.data, q.data],
  );
  return ls.map(credenciamentoDe);
}

export async function incluirCredenciamento(
  e: Escritor,
  c: EntradaCredenciamento,
  usuario: number | null,
): Promise<number> {
  return e.inserir(
    `INSERT INTO profissional_fonte_pagadora (profissional_id, fonte_pagadora_id, estabelecimento_id,
       plano_fonte_pagadora_id, credenciado, vigencia_inicio, vigencia_fim, criado_em, criado_por)
     VALUES (?,?,?,?,?,?,?, CURRENT_TIMESTAMP(3), ?)`,
    [
      c.profissionalId,
      c.fontePagadoraId,
      c.estabelecimentoId,
      c.planoId,
      bit(c.credenciado),
      c.vigenciaInicio,
      c.vigenciaFim,
      usuario,
    ],
  );
}

/**
 * Convênio novo com credencia_todos_ao_criar: credencia na rede (estabelecimento nulo, todos os planos) cada
 * profissional ativo ainda sem credenciamento nesse convênio. Idempotente. Devolve quantos foram credenciados.
 */
export async function credenciarTodosAtivos(
  e: Escritor,
  fontePagadoraId: number,
  vigenciaInicio: string,
  usuario: number | null,
): Promise<number> {
  return e.executar(
    `INSERT INTO profissional_fonte_pagadora (profissional_id, fonte_pagadora_id, credenciado, vigencia_inicio,
       criado_em, criado_por)
     SELECT p.id, ?, 1, ?, CURRENT_TIMESTAMP(3), ? FROM profissional p
      WHERE p.situacao = 'ativo' AND p.excluido_em IS NULL
        AND NOT EXISTS (SELECT 1 FROM profissional_fonte_pagadora c
                         WHERE c.profissional_id = p.id AND c.fonte_pagadora_id = ? AND c.excluido_em IS NULL)`,
    [fontePagadoraId, vigenciaInicio, usuario, fontePagadoraId],
  );
}

// ---------------------------------------------------------------- texto original da agenda

export interface ResultadoTextoAgenda {
  readonly id: number;
  /** O texto mudou (ou é novo): o Sincronizar deve extrair de novo. */
  readonly mudou: boolean;
}

/**
 * Grava o texto original íntegro (sem corte) de um campo da agenda. Se o texto mudou, troca o texto e o hash e volta a
 * situação para pendente (o extrator roda de novo); se não mudou, nada é alterado.
 */
export async function gravarTextoOrigemAgenda(
  e: Escritor,
  t: EntradaTextoOrigemAgenda,
  usuario: number | null,
  origem: 'sistema' | 'migracao' | 'integracao' = 'sistema',
): Promise<ResultadoTextoAgenda> {
  const hash = hashTextoAgenda(t.texto);
  const atual = await e.consultarParaAtualizar(
    `SELECT id, HEX(hash_texto) AS hash FROM texto_origem_agenda
      WHERE agenda_servico_id = ? AND campo = ? AND fonte_pagadora_id <=> ?`,
    [t.agendaId, t.campo, t.fontePagadoraId],
  );
  const a = atual[0];
  if (!a) {
    const id = await e.inserir(
      `INSERT INTO texto_origem_agenda (agenda_servico_id, fonte_pagadora_id, campo, texto, hash_texto, origem,
         criado_em, criado_por) VALUES (?,?,?,?, UNHEX(?), ?, CURRENT_TIMESTAMP(3), ?)`,
      [t.agendaId, t.fontePagadoraId, t.campo, t.texto, hash, origem, usuario],
    );
    return { id, mudou: true };
  }
  const id = Number(a['id']);
  if (String(a['hash']).toLowerCase() === hash) return { id, mudou: false };
  await e.executar(
    `UPDATE texto_origem_agenda SET texto = ?, hash_texto = UNHEX(?), situacao_estruturacao = 'pendente',
       versao = versao + 1, alterado_em = CURRENT_TIMESTAMP(3), alterado_por = ? WHERE id = ?`,
    [t.texto, hash, usuario, id],
  );
  return { id, mudou: true };
}

/** Troca os trechos do texto (resultado de uma extração) e marca a situação e a versão do extrator. */
export async function gravarTrechosTexto(
  e: Escritor,
  textoId: number,
  trechos: readonly TrechoTexto[],
  versaoExtrator: string,
  usuario: number | null,
): Promise<void> {
  await e.executar('DELETE FROM trecho_texto_agenda WHERE texto_origem_agenda_id = ?', [textoId]);
  for (const t of trechos)
    await e.inserir(
      `INSERT INTO trecho_texto_agenda (texto_origem_agenda_id, posicao_inicio, posicao_fim, interpretado, tipo_regra,
         motivo, criado_em, criado_por) VALUES (?,?,?,?,?,?, CURRENT_TIMESTAMP(3), ?)`,
      [textoId, t.inicio, t.fim, bit(t.interpretado), t.tipoRegra, t.motivo, usuario],
    );
  const situacao = trechos.some((t) => t.interpretado) ? 'extraida' : 'sem_regra';
  await e.executar(
    `UPDATE texto_origem_agenda SET situacao_estruturacao = ?, versao_extrator = ?, extraido_em = CURRENT_TIMESTAMP(3),
       versao = versao + 1, alterado_em = CURRENT_TIMESTAMP(3), alterado_por = ? WHERE id = ?`,
    [situacao, versaoExtrator, usuario, textoId],
  );
}

/**
 * O texto mudou na origem: as regras ESTIMADAS nascidas dele saem (excluídas), para o extrator gerar as novas. As
 * confirmadas ficam (nunca se apaga regra confirmada sem revisão); o domínio avisa a divergência. Devolve quantas saíram.
 */
export async function retirarEstimadasDoTexto(
  e: Escritor,
  textoId: number,
  usuario: number | null,
): Promise<number> {
  let n = 0;
  for (const tabela of ['regra_preco_particular', 'agenda_cobertura', 'agenda_restricao', 'agenda_preparo'])
    n += await e.executar(
      `UPDATE ${tabela} SET excluido_em = CURRENT_TIMESTAMP(3), excluido_por = ?, versao = versao + 1
        WHERE texto_origem_agenda_id = ? AND situacao_revisao = 'estimada' AND excluido_em IS NULL`,
      [usuario, textoId],
    );
  return n;
}

// ---------------------------------------------------------------- regras da agenda

export async function incluirCoberturaAgenda(
  e: Escritor,
  c: EntradaCoberturaAgenda,
  usuario: number | null,
  origem: 'sistema' | 'migracao' | 'integracao' = 'sistema',
): Promise<number> {
  return e.inserir(
    `INSERT INTO agenda_cobertura (agenda_servico_id, fonte_pagadora_id, plano_fonte_pagadora_id, aceita, vigencia_inicio,
       vigencia_fim, texto_origem_agenda_id, situacao_revisao, observacao, origem, criado_em, criado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP(3), ?)`,
    [
      c.agendaId,
      c.fontePagadoraId,
      c.planoId,
      bit(c.aceita),
      c.vigenciaInicio,
      c.vigenciaFim,
      c.textoOrigemId,
      c.situacaoRevisao,
      c.observacao,
      origem,
      usuario,
    ],
  );
}

export async function incluirRestricaoAgenda(
  e: Escritor,
  r: EntradaRestricaoAgenda,
  usuario: number | null,
  origem: 'sistema' | 'migracao' | 'integracao' = 'sistema',
): Promise<number> {
  return e.inserir(
    `INSERT INTO agenda_restricao (agenda_servico_id, fonte_pagadora_id, plano_fonte_pagadora_id, item_agendavel_id,
       sexo_atendido, idade_minima_anos, idade_maxima_anos, aceita_retorno, dias_retorno, permite_encaixe,
       vigencia_inicio, vigencia_fim, texto_origem_agenda_id, situacao_revisao, observacao, origem, criado_em, criado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP(3), ?)`,
    [
      r.agendaId,
      r.fontePagadoraId,
      r.planoId,
      r.itemAgendavelId,
      r.sexoAtendido,
      r.idadeMinimaAnos,
      r.idadeMaximaAnos,
      bit(r.aceitaRetorno),
      r.diasRetorno,
      bit(r.permiteEncaixe),
      r.vigenciaInicio,
      r.vigenciaFim,
      r.textoOrigemId,
      r.situacaoRevisao,
      r.observacao,
      origem,
      usuario,
    ],
  );
}

export async function incluirPreparoAgenda(
  e: Escritor,
  p: EntradaPreparoAgenda,
  usuario: number | null,
  origem: 'sistema' | 'migracao' | 'integracao' = 'sistema',
): Promise<number> {
  return e.inserir(
    `INSERT INTO agenda_preparo (agenda_servico_id, item_agendavel_id, tipo, descricao, jejum_horas, vigencia_inicio,
       vigencia_fim, texto_origem_agenda_id, situacao_revisao, origem, criado_em, criado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP(3), ?)`,
    [
      p.agendaId,
      p.itemAgendavelId,
      p.tipo,
      p.descricao,
      p.jejumHoras,
      p.vigenciaInicio,
      p.vigenciaFim,
      p.textoOrigemId,
      p.situacaoRevisao,
      origem,
      usuario,
    ],
  );
}

/**
 * A agenda estruturada inteira, para a tela e para as respostas (preço, cobertura, preparo, restrição) com o texto
 * original ao lado. Com `data`, só as regras vigentes nela; sem, todas as não excluídas. Recusadas nunca vêm.
 */
export async function lerAgendaEstruturada(
  l: Leitor,
  agendaId: number,
  data?: string,
): Promise<AgendaEstruturada | null> {
  const a = await l.uma(
    `SELECT a.id, a.nome, a.codigo_origem, a.profissional_id, ${D('a.vigencia_inicio')}, ${D('a.vigencia_fim')},
            a.sexo_atendido, a.idade_minima_anos, a.idade_maxima_anos, a.aceita_retorno, a.dias_retorno,
            a.permite_encaixe, a.preparo, a.estabelecimento_id, es.nome_fantasia AS estabelecimento_nome,
            COALESCE(pr.nome_exibicao, pf.nome) AS profissional_nome
       FROM agenda_servico a JOIN estabelecimento es ON es.id = a.estabelecimento_id
       LEFT JOIN profissional pr ON pr.id = a.profissional_id
       LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
      WHERE a.id = ? AND a.excluido_em IS NULL`,
    [agendaId],
  );
  if (!a) return null;
  const vig = (al: string) => (data === undefined ? '' : ` AND ${VIGENTE(al)}`);
  const pv = data === undefined ? [] : [data, data];
  const regras = (al: string) => `${al}.excluido_em IS NULL AND ${al}.situacao_revisao <> 'recusada'`;
  const [convenios, coberturas, restricoes, preparos, textos, trechos, precos] = await Promise.all([
    l.consultar(
      `SELECT af.fonte_pagadora_id, f.nome FROM agenda_fonte_pagadora af JOIN fonte_pagadora f ON f.id = af.fonte_pagadora_id
        WHERE af.agenda_servico_id = ? AND af.excluido_em IS NULL ORDER BY af.fonte_pagadora_id`,
      [agendaId],
    ),
    l.consultar(
      `SELECT c.id, c.versao, c.fonte_pagadora_id, c.plano_fonte_pagadora_id, pl.plano_superior_id, c.aceita,
              ${D('c.vigencia_inicio')}, ${D('c.vigencia_fim')}, c.situacao_revisao, c.texto_origem_agenda_id,
              f.nome AS fonte_pagadora_nome, pl.descricao AS plano_nome, ps.descricao AS plano_superior_nome
         FROM agenda_cobertura c JOIN fonte_pagadora f ON f.id = c.fonte_pagadora_id
         LEFT JOIN plano_fonte_pagadora pl ON pl.id = c.plano_fonte_pagadora_id
         LEFT JOIN plano_fonte_pagadora ps ON ps.id = pl.plano_superior_id
        WHERE c.agenda_servico_id = ? AND ${regras('c')}${vig('c')} ORDER BY c.id`,
      [agendaId, ...pv],
    ),
    l.consultar(
      `SELECT r.id, r.versao, r.fonte_pagadora_id, r.plano_fonte_pagadora_id, r.item_agendavel_id, r.sexo_atendido,
              r.idade_minima_anos, r.idade_maxima_anos, r.aceita_retorno, r.dias_retorno, r.permite_encaixe,
              ${D('r.vigencia_inicio')}, ${D('r.vigencia_fim')}, r.situacao_revisao, r.texto_origem_agenda_id,
              f.nome AS fonte_pagadora_nome, pl.descricao AS plano_nome
         FROM agenda_restricao r LEFT JOIN fonte_pagadora f ON f.id = r.fonte_pagadora_id
         LEFT JOIN plano_fonte_pagadora pl ON pl.id = r.plano_fonte_pagadora_id WHERE r.agenda_servico_id = ? AND ${regras('r')}${vig('r')}
        ORDER BY r.id`,
      [agendaId, ...pv],
    ),
    l.consultar(
      `SELECT p.id, p.versao, p.item_agendavel_id, p.tipo, p.descricao, p.jejum_horas, ${D('p.vigencia_inicio')},
              ${D('p.vigencia_fim')}, p.situacao_revisao, p.texto_origem_agenda_id
         FROM agenda_preparo p WHERE p.agenda_servico_id = ? AND ${regras('p')}${vig('p')}
        ORDER BY p.id`,
      [agendaId, ...pv],
    ),
    l.consultar(
      `SELECT id, agenda_servico_id, fonte_pagadora_id, campo, texto, LOWER(HEX(hash_texto)) AS hash,
              situacao_estruturacao, versao_extrator
         FROM texto_origem_agenda WHERE agenda_servico_id = ? ORDER BY id`,
      [agendaId],
    ),
    l.consultar(
      `SELECT t.texto_origem_agenda_id, t.posicao_inicio, t.posicao_fim, t.interpretado, t.tipo_regra, t.motivo
         FROM trecho_texto_agenda t JOIN texto_origem_agenda o ON o.id = t.texto_origem_agenda_id
        WHERE o.agenda_servico_id = ? ORDER BY t.texto_origem_agenda_id, t.posicao_inicio`,
      [agendaId],
    ),
    l.consultar(
      `SELECT ${COLUNAS_REGRA} FROM regra_preco_particular r
        WHERE (r.agenda_servico_id = ? OR (r.profissional_id IS NOT NULL AND r.profissional_id = ?))
          AND r.ativo AND ${regras('r')}${vig('r')} ORDER BY r.id`,
      [agendaId, a['profissional_id'] ?? null, ...pv],
    ),
  ]);
  const porTexto = new Map<number, TrechoTexto[]>();
  for (const t of trechos) {
    const k = Number(t['texto_origem_agenda_id']);
    porTexto.set(k, [...(porTexto.get(k) ?? []), trechoDe(t)]);
  }
  const textoDe = (t: Linha): TextoOrigemAgenda => ({
    id: Number(t['id']),
    agendaId: Number(t['agenda_servico_id']),
    fontePagadoraId: t['fonte_pagadora_id'] === null ? null : Number(t['fonte_pagadora_id']),
    campo: String(t['campo']) as CampoTextoAgenda,
    texto: String(t['texto']),
    hash: String(t['hash']),
    situacao: String(t['situacao_estruturacao']) as TextoOrigemAgenda['situacao'],
    versaoExtrator: t['versao_extrator'] === null ? null : String(t['versao_extrator']),
    trechos: porTexto.get(Number(t['id'])) ?? [],
  });
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    agendaId: Number(a['id']),
    nome: String(a['nome']),
    codigoOrigem: a['codigo_origem'] === null ? null : String(a['codigo_origem']),
    estabelecimentoId: Number(a['estabelecimento_id']),
    estabelecimentoNome: String(a['estabelecimento_nome']),
    profissionalId: n(a['profissional_id']),
    profissionalNome: a['profissional_nome'] === null ? null : String(a['profissional_nome']),
    vigenciaInicio: a['vigencia_inicio'] === null ? null : String(a['vigencia_inicio']),
    vigenciaFim: a['vigencia_fim'] === null ? null : String(a['vigencia_fim']),
    padrao: {
      sexoAtendido: String(a['sexo_atendido']) as SexoAtendido,
      idadeMinimaAnos: n(a['idade_minima_anos']),
      idadeMaximaAnos: n(a['idade_maxima_anos']),
      aceitaRetorno: booleanoDoBanco(a['aceita_retorno']),
      diasRetorno: n(a['dias_retorno']),
      permiteEncaixe: booleanoDoBanco(a['permite_encaixe']),
      preparo: a['preparo'] === null ? null : String(a['preparo']),
    },
    convenios: convenios.map((c) => Number(c['fonte_pagadora_id'])),
    conveniosAceitos: convenios.map((c) => ({
      fontePagadoraId: Number(c['fonte_pagadora_id']),
      nome: String(c['nome']),
    })),
    coberturas: coberturas.map(coberturaDe),
    restricoes: restricoes.map(restricaoDe),
    preparos: preparos.map(preparoDe),
    precosParticulares: precos.map(regraPrecoParticularDe),
    textos: textos.map(textoDe),
  };
}

/** Campos da regra que a revisão muda (ADR 0009): confirmar, recusar ou corrigir a estimada. */
export interface AlteracaoRegraPrecoParticular {
  readonly valor?: number | undefined;
  readonly prioridade?: number | undefined;
  readonly vigenciaInicio?: string | undefined;
  readonly vigenciaFim?: string | null | undefined;
  readonly situacaoRevisao?: 'estimada' | 'confirmada' | 'recusada' | undefined;
  readonly observacao?: string | null | undefined;
}

const COLUNAS_ALTERACAO_REGRA: Readonly<Record<keyof AlteracaoRegraPrecoParticular, string>> = {
  valor: 'valor',
  prioridade: 'prioridade',
  vigenciaInicio: 'vigencia_inicio',
  vigenciaFim: 'vigencia_fim',
  situacaoRevisao: 'situacao_revisao',
  observacao: 'observacao',
};

/** Altera os campos informados da regra, com controle de versão. Devolve as linhas afetadas (0 = versão divergente). */
export async function alterarRegraPrecoParticular(
  e: Escritor,
  id: number,
  versaoEsperada: number,
  v: AlteracaoRegraPrecoParticular,
  usuario: number | null,
): Promise<number> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of Object.keys(COLUNAS_ALTERACAO_REGRA) as (keyof AlteracaoRegraPrecoParticular)[]) {
    if (v[k] === undefined) continue;
    sets.push(`${COLUNAS_ALTERACAO_REGRA[k]} = ?`);
    params.push(v[k]);
  }
  sets.push('versao = versao + 1', 'alterado_em = CURRENT_TIMESTAMP(3)', 'alterado_por = ?');
  return e.executar(
    `UPDATE regra_preco_particular SET ${sets.join(', ')} WHERE id = ? AND versao = ? AND excluido_em IS NULL`,
    [...params, usuario, id, versaoEsperada],
  );
}

/**
 * Credenciamentos vigentes na data e no estabelecimento (ou na rede) por profissional, por convênio ou pelo par: a
 * ficha do profissional lista os convênios dele e a do convênio, os profissionais. Ao menos um filtro é obrigatório.
 */
export async function listarCredenciamentosVigentes(
  l: Leitor,
  q: {
    readonly profissionalId: number | null;
    readonly fontePagadoraId: number | null;
    readonly estabelecimentoId: number;
    readonly data: string;
  },
): Promise<Credenciamento[]> {
  if (q.profissionalId === null && q.fontePagadoraId === null)
    throw new Error('listarCredenciamentosVigentes: informe o profissional ou o convênio');
  const filtros: string[] = [];
  const params: unknown[] = [];
  if (q.profissionalId !== null) {
    filtros.push('c.profissional_id = ?');
    params.push(q.profissionalId);
  }
  if (q.fontePagadoraId !== null) {
    filtros.push('c.fonte_pagadora_id = ?');
    params.push(q.fontePagadoraId);
  }
  const ls = await l.consultar(
    `SELECT ${COLUNAS_CRED} FROM profissional_fonte_pagadora c ${NOMES_CRED}
      WHERE ${filtros.join(' AND ')} AND c.excluido_em IS NULL
        AND (c.estabelecimento_id IS NULL OR c.estabelecimento_id = ?) AND ${VIGENTE('c')}
      ORDER BY c.id`,
    [...params, q.estabelecimentoId, q.data, q.data],
    { teto: 5000 },
  );
  return ls.map(credenciamentoDe);
}

/** Resultado de aplicar os valores de consulta da origem de uma fonte já classificada. */
export interface ResultadoPrecoConsultaOrigem {
  readonly aplicadas: number;
  readonly descartadas: number;
}

/**
 * Pendência 1 do ADR 0009: o valor de consulta da origem (preco_consulta_origem) espera a classificação da fonte. Com a
 * fonte de tipo particular, cada linha pendente vira regra_preco_particular (alvo consulta, dono o profissional,
 * origem migracao) e fica "aplicada" com a regra ligada; com outro tipo fica "descartada" (decisão 24: não existe
 * preço por médico em convênio). Idempotente: só toca as pendentes. Fonte ainda de tipo "outro" não decide nada.
 */
export async function aplicarPrecosConsultaOrigem(
  e: Escritor,
  fontePagadoraId: number,
  usuario: number | null,
): Promise<ResultadoPrecoConsultaOrigem> {
  const f = await e.uma('SELECT tipo FROM fonte_pagadora WHERE id = ?', [fontePagadoraId]);
  if (!f || String(f['tipo']) === 'outro') return { aplicadas: 0, descartadas: 0 };
  const pendentes = await e.consultarParaAtualizar(
    `SELECT id, estabelecimento_id, profissional_id, valor, ${D('vigencia_inicio')}, ${D('vigencia_fim')}
       FROM preco_consulta_origem WHERE fonte_pagadora_id = ? AND situacao = 'pendente' ORDER BY id`,
    [fontePagadoraId],
  );
  if (String(f['tipo']) !== 'particular') {
    if (pendentes.length > 0)
      await e.executar(
        `UPDATE preco_consulta_origem SET situacao = 'descartada', decidido_em = CURRENT_TIMESTAMP(3),
                motivo_situacao = 'Fonte não particular: não existe preço por médico em convênio (ADR 0009, decisão 24)',
                alterado_em = CURRENT_TIMESTAMP(3), alterado_por = ?, versao = versao + 1
          WHERE fonte_pagadora_id = ? AND situacao = 'pendente'`,
        [usuario, fontePagadoraId],
      );
    return { aplicadas: 0, descartadas: pendentes.length };
  }
  for (const p of pendentes) {
    const regra = await e.inserir(
      `INSERT INTO regra_preco_particular (estabelecimento_id, fonte_pagadora_id, profissional_id, alvo, valor,
         vigencia_inicio, vigencia_fim, origem, observacao, criado_em, criado_por)
       VALUES (?, ?, ?, 'consulta', ?, ?, ?, 'migracao', 'Valor de consulta do profissional na origem (ADR 0009)',
               CURRENT_TIMESTAMP(3), ?)`,
      [
        p['estabelecimento_id'] ?? null,
        fontePagadoraId,
        p['profissional_id'],
        p['valor'],
        p['vigencia_inicio'],
        p['vigencia_fim'] ?? null,
        usuario,
      ],
    );
    await e.executar(
      `UPDATE preco_consulta_origem SET situacao = 'aplicada', regra_preco_particular_id = ?,
              decidido_em = CURRENT_TIMESTAMP(3), alterado_em = CURRENT_TIMESTAMP(3), alterado_por = ?,
              versao = versao + 1
        WHERE id = ?`,
      [regra, usuario, p['id']],
    );
  }
  return { aplicadas: pendentes.length, descartadas: 0 };
}
