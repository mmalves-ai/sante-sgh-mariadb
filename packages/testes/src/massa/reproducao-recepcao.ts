// Reprodução dos cenários de assinatura da recepção (M19; ficha, seção 9) pelo EXECUTOR, na transação da captura
// (sempre desfeita). A preparação (antes do retrato "antes") cria pelo próprio executor o operador sintético, o guichê
// aberto por ele, as senhas do dia (recepcao.emitirSenha), as chamadas e as suspensões de partida; o cenário executa
// só a receita sob teste. O que nenhuma receita do marco grava e o cenário precisa como estado de partida — a senha
// com o atendimento aberto (a abertura é do M20) e a chamada no local (o fluxo do local é do M20) — é posto por
// INSERT/UPDATE na transação desfeita, como o atendimento faria. A chegada usa uma marcação de consulta e uma de exame
// da cópia sem senha (só o ID em memória), com a data passada para hoje só na transação desfeita. Nenhum valor de
// linha sai: só IDs em memória.
import { type CenarioCaptura, ErroOperacao, type Escritor } from '@sgh/legado';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_RECEPCAO = new Set([
  'recepcao.emitirSenha',
  'recepcao.chamarSenha',
  'recepcao.registrarEventoSenha',
  'recepcao.registrarChegada',
  'recepcao.desfazerChegada',
  'recepcao.abrirGuiche',
  'recepcao.fecharGuiche',
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

const num = (v: unknown) => Number(v ?? 0);
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

export interface GeradorEscolhido {
  readonly id: number;
  readonly recepcao: number;
  readonly local: number;
  readonly tipo: string;
}

/**
 * Gerador ativo da cópia (tipo e marca de prioritária pedidos), de uma recepção com local ativo, sem senha nem
 * contador no dia (o dia da cópia não tem senhas: o retrato é de 2026-07). `excluir`: os já usados no cenário.
 */
export async function geradorLivre(
  e: Escritor,
  o: { tipo?: '0' | '5'; prioritaria?: boolean; ativo?: boolean; excluir?: readonly number[] } = {},
): Promise<GeradorEscolhido> {
  const linhas = await e.consultar(
    `SELECT g.ID, g.ID_TBRECEPCAO, g.TIPO, g.GERAR_PRIORITARIA, g.SITUACAO,
        (SELECT FIRST 1 l.ID FROM TBLOCAL l WHERE l.ID_TBRECEPCAO = g.ID_TBRECEPCAO AND COALESCE(l.ATIVO, 'T') <> 'F' ORDER BY l.COD) LOCAL
       FROM TBGERASENHA g
      WHERE g.TIPO IN ('0', '5')
        AND NOT EXISTS (SELECT 1 FROM TBULTSENHATEND u WHERE u.DATA = CURRENT_DATE AND u.ID_TBGERASENHA = g.ID)
      ORDER BY g.ID`,
    [],
    { teto: 500 },
  );
  const x = linhas.find(
    (l) =>
      (o.tipo === undefined || txt(l['TIPO']) === o.tipo) &&
      (o.prioritaria === undefined || (txt(l['GERAR_PRIORITARIA']) === 'T') === o.prioritaria) &&
      ((o.ativo ?? true) ? txt(l['SITUACAO']) !== 'F' : txt(l['SITUACAO']) === 'F') &&
      num(l['LOCAL']) > 0 &&
      !(o.excluir ?? []).includes(num(l['ID'])),
  );
  if (!x) throw new Error('Nenhum gerador elegível na cópia.');
  return {
    id: num(x['ID']),
    recepcao: num(x['ID_TBRECEPCAO']),
    local: num(x['LOCAL']),
    tipo: txt(x['TIPO']),
  };
}

/**
 * Número de guichê do CADASTRO da recepção (TBGUICHE) livre na recepção inteira (o número é único por recepção, em
 * qualquer local, como o outro sistema confere); o operador sintético o abre, nunca o de uma pessoa real. Sem número
 * livre no cadastro, o escritor legado simulado cadastra um (o cadastro de guichês do outro sistema), só na transação
 * desfeita. `_local` fica na assinatura por compatibilidade com os chamadores; `depois`: o primeiro número a tentar
 * no cadastro simulado.
 */
export async function guicheLivre(
  e: Escritor,
  recepcao: number,
  _local: number,
  depois = 90,
): Promise<number> {
  const [cadastro, emUso] = await Promise.all([
    e.consultar(
      'SELECT NUMERO_GUICHE FROM TBGUICHE WHERE ID_TBRECEPCAO = ? ORDER BY NUMERO_GUICHE',
      [recepcao],
      {
        teto: 200,
      },
    ),
    e.consultar('SELECT NUMERO_GUICHE FROM TBSTATUSGUICHE WHERE ID_TBRECEPCAO = ?', [recepcao], {
      teto: 200,
    }),
  ]);
  const usados = new Set(emUso.map((l) => num(l['NUMERO_GUICHE'])));
  const cadastrados = cadastro.map((l) => num(l['NUMERO_GUICHE']));
  const livre = cadastrados.find((g) => g >= 1 && g <= 99 && !usados.has(g));
  if (livre !== undefined) return livre;
  for (let g = depois; g <= 99; g++)
    if (!usados.has(g) && !cadastrados.includes(g)) {
      await legadoCadastraGuiche(e, recepcao, g);
      return g;
    }
  throw new Error('Nenhum número de guichê livre.');
}

/** O cadastro de guichê do outro sistema (TBGUICHE: número + recepção), só na transação desfeita. */
export async function legadoCadastraGuiche(e: Escritor, recepcao: number, guiche: number): Promise<void> {
  await e.executar('INSERT INTO TBGUICHE (NUMERO_GUICHE, ID_TBRECEPCAO) VALUES (?, ?)', [guiche, recepcao]);
}

/** O outro sistema abre o guichê (o que o SP_CONTROLA_GUICHE grava: a linha de TBSTATUSGUICHE). */
export async function legadoAbreGuiche(
  e: Escritor,
  g: { recepcao: number; local: number; guiche: number },
  login: string,
): Promise<void> {
  await e.executar(
    'INSERT INTO TBSTATUSGUICHE (NUMERO_GUICHE, ID_TBRECEPCAO, ID_TBUSERS, ID_TBLOCAL) VALUES (?, ?, ?, ?)',
    [g.guiche, g.recepcao, login, g.local],
  );
}

/** Número fora do cadastro de guichês da recepção (e fora de uso). */
export async function guicheSemCadastro(e: Escritor, recepcao: number): Promise<number> {
  const linhas = await e.consultar(
    `SELECT NUMERO_GUICHE FROM TBGUICHE WHERE ID_TBRECEPCAO = ?
     UNION SELECT NUMERO_GUICHE FROM TBSTATUSGUICHE WHERE ID_TBRECEPCAO = ?`,
    [recepcao, recepcao],
    { teto: 400 },
  );
  const usados = new Set(linhas.map((l) => num(l['NUMERO_GUICHE'])));
  for (let g = 99; g >= 1; g--) if (!usados.has(g)) return g;
  throw new Error('Nenhum número fora do cadastro.');
}

/** Dois locais ativos da mesma recepção, com um gerador ativo dela (o mesmo número em dois locais). */
export async function recepcaoComDoisLocais(
  e: Escritor,
): Promise<{ recepcao: number; local: number; outroLocal: number; gerador: number }> {
  const linhas = await e.consultar(
    `SELECT l.ID_TBRECEPCAO R, l.ID,
        (SELECT FIRST 1 g.ID FROM TBGERASENHA g WHERE g.ID_TBRECEPCAO = l.ID_TBRECEPCAO AND g.TIPO IN ('0', '5')
          AND COALESCE(g.SITUACAO, 'T') <> 'F' ORDER BY g.ID) G
       FROM TBLOCAL l
      WHERE COALESCE(l.ATIVO, 'T') <> 'F'
      ORDER BY l.ID_TBRECEPCAO, l.COD`,
    [],
    { teto: 500 },
  );
  const por = new Map<number, { locais: number[]; gerador: number }>();
  for (const l of linhas) {
    if (num(l['G']) === 0) continue;
    const x = por.get(num(l['R'])) ?? { locais: [], gerador: num(l['G']) };
    x.locais.push(num(l['ID']));
    por.set(num(l['R']), x);
  }
  for (const [recepcao, x] of por)
    if (x.locais.length >= 2)
      return {
        recepcao,
        local: x.locais[0] as number,
        outroLocal: x.locais[1] as number,
        gerador: x.gerador,
      };
  throw new Error('Nenhuma recepção com dois locais ativos na cópia.');
}

/** Atendimento da cópia sem senha ligada (só o ID: a ligação acontece só na transação desfeita). */
async function atendimentoSemSenha(e: Escritor): Promise<string> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 CAST(a.ID AS VARCHAR(20)) ID FROM ATCABECATEND a
      WHERE NOT EXISTS (SELECT 1 FROM ATCABECATEND_TBSENHAATEND s WHERE s.ID_ATCABECATEND = a.ID)
      ORDER BY a.ID DESC`,
    [],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!x) throw new Error('Nenhum atendimento sem senha na cópia.');
  return txt(x['ID']);
}

/** Local com encaminhamento permitido (TBLOCALENCATE) e a recepção dele. */
async function parEncaminhamento(e: Escritor): Promise<{ de: number; para: number; recepcao: number }> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 p.ID_TBLOCAL DE, p.ID_TBLOCAL_ENCAM_ATEND PARA, l.ID_TBRECEPCAO R
       FROM TBLOCALENCATE p JOIN TBLOCAL l ON l.ID = p.ID_TBLOCAL JOIN TBLOCAL d ON d.ID = p.ID_TBLOCAL_ENCAM_ATEND
      WHERE COALESCE(l.ATIVO, 'T') <> 'F' AND COALESCE(d.ATIVO, 'T') <> 'F' AND p.ID_TBLOCAL <> p.ID_TBLOCAL_ENCAM_ATEND
      ORDER BY p.ID_TBLOCAL`,
    [],
    { teto: 1 },
  );
  if (!x) throw new Error('Nenhum encaminhamento permitido na cópia.');
  return { de: num(x['DE']), para: num(x['PARA']), recepcao: num(x['R']) };
}

