// Reprodução dos cenários das receitas próprias do M10 (usuários, escopos, termo, acomodações e leitos) pelo
// EXECUTOR, na transação da captura (sempre desfeita). A preparação (antes do retrato "antes") cria pelo próprio
// executor o operador, os usuários, o grupo, o bloco, a acomodação e o leito sintéticos (marcas SGH_REPRO,
// sgh.m04 e "SGH M10"; nenhum dado real) e deixa o estado de partida de cada cenário; o cenário executa só a
// receita sob teste. Os valores de referência (unidade, local, convênio, tipo de acomodação, centro de custo,
// local de conta) são códigos já existentes, lidos só em memória. A colisão é feita "por fora" pelo próprio
// executor (outro operador); a ocupação do leito, que nenhuma receita grava (é da internação), é posta por um
// UPDATE na transação desfeita, como a internação do legado faria.
import { type CenarioCaptura, ErroOperacao, type Escritor } from '@sgh/legado';
import { cpfComDigitos, loginLivre, usuarioSintetico } from './sintetica.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<unknown>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
) => Promise<{ resultado: Record<string, unknown> }>;

/** W1-01 (parte 6): texto sintético da versão nova do termo na reprodução. */
const TERMO_SINTETICO = 'Termo de uso sintético da reprodução da assinatura (W1-01), versão de teste.';

export const OPERACOES_REPRODUCAO_M10 = new Set([
  'acesso.criarUsuario',
  'acesso.alterarUsuario',
  'acesso.alterarFlagsUsuario',
  'acesso.bloquearUsuario',
  'acesso.desbloquearUsuario',
  'acesso.aceitarTermo',
  'acesso.publicarTermo',
  'organizacao.incluirAcomodacao',
  'organizacao.alterarAcomodacao',
  'organizacao.incluirLeito',
  'organizacao.alterarLeito',
  'organizacao.inativarLeito',
  'organizacao.reativarLeito',
  ...['Unidade', 'Local', 'Convenio', 'ConvenioFaturamento', 'TipoAgenda', 'TipoProntuario'].flatMap((t) => [
    `acesso.conceder${t}Usuario`,
    `acesso.retirar${t}Usuario`,
  ]),
]);

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

/** A entrada sem os campos opcionais (cenário da entrada mínima). */
const sem = <T extends object>(o: T, ...chaves: string[]): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !chaves.includes(k))) as Partial<T>;
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trimEnd();
let seq = 0;
const sufixo = () =>
  `${Date.now().toString(36).toUpperCase().slice(-4)}${(seq++ % 36).toString(36).toUpperCase()}`;

async function primeiro(e: Escritor, sql: string, campo: string): Promise<number | string> {
  const [l] = await e.consultar(sql, [], { teto: 1 });
  if (!l) throw new Error(`Sem valor de referência: ${sql}`);
  return typeof l[campo] === 'string' ? txt(l[campo]) : Number(l[campo]);
}

/** CPF sintético (dígitos verificadores válidos, faixa 9xx) livre entre os usuários. */
async function cpfLivreUsuario(e: Escritor): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const base = String(900_000_000 + ((Date.now() + i * 7919) % 99_999_999)).padStart(9, '0');
    const cpf = cpfComDigitos(base);
    if (/^(\d)\1{10}$/.test(cpf)) continue;
    if (
      (await e.consultar('SELECT FIRST 1 ID_TBUSERS FROM TBUSERS WHERE CPF = ?', [Number(cpf)], { teto: 1 }))
        .length === 0
    )
      return cpf;
  }
  throw new Error('Nenhum CPF sintético livre entre os usuários.');
}

/** Valor de escopo que existe na origem (ou o mais usado na própria tabela, quando o legado não tem origem). */
const VALOR_ESCOPO: Readonly<Record<string, string>> = {
  Unidade: 'SELECT FIRST 1 COD V FROM TBUNIDAD WHERE COD > 0 ORDER BY COD',
  Local: 'SELECT FIRST 1 ID V FROM TBLOCAL ORDER BY ID',
  Convenio: 'SELECT FIRST 1 COD V FROM TBCONVEN WHERE COD > 0 ORDER BY COD',
  ConvenioFaturamento: 'SELECT FIRST 1 COD V FROM TBCONVEN WHERE COD > 0 ORDER BY COD',
  TipoAgenda: 'SELECT FIRST 1 TPAGE V FROM TBAGEUSE GROUP BY TPAGE ORDER BY COUNT(*) DESC',
  TipoProntuario: 'SELECT FIRST 1 OPCAO V FROM TBCTRPRTUSU GROUP BY OPCAO ORDER BY COUNT(*) DESC',
};

