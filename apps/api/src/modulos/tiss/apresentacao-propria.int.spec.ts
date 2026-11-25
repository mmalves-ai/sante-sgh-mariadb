// Contrato de efeito da regra de apresentação TISS por fonte pagadora (06-FAT linha 30) contra o MariaDB real. Massa
// SINTÉTICA com códigos "F377" (nenhum dado real): a regra gravada e alterada (versão +1), a regra repetida recusada,
// o item da regra (código apresentado) e a desativação que não apaga, o valor padrão validado no domínio TISS (valor
// fora do padrão recusado, nada gravado) e encerrado pela vigência; o valor padrão de todos os estabelecimentos só por
// quem edita o contrato em todos; a leitura devolve tudo. No fim, a massa e a trilha
// do estabelecimento sintético são apagadas. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoApresentacaoTiss } from './apresentacao.controller.js';
import type { ContaTiss } from '@sgh/contratos';
import { definirOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { apresentarLote, lerApresentacao, lerOpcoesApresentacao } from './apresentacao-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F377';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function codigoDoErro(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const p = (e as { problema?: { codigo?: string } }).problema;
    return String(p?.codigo ?? (e as { codigo?: string }).codigo ?? (e as Error).message);
  }
  throw new Error('a gravação devia ter sido recusada');
}

