// Porta própria das integrações no worker: as leituras e gravações da entrega aos parceiros sobre o banco do cliente
// (MariaDB pelo @sgh/nucleo), no mesmo modelo da porta das integrações da API.
// Tabelas: parceiro_dados, sistema_externo, ponto_integracao, padrao_troca, mensagem_integracao_saida, falha_integracao,
// integracao_mensagem, marca_sincronismo e estabelecimento; os fatos: liberacao_exame, remessa_laboratorio_apoio(_item),
// exame_item e requisicao_exame; o conteúdo: exame, exame_laboratorio_apoio, paciente, pessoa_fisica, sexo, atendimento,
// profissional, item_lista_trabalho_imagem, modalidade_imagem, vacina_aplicada, imunobiologico, via_de_uso e
// regiao_corporal; a liberação: liberacao_chave e recurso_prerequisito.
// Toda leitura de dado do estabelecimento filtra pelo código do estabelecimento; o parceiro é do cliente inteiro.
// Melhoria: a mensagem esgotada abre a falha tratável (falha_integracao: quando, a causa classificada, a situação e quem
// tratou), em vez de só uma marca de morto; a mensagem segura o objeto até ser tratada.
// Melhoria: o ponto de saída do parceiro é por estabelecimento, criado na primeira mensagem (MLLP para HL7 v2).
// Melhoria: a vacina para a rede nacional sai das versões do próprio registro (a original e as retificações), com o
// código do imunobiológico na rede nacional quando cadastrado.
// Melhoria: a marca d'água da vigia fica no ponto de corte por tabela (marca_sincronismo), sem escrita quando não anda.
// Melhoria: o fato do resultado segue o estado da liberação (dominio-integracao: fatoDaLiberacao): a liberação desfeita
// ou revogada não sai como liberada e a retirada sai como "fato.resultado.revogado".
// Melhoria: o pedido ao laboratório de apoio nasce na remessa fechada e nunca para exame cancelado ou recusado.
// Melhoria: a mensagem é RESERVADA (situação "enviando", pela versão lida na fila) antes do envio; a marca do envio
// confere a versão da reserva: duas réplicas do worker nunca mandam a mesma mensagem duas vezes, e o descarte pela tela
// no meio do envio vira conflito de versão em vez de ser sobrescrito.
// Melhoria: as horas locais (RIA e lista de trabalho) saem no fuso do estabelecimento (estabelecimento.fuso_horario).
import { createHash } from 'node:crypto';
import {
  type DepoisDaFalha,
  ETAPAS_LIBERACAO_VIGIADAS,
  EVENTO_RESULTADO_LIBERADO,
  type EventoLiberacao,
  fatoDaLiberacao,
  type RegistroVacinaRia,
  reservaVencida,
  SITUACOES_EXAME_SEM_PEDIDO,
  SITUACOES_REMESSA_COM_PEDIDO,
} from '@sgh/dominio-integracao';
import { erroConflitoVersao, gravarOutbox, type Leitor, type Linha, recusa, type TxOperacao } from '@sgh/nucleo';

// ---- conversões ----

const texto = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const inteiro = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const booleano = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 1n;
const idDe = (v: string | null | undefined): number | null => (v && /^\d{1,15}$/.test(v) ? Number(v) : null);

export function data(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v;
  const t = String(v);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t.replace(' ', 'T')}Z`);
}

function dia(v: unknown): string | null {
  if (v instanceof Date)
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const t = texto(v);
  return t ? t.slice(0, 10) : null;
}

function lista(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== 'string' || v === '') return [];
  try {
    const x: unknown = JSON.parse(v);
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
}

/** O fuso padrão da coluna estabelecimento.fuso_horario (o mesmo default do DDL). */
export const FUSO_PADRAO = 'America/Sao_Paulo';

/** Hora local (AAAA-MM-DDTHH:mm) do instante no fuso IANA do estabelecimento (RIA e lista de trabalho). */
export function horaLocal(d: Date, fuso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p['year']}-${p['month']}-${p['day']}T${p['hour']}:${p['minute']}`;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** O estabelecimento da operação (o acesso resolve o código antes de abrir a transação). */
function estabelecimentoDa(tx: TxOperacao): number {
  const est = tx.contexto.estabelecimento;
  if (typeof est !== 'number') throw recusa('sem-estabelecimento', 'A gravação da integração exige o estabelecimento.');
  return est;
}

// ---- parceiros e estabelecimentos ----

export interface ParceiroEntrega {
  readonly id: string;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: string;
  readonly canal: string | null;
  readonly eventos: readonly string[];
  readonly limiteTentativas: number;
  readonly ativo: boolean;
}

const parceiroDaLinha = (x: Linha): ParceiroEntrega => ({
  id: String(x['id']),
  codigo: String(x['codigo']),
  nome: String(x['nome']),
  tipo: String(x['tipo']),
  canal: texto(x['canal']),
  eventos: lista(x['eventos']),
  limiteTentativas: inteiro(x['limite_tentativas']),
  ativo: booleano(x['ativo']),
});

/** Os parceiros do cliente inteiro (dado da rede: o cadastro do parceiro vale para todos os estabelecimentos). */
export async function lerParceiros(l: Leitor): Promise<ParceiroEntrega[]> {
  return (
    await l.consultar(
      `SELECT id, codigo, nome, tipo, canal, eventos, limite_tentativas, ativo FROM parceiro_dados
        WHERE excluido_em IS NULL ORDER BY codigo`,
      [],
      { teto: 1000 },
    )
  ).map(parceiroDaLinha);
}

