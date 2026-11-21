// Leituras comuns da recepção sobre o banco do cliente (F2.2), usadas pela porta própria e pelas operações do
// Executor: o estabelecimento da sessão (pelo código) e o fuso dele, a hora civil e a senha lida em vocabulário neutro
// (situação nominal, guichê nulo quando não há, grupo de prioridade pelo código), com o que os serviços precisam
// (chamadas, vínculos). A tradução para o contrato da tela fica em tela-senha.ts. SQL sempre parametrizado; toda leitura de tabela com
// estabelecimento_id filtra pelo estabelecimento da sessão.
//
// Melhoria: a situação da senha no banco é nominal ('aguardando', 'chamada', 'em_atendimento', 'atendida',
// 'suspensa'...), com CHECK; a letra que a tela mostra é derivada na tradução da tela, nunca gravada nem lida aqui.
import { textoSenha } from '@sgh/contratos';
import { type Leitor, type Linha, recusa } from '@sgh/nucleo';
import type { SenhaRecepcao, SituacaoSenha, TipoServico } from './tipos.js';

export const num = (v: unknown): number => Number(v);
export const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const bool = (v: unknown): boolean => v === true || Number(v) === 1;
export const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const txtOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export interface EstabelecimentoDaSessao {
  readonly id: number;
  readonly fuso: string;
}

/** O estabelecimento ativo (pelo código da sessão); ausente ou excluído: recusa 404. */
export async function estabelecimentoPorCodigo(l: Leitor, codigo: string): Promise<EstabelecimentoDaSessao> {
  const e = await l.uma(
    'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL AND ativo = TRUE',
    [codigo],
  );
  if (!e)
    throw recusa('estabelecimento-inexistente', 'O estabelecimento da sessão não existe ou está inativo.');
  return { id: num(e['id']), fuso: txt(e['fuso_horario']) || 'America/Sao_Paulo' };
}

