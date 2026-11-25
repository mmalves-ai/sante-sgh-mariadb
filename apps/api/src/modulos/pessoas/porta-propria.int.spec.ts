// Integração da porta própria da gestão de pessoas contra o MariaDB real (cliente f22_o3, criado por
// `python3 -I tools/db/criar_cliente.py f22_o3 "Teste F2.2 onda 3"`). Massa SINTÉTICA (CPF de dígito calculado sobre
// base aleatória, contas e catálogos de teste), montada no beforeAll e apagada no afterAll. SGH_NUCLEO_SEM_BANCO=1 pula.
// Contrato de efeito (C1-111): a admissão pela ficha rápida (colaborador, vínculo, histórico, reuso do CPF da rede)
// e a versão nova do dependente (a anterior fechada na véspera, tipo da tabela 07, mesmo CPF).
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

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
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
  /** Tabela 07 do eSocial SINTÉTICA desta execução (versão da fonte própria), apagada no fim. */
  const tabela07: number[] = [];
  /** C1-111: o que a admissão pela ficha rápida gravou nesta execução (apagado no fim). */
  const admitidos: { vinculos: number[]; pessoas: number[]; cargo: number } = {
    vinculos: [],
    pessoas: [],
    cargo: 0,
  };
  afterAll(async () => {
    await limparMassa(nucleo, m, async (e) => {
      // A versão nova aponta a anterior (chave estrangeira): apaga da mais nova para a mais antiga.
      if (m) await e.executar('DELETE FROM dependente WHERE colaborador_id = ? ORDER BY id DESC', [m.colab]);
      for (const v of admitidos.vinculos) {
        await e.executar('DELETE FROM historico_cargo WHERE vinculo_trabalho_id = ?', [v]);
        await e.executar('DELETE FROM vinculo_trabalho WHERE id = ?', [v]);
      }
      for (const p of admitidos.pessoas) await e.executar('DELETE FROM colaborador WHERE id = ?', [p]);
      if (admitidos.cargo) await e.executar('DELETE FROM cargo WHERE id = ?', [admitidos.cargo]);
      for (const t of tabela07) {
        await e.executar('DELETE FROM codigo_esocial WHERE tabela_esocial_id = ?', [t]);
        await e.executar('DELETE FROM tabela_esocial WHERE id = ?', [t]);
      }
    });
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

  it('dependente novo: tipo do eSocial pelo parentesco, sequência, CPF como o do titular; sem catálogo e CPF repetido recusam', async () => {
    const dep = (cpf: string | null, extra: Record<string, unknown> = {}) => ({
      vinculo: m.vinculo,
      nome: `DEPENDENTE SINTETICO ${SUFIXO}`,
      nascimento: '2020-05-10',
      parentesco: '03',
      cpfHmac: cpf ? cifra.hmac(cpf) : null,
      cpfCifrado: cpf ? cifra.cifrar(cpf) : null,
      dependenteIr: cpf !== null,
      dependenteSalarioFamilia: false,
      por: 'rh',
      ...extra,
    });
    const incluir = (d: ReturnType<typeof dep>) =>
      porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'dependente'), (g) =>
        g.incluirDependente(d as Parameters<GravadorPessoas['incluirDependente']>[0]),
      );
    // Sem a tabela 07 no catálogo (o cliente de teste começa vazio), recusa: nunca grava tipo inventado.
    const [antes] = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conf-dep' }, (l) =>
      l.consultar(
        `SELECT COUNT(*) AS k FROM codigo_esocial c JOIN tabela_esocial t ON t.id = c.tabela_esocial_id
          WHERE t.fonte = 'esocial' AND t.codigo_oficial IN ('07', '7') AND c.codigo_esocial IN ('03', '3', '99')`,
      ),
    );
    if (Number(antes?.['k']) === 0)
      expect(await codigo(incluir(dep(null, { dependenteIr: false })))).toBe('catalogo-pendente');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `massa-dep-${SUFIXO}` }, async (e) => {
      const t = await e.inserir(
        "INSERT INTO tabela_esocial (fonte, codigo_oficial, descricao, versao_fonte, criado_em) VALUES ('esocial', '07', 'TIPOS DE DEPENDENTE SINTETICA', ?, NOW(3))",
        [`t-${SUFIXO}`],
      );
      tabela07.push(t);
      for (const [cod, desc] of [
        ['03', 'FILHO SINTETICO'],
        ['99', 'AGREGADO SINTETICO'],
      ])
        await e.inserir(
          'INSERT INTO codigo_esocial (tabela_esocial_id, codigo_esocial, descricao, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, NOW(3))',
          [t, cod, desc, '2099-01-01'],
        );
    });
    // Vigência futura: ainda não vale hoje (o catálogo é por vigência).
    expect(await codigo(incluir(dep(null, { dependenteIr: false })))).toBe('catalogo-pendente');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `massa-dep-${SUFIXO}` }, (e) =>
      e.executar('UPDATE codigo_esocial SET vigencia_inicio = NULL WHERE tabela_esocial_id = ?', [
        tabela07[0],
      ]),
    );
    const cpf = cpfSintetico();
    const id1 = await incluir(dep(cpf));
    const id2 = await incluir(dep(null, { dependenteIr: false, parentesco: '99', nascimento: '2001-02-03' }));
    const linhas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conf-dep' }, (l) =>
      l.consultar(
        `SELECT dp.id, dp.sequencia, dp.cpf IS NOT NULL AS tem_cpf, dp.dependente_irrf, dp.descricao_dependencia,
                dp.data_inicio_dependencia >= dp.data_nascimento AS inicio_ok, dp.origem, dp.criado_por, ce.codigo_esocial
           FROM dependente dp JOIN codigo_esocial ce ON ce.id = dp.tipo_dependente_codigo_esocial_id
          WHERE dp.colaborador_id = ? ORDER BY dp.sequencia`,
        [m.colab],
      ),
    );
    expect(linhas.map((x) => [Number(x['id']), Number(x['sequencia']), String(x['codigo_esocial'])])).toEqual(
      [
        [Number(id1), 1, '03'],
        [Number(id2), 2, '99'],
      ],
    );
    expect(
      linhas.map((x) => [Number(x['tem_cpf']), Number(x['dependente_irrf']), Number(x['inicio_ok'])]),
    ).toEqual([
      [1, 1, 1],
      [0, 0, 1],
    ]);
    expect(linhas[0]!['descricao_dependencia']).toBeNull();
    expect(linhas[1]!['descricao_dependencia']).toBe('Agregado/Outros');
    expect(linhas.every((x) => x['origem'] === 'sistema' && Number(x['criado_por']) === m.rh)).toBe(true);
    // A leitura devolve o parentesco (código do eSocial) e o CPF como o do titular (HMAC e cifra, nunca em claro).
    const lidos = await porta.dependentes(ctx(m, m.rh), m.vinculo);
    expect(lidos.map((x) => x.parentesco)).toEqual(['03', '99']);
    expect(lidos[0]!.cpfHmac).toBe(cifra.hmac(cpf));
    expect(cifra.decifrar(lidos[0]!.cpfCifrado)).toBe(cpf);
    expect(lidos[1]!.cpfHmac).toBeNull();
    // O mesmo CPF duas vezes no colaborador recusa com o campo.
    expect(await codigo(incluir(dep(cpf)))).toBe('cpf-repetido');
    // Vínculo de outro estabelecimento: a releitura não acha (nada gravado).
    expect(await codigo(incluir(dep(null, { dependenteIr: false, vinculo: m.vinculo2 })))).toBe(
      'desatualizado',
    );
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

  it('desligamento: versão, situação, histórico e trilha; versão velha recusa; a porta não deixa mais nada pendente de modelo', async () => {
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

  it('C1-111 dependente alterado: a versão em vigor fecha na véspera e a nova nasce ligada, com o tipo da tabela 07 e o mesmo CPF', async () => {
    const [v1] = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conf-dep-v' }, (l) =>
      l.consultar('SELECT id, cpf FROM dependente WHERE colaborador_id = ? AND sequencia = 1', [m.colab]),
    );
    const anterior = Number(v1!['id']);
    const cpf = String(v1!['cpf']);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `massa-dep-v-${SUFIXO}` }, (e) =>
      e.executar("UPDATE dependente SET data_inicio_dependencia = '2025-01-01' WHERE id = ?", [anterior]),
    );
    const versao = (desde: string, extra: Record<string, unknown> = {}) =>
      porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'dependente'), (g) =>
        g.versionarDependente({
          vinculo: m.vinculo,
          anterior,
          desde,
          motivo: 'Correção do tipo de dependente pela certidão',
          nome: `DEPENDENTE SINTETICO ALTERADO ${SUFIXO}`,
          nascimento: '2020-05-10',
          parentesco: '99',
          cpfHmac: cifra.hmac(cpf),
          cpfCifrado: cifra.cifrar(cpf),
          dependenteIr: true,
          dependenteSalarioFamilia: false,
          por: 'rh',
          ...extra,
        } as Parameters<GravadorPessoas['versionarDependente']>[0]),
      );
    // A alteração não vale antes da versão em vigor; vínculo de outro estabelecimento não acha.
    expect(await codigo(versao('2025-01-01'))).toBe('desde-antes-da-versao');
    expect(await codigo(versao('2026-03-01', { vinculo: m.vinculo2 }))).toBe('desatualizado');
    const nova = Number(await versao('2026-03-01'));
    const linhas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conf-dep-v' }, (l) =>
      l.consultar(
        `SELECT dp.id, dp.dependente_anterior_id, dp.data_inicio_dependencia, dp.data_fim_dependencia, dp.cpf = ? AS cpf_ok,
                dp.descricao_dependencia, dp.versao, dp.alterado_por, dp.criado_por, ce.codigo_esocial
           FROM dependente dp JOIN codigo_esocial ce ON ce.id = dp.tipo_dependente_codigo_esocial_id
          WHERE dp.id IN (?, ?) ORDER BY dp.id`,
        [cpf, anterior, nova],
      ),
    );
    const iso = (x: unknown) => (x instanceof Date ? x.toISOString().slice(0, 10) : x);
    expect(
      linhas.map((x) => [
        Number(x['id']),
        x['dependente_anterior_id'] === null ? null : Number(x['dependente_anterior_id']),
        iso(x['data_inicio_dependencia']),
        iso(x['data_fim_dependencia']),
        Number(x['cpf_ok']),
        String(x['codigo_esocial']),
        Number(x['versao']),
      ]),
    ).toEqual([
      [anterior, null, '2025-01-01', '2026-02-28', 1, '03', 2],
      [nova, anterior, '2026-03-01', null, 1, '99', 1],
    ]);
    expect(Number(linhas[0]!['alterado_por'])).toBe(m.rh);
    expect(Number(linhas[1]!['criado_por'])).toBe(m.rh);
    expect(linhas[1]!['descricao_dependencia']).toBe('Agregado/Outros');
    // A leitura mostra só a versão em vigor, desde a data da alteração; a anterior não volta a ser alterada.
    const lidos = await porta.dependentes(ctx(m, m.rh), m.vinculo);
    expect(lidos.find((x) => x.id === anterior)).toBeUndefined();
    expect(lidos.find((x) => x.id === nova)).toMatchObject({ parentesco: '99', desde: '2026-03-01' });
    expect(await codigo(versao('2026-04-01'))).toBe('desatualizado');
  });

  it('C1-111 admissão pela ficha rápida: pessoa nova grava colaborador, vínculo e histórico; o CPF da rede é reusado; ficha e matrícula conferidas', async () => {
    const ids = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conf-adm' }, async (l) => ({
      sexo: Number((await l.uma<{ id: number }>("SELECT id FROM sexo WHERE codigo = 'T'"))!.id),
      categoria: Number(
        (await l.uma<{ id: number }>("SELECT id FROM categoria_trabalhador WHERE codigo_esocial = '101'"))!
          .id,
      ),
      tipoVinculo: Number(
        (await l.uma<{ id: number }>("SELECT id FROM tipo_vinculo_trabalho WHERE codigo_cnes = '010101'"))!
          .id,
      ),
    }));
    const cargoNome = `Cargo de admissão ${SUFIXO}`;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `massa-adm-${SUFIXO}` }, async (e) => {
      const cbo = await e.uma<{ id: number }>("SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '322205'");
      const id = await e.inserir(
        `INSERT INTO cargo (codigo, nome, ocupacao_cbo_id, data_inicio, carga_semanal_horas_padrao, criado_em)
         VALUES (?, ?, ?, '2020-01-01', 36, NOW(3))`,
        [`ADM${SUFIXO}`, cargoNome, cbo!.id],
      );
      admitidos.cargo = id;
      await e.executar('UPDATE sexo SET ativo = TRUE WHERE id = ?', [ids.sexo]);
      await e.executar('UPDATE tipo_vinculo_trabalho SET ativo = TRUE WHERE id = ?', [ids.tipoVinculo]);
    });
    const ficha = (cpf: string, extra: Record<string, unknown> = {}) => ({
      pessoa: null,
      cpfHmac: cifra.hmac(cpf),
      cpfCifrado: cifra.cifrar(cpf),
      nome: `ADMITIDA SINTETICA ${SUFIXO}`,
      profissional: null,
      usuario: null,
      tipo: 'clt',
      matricula: `A${SUFIXO}`,
      cargo: cargoNome,
      funcao: null,
      cargaSemanal: 36,
      centroCusto: m.centro,
      unidade: null,
      setor: null,
      admissao: '2026-11-03',
      por: 'rh',
      nascimento: '1995-08-20',
      sexo: ids.sexo,
      grauInstrucao: '09',
      categoria: ids.categoria,
      tipoVinculoTrabalho: ids.tipoVinculo,
      salario: 4200.5,
      ...extra,
    });
    const admitir = (f: ReturnType<typeof ficha>) =>
      porta.gravarSgh(
        ctx(m, m.rh),
        (r: { id: number }) => ({
          ...trilhaDe(m, m.rh, 'vinculo_trabalho'),
          acao: 'inclusao' as const,
          entidadeId: r.id,
        }),
        (g) => g.incluirVinculo(f as Parameters<GravadorPessoas['incluirVinculo']>[0]),
      );
    const novoCpf = cpfSintetico();
    // A ficha incompleta ou fora do modelo recusa sem gravar.
    expect(await codigo(admitir(ficha(novoCpf, { nascimento: null })))).toBe('nascimento-obrigatorio');
    expect(await codigo(admitir(ficha(novoCpf, { nascimento: '2015-01-01' })))).toBe('idade-minima');
    expect(await codigo(admitir(ficha(novoCpf, { salario: 0 })))).toBe('salario-invalido');
    expect(await codigo(admitir(ficha(novoCpf, { tipo: 'pj' })))).toBe('tipo-invalido');
    expect(await codigo(admitir(ficha(novoCpf, { sexo: null })))).toBe('sexo-inexistente');
    expect(await codigo(admitir(ficha(novoCpf, { categoria: 999_999_999 })))).toBe('categoria-inexistente');
    expect(await codigo(admitir(ficha(novoCpf, { matricula: null })))).toBe('matricula-obrigatoria');
    expect(await codigo(admitir(ficha(novoCpf, { cargo: 'Cargo que não existe' })))).toBe(
      'cargo-inexistente',
    );
    // Pessoa nova.
    const a = await admitir(ficha(novoCpf));
    admitidos.vinculos.push(a.id);
    admitidos.pessoas.push(a.pessoa);
    expect(a.pessoa).not.toBe(m.colab);
    const banco = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conf-adm' }, async (l) => ({
      c: await l.uma(
        `SELECT cpf = ? AS cpf_ok, data_nascimento, sexo_id, grau_instrucao, origem, criado_por FROM colaborador WHERE id = ?`,
        [novoCpf, a.pessoa],
      ),
      v: await l.uma(
        `SELECT estabelecimento_id, colaborador_id, matricula, tipo_vinculo_trabalho_id, categoria_trabalhador_id, cargo_id,
                regime_jornada_id, centro_custo_id, data_admissao, regime_trabalhista, salario_base, situacao, criado_por
           FROM vinculo_trabalho WHERE id = ?`,
        [a.id],
      ),
      h: await l.consultar(
        'SELECT cargo_id, data_inicio, data_fim, motivo FROM historico_cargo WHERE vinculo_trabalho_id = ?',
        [a.id],
      ),
      t: await l.uma<{ k: number }>(
        "SELECT COUNT(*) AS k FROM trilha_auditoria WHERE entidade = 'vinculo_trabalho' AND entidade_id = ? AND acao = 'inclusao'",
        [a.id],
      ),
    }));
    const iso = (x: unknown) => (x instanceof Date ? x.toISOString().slice(0, 10) : x);
    expect(banco.c).toMatchObject({ grau_instrucao: '09', origem: 'sistema' });
    expect([
      Number(banco.c!['cpf_ok']),
      iso(banco.c!['data_nascimento']),
      Number(banco.c!['sexo_id']),
    ]).toEqual([1, '1995-08-20', ids.sexo]);
    expect(Number(banco.c!['criado_por'])).toBe(m.rh);
    expect({
      est: Number(banco.v!['estabelecimento_id']),
      pessoa: Number(banco.v!['colaborador_id']),
      tipoVinculo: Number(banco.v!['tipo_vinculo_trabalho_id']),
      categoria: Number(banco.v!['categoria_trabalhador_id']),
      cargo: Number(banco.v!['cargo_id']),
      regime: banco.v!['regime_jornada_id'],
      centro: Number(banco.v!['centro_custo_id']),
      admissao: iso(banco.v!['data_admissao']),
      tipo: banco.v!['regime_trabalhista'],
      salario: Number(banco.v!['salario_base']),
      situacao: banco.v!['situacao'],
      por: Number(banco.v!['criado_por']),
    }).toEqual({
      est: m.est,
      pessoa: a.pessoa,
      tipoVinculo: ids.tipoVinculo,
      categoria: ids.categoria,
      cargo: admitidos.cargo,
      regime: null,
      centro: m.centro,
      admissao: '2026-11-03',
      tipo: 'clt',
      salario: 4200.5,
      situacao: 'ativo',
      por: m.rh,
    });
    expect(
      banco.h.map((x) => [Number(x['cargo_id']), iso(x['data_inicio']), x['data_fim'], x['motivo']]),
    ).toEqual([[admitidos.cargo, '2026-11-03', null, 'admissao']]);
    expect(Number(banco.t?.k)).toBe(1);
    // A leitura acha o vínculo pelo CPF (HMAC) e o histórico começa na admissão.
    expect((await porta.vinculosPorCpf(ctx(m, m.rh), cifra.hmac(novoCpf))).map((x) => x.id)).toEqual([a.id]);
    expect((await porta.historico(ctx(m, m.rh), a.id))[0]).toMatchObject({
      tipo: 'admissao',
      vigencia: '2026-11-03',
    });
    // A mesma matrícula no estabelecimento recusa; o CPF que já é colaborador na rede reusa a pessoa (nunca duplica).
    expect(await codigo(admitir(ficha(cpfSintetico())))).toBe('matricula-em-uso');
    const b = await admitir(ficha(m.cpf, { matricula: `B${SUFIXO}`, admissao: '2026-11-04' }));
    admitidos.vinculos.push(b.id);
    expect(b.pessoa).toBe(m.colab);
    const k = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conf-adm' }, (l) =>
      l.uma<{ k: number }>('SELECT COUNT(*) AS k FROM colaborador WHERE cpf = ?', [m.cpf]),
    );
    expect(Number(k?.k)).toBe(1);
  });
});