/** Os códigos dos estabelecimentos do cliente (o ciclo do worker passa por todos). */
export async function lerEstabelecimentos(l: Leitor): Promise<string[]> {
  return (
    await l.consultar('SELECT codigo FROM estabelecimento WHERE excluido_em IS NULL ORDER BY codigo', [], { teto: 1000 })
  ).map((x) => String(x['codigo']));
}

/** A mensagem da fila comum (outbox) do evento, pela chave, no estabelecimento. */
export async function idDaOutbox(l: Leitor, hospital: string, chave: string): Promise<string | null> {
  const r = await l.uma<{ id: unknown }>(
    `SELECT m.id FROM integracao_mensagem m JOIN estabelecimento e ON e.id = m.estabelecimento_id
      WHERE m.referencia_externa = ? AND m.direcao = 'saida' AND e.codigo = ? ORDER BY m.id LIMIT 1`,
    [chave, hospital],
  );
  return r ? String(r.id) : null;
}

// ---- mensagens de saída ----

export type SituacaoEnvio = 'pendente' | 'enviado' | 'morto' | 'descartado';
export type TratamentoEnvio = 'reprocessar' | 'corrigir' | 'descartar';

export interface NovoEnvio {
  /** A mensagem da fila comum que originou o envio. */
  readonly idOutbox: string;
  readonly chaveEvento: string;
  readonly tipoEvento: string;
  readonly parceiro: string;
  readonly chaveOrdem: string;
  /** Tabela do objeto do evento (exame_item, vacina_aplicada) e o seu id; a vacina leva a versão ("7.2"). */
  readonly entidade: string | null;
  readonly objeto: string | null;
}

export interface EnvioEntrega extends NovoEnvio {
  readonly id: string;
  /** A versão da mensagem lida na fila (a reserva confere por ela). */
  readonly versao: number;
  /** Quando outro processo reservou a mensagem (situação "enviando"); null quando não está reservada. */
  readonly reservadaEm: Date | null;
  readonly situacao: SituacaoEnvio;
  readonly tentativas: number;
  readonly proximaTentativaEm: Date | null;
  readonly enviadoEm: Date | null;
  readonly recibo: string | null;
  readonly resposta: string | null;
  readonly hashConteudo: string | null;
  readonly mortoEm: Date | null;
  readonly tratamento: TratamentoEnvio | null;
  readonly criadoEm: Date;
}

/** Situação da mensagem de saída → vocabulário da fila (o mesmo da API). */
export function situacaoDoEnvio(s: string): SituacaoEnvio {
  if (s === 'enviada' || s === 'confirmada') return 'enviado';
  if (s === 'erro' || s === 'rejeitada' || s === 'expirada') return 'morto';
  if (s === 'cancelada') return 'descartado';
  return 'pendente';
}

function tratamentoDaFalha(s: unknown): TratamentoEnvio | null {
  if (s === 'reprocessada') return 'reprocessar';
  if (s === 'resolvida') return 'corrigir';
  if (s === 'descartada') return 'descartar';
  return null;
}

/** A causa da falha pela resposta curta do envio (a fila de mortos agrupa e o monitor filtra por ela). */
export function categoriaDaFalha(
  resposta: string,
): 'tempo_esgotado' | 'indisponibilidade' | 'regra_negocio' | 'validacao' | 'desconhecida' {
  const r = resposta.toLowerCase();
  if (r.includes('tempo esgotado')) return 'tempo_esgotado';
  if (/indispon|conexão recusada|http 5\d\d/.test(r)) return 'indisponibilidade';
  if (/^(ae|ar):|recusad|http 4\d\d/.test(r)) return 'regra_negocio';
  if (/sem destino|sem canal|sem o |sem a |fora do loopback|não configurad|não encontrad|desligad|cancelad/.test(r))
    return 'validacao';
  return 'desconhecida';
}

const SQL_ENVIO = `
  SELECT s.id, s.versao, s.alterado_em, s.integracao_mensagem_id, s.chave_idempotencia, s.tipo_mensagem, p.codigo AS parceiro, s.correlacao,
         s.entidade, s.entidade_id, JSON_VALUE(s.conteudo, '$.versao') AS versao_objeto, s.situacao, s.tentativas,
         s.proxima_tentativa_em, s.enviada_em, s.codigo_resposta, s.recibo, s.resposta, s.hash_sha256, s.criado_em,
         f.ocorrido_em AS morto_em, f.situacao AS falha_situacao
    FROM mensagem_integracao_saida s
    JOIN estabelecimento e ON e.id = s.estabelecimento_id
    JOIN parceiro_dados p ON p.sistema_externo_id = s.sistema_externo_id AND p.excluido_em IS NULL
    LEFT JOIN falha_integracao f ON f.id = (SELECT MAX(f2.id) FROM falha_integracao f2
                                             WHERE f2.mensagem_integracao_saida_id = s.id AND f2.excluido_em IS NULL)
   WHERE e.codigo = ? AND s.excluido_em IS NULL`;

