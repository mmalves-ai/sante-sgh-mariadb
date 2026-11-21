// Integração da porta própria da gestão de pessoas contra o MariaDB real (cliente f22_o3, criado por
// `python3 -I tools/db/criar_cliente.py f22_o3 "Teste F2.2 onda 3"`). Massa SINTÉTICA (CPF de dígito calculado sobre
// base aleatória, contas e catálogos de teste), montada no beforeAll e apagada no afterAll. SGH_NUCLEO_SEM_BANCO=1 pula.
// Contrato de efeito: o desligamento (vínculo, versão, histórico e trilha), o bloqueio da conta pelo Executor (situação
// e linha do tempo), a correção na trilha relida, e as recusas (versão, outro estabelecimento, modelo pendente).
// A mudança com vigência (cargo no historico_cargo, lotação e correção na trilha, piso da vigência) e a conta mantida
// enquanto a pessoa segue ativa em outro estabelecimento da rede.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { type ContextoNucleo, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CifraCpf } from './cifra-cpf.js';
import type { GravadorPessoas } from './porta.js';
import { PortaPessoasPropria } from './porta-propria.js';

const CLIENTE = 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const SUFIXO = randomUUID().replace(/-/g, '').slice(0, 8);

/** Garante o cliente de teste da onda (o comando recusa cliente já existente: consulta antes). */
function garantirCliente(): void {
  const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], {
    cwd: RAIZ,
    encoding: 'utf8',
  });
  if (!lista.split('\n').some((l) => l.split(/\s+/).includes(CLIENTE)))
    execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 3'], { cwd: RAIZ });
}

