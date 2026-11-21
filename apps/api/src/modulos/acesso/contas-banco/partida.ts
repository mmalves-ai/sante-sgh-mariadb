// M59-F1 (regra 4): na partida da API, em homologação e produção, a conta do núcleo no MariaDB do cliente nunca é a
// do administrador do servidor (root), nem fica no padrão (sem SGH_MARIADB_USUARIO, o núcleo usa root). Devolve o
// relatório de recusa (a API não sobe) ou null. Em dev e CI não confere (o container de dev usa o administrador).
// Melhoria: a conta das migrações (SGH_MARIADB_USUARIO_MIGRACOES, quando definida) também não pode ser a da aplicação.
type Env = Readonly<Record<string, string | undefined>>;

const ADMINISTRADORES = new Set(['root', 'mariadb.sys', 'mysql']);

export function recusaDasContasDoBanco(env: Env): string | null {
  const ambiente = env['AMBIENTE']?.trim() ?? '';
  if (ambiente !== 'homologacao' && ambiente !== 'producao') return null;
  const erros: string[] = [];
  const conta = env['SGH_MARIADB_USUARIO']?.trim() ?? '';
  if (conta === '') erros.push('SGH_MARIADB_USUARIO ausente: o núcleo usaria o administrador do servidor');
  else if (ADMINISTRADORES.has(conta.toLowerCase()))
    erros.push('SGH_MARIADB_USUARIO: a aplicação não pode usar o administrador do servidor');
  const migracoes = env['SGH_MARIADB_USUARIO_MIGRACOES']?.trim();
  if (migracoes && conta !== '' && migracoes.toLowerCase() === conta.toLowerCase())
    erros.push('SGH_MARIADB_USUARIO: a aplicação não pode usar a conta das migrações');
  return erros.length > 0 ? erros.map((e) => `[contas do banco] ${e} (regra 4 do M59)`).join('\n') : null;
}