function envioDaLinha(x: Linha): EnvioEntrega {
  const entidade = texto(x['entidade']);
  const id = texto(x['entidade_id']);
  const versao = idDe(texto(x['versao_objeto']));
  return {
    id: String(x['id']),
    versao: inteiro(x['versao']),
    reservadaEm: String(x['situacao']) === 'enviando' ? data(x['alterado_em']) : null,
    idOutbox: texto(x['integracao_mensagem_id']) ?? '',
    chaveEvento: String(x['chave_idempotencia']),
    tipoEvento: texto(x['tipo_mensagem']) ?? '',
    parceiro: String(x['parceiro']),
    chaveOrdem: texto(x['correlacao']) ?? '',
    entidade,
    objeto: id === null ? null : entidade === 'vacina_aplicada' ? `${id}.${versao ?? 0}` : id,
    situacao: situacaoDoEnvio(String(x['situacao'])),
    tentativas: inteiro(x['tentativas']),
    proximaTentativaEm: data(x['proxima_tentativa_em']),
    enviadoEm: data(x['enviada_em']),
    recibo: texto(x['recibo']) ?? texto(x['codigo_resposta']),
    resposta: texto(x['resposta']),
    hashConteudo: texto(x['hash_sha256']),
    mortoEm: data(x['morto_em']),
    tratamento: tratamentoDaFalha(x['falha_situacao']),
    criadoEm: data(x['criado_em']) ?? new Date(0),
  };
}

/** A fila do estabelecimento: as pendentes e as mortas (a morta segura o objeto até ser tratada), em ordem de chegada. */
export async function filaDeEnvio(l: Leitor, hospital: string): Promise<EnvioEntrega[]> {
  return (
    await l.consultar(
      `${SQL_ENVIO} AND s.situacao IN ('pendente', 'enviando', 'erro', 'rejeitada', 'expirada') ORDER BY s.id LIMIT 2000`,
      [hospital],
      { teto: 2000 },
    )
  ).map(envioDaLinha);
}

/** A fila de mortos do estabelecimento (a mais antiga primeiro). */
export async function lerMortos(l: Leitor, hospital: string, limite: number): Promise<EnvioEntrega[]> {
  const n = Math.max(1, Math.min(Math.trunc(limite) || 1, 1000));
  return (
    await l.consultar(
      `${SQL_ENVIO} AND s.situacao IN ('erro', 'rejeitada', 'expirada') ORDER BY f.ocorrido_em, s.id LIMIT ${n}`,
      [hospital],
      { teto: n },
    )
  ).map(envioDaLinha);
}

const FAMILIA_DO_TIPO: Readonly<Record<string, string>> = {
  hl7: 'hl7v2',
  apoio: 'hl7v2',
  fhir: 'fhir',
  api: 'api',
  arquivo: 'arquivo',
};
const CATEGORIA_DO_TIPO: Readonly<Record<string, string>> = {
  apoio: 'laboratorio',
  governo: 'governo',
  hl7: 'outro',
  fhir: 'outro',
};

/** O sistema externo do parceiro (o parceiro carregado sem ele ganha um aqui, como na API). */
async function sistemaDo(tx: TxOperacao, p: Linha): Promise<number> {
  if (p['sistema_externo_id'] !== null && p['sistema_externo_id'] !== undefined) return Number(p['sistema_externo_id']);
  const ja = await tx.uma<{ id: unknown }>('SELECT id FROM sistema_externo WHERE codigo = ? AND excluido_em IS NULL', [
    String(p['codigo']),
  ]);
  const id =
    ja !== null
      ? Number(ja.id)
      : await tx.incluir('sistema_externo', {
          codigo: String(p['codigo']),
          nome: String(p['nome']),
          categoria: CATEGORIA_DO_TIPO[String(p['tipo'])] ?? 'outro',
          finalidade: String(p['finalidade']).slice(0, 500),
          ambiente: 'producao',
          ativo: true,
        });
  await tx.alterar('parceiro_dados', Number(p['id']), Number(p['versao']), { sistema_externo_id: id });
  return id;
}

/** O ponto de saída do parceiro no estabelecimento (criado na primeira mensagem; desativado, recusa). */
async function pontoDeSaida(tx: TxOperacao, est: number, p: Linha): Promise<{ ponto: number; sistema: number }> {
  const sistema = await sistemaDo(tx, p);
  const codigo = `parceiro.${String(p['codigo'])}.saida`;
  const ja = await tx.uma<{ id: unknown; ativo: unknown }>(
    'SELECT id, ativo FROM ponto_integracao WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
    [est, codigo],
  );
  if (ja) {
    if (!booleano(ja.ativo)) throw recusa('ponto-desativado', 'O ponto de integração do parceiro está desativado.');
    return { ponto: Number(ja.id), sistema };
  }
  const familia = FAMILIA_DO_TIPO[String(p['tipo'])] ?? 'proprio';
  const padrao = await tx.uma<{ id: unknown }>(
    'SELECT id FROM padrao_troca WHERE familia = ? AND ativo ORDER BY id LIMIT 1',
    [familia],
  );
  if (!padrao) throw recusa('modelo-pendente', `O padrão de troca "${familia}" não está cadastrado neste cliente.`);
  const ponto = await tx.incluir('ponto_integracao', {
    estabelecimento_id: est,
    codigo,
    nome: `${String(p['nome'])} (saida)`.slice(0, 150),
    sistema_externo_id: sistema,
    padrao_troca_id: Number(padrao.id),
    direcao: 'saida',
    transporte: familia === 'hl7v2' ? 'mllp' : 'http_rest',
    formato_conteudo: familia === 'hl7v2' ? 'hl7v2' : 'json',
    limite_tentativas: Math.max(1, Math.min(inteiro(p['limite_tentativas']) || 5, 50)),
    ambiente: 'producao',
    ativo: true,
  });
  return { ponto, sistema };
}

/**
 * O consumidor idempotente: a mensagem de saída do parceiro para o evento, UMA vez por ponto do estabelecimento e
 * chave do evento (a restrição única do banco e a conferência travada antes da inclusão). Devolve se incluiu.
 */
