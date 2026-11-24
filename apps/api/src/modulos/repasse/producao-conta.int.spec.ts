// Integração da produção do repasse a partir da conta (F3, motores) contra o MariaDB real. Massa SINTÉTICA com o
// prefixo "F3RPC" (nenhuma pessoa real), num estabelecimento próprio. Contrato de efeito de
// repasse.sincronizar-producao-conta (o que deixa no banco):
//   1. item lançado com executor → producao_repasse 'pendente' com a base, a função titular e a prévia pela regra
//      vigente na data do item (a mais nova já vigente vence a antiga); idempotente (sincronizar de novo não duplica);
//   2. momento "fechamento" (parâmetro): o lançamento não gera; o fechamento gera;
//   3. item estornado antes da apuração → produção 'estornado', fora da produção do período;
//   4. glosa parcial antes da apuração → base reduzida pela parte glosada;
//   5. apuração do período: a soma do motor sobre a produção bate com as parcelas e o teste dourado da produção é 100%;
//   6. item estornado depois da apuração aprovada → estorno_repasse 'pendente' do repassado no período seguinte.
// No fim, a massa de negócio é apagada. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { calcularPeriodo, compararDourado, somarProducao } from '@sgh/dominio-repasse';
import { type ContextoNucleo, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaRepassePropria } from './porta-propria.js';
import { sincronizarProducaoConta } from './producao-conta.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F3RPC';
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const COMP = '2026-10';

