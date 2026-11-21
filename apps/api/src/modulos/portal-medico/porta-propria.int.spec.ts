// Integração da porta própria do portal do médico externo (M50) contra o MariaDB real, cliente f22_o4 (onda 4), massa
// SINTÉTICA criada no beforeAll e apagada no afterAll (nenhum dado de pessoa real):
//   - o profissional com as inscrições no conselho (nome, UF e número), a sugestão pelo número e pela UF, a busca pelo
//     nome e os donos dos códigos de prestador;
//   - contrato de efeito do vínculo: a conta ligada (profissional, pessoa do médico, quem autorizou e quando, versão
//     nova) e a trilha na mesma transação; as recusas (profissional sem inscrição, profissional em outra conta vigente,
//     conta sem vínculo); a idempotência pela chave do pedido (repetida devolve o mesmo, outro corpo é recusado);
//   - religar o profissional a outra conta depois de desligar ou encerrar a antiga (com a chave do profissional vigente
//     no banco; sem ela, a recusa explícita 409 modelo-pendente, nunca 'profissional-em-outra-conta');
//   - a mesma bateria do vínculo vigente sobre a memória e o banco (describe.each);
//   - o ato do hospital sobre a conta (bloqueio e desbloqueio) com a situação do modelo e o motivo na trilha;
//   - a leitura auditada (trilha de consulta) e as operações sem modelo (409 modelo-pendente, nada lido vazio).
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortalMedico, PortaPortalMedico, TrilhaPortalMedico } from './porta.js';
import { PortaPortalMedicoMemoria } from './porta-memoria.js';
import { PortaPortalMedicoPropria } from './porta-propria.js';

const CLIENTE = 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'L0402M';
const NOMES = [
  'L0402 MEDICO SINTETICO A',
  'L0402 MEDICO SINTETICO B',
  'L0402 MEDICO SINTETICO C',
  'L0402 MEDICO SINTETICO D',
  'L0402 MEDICO SINTETICO E',
];
const NUMERO = '931402';
let UF = '';
// Uma conta por profissional (a chave única do modelo): A, B e C para o vínculo e o ato; D e E para a bateria.
const LOGINS = NOMES.map((_, i) => `l0402.conta.${'abcde'[i]}@exemplo.invalid`);

interface Massa {
  readonly est: number;
  readonly prof: number[];
  readonly pfs: number[];
  readonly contas: number[];
  /** O banco já tem a chave única do profissional vigente (DDL pedido pelo 04-02). */
  readonly chaveVigente: boolean;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function limpar(e: Escritor): Promise<void> {
  const em = NOMES.map(() => '?').join(', ');
  await e.executar(
    `DELETE FROM conta_portal_profissional_externo WHERE login IN (${LOGINS.map(() => '?').join(', ')})`,
    LOGINS,
  );
  const ps = await e.consultar(
    `SELECT p.id, p.pessoa_fisica_id FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE pf.nome IN (${em})`,
    NOMES,
  );
  for (const p of ps) {
    await e.executar('DELETE FROM inscricao_conselho WHERE profissional_id = ?', [p['id']]);
    await e.executar('DELETE FROM profissional WHERE id = ?', [p['id']]);
    await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [p['pessoa_fisica_id']]);
  }
}

const trilha = (evento: string, operacao: string, id: number): TrilhaPortalMedico => ({
  usuario: 'l0402.interno',
  evento,
  recurso: 'portal.medicoExterno',
  operacao,
  tabelaAlvo: 'conta_portal_profissional_externo',
  idAlvo: String(id),
  chaveNaturalAlvo: null,
  resultado: 'sucesso',
  estacao: 'teste',
  correlacao: '',
  idPaciente: null,
});

