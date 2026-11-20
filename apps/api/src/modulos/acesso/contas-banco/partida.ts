// M59-F1 (regra 4): na partida da API, em homologação e produção, a conta da aplicação e as contas por módulo de
// cada estabelecimento nunca são o administrador do servidor (SYSDBA) nem a dona dos objetos SGH_ (a dos scripts).
// A mesma conferência do `pnpm ambiente:verificar`; devolve o relatório de recusa (a API não sobe) ou null.
import { conferirContaAplicacao } from '@sgh/dominio-acesso';
import { lerCodigos, lerContasDeModulo } from '@sgh/legado';

export function recusaDasContasDoBanco(env: Readonly<Record<string, string | undefined>>): string | null {
  const ambiente = env['AMBIENTE']?.trim() ?? '';
  if (ambiente !== 'homologacao' && ambiente !== 'producao') return null;
  const erros: string[] = [];
  try {
    for (const cod of lerCodigos(env)) {
      const C = cod.toUpperCase();
      const r = conferirContaAplicacao({
        aplicacao: [
          env[`FB_${C}_USUARIO`] ?? '',
          ...lerContasDeModulo(cod, env).map((c) => c.usuario),
        ].filter((x) => x.trim() !== ''),
        scripts: env[`FB_${C}_SCRIPTS_USUARIO`]?.trim() || null,
        leitura: null,
      });
      for (const e of r) erros.push(`[contas do banco] ${cod}: ${e} (regra 4 do M59)`);
    }
  } catch (e) {
    erros.push(`[contas do banco] ${(e as Error).message}`);
  }
  return erros.length > 0 ? erros.join('\n') : null;
}