/** CPF sintético com dígitos válidos a partir de 9 dígitos aleatórios (não é de pessoa real). */
function cpfSintetico(): string {
  const b = Array.from(randomBytes(9), (x) => String(x % 10)).join('');
  const dv = (s: string, p: number) => {
    let t = 0;
    for (let i = 0; i < s.length; i++) t += Number(s[i]) * (p - i);
    const r = t % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(b, 10);
  return `${b}${d1}${dv(`${b}${d1}`, 11)}`;
}

/** Linha de catálogo por código (cria se faltar; o cliente de teste começa vazio). */
async function garantir(
  e: Escritor,
  tabela: string,
  chave: Record<string, unknown>,
  resto: Record<string, unknown>,
) {
  const ks = Object.keys(chave);
  const l = await e.uma<{ id: number }>(
    `SELECT id FROM ${tabela} WHERE ${ks.map((k) => `${k} = ?`).join(' AND ')}`,
    Object.values(chave),
  );
  if (l) return Number(l.id);
  const v = { ...chave, ...resto, criado_em: new Date() };
  return e.inserir(
    `INSERT INTO ${tabela} (${Object.keys(v).join(', ')}) VALUES (${Object.keys(v)
      .map(() => '?')
      .join(', ')})`,
    Object.values(v),
  );
}

interface Massa {
  est: number;
  est2: number;
  rh: number;
  chefe: number;
  colab: number;
  cpf: string;
  vinculo: number;
  vinculo2: number;
  cargo: number;
  centro: number;
  rescisao: number;
  justificativa: number;
  periodo: number;
  criados: [string, number][];
}

async function montarMassa(nucleo: NucleoProprio): Promise<Massa> {
  return nucleo.escrever({ cliente: CLIENTE, correlacao: `massa-03-09-${SUFIXO}` }, async (e) => {
    const agora = new Date();
    const criados: [string, number][] = [];
    const novo = async (tabela: string, v: Record<string, unknown>) => {
      const x = { ...v, criado_em: agora };
      const id = await e.inserir(
        `INSERT INTO ${tabela} (${Object.keys(x).join(', ')}) VALUES (${Object.keys(x)
          .map(() => '?')
          .join(', ')})`,
        Object.values(x),
      );
      criados.push([tabela, id]);
      return id;
    };
    const est = await garantir(
      e,
      'estabelecimento',
      { codigo: 'f22o309a' },
      {
        nome_fantasia: 'Hospital de teste 03-09 A',
        razao_social: 'Hospital de teste 03-09 A (fictício)',
        fuso_horario: 'America/Sao_Paulo',
      },
    );
    const est2 = await garantir(
      e,
      'estabelecimento',
      { codigo: 'f22o309b' },
      { nome_fantasia: 'Hospital de teste 03-09 B', razao_social: 'Hospital de teste 03-09 B (fictício)' },
    );
    const conta = (login: string) =>
      novo('usuario', { login, nome: `Conta de teste ${login}`, dispensa_cpf: true });
    const rh = await conta(`t0309rh${SUFIXO}`);
    const chefe = await conta(`t0309ch${SUFIXO}`);
    const contaColab = await conta(`t0309co${SUFIXO}`);
    const cbo = await garantir(
      e,
      'ocupacao_cbo',
      { codigo_cbo: '322205' },
      { descricao: 'Técnico de enfermagem (teste)' },
    );
    const cargo = await garantir(
      e,
      'cargo',
      { codigo: 'T0309-TEC' },
      { nome: 'Técnico de enfermagem (teste)', ocupacao_cbo_id: cbo, data_inicio: '2020-01-01' },
    );
    const sexo = await garantir(e, 'sexo', { codigo: 'T' }, { descricao: 'Teste', sigla: 'T' });
    const tipoVinculo = await garantir(
      e,
      'tipo_vinculo_trabalho',
      { codigo_cnes: '010101' },
      { nivel: 'vinculo', codigo_vinculo: '01', descricao: 'Empregatício (teste)' },
    );
    const categoria = await garantir(
      e,
      'categoria_trabalhador',
      { codigo_esocial: '101' },
      { descricao: 'Empregado geral (teste)', grupo: 'empregado' },
    );
    const centro = await novo('centro_custo', {
      estabelecimento_id: est,
      codigo: `CC${SUFIXO}`,
      nome: 'Enfermagem (teste)',
      vigencia_inicio: '2020-01-01',
    });
    const rescisao = await garantir(
      e,
      'tipo_rescisao',
      { codigo: 'T0309-SJC' },
      { descricao: 'Sem justa causa (teste)', iniciativa: 'empregador' },
    );
    const justificativa = await garantir(
      e,
      'justificativa_ponto',
      { codigo: 'T0309-ESQ' },
      { descricao: 'Esquecimento (teste)' },
    );
    const periodo = await garantir(
      e,
      'classificacao_marcacao',
      { codigo: 'T0309-E1' },
      { descricao: '1ª entrada (teste)', sentido: 'entrada' },
    );
    const cpf = cpfSintetico();
    const colab = await novo('colaborador', {
      nome: `COLABORADORA SINTETICA ${SUFIXO}`,
      cpf,
      data_nascimento: '1990-05-10',
      sexo_id: sexo,
      grau_instrucao: '07',
      usuario_id: contaColab,
    });
    const vinculoDe = (estab: number, matricula: string) =>
      novo('vinculo_trabalho', {
        estabelecimento_id: estab,
        colaborador_id: colab,
        matricula,
        tipo_vinculo_trabalho_id: tipoVinculo,
        categoria_trabalhador_id: categoria,
        cargo_id: cargo,
        centro_custo_id: estab === est ? centro : null,
        data_admissao: '2026-01-05',
        salario_base: 3500,
      });
    const vinculo = await vinculoDe(est, `M${SUFIXO}`);
    const vinculo2 = await vinculoDe(est2, `N${SUFIXO}`);
    return {
      est,
      est2,
      rh,
      chefe,
      colab,
      cpf,
      vinculo,
      vinculo2,
      cargo,
      centro,
      rescisao,
      justificativa,
      periodo,
      criados,
    };
  });
}

/** Apaga a massa na ordem das chaves (a trilha e a saída de integração ficam: só inclusão, no cliente de teste). */
async function limparMassa(
  nucleo: NucleoProprio,
  m: Massa | undefined,
  antes: (e: Escritor) => Promise<void>,
): Promise<void> {
  if (!m) return;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpa-03-09-${SUFIXO}` }, async (e) => {
    await antes(e);
    await e.executar('DELETE FROM historico_cargo WHERE vinculo_trabalho_id IN (?, ?)', [
      m.vinculo,
      m.vinculo2,
    ]);
    // As contas sintéticas ficam (a trilha de auditoria as referencia; só inclusão).
    for (const [t, id] of [...m.criados].reverse())
      if (t !== 'usuario') await e.executar(`DELETE FROM ${t} WHERE id = ?`, [id]);
  });
}

const ctx = (m: Massa, usuario: number, est = m.est): ContextoNucleo => ({
  cliente: CLIENTE,
  estabelecimento: est,
  usuario,
  correlacao: `int-03-09-${SUFIXO}`,
});
/** Linha da trilha de uma gravação direta da porta. */
const trilhaDe = (m: Massa, usuario: number, entidade: string) => ({
  estabelecimento: m.est,
  usuario,
  acao: 'alteracao' as const,
  entidade,
  entidadeId: null,
  correlacao: `int-03-09-${SUFIXO}`,
});

async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).not.toBeNull();
  return (e as { problema?: { codigo?: unknown } }).problema?.codigo;
}

describe.skipIf(SEM_BANCO)('porta própria da gestão de pessoas (MariaDB, cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaPessoasPropria;
  let m: Massa;
  const cifra = new CifraCpf(randomBytes(32));

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaPessoasPropria(nucleo, cifra);
  }, 120_000);
  afterAll(async () => {
    await limparMassa(nucleo, m, async () => undefined);
    await nucleo?.encerrar();
  });

  it('lê o vínculo do estabelecimento da sessão, pelo CPF (HMAC) e na lista; outro estabelecimento não', async () => {
    const v = await porta.vinculo(ctx(m, m.rh), m.vinculo);
    expect(v).toMatchObject({
      id: m.vinculo,
      estabelecimento: m.est,
      pessoa: m.colab,
      idCargo: m.cargo,
      centroCusto: m.centro,
      desligamento: null,
      tipo: 'clt',
    });
    expect(cifra.decifrar(v!.cpfCifrado)).toBe(m.cpf);
    expect(await porta.vinculo(ctx(m, m.rh), m.vinculo2)).toBeNull();
    expect((await porta.vinculosPorCpf(ctx(m, m.rh), cifra.hmac(m.cpf))).map((x) => x.id)).toEqual([
      m.vinculo,
    ]);
    const lista = await porta.listarVinculos(ctx(m, m.rh), { estado: 'ativo', termo: SUFIXO, limite: 10 });
    expect(lista.itens.map((x) => x.id)).toEqual([m.vinculo]);
    // Os vínculos da pessoa são lidos na rede (o desligamento decide o bloqueio da conta da rede).
    expect(
      (await porta.vinculosDaPessoa(ctx(m, m.rh), m.colab)).map((x) => [x.id, x.estabelecimento]),
    ).toEqual([
      [m.vinculo, m.est],
      [m.vinculo2, m.est2],
    ]);
    expect((await porta.centrosDeCusto(ctx(m, m.rh))).map((c) => c.codigo)).toContain(m.centro);
    expect((await porta.tiposRescisao(ctx(m, m.rh))).map((c) => c.codigo)).toContain(m.rescisao);
    expect(await porta.cargoQuadro(ctx(m, m.rh), m.cargo)).toMatchObject({
      id: m.cargo,
      cbo: '322205',
      ativo: true,
    });
    expect(await porta.hoje(ctx(m, m.rh))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('correção: vai à trilha com o valor anterior e o novo e volta na leitura', async () => {
    await porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'vinculo_trabalho'), (g) =>
      g.registrarCorrecao({
        vinculo: m.vinculo,
        operacao: 'colaborador.corrigido',
        antes: { matricula: 'A' },
        depois: { matricula: 'B' },
        motivo: 'Teste da correção',
        por: 'rh',
      }),
    );
    const [c] = await porta.correcoes(ctx(m, m.rh), m.vinculo);
    expect(c).toMatchObject({
      tabela: 'vinculo_trabalho',
      registro: m.vinculo,
      operacao: 'colaborador.corrigido',
      antes: { matricula: 'A' },
      depois: { matricula: 'B' },
      motivo: 'Teste da correção',
    });
  });

  it('mudança com vigência: cargo no historico_cargo fechando a linha anterior; lotação e correção na trilha; piso sem correção', async () => {
    const cargo2 = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: `massa-03-09-${SUFIXO}` },
      async (e) => {
        const cbo = await garantir(
          e,
          'ocupacao_cbo',
          { codigo_cbo: '223505' },
          { descricao: 'Enfermeiro (teste)' },
        );
        await e.inserir(
          "INSERT INTO historico_cargo (vinculo_trabalho_id, cargo_id, data_inicio, motivo, operacao, ocorrido_em, criado_em, versao) VALUES (?, ?, '2026-01-05', 'admissao', 'inclusao', NOW(3), NOW(3), 1)",
          [m.vinculo, m.cargo],
        );
        return garantir(
          e,
          'cargo',
          { codigo: 'T0309-ENF' },
          { nome: 'Enfermeiro (teste 03-09)', ocupacao_cbo_id: cbo, data_inicio: '2020-01-01' },
        );
      },
    );
    const v = (await porta.vinculo(ctx(m, m.rh), m.vinculo))!;
    const base = {
      id: m.vinculo,
      versao: v.versao,
      cargo: v.cargo,
      funcao: v.funcao,
      cargaSemanal: v.cargaSemanal,
      centroCusto: m.centro,
      unidade: null,
      setor: null,
      por: 'rh',
    };
    const gravar = <T>(fn: (g: GravadorPessoas) => Promise<T>) =>
      porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'vinculo_trabalho'), fn);
    expect(await codigo(gravar((g) => g.alterarVinculo({ ...base, cargaSemanal: 13 })))).toBe(
      'regime-de-jornada-indefinido',
    );
    expect(await codigo(gravar((g) => g.alterarVinculo({ ...base, cargo: 'Cargo que não existe' })))).toBe(
      'cargo-inexistente',
    );
    const ev = (tipo: string, vigencia: string, motivo: string) => ({
      vinculo: m.vinculo,
      tipo,
      vigencia,
      antes: 'antes',
      depois: 'depois',
      motivo,
      por: 'rh',
    });
    await gravar(async (g) => {
      await g.alterarVinculo({ ...base, cargo: 'Enfermeiro (teste 03-09)' });
      await g.incluirHistorico(ev('cargo', '2026-09-01', 'Promoção de teste'));
      await g.incluirHistorico(ev('lotacao', '2026-09-15', 'Troca de setor de teste'));
      await g.incluirHistorico(ev('correcao', '2026-10-20', 'Correção de nome de teste'));
    });
    expect((await porta.vinculo(ctx(m, m.rh), m.vinculo))?.idCargo).toBe(cargo2);
    const linhas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'confere' }, (l) =>
      l.consultar<{ cargo_id: number; data_inicio: Date; data_fim: Date | null; motivo: string }>(
        "SELECT cargo_id, DATE_FORMAT(data_inicio, '%Y-%m-%d') AS data_inicio, DATE_FORMAT(data_fim, '%Y-%m-%d') AS data_fim, motivo FROM historico_cargo WHERE vinculo_trabalho_id = ? ORDER BY data_inicio",
        [m.vinculo],
      ),
    );
    expect(linhas.map((l) => [Number(l.cargo_id), l.data_inicio, l.data_fim, l.motivo])).toEqual([
      [m.cargo, '2026-01-05', '2026-08-31', 'admissao'],
      [cargo2, '2026-09-01', null, 'outro'],
    ]);
    expect(await gravar((g) => g.ultimaVigencia(m.vinculo))).toBe('2026-09-15');
    const h = await porta.historico(ctx(m, m.rh), m.vinculo);
    expect(h.map((x) => [x.tipo, x.vigencia])).toEqual([
      ['correcao', '2026-10-20'],
      ['lotacao', '2026-09-15'],
      ['cargo', '2026-09-01'],
      ['admissao', '2026-01-05'],
    ]);
  });

  it('desligamento: versão, situação, histórico e trilha; versão velha recusa; admissão rápida e dependente novo ficam pendentes', async () => {
    const v = (await porta.vinculo(ctx(m, m.rh), m.vinculo))!;
    expect(
      await codigo(
        porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'vinculo_trabalho'), (g) =>
          g.desligarVinculo({
            id: m.vinculo,
            versao: v.versao + 7,
            data: '2026-10-31',
            tipoRescisao: m.rescisao,
            motivo: 'Teste',
            por: 'rh',
          }),
        ),
      ),
    ).toBe('desatualizado');
    await porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'vinculo_trabalho'), (g) =>
      g.desligarVinculo({
        id: m.vinculo,
        versao: v.versao,
        data: '2026-10-31',
        tipoRescisao: m.rescisao,
        motivo: 'Pedido de teste',
        por: 'rh',
      }),
    );
    const d = (await porta.vinculo(ctx(m, m.rh), m.vinculo))!;
    expect(d).toMatchObject({
      versao: v.versao + 1,
      desligamento: '2026-10-31',
      tipoRescisao: m.rescisao,
      motivoDesligamento: 'Pedido de teste',
    });
    const h = await porta.historico(ctx(m, m.rh), m.vinculo);
    expect(h[0]).toMatchObject({
      tipo: 'desligamento',
      vigencia: '2026-10-31',
      antes: 'ativo',
      depois: 'desligado',
    });
    const t = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'confere' }, (l) =>
      l.uma<{ k: number }>(
        "SELECT COUNT(*) AS k FROM trilha_auditoria WHERE entidade = 'vinculo_trabalho' AND estabelecimento_id = ? AND correlacao = ?",
        [m.est, `int-03-09-${SUFIXO}`],
      ),
    );
    expect(Number(t?.k)).toBeGreaterThanOrEqual(2);
    expect(
      await codigo(
        porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'vinculo_trabalho'), (g) =>
          g.incluirVinculo({
            pessoa: null,
            cpfHmac: 'x',
            cpfCifrado: 'x',
            nome: 'X',
            profissional: null,
            usuario: null,
            tipo: 'clt',
            matricula: 'X1',
            cargo: 'X',
            funcao: null,
            cargaSemanal: 44,
            centroCusto: m.centro,
            unidade: null,
            setor: null,
            admissao: '2026-01-01',
            por: 'rh',
          }),
        ),
      ),
    ).toBe('modelo-pendente');
    expect(await porta.ultimoRetrato(ctx(m, m.rh))).toMatchObject({ janelaDias: 30 });
  });

  it('bloqueio da conta pelo Executor: situação e linha do tempo; a si mesmo recusa', async () => {
    const login = `t0309co${SUFIXO}`;
    const opCtx = (u: number) => ({ ...ctx(m, u), chaveIdempotencia: randomUUID() });
    expect(
      await codigo(
        porta.executar(ctx(m, m.rh), 'acesso.bloquearUsuario', { login: `t0309rh${SUFIXO}` }, opCtx(m.rh)),
      ),
    ).toBe('a-si-mesmo');
    // Desligada no A, segue ativa no B: a conta da rede fica.
    expect(await codigo(porta.executar(ctx(m, m.rh), 'acesso.bloquearUsuario', { login }, opCtx(m.rh)))).toBe(
      'vinculo-ativo-em-outro-estabelecimento',
    );
    const v2 = (await porta.vinculo(ctx(m, m.rh, m.est2), m.vinculo2))!;
    await porta.gravarSgh(ctx(m, m.rh, m.est2), trilhaDe(m, m.rh, 'vinculo_trabalho'), (g) =>
      g.desligarVinculo({
        id: m.vinculo2,
        versao: v2.versao,
        data: '2026-10-31',
        tipoRescisao: m.rescisao,
        motivo: 'Teste no B',
        por: 'rh',
      }),
    );
    const r = await porta.executar(ctx(m, m.rh), 'acesso.bloquearUsuario', { login }, opCtx(m.rh));
    expect(r.repetida).toBe(false);
    const linhas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'confere' }, async (l) => ({
      u: await l.uma<{ situacao: string }>('SELECT situacao FROM usuario WHERE login = ?', [login]),
      h: await l.uma<{ k: number }>(
        "SELECT COUNT(*) AS k FROM usuario_situacao_historico s JOIN usuario u ON u.id = s.usuario_id WHERE u.login = ? AND s.evento = 'bloqueio'",
        [login],
      ),
    }));
    expect(linhas.u?.situacao).toBe('bloqueado');
    expect(Number(linhas.h?.k)).toBe(1);
    expect(await codigo(porta.executar(ctx(m, m.rh), 'acesso.bloquearUsuario', { login }, opCtx(m.rh)))).toBe(
      'ja-bloqueado',
    );
  });
});