describe.skipIf(SEM_BANCO)(`porta própria do portal do médico externo (MariaDB, cliente ${CLIENTE})`, () => {
  const nucleo = new NucleoProprio();
  let m: Massa;
  let porta: PortaPortalMedicoPropria;
  let k = 0;
  const c = (): ContextoPortalMedico => ({
    cliente: CLIENTE,
    estabelecimento: m.est,
    usuario: null,
    correlacao: `teste-l0402-${++k}`,
    rede: CLIENTE,
    hospital: EST,
  });
  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l0402' }, (l) => l.consultar(sql, p)) as Promise<
      T[]
    >;

  beforeAll(async () => {
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-04-02' }, async (e) => {
      const agora = new Date();
      await limpar(e);
      const est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, 'ESTAB SINTETICO MEDICO EXTERNO', 'ESTAB SINTETICO MEDICO EXTERNO', agora],
      );
      // A UF vem do catálogo oficial carregado no cliente (nunca uma UF inventada).
      const ufl = await e.uma<{ id: number; sigla: string }>(
        'SELECT id, sigla FROM unidade_federativa ORDER BY id LIMIT 1',
      );
      if (!ufl) throw new Error('O cliente de teste não tem o catálogo de UF carregado.');
      const uf = Number(ufl.id);
      UF = String(ufl.sigla);
      const conselho = await garantir(
        e,
        "SELECT id FROM conselho_classe WHERE sigla = 'CRM' ORDER BY id LIMIT 1",
        [],
        "INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES ('06', 'CRM', 'Conselho Regional de Medicina', ?)",
        [agora],
      );
      const pfs: number[] = [];
      const prof: number[] = [];
      for (const nome of NOMES) {
        const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
          nome,
          agora,
        ]);
        pfs.push(pf);
        prof.push(
          await e.inserir(
            "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'externo', ?)",
            [pf, agora],
          ),
        );
      }
      // A, B e D têm inscrição; C e E não têm.
      for (const [i, p] of [prof[0]!, prof[1]!, prof[3]!].entries())
        await e.inserir(
          `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
             numero_inscricao, principal, situacao, criado_em) VALUES (?, 1, ?, ?, ?, TRUE, 'ativa', ?)`,
          [p, conselho, uf, i === 0 ? NUMERO : `${NUMERO}${i}`, agora],
        );
      const contas: number[] = [];
      for (const [i, login] of LOGINS.entries())
        contas.push(
          await e.inserir(
            `INSERT INTO conta_portal_profissional_externo (profissional_id, pessoa_fisica_id, login, email, situacao, criado_em)
             VALUES (?, ?, ?, ?, 'ativa', ?)`,
            [prof[i]!, pfs[i]!, login, login, agora],
          ),
        );
      const vig = await e.uma(
        `SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = DATABASE()
            AND table_name = 'conta_portal_profissional_externo' AND column_name = 'profissional_vigente_id'`,
      );
      return { est, prof, pfs, contas, chaveVigente: vig !== null && vig !== undefined };
    });
    porta = new PortaPortalMedicoPropria(nucleo);
  });

  // A limpeza da massa fica no fim do arquivo: a bateria memória × banco usa as contas D e E.
  afterAll(async () => {
    await nucleo.encerrar();
  });

  it('o profissional com as inscrições, a sugestão pelo número e pela UF, a busca e os donos dos códigos', async () => {
    const [a, b, cc] = m.prof as [number, number, number];
    const p = await porta.profissional(c(), a);
    expect(p).toEqual({
      id: a,
      nome: NOMES[0],
      registros: [{ id: a, codigo: a, uf: UF, numero: NUMERO }],
      vinculoAssistencial: [a],
    });
    const ps = await porta.profissionais(c(), [a, b, cc]);
    expect(ps.get(cc)?.registros).toEqual([]);
    expect(await porta.sugestoes(c(), UF, Number(NUMERO))).toEqual([{ id: a, nome: NOMES[0] }]);
    const lote = await porta.sugestoesEmLote(c(), [
      { uf: UF, numero: Number(NUMERO) },
      { uf: UF, numero: 1 },
    ]);
    expect(lote.get(`${UF}:${NUMERO}`)).toEqual([{ id: a, nome: NOMES[0] }]);
    expect(lote.get(`${UF}:1`)).toEqual([]);
    const busca = await porta.buscarProfissionais(c(), 'L0402 MEDICO');
    expect(busca.map((x) => x.id).sort()).toEqual([a, b, m.prof[3]!].sort());
    expect([...(await porta.donosDosCodigos(c(), [a, 999_999_999])).entries()]).toEqual([[a, new Set([a])]]);
    expect(await porta.loginDoProfissional(c(), a)).toBeNull();
  });

  it('contrato de efeito do vínculo, a idempotência, as recusas e religar depois de desligar ou encerrar', async () => {
    const [contaA, contaB, contaC] = m.contas as [number, number, number];
    const [a, , cc] = m.prof as [number, number, number];
    const vincular = (ctx: ContextoPortalMedico, conta: number, prof: number) =>
      porta.gravar(
        ctx,
        (g) => g.vincular({ acesso: conta, profissional: prof, por: 'l0402' }),
        trilha('portal.medico.vinculado', 'portal.vincularMedicoExterno', conta),
      );
    const linhaDa = async (conta: number) =>
      (
        await ler<{ versao: number; profissional_id: number; pessoa_fisica_id: number; autorizada_em: Date | null }>(
          'SELECT versao, profissional_id, pessoa_fisica_id, autorizada_em FROM conta_portal_profissional_externo WHERE id = ?',
          [conta],
        )
      )[0]!;
    expect((await porta.vinculos(c(), [contaA])).get(contaA)?.profissional).toBeNull();
    const ctx = { ...c(), chaveIdempotencia: `t0402-${randomUUID()}` };
    await vincular(ctx, contaA, a);
    const l1 = await linhaDa(contaA);
    expect(Number(l1.versao)).toBe(2);
    expect(Number(l1.profissional_id)).toBe(a);
    expect(Number(l1.pessoa_fisica_id)).toBe(m.pfs[0]);
    expect(l1.autorizada_em).not.toBeNull();
    const tr = await ler<{ entidade: string }>(
      'SELECT entidade FROM trilha_auditoria WHERE correlacao = ? AND entidade_id = ?',
      [ctx.correlacao, contaA],
    );
    expect(tr.length).toBe(1);
    // Idempotência: a mesma chave e o mesmo corpo não gravam de novo; a mesma chave com outro corpo é recusada.
    await vincular(ctx, contaA, a);
    expect(Number((await linhaDa(contaA)).versao)).toBe(2);
    await expect(vincular(ctx, contaA, m.prof[1]!)).rejects.toMatchObject({
      problema: { codigo: 'idempotencia-divergente' },
    });
    // A entrada de negócio passa pelo esquema da operação.
    await expect(vincular(c(), contaA, -1)).rejects.toMatchObject({ problema: { codigo: 'entrada-invalida' } });
    expect((await porta.vinculos(c(), [contaA])).get(contaA)).toMatchObject({ acesso: contaA, profissional: a });
    await expect(vincular(c(), contaB, cc)).rejects.toMatchObject({
      problema: { codigo: 'profissional-sem-registro' },
    });
    await expect(vincular(c(), contaB, a)).rejects.toMatchObject({
      problema: { codigo: 'profissional-em-outra-conta' },
    });
    await porta.gravar(c(), (g) => g.desvincular({ acesso: contaA, por: 'l0402' }), null);
    expect((await porta.vinculos(c(), [contaA])).get(contaA)?.profissional).toBeNull();
    await expect(
      porta.gravar(c(), (g) => g.desvincular({ acesso: contaA, por: 'l0402' }), null),
    ).rejects.toMatchObject({ problema: { codigo: 'sem-vinculo' } });
    // Religar depois de desligar: a conta desligada não prende o profissional.
    if (!m.chaveVigente) {
      await expect(vincular(c(), contaC, a)).rejects.toMatchObject({
        problema: { status: 409, codigo: 'modelo-pendente' },
      });
      return;
    }
    await vincular(c(), contaC, a);
    const l2 = await linhaDa(contaC);
    expect(Number(l2.profissional_id)).toBe(a);
    expect(Number(l2.pessoa_fisica_id)).toBe(m.pfs[0]);
    // Religar depois de encerrar: a conta encerrada (fato histórico) também não prende.
    await porta.gravar(
      c(),
      (g) =>
        g.atoConta({
          acesso: contaC,
          ato: 'encerramento',
          motivo: 'Teste sintético',
          pedidosPendentes: 0,
          decisaoPedidos: null,
          amostraPedidos: [],
          por: 'l0402',
        }),
      null,
    );
    await vincular(c(), contaA, a);
    expect((await porta.vinculos(c(), [contaA])).get(contaA)?.profissional).toBe(a);
  });

  it('o ato do hospital sobre a conta: bloqueio e desbloqueio com o motivo na trilha', async () => {
    const conta = m.contas[1]!;
    const ctx = c();
    const r = await porta.gravar(
      ctx,
      (g) =>
        g.atoConta({
          acesso: conta,
          ato: 'bloqueio',
          motivo: 'Teste sintético',
          pedidosPendentes: 0,
          decisaoPedidos: null,
          amostraPedidos: [],
          por: 'l0402',
        }),
      trilha('portal.medico.contaBloqueada', 'portal.medicoExterno.bloqueio', conta),
    );
    expect(r).toMatchObject({ situacao: 'bloqueado', anterior: 'ativo' });
    const [l] = await ler<{ situacao: string }>(
      'SELECT situacao FROM conta_portal_profissional_externo WHERE id = ?',
      [conta],
    );
    expect(l!.situacao).toBe('bloqueada');
    const tr = await ler<{ motivo: string | null }>(
      'SELECT motivo FROM trilha_auditoria WHERE correlacao = ?',
      [ctx.correlacao],
    );
    expect(tr.some((x) => (x.motivo ?? '').startsWith('bloqueio: Teste sintético'))).toBe(true);
    await expect(
      porta.gravar(
        c(),
        (g) =>
          g.atoConta({
            acesso: conta,
            ato: 'bloqueio',
            motivo: 'De novo',
            pedidosPendentes: 0,
            decisaoPedidos: null,
            amostraPedidos: [],
            por: 'l0402',
          }),
        null,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'conta-nao-ativa' } });
    await porta.gravar(
      c(),
      (g) =>
        g.atoConta({
          acesso: conta,
          ato: 'desbloqueio',
          motivo: 'Fim do teste',
          pedidosPendentes: 0,
          decisaoPedidos: null,
          amostraPedidos: [],
          por: 'l0402',
        }),
      null,
    );
    const [l2] = await ler<{ situacao: string }>(
      'SELECT situacao FROM conta_portal_profissional_externo WHERE id = ?',
      [conta],
    );
    expect(l2!.situacao).toBe('ativa');
  });

  it('a leitura auditada vai à trilha; as operações sem modelo recusam com 409 modelo-pendente', async () => {
    const ctx = c();
    await porta.registrarLeitura(
      ctx,
      trilha('portal.medico.extratoLido', 'extrato do médico externo', m.contas[0]!),
    );
    const tr = await ler<{ acao: string }>('SELECT acao FROM trilha_auditoria WHERE correlacao = ?', [
      ctx.correlacao,
    ]);
    expect(tr.map((x) => x.acao)).toContain('consulta');
    const pend = { problema: { codigo: 'modelo-pendente' } };
    await expect(porta.atosConta()).rejects.toMatchObject(pend);
    await expect(porta.trocaEmailPendente()).rejects.toMatchObject(pend);
    await expect(porta.notificacoesCritico()).rejects.toMatchObject(pend);
    await expect(
      porta.gravar(
        c(),
        (g) => g.notificarCritico({ aviso: 1, acesso: m.contas[0]!, envio: 'simulador', motivo: null }),
        null,
      ),
    ).rejects.toMatchObject(pend);
    await expect(
      porta.gravar(c(), (g) => g.trocarSenha({ acesso: m.contas[0]!, senhaResumo: 'x', por: 'l0402' }), null),
    ).rejects.toMatchObject(pend);
  });
});

