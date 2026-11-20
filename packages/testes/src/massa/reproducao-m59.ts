// Reprodução dos cenários da receita do M59-F2 (acesso.retirarSenhaLegado) pelo EXECUTOR, na transação da captura
// (sempre desfeita). A preparação (antes do retrato "antes") cria pelo próprio executor o operador e um usuário
// sintético (receita do M10, marca "SGH M59"), põe nele uma senha antiga SINTÉTICA (40 hex, cifrada, com sal) por um
// UPDATE na transação desfeita, como a troca de senha do legado faria, grava a credencial forte sintética
// (SGH_ACESSO_CREDENCIAL, como o primeiro login) e deixa o parâmetro da contingência do estabelecimento como o
// cenário pede (SGH_CFG_PARAMETRO: "nao" na retirada, "sim" na recusa). Nenhum dado real; nada fica gravado.
import {
  type CenarioCaptura,
  cifrarSenhaLegado,
  ErroOperacao,
  type Escritor,
  gravarCredencialForte,
} from '@sgh/legado';
import { loginLivre } from './sintetica.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<unknown>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
) => Promise<{ resultado: Record<string, unknown> }>;

// W1-01: acesso.trocarSenha (os 4 cenários do M05) entra aqui: o mesmo usuário sintético com a senha antiga sintética.
// W1-01 (parte 2b): acesso.redefinirSenha (senha provisória do gestor) é a mesma gravação, com os seus 3 cenários.
export const OPERACOES_REPRODUCAO_M59 = new Set([
  'acesso.retirarSenhaLegado',
  'acesso.trocarSenha',
  'acesso.redefinirSenha',
]);

/** Senha antiga e sal SINTÉTICOS (nenhum é de pessoa real; só dão forma à coluna). */
const HASH_SINTETICO = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
const SAL_SINTETICO = 'SALTSINTETICO0123456';
/** PHC Argon2id sintético (parâmetros mínimos; nunca confere senha nenhuma). */
const PHC_SINTETICO = '$argon2id$v=19$m=8192,t=1,p=1$c2ludGV0aWNvc2ludGV0$c2ludGV0aWNvc2ludGV0aWNv';

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

let seq = 0;
const sufixo = () =>
  `${Date.now().toString(36).toUpperCase().slice(-4)}${(seq++ % 36).toString(36).toUpperCase()}`;

