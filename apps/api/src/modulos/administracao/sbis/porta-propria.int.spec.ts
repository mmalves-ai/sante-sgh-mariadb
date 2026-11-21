// Integração da porta própria da certificação SBIS (M59-F5) contra o MariaDB real, no cliente de teste da onda 2
// (f22_o2, banco cliente_f22_o2). Massa SINTÉTICA do lote 02-06 (prefixo F22L0206; nenhuma pessoa real): dois
// estabelecimentos e dois usuários. Contrato de efeito: a restauração registrada deixa a linha em verificacao_backup
// (versão 1, processo "restauracao", usuário por id) e a linha da trilha na mesma transação; as recusas (usuário ou
// estabelecimento desconhecido) não gravam nada. Os ciclos rodam só quando as tabelas pedidas ao modelo existem
// (ciclo_certificacao e ciclo_certificacao_item); sem elas, a porta diz quais faltam. PENDENTE DO DDL: enquanto as
// duas tabelas não existem, o caso dos ciclos é pulado (skip, não aprovado); o SQL das gravações de ciclo fica provado
// em porta-propria.spec.ts, sobre o dublê do núcleo. O reenvio com a mesma Idempotency-Key grava uma linha só.
// Os estabelecimentos e os usuários de teste ficam (a trilha aponta para eles); o resto sai no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { REQUISITOS_SBIS } from '@sgh/contratos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../../problema.filter.js';
import type { TrilhaSbis } from './porta.js';
import { PortaSbisPropria, TABELAS_SBIS } from './porta-propria.js';

const CLIENTE = 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST_A = 'f0206a';
const EST_B = 'f0206b';
const LOGIN_A = 'F22L0206.AVALIADOR';
const LOGIN_B = 'F22L0206.VERIFICADOR';
/** Sufixo das correlações desta execução (a trilha de execuções anteriores fica no banco). */
const RODADA = Date.now().toString(36);

