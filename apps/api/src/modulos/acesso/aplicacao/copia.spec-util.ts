// Partida comum dos testes de integração da API sobre o banco PRÓPRIO (MariaDB) de um cliente de TESTE (F2.2): o
// NucleoProprio, o Executor e o primeiro estabelecimento do cliente. Nada de dado real: o cliente de teste só tem
// massa sintética, e a saída é só de contagens e tempos. SGH_NUCLEO_SEM_BANCO=1 desliga (os specs pulam).
// Os nomes exportados (AmbienteM27, NA_COPIA, PODE_ESCREVER) ficam para os specs que ainda os importam; "cópia" aqui
// é o banco do cliente de teste.
import { type Executor, type Leitor, NucleoProprio } from '@sgh/nucleo';

/** Cliente de teste (plataforma.cliente.codigo); padrão: o da onda 1 da F2.2. */
export const CLIENTE_TESTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
/** Há banco de teste neste processo? */
export const NA_COPIA = process.env['SGH_NUCLEO_SEM_BANCO'] !== '1';
/** As gravações vão ao cliente de teste (nunca a um cliente real): liberadas quando há banco. */
export const PODE_ESCREVER = NA_COPIA;

export interface AmbienteM27 {
  readonly nucleo: NucleoProprio;
  readonly executor: Executor;
  readonly cliente: string;
  /** Código do estabelecimento usado pelo teste. */
  readonly cod: string;
  readonly c: { rede: string; hospital: string };
}

export async function ambienteM27(): Promise<AmbienteM27> {
  const nucleo = new NucleoProprio();
  await nucleo.cliente(CLIENTE_TESTE);
  const e = await nucleo.lerSomente({ cliente: CLIENTE_TESTE, correlacao: 'teste-integracao' }, (l) =>
    l.uma('SELECT codigo FROM estabelecimento WHERE excluido_em IS NULL ORDER BY id LIMIT 1'),
  );
  if (!e) throw new Error('O cliente de teste não tem estabelecimento: monte a massa sintética antes.');
  const cod = String(e['codigo']);
  return { nucleo, executor: nucleo.criarExecutor(), cliente: CLIENTE_TESTE, cod, c: { rede: CLIENTE_TESTE, hospital: cod } };
}

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

/** Dois usuários ativos do cliente de teste (só em memória) e um perfil com usuários ativos. */
export async function usuariosAtivos(
  l: Leitor,
): Promise<{ a: string; b: string; grupo: string; doGrupo: number }> {
  const us = await l.consultar(
    "SELECT login FROM usuario WHERE situacao = 'ativo' AND excluido_em IS NULL ORDER BY id DESC LIMIT 2",
    [],
    { teto: 2 },
  );
  const [g] = await l.consultar(
    `SELECT p.codigo, COUNT(DISTINCT up.usuario_id) AS n FROM usuario_perfil up
     JOIN perfil_acesso p ON p.id = up.perfil_acesso_id JOIN usuario u ON u.id = up.usuario_id
     WHERE u.situacao = 'ativo' AND u.excluido_em IS NULL GROUP BY p.codigo
     HAVING COUNT(DISTINCT up.usuario_id) BETWEEN 2 AND 200 ORDER BY 2 LIMIT 1`,
    [],
    { teto: 1 },
  );
  if (us.length < 2 || !g) throw new Error('O cliente de teste não tem usuários ativos suficientes.');
  return { a: txt(us[0]?.['login']), b: txt(us[1]?.['login']), grupo: txt(g['codigo']), doGrupo: Number(g['n']) };
}

/** Percentil (0 a 100) dos tempos. */
export function percentil(xs: readonly number[], p: number): number {
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)] ?? 0;
}