/** Marcação da cópia (consulta ou exame) sem senha ligada, com a data passada para hoje na transação desfeita. */
async function marcacaoDeHoje(e: Escritor, tipo: 'consulta' | 'exame', semFicha = false): Promise<number> {
  const tabela = tipo === 'consulta' ? 'REPACAGD' : 'SIPACAGD';
  const vinculo = tipo === 'consulta' ? 'TBSENHAATEND_REPACAGD' : 'TBSENHAATEND_SIPACAGD';
  const coluna = tipo === 'consulta' ? 'ID_REPACAGD' : 'ID_SIPACAGD';
  // Sem ficha (desfazer a chegada): a marcação de consulta no estado "não atendida" da regra única de volta.
  const filtro =
    semFicha && tipo === 'consulta'
      ? " AND COALESCE(d.REGISTRO, 0) = 0 AND COALESCE(d.ATENDIDO, 'N') = 'N'"
      : '';
  const [x] = await e.consultar(
    `SELECT FIRST 1 d.ID FROM ${tabela} d
      WHERE d.DATA BETWEEN CURRENT_DATE - 200 AND CURRENT_DATE AND NOT EXISTS (SELECT 1 FROM ${vinculo} v WHERE v.${coluna} = d.ID)${filtro}
      ORDER BY d.DATA DESC, d.ID DESC`,
    [],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!x) throw new Error(`Nenhuma marcação de ${tipo} sem senha na cópia.`);
  const id = num(x['ID']);
  await e.executar(`UPDATE ${tabela} SET DATA = CURRENT_DATE WHERE ID = ?`, [id]);
  return id;
}

