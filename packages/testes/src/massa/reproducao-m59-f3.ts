// Reprodução dos cenários das receitas do M59-F3 (acesso.retirarSenhaSecundaria e integracao.cifrarSegredoLegado)
// pelo EXECUTOR, na transação da captura (sempre desfeita). Nenhum valor real de segredo é lido nem gravado:
//  - senhas secundárias: um usuário sintético (receita do M10, marca "SGH M59") recebe na linha dele de TBUSUCPL
//    duas senhas secundárias SINTÉTICAS (sem profissional vinculado: CRM e ID_TBCBOPRO nulos, coerentes);
//  - segredos de parceiros: a linha do cenário (GEUSERS: um usuário sintético inserido; as demais tabelas: a primeira
//    linha pela chave, que é código de cadastro do estabelecimento, nunca de pessoa; inserida se a tabela estiver
//    vazia) recebe um segredo SINTÉTICO em todas as colunas, e o registro do cofre do Sante é gravado para cada uma.
// A contingência do estabelecimento fica como o cenário pede (SGH_CFG_PARAMETRO: "nao" na retirada, "sim" na recusa).
import { chaveDaLinha, SEGREDOS_LEGADO, segredoCatalogado } from '@sgh/contratos';
import { type CenarioCaptura, ErroOperacao, type Escritor, registrarGuardaSegredo } from '@sgh/legado';
import { loginLivre } from './sintetica.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<unknown>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_M59_F3 = new Set([
  'acesso.retirarSenhaSecundaria',
  'integracao.cifrarSegredoLegado',
]);

/** Valor SINTÉTICO de segredo (cabe na menor coluna do catálogo, VARCHAR(12)). */
const SEGREDO_SINTETICO = 'SGHSINT59';

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

/** Linha da tabela que o cenário usa: a primeira pela chave, ou uma inserida com o mínimo (tabela vazia). */
async function linhaDoCenario(
  e: Escritor,
  tabela: string,
  usuarioSintetico: (e: Escritor) => Promise<string>,
): Promise<Record<string, unknown>> {
  const s = segredoCatalogado(tabela);
  if (!s) throw new Error(`Tabela sem segredo catalogado: ${tabela}`);
  if (tabela === 'GEUSERS') {
    // GEUSERS.USUARIO referencia TBUSERS (FK_GEUSERS_TBUSERS): o usuário sintético nasce pela receita do M10.
    const login = await usuarioSintetico(e);
    await e.executar('INSERT INTO GEUSERS (USUARIO) VALUES (?)', [login]);
    return { USUARIO: login };
  }
  const [l] = await e.consultar(
    `SELECT FIRST 1 ${s.chave.join(', ')} FROM ${tabela} ORDER BY ${s.chave.join(', ')}`,
    [],
    { teto: 1 },
  );
  if (l) return l;
  switch (tabela) {
    case 'TBCODATI':
    case 'TBHOSPIT':
    case 'SITPEQV': {
      const k = s.chave[0]!;
      await e.executar(`INSERT INTO ${tabela} (${k}) VALUES (?)`, [9001]);
      return { [k]: 9001 };
    }
    case 'PREMAILCFG':
      await e.executar(
        `INSERT INTO PREMAILCFG (ID, SERVIDOR_SMTP, PORTA, USUARIO_AUTENTICACAO, SENHA_AUTENTICACAO)
         VALUES (9, 'smtp.sintetico.invalid', 587, 'sintetico', ?)`,
        [SEGREDO_SINTETICO],
      );
      return { ID: 9 };
    case 'TBTISSWEBSERV': {
      const [c] = await e.consultar('SELECT FIRST 1 COD FROM TBCONVEN ORDER BY COD', [], { teto: 1 });
      const [x] = await e.consultar('SELECT FIRST 1 ID FROM TBTISSSCHEMA ORDER BY ID', [], { teto: 1 });
      if (!c || !x) throw new Error('Sem convênio ou versão TISS na cópia para o cenário.');
      await e.executar(
        `INSERT INTO TBTISSWEBSERV (ID_TBCONVEN, ID_TBTISSSCHEMA, URL, LOCAL_ARQ_XML_RETORNO)
         VALUES (?, ?, 'https://sintetico.invalid', 'SINTETICO')`,
        [c['COD'], x['ID']],
      );
      return { ID_TBCONVEN: c['COD'], ID_TBTISSSCHEMA: x['ID'] };
    }
    default:
      throw new Error(`${tabela} vazia na cópia: o cenário precisa de uma linha.`);
  }
}

