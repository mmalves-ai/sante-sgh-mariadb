// Apoio comum das portas próprias da enfermagem (SAE e agência transfusional) sobre o banco do cliente: conversão de
// valores das linhas, o relógio civil do estabelecimento (o banco guarda o instante em UTC; as telas falam a hora civil
// do estabelecimento) e a ponte entre a conta (usuario) e o cadastro do profissional (usuario_vinculo_profissional).
// Melhoria: hora civil pelo fuso do estabelecimento (estabelecimento.fuso_horario), não pelo relógio do servidor; o
// profissional do ato vem do vínculo vigente da conta no estabelecimento, nunca de um código digitado.
import { type ContextoNucleo, type Escritor, type Leitor, recusa } from '@sgh/nucleo';

export type Linha = Record<string, unknown>;

export const FUSO_PADRAO = 'America/Sao_Paulo';

export const num = (v: unknown): number => Number(v ?? 0);
export const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
export const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const booleano = (v: unknown): boolean => v === true || v === 1 || v === '1';
export const marcadores = (k: number): string => Array.from({ length: k }, () => '?').join(', ');

/** "AAAA-MM-DDTHH:MM:SS" do instante no fuso. */
export function localNoFuso(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .format(d)
    .replace(' ', 'T');
}

/** Instante do banco (UTC) → hora civil "AAAA-MM-DDTHH:MM:SS" no fuso; null se vazio. */
export function civilDe(v: unknown, fuso: string): string | null {
  const d = v instanceof Date ? v : typeof v === 'string' && v ? new Date(`${v.replace(' ', 'T')}Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? localNoFuso(d, fuso) : null;
}

/** DATE do banco → "AAAA-MM-DD". */
export function dataDe(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v ? String(v).slice(0, 10) : null;
}

/** Hora civil "AAAA-MM-DDTHH:MM(:SS)" no fuso → instante UTC (duas voltas acertam o horário de verão). */
export function instanteDe(civil: string, fuso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(civil.trim());
  if (!m) throw recusa('data-invalida', 'Data e hora no formato ISO (AAAA-MM-DDTHH:MM).');
  const alvo = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  let palpite = alvo;
  for (let i = 0; i < 2; i++) {
    const visto = Date.parse(`${localNoFuso(new Date(palpite), fuso)}Z`);
    palpite += alvo - visto;
  }
  return new Date(palpite);
}

/** O estabelecimento da sessão (recusa sem ele: toda leitura e gravação daqui é do estabelecimento). */
export function estabelecimentoDe(c: ContextoNucleo): number {
  if (c.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return c.estabelecimento;
}

/** O fuso do estabelecimento. */
export async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return r?.fuso_horario || FUSO_PADRAO;
}

/** O profissional do vínculo vigente da conta no estabelecimento; null sem vínculo. */
export async function profissionalDoUsuario(
  l: Leitor | Escritor,
  usuario: number,
  est: number,
  dia: Date = new Date(),
): Promise<number | null> {
  const r = await l.uma<{ profissional_id: number }>(
    `SELECT v.profissional_id FROM usuario_vinculo_profissional v
      WHERE v.usuario_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL AND v.profissional_id IS NOT NULL
        AND v.vigencia_inicio <= ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)
      ORDER BY v.vigencia_inicio DESC LIMIT 1`,
    [usuario, est, dia, dia],
  );
  return r ? Number(r.profissional_id) : null;
}

/** O profissional da conta pelo login (o segundo profissional da dupla checagem), no estabelecimento. */
export async function profissionalDoLogin(l: Leitor | Escritor, login: string, est: number): Promise<number | null> {
  const u = await l.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [
    login.trim().toLowerCase(),
  ]);
  return u ? profissionalDoUsuario(l, Number(u.id), est) : null;
}

/** Exige o profissional da conta da sessão (recusa 422 sem vínculo no estabelecimento). */
export async function exigirProfissional(l: Leitor | Escritor, c: ContextoNucleo, est: number): Promise<number> {
  if (c.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  const p = await profissionalDoUsuario(l, c.usuario, est);
  if (p === null)
    throw recusa(
      'sem-vinculo-profissional',
      'Sua conta não está ligada a um cadastro de profissional neste estabelecimento: peça o vínculo ao administrador.',
    );
  return p;
}

/** Login de quem gravou (para exibir): a conta do criado_por. Usado em subconsulta: (SELECT login FROM usuario ...). */
export const LOGIN_DE = (coluna: string) => `(SELECT u.login FROM usuario u WHERE u.id = ${coluna})`;
/** Login do profissional (a conta vinculada a ele no estabelecimento), em subconsulta. */
export const LOGIN_DO_PROFISSIONAL = (coluna: string, est: string) =>
  `(SELECT u.login FROM usuario_vinculo_profissional v JOIN usuario u ON u.id = v.usuario_id
     WHERE v.profissional_id = ${coluna} AND v.estabelecimento_id = ${est} AND v.excluido_em IS NULL
     ORDER BY v.vigencia_inicio DESC LIMIT 1)`;