export async function registrarEnvio(tx: TxOperacao, n: NovoEnvio): Promise<boolean> {
  const est = estabelecimentoDa(tx);
  const [p] = await tx.consultarParaAtualizar(
    `SELECT id, versao, codigo, nome, tipo, finalidade, limite_tentativas, sistema_externo_id, ativo
       FROM parceiro_dados WHERE codigo = ? AND excluido_em IS NULL`,
    [n.parceiro],
  );
  if (!p) throw recusa('parceiro-desconhecido', 'O parceiro da entrega não está cadastrado.');
  const { ponto, sistema } = await pontoDeSaida(tx, est, p);
  const chave = n.chaveEvento.slice(0, 150);
  const ja = await tx.consultarParaAtualizar(
    'SELECT id FROM mensagem_integracao_saida WHERE ponto_integracao_id = ? AND chave_idempotencia = ?',
    [ponto, chave],
  );
  if (ja.length > 0) return false;
  const origem = idDe(n.idOutbox);
  const carga = origem
    ? await tx.uma<{ conteudo: unknown }>(
        'SELECT conteudo FROM integracao_mensagem WHERE id = ? AND estabelecimento_id = ?',
        [origem, est],
      )
    : null;
  const [idObjeto, versaoObjeto] = (n.objeto ?? '').split('.');
  await tx.incluir('mensagem_integracao_saida', {
    estabelecimento_id: est,
    ponto_integracao_id: ponto,
    sistema_externo_id: sistema,
    integracao_mensagem_id: carga ? origem : null,
    entidade: n.entidade?.slice(0, 64) ?? null,
    entidade_id: idDe(idObjeto),
    chave_idempotencia: chave,
    correlacao: n.chaveOrdem.slice(0, 64),
    tipo_mensagem: n.tipoEvento.slice(0, 60),
    formato: 'json',
    conteudo:
      texto(carga?.conteudo) ??
      JSON.stringify({ evento: n.tipoEvento, chave, ...(idDe(versaoObjeto) !== null ? { versao: idDe(versaoObjeto) } : {}) }),
    situacao: 'pendente',
    tentativas: 0,
    tentativas_maximas: Math.max(1, inteiro(p['limite_tentativas']) || 5),
  });
  return true;
}

/** Trava a mensagem reservada por este processo: a versão da reserva e a situação "enviando"; senão, conflito. */
async function travarEnvio(tx: TxOperacao, id: string, versao: number): Promise<Linha | null> {
  if (!/^\d{1,15}$/.test(id)) return null;
  const [s] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, ponto_integracao_id FROM mensagem_integracao_saida
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [Number(id), estabelecimentoDa(tx)],
  );
  if (!s) return null;
  if (Number(s['versao']) !== versao) throw erroConflitoVersao(['versao']);
  if (s['situacao'] !== 'enviando') throw erroConflitoVersao(['situacao']);
  return s;
}

/**
 * Reserva a mensagem para o envio (situação "enviando"), pela versão lida na fila: só a pendente, ou a reservada por
 * um processo que caiu (reserva vencida). Devolve a versão da reserva, ou null quando outro processo já a pegou ou a
 * tela a mudou desde a leitura (nada é enviado).
 */
export async function reservarEnvio(tx: TxOperacao, id: string, versaoLida: number, agora: Date): Promise<number | null> {
  if (!/^\d{1,15}$/.test(id)) return null;
  const [s] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, alterado_em FROM mensagem_integracao_saida
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [Number(id), estabelecimentoDa(tx)],
  );
  if (!s || Number(s['versao']) !== versaoLida) return null;
  const livre =
    s['situacao'] === 'pendente' || (s['situacao'] === 'enviando' && reservaVencida(data(s['alterado_em']), agora));
  if (!livre) return null;
  return tx.alterar('mensagem_integracao_saida', Number(s['id']), versaoLida, { situacao: 'enviando' });
}

export interface ReciboEnvio {
  readonly recibo: string | null;
  readonly resposta: string | null;
  /** Resumo SHA-256 do conteúdo enviado (o conteúdo vai ao armazém de objetos, nunca ao log). */
  readonly hash: string;
}

/** A mensagem entregue: a situação, o recibo, a resposta curta e o resumo do conteúdo (trava pela versão da reserva). */
export async function marcarEnviado(tx: TxOperacao, id: string, versao: number, r: ReciboEnvio): Promise<number> {
  const s = await travarEnvio(tx, id, versao);
  if (!s) return 0;
  const recibo = r.recibo?.slice(0, 120) ?? null;
  await tx.alterar('mensagem_integracao_saida', Number(s['id']), Number(s['versao']), {
    situacao: 'enviada',
    enviada_em: new Date(),
    proxima_tentativa_em: null,
    // O código curto da resposta (até 30) e o recibo inteiro (até 120) na coluna própria (17_INTG/05).
    codigo_resposta: recibo?.slice(0, 30) ?? null,
    recibo,
    resposta: r.resposta,
    hash_sha256: r.hash,
  });
  return 1;
}

export type FalhaEnvio = DepoisDaFalha & { readonly resposta: string; readonly hash: string | null };