/**
 * @param operadorSintetico cria o operador (TBUSERS) pelo executor e devolve o login (o operador do contexto: a
 * trilha do legado, a segregação "ninguém a si mesmo" e o usuário do aceite do termo).
 */
export function cenarioM10(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  operadorSintetico: (e: Escritor) => Promise<string>,
): CenarioCaptura {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  const grupoNovo = async (e: Escritor) => {
    const g = `SGH_REPRO_${sufixo()}`;
    await executarOutra(e, 'acesso.criarGrupo', { nome: g });
    return g;
  };
  /** Usuário bloqueado e sem grupo (o usuário técnico do M04). */
  const usuarioBloqueado = async (e: Escritor) => {
    const login = await loginLivre(e, (Date.now() + 7_919 * ++seq) % 1_000_000_000);
    await executarOutra(e, 'acesso.criarUsuarioIntegracao', usuarioSintetico('usuario-tecnico', login));
    return login;
  };
  /** Usuário de pessoa livre, com grupo (pela receita do M10). */
  const usuarioLivre = async (e: Escritor) => {
    const login = await loginLivre(e, (Date.now() + 104_729 * ++seq) % 1_000_000_000);
    await executarOutra(e, 'acesso.criarUsuario', {
      login,
      nomeCompleto: `USUARIO SGH M10 ${sufixo()}`,
      grupo: await grupoNovo(e),
    });
    return login;
  };
  /**
   * M43: usuário livre num grupo especial que já existe ativo na cópia (o de painéis ou o "SEM GRUPO"), pela receita do
   * M10 (só na transação desfeita da reprodução).
   */
  const usuarioDoGrupo = async (e: Escritor, grupo: string) => {
    const [g] = await e.consultar('SELECT ATIVO FROM TBGRUUSU WHERE NOME = ?', [grupo], { teto: 1 });
    if (!g || (g['ATIVO'] !== null && String(g['ATIVO']).trim() !== 'T'))
      throw new Error(`O grupo especial ${grupo} não está ativo na cópia.`);
    const login = await loginLivre(e, (Date.now() + 15_485_863 * ++seq) % 1_000_000_000);
    await executarOutra(e, 'acesso.criarUsuario', {
      login,
      nomeCompleto: `USUARIO SGH M43 ${sufixo()}`,
      grupo,
    });
    return login;
  };
  const versaoUsuario = async (e: Escritor, login: string) => {
    const [u] = await e.consultar(
      'SELECT NOMEC, GRUPO, STATUS, BLOQUEADO FROM TBUSERS WHERE NOME = ?',
      [login],
      {
        teto: 1,
      },
    );
    return JSON.stringify(['NOMEC', 'GRUPO', 'STATUS', 'BLOQUEADO'].map((k) => txt(u?.[k])));
  };
  const blocoNovo = async (e: Escritor) => {
    const bloco = `Z${sufixo()}`.slice(0, 5);
    const unidade = Number(
      await primeiro(e, 'SELECT FIRST 1 COD FROM TBUNIDAD WHERE COD > 0 ORDER BY COD', 'COD'),
    );
    await executarOutra(e, 'organizacao.incluirBloco', {
      codigo: bloco,
      nome: `BLOCO SGH M10 ${bloco}`,
      andares: 1,
      unidade,
      idadeMinima: 0,
      idadeMaxima: 999,
      ordem: 99,
    });
    return bloco;
  };
  const dadosAcomodacao = async (e: Escritor, bloco: string) => ({
    bloco,
    acomodacao: `Z${sufixo()}`.slice(0, 6),
    nome: `ACOMODACAO SGH M10 ${sufixo()}`,
    andar: 1,
    leitos: 2,
    sexo: 'A',
    tipo: Number(await primeiro(e, 'SELECT FIRST 1 ID FROM TBTIPOACOMOD WHERE ID > 0 ORDER BY ID', 'ID')),
    convenio: 'A',
    centroCusto: Number(
      await primeiro(
        e,
        `SELECT FIRST 1 COD FROM TBCENCUS WHERE SITUACAO = 'A' AND COD > 0 ORDER BY COD`,
        'COD',
      ),
    ),
    localConta: Number(
      await primeiro(e, `SELECT FIRST 1 COD FROM TBLOCCON WHERE ATIVO = 'T' ORDER BY COD`, 'COD'),
    ),
    acomodacaoTiss: Number(
      await primeiro(e, 'SELECT FIRST 1 ID FROM TBTPACOMTISS WHERE ID > 0 ORDER BY ID', 'ID'),
    ),
    idadeMinima: 12,
    idadeMaxima: 999,
  });
  const acomodacaoNova = async (e: Escritor) => {
    const a = await dadosAcomodacao(e, await blocoNovo(e));
    await executarOutra(e, 'organizacao.incluirAcomodacao', a);
    return a;
  };
  const versaoAcomodacao = async (e: Escritor, bloco: string, acomodacao: string) => {
    const [a] = await e.consultar(
      'SELECT NOME, ANDAR, LEITOS, SEXO, TIPO, TCONV FROM RIACOMOD WHERE BLOCO = ? AND ACOMOD = ?',
      [bloco, acomodacao],
      { teto: 1 },
    );
    return JSON.stringify(['NOME', 'ANDAR', 'LEITOS', 'SEXO', 'TIPO', 'TCONV'].map((k) => txt(a?.[k])));
  };
  const leitoNovo = async (e: Escritor) => {
    const a = await acomodacaoNova(e);
    const r = await executarOutra(e, 'organizacao.incluirLeito', {
      bloco: a.bloco,
      acomodacao: a.acomodacao,
      leito: 'L1',
      andar: 1,
      ramal: 0,
      ...(await vigencia(e)),
    });
    return Number(r.resultado['id']);
  };
  const versaoLeito = async (e: Escritor, id: number) => {
    const [l] = await e.consultar('SELECT STATUS, RAMAL, ANDAR, REG FROM RILEITOS WHERE ID = ?', [id], {
      teto: 1,
    });
    return JSON.stringify(['STATUS', 'RAMAL', 'ANDAR', 'REG'].map((k) => txt(l?.[k])));
  };
  /** Diária mais usada nos leitos (código real, só em memória) e a vigência do mês corrente do banco. */
  const vigencia = async (e: Escritor) => {
    const [d] = await e.consultar(
      'SELECT FIRST 1 CDIARIA V FROM RILEITOS WHERE CDIARIA > 0 GROUP BY CDIARIA ORDER BY COUNT(*) DESC',
      [],
      { teto: 1 },
    );
    const [h] = await e.consultar(
      'SELECT EXTRACT(YEAR FROM CURRENT_DATE) A, EXTRACT(MONTH FROM CURRENT_DATE) M FROM RDB$DATABASE',
      [],
      { teto: 1 },
    );
    return { diaria: Number(d?.['V'] ?? 0), anoVigente: Number(h?.['A']), mesVigente: Number(h?.['M']) };
  };
  const termoVigente = async (e: Escritor) =>
    Number(await primeiro(e, `SELECT FIRST 1 ID FROM PRTERMOCAD WHERE ATIVO = 'T' ORDER BY ID DESC`, 'ID'));

  /**
   * W1-01: usuário (bloqueado, do M04) com a linha de TBUSUCPL na forma real (CRM 0 e o ID_TBCBOPRO do código 0,
   * coerentes para o gatilho TRG_TBUSUCPL_BIU) e as duas permissões do cenário: ALTAPAC desligada e ACE_ALTA ligada.
   */
  const usuarioComComplemento = async (e: Escritor) => {
    const login = await usuarioBloqueado(e);
    const [cbo] = await e.consultar('SELECT FIRST 1 ID FROM TBCBOPRO WHERE COD = 0 ORDER BY ID', [], {
      teto: 1,
    });
    if (!cbo) throw new Error('TBCBOPRO sem o código 0 ("sem CRM"): reprodução sem a forma real.');
    const [emp] = await e.consultar('SELECT FIRST 1 COD FROM TBEMPHOS ORDER BY COD', [], { teto: 1 });
    await e.executar(
      `INSERT INTO TBUSUCPL (EMPRESA, USUARIO, CRM, ID_TBCBOPRO, ALTAPAC, ACE_ALTA) VALUES (?, ?, 0, ?, 'F', 'T')`,
      [emp?.['COD'] ?? 1, login, cbo['ID']],
    );
    return login;
  };
  const preparar = async (e: Escritor) => {
    await operadorSintetico(e);
    const escopo = /^acesso\.(conceder|retirar)(.+)Usuario$/.exec(nome);
    if (escopo && escopo[2] && VALOR_ESCOPO[escopo[2]]) {
      const [, acao, tipo] = escopo;
      const login = await usuarioBloqueado(e);
      const valor = await primeiro(e, VALOR_ESCOPO[tipo as string] as string, 'V');
      entrada = { login, valor };
      const ja = cenario.startsWith('recusa');
      if ((acao === 'conceder' && ja) || (acao === 'retirar' && !ja))
        await executarOutra(e, `acesso.conceder${tipo}Usuario`, entrada);
      if (ja) recusaEsperada = acao === 'conceder' ? 'ja-concedido' : 'nao-concedido';
      return;
    }
    switch (`${nome}/${cenario}`) {
      case 'acesso.criarUsuario/com-grupo':
        entrada = {
          login: await loginLivre(e, (Date.now() + 31 * ++seq) % 1_000_000_000),
          nomeCompleto: `USUARIO SGH M10 ÇÃO ${sufixo()}`,
          grupo: await grupoNovo(e),
          cpf: await cpfLivreUsuario(e),
        };
        return;
      case 'acesso.criarUsuario/login-existente':
        entrada = {
          login: await usuarioBloqueado(e),
          nomeCompleto: `USUARIO SGH M10 ${sufixo()}`,
          grupo: await grupoNovo(e),
        };
        recusaEsperada = 'login-existente';
        return;
      case 'acesso.alterarUsuario/nome-completo': {
        const login = await usuarioBloqueado(e);
        entrada = {
          login,
          nomeCompleto: `NOME ALTERADO SGH M10 ÇÃO ${sufixo()}`,
          versao: await versaoUsuario(e, login),
        };
        return;
      }
      case 'acesso.alterarUsuario/colisao': {
        const login = await usuarioBloqueado(e);
        const versao = await versaoUsuario(e, login);
        await executarOutra(e, 'acesso.alterarUsuario', {
          login,
          nomeCompleto: `POR FORA ${sufixo()}`,
          versao,
        });
        entrada = { login, nomeCompleto: `NOME ALTERADO SGH M10 ${sufixo()}`, versao };
        recusaEsperada = 'conflito-versao';
        return;
      }
      // W1-01: troca do CPF com justificativa (o anterior vai à trilha) e CPF de outro login recusado.
      case 'acesso.alterarUsuario/troca-cpf': {
        const login = await usuarioBloqueado(e);
        entrada = {
          login,
          nomeCompleto: `NOME CPF SGH W1-01 ${sufixo()}`,
          versao: await versaoUsuario(e, login),
          cpf: await cpfLivreUsuario(e),
          justificativa: 'CPF digitado errado na criação do acesso (conferido no documento).',
        };
        return;
      }
      case 'acesso.alterarUsuario/cpf-em-uso': {
        const outro = await usuarioLivre(e);
        const cpf = await cpfLivreUsuario(e);
        await executarOutra(e, 'acesso.alterarUsuario', {
          login: outro,
          nomeCompleto: `OUTRO CPF SGH W1-01 ${sufixo()}`,
          versao: await versaoUsuario(e, outro),
          cpf,
          justificativa: 'CPF do outro login para o cenário de recusa.',
        });
        const login = await usuarioBloqueado(e);
        entrada = {
          login,
          nomeCompleto: `NOME CPF SGH W1-01 ${sufixo()}`,
          versao: await versaoUsuario(e, login),
          cpf,
          justificativa: 'CPF repetido entre logins deve ser recusado.',
        };
        recusaEsperada = 'cpf-em-uso';
        return;
      }
      // W1-01 (parte 3b): permissões complementares com a letra de cada coluna; colisão pela letra lida.
      case 'acesso.alterarFlagsUsuario/flags':
        entrada = {
          login: await usuarioComComplemento(e),
          flags: [
            { coluna: 'ALTAPAC', ligado: true, antes: 'F' },
            { coluna: 'ACE_ALTA', ligado: false, antes: 'T' },
          ],
        };
        return;
      case 'acesso.alterarFlagsUsuario/recusa-colisao': {
        const login = await usuarioComComplemento(e);
        await executarOutra(e, 'acesso.alterarFlagsUsuario', {
          login,
          flags: [{ coluna: 'ALTAPAC', ligado: true, antes: 'F' }],
        });
        entrada = { login, flags: [{ coluna: 'ALTAPAC', ligado: true, antes: 'F' }] };
        recusaEsperada = 'conflito-versao';
        return;
      }
      case 'acesso.bloquearUsuario/bloquear':
        entrada = { login: await usuarioLivre(e) };
        return;
      // M43 (regra 4): o login de TV do grupo de painéis, depois do aparelho no token e conferido no setor.
      case 'acesso.bloquearUsuario/bloquear-login-de-painel':
        entrada = { login: await usuarioDoGrupo(e, 'PAINEIS') };
        return;
      // M43 (regras 4 e 5): usuário livre, recém-criado, sem conexão nos dois sistemas.
      case 'acesso.bloquearUsuario/bloquear-sem-uso':
        entrada = { login: await usuarioDoGrupo(e, 'SEM GRUPO') };
        return;
      // M52.1 (regra 2): o usuário livre do colaborador sintético desligado.
      case 'acesso.bloquearUsuario/desligamento':
        entrada = { login: await usuarioLivre(e) };
        return;
      case 'acesso.bloquearUsuario/recusa-ja-bloqueado':
        entrada = { login: await usuarioBloqueado(e) };
        recusaEsperada = 'ja-bloqueado';
        return;
      case 'acesso.desbloquearUsuario/desbloquear':
        entrada = { login: await usuarioBloqueado(e) };
        return;
      case 'acesso.desbloquearUsuario/recusa-ja-livre':
        entrada = { login: await usuarioLivre(e) };
        recusaEsperada = 'ja-livre';
        return;
      case 'acesso.aceitarTermo/primeiro-aceite':
        entrada = { termo: await termoVigente(e) };
        return;
      case 'acesso.aceitarTermo/recusa-ja-aceito':
        entrada = { termo: await termoVigente(e) };
        await executarOutra(e, 'acesso.aceitarTermo', entrada);
        recusaEsperada = 'ja-aceito';
        return;
      // W1-01 (parte 6): nova versão do termo (texto sintético; a transação é desfeita).
      case 'acesso.publicarTermo/publicar':
        entrada = {
          termoAnterior: await termoVigente(e),
          texto: TERMO_SINTETICO,
          motivo: 'reprodução da assinatura',
        };
        return;
      case 'acesso.publicarTermo/recusa-desatualizado':
        entrada = {
          termoAnterior: (await termoVigente(e)) + 1000,
          texto: TERMO_SINTETICO,
          motivo: 'reprodução da assinatura',
        };
        recusaEsperada = 'termo-desatualizado';
        return;
      case 'acesso.publicarTermo/recusa-texto-igual': {
        const motivo = 'reprodução da assinatura';
        await executarOutra(e, 'acesso.publicarTermo', {
          termoAnterior: await termoVigente(e),
          texto: TERMO_SINTETICO,
          motivo,
        });
        entrada = { termoAnterior: await termoVigente(e), texto: TERMO_SINTETICO, motivo };
        recusaEsperada = 'texto-igual';
        return;
      }
      case 'organizacao.incluirAcomodacao/nova':
        entrada = await dadosAcomodacao(e, await blocoNovo(e));
        return;
      case 'organizacao.incluirAcomodacao/minima': {
        // Só os campos obrigatórios: as idades ficam com o valor do banco (0 e 999).
        entrada = sem(await dadosAcomodacao(e, await blocoNovo(e)), 'idadeMinima', 'idadeMaxima');
        return;
      }
      case 'organizacao.incluirAcomodacao/recusa-existente':
        entrada = await acomodacaoNova(e);
        recusaEsperada = 'acomodacao-existente';
        return;
      case 'organizacao.alterarAcomodacao/nome-andar-leitos': {
        const a = await acomodacaoNova(e);
        entrada = {
          bloco: a.bloco,
          acomodacao: a.acomodacao,
          versao: await versaoAcomodacao(e, a.bloco, a.acomodacao),
          nome: `ACOMODACAO ALTERADA ${sufixo()}`,
          andar: 2,
          leitos: 3,
        };
        return;
      }
      case 'organizacao.alterarAcomodacao/recusa-colisao': {
        const a = await acomodacaoNova(e);
        const versao = await versaoAcomodacao(e, a.bloco, a.acomodacao);
        await executarOutra(e, 'organizacao.alterarAcomodacao', {
          bloco: a.bloco,
          acomodacao: a.acomodacao,
          versao,
          leitos: 4,
        });
        entrada = { bloco: a.bloco, acomodacao: a.acomodacao, versao, nome: `ALTERADA ${sufixo()}` };
        recusaEsperada = 'conflito-versao';
        return;
      }
      case 'organizacao.incluirLeito/novo': {
        const a = await acomodacaoNova(e);
        entrada = {
          bloco: a.bloco,
          acomodacao: a.acomodacao,
          leito: 'L1',
          andar: 1,
          ramal: 0,
          ...(await vigencia(e)),
        };
        return;
      }
      case 'organizacao.incluirLeito/minimo': {
        // Só os campos obrigatórios: diária e ramal ficam 0, como o banco.
        const a = await acomodacaoNova(e);
        entrada = {
          bloco: a.bloco,
          acomodacao: a.acomodacao,
          leito: 'L1',
          andar: 1,
          ...sem(await vigencia(e), 'diaria'),
        };
        return;
      }
      case 'organizacao.incluirLeito/recusa-existente': {
        const a = await acomodacaoNova(e);
        entrada = {
          bloco: a.bloco,
          acomodacao: a.acomodacao,
          leito: 'L1',
          andar: 1,
          ramal: 0,
          ...(await vigencia(e)),
        };
        await executarOutra(e, 'organizacao.incluirLeito', entrada);
        recusaEsperada = 'leito-existente';
        return;
      }
      case 'organizacao.alterarLeito/ramal': {
        const id = await leitoNovo(e);
        entrada = { id, versao: await versaoLeito(e, id), ramal: 123, andar: 2 };
        return;
      }
      case 'organizacao.alterarLeito/recusa-colisao': {
        const id = await leitoNovo(e);
        const versao = await versaoLeito(e, id);
        await executarOutra(e, 'organizacao.alterarLeito', { id, versao, ramal: 321 });
        entrada = { id, versao, ramal: 123 };
        recusaEsperada = 'conflito-versao';
        return;
      }
      case 'organizacao.inativarLeito/inativar': {
        const id = await leitoNovo(e);
        entrada = { id, versao: await versaoLeito(e, id) };
        return;
      }
      case 'organizacao.inativarLeito/recusa-ocupado': {
        const id = await leitoNovo(e);
        // Ocupação posta como a internação do legado faria (nenhuma receita do cadastro grava REG).
        await e.executar('UPDATE RILEITOS SET REG = 1 WHERE ID = ?', [id]);
        entrada = { id, versao: await versaoLeito(e, id) };
        recusaEsperada = 'leito-ocupado';
        return;
      }
      case 'organizacao.reativarLeito/reativar': {
        const id = await leitoNovo(e);
        await executarOutra(e, 'organizacao.inativarLeito', { id, versao: await versaoLeito(e, id) });
        entrada = { id, versao: await versaoLeito(e, id) };
        return;
      }
      case 'organizacao.reativarLeito/recusa-ja-ativo': {
        const id = await leitoNovo(e);
        entrada = { id, versao: await versaoLeito(e, id) };
        recusaEsperada = 'ja-ativo';
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