describe.skipIf(SEM_BANCO)('regra de apresentação TISS na fonte própria (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoApresentacaoTiss;
  const ids = { est: 0, fonte: 0, versaoTiss: 0, item: 0, grupo: 0 };
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: null,
    correlacao: 'teste-f377',
    chaveIdempotencia: `f377-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f377' }, fn);
  const ler = () =>
    nucleo.lerSomente({ cliente: CLIENTE, estabelecimento: ids.est, correlacao: 'teste-f377' }, (l) =>
      lerApresentacao(l, ids.est, ids.fonte),
    );

  const limpar = async (e: Escritor) => {
    await e.executar('DELETE FROM valor_padrao_campo_tiss WHERE fonte_pagadora_id = ?', [ids.fonte]);
    await e.executar(
      'DELETE FROM regra_apresentacao_tiss_item WHERE regra_apresentacao_tiss_id IN (SELECT id FROM regra_apresentacao_tiss WHERE estabelecimento_id = ?)',
      [ids.est],
    );
    await e.executar('DELETE FROM regra_apresentacao_tiss WHERE estabelecimento_id = ?', [ids.est]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      const classe = await garantir(
        e,
        'SELECT id FROM classe_fonte_pagadora WHERE codigo = ?',
        [`${P}-CONV`],
        "INSERT INTO classe_fonte_pagadora (codigo, descricao, natureza, criado_em) VALUES (?, 'CONVENIO F377', 'convenio', ?)",
        [`${P}-CONV`, agora],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-A`],
        `INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, classe_fonte_pagadora_id, dias_retorno, criado_em)
           VALUES (?, 'OPERADORA F377 SINTETICA', 'operadora', 'ativa', ?, 30, ?)`,
        [`${P}-A`, classe, agora],
      );
      // Catálogos já existentes no cliente de teste (só os ids; nenhum valor sai).
      ids.versaoTiss = await garantir(
        e,
        "SELECT id FROM versao_padrao_tiss WHERE codigo_tiss = '04.03.00' AND ativo = TRUE ORDER BY id LIMIT 1",
        [],
        `INSERT INTO versao_padrao_tiss (codigo_tiss, componente, descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('04.03.00', 'troca', 'VERSAO SINTETICA F377', '2020-01-01', 'teste', ?)`,
        [agora],
      );
      // Catálogo já existente no cliente de teste (só os ids; nenhum valor sai).
      const it = await e.uma<{ id: number; grupo_faturamento_id: number }>(
        'SELECT id, grupo_faturamento_id FROM item_faturavel WHERE excluido_em IS NULL ORDER BY id LIMIT 1',
      );
      ids.item = Number(it?.id);
      ids.grupo = Number(it?.grupo_faturamento_id);
      await limpar(e);
    });
    s = new ServicoApresentacaoTiss(nucleo);
  }, 60_000);

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  let regra = 0;

  it('grava a regra da fonte pagadora, recusa a repetida e altera com versão +1', async () => {
    const base = { fontePagadoraId: ids.fonte, tipoContaId: null, versaoPadraoTissId: ids.versaoTiss };
    const r = await s.gravar('regra', op(), { ...base, limiteGuiasLote: 100, omiteGuiaSemValor: true });
    regra = Number(r['id']);
    expect(await codigoDoErro(s.gravar('regra', op(), base))).toBe('regra-existente');
    const alt = await s.gravar('regra', op(), {
      ...base,
      id: regra,
      versao: 1,
      limiteGuiasLote: 50,
      ordenacaoGuias: 'data_atendimento',
    });
    expect(alt['versao']).toBe(2);
    const linha = await escrever((e) =>
      e.uma<Record<string, unknown>>(
        'SELECT limite_guias_lote, ordenacao_guias, omite_guia_sem_valor, versao FROM regra_apresentacao_tiss WHERE id = ?',
        [regra],
      ),
    );
    expect(linha).toMatchObject({ limite_guias_lote: 50, ordenacao_guias: 'data_atendimento', versao: 2 });
    expect(Number(linha?.['omite_guia_sem_valor'])).toBe(0);
  });

  it('item da regra: código apresentado gravado; desativar não apaga; item sem alvo recusado', async () => {
    expect(await codigoDoErro(s.gravar('regra-item', op(), { regraId: regra }))).toMatch(/entrada|invalida/);
    const it = await s.gravar('regra-item', op(), {
      regraId: regra,
      itemFaturavelId: ids.item,
      tipoGuia: 'sp_sadt',
      codigoApresentacao: '90000001',
      descricaoApresentacao: 'APRESENTADO F377',
    });
    const id = Number(it['id']);
    await s.gravar('regra-item.desativar', op(), { id, versao: 1 });
    const l = await escrever((e) =>
      e.uma<Record<string, unknown>>(
        'SELECT codigo_apresentacao, tipo_guia, ativo, versao FROM regra_apresentacao_tiss_item WHERE id = ?',
        [id],
      ),
    );
    expect(l).toMatchObject({ codigo_apresentacao: '90000001', tipo_guia: 'sp_sadt', versao: 2 });
    expect(Number(l?.['ativo'])).toBe(0);
  });

  it('valor padrão: fora do padrão TISS recusado sem gravar; válido gravado e encerrado pela vigência', async () => {
    const base = { fontePagadoraId: ids.fonte, regraId: regra, vigenciaInicio: '2026-01-01' };
    expect(
      await codigoDoErro(
        s.gravar('valor-padrao', op(), { ...base, campo: 'caraterAtendimento', valor: '7' }),
      ),
    ).toBe('entrada-invalida');
    expect(
      await escrever((e) =>
        e.uma<{ q: number }>(
          'SELECT COUNT(*) AS q FROM valor_padrao_campo_tiss WHERE fonte_pagadora_id = ?',
          [ids.fonte],
        ),
      ),
    ).toMatchObject({ q: 0 });
    const v = await s.gravar('valor-padrao', op(), {
      ...base,
      campo: 'tipoAtendimento',
      valor: '05',
      itemFaturavelId: ids.item,
      sobrepoe: true,
    });
    const id = Number(v['id']);
    expect(
      await codigoDoErro(
        s.gravar('valor-padrao.encerrar', op(), { id, versao: 1, vigenciaFim: '2025-12-31' }),
      ),
    ).toBe('vigencia-invalida');
    await s.gravar('valor-padrao.encerrar', op(), { id, versao: 1, vigenciaFim: '2026-12-31' });
    const l = await escrever((e) =>
      e.uma<Record<string, unknown>>(
        "SELECT campo_tiss, valor_padrao, estabelecimento_id, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, versao FROM valor_padrao_campo_tiss WHERE id = ?",
        [id],
      ),
    );
    expect(l).toMatchObject({
      campo_tiss: 'tipoAtendimento',
      valor_padrao: '05',
      fim: '2026-12-31',
      versao: 2,
    });
    expect(Number(l?.['estabelecimento_id'])).toBe(ids.est);
  });

  it('valor padrão de todos os estabelecimentos: quem não edita o contrato em todos não cria nem encerra', async () => {
    const base = {
      fontePagadoraId: ids.fonte,
      regraId: null,
      campo: 'caraterAtendimento',
      valor: '1',
      vigenciaInicio: '2026-01-01',
    };
    // O processo sem usuário (e o usuário de um estabelecimento só) não alcança os outros estabelecimentos.
    expect(
      await codigoDoErro(s.gravar('valor-padrao', op(), { ...base, estabelecimentoProprio: false })),
    ).toBe('padrao-global-sem-alcance');
    const global = await escrever((e) =>
      e.inserir(
        `INSERT INTO valor_padrao_campo_tiss (fonte_pagadora_id, estabelecimento_id, campo_tiss, valor_padrao,
           sobrepoe_informado, vigencia_inicio, ativo, criado_em) VALUES (?, NULL, 'caraterAtendimento', '1', FALSE, '2026-01-01', TRUE, ?)`,
        [ids.fonte, new Date()],
      ),
    );
    expect(
      await codigoDoErro(
        s.gravar('valor-padrao.encerrar', op(), { id: global, versao: 1, vigenciaFim: '2026-06-30' }),
      ),
    ).toBe('padrao-global-sem-alcance');
    const l = await escrever((e) =>
      e.uma<Record<string, unknown>>(
        'SELECT vigencia_fim, versao FROM valor_padrao_campo_tiss WHERE id = ?',
        [global],
      ),
    );
    expect(l).toMatchObject({ vigencia_fim: null, versao: 1 });
    await escrever((e) => e.executar('DELETE FROM valor_padrao_campo_tiss WHERE id = ?', [global]));
  });

  it('a leitura devolve a regra, o item desativado e o valor padrão com a vigência', async () => {
    const a = await ler();
    expect(a.regras).toHaveLength(1);
    expect(a.regras[0]).toMatchObject({
      id: regra,
      versaoPadraoTissId: ids.versaoTiss,
      limiteGuiasLote: 50,
      ordenacaoGuias: 'data_atendimento',
    });
    expect(a.itens).toHaveLength(1);
    expect(a.itens[0]).toMatchObject({ itemId: ids.item, ativo: false, codigoApresentacao: '90000001' });
    expect(a.padroes[0]).toMatchObject({
      campo: 'tipoAtendimento',
      valor: '05',
      sobrepoe: true,
      vigenciaFim: '2026-12-31',
    });
    // A trilha guarda cada gravação com a operação.
    const q = await escrever((e) =>
      e.uma<{ q: number }>(
        "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade IN ('regra_apresentacao_tiss','regra_apresentacao_tiss_item','valor_padrao_campo_tiss') AND estabelecimento_id = ?",
        [ids.est],
      ),
    );
    expect(Number(q?.q)).toBeGreaterThanOrEqual(5);
  });

  it('as opções da tela trazem a versão TISS e o grupo da massa, com código e descrição', async () => {
    const o = await nucleo.lerSomente(
      { cliente: CLIENTE, estabelecimento: ids.est, correlacao: 'teste-f377' },
      (l) => lerOpcoesApresentacao(l),
    );
    expect(o.versoesTiss.map((v) => v.id)).toContain(ids.versaoTiss);
    expect(o.grupos.map((g) => g.id)).toContain(ids.grupo);
    expect(o.tiposConta.length).toBeGreaterThan(0);
    for (const lista of Object.values(o)) for (const x of lista) expect(x.rotulo).toMatch(/^.+ — .+$/);
  });

  it('montador: a regra grava contratado por CNPJ, série e corte; o lote quebra o resumo, numera e guarda o próximo', async () => {
    const r0 = (await ler()).regras[0]!;
    const base = {
      fontePagadoraId: ids.fonte,
      tipoContaId: null,
      versaoPadraoTissId: ids.versaoTiss,
      id: regra,
    };
    // CPF com dígito errado e quebra por período sem os dias: recusados sem gravar.
    expect(
      await codigoDoErro(
        s.gravar('regra', op(), {
          ...base,
          versao: r0.versao,
          identificacaoContratado: 'cpf',
          documentoContratado: '12345678900',
        }),
      ),
    ).toBe('contratado-invalido');
    expect(
      await codigoDoErro(
        s.gravar('regra', op(), { ...base, versao: r0.versao, quebraResumoInternacao: 'por_periodo' }),
      ),
    ).toBe('corte-resumo-ausente');
    await s.gravar('regra', op(), {
      ...base,
      versao: r0.versao,
      identificacaoContratado: 'cnpj',
      documentoContratado: '11.222.333/0001-81',
      numeracaoGuia: 'hospital',
      prefixoNumeroGuia: 'H',
      larguraNumeroGuia: 6,
      proximoNumeroGuia: 41,
      quebraResumoInternacao: 'por_periodo',
      diasCorteResumo: 10,
    });
    const sel =
      'SELECT identificacao_contratado AS i, cnpj_contratado AS cnpj, cpf_contratado AS cpf, prefixo_numero_guia AS pre, largura_numero_guia AS lg, proximo_numero_guia AS prox, quebra_resumo_internacao AS q, dias_corte_resumo AS dias FROM regra_apresentacao_tiss WHERE id = ?';
    const gravada = await escrever((e) => e.uma<Record<string, unknown>>(sel, [regra]));
    expect({
      ...gravada,
      prox: Number(gravada?.['prox']),
      lg: Number(gravada?.['lg']),
      dias: Number(gravada?.['dias']),
    }).toEqual({
      i: 'cnpj',
      cnpj: '11222333000181',
      cpf: null,
      pre: 'H',
      lg: 6,
      prox: 41,
      q: 'por_periodo',
      dias: 10,
    });

    // Resumo de internação sintético de 01 a 25/10 com itens nos dias 1, 12 e 22: três partes de 10 dias.
    const item = (seq: number, data: string, valor: number) => ({
      sequencial: seq,
      tipo: 1,
      natureza: 'procedimento',
      data,
      codigo: '10101012',
      codigoTabela: '22',
      descricao: 'ITEM SINTETICO',
      quantidade: 1,
      valorUnitario: valor,
    });
    // A regra casa item a item com a conta do banco: usa uma conta da massa do cliente de teste só pelo id, com dois
    // lançamentos copiados do dela (apagados no fim; nenhum valor sai), para ter três itens a repartir.
    const base0 = await escrever((e) =>
      e.uma<{ id: number; conta: number }>(
        `SELECT ci.id, ci.conta_hospitalar_id AS conta FROM conta_hospitalar_item ci
           JOIN item_faturavel f ON f.id = ci.item_faturavel_id
          WHERE ci.excluido_em IS NULL AND ci.situacao NOT IN ('sem_cobranca','transferido','estornado')
          ORDER BY ci.id LIMIT 1`,
        [],
      ),
    );
    expect(base0).not.toBeNull();
    const copias = await escrever(async (e) => {
      await e.executar(
        'CREATE TEMPORARY TABLE copia_item_f377 AS SELECT * FROM conta_hospitalar_item WHERE id = ?',
        [base0?.id],
      );
      const ids2: number[] = [];
      for (const k of [1, 2]) {
        await e.executar('UPDATE copia_item_f377 SET id = 0, sequencia = sequencia + ?', [900 + k]);
        ids2.push(await e.inserir('INSERT INTO conta_hospitalar_item SELECT * FROM copia_item_f377', []));
      }
      await e.executar('DROP TEMPORARY TABLE copia_item_f377');
      return ids2;
    });
    const origem = { id: Number(base0?.conta), q: 3 };
    const dias = ['2026-10-01', '2026-10-12', '2026-10-22'];
    const itens = Array.from({ length: Number(origem?.q) }, (_, k) =>
      item(k + 1, dias[Math.min(k, 2)]!, 100 + k * 10.5),
    );
    const esperado = itens.reduce((t, i) => t + Math.round(i.valorUnitario * 100), 0);
    const conta = {
      conta: 0,
      tipoGuia: 3,
      numeroGuia: `${P}-C1`,
      carteira: '000000000000001',
      atendimentoRN: false,
      inicio: { data: '2026-10-01', hora: '08:00:00' },
      fim: { data: '2026-10-25', hora: '10:00:00' },
      tipoFaturamento: '4',
      itens,
    } as unknown as ContaTiss;
    const opLote = definirOperacao({
      nome: 'teste.apresentar-lote-montador',
      tabelas: ['regra_apresentacao_tiss'],
      entrada: z.object({}),
      async gravar(tx) {
        const ap = await apresentarLote(
          tx,
          ids.est,
          ids.fonte,
          3,
          [
            {
              linha: { id: Number(origem?.id), numero: `${P}-C1`, tipo_conta_id: null },
              conta,
              informados: new Set(),
            },
          ],
          '2026-10-26',
        );
        // O resultado da operação é plano: as listas vão em JSON.
        return {
          resultado: JSON.stringify({
            numeros: ap.montadas.map((m) => m.numeroGuia),
            faturamento: ap.montadas.map((m) => m.tipoFaturamento),
            totais: ap.montadas.map((m) =>
              m.itens.reduce((t, i) => t + Math.round(i.quantidade * i.valorUnitario * 100), 0),
            ),
            identificacao: ap.identificacao,
          }),
        };
      },
      alvo: () => ({ tabela: 'regra_apresentacao_tiss', id: regra }),
    });
    const exec = await nucleo.criarExecutor({}).executar(opLote, CLIENTE, {}, op());
    const r = JSON.parse(String(exec.resultado['resultado'])) as Record<string, unknown>;

    expect(r['numeros']).toEqual(['H000041', 'H000042', 'H000043']);
    expect(r['faturamento']).toEqual(['1', '1', '2']);
    expect((r['totais'] as number[]).reduce((a, b) => a + b, 0)).toBe(esperado);
    expect(r['identificacao']).toEqual({ tipo: 'cnpj', valor: '11222333000181' });
    const depois = await escrever((e) => e.uma<Record<string, unknown>>(sel, [regra]));
    expect(Number(depois?.['prox'])).toBe(44);
    await escrever((e) => e.executar('DELETE FROM conta_hospitalar_item WHERE id IN (?, ?)', copias));
  });
});