/** A falha do envio: a retentativa agendada ou, esgotado o limite, a mensagem com erro e a falha tratável aberta. */
export async function marcarFalhaEnvio(tx: TxOperacao, id: string, versao: number, d: FalhaEnvio): Promise<number> {
  const s = await travarEnvio(tx, id, versao);
  if (!s) return 0;
  const resposta = d.resposta.slice(0, 2000) || 'falha no envio';
  const hash = d.hash ? { hash_sha256: d.hash } : {};
  if (d.situacao === 'pendente') {
    await tx.alterar('mensagem_integracao_saida', Number(s['id']), Number(s['versao']), {
      situacao: 'pendente',
      tentativas: d.tentativas,
      proxima_tentativa_em: d.proximaEm,
      resposta,
      ...hash,
    });
    return 1;
  }
  await tx.alterar('mensagem_integracao_saida', Number(s['id']), Number(s['versao']), {
    situacao: 'erro',
    tentativas: d.tentativas,
    proxima_tentativa_em: null,
    resposta,
    ...hash,
  });
  await tx.incluir('falha_integracao', {
    estabelecimento_id: estabelecimentoDa(tx),
    ponto_integracao_id: Number(s['ponto_integracao_id']),
    mensagem_integracao_saida_id: Number(s['id']),
    etapa: 'envio',
    categoria_causa: categoriaDaFalha(resposta),
    gravidade: 'erro',
    mensagem: resposta,
    ocorrido_em: d.mortoEm,
    situacao: 'aberta',
    origem: 'sistema',
  });
  return 1;
}

// ---- vigia dos fatos ----

export interface MarcaFato {
  readonly ultimoId: string;
  readonly ultimoCarimbo: Date | null;
}

const SISTEMA_VIGIA = 'integracao';

/** A marca d'água do fato no estabelecimento ("carimbo|id"); sem marca, o começo. */
export async function lerMarcaFato(l: Leitor, hospital: string, fato: string): Promise<MarcaFato> {
  const r = await l.uma<{ valor_marca: unknown }>(
    `SELECT m.valor_marca FROM marca_sincronismo m JOIN estabelecimento e ON e.id = m.estabelecimento_id
      WHERE e.codigo = ? AND m.sistema_origem = ? AND m.tabela_origem = ? AND m.ativo`,
    [hospital, SISTEMA_VIGIA, fato],
  );
  const m = /^(\S+)\|(\d{1,20})$/.exec(texto(r?.valor_marca) ?? '');
  const carimbo = m ? new Date(m[1]!) : null;
  return carimbo && !Number.isNaN(carimbo.getTime()) ? { ultimoId: m![2]!, ultimoCarimbo: carimbo } : { ultimoId: '0', ultimoCarimbo: null };
}

/** Grava a marca nova na transação dos eventos; sem mudança, nada grava. */
export async function gravarMarcaFato(tx: TxOperacao, fato: string, m: MarcaFato): Promise<void> {
  if (!m.ultimoCarimbo) return;
  const est = estabelecimentoDa(tx);
  const valor = `${m.ultimoCarimbo.toISOString()}|${m.ultimoId}`;
  const [x] = await tx.consultarParaAtualizar(
    `SELECT id, versao, valor_marca FROM marca_sincronismo
      WHERE estabelecimento_id = ? AND sistema_origem = ? AND tabela_origem = ?`,
    [est, SISTEMA_VIGIA, fato],
  );
  if (x && texto(x['valor_marca']) === valor) return;
  if (x)
    await tx.alterar('marca_sincronismo', Number(x['id']), Number(x['versao']), {
      valor_marca: valor,
      marcado_em: new Date(),
      ativo: true,
    });
  else
    await tx.incluir('marca_sincronismo', {
      estabelecimento_id: est,
      sistema_origem: SISTEMA_VIGIA,
      tabela_origem: fato,
      tipo_marca: 'data_hora',
      valor_marca: valor,
      marcado_em: new Date(),
      ativo: true,
    });
}

export interface FatoDoExame {
  /** A linha do fato (a liberação, o item da remessa): o cursor da vigia e a versão do fato. */
  readonly id: number;
  readonly exame: number;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly carimbo: Date;
  /**
   * O evento que a linha gera, quando a regra do fato decide por linha (o resultado: liberado, revogado ou nenhum).
   * Ausente: o evento do fato vigiado.
   */
  readonly evento?: string | null;
}

export interface OpcoesLeituraFato {
  /** O avanço pela chave composta (carimbo, id) depois da marca. */
  readonly depoisDoId?: number;
  /** A releitura limitada até a marca. */
  readonly ate?: Date;
}

async function lerFatos(
  l: Leitor,
  base: string,
  parametrosBase: readonly unknown[],
  desde: Date | null,
  lote: number,
  o: OpcoesLeituraFato,
): Promise<FatoDoExame[]> {
  const filtros: string[] = [];
  const p: unknown[] = [...parametrosBase];
  if (desde) {
    if (o.depoisDoId !== undefined) {
      filtros.push('(f.carimbo > ? OR (f.carimbo = ? AND f.id > ?))');
      p.push(desde, desde, o.depoisDoId);
    } else {
      filtros.push('f.carimbo >= ?');
      p.push(desde);
    }
  }
  if (o.ate) {
    filtros.push('f.carimbo <= ?');
    p.push(o.ate);
  }
  const n = Math.max(1, Math.min(Math.trunc(lote) || 1, 5000));
  const linhas = await l.consultar(
    `SELECT f.id, f.exame, f.paciente, f.atendimento, f.carimbo FROM (${base}) f
      ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''} ORDER BY f.carimbo, f.id LIMIT ${n}`,
    p,
    { teto: n },
  );
  return linhas.map((x) => ({
    id: Number(x['id']),
    exame: Number(x['exame']),
    paciente: Number(x['paciente']),
    atendimento: x['atendimento'] === null || x['atendimento'] === undefined ? null : Number(x['atendimento']),
    carimbo: data(x['carimbo']) ?? new Date(0),
  }));
}

/**
 * O resultado liberado ou retirado: cada linha vigiada do histórico da liberação (liberação clínica e revogação, de
 * qualquer operação) com o evento que ela gera pelo histórico INTEIRO do exame (dominio-integracao: fatoDaLiberacao).
 * A linha que não gera fato volta com evento null: a marca anda sobre ela.
 */
