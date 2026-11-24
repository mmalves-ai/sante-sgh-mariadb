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
import { lerApresentacao } from './apresentacao-propria.js';

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
    expect(a.regras[0]).toMatchObject({ id: regra, limiteGuiasLote: 50, ordenacaoGuias: 'data_atendimento' });
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
});