const codigo = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroProblema ? String(e.extras['codigo'] ?? e.tipo) : String(e);
  }
};

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: unknown }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('porta própria da certificação SBIS contra o MariaDB (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSbisPropria;
  let estA = 0;
  let estB = 0;
  let usuA = 0;
  let usuB = 0;
  let faltamCiclos: string[] = [];

  const trilha = (login: string, operacao: string, hospital = EST_A): TrilhaSbis => ({
    rede: '',
    hospital,
    usuario: login,
    evento: 'teste.sbis',
    recurso: 'auditoria.sbis',
    operacao,
    resultado: 'sucesso',
    estacao: null,
    correlacao: `f22l0206-${operacao}-${RODADA}`.slice(0, 64),
    chaveIdempotencia: `f22l0206.${operacao}.${RODADA}`.slice(0, 80),
  });
  const trilhas = async (...ts: TrilhaSbis[]) =>
    Number(
      (
        await ler<{ n: unknown }>(
          `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao IN (${ts.map(() => '?').join(', ')})`,
          ts.map((t) => t.correlacao),
        )
      )[0]?.n,
    );
  const ler = <T>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f22l0206' }, (l) =>
      l.consultar<T & Record<string, unknown>>(sql, p),
    );

  async function limpar(e: Escritor): Promise<void> {
    const usuarios = (
      await e.consultar<{ id: unknown }>('SELECT id FROM usuario WHERE login IN (?, ?)', [LOGIN_A, LOGIN_B])
    ).map((x) => Number(x.id));
    if (usuarios.length)
      await e.executar(
        `DELETE FROM verificacao_backup WHERE usuario_id IN (${usuarios.map(() => '?').join(', ')})`,
        usuarios,
      );
    const tem = await e.consultar<{ n: unknown }>(
      `SELECT TABLE_NAME AS n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('ciclo_certificacao', 'ciclo_certificacao_item')`,
      [],
    );
    if (tem.length === 2) {
      const ests = (
        await e.consultar<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo IN (?, ?)', [EST_A, EST_B])
      ).map((x) => Number(x.id));
      if (ests.length) {
        const q = ests.map(() => '?').join(', ');
        await e.executar(
          `DELETE i FROM ciclo_certificacao_item i JOIN ciclo_certificacao c ON c.id = i.ciclo_certificacao_id
            WHERE c.estabelecimento_id IN (${q})`,
          ests,
        );
        await e.executar(`DELETE FROM ciclo_certificacao WHERE estabelecimento_id IN (${q})`, ests);
      }
    }
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_f22_o2');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f22l0206' }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const est = (codigo: string, cnes: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, cnpj, criado_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, cnes, null, agora],
        );
      estA = await est(EST_A, '0020601');
      estB = await est(EST_B, '0020602');
      const usuario = (login: string, cpf: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
          [login, `Usuário sintético ${login}`, cpf, agora],
        );
      usuA = await usuario(LOGIN_A, '90206000191');
      usuB = await usuario(LOGIN_B, '90206000272');
    });
    porta = new PortaSbisPropria(nucleo, CLIENTE);
    faltamCiclos = await porta.faltando(EST_A, 'ciclos');
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f22l0206' }, (e) => limpar(e)).catch(() => undefined);
      await nucleo.encerrar();
    }
  });

  it('faltando: por recurso; o backup e as concessões não dependem de tabela nova', async () => {
    expect(await porta.faltando(EST_A, 'backup')).toEqual([]);
    expect(await porta.faltando(EST_A, 'concessoes')).toEqual([]);
    for (const t of faltamCiclos) expect(TABELAS_SBIS.ciclos).toContain(t);
  });

  it('concessões: sem convivência, as seis constam encerradas; reabrir e prever fim são recusados', async () => {
    const c = await porta.concessoes();
    // As seis concessões provisórias do termo antigo (o termo sai com a limpeza da onda 5, ADR 0003).
    expect(c).toHaveLength(6);
    expect(c.every((x) => x.situacao === 'encerrada')).toBe(true);
    const t = trilha(LOGIN_A, 'reabrir');
    expect(await codigo(porta.reabrir(EST_A, { codigo: 'privilegio-banco', motivo: 'teste', por: LOGIN_A }, t))).toBe(
      'sem-convivencia',
    );
    expect(
      await codigo(porta.prever(EST_A, { codigo: 'privilegio-banco', fimPrevisto: null, por: LOGIN_A }, t)),
    ).toBe('sem-convivencia');
  });

  it('restauração: a linha em verificacao_backup, a trilha na mesma transação e a leitura de volta', async () => {
    const t = trilha(LOGIN_A, 'registrar');
    const inicio = new Date(Date.now() - 3_600_000).toISOString();
    const fim = new Date(Date.now() - 600_000).toISOString();
    const { id } = await porta.registrarRestauracao(
      EST_A,
      {
        por: LOGIN_A,
        pedido: {
          tipo: 'mensal',
          inicio,
          fim,
          resultado: 'ok',
          integridade: 'nao-verificada',
          tamanhoMb: 12,
          ambiente: 'Ambiente de restauração sintético',
          observacao: 'Teste do lote 02-06',
        },
      },
      t,
    );
    const [linha] = await ler<{ processo: string; situacao: string; versao: unknown; usuario_id: unknown; tamanho_bytes: unknown }>(
      'SELECT processo, situacao, versao, usuario_id, tamanho_bytes FROM verificacao_backup WHERE id = ?',
      [Number(id)],
    );
    expect(linha).toMatchObject({ processo: 'restauracao', situacao: 'concluido' });
    expect(Number(linha?.versao)).toBe(1);
    expect(Number(linha?.usuario_id)).toBe(usuA);
    expect(Number(linha?.tamanho_bytes)).toBe(12 * 1_048_576);
    const rastros = await ler<{ entidade: string; entidade_id: unknown; usuario_id: unknown; estabelecimento_id: unknown }>(
      'SELECT entidade, entidade_id, usuario_id, estabelecimento_id FROM trilha_auditoria WHERE correlacao = ?',
      [t.correlacao],
    );
    expect(rastros).toHaveLength(1);
    expect(rastros[0]).toMatchObject({ entidade: 'verificacao_backup' });
    expect(Number(rastros[0]?.entidade_id)).toBe(Number(id));
    expect(Number(rastros[0]?.usuario_id)).toBe(usuA);
    expect(Number(rastros[0]?.estabelecimento_id)).toBe(estA);
    const lidas = await porta.restauracoes(EST_A);
    const r = lidas.find((x) => x.id === id);
    expect(r).toMatchObject({
      tipo: 'mensal',
      resultado: 'ok',
      integridade: 'nao-verificada',
      tamanhoMb: 12,
      registradoPor: LOGIN_A,
      observacao: 'Teste do lote 02-06',
      duracaoMinutos: 50,
    });
  });

  it('idempotência: o reenvio com a mesma chave devolve o mesmo id, com uma linha e uma trilha só', async () => {
    const t = trilha(LOGIN_A, 'reenvio');
    const pedido = {
      tipo: 'diaria' as const,
      inicio: new Date(Date.now() - 5_400_000).toISOString(),
      fim: new Date(Date.now() - 5_000_000).toISOString(),
      resultado: 'ok' as const,
      integridade: 'ok' as const,
      ambiente: 'Ambiente sintético de reenvio',
    };
    const a = await porta.registrarRestauracao(EST_A, { por: LOGIN_A, pedido }, t);
    const b = await porta.registrarRestauracao(EST_A, { por: LOGIN_A, pedido }, t);
    expect(b).toEqual(a);
    const n = await ler<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM verificacao_backup WHERE usuario_id = ? AND destino = 'Ambiente sintético de reenvio'",
      [usuA],
    );
    expect(Number(n[0]?.n)).toBe(1);
    expect(await trilhas(t)).toBe(1);
  });

  it('recusas: usuário ou estabelecimento desconhecido não grava nada', async () => {
    const pedido = {
      tipo: 'diaria' as const,
      inicio: new Date(Date.now() - 7_200_000).toISOString(),
      fim: new Date(Date.now() - 3_600_000).toISOString(),
      resultado: 'falhou' as const,
      integridade: 'falhou' as const,
      ambiente: 'Ambiente sintético',
    };
    const t1 = trilha('F22L0206.NINGUEM', 'recusa-usuario');
    expect(await codigo(porta.registrarRestauracao(EST_A, { por: 'F22L0206.NINGUEM', pedido }, t1))).toBe(
      'usuario-desconhecido',
    );
    const t2 = trilha(LOGIN_A, 'recusa-estab', 'f0206zz');
    expect(await codigo(porta.registrarRestauracao('f0206zz', { por: LOGIN_A, pedido }, t2))).toBe(
      'estabelecimento-desconhecido',
    );
    const n = await ler<{ n: unknown }>('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao IN (?, ?)', [
      t1.correlacao,
      t2.correlacao,
    ]);
    expect(Number(n[0]?.n)).toBe(0);
  });

  it('identificação, política e prova da cadeia', async () => {
    expect(await porta.identificacao(EST_A)).toEqual({
      nome: `Hospital sintético ${EST_A}`,
      cnes: '0020601',
      cnpj: null,
    });
    expect(await codigo(porta.identificacao('f0206zz'))).toBe('nao-encontrado');
    const cfg = await porta.configSeguranca(EST_A);
    expect(cfg.limiteTentativas).toBeGreaterThan(0);
    expect(cfg.inatividadeSegundos).toBeGreaterThan(0);
    expect(await codigo(porta.verificarDias(EST_A, ['2026-11-20']))).toBe('trilha-sem-encadeamento');
  });

  it('ciclo (quando as tabelas existem): abrir, avaliar, corrigir, verificar por outra pessoa, concluir', async (ctx) => {
    if (faltamCiclos.length > 0) ctx.skip();
    const requisitos = REQUISITOS_SBIS.slice(0, 3).map((r) => r.codigo);
    const [r1, r2, r3] = requisitos as [string, string, string];
    const novo = {
      tipo: 'autoavaliacao',
      competencia: '2026-11',
      versao: '1.0.0',
      referencia: 'Manual sintético',
      avaliador: null,
      por: LOGIN_A,
      requisitos,
    };
    const aberto = await porta.abrir(EST_A, novo, trilha(LOGIN_A, 'abrir'));
    expect(aberto).not.toBeNull();
    const id = aberto!.id;
    const recusadas: TrilhaSbis[] = [trilha(LOGIN_A, 'abrir-2')];
    expect(await porta.abrir(EST_A, novo, recusadas[0]!)).toBeNull();
    // Outro estabelecimento não grava no ciclo de A.
    const tOutro = trilha(LOGIN_A, 'avaliar-outro', EST_B);
    recusadas.push(tOutro);
    expect(
      await porta.avaliar(EST_B, { idCiclo: id, requisito: r1, por: LOGIN_A, pedido: { resultado: 'conforme' } }, tOutro),
    ).toBe(false);
    expect(await porta.ciclo(EST_B, id)).toBeNull();
    expect(await porta.itens(EST_B, id)).toEqual([]);
    expect((await porta.itens(EST_A, id)).map((i) => i.requisito)).toEqual(requisitos);
    const av = (requisito: string, pedido: Parameters<PortaSbisPropria['avaliar']>[1]['pedido']) =>
      porta.avaliar(EST_A, { idCiclo: id, requisito, por: LOGIN_A, pedido }, trilha(LOGIN_A, `avaliar-${requisito}-${pedido.resultado}`));
    expect(await av(r1, { resultado: 'conforme' })).toBe(true);
    expect(await av(r2, { resultado: 'nao-aplicavel' })).toBe(true);
    expect(
      await porta.concluir(
        EST_A,
        { id, parecer: 'apto', parecerTexto: 'Parecer sintético do teste', certificado: null, por: LOGIN_A },
        (recusadas.push(trilha(LOGIN_A, 'concluir-pendente')), recusadas.at(-1)!),
      ),
    ).toBe(false);
    expect(await av(r3, { resultado: 'nao-conforme', severidade: 'bloqueante', origem: 'defeito' })).toBe(true);
    expect(await av(r3, { resultado: 'conforme' })).toBe(false);
    const corr = { idCiclo: id, requisito: r3, por: LOGIN_A, descricao: 'Correção sintética' };
    expect(await porta.corrigir(EST_A, corr, trilha(LOGIN_A, 'corrigir'))).toBe(true);
    recusadas.push(trilha(LOGIN_A, 'verificar-a'));
    expect(await porta.verificar(EST_A, { idCiclo: id, requisito: r3, por: LOGIN_A }, recusadas.at(-1)!)).toBe(false);
    expect(await porta.verificar(EST_A, { idCiclo: id, requisito: r3, por: LOGIN_B }, trilha(LOGIN_B, 'verificar-b'))).toBe(
      true,
    );
    const item = (await porta.itens(EST_A, id)).find((i) => i.requisito === r3);
    expect(item).toMatchObject({ resultado: 'nao-conforme', correcao: 'verificada', corrigidoPor: LOGIN_A, verificadoPor: LOGIN_B });
    expect(
      await porta.concluir(
        EST_A,
        { id, parecer: 'apto', parecerTexto: 'Parecer sintético do teste', certificado: null, por: LOGIN_A },
        trilha(LOGIN_A, 'concluir'),
      ),
    ).toBe(true);
    const ciclo = await porta.ciclo(EST_A, id);
    expect(ciclo).toMatchObject({ situacao: 'concluido', parecer: 'apto', abertoPor: LOGIN_A, concluidoPor: LOGIN_A });
    expect((await porta.ciclos(EST_A)).map((c) => c.id)).toContain(id);
    expect(await porta.ciclos(EST_B)).toEqual([]);
    recusadas.push(trilha(LOGIN_A, 'cancelar'));
    expect(await porta.cancelar(EST_A, { id, motivo: 'tarde demais', por: LOGIN_A }, recusadas.at(-1)!)).toBe(false);
    // Contrato de efeito: as recusas não deixam linha na trilha; a versão do item subiu a cada gravação.
    expect(await trilhas(...recusadas)).toBe(0);
    expect(await trilhas(trilha(LOGIN_A, 'abrir'), trilha(LOGIN_B, 'verificar-b'))).toBe(2);
    const [v] = await ler<{ versao: unknown }>(
      'SELECT versao FROM ciclo_certificacao_item WHERE ciclo_certificacao_id = ? AND requisito = ?',
      [Number(id), r3],
    );
    expect(Number(v?.versao)).toBe(4);
    void usuB;
    void estB;
  });
});