export async function fatosResultadoLiberado(
  l: Leitor,
  hospital: string,
  desde: Date | null,
  lote: number,
  o: OpcoesLeituraFato = {},
): Promise<FatoDoExame[]> {
  const etapas = placeholders(ETAPAS_LIBERACAO_VIGIADAS.length);
  const linhas = await lerFatos(
    l,
    `SELECT le.id, le.exame_item_id AS exame, q.paciente_id AS paciente, q.atendimento_id AS atendimento,
            le.ocorrido_em AS carimbo
       FROM liberacao_exame le
       JOIN exame_item ei ON ei.id = le.exame_item_id AND ei.excluido_em IS NULL
       JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id AND q.excluido_em IS NULL
       JOIN estabelecimento e ON e.id = q.estabelecimento_id
      WHERE e.codigo = ? AND le.etapa IN (${etapas})`,
    [hospital, ...ETAPAS_LIBERACAO_VIGIADAS],
    desde,
    lote,
    o,
  );
  if (linhas.length === 0) return [];
  const exames = [...new Set(linhas.map((x) => x.exame))];
  const hist = await l.consultar(
    `SELECT id, exame_item_id, etapa, operacao, ocorrido_em FROM liberacao_exame
      WHERE exame_item_id IN (${placeholders(exames.length)}) AND etapa IN (${etapas})`,
    [...exames, ...ETAPAS_LIBERACAO_VIGIADAS],
    { teto: 50_000 },
  );
  const porExame = new Map<number, EventoLiberacao[]>();
  for (const h of hist) {
    const k = Number(h['exame_item_id']);
    const lista = porExame.get(k) ?? [];
    lista.push({
      id: Number(h['id']),
      etapa: String(h['etapa']),
      operacao: String(h['operacao']),
      ocorridoEm: data(h['ocorrido_em']) ?? new Date(0),
    });
    porExame.set(k, lista);
  }
  return linhas.map((x) => ({ ...x, evento: fatoDaLiberacao(porExame.get(x.exame) ?? [], x.id) }));
}

/**
 * O exame que vai ao laboratório de apoio: o item da remessa por integração já fechada (a decisão do domínio:
 * SITUACOES_REMESSA_COM_PEDIDO), sem o exame cancelado ou recusado; o carimbo é o fechamento da remessa.
 */
export function fatosExameApoio(
  l: Leitor,
  hospital: string,
  desde: Date | null,
  lote: number,
  o: OpcoesLeituraFato = {},
): Promise<FatoDoExame[]> {
  return lerFatos(
    l,
    `SELECT i.id, i.exame_item_id AS exame, q.paciente_id AS paciente, q.atendimento_id AS atendimento,
            COALESCE(r.fechada_em, r.enviada_em, r.alterado_em, i.criado_em) AS carimbo
       FROM remessa_laboratorio_apoio_item i
       JOIN remessa_laboratorio_apoio r ON r.id = i.remessa_laboratorio_apoio_id AND r.excluido_em IS NULL
            AND r.meio_envio = 'integracao' AND r.situacao IN (${placeholders(SITUACOES_REMESSA_COM_PEDIDO.length)})
       JOIN exame_item ei ON ei.id = i.exame_item_id AND ei.excluido_em IS NULL
            AND ei.situacao NOT IN (${placeholders(SITUACOES_EXAME_SEM_PEDIDO.length)})
       JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id AND q.excluido_em IS NULL
       JOIN estabelecimento e ON e.id = r.estabelecimento_id
      WHERE e.codigo = ? AND i.excluido_em IS NULL AND i.situacao NOT IN ('cancelado', 'recusado')`,
    [...SITUACOES_REMESSA_COM_PEDIDO, ...SITUACOES_EXAME_SEM_PEDIDO, hospital],
    desde,
    lote,
    o,
  );
}

/** A chave do evento na fila comum: o resumo SHA-256 da chave composta (a mesma versão do fato, a mesma chave). */
export function chaveEvento(composta: string): string {
  return createHash('sha256').update(composta, 'utf8').digest('hex');
}

/** A fila comum do estabelecimento já tem o evento desta chave. */
export async function outboxTemChave(tx: TxOperacao, chave: string): Promise<boolean> {
  const r = await tx.uma(
    `SELECT 1 AS x FROM integracao_mensagem
      WHERE estabelecimento_id = ? AND direcao = 'saida' AND referencia_externa = ? LIMIT 1`,
    [estabelecimentoDa(tx), chave],
  );
  return r !== null;
}

/**
 * A operação de origem já publicou o fato do exame (desde o carimbo, com a sobreposição de 5 s). O Executor grava o
 * evento com a entidade do alvo da operação (ex.: resultado_exame), por isso o casamento é pelo exame da carga; os
 * eventos da própria vigia (entidade do fato vigiado) ficam de fora, porque a chave da versão já os cobre.
 */
export async function fatoJaPublicado(
  tx: TxOperacao,
  tipo: string,
  exame: number,
  carimbo: Date,
  entidadeDaVigia: string,
): Promise<boolean> {
  const r = await tx.uma(
    `SELECT 1 AS x FROM integracao_mensagem
      WHERE estabelecimento_id = ? AND direcao = 'saida' AND ponto = ? AND JSON_VALUE(conteudo, '$.exame') = ?
        AND (entidade IS NULL OR entidade <> ?) AND criado_em >= ? LIMIT 1`,
    [estabelecimentoDa(tx), tipo, String(exame), entidadeDaVigia, new Date(carimbo.getTime() - 5_000)],
  );
  return r !== null;
}

