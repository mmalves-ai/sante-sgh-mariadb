// Integração da porta própria do repasse contra o MariaDB real (cliente f22_o3, da onda 3). Massa SINTÉTICA com o
// prefixo "L0304R" (nenhuma pessoa real). Contrato de efeito: versão de regra (proposta, simulação, decisão com
// segregação e inclusão), lançamento e estorno, RPA com os lançamentos, apuração gravada e transição; as recusas
// (segregação, estorno que passa do original, lançamento já em RPA, outro estabelecimento). No fim, a massa de negócio
// é apagada; ficam o estabelecimento, os usuários e os domínios de teste. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { type ContextoNucleo, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { calcularItem, resolverRegra } from '@sgh/dominio-repasse';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { PortaRepassePropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0304R';
const RAIZ = resolve(import.meta.dirname, '../../../../..');

function garantirCliente(): void {
  const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], {
    cwd: RAIZ,
    encoding: 'utf8',
  });
  if (!lista.split('\n').some((l) => l.split('\t')[1] === CLIENTE))
    execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 3'], {
      cwd: RAIZ,
      stdio: 'ignore',
    });
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  if (l) return Number(l.id);
  return e.inserir(ins, pi);
}

async function recusada(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e);
  }
}

describe.skipIf(SEM_BANCO)('porta própria do repasse (MariaDB, cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRepassePropria;
  const ids = {
    est: 0,
    grupoAto: 0,
    grupoAtoOutro: 0,
    outroEst: 0,
    analista: 0,
    gestor: 0,
    profissional: 0,
    evento: 0,
    eventoOutro: 0,
    fonte: 0,
    producao: 0,
    paciente: 0,
    conta: 0,
  };
  let ctx: ContextoNucleo;
  let gestor: ContextoNucleo;
  let outro: ContextoNucleo;
  const comp = '2026-10';
  let seq = 0;
  const octx = (c: ContextoNucleo) => ({
    ...c,
    chaveIdempotencia: `${P}-${Date.now()}-${++seq}`,
    reautenticadoEm: Date.now(),
  });
  const trilha = (entidade: string): TrilhaDaGravacao => ({
    estabelecimento: ids.est,
    usuario: ids.analista,
    acao: 'inclusao',
    entidade,
    entidadeId: null,
    dadosDepois: { teste: P },
    correlacao: 'teste-03-04',
  });
  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente(ctx, async (l) => Number((await l.uma<{ q: number }>(sql, p))?.q ?? 0));

  const limpar = (e: Escritor) =>
    (async () => {
      for (const est of [ids.est, ids.outroEst]) {
        await e.executar(
          'DELETE x FROM rpa_retencao x JOIN rpa r ON r.id = x.rpa_id WHERE r.estabelecimento_id = ?',
          [est],
        );
        await e.executar(
          'DELETE rl FROM rpa_lancamento rl JOIN rpa r ON r.id = rl.rpa_id WHERE r.estabelecimento_id = ?',
          [est],
        );
        await e.executar('DELETE FROM rpa WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          'DELETE FROM lancamento_repasse WHERE estabelecimento_id = ? AND estornado_lancamento_repasse_id IS NOT NULL',
          [est],
        );
        await e.executar('DELETE FROM lancamento_repasse WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          'DELETE x FROM apuracao_repasse_item x JOIN apuracao_repasse a ON a.id = x.apuracao_repasse_id WHERE a.estabelecimento_id = ?',
          [est],
        );
        await e.executar('DELETE FROM producao_repasse WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM apuracao_repasse WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          'DELETE i FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id = ?',
          [est],
        );
        await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', [est]);
        await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          'DELETE i FROM regra_repasse_item i JOIN regra_repasse r ON r.id = i.regra_repasse_id WHERE r.estabelecimento_id = ?',
          [est],
        );
        await e.executar(
          'DELETE v FROM regra_repasse_versao v JOIN regra_repasse r ON r.id = v.regra_repasse_id WHERE r.estabelecimento_id = ?',
          [est],
        );
        await e.executar('DELETE FROM regra_repasse WHERE estabelecimento_id = ?', [est]);
      }
    })();

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-04r' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      const usuario = (login: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
          [login, `USUARIO SINTETICO ${login}`, agora],
        );
      ids.analista = await usuario('l0304r.analista');
      ids.gestor = await usuario('l0304r.gestor');
      await limpar(e);
      const pm = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`MEDICO SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, cpf, criado_em) VALUES (?, ?, ?)',
        [`MEDICO SINTETICO ${P}`, '00000000191', agora],
      );
      ids.profissional = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_profissional WHERE usuario_id = ? AND profissional_id = ?',
        [ids.analista, ids.profissional],
        'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [ids.analista, ids.profissional, '2026-01-01', agora],
      );
      ids.evento = await garantir(
        e,
        'SELECT id FROM evento_repasse WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-HON`],
        "INSERT INTO evento_repasse (estabelecimento_id, codigo, nome, natureza, tipo_lancamento, vigencia_inicio, criado_em) VALUES (?, ?, 'HONORARIOS L0304', 'rendimento', 'credito', '2026-01-01', ?)",
        [ids.est, `${P}-HON`, agora],
      );
      ids.eventoOutro = await garantir(
        e,
        'SELECT id FROM evento_repasse WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.outroEst, `${P}-HON`],
        "INSERT INTO evento_repasse (estabelecimento_id, codigo, nome, natureza, tipo_lancamento, vigencia_inicio, criado_em) VALUES (?, ?, 'HONORARIOS L0304 B', 'rendimento', 'credito', '2026-01-01', ?)",
        [ids.outroEst, `${P}-HON`, agora],
      );
      // Os tributos retidos no RPA (cadastro da rede; ficam, como os domínios de teste).
      for (const [codigo, esfera] of [
        ['INSS', 'federal'],
        ['IRRF', 'federal'],
        ['ISS', 'municipal'],
      ] as const)
        await garantir(
          e,
          'SELECT id FROM tributo WHERE codigo = ?',
          [codigo],
          "INSERT INTO tributo (codigo, descricao, esfera, forma_apuracao, incidencia, criado_em) VALUES (?, ?, ?, 'por_pagamento', 'retido', ?)",
          [codigo, `${codigo} SINTETICO`, esfera, agora],
        );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-OP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA L0304R', 'operadora', 'ativa', ?)",
        [`${P}-OP`, agora],
      );
      await garantir(
        e,
        'SELECT id FROM favorecido_repasse WHERE estabelecimento_id = ? AND profissional_id = ?',
        [ids.est, ids.profissional],
        "INSERT INTO favorecido_repasse (estabelecimento_id, profissional_id, tipo_favorecido, vigencia_inicio, criado_em) VALUES (?, ?, 'proprio_profissional', '2026-01-01', ?)",
        [ids.est, ids.profissional, agora],
      );
      // A produção: um atendimento com uma conta fechada da competência e um item faturável de código 99304012.
      const porCodigo = (tabela: string, codigo: string, colunas: Record<string, unknown>) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, ${Object.keys(colunas).join(', ')}, criado_em) VALUES (?, ${Object.keys(
            colunas,
          )
            .map(() => '?')
            .join(', ')}, ?)`,
          [codigo, ...Object.values(colunas), agora],
        );
      const pp = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp, 930_304_001, agora],
      );
      const tiss = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['E9'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('E9', 'CARATER L0304', 'teste', ?)",
        [agora],
      );
      const categoria = await porCodigo('categoria_atendimento', `${P}-AMB`, {
        descricao: 'AMBULATORIO L0304R',
        tipo_base: 'externo',
      });
      const atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
           fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ids.est, `${P}-AT1`, ids.paciente, categoria, tiss, ids.fonte, ids.profissional, agora, agora],
      );
      const tipoConta = await porCodigo('tipo_conta', `${P}-EXT`, {
        descricao: 'EXTERNA L0304R',
        natureza: 'externa',
      });
      const conta = (ids.conta = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id, tipo_conta_id, natureza,
           competencia, inicio_em, situacao, fechada_em, fechada_por_usuario_id, valor_itens, valor_total, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'ambulatorial', ?, ?, 'fechada', ?, ?, 500, 500, ?)`,
        [
          ids.est,
          `${P}-CH1`,
          atendimento,
          ids.paciente,
          ids.fonte,
          tipoConta,
          `${comp}-01`,
          agora,
          agora,
          ids.analista,
          agora,
        ],
      ));
      const grupo = await porCodigo('grupo_faturamento', `${P}-GF`, {
        descricao: 'GRUPO L0304R',
        tipo_grupo: 'servico_hospitalar',
      });
      const fat = await porCodigo('item_faturavel', '99304012', {
        descricao: 'PROCEDIMENTO L0304R',
        tipo_item: 'taxa',
        grupo_faturamento_id: grupo,
      });
      // conta-itens-2: o grupo de ato do item faturável (TIPOATO da origem) é a dimensão grupoAto da regra
      ids.grupoAto = await porCodigo('grupo_ato', `${P}-GA`, { descricao: 'GRUPO DE ATO L0304R' });
      ids.grupoAtoOutro = await porCodigo('grupo_ato', `${P}-GB`, { descricao: 'OUTRO GRUPO DE ATO L0304R' });
      await e.executar('UPDATE item_faturavel SET grupo_ato_id = ? WHERE id = ?', [ids.grupoAto, fat]);
      const item = await e.inserir(
        `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade, valor_unitario,
           valor_total, situacao, criado_em) VALUES (?, 1, ?, ?, 1, 500, 500, 'conferido', ?)`,
        [conta, fat, new Date('2026-10-14T13:00:00Z'), agora],
      );
      const funcao = await porCodigo('funcao_equipe_cobranca', `${P}-CLI`, {
        descricao: 'CLINICO L0304R',
        tipo_funcao: 'clinico',
      });
      ids.producao = await e.inserir(
        `INSERT INTO producao_repasse (estabelecimento_id, conta_hospitalar_item_id, conta_hospitalar_id, profissional_id,
           funcao_equipe_cobranca_id, quantidade, valor_base, integrado_em, situacao, criado_em) VALUES (?, ?, ?, ?, ?, 1, 500, ?, 'pendente', ?)`,
        [ids.est, item, conta, ids.profissional, funcao, agora, agora],
      );
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.analista, correlacao: 'teste-03-04r' };
    gestor = { ...ctx, usuario: ids.gestor };
    outro = { ...ctx, estabelecimento: ids.outroEst };
    porta = new PortaRepassePropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-03-04r' }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  it('leituras: hoje, opções do estabelecimento e prestadores do usuário', async () => {
    expect(await porta.hoje(ctx)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const o = await porta.opcoes(ctx);
    expect(o.eventos.some((x) => x.codigo === ids.evento)).toBe(true);
    expect(o.convenios.some((x) => x.codigo === ids.fonte)).toBe(true);
    expect((await porta.opcoes(outro)).eventos.some((x) => x.codigo === ids.evento)).toBe(false);
    expect(await porta.prestadoresDoUsuario(ctx, 'l0304r.analista')).toEqual([ids.profissional]);
    expect(await porta.registroDoPrestador(ctx, ids.profissional)).toBe(ids.profissional);
  });

  it('versão de regra: proposta (regra inativa), simulada, decisão com segregação e inclusão pela operação', async () => {
    const proposta = {
      vigencia: '2026-01-01',
      beneficiario: 'M',
      evento: ids.evento,
      convenio: ids.fonte,
      percentual: 20,
    };
    const { versao } = await porta.gravarSgh(ctx, trilha('regra_repasse_versao'), (g) =>
      g.proporVersao({
        substitui: null,
        proposta: JSON.stringify(proposta),
        justificativa: 'Nova regra L0304',
        autor: 'l0304r.analista',
      }),
    );
    const v = await porta.versao(ctx, versao);
    expect(v).toMatchObject({
      estado: 'rascunho',
      substitui: null,
      autor: 'l0304r.analista',
      regraIncluida: null,
    });
    expect(
      await contar('SELECT COUNT(*) AS q FROM regra_repasse WHERE estabelecimento_id = ? AND ativo = FALSE', [
        ids.est,
      ]),
    ).toBe(1);
    await porta.gravarSgh(ctx, trilha('regra_repasse_versao'), (g) => g.marcarSimulada({ versao }));
    expect((await porta.versao(ctx, versao))?.estado).toBe('simulada');
    expect(
      await recusada(
        porta.gravarSgh(ctx, trilha('regra_repasse_versao'), (g) =>
          g.decidirVersao({ versao, para: 'aprovada', por: 'l0304r.analista', justificativa: 'ok' }),
        ),
      ),
    ).toBe('segregacao');
    await porta.gravarSgh(gestor, trilha('regra_repasse_versao'), (g) =>
      g.decidirVersao({ versao, para: 'aprovada', por: 'l0304r.gestor', justificativa: 'Conferida' }),
    );
    expect(await porta.versao(ctx, versao)).toMatchObject({
      estado: 'aprovada',
      decididaPor: 'l0304r.gestor',
    });
    const r = await porta.executar(
      gestor,
      'repasse.incluirRegra',
      {
        versao,
        vigencia: '2026-01-01',
        beneficiario: 'M',
        convenio: ids.fonte,
        tipoConta: 'A',
        percentual: 20,
        valorFixo: 0,
        evento: ids.evento,
      },
      octx(gestor),
    );
    expect(r.repetida).toBe(false);
    expect((await porta.versao(ctx, versao))?.estado).toBe('incluida');
    const regras = await porta.todasRegras(ctx, { convenio: ids.fonte, data: '2026-10-15' });
    expect(
      regras.map((x) => [x.percentual, x.tipoConta, x.evento, x.convenio, x.horaInicial, x.horaFinal]),
    ).toEqual([[20, 'A', ids.evento, ids.fonte, '00:00', '23:59']]);
    expect((await porta.regras(ctx, { convenio: ids.fonte, data: '2026-10-15', depoisDe: 0 })).length).toBe(
      1,
    );
    expect(await porta.todasRegras(outro, { convenio: ids.fonte, data: '2026-10-15' })).toEqual([]);
  });

  it('lançamento, estorno e RPA: efeito no banco e as recusas', async () => {
    const lancar = (c: ContextoNucleo, e: Record<string, unknown>) =>
      porta.executar(
        c,
        'repasse.lancarEvento',
        {
          origem: 'ajuste',
          empresa: 1,
          competencia: comp,
          data: '2026-10-10',
          evento: ids.evento,
          tipo: 'M',
          prestador: ids.profissional,
          profissional: ids.profissional,
          valor: 1000,
          justificativa: 'Ajuste L0304',
          ...e,
        },
        octx(c),
      );
    const l1 = Number((await lancar(ctx, {})).resultado['lancamento']);
    expect(await recusada(lancar(ctx, { origem: 'estorno', valor: -1500, estornaDe: l1 }))).toBe(
      'estorno-excede',
    );
    const est1 = Number(
      (await lancar(ctx, { origem: 'estorno', valor: -200, estornaDe: l1 })).resultado['lancamento'],
    );
    // O contrato: o id do estorno → o id do original (o original não é estorno de ninguém).
    expect([...(await porta.estornos(ctx, [l1, est1]))]).toEqual([[est1, l1]]);
    expect((await porta.estornos(outro, [est1])).size).toBe(0);
    expect(await recusada(lancar(ctx, { evento: ids.eventoOutro }))).toBe('evento-inexistente');
    expect(await recusada(lancar(ctx, { apuracao: 999_999_999 }))).toBe('apuracao-inexistente');
    const ls = await porta.lancamentos(ctx, { empresa: 1, competencia: comp });
    expect(ls.map((x) => [x.valor, x.origem, x.prestador])).toEqual([
      [1000, 'ajuste', ids.profissional],
      [-200, 'estorno', ids.profissional],
    ]);
    expect(await porta.estadoPeriodo(ctx, 1, comp)).toEqual({ lancamentos: 2, daApuracao: 0 });
    expect(await porta.lancamentos(outro, { empresa: 1, competencia: comp })).toEqual([]);
    const retencoes = {
      bruto: 1000,
      baseInss: 1000,
      inss: 110,
      baseIrrf: 890,
      faixaIrrf: null,
      irrf: 0,
      iss: 50,
      liquido: 840,
    };
    const emitir = () =>
      porta.executar(
        ctx,
        'repasse.emitirRpa',
        {
          empresa: 1,
          competencia: comp,
          tipo: 'M',
          prestador: ids.profissional,
          profissional: ids.profissional,
          lancamentos: [l1],
          emissao: '2026-10-31',
          vencimento: '2026-11-10',
          retencoes,
        },
        octx(ctx),
      );
    expect(
      await recusada(
        porta.executar(
          ctx,
          'repasse.emitirRpa',
          {
            empresa: 1,
            competencia: comp,
            tipo: 'M',
            prestador: ids.profissional,
            profissional: ids.profissional,
            lancamentos: [l1],
            emissao: '2026-10-31',
            vencimento: '2026-11-10',
            retencoes: { ...retencoes, liquido: 900 },
          },
          octx(ctx),
        ),
      ),
    ).toMatch(/^(entrada-invalida|retencoes-divergentes)$/);
    const rpa = Number((await emitir()).resultado['rpa']);
    expect([...(await porta.jaEmRpa(ctx, [l1]))]).toEqual([l1]);
    expect(await recusada(emitir())).toBe('ja-em-rpa');
    const d = await porta.rpaDetalhe(ctx, rpa);
    expect(d?.rpa).toMatchObject({
      id: rpa,
      serie: 'RPA',
      prestador: ids.profissional,
      lancamentos: 1,
      situacao: 'emitido',
    });
    expect(d?.retencoes).toEqual({
      bruto: 1000,
      baseInss: 1000,
      inss: 110,
      baseIrrf: 890,
      irrf: 0,
      iss: 50,
      liquido: 840,
    });
    const rt = await nucleo.lerSomente(ctx, (l) =>
      l.consultar(
        'SELECT t.codigo, x.base_calculo, x.aliquota, x.valor FROM rpa_retencao x JOIN tributo t ON t.id = x.tributo_id WHERE x.rpa_id = ? ORDER BY x.sequencia',
        [rpa],
      ),
    );
    expect(
      rt.map((x) => [x['codigo'], Number(x['base_calculo']), Number(x['aliquota']), Number(x['valor'])]),
    ).toEqual([
      ['INSS', 1000, 11, 110],
      ['IRRF', 890, 0, 0],
      ['ISS', 1000, 5, 50],
    ]);
    expect(await contar('SELECT valor_retencoes AS q FROM rpa WHERE id = ?', [rpa])).toBe(160);
    expect(d?.contribuinte?.documento).toBe('***.***.***-91');
    expect((await porta.rpas(ctx, { empresa: 1, competencia: comp })).length).toBe(1);
    expect(await porta.rpaDetalhe(outro, rpa)).toBeNull();
    expect(
      await contar(
        "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'rpa' AND acao <> 'recusa' AND estabelecimento_id = ?",
        [ids.est],
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it('produção e regra de faixa: o item entrega o código de negócio, e a apuração casa a regra pela faixa', async () => {
    const aprovar = async (proposta: Record<string, unknown>) => {
      const { versao } = await porta.gravarSgh(ctx, trilha('regra_repasse_versao'), (g) =>
        g.proporVersao({
          substitui: null,
          proposta: JSON.stringify(proposta),
          justificativa: 'Faixa L0304',
          autor: 'l0304r.analista',
        }),
      );
      await porta.gravarSgh(gestor, trilha('regra_repasse_versao'), (g) =>
        g.decidirVersao({ versao, para: 'aprovada', por: 'l0304r.gestor', justificativa: 'Conferida' }),
      );
      return versao;
    };
    const incluir = (versao: number, e: Record<string, unknown> = {}) =>
      porta.executar(
        gestor,
        'repasse.incluirRegra',
        {
          versao,
          vigencia: '2026-01-01',
          beneficiario: 'M',
          convenio: ids.fonte,
          tipoConta: 'A',
          percentual: 30,
          valorFixo: 0,
          evento: ids.evento,
          procedimentoInicial: 99304000,
          procedimentoFinal: 99304099,
          ...e,
        },
        octx(gestor),
      );
    const v = await aprovar({
      vigencia: '2026-01-01',
      beneficiario: 'M',
      evento: ids.evento,
      convenio: ids.fonte,
      percentual: 30,
    });
    // O evento de outro estabelecimento é recusado; o prestador e o profissional da regra têm de ser o mesmo e existir.
    expect(await recusada(incluir(v, { evento: ids.eventoOutro }))).toBe('evento-inexistente');
    expect(
      await recusada(incluir(v, { prestador: ids.profissional, profissional: ids.profissional + 1_000_000 })),
    ).toBe('profissional-divergente');
    expect(await recusada(incluir(v, { profissional: 2_000_000_000 }))).toBe('profissional-inexistente');
    // A regra de um profissional é gravada com ele (em outra faixa, para não disputar o item da regra genérica).
    const vp = await aprovar({
      vigencia: '2026-01-01',
      beneficiario: 'M',
      evento: ids.evento,
      convenio: ids.fonte,
      percentual: 40,
    });
    const doProfissional = Number(
      (
        await incluir(vp, {
          prestador: ids.profissional,
          percentual: 40,
          procedimentoInicial: 99306000,
          procedimentoFinal: 99306099,
        })
      ).resultado['regra'],
    );
    const comProfissional = (await porta.todasRegras(ctx, { convenio: ids.fonte, data: '2026-10-15' })).find(
      (x) => x.id === doProfissional,
    );
    expect([comProfissional?.profissional, comProfissional?.percentual]).toEqual([ids.profissional, 40]);
    const faixa = Number((await incluir(v)).resultado['regra']);
    // O valor recebido da fonte pagadora, o recurso deferido e a conciliação chegam ao motor (base "recebido").
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-03-04r' }, (e) =>
      e.executar(
        'UPDATE producao_repasse SET valor_recebido = 420, valor_recurso_deferido = 30, conciliado = TRUE WHERE id = ?',
        [ids.producao],
      ),
    );
    const { itens } = await porta.producao(ctx, comp, 0);
    const item = itens.find((x) => x.id === ids.producao)!;
    expect(item).toMatchObject({
      procedimento: 99304012,
      convenio: ids.fonte,
      executante: ids.profissional,
      cobrado: 500,
      pago: 420,
      recursoDeferido: 30,
      conciliado: true,
      tipoConta: 'E',
    });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-03-04r' }, (e) =>
      e.executar(
        'UPDATE producao_repasse SET valor_recebido = 0, valor_recurso_deferido = 0, conciliado = FALSE WHERE id = ?',
        [ids.producao],
      ),
    );
    expect((await porta.producao(outro, comp, 0)).itens).toEqual([]);
    expect(
      (
        await porta.regras(ctx, {
          convenio: ids.fonte,
          data: '2026-10-15',
          depoisDe: 0,
          procedimento: 99304012,
        })
      ).map((r) => r.id),
    ).toContain(faixa);
    expect(
      (
        await porta.regras(ctx, {
          convenio: ids.fonte,
          data: '2026-10-15',
          depoisDe: 0,
          procedimento: 99305000,
        })
      ).map((r) => r.id),
    ).not.toContain(faixa);
    const todas = await porta.todasRegras(ctx, { convenio: ids.fonte, data: '2026-10-15' });
    const r = resolverRegra(item, todas);
    expect([r.regra?.id, r.regra?.percentual]).toEqual([faixa, 30]);
    expect(resolverRegra({ ...item, procedimento: 99305000 }, todas).regra?.id).not.toBe(faixa);
  });

  it('grupo de ato (conta-itens-2): a produção lê o grupo do item faturável e a regra do grupo casa só nele', async () => {
    const { versao } = await porta.gravarSgh(ctx, trilha('regra_repasse_versao'), (g) =>
      g.proporVersao({
        substitui: null,
        proposta: JSON.stringify({
          vigencia: '2026-01-01',
          beneficiario: 'M',
          evento: ids.evento,
          grupoAto: ids.grupoAto,
        }),
        justificativa: 'Grupo de ato',
        autor: 'l0304r.analista',
      }),
    );
    await porta.gravarSgh(gestor, trilha('regra_repasse_versao'), (g) =>
      g.decidirVersao({ versao, para: 'aprovada', por: 'l0304r.gestor', justificativa: 'Conferida' }),
    );
    // inclusão: a regra grava grupo_ato_id e volta com grupoAto na leitura (ida e volta pela porta)
    const doGrupo = Number(
      (
        await porta.executar(
          gestor,
          'repasse.incluirRegra',
          {
            versao,
            vigencia: '2026-01-01',
            beneficiario: 'M',
            convenio: ids.fonte,
            tipoConta: 'A',
            percentual: 45,
            valorFixo: 0,
            evento: ids.evento,
            grupoAto: ids.grupoAto,
            procedimentoInicial: 99304012,
            procedimentoFinal: 99304012,
          },
          octx(gestor),
        )
      ).resultado['regra'],
    );
    const todas = await porta.todasRegras(ctx, { convenio: ids.fonte, data: '2026-10-15' });
    expect(todas.find((x) => x.id === doGrupo)).toMatchObject({
      grupoAto: ids.grupoAto,
      ato: null,
      percentual: 45,
    });
    // produção: o item entrega o grupo de ato do item faturável (JOIN ifa.grupo_ato_id)
    const item = (await porta.producao(ctx, comp, 0)).itens.find((x) => x.id === ids.producao)!;
    expect(item.grupoAto).toBe(ids.grupoAto);
    // casa a regra do grupo; com outro grupo ou sem grupo (item sem grupo no faturável) cai em outra regra
    expect(resolverRegra(item, todas).regra?.id).toBe(doGrupo);
    expect(resolverRegra({ ...item, grupoAto: ids.grupoAtoOutro }, todas).regra?.id).not.toBe(doGrupo);
    expect(resolverRegra({ ...item, grupoAto: null }, todas).regra?.id).not.toBe(doGrupo);
  });

  it('apuração: grava o período com a memória e passa pela conferência e aprovação', async () => {
    const { apuracao, recalculada } = await porta.gravarSgh(ctx, trilha('apuracao_repasse'), (g) =>
      g.gravarApuracao({
        empresa: 1,
        competencia: comp,
        apuradoPor: 'l0304r.analista',
        simulacao: false,
        totais: { itens: 0, comRepasse: 0, pendentes: 0, pendencias: '{}', base: 0, valor: 0 },
        memorias: [],
      }),
    );
    expect(recalculada).toBe(false);
    const a = await porta.apuracaoDoPeriodo(ctx, 1, comp);
    expect(a).toMatchObject({
      id: apuracao,
      competencia: comp,
      estado: 'aberta',
      apuradoPor: 'l0304r.analista',
    });
    // O recálculo por outro usuário: ele passa a ser quem apurou (a segregação na aprovação o compara).
    const faixa = (await porta.todasRegras(ctx, { convenio: ids.fonte, data: '2026-10-15' })).find(
      (x) => x.procedimentoInicial === 99304000,
    )!.id;
    const memoria = {
      item: ids.producao,
      prestador: ids.profissional,
      regra: faixa,
      dimensoes: 'procedimento,convenio',
      ignoradas: JSON.stringify([{ regra: faixa + 1, motivo: 'fora-da-vigencia' }]),
      base: 'cobrado',
      baseValor: 500,
      percentual: 30,
      valorFixo: 10,
      valorSemAdicional: 160,
      adicional: JSON.stringify({ tipo: 'fim-de-semana', percentual: 12.5 }),
      valor: 180,
      pendencia: null,
    };
    // O item sem profissional entra na memória com a pendência e valor zero (antes ficava só no resumo).
    const pendente = {
      ...memoria,
      prestador: null,
      regra: null,
      dimensoes: '',
      ignoradas: '',
      base: null,
      percentual: 0,
      valorFixo: 0,
      valorSemAdicional: 0,
      adicional: null,
      valor: 0,
      pendencia: 'sem-executante',
    };
    const re = await porta.gravarSgh(gestor, trilha('apuracao_repasse'), (g) =>
      g.gravarApuracao({
        empresa: 1,
        competencia: comp,
        apuradoPor: 'l0304r.gestor',
        simulacao: false,
        totais: {
          itens: 2,
          comRepasse: 1,
          pendentes: 1,
          pendencias: JSON.stringify({ 'sem-executante': 1 }),
          base: 1000,
          valor: 180,
        },
        memorias: [memoria, pendente],
      }),
    );
    expect(re).toEqual({ apuracao, recalculada: true });
    // O resumo da apuração: itens, com repasse, pendentes e pendências por motivo.
    const resumo = await porta.apuracao(ctx, apuracao);
    expect(resumo).toMatchObject({
      estado: 'aberta',
      apuradoPor: 'l0304r.gestor',
      itens: 2,
      comRepasse: 1,
      pendentes: 1,
      conferidoPor: null,
    });
    expect(JSON.parse(resumo!.pendencias)).toEqual({ 'sem-executante': 1 });
    // A memória completa volta como foi gravada (item da regra, dimensões, descartadas, base, fixo, adicional).
    expect(await porta.memorias(ctx, apuracao, null)).toEqual([memoria, pendente]);
    expect(await porta.memorias(ctx, apuracao, ids.profissional)).toEqual([memoria]);
    // Os pendentes, por página e pelo motivo, com a referência de negócio do item (conta, atendimento, prontuário,
    // procedimento e a data local); o executante ausente fica sem nome.
    const pg = await porta.itensPendentes(ctx, apuracao, {
      motivo: 'sem-executante',
      deslocamento: 0,
      limite: 10,
    });
    expect(pg.total).toBe(1);
    expect(pg.itens).toEqual([
      {
        ...pendente,
        contaId: ids.conta,
        contaNumero: `${P}-CH1`,
        atendimentoNumero: `${P}-AT1`,
        prontuario: '930304001',
        procedimento: '99304012',
        procedimentoDescricao: 'PROCEDIMENTO L0304R',
        realizadoEm: expect.stringMatching(/^2026-10-14 \d{2}:00$/),
        profissionalNome: null,
      },
    ]);
    expect(
      await porta.itensPendentes(ctx, apuracao, { motivo: 'sem-regra', deslocamento: 0, limite: 10 }),
    ).toEqual({
      itens: [],
      total: 0,
    });
    expect(
      (await porta.itensPendentes(ctx, apuracao, { motivo: null, deslocamento: 1, limite: 10 })).itens,
    ).toEqual([]);
    expect(
      await porta.itensPendentes(outro, apuracao, { motivo: null, deslocamento: 0, limite: 10 }),
    ).toEqual({
      itens: [],
      total: 0,
    });
    expect(
      await contar(
        'SELECT COUNT(*) AS q FROM apuracao_repasse_item WHERE apuracao_repasse_id = ? AND regra_repasse_id IS NOT NULL AND excluido_em IS NULL',
        [apuracao],
      ),
    ).toBe(1);
    await porta.gravarSgh(gestor, trilha('apuracao_repasse'), (g) =>
      g.transicionarApuracao({ apuracao, de: 'aberta', para: 'conferida', por: 'l0304r.gestor' }),
    );
    // Quem conferiu fica gravado e volta na leitura.
    expect(await porta.apuracao(ctx, apuracao)).toMatchObject({
      estado: 'conferida',
      conferidoPor: 'l0304r.gestor',
    });
    // Segregação no banco (ck_apuracao_repasse_segregacao): quem apurou por último não aprova.
    await expect(
      porta.gravarSgh(gestor, trilha('apuracao_repasse'), (g) =>
        g.transicionarApuracao({ apuracao, de: 'conferida', para: 'aprovada', por: 'l0304r.gestor' }),
      ),
    ).rejects.toThrow();
    await porta.gravarSgh(ctx, trilha('apuracao_repasse'), (g) =>
      g.transicionarApuracao({ apuracao, de: 'conferida', para: 'aprovada', por: 'l0304r.analista' }),
    );
    expect(await porta.apuracao(ctx, apuracao)).toMatchObject({
      estado: 'aprovada',
      aprovadoPor: 'l0304r.analista',
    });
    expect(await contar('SELECT versao AS q FROM apuracao_repasse WHERE id = ?', [apuracao])).toBe(4);
    expect(
      await recusada(
        porta.gravarSgh(ctx, trilha('apuracao_repasse'), (g) =>
          g.gravarApuracao({
            empresa: 1,
            competencia: comp,
            apuradoPor: 'l0304r.analista',
            simulacao: false,
            totais: { itens: 0, comRepasse: 0, pendentes: 0, pendencias: '{}', base: 0, valor: 0 },
            memorias: [],
          }),
        ),
      ),
    ).toBe('periodo-ja-apurado');
    expect(await porta.apuracao(outro, apuracao)).toBeNull();
  });

  it('ADR 0009: a regra integral da consulta particular chega ao motor (100% do cobrado, sem adicional no feriado)', async () => {
    const grupo = await contar(`SELECT id AS q FROM grupo_faturamento WHERE codigo = ?`, [`${P}-GF`]);
    const { particular, integral, noConvenio } = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'teste-03-04r' },
      async (e) => {
        const particular = await garantir(
          e,
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [`${P}-PART`],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'PARTICULAR L0304R', 'particular', 'ativa', CURRENT_TIMESTAMP(3))",
          [`${P}-PART`],
        );
        const regra = async (codigo: string, fonte: number) => {
          const r = await e.inserir(
            `INSERT INTO regra_repasse (estabelecimento_id, codigo, descricao, evento_repasse_id, base_calculo, vigencia_inicio, criado_em)
             VALUES (?, ?, 'Consulta particular integral L0304R', ?, 'cobrado', '2026-01-01', CURRENT_TIMESTAMP(3))`,
            [ids.est, codigo, ids.evento],
          );
          return e.inserir(
            `INSERT INTO regra_repasse_item (regra_repasse_id, sequencia, fonte_pagadora_id, grupo_faturamento_id, percentual, origem, criado_em)
             VALUES (?, 1, ?, ?, 100, 'migracao', CURRENT_TIMESTAMP(3))`,
            [r, fonte, grupo],
          );
        };
        return {
          particular,
          integral: await regra(`INTEGRAL-PART-${P}`, particular),
          // O caso negativo: a mesma marca gravada numa operadora não pode virar repasse integral num convênio.
          noConvenio: await regra(`INTEGRAL-PART-${P}-OP`, ids.fonte),
        };
      },
    );
    const x = await porta.integraisParticular(ctx, '2026-10-15');
    expect(x.integrais).toEqual([
      expect.objectContaining({
        fontePagadoraId: particular,
        fonteParticular: true,
        grupoFaturamentoId: grupo,
        itemFaturavelId: null,
        percentual: 100,
      }),
    ]);
    expect([...x.fontesParticulares]).toEqual([particular]);
    expect(x.grupoDoProcedimento.get(99304012)).toBe(grupo);
    expect((await porta.integraisParticular(outro, '2026-10-15')).integrais).toEqual([]);
    // Fora das regras comuns: sem as dimensões de grupo, ela valeria para todo item da fonte.
    const todas = await porta.todasRegras(ctx, { convenio: ids.fonte, data: '2026-10-15' });
    expect(todas.map((r) => r.id)).not.toContain(integral);
    expect(todas.map((r) => r.id)).not.toContain(noConvenio);
    const item = (await porta.producao(ctx, comp, 0)).itens.find((i) => i.id === ids.producao)!;
    const opcoes = {
      basePadrao: 'cobrado' as const,
      modoAdicional: 'sobre-valor' as const,
      feriados: new Set([item.data]),
      integrais: x.integrais,
      grupoDoProcedimento: x.grupoDoProcedimento,
      fontesParticulares: x.fontesParticulares,
    };
    // O mesmo item lançado no particular: 100% do cobrado, sem adicional no feriado.
    const m = calcularItem({ ...item, convenio: particular }, todas, opcoes);
    expect([m.valorCentavos, m.percentual, m.adicional, m.pendencia]).toEqual([50000, 100, null, null]);
    // O item da operadora (convênio): a marca INTEGRAL-PART gravada nela não vale; segue a regra comum.
    const c = calcularItem(item, todas, opcoes);
    expect(c.percentual).not.toBe(100);
    expect(c.regra).not.toBeNull();
  });
});