export function cenarioM59(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  ctx: { readonly rede: string; readonly hospital: string },
  executar: Executar,
  executarOutra: ExecutarOutra,
  operadorSintetico: (e: Escritor) => Promise<string>,
): CenarioCaptura {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;

  /** Usuário livre, com grupo, senha antiga sintética e a credencial forte do primeiro login. */
  const usuarioComCredencialForte = async (e: Escritor): Promise<string> => {
    const login = await loginLivre(e, (Date.now() + 104_729 * ++seq) % 1_000_000_000);
    const grupo = `SGH_REPRO_${sufixo()}`;
    await executarOutra(e, 'acesso.criarGrupo', { nome: grupo });
    await executarOutra(e, 'acesso.criarUsuario', {
      login,
      nomeCompleto: `USUARIO SGH M59 ${sufixo()}`,
      grupo,
    });
    await e.executar(`UPDATE TBUSERS SET SENHA = ?, SALT = ?, SENHA_CRIPTOGRAFADA = 'T' WHERE NOME = ?`, [
      HASH_SINTETICO,
      SAL_SINTETICO,
      login,
    ]);
    const [u] = await e.consultar('SELECT ID_TBUSERS FROM TBUSERS WHERE NOME = ?', [login], { teto: 1 });
    const idUsuario = Number(u?.['ID_TBUSERS']);
    if (!Number.isInteger(idUsuario)) throw new Error('Usuário sintético não relido.');
    await gravarCredencialForte(
      e,
      {
        idUsuario,
        login,
        hashPhc: PHC_SINTETICO,
        algoritmo: 'argon2id',
        parametros: 'm=8192,t=1,p=1',
        origem: 'primeiro-login',
      },
      {
        rede: ctx.rede,
        hospital: ctx.hospital,
        usuario: login,
        evento: 'acesso.credencial.regravada',
        recurso: 'acesso.credencial',
        operacao: 'reproducao-assinatura',
        resultado: 'sucesso',
        estacao: null,
        correlacao: `assinatura-${cenario}`,
      },
    );
    return login;
  };

  /** Usuário livre, com grupo, sem senha (como o criarUsuario deixa) ou com a senha antiga sintética. */
  const usuarioSintetico = async (e: Escritor, comSenha: boolean): Promise<string> => {
    const login = await loginLivre(e, (Date.now() + 104_729 * ++seq) % 1_000_000_000);
    const grupo = `SGH_REPRO_${sufixo()}`;
    await executarOutra(e, 'acesso.criarGrupo', { nome: grupo });
    await executarOutra(e, 'acesso.criarUsuario', {
      login,
      nomeCompleto: `USUARIO SGH W1 ${sufixo()}`,
      grupo,
    });
    if (comSenha) {
      await e.executar(
        `UPDATE TBUSERS SET SENHA = ?, SALT = ?, SENHA_CRIPTOGRAFADA = 'T', DATA_ULTIMA_ALTERACAO_SENHA = CURRENT_DATE - 30
          WHERE NOME = ?`,
        [HASH_SINTETICO, SAL_SINTETICO, login],
      );
    }
    return login;
  };
  /** Senha nova SINTÉTICA cifrada no formato do legado (a combinação só dá forma às colunas). */
  const novaSintetica = (login: string) => ({
    login,
    ...cifrarSenhaLegado(`Sint#${sufixo()}x`, 'sha1-salt-senha'),
  });

  /** A contingência do estabelecimento vigente a partir de agora (a linha mais nova vale). */
  const contingencia = async (e: Escritor, valor: 'sim' | 'nao', autor: string): Promise<void> => {
    await e.executar(
      `INSERT INTO SGH_CFG_PARAMETRO (ID, CHAVE, NIVEL, ALVO, REDE, HOSPITAL, VALOR, VIGENTE_DESDE, JUSTIFICATIVA, AUTOR)
       VALUES (NEXT VALUE FOR SGH_GEN_CFG_PARAMETRO, 'legado.contingencia', 'estabelecimento', ?, ?, ?, ?,
               CURRENT_TIMESTAMP, 'reproducao da assinatura (desfeita)', ?)`,
      [ctx.hospital, ctx.rede, ctx.hospital, valor, autor],
    );
  };

  const preparar = async (e: Escritor): Promise<void> => {
    const operador = await operadorSintetico(e);
    switch (`${nome}/${cenario}`) {
      case 'acesso.retirarSenhaLegado/com-credencial-forte':
        entrada = { login: await usuarioComCredencialForte(e) };
        await contingencia(e, 'nao', operador);
        return;
      case 'acesso.retirarSenhaLegado/recusa-contingencia':
        entrada = { login: await usuarioComCredencialForte(e) };
        await contingencia(e, 'sim', operador);
        recusaEsperada = 'contingencia-ativa';
        return;
      case 'acesso.trocarSenha/senha-cifrada':
        entrada = novaSintetica(await usuarioSintetico(e, true));
        return;
      case 'acesso.trocarSenha/senha-sem-cifra':
        entrada = novaSintetica(await usuarioSintetico(e, false));
        // Usuário sem senha com a data de troca antiga (a de criação seria o próprio dia).
        await e.executar(
          'UPDATE TBUSERS SET DATA_ULTIMA_ALTERACAO_SENHA = CURRENT_DATE - 30 WHERE NOME = ?',
          [(entrada as { login: string }).login],
        );
        return;
      case 'acesso.trocarSenha/recusa-repetida':
        entrada = { login: await usuarioSintetico(e, true), resumo: HASH_SINTETICO, sal: SAL_SINTETICO };
        recusaEsperada = 'senha-repetida';
        return;
      case 'acesso.trocarSenha/recusa-bloqueado': {
        const login = await usuarioSintetico(e, true);
        await executarOutra(e, 'acesso.bloquearUsuario', { login });
        entrada = novaSintetica(login);
        recusaEsperada = 'usuario-bloqueado';
        return;
      }
      case 'acesso.redefinirSenha/senha-provisoria':
        entrada = novaSintetica(await usuarioSintetico(e, true));
        return;
      case 'acesso.redefinirSenha/usuario-sem-senha':
        entrada = novaSintetica(await usuarioSintetico(e, false));
        await e.executar(
          'UPDATE TBUSERS SET DATA_ULTIMA_ALTERACAO_SENHA = CURRENT_DATE - 30 WHERE NOME = ?',
          [(entrada as { login: string }).login],
        );
        return;
      case 'acesso.redefinirSenha/recusa-bloqueado': {
        const login = await usuarioSintetico(e, true);
        await executarOutra(e, 'acesso.bloquearUsuario', { login });
        entrada = novaSintetica(login);
        recusaEsperada = 'usuario-bloqueado';
        return;
      }
      default:
        throw new Error(`${nome} / ${cenario}: sem reprodução.`);
    }
  };
  return {
    ...base,
    preparar,
    async executar(e) {
      if (recusaEsperada) await exigirRecusa(executar(e, entrada), recusaEsperada);
      else await executar(e, entrada);
    },
  };
}