/** O parceiro já recebeu (na fila comum) o resultado liberado do exame: a retirada só vale depois dele. */
export async function liberacaoPublicada(tx: TxOperacao, exame: number): Promise<boolean> {
  const r = await tx.uma(
    `SELECT 1 AS x FROM integracao_mensagem
      WHERE estabelecimento_id = ? AND direcao = 'saida' AND ponto = ? AND JSON_VALUE(conteudo, '$.exame') = ? LIMIT 1`,
    [estabelecimentoDa(tx), EVENTO_RESULTADO_LIBERADO, String(exame)],
  );
  return r !== null;
}

/** O evento do fato na fila comum (a carga leva só ids). */
export function publicarFato(
  tx: TxOperacao,
  ev: {
    readonly tipo: string;
    readonly chave: string;
    readonly entidade: string;
    readonly entidadeId: number;
    readonly carga: Readonly<Record<string, number | null>>;
  },
): Promise<number> {
  return gravarOutbox(tx, {
    estabelecimento: estabelecimentoDa(tx),
    ponto: ev.tipo,
    entidade: ev.entidade,
    entidadeId: ev.entidadeId,
    chave: ev.chave,
    carga: ev.carga,
    usuario: null,
    agora: new Date(),
  });
}

// ---- conteúdo das mensagens ----

export interface ExamePedido {
  readonly id: number;
  readonly cancelado: boolean;
  readonly urgente: boolean;
  readonly paciente: {
    readonly id: number;
    readonly prontuario: number;
    readonly nome: string;
    readonly nascimento: string | null;
    readonly sexo: 'M' | 'F' | 'U';
  };
  /** O número do atendimento (o id quando o número não é numérico). */
  readonly atendimento: number;
  readonly exame: { readonly codigo: string; readonly nome: string };
  /** O exame no catálogo do laboratório de apoio (de-para), quando o exame vai ao apoio. */
  readonly apoio: { readonly codigo: string; readonly nome: string | null; readonly material: string | null } | null;
  readonly modalidade: string | null;
  readonly solicitadoEm: Date | null;
  readonly agendadoPara: Date | null;
  readonly solicitante: string | null;
  /** O fuso IANA do estabelecimento (as horas locais do conteúdo). */
  readonly fuso: string;
}

/** O exame pedido com o paciente, o atendimento, o de-para do apoio e a modalidade (lido na hora do envio). */
export async function examePedido(l: Leitor, hospital: string, id: number): Promise<ExamePedido | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const x = await l.uma(
    `SELECT ei.id, ei.situacao, ei.urgente, q.prioridade, q.solicitado_em, q.coleta_prevista_em, q.atendimento_id,
            a.numero AS atendimento_numero, ex.codigo AS exame_codigo, ex.nome AS exame_nome, p.id AS paciente_id,
            p.numero_prontuario, pf.nome AS paciente_nome, pf.data_nascimento, sx.sigla AS sexo,
            ela.codigo_exame_apoio, ela.nome_exame_apoio, ela.codigo_material_apoio, mi.sigla_padrao AS modalidade,
            ps.nome AS solicitante, e.fuso_horario
       FROM exame_item ei
       JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id AND q.excluido_em IS NULL
       JOIN estabelecimento e ON e.id = q.estabelecimento_id
       JOIN exame ex ON ex.id = ei.exame_id
       JOIN paciente p ON p.id = q.paciente_id
       JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
       LEFT JOIN sexo sx ON sx.id = pf.sexo_id
       LEFT JOIN atendimento a ON a.id = q.atendimento_id
       LEFT JOIN exame_laboratorio_apoio ela ON ela.exame_id = ei.exame_id
            AND ela.laboratorio_apoio_id = ei.laboratorio_apoio_id AND ela.ativo
       LEFT JOIN modalidade_imagem mi ON mi.id = ex.modalidade_imagem_id
       LEFT JOIN profissional pr ON pr.id = q.solicitante_profissional_id
       LEFT JOIN pessoa_fisica ps ON ps.id = pr.pessoa_fisica_id
      WHERE ei.id = ? AND e.codigo = ? AND ei.excluido_em IS NULL`,
    [id, hospital],
  );
  if (!x) return null;
  const sexo = String(x['sexo'] ?? '').toUpperCase();
  const numero = texto(x['atendimento_numero']);
  const codigoApoio = texto(x['codigo_exame_apoio']);
  return {
    id: Number(x['id']),
    cancelado: ['cancelado', 'recusado'].includes(String(x['situacao'])),
    urgente: booleano(x['urgente']) || String(x['prioridade']) !== 'rotina',
    paciente: {
      id: Number(x['paciente_id']),
      prontuario: Number(x['numero_prontuario']),
      nome: String(x['paciente_nome']),
      nascimento: dia(x['data_nascimento']),
      sexo: sexo === 'M' || sexo === 'F' ? sexo : 'U',
    },
    atendimento: numero && /^\d{1,15}$/.test(numero) ? Number(numero) : Number(x['atendimento_id']),
    exame: { codigo: String(x['exame_codigo']), nome: String(x['exame_nome']) },
    apoio: codigoApoio
      ? { codigo: codigoApoio, nome: texto(x['nome_exame_apoio']), material: texto(x['codigo_material_apoio']) }
      : null,
    modalidade: texto(x['modalidade']),
    solicitadoEm: data(x['solicitado_em']),
    agendadoPara: data(x['coleta_prevista_em']) ?? data(x['solicitado_em']),
    solicitante: texto(x['solicitante']),
    fuso: texto(x['fuso_horario']) ?? FUSO_PADRAO,
  };
}