export function cenarioM59F3(
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

  const contingencia = async (e: Escritor, valor: 'sim' | 'nao', autor: string): Promise<void> => {
    await e.executar(
      `INSERT INTO SGH_CFG_PARAMETRO (ID, CHAVE, NIVEL, ALVO, REDE, HOSPITAL, VALOR, VIGENTE_DESDE, JUSTIFICATIVA, AUTOR)
       VALUES (NEXT VALUE FOR SGH_GEN_CFG_PARAMETRO, 'legado.contingencia', 'estabelecimento', ?, ?, ?, ?,
               CURRENT_TIMESTAMP, 'reproducao da assinatura (desfeita)', ?)`,
      [ctx.hospital, ctx.rede, ctx.hospital, valor, autor],
    );
  };

  /** Usuário sintético com as duas senhas secundárias sintéticas numa linha de TBUSUCPL. */
  /** Usuário sintético (grupo e usuário pela receita do M10). */
  const usuarioSintetico = async (e: Escritor): Promise<string> => {
    const login = await loginLivre(e, (Date.now() + 104_723 * ++seq) % 1_000_000_000);
    const grupo = `SGH_REPRO_${sufixo()}`;
    await executarOutra(e, 'acesso.criarGrupo', { nome: grupo });
    await executarOutra(e, 'acesso.criarUsuario', {
      login,
      nomeCompleto: `USUARIO SGH M59 ${sufixo()}`,
      grupo,
    });
    return login;
  };

  /**
   * Usuário sintético com as duas senhas secundárias sintéticas numa linha de TBUSUCPL, na forma real da tabela (perfil
   * passivo: CRM 0 em todas as linhas e ID_TBCBOPRO sempre preenchido, apontando para o código 0 do cadastro de CBO, o
   * "sem CRM"), para o UPDATE da receita passar pelo TRG_TBUSUCPL_BIU como numa linha de verdade.
   */
  const usuarioComSenhaSecundaria = async (e: Escritor): Promise<string> => {
    const login = await usuarioSintetico(e);
    const [cbo] = await e.consultar('SELECT FIRST 1 ID FROM TBCBOPRO WHERE COD = 0 ORDER BY ID', [], {
      teto: 1,
    });
    if (!cbo) throw new Error('TBCBOPRO sem o código 0 ("sem CRM"): reprodução sem a forma real.');
    const n = await e.executar(
      `UPDATE TBUSUCPL SET SENHA_SEC = ?, SENHA_CAN_NF = ?, CRM = 0, ID_TBCBOPRO = ? WHERE USUARIO = ?`,
      [SEGREDO_SINTETICO, SEGREDO_SINTETICO, cbo['ID'], login],
    );
    if (n === 0) {
      const [emp] = await e.consultar('SELECT FIRST 1 COD FROM TBEMPHOS ORDER BY COD', [], { teto: 1 });
      await e.executar(
        `INSERT INTO TBUSUCPL (EMPRESA, USUARIO, CRM, ID_TBCBOPRO, SENHA_SEC, SENHA_CAN_NF)
         VALUES (?, ?, 0, ?, ?, ?)`,
        [emp?.['COD'] ?? 1, login, cbo['ID'], SEGREDO_SINTETICO, SEGREDO_SINTETICO],
      );
    }
    return login;
  };

  /** A linha da tabela com segredo sintético em todas as colunas e o registro do cofre para cada uma. */
  const linhaComSegredo = async (e: Escritor, tabela: string, operador: string): Promise<string> => {
    const s = segredoCatalogado(tabela)!;
    const valores = await linhaDoCenario(e, tabela, usuarioSintetico);
    const chave = chaveDaLinha(tabela, valores);
    await e.executar(
      `UPDATE ${tabela} SET ${s.colunas.map((c) => `${c} = ?`).join(', ')}
        WHERE ${s.chave.map((c) => `${c} = ?`).join(' AND ')}`,
      [
        // GEUSERS.SENHA é BLOB de texto: o driver pede Buffer.
        ...s.colunas.map(() => (tabela === 'GEUSERS' ? Buffer.from(SEGREDO_SINTETICO) : SEGREDO_SINTETICO)),
        ...s.chave.map((c) => valores[c]),
      ],
    );
    for (const coluna of s.colunas)
      await registrarGuardaSegredo(
        e,
        {
          hospital: ctx.hospital,
          tabela,
          chave,
          coluna,
          referencia: `cofre:parceiro/${ctx.hospital}/${tabela}/0123456789abcdef/${coluna}`,
          rotacionado: true,
          colunaComValor: true,
          usuario: operador,
        },
        {
          rede: ctx.rede,
          hospital: ctx.hospital,
          usuario: operador,
          evento: 'integracao.segredoLegado.guardado',
          recurso: 'integracao.segredoLegado',
          operacao: 'reproducao-assinatura',
          resultado: 'sucesso',
          estacao: null,
          correlacao: `assinatura-${cenario}`,
        },
      );
    return chave;
  };

  const preparar = async (e: Escritor): Promise<void> => {
    const operador = await operadorSintetico(e);
    if (nome === 'acesso.retirarSenhaSecundaria') {
      entrada = { login: await usuarioComSenhaSecundaria(e) };
      if (cenario === 'recusa-contingencia') {
        await contingencia(e, 'sim', operador);
        recusaEsperada = 'contingencia-ativa';
      } else if (cenario === 'com-senha-secundaria') await contingencia(e, 'nao', operador);
      else throw new Error(`${nome} / ${cenario}: sem reprodução.`);
      return;
    }
    if (nome === 'integracao.cifrarSegredoLegado') {
      if (cenario === 'recusa-contingencia') {
        entrada = { tabela: 'TBCONVEN', chave: await linhaComSegredo(e, 'TBCONVEN', operador) };
        await contingencia(e, 'sim', operador);
        recusaEsperada = 'contingencia-ativa';
        return;
      }
      const s = SEGREDOS_LEGADO.find((x) => x.tabela.toLowerCase() === cenario);
      if (!s) throw new Error(`${nome} / ${cenario}: sem reprodução.`);
      entrada = { tabela: s.tabela, chave: await linhaComSegredo(e, s.tabela, operador) };
      await contingencia(e, 'nao', operador);
      return;
    }
    throw new Error(`${nome} / ${cenario}: sem reprodução.`);
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