// ── Escritor legado simulado (cap-14 §14.2.2; teste de integração, transação SEMPRE desfeita) ───────────────

/**
 * O balcão do outro sistema emite uma senha: o procedimento do contador (última + 1 em TBULTSENHATEND) e a linha da
 * senha. Devolve o número emitido.
 */
export async function legadoEmiteSenha(e: Escritor, gerador: number, usuario: string): Promise<number> {
  await e.executar(
    'UPDATE TBULTSENHATEND SET SENHA = SENHA + 1 WHERE DATA = CURRENT_DATE AND ID_TBGERASENHA = ?',
    [gerador],
  );
  const [u] = await e.consultar(
    'SELECT SENHA FROM TBULTSENHATEND WHERE DATA = CURRENT_DATE AND ID_TBGERASENHA = ?',
    [gerador],
    { teto: 1 },
  );
  const numero = num(u?.['SENHA']);
  await e.executar(
    `INSERT INTO TBSENHAATEND (ID_TBGERASENHA, DATA_SENHA, SENHA, GUICHE, PRIORIDADE, SITUACAO, USUARIO, MOTIVO)
     VALUES (?, CURRENT_DATE, ?, 0, '2', 'G', ?, '')`,
    [gerador, numero, usuario],
  );
  return numero;
}