/** Hora civil "AAAA-MM-DDTHH:mm:ss" do instante no fuso. */
export function horaCivil(d: Date, fuso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}:${v('second')}`;
}

export const civilOuNull = (v: unknown, fuso: string): string | null =>
  v instanceof Date ? horaCivil(v, fuso) : v ? horaCivil(new Date(String(v)), fuso) : null;

/** Data "AAAA-MM-DD" de uma coluna DATE (o driver devolve Date à meia-noite UTC). */
export function dataIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return txt(v).slice(0, 10);
}

/** O instante UTC da hora civil no fuso (para gravar o que a tela informa na hora local). */
export function instanteDaHoraCivil(civil: string, fuso: string): Date {
  const base = new Date(`${civil.length === 10 ? `${civil}T00:00:00` : civil.slice(0, 19)}Z`);
  // Desvio do fuso naquele instante (duas passadas cobrem a troca de horário de verão).
  let t = base.getTime();
  for (let i = 0; i < 2; i++) {
    const visto = new Date(`${horaCivil(new Date(t), fuso)}Z`).getTime();
    t += base.getTime() - visto;
  }
  return new Date(t);
}

// ── Situação e prioridade da senha ───────────────────────────────────────────────────────────────

export const SITUACOES_DB = [
  'aguardando',
  'chamada',
  'em_atendimento',
  'encaminhada',
  'atendida',
  'nao_compareceu',
  'cancelada',
  'suspensa',
] as const;

/** Tipo do serviço pelo tipo do gerador no cadastro (gerador_senha.tipo). */
export const tipoServicoDoBanco = (tipo: string): TipoServico =>
  tipo === 'diverso' ? 'diverso' : 'atendimento';

// ── Senha lida ───────────────────────────────────────────────────────────────────────────────────

/** Teto das senhas do dia numa leitura (a fila e o painel). */
export const TETO_SENHAS_DIA = 2_000;

const SELECT_SENHA = `SELECT s.id, s.numero, s.codigo_exibicao, s.gerador_senha_id, s.prioritaria, s.situacao,
       s.emitida_em, s.encerrada_em, s.chamadas, s.local_atendimento_id, s.emitida_usuario_id, s.versao,
       g.descricao AS servico, g.tipo AS tipo_gerador, g.prefixo, g.ponto_recepcao_id,
       gr.numero AS guiche, gp.codigo AS grupo_codigo, gp.peso AS peso_grupo, ue.login AS login_emissao,
       (SELECT MIN(h.inicio_em) FROM senha_emitida_marcacao sm JOIN marcacao_horario mh ON mh.id = sm.marcacao_horario_id
          JOIN horario_agenda h ON h.id = mh.horario_agenda_id
         WHERE sm.senha_emitida_id = s.id AND sm.excluido_em IS NULL) AS horario_marcacao,
       (SELECT COUNT(*) FROM atendimento_senha a WHERE a.senha_emitida_id = s.id AND a.excluido_em IS NULL) AS atendimentos,
       (SELECT COUNT(*) FROM senha_emitida_marcacao m WHERE m.senha_emitida_id = s.id AND m.excluido_em IS NULL) AS marcacoes
  FROM senha_emitida s
  JOIN gerador_senha g ON g.id = s.gerador_senha_id
  LEFT JOIN guiche_recepcao gr ON gr.id = s.guiche_recepcao_id
  LEFT JOIN grupo_prioridade_legal gp ON gp.id = s.grupo_prioridade_legal_id
  LEFT JOIN usuario ue ON ue.id = s.emitida_usuario_id`;

interface EventoLido {
  readonly senha: number;
  readonly acao: string;
  readonly local: number;
  readonly em: Date;
  readonly login: string | null;
}

/** Os eventos do fluxo das senhas (chamar, atender, encaminhar...), na ordem. */
async function eventosDasSenhas(l: Leitor, ids: readonly number[]): Promise<Map<number, EventoLido[]>> {
  const r = new Map<number, EventoLido[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const lote = ids.slice(i, i + 500);
    const ls = await l.consultar(
      `SELECT e.senha_emitida_id, a.codigo, e.local_atendimento_id, e.ocorrido_em, u.login
         FROM evento_senha e JOIN acao_fluxo_senha a ON a.id = e.acao_fluxo_senha_id
         LEFT JOIN usuario u ON u.id = e.usuario_id
        WHERE e.senha_emitida_id IN (${lote.map(() => '?').join(', ')})
        ORDER BY e.ocorrido_em, e.id`,
      lote,
      { teto: 50_000 },
    );
    for (const x of ls) {
      const id = num(x['senha_emitida_id']);
      const v: EventoLido = {
        senha: id,
        acao: txt(x['codigo']),
        local: num(x['local_atendimento_id']),
        em: x['ocorrido_em'] as Date,
        login: txtOuNull(x['login']),
      };
      const xs = r.get(id);
      if (xs) xs.push(v);
      else r.set(id, [v]);
    }
  }
  return r;
}

function senhaDaLinha(x: Linha, eventos: readonly EventoLido[], fuso: string): SenhaRecepcao {
  const guiche = numOuNull(x['guiche']);
  const chamadas = num(x['chamadas']);
  const chamar = eventos.filter((e) => e.acao === 'chamar');
  const prioritaria = bool(x['prioritaria']);
  const ultimo = eventos.at(-1) ?? null;
  return {
    id: num(x['id']),
    numero: num(x['numero']),
    texto: txt(x['codigo_exibicao']) || textoSenha(txt(x['prefixo']), num(x['numero'])),
    gerador: num(x['gerador_senha_id']),
    recepcao: num(x['ponto_recepcao_id']),
    servico: txt(x['servico']),
    tipoServico: tipoServicoDoBanco(txt(x['tipo_gerador'])),
    prioritaria,
    grupo: prioritaria ? txtOuNull(x['grupo_codigo']) : null,
    pesoGrupo: prioritaria ? numOuNull(x['peso_grupo']) : null,
    horarioMarcacao: civilOuNull(x['horario_marcacao'], fuso),
    situacao: txt(x['situacao']) as SituacaoSenha,
    guiche,
    local: numOuNull(x['local_atendimento_id']),
    usuario: ultimo?.login ?? txt(x['login_emissao']),
    emitidaEm: horaCivil(x['emitida_em'] as Date, fuso),
    origem: x['emitida_usuario_id'] === null ? 'totem' : 'balcao',
    chamadas,
    chamadaEm: chamar.length > 0 ? horaCivil(chamar.at(-1)!.em, fuso) : null,
    primeiraChamadaEm: chamar.length > 0 ? horaCivil(chamar[0]!.em, fuso) : null,
    concluidaEm: civilOuNull(x['encerrada_em'], fuso),
    localChamada: chamar.at(-1)?.local ?? null,
    atendida: num(x['atendimentos']) > 0,
    agendamento: num(x['marcacoes']) > 0,
    chamadasNoFluxo: Math.max(0, chamadas - (guiche !== null ? 1 : 0)),
    ultimoLocalChamada: chamar.at(-1)?.local ?? null,
    ultimoLocal: ultimo?.local ?? null,
  };
}

/** As senhas do dia civil do estabelecimento (na ordem de emissão), com o teto. */
export async function senhasDoDia(
  l: Leitor,
  est: EstabelecimentoDaSessao,
  hoje: string,
  filtro: { recepcao?: number | null; geradores?: readonly number[] },
): Promise<{ senhas: SenhaRecepcao[]; cortada: boolean }> {
  const cond = ['s.estabelecimento_id = ?', 's.data_referencia = ?', 's.excluido_em IS NULL'];
  const p: unknown[] = [est.id, hoje];
  if (filtro.recepcao) {
    cond.push('g.ponto_recepcao_id = ?');
    p.push(filtro.recepcao);
  }
  if (filtro.geradores && filtro.geradores.length > 0) {
    cond.push(`s.gerador_senha_id IN (${filtro.geradores.map(() => '?').join(', ')})`);
    p.push(...filtro.geradores);
  }
  const ls = await l.consultar(
    `${SELECT_SENHA} WHERE ${cond.join(' AND ')} ORDER BY s.emitida_em, s.numero, s.id LIMIT ${TETO_SENHAS_DIA + 1}`,
    p,
    { teto: TETO_SENHAS_DIA + 1 },
  );
  const linhas = ls.slice(0, TETO_SENHAS_DIA);
  const ev = await eventosDasSenhas(
    l,
    linhas.map((x) => num(x['id'])),
  );
  return {
    senhas: linhas.map((x) => senhaDaLinha(x, ev.get(num(x['id'])) ?? [], est.fuso)),
    cortada: ls.length > TETO_SENHAS_DIA,
  };
}

/** Uma senha do estabelecimento, ou null. */
export async function senhaPorId(
  l: Leitor,
  est: EstabelecimentoDaSessao,
  id: number,
): Promise<(SenhaRecepcao & { readonly versao: number; readonly situacaoGravada: string }) | null> {
  const x = await l.uma(
    `${SELECT_SENHA} WHERE s.id = ? AND s.estabelecimento_id = ? AND s.excluido_em IS NULL`,
    [id, est.id],
  );
  if (!x) return null;
  const ev = await eventosDasSenhas(l, [id]);
  return {
    ...senhaDaLinha(x, ev.get(id) ?? [], est.fuso),
    versao: num(x['versao']),
    situacaoGravada: txt(x['situacao']),
  };
}
