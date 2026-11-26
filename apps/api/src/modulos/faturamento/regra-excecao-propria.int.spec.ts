// Contrato de efeito das exceções da regra de lançamento automático (C1-090, 06-FAT linha 16) contra o MariaDB real.
// Massa SINTÉTICA com códigos "F909" (nenhuma pessoa real): a exceção para todos os estabelecimentos sem recorte e o plano de outra fonte são recusados
// sem gravar; a exceção incluída fica em regra_lancamento_excecao com o estabelecimento da sessão, a autoria, as
// naturezas, a vigência e o motivo, e aparece na lista da regra como vigente; o encerramento grava vigencia_fim = ontem
// (a linha continua no banco, com a versão nova) e não se repete; a exceção que começa hoje não se encerra. No fim, a
// a exceção de todos os estabelecimentos pede a permissão própria; a que começa hoje ou depois se cancela (quem,
// quando, por quê) e a apuração a ignora; a 'aplicar_somente' de um estabelecimento não entra na apuração do outro. No
// fim, a massa é apagada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { diaAnterior } from '@sgh/dominio-faturamento';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { excecoesDaApuracao } from './conta-entrada.js';
import { ServicoExcecaoRegra } from './regra-excecao.controller.js';
import { excecoesRegraLancamentoPropria } from './regra-excecao-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F909';
const p2 = (x: number) => String(x).padStart(2, '0');
const d = new Date();
const HOJE = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const TODAS = { internacao: true, ambulatorial: true, externo: true, urgencia: false, domiciliar: false };

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function codigoDo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema['codigo'] ?? e.problema.type ?? '');
    throw e;
  }
  throw new Error('esperava recusa');
}