function garantirCliente(): void {
  const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], {
    cwd: RAIZ,
    encoding: 'utf8',
  });
  if (!lista.split('\n').some((l) => l.split('\t')[1] === CLIENTE))
    execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F3 motores'], {
      cwd: RAIZ,
      stdio: 'ignore',
    });
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  if (l) return Number(l.id);
  return e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('produção do repasse a partir da conta (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRepassePropria;
  let ctx: ContextoNucleo;
  const ids = {
    est: 0,
    usuario: 0,
    profissional: 0,
    fonte: 0,
    conta: 0,
    fat: 0,
    titular: 0,
    regraNova: 0,
    definicao: 0,
  };
  let seq = 0;
  let sequenciaItem = 0;

  const limpar = (e: Escritor) =>
    (async () => {
      const est = ids.est;
      await e.executar('DELETE FROM estorno_repasse WHERE estabelecimento_id = ?', [est]);
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
      await e.executar('DELETE FROM regra_repasse WHERE estabelecimento_id = ?', [est]);
      await e.executar("DELETE FROM parametro_valor WHERE nivel = 'estabelecimento' AND estabelecimento_id = ?", [est]);
    })();

  const sincronizar = (evento: 'lancamento' | 'fechamento' | 'mudanca-item', itens?: number[]) =>
    nucleo.criarExecutor().executar(
      sincronizarProducaoConta,
      CLIENTE,
      { conta: ids.conta, evento, ...(itens ? { itens } : {}) },
      { ...ctx, chaveIdempotencia: `${P}-${Date.now()}-${++seq}` },
    );

  const escrever = <T>(fn: (e: Escritor) => Promise<T>) => nucleo.escrever({ cliente: CLIENTE, correlacao: P }, fn);

  /** Um item da conta com executor (fixture: o lançamento da conta é de outra família; aqui só o estado do item). */
  const novoItem = (valor: number, quando: string, extra: Record<string, unknown> = {}) =>
    escrever((e) =>
      e.inserir(
        `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
           valor_unitario, valor_total, valor_honorario, executante_profissional_id, situacao, criado_em)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'lancado', ?)`,
        [
          ids.conta,
          ++sequenciaItem,
          ids.fat,
          new Date(quando),
          valor,
          valor,
          extra['honorario'] ?? 0,
          ids.profissional,
          new Date(),
        ],
      ),
    );

  const producoesDo = (item: number) =>
    escrever((e) =>
      e.consultar<Record<string, unknown>>(
        `SELECT id, situacao, valor_base, valor_repasse, percentual, funcao_equipe_cobranca_id, profissional_id
           FROM producao_repasse WHERE conta_hospitalar_item_id = ? ORDER BY id`,
        [item],
      ),
    );

  const momento = (valor: 'lancamento' | 'fechamento') =>
    escrever(async (e) => {
      await e.executar("DELETE FROM parametro_valor WHERE nivel = 'estabelecimento' AND estabelecimento_id = ?", [
        ids.est,
      ]);
      await e.inserir(
        `INSERT INTO parametro_valor (parametro_definicao_id, nivel, estabelecimento_id, valor, vigencia_inicio, criado_em)
         VALUES (?, 'estabelecimento', ?, ?, ?, ?)`,
        [ids.definicao, ids.est, valor, new Date(Date.now() - 60_000), new Date()],
      );
    });

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    await escrever(async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f3rpc.faturista'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f3rpc.faturista', 'USUARIO SINTETICO F3RPC', agora],
      );
      await limpar(e);
      const pm = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`MEDICO SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`MEDICO SINTETICO ${P}`, agora],
      );
      ids.profissional = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-OP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA F3RPC', 'operadora', 'ativa', ?)",
        [`${P}-OP`, agora],
      );
      const evento = await garantir(
        e,
        'SELECT id FROM evento_repasse WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-HON`],
        "INSERT INTO evento_repasse (estabelecimento_id, codigo, nome, natureza, tipo_lancamento, vigencia_inicio, criado_em) VALUES (?, ?, 'HONORARIOS F3RPC', 'rendimento', 'credito', '2026-01-01', ?)",
        [ids.est, `${P}-HON`, agora],
      );
      const porCodigo = (tabela: string, codigo: string, colunas: Record<string, unknown>) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, ${Object.keys(colunas).join(', ')}, criado_em) VALUES (?, ${Object.keys(colunas)
            .map(() => '?')
            .join(', ')}, ?)`,
          [codigo, ...Object.values(colunas), agora],
        );
      // A função titular: a clínica de menor ordem do catálogo (o catálogo é da rede; a de ordem 0 vence as do teste).
      ids.titular = await porCodigo('funcao_equipe_cobranca', `${P}-CLI`, {
        descricao: 'CLINICO F3RPC',
        tipo_funcao: 'clinico',
        ordem_apresentacao: 0,
      });
      const pp = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      const paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp, 930_317_001, agora],
      );
      const tiss = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['E9'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('E9', 'CARATER TESTE', 'teste', ?)",
        [agora],
      );
      const categoria = await porCodigo('categoria_atendimento', `${P}-AMB`, {
        descricao: 'AMBULATORIO F3RPC',
        tipo_base: 'externo',
      });
      const atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
           fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ids.est, `${P}-AT1`, paciente, categoria, tiss, ids.fonte, ids.profissional, agora, agora],
      );
      const tipoConta = await porCodigo('tipo_conta', `${P}-EXT`, { descricao: 'EXTERNA F3RPC', natureza: 'externa' });
      ids.conta = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id, tipo_conta_id, natureza,
           competencia, inicio_em, situacao, valor_itens, valor_total, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'ambulatorial', ?, ?, 'aberta', 0, 0, ?)`,
        [ids.est, `${P}-CH1`, atendimento, paciente, ids.fonte, tipoConta, `${COMP}-01`, agora, agora],
      );
      const grupo = await porCodigo('grupo_faturamento', `${P}-GF`, {
        descricao: 'GRUPO F3RPC',
        tipo_grupo: 'servico_hospitalar',
      });
      ids.fat = await porCodigo('item_faturavel', '99317012', {
        descricao: 'PROCEDIMENTO F3RPC',
        tipo_item: 'taxa',
        grupo_faturamento_id: grupo,
      });
      // Duas versões da regra do convênio: a antiga (50%) e a nova (70%), vigente desde 10/10.
      const regra = async (codigo: string, vigencia: string, percentual: number) => {
        const r = await e.inserir(
          `INSERT INTO regra_repasse (estabelecimento_id, codigo, descricao, evento_repasse_id, base_calculo, vigencia_inicio, criado_em)
           VALUES (?, ?, 'Regra F3RPC', ?, 'cobrado', ?, ?)`,
          [ids.est, codigo, evento, vigencia, agora],
        );
        return e.inserir(
          `INSERT INTO regra_repasse_item (regra_repasse_id, sequencia, fonte_pagadora_id, percentual, criado_em)
           VALUES (?, 1, ?, ?, ?)`,
          [r, ids.fonte, percentual, agora],
        );
      };
      await regra(`${P}-V1`, '2026-01-01', 50);
      ids.regraNova = await regra(`${P}-V2`, '2026-10-10', 70);
      // A definição do parâmetro (catálogo de parâmetros; nasce aqui quando o cliente de teste ainda não a tem).
      const modulo = await garantir(
        e,
        "SELECT id FROM modulo_sistema WHERE codigo = 'repasse'",
        [],
        "INSERT INTO modulo_sistema (codigo, descricao, criado_em) VALUES ('repasse', 'Repasse médico', ?)",
        [agora],
      );
      ids.definicao = await garantir(
        e,
        "SELECT id FROM parametro_definicao WHERE chave = 'repasse.momentoProducao'",
        [],
        `INSERT INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, valor_padrao, permite_estabelecimento, criado_em)
         VALUES ('repasse.momentoProducao', ?, 'Quando o item da conta vira produção do repasse', 'lista', 'lancamento', TRUE, ?)`,
        [modulo, agora],
      );
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: P };
    porta = new PortaRepassePropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever((e) => limpar(e));
    await nucleo.encerrar();
  });

  let itemA = 0;
  let itemB = 0;
  let itemC = 0;

  it('1. lançamento com executor: produção pela regra vigente na data, na função titular; idempotente', async () => {
    await momento('lancamento');
    itemA = await novoItem(500, '2026-10-14T13:00:00Z');
    const r = await sincronizar('lancamento', [itemA]);
    expect(r.resultado).toMatchObject({ geradas: 1, estornadas: 0, debitos: 0 });
    const [p] = await producoesDo(itemA);
    expect(p).toMatchObject({ situacao: 'pendente', profissional_id: ids.profissional });
    expect(Number(p!['funcao_equipe_cobranca_id'])).toBe(ids.titular);
    expect(Number(p!['valor_base'])).toBe(500);
    expect(Number(p!['percentual'])).toBe(70);
    expect(Number(p!['valor_repasse'])).toBe(350);
    // A data antes da regra nova: vale a antiga (50%), e o honorário separado é a base.
    itemB = await novoItem(300, '2026-10-05T13:00:00Z', { honorario: 200 });
    await sincronizar('lancamento', [itemB]);
    const [pb] = await producoesDo(itemB);
    expect([Number(pb!['valor_base']), Number(pb!['percentual']), Number(pb!['valor_repasse'])]).toEqual([200, 50, 100]);
    const deNovo = await sincronizar('lancamento');
    expect(deNovo.resultado).toMatchObject({ geradas: 0 });
    expect(await producoesDo(itemA)).toHaveLength(1);
  });

  it('2. momento "fechamento": o lançamento não gera, o fechamento gera', async () => {
    await momento('fechamento');
    itemC = await novoItem(1000, '2026-10-20T13:00:00Z');
    expect((await sincronizar('lancamento', [itemC])).resultado).toMatchObject({ geradas: 0 });
    expect(await producoesDo(itemC)).toHaveLength(0);
    expect((await sincronizar('fechamento')).resultado).toMatchObject({ geradas: 1 });
    expect(Number((await producoesDo(itemC))[0]!['valor_repasse'])).toBe(700);
    await momento('lancamento');
  });

  it('3. item estornado antes da apuração: produção estornada e fora da produção do período', async () => {
    const itemD = await novoItem(80, '2026-10-21T13:00:00Z');
    await sincronizar('lancamento', [itemD]);
    await escrever((e) => e.executar("UPDATE conta_hospitalar_item SET situacao = 'estornado' WHERE id = ?", [itemD]));
    expect((await sincronizar('mudanca-item', [itemD])).resultado).toMatchObject({ estornadas: 1, debitos: 0 });
    const [p] = await producoesDo(itemD);
    expect(p!['situacao']).toBe('estornado');
    const { itens } = await porta.producao(ctx, COMP, 0);
    expect(itens.some((i) => i.id === Number(p!['id']))).toBe(false);
    expect((await sincronizar('mudanca-item', [itemD])).resultado).toMatchObject({ estornadas: 0 });
  });

  it('4. glosa parcial antes da apuração: a base fica com a parte não glosada', async () => {
    await escrever((e) =>
      e.executar("UPDATE conta_hospitalar_item SET valor_glosado = 250, situacao = 'conferido' WHERE id = ?", [itemC]),
    );
    expect((await sincronizar('mudanca-item', [itemC])).resultado).toMatchObject({ reduzidas: 1 });
    expect(Number((await producoesDo(itemC))[0]!['valor_base'])).toBe(750);
    expect((await sincronizar('mudanca-item', [itemC])).resultado).toMatchObject({ reduzidas: 0 });
  });

  it('5. apuração do período: o motor sobre a produção soma as parcelas e o dourado da produção é 100%', async () => {
    const { itens } = await porta.producao(ctx, COMP, 0);
    expect(itens).toHaveLength(3);
    const regras = await porta.todasRegras(ctx, { convenio: ids.fonte, data: '2026-10-31' });
    // A regra nova é a vigente no fim do período; cada item é recalculado na própria data (vigência por item).
    const memorias = calcularPeriodo(itens, regras, new Set(), {
      basePadrao: 'cobrado',
      modoAdicional: 'sobre-valor',
      feriados: new Set(),
    });
    // Parcelas: A 500 × 70% = 350; B 200 × 50% = 100; C 750 × 70% = 525 (a base reduzida pela glosa).
    expect(memorias.map((m) => m.valorCentavos).sort((a, b) => a - b)).toEqual([10_000, 35_000, 52_500]);
    const soma = somarProducao(
      memorias.map((m) => ({ baseCentavos: m.baseCentavos, repasseCentavos: m.valorCentavos, situacao: 'pendente' })),
    );
    expect(soma).toEqual({ itens: 3, baseCentavos: 145_000, repasseCentavos: 97_500 });
    // Dourado: a prévia gravada no lançamento contra o recálculo da apuração (C sai da prévia: a glosa a refaz).
    const gravadas = await escrever((e) =>
      e.consultar<Record<string, unknown>>(
        `SELECT id, valor_repasse, percentual FROM producao_repasse
          WHERE estabelecimento_id = ? AND situacao = 'pendente' AND valor_repasse IS NOT NULL ORDER BY id`,
        [ids.est],
      ),
    );
    const d = compararDourado(
      gravadas.map((g) => ({
        item: Number(g['id']),
        regra: null,
        percentual: Number(g['percentual']),
        valorCentavos: Math.round(Number(g['valor_repasse']) * 100),
      })),
      memorias,
      97,
    );
    expect(d).toMatchObject({ total: 2, iguais: 2, acertoPct: 100, atingeMeta: true });
  });

  it('6. item estornado depois da apuração aprovada: débito do repassado no período seguinte', async () => {
    const [p] = await producoesDo(itemA);
    await escrever(async (e) => {
      const a = await e.inserir(
        `INSERT INTO apuracao_repasse (estabelecimento_id, numero, competencia, tipo_apuracao, iniciada_em, iniciada_por_usuario_id,
           valor_faturado, valor_bruto, valor_liquido, situacao, concluida_em, criado_em)
         VALUES (?, ?, ?, 'producao', ?, ?, 500, 350, 350, 'aprovada', ?, ?)`,
        [ids.est, `${P}-AR1`, `${COMP}-01`, new Date(), ids.usuario, new Date(), new Date()],
      );
      await e.inserir(
        `INSERT INTO apuracao_repasse_item (apuracao_repasse_id, sequencia, profissional_id, producao_repasse_id, competencia_producao,
           valor_faturado, percentual_repasse, valor_repasse, criado_em) VALUES (?, 1, ?, ?, ?, 500, 70, 350, ?)`,
        [a, ids.profissional, p!['id'], `${COMP}-01`, new Date()],
      );
      await e.executar("UPDATE conta_hospitalar_item SET situacao = 'estornado' WHERE id = ?", [itemA]);
    });
    expect((await sincronizar('mudanca-item', [itemA])).resultado).toMatchObject({ debitos: 1, estornadas: 0 });
    const [er] = await escrever((e) =>
      e.consultar<Record<string, unknown>>(
        'SELECT motivo, valor, competencia, situacao, conta_hospitalar_id FROM estorno_repasse WHERE producao_repasse_id = ?',
        [p!['id']],
      ),
    );
    expect(er).toMatchObject({ motivo: 'ajuste', situacao: 'pendente' });
    expect(Number(er!['valor'])).toBe(350);
    expect(String(er!['competencia'] instanceof Date ? (er!['competencia'] as Date).toISOString() : er!['competencia'])).toMatch(
      /^2026-11-01/,
    );
    expect((await producoesDo(itemA))[0]!['situacao']).toBe('estornado');
    // Idempotente: o débito não se repete.
    expect((await sincronizar('mudanca-item', [itemA])).resultado).toMatchObject({ debitos: 0 });
  });
});