// A mesma bateria do vínculo vigente sobre a memória e o banco: o sentido dos campos é o mesmo nas duas portas.
interface Cenario {
  readonly porta: PortaPortalMedico;
  readonly c: () => ContextoPortalMedico;
  readonly contas: readonly [number, number];
  readonly prof: number;
  /** O banco sem a chave do profissional vigente recusa religar com 409 modelo-pendente (pedido de DDL). */
  readonly religa: boolean;
  readonly fim: () => Promise<void>;
}

const MEMORIA = async (): Promise<Cenario> => {
  const porta = new PortaPortalMedicoMemoria(async () => 'ativo');
  const c = (): ContextoPortalMedico => ({
    cliente: 'memoria',
    estabelecimento: 1,
    usuario: null,
    correlacao: 'teste-l0402-memoria',
    rede: 'memoria',
    hospital: 'H1',
  });
  return { porta, c, contas: [91, 92], prof: 6801, religa: true, fim: async () => undefined };
};

const BANCO = async (): Promise<Cenario> => {
  const nucleo = new NucleoProprio();
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l0402-bateria' }, (l) => l.consultar(sql, p));
  const [d, e] = await Promise.all(
    [3, 4].map(async (i) => {
      const [r] = await ler(
        'SELECT cp.id, cp.profissional_id FROM conta_portal_profissional_externo cp WHERE cp.login = ?',
        [LOGINS[i]],
      );
      return { conta: Number(r!['id']), prof: Number(r!['profissional_id']) };
    }),
  );
  const [est] = await ler('SELECT id FROM estabelecimento WHERE codigo = ?', [EST]);
  const vig = await ler(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE()
        AND table_name = 'conta_portal_profissional_externo' AND column_name = 'profissional_vigente_id'`,
    [],
  );
  let k = 0;
  return {
    porta: new PortaPortalMedicoPropria(nucleo),
    c: () => ({
      cliente: CLIENTE,
      estabelecimento: Number(est!['id']),
      usuario: null,
      correlacao: `teste-l0402-bateria-${++k}`,
      rede: CLIENTE,
      hospital: EST,
    }),
    contas: [d!.conta, e!.conta],
    prof: d!.prof,
    religa: vig.length > 0,
    fim: () => nucleo.encerrar(),
  };
};

describe.skipIf(SEM_BANCO).each([
  ['memória', MEMORIA],
  ['banco', BANCO],
] as const)('vínculo vigente (%s)', (_nome, fabrica) => {
  let cn: Cenario;
  // A massa do banco é a do describe principal (contas D e E): a bateria roda depois dele no mesmo arquivo.
  beforeAll(async () => {
    cn = await fabrica();
  });
  afterAll(async () => {
    await cn.fim();
  });

  it('o profissional: registros com o número da inscrição e o vínculo assistencial', async () => {
    const p = (await cn.porta.profissional(cn.c(), cn.prof))!;
    expect(p.registros.length).toBeGreaterThan(0);
    for (const r of p.registros) expect(typeof r.numero).toBe('string');
    expect(p.vinculoAssistencial.length).toBeGreaterThan(0);
  });

  it('só a conta vigente prende o profissional; desligada, ele vai a outra conta', async () => {
    const [x, y] = cn.contas;
    const ligar = (conta: number) =>
      cn.porta.gravar(cn.c(), (g) => g.vincular({ acesso: conta, profissional: cn.prof, por: 'l0402' }), null);
    await ligar(x);
    await expect(ligar(y)).rejects.toMatchObject({ problema: { codigo: 'profissional-em-outra-conta' } });
    await cn.porta.gravar(cn.c(), (g) => g.desvincular({ acesso: x, por: 'l0402' }), null);
    if (cn.religa) {
      await ligar(y);
      expect((await cn.porta.vinculos(cn.c(), [y])).get(y)?.profissional).toBe(cn.prof);
    } else
      await expect(ligar(y)).rejects.toMatchObject({ problema: { status: 409, codigo: 'modelo-pendente' } });
  });
});

afterAll(async () => {
  if (SEM_BANCO) return;
  const nucleo = new NucleoProprio();
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-04-02' }, (e) => limpar(e));
  await nucleo.encerrar();
});