describe.skipIf(SEM_BANCO)('exceções da regra de lançamento automático (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoExcecaoRegra;
  const ids: Record<string, number> = {};
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids['est'] as number,
    usuario: ids['usuario'] as number,
    correlacao: 'teste-f909',
    chaveIdempotencia: `f909-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f909' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));
  const limpar = async (e: Escritor) => {
    if (ids['regra'])
      await e.executar('DELETE FROM regra_lancamento_excecao WHERE regra_lancamento_id = ?', [ids['regra']]);
  };
  const base = () => ({
    regraLancamentoId: ids['regra'],
    fontePagadoraId: ids['fonte'],
    planoId: null,
    setorId: null,
    especialidadeId: null,
    itemId: null,
    grupoId: null,
    efeito: 'nao_aplicar',
    aplica: TODAS,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    motivo: 'Contrato sem a taxa de abertura',
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      ids['est'] = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids['estB'] = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}B`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}B`, `ESTAB ${P}B SINTETICO`, `ESTAB ${P}B SINTETICO`, agora],
      );
      ids['usuario'] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f909.sintetico'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f909.sintetico', `USUARIO SINTETICO ${P}`, agora],
      );
      const fonte = (c: string) =>
        garantir(
          e,
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [c],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
          [c, `OPERADORA SINTETICA ${c}`, agora],
        );
      ids['fonte'] = await fonte(`${P}FP`);
      ids['outraFonte'] = await fonte(`${P}FQ`);
      ids['planoOutra'] = await garantir(
        e,
        'SELECT id FROM plano_fonte_pagadora WHERE codigo = ? AND fonte_pagadora_id = ?',
        [`${P}PL`, ids['outraFonte']],
        'INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
        [ids['outraFonte'], `${P}PL`, `PLANO SINTETICO ${P}`, agora],
      );
      ids['regra'] = await garantir(
        e,
        'SELECT id FROM regra_lancamento WHERE codigo = ?',
        [`${P}RL`],
        `INSERT INTO regra_lancamento (codigo, descricao, gatilho, vigencia_inicio, criado_em)
         VALUES (?, ?, 'abertura_atendimento', '2026-01-01', ?)`,
        [`${P}RL`, `TAXA SINTETICA ${P}`, agora],
      );
      await limpar(e);
    });
    s = new ServicoExcecaoRegra(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await e.executar('DELETE FROM regra_lancamento WHERE id = ?', [ids['regra']]);
      await e.executar('DELETE FROM plano_fonte_pagadora WHERE id = ?', [ids['planoOutra']]);
      await e.executar('DELETE FROM fonte_pagadora WHERE id IN (?, ?)', [ids['fonte'], ids['outraFonte']]);
      await limparTrilhaDaMassa(e, { ids: [ids['est'] as number, ids['estB'] as number] });
    });
    await nucleo.encerrar();
  });

  it('recusa sem gravar: sem recorte, plano de outra fonte e motivo curto', async () => {
    expect(
      await codigoDo(
        s.gravar('incluir-excecao', op(), {
          ...base(),
          fontePagadoraId: null,
          todosEstabelecimentos: true,
          podeTodosEstabelecimentos: true,
        }),
      ),
    ).toBe('entrada-invalida');
    expect(await codigoDo(s.gravar('incluir-excecao', op(), { ...base(), planoId: ids['planoOutra'] }))).toBe(
      'entrada-invalida',
    );
    expect(await codigoDo(s.gravar('incluir-excecao', op(), { ...base(), motivo: 'x' }))).toBe(
      'entrada-invalida',
    );
    const r = await linhas(
      'SELECT COUNT(*) AS q FROM regra_lancamento_excecao WHERE regra_lancamento_id = ?',
      [ids['regra']],
    );
    expect(Number(r[0]?.['q'])).toBe(0);
  });

  it('inclui a exceção com estabelecimento, autoria, naturezas e motivo; a lista mostra como vigente', async () => {
    const r = await s.gravar('incluir-excecao', op(), base());
    ids['excecao'] = Number(r['id']);
    const [x] = await linhas(
      `SELECT estabelecimento_id, fonte_pagadora_id, efeito, aplica_internacao, aplica_urgencia, motivo, criado_por,
              DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio, vigencia_fim, versao
         FROM regra_lancamento_excecao WHERE id = ?`,
      [ids['excecao']],
    );
    expect(x).toMatchObject({
      efeito: 'nao_aplicar',
      motivo: 'Contrato sem a taxa de abertura',
      inicio: '2026-01-01',
      vigencia_fim: null,
    });
    expect(Number(x?.['estabelecimento_id'])).toBe(ids['est']);
    expect(Number(x?.['fonte_pagadora_id'])).toBe(ids['fonte']);
    expect(Number(x?.['criado_por'])).toBe(ids['usuario']);
    expect(Boolean(Number(x?.['aplica_internacao']))).toBe(true);
    expect(Boolean(Number(x?.['aplica_urgencia']))).toBe(false);
    const lista = await nucleo.lerSomente(
      { cliente: CLIENTE, estabelecimento: ids['est'] as number, correlacao: 'teste-f909' },
      (l) => excecoesRegraLancamentoPropria(l, ids['est'] as number),
    );
    const regra = lista.regras.find((g) => g.id === ids['regra']);
    expect(regra?.excecoes.map((e) => [e.id, e.situacao, e.todosEstabelecimentos])).toEqual([
      [ids['excecao'], 'vigente', false],
    ]);
    expect(lista.opcoes.fontes.some((f) => f.id === ids['fonte'])).toBe(true);
  });

  it('encerrar grava o fim = ontem sem apagar e não se repete; a exceção que começa hoje não se encerra', async () => {
    const r = await s.gravar('encerrar-excecao', op(), { id: ids['excecao'], versao: 1 });
    expect(r['vigenciaFim']).toBe(diaAnterior(HOJE));
    const [x] = await linhas(
      "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, versao, alterado_por FROM regra_lancamento_excecao WHERE id = ?",
      [ids['excecao']],
    );
    expect(x?.['fim']).toBe(diaAnterior(HOJE));
    expect(Number(x?.['versao'])).toBe(2);
    expect(Number(x?.['alterado_por'])).toBe(ids['usuario']);
    expect(await codigoDo(s.gravar('encerrar-excecao', op(), { id: ids['excecao'], versao: 2 }))).toBe(
      'excecao-encerrada',
    );
    const nova = await s.gravar('incluir-excecao', op(), { ...base(), vigenciaInicio: HOJE });
    expect(await codigoDo(s.gravar('encerrar-excecao', op(), { id: Number(nova['id']), versao: 1 }))).toBe(
      'excecao-futura',
    );
    const q = await linhas(
      'SELECT COUNT(*) AS q FROM regra_lancamento_excecao WHERE regra_lancamento_id = ?',
      [ids['regra']],
    );
    expect(Number(q[0]?.['q'])).toBe(2);
  });

  it('a exceção de todos os estabelecimentos pede a permissão própria (incluir, encerrar e cancelar); com ela, grava nulo', async () => {
    expect(
      await codigoDo(s.gravar('incluir-excecao', op(), { ...base(), todosEstabelecimentos: true })),
    ).toBe('sem-permissao-global');
    // Mesmo que o corpo traga a permissão, o controller a sobrescreve pela sessão; aqui a porta recebe a da sessão.
    const g = await s.gravar('incluir-excecao', op(), {
      ...base(),
      todosEstabelecimentos: true,
      vigenciaInicio: '2026-02-01',
      podeTodosEstabelecimentos: true,
    });
    ids['global'] = Number(g['id']);
    const [x] = await linhas('SELECT estabelecimento_id FROM regra_lancamento_excecao WHERE id = ?', [
      ids['global'],
    ]);
    expect(x?.['estabelecimento_id']).toBeNull();
    expect(await codigoDo(s.gravar('encerrar-excecao', op(), { id: ids['global'], versao: 1 }))).toBe(
      'sem-permissao-global',
    );
    expect(
      await codigoDo(
        s.gravar('cancelar-excecao', op(), { id: ids['global'], versao: 1, motivo: 'Recorte errado' }),
      ),
    ).toBe('sem-permissao-global');
    const [y] = await linhas(
      'SELECT vigencia_fim, cancelada_em, versao FROM regra_lancamento_excecao WHERE id = ?',
      [ids['global']],
    );
    expect(y).toMatchObject({ vigencia_fim: null, cancelada_em: null });
    expect(Number(y?.['versao'])).toBe(1);
    const r = await s.gravar('encerrar-excecao', op(), {
      id: ids['global'],
      versao: 1,
      podeTodosEstabelecimentos: true,
    });
    expect(r['vigenciaFim']).toBe(diaAnterior(HOJE));
  });

  it('cancelar a exceção que começa hoje ou depois: grava quem, quando e por quê, sem apagar; a apuração a ignora', async () => {
    const nova = await s.gravar('incluir-excecao', op(), { ...base(), vigenciaInicio: '2099-01-01' });
    const idNova = Number(nova['id']);
    expect(await codigoDo(s.gravar('cancelar-excecao', op(), { id: idNova, versao: 1, motivo: 'x' }))).toBe(
      'entrada-invalida',
    );
    // A que já valeu antes de hoje (a primeira, encerrada) não se cancela.
    expect(
      await codigoDo(
        s.gravar('cancelar-excecao', op(), { id: ids['excecao'], versao: 2, motivo: 'Recorte errado' }),
      ),
    ).toBe('excecao-em-vigor');
    const r = await s.gravar('cancelar-excecao', op(), { id: idNova, versao: 1, motivo: '  Fonte errada  ' });
    expect(r['situacao']).toBe('cancelada');
    const [x] = await linhas(
      'SELECT cancelada_em, cancelada_por, motivo_cancelamento, versao, alterado_por FROM regra_lancamento_excecao WHERE id = ?',
      [idNova],
    );
    expect(x?.['cancelada_em']).not.toBeNull();
    expect(Number(x?.['cancelada_por'])).toBe(ids['usuario']);
    expect(x?.['motivo_cancelamento']).toBe('Fonte errada');
    expect(Number(x?.['versao'])).toBe(2);
    expect(
      await codigoDo(s.gravar('cancelar-excecao', op(), { id: idNova, versao: 2, motivo: 'De novo aqui' })),
    ).toBe('excecao-cancelada');
    expect(await codigoDo(s.gravar('encerrar-excecao', op(), { id: idNova, versao: 2 }))).toBe(
      'excecao-cancelada',
    );
    const lista = await nucleo.lerSomente(
      { cliente: CLIENTE, estabelecimento: ids['est'] as number, correlacao: 'teste-f909' },
      (l) => excecoesRegraLancamentoPropria(l, ids['est'] as number),
    );
    const cancelada = lista.regras.find((g) => g.id === ids['regra'])?.excecoes.find((e) => e.id === idNova);
    expect([cancelada?.situacao, cancelada?.motivoCancelamento]).toEqual(['cancelada', 'Fonte errada']);
    const daRegra = await escrever(async (e) =>
      (await excecoesDaApuracao(e, ids['est'] as number))(ids['regra'] as number),
    );
    expect(daRegra.some((e) => e.vigenciaInicio === '2099-01-01')).toBe(false);
  });

  it("a 'aplicar_somente' do estabelecimento A não entra na apuração do B; a do A e a global entram na do A", async () => {
    const a = await s.gravar('incluir-excecao', op(), {
      ...base(),
      efeito: 'aplicar_somente',
      vigenciaInicio: '2026-03-01',
    });
    const idA = Number(a['id']);
    const doB = await escrever(async (e) =>
      (await excecoesDaApuracao(e, ids['estB'] as number))(ids['regra'] as number),
    );
    // No B só a global (estabelecimento nulo); nenhuma do A, nem a 'aplicar_somente'.
    expect(doB.map((x) => [x.estabelecimento, x.efeito])).toEqual([[null, 'nao_aplicar']]);
    const doA = await escrever(async (e) =>
      (await excecoesDaApuracao(e, ids['est'] as number))(ids['regra'] as number),
    );
    expect(doA.some((x) => x.efeito === 'aplicar_somente' && x.estabelecimento === ids['est'])).toBe(true);
    expect(doA.some((x) => x.estabelecimento === null)).toBe(true);
    // A lista do B não mostra a exceção do A.
    const listaB = await nucleo.lerSomente(
      { cliente: CLIENTE, estabelecimento: ids['estB'] as number, correlacao: 'teste-f909' },
      (l) => excecoesRegraLancamentoPropria(l, ids['estB'] as number),
    );
    expect(listaB.regras.find((g) => g.id === ids['regra'])?.excecoes.some((x) => x.id === idA)).toBe(false);
  });
});
