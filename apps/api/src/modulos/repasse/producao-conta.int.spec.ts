// Integração da produção do repasse a partir da conta (F3, motores) contra o MariaDB real. Massa SINTÉTICA com o
// prefixo "F3RPC" (nenhuma pessoa real), num estabelecimento próprio. Contrato de efeito de
// repasse.sincronizar-producao-conta (o que deixa no banco):
//   1. item lançado com executor → producao_repasse 'pendente' com a base, a função titular e a prévia pela regra
//      vigente na data do item (a mais nova já vigente vence a antiga); idempotente (sincronizar de novo não duplica);
//   2. momento "fechamento" (parâmetro): o lançamento não gera; o fechamento gera;
//   3. item estornado antes da apuração → produção 'estornado', fora da produção do período;
//   4. glosa parcial antes da apuração → base reduzida pela parte glosada;
//   5. apuração do período: a soma do motor sobre a produção bate com as parcelas e o teste dourado da produção é 100%;
//   6. item estornado depois da apuração aprovada → estorno_repasse 'pendente' do repassado no primeiro período aberto,
//      descontado pela apuração desse período (valor_descontos, valor_liquido; estorno 'aplicado'), idempotente no
//      recálculo;
//   7. participante pago fora do hospital → produção estornada; de volta → reativada; removido → a do executor nasce;
//   8. glosa revertida: antes da apuração a base volta à original; depois, o débito pendente é cancelado; a glosa de
//      conta de competência antiga com o período seguinte já conferido cai no primeiro período aberto;
//   9. duas sincronizações da mesma conta ao mesmo tempo não duplicam a produção (a conta é travada);
//  10. glosa depois da apuração pela função comum à TISS e ao worker (sincronizarGlosaDoItem, com o autor da decisão): o item
//      guarda a soma das glosas aceitas (duas glosas somam; recorrer uma não zera a outra), a produção é estornada e o
//      débito cai no período aberto; a apuração desconta só até o bruto do profissional e leva o saldo ao período
//      seguinte (ligado ao de origem; o recálculo o refaz); o ServicoRepasse.lancarApuracao lança o bruto e o estorno
//      ligado (idempotente); o débito criado depois do cálculo de um período conferido sem recálculo é descontado no
//      período seguinte; a glosa revertida depois do desconto devolve o descontado como crédito, sem repetir.
// No fim, a massa de negócio é apagada. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  calcularPeriodo,
  compararDourado,
  competenciaDoDebito,
  sincronizarGlosaDoItem,
  somarProducao,
} from '@sgh/dominio-repasse';
import { type ContextoNucleo, definirOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { portaProducaoConta, TABELAS_PRODUCAO_CONTA } from '@sgh/persistencia';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { civil, FUSO_PADRAO } from '../exames/relogio.js';
import { PortaRepassePropria } from './porta-propria.js';
import { sincronizarProducaoConta } from './producao-conta.js';
import { ServicoRepasse } from './servico.js';

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
    auxiliar: 0,
  };
  let seq = 0;
  let sequenciaItem = 0;

  const limpar = (e: Escritor) =>
    (async () => {
      const est = ids.est;
      await e.executar(
        'UPDATE lancamento_repasse SET estornado_lancamento_repasse_id = NULL WHERE estabelecimento_id = ? AND tipo_lancamento <> ?',
        [est, 'estorno'],
      );
      await e.executar(
        "DELETE FROM lancamento_repasse WHERE estabelecimento_id = ? AND tipo_lancamento = 'estorno'",
        [est],
      );
      await e.executar('DELETE FROM lancamento_repasse WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM favorecido_repasse WHERE estabelecimento_id = ?', [est]);
      await e.executar(
        'UPDATE estorno_repasse SET origem_estorno_repasse_id = NULL WHERE estabelecimento_id = ?',
        [est],
      );
      await e.executar('DELETE FROM estorno_repasse WHERE estabelecimento_id = ?', [est]);
      await e.executar(
        'DELETE gi FROM glosa_item gi JOIN glosa g ON g.id = gi.glosa_id WHERE g.estabelecimento_id = ?',
        [est],
      );
      await e.executar('DELETE FROM glosa WHERE estabelecimento_id = ?', [est]);
      await e.executar(
        'DELETE x FROM apuracao_repasse_item x JOIN apuracao_repasse a ON a.id = x.apuracao_repasse_id WHERE a.estabelecimento_id = ?',
        [est],
      );
      await e.executar('DELETE FROM producao_repasse WHERE estabelecimento_id = ?', [est]);
      await e.executar(
        `DELETE p FROM conta_hospitalar_item_participante p JOIN conta_hospitalar_item i ON i.id = p.conta_hospitalar_item_id
           JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id = ?`,
        [est],
      );
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
      await e.executar(
        "DELETE FROM parametro_valor WHERE nivel = 'estabelecimento' AND estabelecimento_id = ?",
        [est],
      );
    })();

  const sincronizar = (evento: 'lancamento' | 'fechamento' | 'mudanca-item', itens?: number[]) =>
    nucleo
      .criarExecutor()
      .executar(
        sincronizarProducaoConta,
        CLIENTE,
        { conta: ids.conta, evento, ...(itens ? { itens } : {}) },
        { ...ctx, chaveIdempotencia: `${P}-${Date.now()}-${++seq}` },
      );

  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: P }, fn);

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
      await e.executar(
        "DELETE FROM parametro_valor WHERE nivel = 'estabelecimento' AND estabelecimento_id = ?",
        [ids.est],
      );
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
          `INSERT INTO ${tabela} (codigo, ${Object.keys(colunas).join(', ')}, criado_em) VALUES (?, ${Object.keys(
            colunas,
          )
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
      ids.auxiliar = await porCodigo('funcao_equipe_cobranca', `${P}-AUX`, {
        descricao: 'AUXILIAR F3RPC',
        tipo_funcao: 'auxiliar',
        ordem_auxiliar: 1,
        ordem_apresentacao: 90,
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
      const tipoConta = await porCodigo('tipo_conta', `${P}-EXT`, {
        descricao: 'EXTERNA F3RPC',
        natureza: 'externa',
      });
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
  const hoje = civil(new Date(), FUSO_PADRAO).data.slice(0, 7);
  const comp = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 7);
  const debitosDe = (producao: unknown) =>
    escrever((e) =>
      e.consultar<Record<string, unknown>>(
        `SELECT id, motivo, valor, competencia, situacao, apuracao_repasse_id, aplicado_em FROM estorno_repasse
          WHERE producao_repasse_id = ? ORDER BY id`,
        [producao],
      ),
    );
  const trilha = {
    estabelecimento: 0,
    usuario: 0,
    acao: 'inclusao' as const,
    entidade: 'apuracao_repasse',
    entidadeId: null,
    dadosDepois: { teste: P },
    correlacao: P,
  };
  /** A apuração do período com uma memória do profissional (bruto `valor`) sobre a produção `producao`. */
  const apurar = (competencia: string, valor: number, producao: number) =>
    porta.gravarSgh({ ...ctx }, { ...trilha, estabelecimento: ids.est, usuario: ids.usuario }, (g) =>
      g.gravarApuracao({
        empresa: ids.est,
        competencia,
        apuradoPor: 'f3rpc.faturista',
        simulacao: false,
        totais: { itens: 1, comRepasse: 1, pendentes: 0, pendencias: '{}', base: valor, valor },
        memorias: [
          {
            item: producao,
            prestador: ids.profissional,
            regra: null,
            dimensoes: '',
            ignoradas: '',
            base: null,
            baseValor: valor,
            percentual: 0,
            valorFixo: 0,
            valorSemAdicional: valor,
            adicional: null,
            valor,
            pendencia: null,
          },
        ],
      }),
    );
  /** Uma produção do profissional para a memória da apuração (fixture). */
  const producaoDaMemoria = async (quando: string) => {
    const item = await novoItem(10, quando);
    await sincronizar('lancamento', [item]);
    return Number((await producoesDo(item))[0]!['id']);
  };
  const apuracaoDe = (id: number) =>
    escrever((e) =>
      e.uma<Record<string, unknown>>(
        'SELECT valor_bruto, valor_descontos, valor_liquido, situacao FROM apuracao_repasse WHERE id = ?',
        [id],
      ),
    );
  let competencia6 = '';
  let apuracaoAprovada = 0;

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
    expect([Number(pb!['valor_base']), Number(pb!['percentual']), Number(pb!['valor_repasse'])]).toEqual([
      200, 50, 100,
    ]);
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
    await escrever((e) =>
      e.executar("UPDATE conta_hospitalar_item SET situacao = 'estornado' WHERE id = ?", [itemD]),
    );
    expect((await sincronizar('mudanca-item', [itemD])).resultado).toMatchObject({
      estornadas: 1,
      debitos: 0,
    });
    const [p] = await producoesDo(itemD);
    expect(p!['situacao']).toBe('estornado');
    const { itens } = await porta.producao(ctx, COMP, 0);
    expect(itens.some((i) => i.id === Number(p!['id']))).toBe(false);
    expect((await sincronizar('mudanca-item', [itemD])).resultado).toMatchObject({ estornadas: 0 });
  });

  it('4. glosa parcial antes da apuração: a base fica com a parte não glosada', async () => {
    await escrever((e) =>
      e.executar(
        "UPDATE conta_hospitalar_item SET valor_glosado = 250, situacao = 'conferido' WHERE id = ?",
        [itemC],
      ),
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
      memorias.map((m) => ({
        baseCentavos: m.baseCentavos,
        repasseCentavos: m.valorCentavos,
        situacao: 'pendente',
      })),
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
    expect((await sincronizar('mudanca-item', [itemA])).resultado).toMatchObject({
      debitos: 1,
      estornadas: 0,
    });
    const [er] = await escrever((e) =>
      e.consultar<Record<string, unknown>>(
        'SELECT motivo, valor, competencia, situacao, conta_hospitalar_id FROM estorno_repasse WHERE producao_repasse_id = ?',
        [p!['id']],
      ),
    );
    expect(er).toMatchObject({ motivo: 'ajuste', situacao: 'pendente' });
    expect(Number(er!['valor'])).toBe(350);
    // O primeiro período aberto a partir do seguinte ao da conta (2026-11) e do mês de hoje.
    competencia6 = competenciaDoDebito(COMP, hoje, new Set());
    expect(comp(er!['competencia'])).toBe(competencia6);
    expect((await producoesDo(itemA))[0]!['situacao']).toBe('estornado');
    // Idempotente: o débito não se repete.
    expect((await sincronizar('mudanca-item', [itemA])).resultado).toMatchObject({ debitos: 0 });
    // A apuração do período do débito o desconta: líquido = repasse 700 − débito 350; o débito passa a 'aplicado'.
    const memoria6 = await producaoDaMemoria('2026-10-20T13:00:00Z');
    const { apuracao } = await apurar(competencia6, 700, memoria6);
    expect(await apuracaoDe(apuracao)).toMatchObject({ situacao: 'apurada' });
    const ap = (await apuracaoDe(apuracao))!;
    expect([Number(ap['valor_bruto']), Number(ap['valor_descontos']), Number(ap['valor_liquido'])]).toEqual([
      700, 350, 350,
    ]);
    const [aplicado] = await debitosDe(p!['id']);
    expect(aplicado).toMatchObject({ situacao: 'aplicado' });
    expect(Number(aplicado!['apuracao_repasse_id'])).toBe(apuracao);
    expect(aplicado!['aplicado_em']).not.toBeNull();
    // O recálculo do período desconta o mesmo débito uma vez só.
    const de2 = await apurar(competencia6, 700, memoria6);
    expect(de2).toMatchObject({ apuracao, recalculada: true });
    expect(Number((await apuracaoDe(apuracao))!['valor_descontos'])).toBe(350);
    expect(Number((await apuracaoDe(apuracao))!['valor_liquido'])).toBe(350);
    apuracaoAprovada = Number(
      (await escrever((e) =>
        e.uma<{ id: number }>('SELECT id FROM apuracao_repasse WHERE numero = ?', [`${P}-AR1`]),
      ))!.id,
    );
  });

  it('7. participante pago fora do hospital: estorna; de volta: reativa; removido: nasce a do executor', async () => {
    const itemE = await novoItem(400, '2026-10-22T13:00:00Z');
    const participante = await escrever((e) =>
      e.inserir(
        `INSERT INTO conta_hospitalar_item_participante (conta_hospitalar_item_id, sequencia, profissional_id,
           funcao_equipe_cobranca_id, forma_pagamento, valor_ato, criado_em) VALUES (?, 1, ?, ?, 'via_hospital', 120, ?)`,
        [itemE, ids.profissional, ids.auxiliar, new Date()],
      ),
    );
    expect((await sincronizar('lancamento', [itemE])).resultado).toMatchObject({ geradas: 1 });
    const [pp] = await producoesDo(itemE);
    expect(Number(pp!['funcao_equipe_cobranca_id'])).toBe(ids.auxiliar);
    expect(Number(pp!['valor_base'])).toBe(120);
    const forma = (f: string) =>
      escrever((e) =>
        e.executar('UPDATE conta_hospitalar_item_participante SET forma_pagamento = ? WHERE id = ?', [
          f,
          participante,
        ]),
      );
    await forma('direto_fonte_pagadora');
    expect((await sincronizar('mudanca-item', [itemE])).resultado).toMatchObject({
      estornadas: 1,
      geradas: 0,
    });
    expect((await producoesDo(itemE))[0]!['situacao']).toBe('estornado');
    expect((await sincronizar('mudanca-item', [itemE])).resultado).toMatchObject({
      estornadas: 0,
      reduzidas: 0,
    });
    await forma('via_hospital');
    expect((await sincronizar('mudanca-item', [itemE])).resultado).toMatchObject({
      reduzidas: 1,
      geradas: 0,
    });
    expect((await producoesDo(itemE))[0]).toMatchObject({ situacao: 'pendente' });
    await escrever((e) =>
      e.executar('UPDATE conta_hospitalar_item_participante SET excluido_em = ? WHERE id = ?', [
        new Date(),
        participante,
      ]),
    );
    expect((await sincronizar('mudanca-item', [itemE])).resultado).toMatchObject({
      estornadas: 1,
      geradas: 1,
    });
    const depois = await producoesDo(itemE);
    expect(
      depois.map((x) => [x['situacao'], Number(x['funcao_equipe_cobranca_id']), Number(x['valor_base'])]),
    ).toEqual([
      ['estornado', ids.auxiliar, 120],
      ['pendente', ids.titular, 400],
    ]);
  });

  it('8. glosa revertida: base de volta antes da apuração; débito pendente cancelado depois; competência aberta', async () => {
    // Antes da apuração: C tinha 250 glosados (base 750); o recurso aceito devolve a base de 1.000.
    await escrever((e) =>
      e.executar('UPDATE conta_hospitalar_item SET valor_glosado = 0 WHERE id = ?', [itemC]),
    );
    expect((await sincronizar('mudanca-item', [itemC])).resultado).toMatchObject({ reduzidas: 1 });
    expect(Number((await producoesDo(itemC))[0]!['valor_base'])).toBe(1000);
    // Depois da apuração: B (repasse 100) entra na apuração aprovada de 2026-10; o período do débito do teste 6 é
    // conferido, e a glosa de 150 dos 300 de B cai no primeiro período aberto depois dele.
    const [pb] = await producoesDo(itemB);
    await escrever(async (e) => {
      await e.inserir(
        `INSERT INTO apuracao_repasse_item (apuracao_repasse_id, sequencia, profissional_id, producao_repasse_id, competencia_producao,
           valor_faturado, percentual_repasse, valor_repasse, criado_em) VALUES (?, 2, ?, ?, ?, 200, 50, 100, ?)`,
        [apuracaoAprovada, ids.profissional, pb!['id'], `${COMP}-01`, new Date()],
      );
      await e.executar(
        "UPDATE apuracao_repasse SET situacao = 'aprovada' WHERE estabelecimento_id = ? AND competencia = ?",
        [ids.est, `${competencia6}-01`],
      );
      await e.executar('UPDATE conta_hospitalar_item SET valor_glosado = 150 WHERE id = ?', [itemB]);
    });
    expect((await sincronizar('mudanca-item', [itemB])).resultado).toMatchObject({ debitos: 1 });
    const [d1] = await debitosDe(pb!['id']);
    expect(d1).toMatchObject({ situacao: 'pendente' });
    expect(Number(d1!['valor'])).toBe(50);
    const esperada = competenciaDoDebito(COMP, hoje, new Set([competencia6]));
    expect(esperada > competencia6).toBe(true);
    expect(comp(d1!['competencia'])).toBe(esperada);
    // O recurso aceito: a glosa volta a 0 e o débito pendente é cancelado (nada se desconta do médico).
    await escrever((e) =>
      e.executar('UPDATE conta_hospitalar_item SET valor_glosado = 0 WHERE id = ?', [itemB]),
    );
    expect((await sincronizar('mudanca-item', [itemB])).resultado).toMatchObject({ creditos: 1, debitos: 0 });
    expect((await debitosDe(pb!['id'])).map((x) => x['situacao'])).toEqual(['cancelado']);
    expect((await sincronizar('mudanca-item', [itemB])).resultado).toMatchObject({ creditos: 0, debitos: 0 });
  });

  it('9. duas sincronizações da mesma conta ao mesmo tempo não duplicam a produção', async () => {
    const itemF = await novoItem(60, '2026-10-23T13:00:00Z');
    await Promise.all([sincronizar('lancamento', [itemF]), sincronizar('lancamento', [itemF])]);
    expect(await producoesDo(itemF)).toHaveLength(1);
  });
  it('10. glosa depois da apuração (TISS/worker): débito até o bruto, saldo adiante, lançamento pelo serviço, crédito', async () => {
    const agora = new Date();
    const um = <T>(sql: string, p: unknown[]) =>
      escrever((e) => e.uma<Record<string, unknown>>(sql, p)) as Promise<T>;
    const motivo = await escrever((e) =>
      garantir(
        e,
        'SELECT id FROM motivo_glosa WHERE codigo_tuss = ?',
        ['F3RP'],
        "INSERT INTO motivo_glosa (codigo_tuss, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES ('F3RP', 'MOTIVO SINTETICO F3RPC', '2026-01-01', 'teste', ?)",
        [agora],
      ),
    );
    let numeroGlosa = 0;
    /** Uma glosa do item já decidida (o efeito da decisão da TISS no glosa_item; o autor é o usuário do fixture). */
    const glosaDecidida = (item: number, valor: number, decisao: 'aceitar' | 'recorrer') =>
      escrever(async (e) => {
        const g = await e.inserir(
          `INSERT INTO glosa (estabelecimento_id, numero, fonte_pagadora_id, procedencia, data_glosa, valor_glosado,
             conta_hospitalar_id, criado_em) VALUES (?, ?, ?, 'digitacao', '2026-11-05', ?, ?, ?)`,
          [ids.est, `${P}-GL${++numeroGlosa}`, ids.fonte, valor, ids.conta, agora],
        );
        return e.inserir(
          `INSERT INTO glosa_item (glosa_id, sequencia, motivo_glosa_id, valor_glosado, conta_hospitalar_item_id, decisao,
             valor_aceito, decidido_por_usuario_id, decidido_em, criado_em) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [g, motivo, valor, item, decisao, decisao === 'aceitar' ? valor : 0, ids.usuario, agora, agora],
        );
      });
    const recorrer = (glosaItem: number) =>
      escrever((e) =>
        e.executar("UPDATE glosa_item SET decisao = 'recorrer', valor_aceito = 0 WHERE id = ?", [glosaItem]),
      );
    // A glosa do item pela função comum à decisão da TISS e ao evento do financeiro no worker
    // (sincronizarGlosaDoItem: soma das glosas aceitas no item + sincronização da produção), com o autor da decisão
    // (o worker não traz usuário; usa quem decidiu a glosa). O app do worker não é importável daqui (fronteira).
    const opGlosa = (item: number) =>
      definirOperacao({
        nome: 'financeiro.glosa.aceita-do-evento',
        tabelas: ['glosa_titulo_receber', 'titulo_receber', ...TABELAS_PRODUCAO_CONTA],
        entrada: z.object({}).passthrough(),
        gravar: async (tx) => {
          const r = await sincronizarGlosaDoItem(
            portaProducaoConta(tx, { estabelecimento: ids.est, usuario: ids.usuario }),
            { conta: ids.conta, item },
          );
          return { glosado: r.glosado, debitos: r.debitos };
        },
        alvo: () => ({ tabela: 'conta_hospitalar_item', id: item }),
      });
    const worker = async (item: number) =>
      (
        await nucleo.criarExecutor().executar(
          opGlosa(item),
          CLIENTE,
          {},
          {
            cliente: CLIENTE,
            estabelecimento: ids.est,
            usuario: ids.usuario,
            correlacao: P,
            chaveIdempotencia: `${P}-w-${randomUUID()}`,
          },
        )
      ).resultado;
    const glosadoDe = async (item: number) =>
      Number(
        (
          await um<Record<string, unknown>>('SELECT valor_glosado FROM conta_hospitalar_item WHERE id = ?', [
            item,
          ])
        )['valor_glosado'],
      );
    const integrar = (producao: unknown, seqItem: number, base: number, repasse: number) =>
      escrever((e) =>
        e.inserir(
          `INSERT INTO apuracao_repasse_item (apuracao_repasse_id, sequencia, profissional_id, producao_repasse_id, competencia_producao,
             valor_faturado, percentual_repasse, valor_repasse, criado_em) VALUES (?, ?, ?, ?, ?, ?, 40, ?, ?)`,
          [apuracaoAprovada, seqItem, ids.profissional, producao, `${COMP}-01`, base, repasse, new Date()],
        ),
      );
    const seguinte = (c: string) => {
      const [a, m] = c.split('-').map(Number) as [number, number];
      return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
    };

    // G (base 1.000) entra na apuração aprovada de 2026-10 com repasse de 400. Duas glosas aceitas no mesmo item
    // (600 + 400): o item guarda a soma, a produção já repassada é estornada e o débito de 400 cai no período aberto.
    const itemG = await novoItem(1000, '2026-10-24T13:00:00Z');
    await sincronizar('lancamento', [itemG]);
    const [pg] = await producoesDo(itemG);
    await integrar(pg!['id'], 3, 1000, 400);
    const g1 = await glosaDecidida(itemG, 600, 'aceitar');
    const g2 = await glosaDecidida(itemG, 400, 'aceitar');
    expect(await worker(itemG)).toMatchObject({ glosado: 1000, debitos: 1 });
    expect(await glosadoDe(itemG)).toBe(1000);
    expect((await producoesDo(itemG))[0]!['situacao']).toBe('estornado');
    const [dg] = await debitosDe(pg!['id']);
    expect(dg).toMatchObject({ situacao: 'pendente' });
    expect(Number(dg!['valor'])).toBe(400);
    const periodo = comp(dg!['competencia']);
    // A entrega repetida do evento não duplica o débito.
    await worker(itemG);
    expect(await debitosDe(pg!['id'])).toHaveLength(1);

    // A apuração do período: o profissional tem bruto de 300; desconta 300 e leva 100 ao período seguinte.
    const memoria10 = await producaoDaMemoria('2026-10-25T13:00:00Z');
    const { apuracao } = await apurar(periodo, 300, memoria10);
    const ap = (await apuracaoDe(apuracao))!;
    expect([Number(ap['valor_bruto']), Number(ap['valor_descontos']), Number(ap['valor_liquido'])]).toEqual([
      300, 300, 0,
    ]);
    const levados = await debitosDe(pg!['id']);
    expect(levados.map((x) => [x['situacao'], Number(x['valor'])])).toEqual([
      ['aplicado', 400],
      ['pendente', 100],
    ]);
    expect(comp(levados[1]!['competencia'])).toBe(seguinte(periodo));
    expect(
      Number(
        (
          await um<Record<string, unknown>>(
            'SELECT origem_estorno_repasse_id AS o FROM estorno_repasse WHERE id = ?',
            [levados[1]!['id']],
          )
        )['o'],
      ),
    ).toBe(Number(dg!['id']));
    // O recálculo refaz o saldo levado (o anterior fica cancelado no histórico) e desconta o mesmo valor.
    await apurar(periodo, 300, memoria10);
    expect(Number((await apuracaoDe(apuracao))!['valor_descontos'])).toBe(300);
    expect((await debitosDe(pg!['id'])).map((x) => x['situacao'])).toEqual([
      'aplicado',
      'cancelado',
      'pendente',
    ]);
    expect((await porta.debitosDaApuracao({ ...ctx }, apuracao)).get(ids.profissional)).toBe(300);

    // O lançamento pelo serviço de verdade: o bruto e o estorno ligado a ele (o RPA soma: 300 − 300). Idempotente.
    const evento = await escrever(async (e) => {
      await e.executar("UPDATE apuracao_repasse SET situacao = 'aprovada' WHERE id = ?", [apuracao]);
      await garantir(
        e,
        'SELECT id FROM favorecido_repasse WHERE estabelecimento_id = ? AND profissional_id = ?',
        [ids.est, ids.profissional],
        "INSERT INTO favorecido_repasse (estabelecimento_id, profissional_id, tipo_favorecido, vigencia_inicio, criado_em) VALUES (?, ?, 'proprio_profissional', '2026-01-01', ?)",
        [ids.est, ids.profissional, agora],
      );
      return Number(
        (await e.uma<Record<string, unknown>>(
          'SELECT id FROM evento_repasse WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, `${P}-HON`],
        ))!['id'],
      );
    });
    const servico = new ServicoRepasse(porta, new RegistradorTrilhaMemoria(), null, null);
    // A liberação da funcionalidade é da configuração do estabelecimento (fora deste contrato).
    (servico as unknown as { apoio: { exigirLiberacao: () => Promise<void> } }).apoio.exigirLiberacao =
      async () => undefined;
    const sessao = () =>
      ({
        req: { headers: { 'idempotency-key': `${P}-${randomUUID()}` } },
        hospital: 'f3rpc',
        rede: '',
        login: 'f3rpc.faturista',
        porta: { ...ctx },
        pode: () => true,
      }) as unknown as SessaoCadastro;
    const lancados = () =>
      escrever((e) =>
        e.consultar<Record<string, unknown>>(
          `SELECT l.tipo_lancamento, l.valor, l.estornado_lancamento_repasse_id FROM lancamento_repasse l
            WHERE l.apuracao_repasse_id = ? OR l.estornado_lancamento_repasse_id IN
              (SELECT x.id FROM lancamento_repasse x WHERE x.apuracao_repasse_id = ?) ORDER BY l.id`,
          [apuracao, apuracao],
        ),
      );
    await servico.lancarApuracao(sessao(), apuracao, evento);
    const ls = await lancados();
    expect(ls.map((l) => [l['tipo_lancamento'], Number(l['valor'])])).toEqual([
      ['apuracao', 300],
      ['estorno', -300],
    ]);
    expect(ls[1]!['estornado_lancamento_repasse_id']).not.toBeNull();
    await servico.lancarApuracao(sessao(), apuracao, evento);
    expect(await lancados()).toHaveLength(2);

    // O período seguinte desconta o saldo levado (100).
    const proximo = seguinte(periodo);
    const memoria11 = await producaoDaMemoria('2026-10-26T13:00:00Z');
    const a11 = (await apurar(proximo, 1000, memoria11)).apuracao;
    expect(Number((await apuracaoDe(a11))!['valor_descontos'])).toBe(100);
    // Um débito criado depois do cálculo (H, glosa total aceita) cai no período ainda apurado; o período é conferido
    // sem recálculo, e o débito é descontado no período seguinte (não fica preso).
    const itemH = await novoItem(500, '2026-10-27T13:00:00Z');
    await sincronizar('lancamento', [itemH]);
    const [ph] = await producoesDo(itemH);
    await integrar(ph!['id'], 4, 500, 200);
    await glosaDecidida(itemH, 500, 'aceitar');
    await worker(itemH);
    const [dh] = await debitosDe(ph!['id']);
    expect(dh).toMatchObject({ situacao: 'pendente' });
    expect(comp(dh!['competencia'])).toBe(proximo);
    // Conferida no domínio é 'em_auditoria' no banco (porta-propria do repasse, SITUACAO_BANCO).
    await escrever((e) =>
      e.executar("UPDATE apuracao_repasse SET situacao = 'em_auditoria' WHERE id = ?", [a11]),
    );
    const memoria12 = await producaoDaMemoria('2026-10-28T13:00:00Z');
    const a12 = (await apurar(seguinte(proximo), 1000, memoria12)).apuracao;
    expect(Number((await apuracaoDe(a12))!['valor_descontos'])).toBe(200);
    expect((await debitosDe(ph!['id']))[0]).toMatchObject({ situacao: 'aplicado' });
    expect(Number((await debitosDe(ph!['id']))[0]!['apuracao_repasse_id'])).toBe(a12);

    // Recorre a segunda glosa: o item fica com a primeira aceita (600), não volta a 0.
    await recorrer(g2);
    await worker(itemG);
    expect(await glosadoDe(itemG)).toBe(600);
    // Recorre também a primeira: glosa 0; os 400 já descontados (300 + 100 em apurações conferidas) voltam como
    // crédito ao profissional. Repetir não lança de novo.
    await recorrer(g1);
    await worker(itemG);
    expect(await glosadoDe(itemG)).toBe(0);
    const creditos = await escrever((e) =>
      e.consultar<Record<string, unknown>>(
        "SELECT tipo_lancamento, valor FROM lancamento_repasse WHERE producao_repasse_id = ? AND tipo_lancamento = 'ajuste'",
        [pg!['id']],
      ),
    );
    expect(creditos.reduce((t, c) => t + Math.round(Number(c['valor']) * 100), 0)).toBe(40000);
    await worker(itemG);
    expect(
      await escrever((e) =>
        e.consultar('SELECT id FROM lancamento_repasse WHERE producao_repasse_id = ?', [pg!['id']]),
      ),
    ).toHaveLength(creditos.length);
  });
});
