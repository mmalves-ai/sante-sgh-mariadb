// Reprodução dos cenários das permissões do próprio legado (ADR 0022) pelo EXECUTOR, na transação da captura
// (sempre desfeita). A preparação (antes do retrato "antes") cria pelo próprio executor o operador, o grupo e
// o usuário sintéticos (nomes com a marca SGH_REPRO / sgh.m04, nenhum dado real) e faz o estado de partida de
// cada cenário; o cenário executa só a receita sob teste. Opções: as primeiras ativas de TBOPCOES (só o ID,
// em memória). O grupo real com usuário ativo do cenário `recusa-com-usuarios` é lido só pelo nome, em memória.
import { type CenarioCaptura, ErroOperacao, type Escritor } from '@sgh/legado';
import { loginLivre, usuarioSintetico } from './sintetica.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<unknown>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
) => Promise<{ resultado: Record<string, unknown> }>;

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

/** Opções ativas que o dono ainda não tem (só IDs, em memória). */
async function opcoesLivres(
  e: Escritor,
  n: number,
  dono: { tabela: 'TBPERUSU' | 'TBPAPEL_TBOPCOES'; coluna: string; valor: string | number },
): Promise<number[]> {
  const linhas = await e.consultar(
    `SELECT FIRST ${Math.trunc(n)} o.ID FROM TBOPCOES o WHERE o.ATIVO = 'T'
       AND NOT EXISTS (SELECT 1 FROM ${dono.tabela} x WHERE x.${dono.coluna} = ? AND x.ID_TBOPCOES = o.ID)
     ORDER BY o.ID`,
    [dono.valor],
    { teto: n },
  );
  const r = linhas.map((l) => Number(l['ID']));
  if (r.length < n) throw new Error('Opções ativas livres insuficientes.');
  return r;
}

async function grupoComUsuarioAtivo(e: Escritor): Promise<string> {
  const [g] = await e.consultar(
    `SELECT FIRST 1 g.NOME FROM TBGRUUSU g WHERE g.ATIVO = 'T'
       AND EXISTS (SELECT 1 FROM TBUSERS u WHERE u.GRUPO = g.NOME AND u.STATUS = 'T')`,
    [],
    { teto: 1 },
  );
  if (!g) throw new Error('Nenhum grupo com usuário ativo.');
  return String(g['NOME']).trimEnd();
}

let seq = 0;
const nomeGrupo = () =>
  `SGH_REPRO_${Date.now().toString(36).toUpperCase()}${(seq++).toString(36).toUpperCase()}`;

export const OPERACOES_REPRODUCAO_PERMISSOES = new Set([
  'acesso.concederOpcoesGrupo',
  'acesso.revogarOpcoesGrupo',
  'acesso.concederOpcoesPapel',
  'acesso.revogarOpcoesPapel',
  'acesso.concederPapelUsuario',
  'acesso.reativarPapelUsuario',
  'acesso.revogarPapelUsuario',
  'acesso.trocarGrupoUsuario',
  'acesso.criarGrupo',
  'acesso.desativarGrupo',
  'acesso.reativarGrupo',
  'acesso.renomearGrupo',
  'acesso.excluirGrupo',
]);

/** Papel SBIS dos cenários: Operador de backup (COD 3; nenhuma opção no pc) e Operador de sistema (COD 4). */
const PAPEL = 3;
const OUTRO_PAPEL = 4;

/**
 * @param operadorSintetico cria o operador (TBUSERS) pelo executor e devolve o login (vira o operador do
 * contexto: a trilha do legado e a segregação "ninguém a si mesmo").
 */