/** O item vigente da lista de trabalho de imagem do exame (número de acesso e modalidade). */
export async function itemListaTrabalho(
  l: Leitor,
  hospital: string,
  exame: number,
): Promise<{ accession: string; modalidade: string | null } | null> {
  if (!Number.isInteger(exame) || exame <= 0) return null;
  const x = await l.uma(
    `SELECT it.numero_acesso, mi.sigla_padrao AS modalidade FROM item_lista_trabalho_imagem it
       JOIN estabelecimento e ON e.id = it.estabelecimento_id
       LEFT JOIN modalidade_imagem mi ON mi.id = it.modalidade_imagem_id
      WHERE it.exame_item_id = ? AND e.codigo = ? AND it.excluido_em IS NULL
        AND it.situacao NOT IN ('cancelado', 'descontinuado')
      ORDER BY it.id DESC LIMIT 1`,
    [exame, hospital],
  );
  return x ? { accession: String(x['numero_acesso']), modalidade: texto(x['modalidade']) } : null;
}

export interface VersaoVacina extends RegistroVacinaRia {
  /** O profissional que aplicou (id), como identificador no documento. */
  readonly vacinador: string;
}

export interface VacinaParaRia {
  readonly paciente: number;
  /** A versão 0 é a aplicação; a N, a N-ésima retificação. */
  readonly versoes: readonly VersaoVacina[];
}

/** A vacina com as retificações (a ordem delas é a versão), para o documento da rede nacional. */
export async function vacinaParaRia(l: Leitor, hospital: string, id: number): Promise<VacinaParaRia | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const linhas = await l.consultar(
    `SELECT v.id, v.vacina_aplicada_original_id AS original, v.paciente_id, v.dose, v.lote, v.fabricante, v.aplicada_em,
            v.aplicador_profissional_id, COALESCE(i.codigo_rnds, i.codigo) AS imuno, i.descricao AS imuno_nome,
            vu.codigo AS via, rc.codigo AS local, e.fuso_horario
       FROM vacina_aplicada v
       JOIN estabelecimento e ON e.id = v.estabelecimento_id
       JOIN imunobiologico i ON i.id = v.imunobiologico_id
       JOIN via_de_uso vu ON vu.id = v.via_de_uso_id
       JOIN regiao_corporal rc ON rc.id = v.regiao_corporal_id
      WHERE (v.id = ? OR v.vacina_aplicada_original_id = ?) AND e.codigo = ? AND v.excluido_em IS NULL
      ORDER BY v.id`,
    [id, id, hospital],
    { teto: 100 },
  );
  const original = linhas.find((x) => Number(x['id']) === id && x['original'] === null);
  if (!original) return null;
  const versoes = [original, ...linhas.filter((x) => Number(x['original']) === id)].map(
    (x): VersaoVacina => ({
      id,
      imunobiologico: String(x['imuno']),
      nome: String(x['imuno_nome']),
      lote: String(x['lote']),
      fabricante: texto(x['fabricante']),
      dose: String(x['dose']),
      via: String(x['via']),
      local: String(x['local']),
      aplicadaEm: horaLocal(data(x['aplicada_em']) ?? new Date(0), texto(x['fuso_horario']) ?? FUSO_PADRAO),
      vacinador: String(x['aplicador_profissional_id']),
    }),
  );
  return { paciente: Number(original['paciente_id']), versoes };
}

/** A vacina como valia na versão (a última retificação até ela). */
export function vacinaNaVersao(v: VacinaParaRia, versao: number): VersaoVacina {
  const i = Math.max(0, Math.min(Math.trunc(versao), v.versoes.length - 1));
  return v.versoes[i]!;
}

// ---- liberação do recurso ----

export interface ChaveRecursoLida {
  readonly chave: string;
  readonly tipo: 'recurso' | 'operacao';
  readonly escopo: string;
  readonly valor: string;
  readonly ligada: boolean | null;
}

export interface PrerequisitoLido {
  readonly recurso: string;
  readonly tipo: string;
  readonly situacao: string;
  /** AAAA-MM-DD; null: sem validade. */
  readonly validade: string | null;
}

/** As linhas da chave de liberação no estabelecimento (todos os escopos). */
export async function lerChavesLiberacao(l: Leitor, hospital: string, chave: string): Promise<ChaveRecursoLida[]> {
  return (
    await l.consultar(
      `SELECT c.chave, c.tipo, c.escopo, c.valor, c.ligada FROM liberacao_chave c
         JOIN estabelecimento e ON e.id = c.estabelecimento_id
        WHERE e.codigo = ? AND c.chave = ?`,
      [hospital, chave],
      { teto: 1000 },
    )
  ).map((x) => ({
    chave: String(x['chave']),
    tipo: x['tipo'] === 'recurso' ? 'recurso' : 'operacao',
    escopo: String(x['escopo']),
    valor: String(x['valor']),
    ligada: x['ligada'] === null || x['ligada'] === undefined ? null : booleano(x['ligada']),
  }));
}

/** Os pré-requisitos externos registrados do recurso no estabelecimento. */
export async function lerPrerequisitos(l: Leitor, hospital: string, recurso: string): Promise<PrerequisitoLido[]> {
  return (
    await l.consultar(
      `SELECT p.recurso, p.tipo, p.situacao, p.validade FROM recurso_prerequisito p
         JOIN estabelecimento e ON e.id = p.estabelecimento_id
        WHERE e.codigo = ? AND p.recurso = ?`,
      [hospital, recurso],
      { teto: 100 },
    )
  ).map((x) => ({
    recurso: String(x['recurso']),
    tipo: String(x['tipo']),
    situacao: String(x['situacao']),
    validade: dia(x['validade']),
  }));
}