/** O guichê do outro sistema chama a senha (o procedimento SPSENHAATEND: usuário e guichê na senha). */
export async function legadoChamaSenha(
  e: Escritor,
  senha: number,
  guiche: number,
  usuario: string,
): Promise<void> {
  await e.executar('UPDATE TBSENHAATEND SET GUICHE = ?, USUARIO = ? WHERE ID = ?', [guiche, usuario, senha]);
}

/** A abertura do atendimento (M20) liga a senha a um atendimento e a põe em atendimento. */
export async function legadoAbreAtendimento(e: Escritor, senha: number, atendimento: string): Promise<void> {
  await e.executar(
    'INSERT INTO ATCABECATEND_TBSENHAATEND (ID_ATCABECATEND, ID_TBSENHAATEND) VALUES (CAST(CAST(? AS VARCHAR(20)) AS NUMERIC(13,0)), ?)',
    [atendimento, senha],
  );
  await e.executar("UPDATE TBSENHAATEND SET SITUACAO = 'A' WHERE ID = ?", [senha]);
}

export function cenarioRecepcao(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  operadorSintetico: (e: Escritor) => Promise<string>,
): CenarioCaptura {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  const preparadas: number[] = [];

  const emitir = async (e: Escritor, g: GeradorEscolhido, prioridade: '0' | '1' | '2' = '2') => {
    const r = await executarOutra(e, 'recepcao.emitirSenha', { gerador: g.id, prioridade, origem: 'balcao' });
    const id = num(r.resultado['senha']);
    preparadas.push(id);
    return id;
  };
  const abrir = async (e: Escritor, g: GeradorEscolhido) => {
    const guiche = await guicheLivre(e, g.recepcao, g.local);
    await executarOutra(e, 'recepcao.abrirGuiche', { recepcao: g.recepcao, local: g.local, guiche });
    return guiche;
  };
  const chamar = async (e: Escritor, g: GeradorEscolhido, guiche: number) => {
    await executarOutra(e, 'recepcao.chamarSenha', {
      recepcao: g.recepcao,
      local: g.local,
      guiche,
      geradores: [g.id],
    });
  };
  /** A senha com o atendimento aberto (estado de partida do M20), na transação desfeita. */
  const comAtendimento = async (e: Escritor, senha: number, situacao: 'A' | 'C') => {
    const at = await atendimentoSemSenha(e);
    await e.executar(
      'INSERT INTO ATCABECATEND_TBSENHAATEND (ID_ATCABECATEND, ID_TBSENHAATEND) VALUES (CAST(CAST(? AS VARCHAR(20)) AS NUMERIC(13,0)), ?)',
      [at, senha],
    );
    await e.executar('UPDATE TBSENHAATEND SET SITUACAO = ? WHERE ID = ?', [situacao, senha]);
  };

  /** Quem opera o guichê: outro operador sintético, como no dia a dia (a senha nasce no totem). */
  const outroOperador = (e: Escritor) => operadorSintetico(e);

  const preparar = async (e: Escritor): Promise<void> => {
    // O emissor (o "totem" da preparação): o primeiro operador sintético.
    await operadorSintetico(e);
    switch (nome) {
      case 'recepcao.emitirSenha': {
        if (cenario === 'recusa') {
          const g = await geradorLivre(e, { ativo: false });
          entrada = { gerador: g.id, prioridade: '2', origem: 'balcao' };
          recusaEsperada = 'gerador-inativo';
          return;
        }
        if (cenario === 'primeira-do-dia') {
          const g = await geradorLivre(e, { tipo: '5', prioritaria: false });
          entrada = { gerador: g.id, prioridade: '2', origem: 'balcao' };
          return;
        }
        if (cenario === 'totem-80') {
          const g = await geradorLivre(e, { prioritaria: true });
          await emitir(e, g);
          entrada = { gerador: g.id, prioridade: '0', grupo: 0, origem: 'totem', dispositivo: 1 };
          return;
        }
        const g = await geradorLivre(e, { tipo: '5', prioritaria: false });
        await emitir(e, g);
        entrada = { gerador: g.id, prioridade: '2', origem: 'balcao' };
        return;
      }
      case 'recepcao.chamarSenha': {
        const g = await geradorLivre(e, { tipo: '5', prioritaria: false });
        const primeira = await emitir(e, g);
        // M39 (regra 3): a primeira da fila já chamada pelo outro sistema (guichê e usuário dele na senha) antes de o
        // executor ler a fila; o novo chama a seguinte (a segunda senha emitida agora). A corrida no meio da chamada
        // fica no teste da receita (recepcao.spec.ts).
        if (cenario === 'disputa-legado') {
          await emitir(e, g);
          await legadoChamaSenha(e, primeira, 99, await outroOperador(e));
        }
        await outroOperador(e);
        const guiche = cenario === 'recusa' ? await guicheLivre(e, g.recepcao, g.local) : await abrir(e, g);
        entrada = { recepcao: g.recepcao, local: g.local, guiche, geradores: [g.id] };
        if (cenario === 'recusa') recusaEsperada = 'guiche-fechado';
        return;
      }
      case 'recepcao.registrarEventoSenha': {
        if (cenario === 'encaminhar' || cenario === 'cancelar' || cenario === 'nao-localizado-local') {
          const par = await parEncaminhamento(e);
          const g = await geradorLivre(e, { tipo: '0' });
          const senha = await emitir(e, g);
          await comAtendimento(e, senha, cenario === 'encaminhar' ? 'A' : 'C');
          await outroOperador(e);
          entrada =
            cenario === 'encaminhar'
              ? { senha, evento: 'encaminhar', local: par.de, guiche: 0, destino: par.para }
              : {
                  senha,
                  evento: cenario === 'cancelar' ? 'cancelarChamada' : 'naoLocalizadoNoLocal',
                  local: par.de,
                  guiche: 0,
                };
          return;
        }
        const g = await geradorLivre(e, { tipo: '5', prioritaria: false });
        const senha = await emitir(e, g);
        if (cenario === 'finalizar') {
          entrada = { senha, evento: 'finalizar', local: g.local, guiche: 0 };
          recusaEsperada = 'letra-nunca-vista';
          return;
        }
        await outroOperador(e);
        const guiche = await abrir(e, g);
        await chamar(e, g, guiche);
        const ev = { senha, local: g.local, guiche };
        if (cenario === 'retomar') {
          await executarOutra(e, 'recepcao.registrarEventoSenha', {
            ...ev,
            evento: 'suspender',
            motivo: 'DOCUMENTO',
          });
          // Outra pessoa, noutro guichê, chama a suspensa (o guichê e o usuário mudam).
          await outroOperador(e);
          const outro = await abrir(e, g);
          entrada = { senha, local: g.local, guiche: outro, evento: 'retomar' };
          return;
        }
        entrada =
          cenario === 'rechamar'
            ? { ...ev, evento: 'rechamar' }
            : cenario === 'nao-localizado'
              ? { ...ev, evento: 'naoLocalizado' }
              : cenario === 'suspender'
                ? { ...ev, evento: 'suspender', motivo: 'DESISTIU' }
                : { ...ev, evento: 'liberar' };
        return;
      }
      case 'recepcao.registrarChegada': {
        if (cenario === 'servico-diverso') {
          // A senha de serviços diversos (tipo 5) e uma marcação de consulta do dia: recusada, nada gravado.
          const g = await geradorLivre(e, { tipo: '5', prioritaria: false });
          const senha = await emitir(e, g);
          entrada = { senha, tipo: 'consulta', marcacao: await marcacaoDeHoje(e, 'consulta') };
          recusaEsperada = 'senha-de-servico-diverso';
          return;
        }
        const g = await geradorLivre(e, { tipo: '0' });
        const senha = await emitir(e, g);
        if (cenario === 'recusa') {
          // Marcação de outro dia (a data da cópia, sem passar para hoje).
          const [x] = await e.consultar(
            `SELECT FIRST 1 d.ID FROM REPACAGD d WHERE d.DATA < CURRENT_DATE
              AND NOT EXISTS (SELECT 1 FROM TBSENHAATEND_REPACAGD v WHERE v.ID_REPACAGD = d.ID) ORDER BY d.DATA DESC`,
            [],
            { teto: 1, tempoMaximoMs: 120_000 },
          );
          entrada = { senha, tipo: 'consulta', marcacao: num(x?.['ID']) };
          recusaEsperada = 'marcacao-de-outro-dia';
          return;
        }
        const tipo = cenario === 'exame' ? 'exame' : 'consulta';
        entrada = { senha, tipo, marcacao: await marcacaoDeHoje(e, tipo) };
        return;
      }
      case 'recepcao.desfazerChegada': {
        // A chegada registrada na preparação pelo próprio executor (marcação da cópia sem ficha, data passada para
        // hoje na transação desfeita); o cenário só a desfaz. Com ficha: o atendimento aberto pela senha recusa.
        const g = await geradorLivre(e, { tipo: '0' });
        const senha = await emitir(e, g);
        const tipo = cenario === 'exame' ? 'exame' : 'consulta';
        await executarOutra(e, 'recepcao.registrarChegada', {
          senha,
          tipo,
          marcacao: await marcacaoDeHoje(e, tipo, true),
        });
        if (cenario === 'com-ficha') {
          await comAtendimento(e, senha, 'A');
          recusaEsperada = 'chegada-com-ficha';
        }
        entrada = { senha, motivo: 'Chegada registrada no paciente errado (cenário de assinatura)' };
        return;
      }
      case 'recepcao.abrirGuiche': {
        if (cenario === 'recusa') {
          // Guichê em uso por uma pessoa (linha da cópia; só os números em memória).
          const [x] = await e.consultar(
            'SELECT FIRST 1 NUMERO_GUICHE, ID_TBRECEPCAO, ID_TBLOCAL FROM TBSTATUSGUICHE',
            [],
            {
              teto: 1,
            },
          );
          if (!x) throw new Error('Nenhum guichê em uso na cópia.');
          entrada = {
            recepcao: num(x['ID_TBRECEPCAO']),
            local: num(x['ID_TBLOCAL']),
            guiche: num(x['NUMERO_GUICHE']),
          };
          recusaEsperada = 'guiche-ocupado';
          return;
        }
        if (cenario === 'outro-local') {
          // O outro sistema abre o número no primeiro local; aqui, o mesmo número no segundo local da recepção.
          const r = await recepcaoComDoisLocais(e);
          const guiche = await guicheLivre(e, r.recepcao, r.local);
          await legadoAbreGuiche(e, { recepcao: r.recepcao, local: r.local, guiche }, await outroOperador(e));
          await outroOperador(e);
          entrada = { recepcao: r.recepcao, local: r.outroLocal, guiche };
          recusaEsperada = 'guiche-ocupado';
          return;
        }
        if (cenario === 'sem-cadastro') {
          const g = await geradorLivre(e, { tipo: '5' });
          entrada = { recepcao: g.recepcao, local: g.local, guiche: await guicheSemCadastro(e, g.recepcao) };
          recusaEsperada = 'guiche-nao-cadastrado';
          return;
        }
        const g = await geradorLivre(e, { tipo: '5' });
        if (cenario === 'troca') await abrir(e, g);
        entrada = {
          recepcao: g.recepcao,
          local: g.local,
          guiche: await guicheLivre(e, g.recepcao, g.local, 95),
        };
        return;
      }
      case 'recepcao.fecharGuiche': {
        if (cenario === 'recusa') {
          const [x] = await e.consultar(
            'SELECT FIRST 1 NUMERO_GUICHE, ID_TBRECEPCAO, ID_TBLOCAL FROM TBSTATUSGUICHE',
            [],
            {
              teto: 1,
            },
          );
          if (!x) throw new Error('Nenhum guichê em uso na cópia.');
          entrada = {
            recepcao: num(x['ID_TBRECEPCAO']),
            local: num(x['ID_TBLOCAL']),
            guiche: num(x['NUMERO_GUICHE']),
          };
          recusaEsperada = 'guiche-de-outro';
          return;
        }
        const g = await geradorLivre(e, { tipo: '5' });
        const guiche = await abrir(e, g);
        entrada = { recepcao: g.recepcao, local: g.local, guiche };
        return;
      }
      default:
        throw new Error(`Operação ${nome} sem reprodução na recepção.`);
    }
  };

  return {
    ...base,
    // TBSENHAATEND passa do retrato completo (301 mil linhas): as senhas da preparação que o cenário altera são
    // retratadas pelas chaves-alvo (M13); a emissão só inclui (o modo da chave vê a linha nova).
    chavesAlvo: () =>
      nome === 'recepcao.emitirSenha' || preparadas.length === 0
        ? {}
        : { TBSENHAATEND: preparadas.map((id) => ({ ID: id })) },
    async preparar(e) {
      await preparar(e);
    },
    async executar(e) {
      if (recusaEsperada) await exigirRecusa(executar(e, entrada), recusaEsperada);
      else await executar(e, entrada);
    },
  };
}
