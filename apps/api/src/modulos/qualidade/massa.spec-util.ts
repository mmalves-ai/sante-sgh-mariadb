// Massa SINTÉTICA das integrações da qualidade (F2.2, lote 04-03) no cliente de teste da onda 4 (f22_o4): dois
// estabelecimentos por arquivo de teste, as contas, o setor e os cadastros da notificação (tipo de incidente,
// classificação e grau de dano pelos vocabulários do contrato). Nada de dado real; a limpeza apaga o que a integração
// gravou nos estabelecimentos da massa (os cadastros do cliente ficam: são configuração).
import { CLASSIFICACOES_OMS, GRAUS_DANO, TIPOS_INCIDENTE } from '@sgh/contratos';
import { type ContextoNucleo, ErroOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { cobra } from './apoio-propria.js';

export const CLIENTE_QUA = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
export const SEM_BANCO_QUA = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
export const P_QUA = 'L0403Q';

export interface MassaQualidade {
  readonly nucleo: NucleoProprio;
  readonly est: number;
  readonly outro: number;
  readonly codigoEst: string;
  readonly codigoOutro: string;
  readonly usuario: number;
  readonly login: string;
  readonly gestor: number;
  readonly loginGestor: string;
  readonly setor: number;
  readonly setorOutro: number;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

/** O contexto da sessão sintética no estabelecimento (o código vai junto, como na sessão da API). */
export function ctxBanco(est: number, codigo: string, usuario: number | null): ContextoNucleo {
  return { cliente: CLIENTE_QUA, estabelecimento: est, usuario, correlacao: 'teste-l0403', hospital: codigo } as ContextoNucleo;
}

/** Apaga o que a integração gravou nos estabelecimentos da massa. */
export async function limparQualidade(e: Escritor, ests: readonly number[]): Promise<void> {
  const em = ests.map(() => '?').join(', ');
  await e.executar(
    `DELETE v FROM notificacao_incidente_envio v JOIN notificacao_incidente n ON n.id = v.notificacao_incidente_id WHERE n.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(
    `DELETE v FROM notificacao_incidente_evento v JOIN notificacao_incidente n ON n.id = v.notificacao_incidente_id WHERE n.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM notificacao_incidente WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id IN (${em}) AND tipo LIKE 'notificacao_incidente_%'`, ests);
  await e.executar(`DELETE FROM feriado WHERE estabelecimento_id IN (${em})`, ests);
}

/** `marca`: um par de estabelecimentos por arquivo de teste (os arquivos rodam em paralelo). */
export async function prepararMassaQualidade(marca: string): Promise<MassaQualidade> {
  const nucleo = new NucleoProprio();
  const codigoEst = `${P_QUA}${marca}`;
  const codigoOutro = `${P_QUA}${marca}X`;
  const ids = await nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: `preparo-teste-04-03-${marca}` }, async (e) => {
    const agora = new Date();
    const estab = (cod: string) =>
      garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [cod],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [cod, 'ESTAB SINTETICO QUALIDADE', 'ESTAB SINTETICO QUALIDADE', agora],
      );
    const est = await estab(codigoEst);
    const outro = await estab(codigoOutro);
    const conta = (login: string) =>
      garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [login],
        "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
        [login, `USUARIO SINTETICO ${login.toUpperCase()}`, agora],
      );
    const login = `l0403q${marca.toLowerCase()}.nsp`;
    const loginGestor = `l0403q${marca.toLowerCase()}.gestor`;
    const usuario = await conta(login);
    const gestor = await conta(loginGestor);
    for (const u of [usuario, gestor])
      await garantir(
        e,
        'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
        [u, est],
        'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [u, est, '2020-01-01', agora],
      );
    const setorDe = (e2: number) =>
      garantir(
        e,
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
        [e2, 'Q1'],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, 'Q1', 'POSTO SINTETICO', 'assistencial', ?)",
        [e2, agora],
      );
    const setor = await setorDe(est);
    const setorOutro = await setorDe(outro);
    // Os cadastros da notificação (configuração do cliente), pelos vocabulários do contrato.
    for (const t of TIPOS_INCIDENTE)
      await garantir(e, 'SELECT id FROM tipo_incidente WHERE codigo = ?', [cobra(t.codigo)],
        'INSERT INTO tipo_incidente (codigo, descricao, criado_em) VALUES (?, ?, ?)', [cobra(t.codigo), t.rotulo, agora]);
    for (const [i, cl] of CLASSIFICACOES_OMS.entries())
      await garantir(e, 'SELECT id FROM classificacao_incidente WHERE codigo = ?', [cobra(cl.codigo)],
        'INSERT INTO classificacao_incidente (codigo, descricao, ordem, criado_em) VALUES (?, ?, ?, ?)', [cobra(cl.codigo), cl.rotulo, i, agora]);
    for (const g of GRAUS_DANO)
      await garantir(e, 'SELECT id FROM grau_dano WHERE codigo = ?', [cobra(g.codigo)],
        'INSERT INTO grau_dano (codigo, descricao, ordem, criado_em) VALUES (?, ?, ?, ?)', [cobra(g.codigo), g.rotulo, 50 + g.ordem, agora]);
    await limparQualidade(e, [est, outro]);
    await e.executar(
      "INSERT INTO feriado (data, nome, abrangencia, estabelecimento_id, criado_em) VALUES ('2026-11-02', 'FERIADO SINTETICO', 'estabelecimento', ?, ?)",
      [est, agora],
    );
    return { est, outro, usuario, gestor, setor, setorOutro };
  });
  return { nucleo, codigoEst, codigoOutro, login: `l0403q${marca.toLowerCase()}.nsp`, loginGestor: `l0403q${marca.toLowerCase()}.gestor`, ...ids };
}

/** Limpa a massa e fecha o núcleo. */
export async function encerrarMassaQualidade(m: MassaQualidade | undefined): Promise<void> {
  if (!m) return;
  await m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'limpeza-teste-04-03' }, (e) => limparQualidade(e, [m.est, m.outro]));
  await m.nucleo.encerrar();
}

/**
 * Chama cada leitura da porta que ainda aguarda o mapeamento (todas, menos as `implementadas`) e devolve as que NÃO
 * falharam fechadas (503 `modelo-pendente`): vazio ou zero como se fosse dado do hospital é defeito.
 */
export async function semFalhaFechada(porta: object, implementadas: readonly string[], c: unknown): Promise<{ chamadas: number; erradas: string[] }> {
  const fora = new Set(['constructor', 'podeGravar', 'executar', 'gravarSgh', ...implementadas]);
  const nomes = Object.getOwnPropertyNames(Object.getPrototypeOf(porta)).filter(
    (k) => !fora.has(k) && typeof (porta as Record<string, unknown>)[k] === 'function',
  );
  const erradas: string[] = [];
  for (const k of nomes) {
    try {
      await (porta as Record<string, (...a: unknown[]) => Promise<unknown>>)[k]!(c, 1, 1, 1);
      erradas.push(`${k}: devolveu dado`);
    } catch (e) {
      if (!(e instanceof ErroOperacao) || e.problema.status !== 503 || e.problema.codigo !== 'modelo-pendente') erradas.push(`${k}: ${String(e)}`);
    }
  }
  return { chamadas: nomes.length, erradas };
}

/** As contas das sessões sintéticas da API (o login da fonte sintética), ligadas ao estabelecimento da massa. */
export async function contasDasSessoes(m: MassaQualidade, logins: readonly string[]): Promise<Map<string, number>> {
  return m.nucleo.escrever({ cliente: CLIENTE_QUA, correlacao: 'preparo-teste-04-03-sessoes' }, async (e) => {
    const agora = new Date();
    const ids = new Map<string, number>();
    for (const login of logins) {
      const id = await garantir(e, 'SELECT id FROM usuario WHERE login = ?', [login],
        "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
        [login, `USUARIO SINTETICO ${login}`, agora]);
      await garantir(e, 'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?', [id, m.est],
        'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [id, m.est, '2020-01-01', agora]);
      ids.set(login, id);
    }
    return ids;
  });
}