export function cenarioDePermissao(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  operadorSintetico: (e: Escritor) => Promise<string>,
): CenarioCaptura {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  const usuarioAlvo = async (e: Escritor) => {
    const login = await loginLivre(e, (Date.now() + 7_919 * ++seq) % 1_000_000_000);
    await executarOutra(e, 'acesso.criarUsuarioIntegracao', usuarioSintetico('usuario-tecnico', login));
    return login;
  };
  const grupoNovo = async (e: Escritor) => {
    const g = nomeGrupo();
    await executarOutra(e, 'acesso.criarGrupo', { nome: g });
    return g;
  };
  const preparar = async (e: Escritor) => {
    await operadorSintetico(e);
    switch (`${nome}/${cenario}`) {
      case 'acesso.concederOpcoesGrupo/uma-opcao':
      case 'acesso.concederOpcoesGrupo/varias-opcoes': {
        const g = await grupoNovo(e);
        const n = cenario === 'uma-opcao' ? 1 : 3;
        entrada = {
          grupo: g,
          opcoes: await opcoesLivres(e, n, { tabela: 'TBPERUSU', coluna: 'GRUPO', valor: g }),
        };
        return;
      }
      case 'acesso.concederOpcoesGrupo/recusa-opcao-concedida':
      case 'acesso.revogarOpcoesGrupo/uma-opcao': {
        const g = await grupoNovo(e);
        entrada = {
          grupo: g,
          opcoes: await opcoesLivres(e, 1, { tabela: 'TBPERUSU', coluna: 'GRUPO', valor: g }),
        };
        await executarOutra(e, 'acesso.concederOpcoesGrupo', entrada);
        if (cenario.startsWith('recusa')) recusaEsperada = 'opcao-ja-concedida';
        return;
      }
      // M37 (regra 6): a condução opcional retira o par grupo × opção e grava SGH_CFG_COEX_CONDUCAO na mesma
      // transação; a devolução concede o mesmo par e marca a linha devolvida.
      case 'acesso.revogarOpcoesGrupo/conducao': {
        const g = await grupoNovo(e);
        const opcoes = await opcoesLivres(e, 1, { tabela: 'TBPERUSU', coluna: 'GRUPO', valor: g });
        await executarOutra(e, 'acesso.concederOpcoesGrupo', { grupo: g, opcoes });
        entrada = {
          grupo: g,
          opcoes,
          conducao: { setor: 'SGH_REPRO_M37', autorizacao: 'reprodução sintética M37' },
        };
        return;
      }
      case 'acesso.concederOpcoesGrupo/devolucao': {
        const g = await grupoNovo(e);
        const opcoes = await opcoesLivres(e, 1, { tabela: 'TBPERUSU', coluna: 'GRUPO', valor: g });
        const conducao = { setor: 'SGH_REPRO_M37', autorizacao: 'reprodução sintética M37' };
        await executarOutra(e, 'acesso.concederOpcoesGrupo', { grupo: g, opcoes });
        await executarOutra(e, 'acesso.revogarOpcoesGrupo', { grupo: g, opcoes, conducao });
        entrada = { grupo: g, opcoes, conducao };
        return;
      }
      // M59.4 (regra 8): dissolver um grupo sem usuário ativo retira várias opções no mesmo lote.
      case 'acesso.revogarOpcoesGrupo/saneamento-grupo': {
        const g = await grupoNovo(e);
        const opcoes = await opcoesLivres(e, 3, { tabela: 'TBPERUSU', coluna: 'GRUPO', valor: g });
        await executarOutra(e, 'acesso.concederOpcoesGrupo', { grupo: g, opcoes });
        entrada = { grupo: g, opcoes };
        return;
      }
      case 'acesso.revogarOpcoesGrupo/recusa-opcao-nao-concedida': {
        const g = await grupoNovo(e);
        entrada = {
          grupo: g,
          opcoes: await opcoesLivres(e, 1, { tabela: 'TBPERUSU', coluna: 'GRUPO', valor: g }),
        };
        recusaEsperada = 'opcao-nao-concedida';
        return;
      }
      case 'acesso.concederOpcoesPapel/uma-opcao':
      case 'acesso.revogarOpcoesPapel/recusa-opcao-nao-concedida': {
        const [p] = await e.consultar('SELECT ID FROM TBPAPEL WHERE COD_PAPEL = ?', [PAPEL], { teto: 1 });
        const opcoes = await opcoesLivres(e, 1, {
          tabela: 'TBPAPEL_TBOPCOES',
          coluna: 'ID_TBPAPEL',
          valor: Number(p?.['ID']),
        });
        entrada = { papel: PAPEL, opcoes };
        if (cenario.startsWith('recusa')) recusaEsperada = 'opcao-nao-concedida';
        return;
      }
      case 'acesso.concederOpcoesPapel/recusa-opcao-concedida':
      case 'acesso.revogarOpcoesPapel/uma-opcao': {
        const [p] = await e.consultar('SELECT ID FROM TBPAPEL WHERE COD_PAPEL = ?', [PAPEL], { teto: 1 });
        const opcoes = await opcoesLivres(e, 1, {
          tabela: 'TBPAPEL_TBOPCOES',
          coluna: 'ID_TBPAPEL',
          valor: Number(p?.['ID']),
        });
        entrada = { papel: PAPEL, opcoes };
        await executarOutra(e, 'acesso.concederOpcoesPapel', entrada);
        if (cenario.startsWith('recusa')) recusaEsperada = 'opcao-ja-concedida';
        return;
      }
      case 'acesso.concederPapelUsuario/operador-backup':
        entrada = { login: await usuarioAlvo(e), papel: PAPEL };
        return;
      case 'acesso.concederPapelUsuario/recusa-papel-concedido': {
        entrada = { login: await usuarioAlvo(e), papel: PAPEL };
        await executarOutra(e, 'acesso.concederPapelUsuario', entrada);
        recusaEsperada = 'papel-ja-concedido';
        return;
      }
      case 'acesso.reativarPapelUsuario/reativar': {
        const login = await usuarioAlvo(e);
        await executarOutra(e, 'acesso.concederPapelUsuario', { login, papel: PAPEL });
        await executarOutra(e, 'acesso.concederPapelUsuario', { login, papel: OUTRO_PAPEL });
        await executarOutra(e, 'acesso.revogarPapelUsuario', { login, papel: PAPEL });
        entrada = { login, papel: PAPEL };
        return;
      }
      case 'acesso.reativarPapelUsuario/recusa-ja-ativo': {
        const login = await usuarioAlvo(e);
        await executarOutra(e, 'acesso.concederPapelUsuario', { login, papel: PAPEL });
        entrada = { login, papel: PAPEL };
        recusaEsperada = 'papel-ja-ativo';
        return;
      }
      case 'acesso.revogarPapelUsuario/inativar': {
        const login = await usuarioAlvo(e);
        await executarOutra(e, 'acesso.concederPapelUsuario', { login, papel: PAPEL });
        await executarOutra(e, 'acesso.concederPapelUsuario', { login, papel: OUTRO_PAPEL });
        entrada = { login, papel: PAPEL };
        return;
      }
      case 'acesso.revogarPapelUsuario/recusa-ultimo-papel': {
        const login = await usuarioAlvo(e);
        await executarOutra(e, 'acesso.concederPapelUsuario', { login, papel: PAPEL });
        entrada = { login, papel: PAPEL };
        recusaEsperada = 'ultimo-papel';
        return;
      }
      case 'acesso.trocarGrupoUsuario/troca':
        entrada = { login: await usuarioAlvo(e), grupo: await grupoNovo(e) };
        return;
      // M43 (regra 5): o usuário ativo do grupo "SEM GRUPO" (o caso da cópia de referência) recebe um grupo de trabalho.
      case 'acesso.trocarGrupoUsuario/atribuir-grupo': {
        const [g] = await e.consultar('SELECT ATIVO FROM TBGRUUSU WHERE NOME = ?', ['SEM GRUPO'], {
          teto: 1,
        });
        if (!g || (g['ATIVO'] !== null && String(g['ATIVO']).trim() !== 'T'))
          throw new Error('O grupo especial SEM GRUPO não está ativo na cópia.');
        const login = await loginLivre(e, (Date.now() + 15_485_863 * ++seq) % 1_000_000_000);
        await executarOutra(e, 'acesso.criarUsuario', {
          login,
          nomeCompleto: `USUARIO SGH M43 ${nomeGrupo().slice(-5)}`,
          grupo: 'SEM GRUPO',
        });
        entrada = { login, grupo: await grupoNovo(e) };
        return;
      }
      // M59.4 (regra 8): o usuário ativo do grupo genérico MASTER passa ao grupo de trabalho da função.
      case 'acesso.trocarGrupoUsuario/saneamento-grupo': {
        const [g] = await e.consultar('SELECT ATIVO FROM TBGRUUSU WHERE NOME = ?', ['MASTER'], { teto: 1 });
        if (!g || (g['ATIVO'] !== null && String(g['ATIVO']).trim() !== 'T'))
          throw new Error('O grupo genérico MASTER não está ativo na cópia.');
        const login = await loginLivre(e, (Date.now() + 32_452_843 * ++seq) % 1_000_000_000);
        await executarOutra(e, 'acesso.criarUsuario', {
          login,
          nomeCompleto: `USUARIO SGH M59 ${nomeGrupo().slice(-5)}`,
          grupo: 'MASTER',
        });
        entrada = { login, grupo: await grupoNovo(e) };
        return;
      }
      case 'acesso.trocarGrupoUsuario/recusa-grupo-inativo': {
        const grupo = await grupoNovo(e);
        await executarOutra(e, 'acesso.desativarGrupo', { nome: grupo });
        entrada = { login: await usuarioAlvo(e), grupo };
        recusaEsperada = 'grupo-inativo';
        return;
      }
      case 'acesso.criarGrupo/novo':
        entrada = { nome: nomeGrupo() };
        return;
      case 'acesso.criarGrupo/recusa-existente':
        entrada = { nome: await grupoNovo(e) };
        recusaEsperada = 'grupo-existente';
        return;
      case 'acesso.desativarGrupo/sem-usuarios':
        entrada = { nome: await grupoNovo(e) };
        return;
      case 'acesso.desativarGrupo/recusa-com-usuarios':
        entrada = { nome: await grupoComUsuarioAtivo(e) };
        recusaEsperada = 'grupo-com-usuarios';
        return;
      case 'acesso.reativarGrupo/reativar': {
        const nome = await grupoNovo(e);
        await executarOutra(e, 'acesso.desativarGrupo', { nome });
        entrada = { nome };
        return;
      }
      case 'acesso.reativarGrupo/recusa-ja-ativo':
        entrada = { nome: await grupoNovo(e) };
        recusaEsperada = 'grupo-ja-ativo';
        return;
      // W1-01 (parte 4b): o grupo novo (sintético, nunca usado) e o grupo real com usuário ativo (só o nome).
      case 'acesso.renomearGrupo/renomear':
        entrada = { nome: await grupoNovo(e), novoNome: nomeGrupo() };
        return;
      case 'acesso.renomearGrupo/recusa-com-dependentes':
        entrada = { nome: await grupoComUsuarioAtivo(e), novoNome: nomeGrupo() };
        recusaEsperada = 'com-dependentes';
        return;
      case 'acesso.renomearGrupo/recusa-existente':
        entrada = { nome: await grupoNovo(e), novoNome: await grupoNovo(e) };
        recusaEsperada = 'grupo-existente';
        return;
      case 'acesso.excluirGrupo/excluir':
        entrada = { nome: await grupoNovo(e), motivo: 'grupo criado por engano (cenario sintetico)' };
        return;
      case 'acesso.excluirGrupo/recusa-com-dependentes':
        entrada = { nome: await grupoComUsuarioAtivo(e), motivo: 'cenario sintetico' };
        recusaEsperada = 'com-dependentes';
        return;
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
