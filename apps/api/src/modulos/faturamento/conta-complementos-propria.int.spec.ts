// Contrato de efeito dos complementos da conta e da guia (F3.7, 06-FAT linhas 10 e 12) contra o MariaDB real. Massa
// SINTÉTICA com códigos "F373" (nenhuma pessoa real): o período da conta parcial (sugestão, competência, sobreposição
// recusada, retirada marcada e não apagada), o segurado (sugerido da cobertura, alteração na mesma linha, troca de
// carteira preservando o anterior) e o campo adicional da operadora (cadastro com opções dependentes, valores na guia,
// obrigatório que falta, valor retirado marcado e restaurado). No fim, a massa é apagada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { operacoesTiss } from '../tiss/operacoes.js';
import { ServicoComplementosConta } from './conta-complementos.controller.js';
import { versaoTexto } from './esquemas.js';
import {
  atributosGuiaPropria,
  guiasAtributosContaPropria,
  observacaoDaGuiaPropria,
  periodosContaPropria,
  seguradoContaPropria,
} from './conta-complementos-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F373';

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

describe.skipIf(SEM_BANCO)('complementos da conta e da guia (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoComplementosConta;
  const ids = {
    est: 0,
    pessoa: 0,
    paciente: 0,
    outro: 0,
    prof: 0,
    fonte: 0,
    categoria: 0,
    carater: 0,
    tipoConta: 0,
  };
  const ids2 = { atendimento: 0, conta: 0, guia: 0, cobertura: 0, coberturaExcluida: 0, titularOutro: 0 };
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: null,
    correlacao: 'teste-f373',
    chaveIdempotencia: `f373-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ctxL = () => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: null,
    correlacao: 'teste-f373',
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f373' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));

  const limpar = async (e: Escritor) => {
    const contas = await e.consultar<{ id: number }>(
      'SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ? AND numero LIKE ?',
      [ids.est, `${P}%`],
    );
    for (const { id } of contas) {
      await e.executar(
        'DELETE v FROM valor_atributo_guia v JOIN guia_tiss g ON g.id = v.guia_tiss_id WHERE g.conta_hospitalar_id = ?',
        [id],
      );
      await e.executar('DELETE FROM guia_tiss WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar_periodo WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar_segurado WHERE conta_hospitalar_id = ?', [id]);
      await e.executar('DELETE FROM conta_hospitalar WHERE id = ?', [id]);
    }
    await e.executar(
      'DELETE o FROM atributo_guia_opcao o JOIN atributo_guia_fonte_pagadora a ON a.id = o.atributo_guia_fonte_pagadora_id WHERE a.fonte_pagadora_id = ? AND o.opcao_pai_id IS NOT NULL',
      [ids.fonte],
    );
    await e.executar(
      'DELETE o FROM atributo_guia_opcao o JOIN atributo_guia_fonte_pagadora a ON a.id = o.atributo_guia_fonte_pagadora_id WHERE a.fonte_pagadora_id = ?',
      [ids.fonte],
    );
    await e.executar(
      'DELETE FROM atributo_guia_fonte_pagadora WHERE fonte_pagadora_id = ? AND depende_atributo_guia_fonte_pagadora_id IS NOT NULL',
      [ids.fonte],
    );
    await e.executar('DELETE FROM atributo_guia_fonte_pagadora WHERE fonte_pagadora_id = ?', [ids.fonte]);
    await e.executar(
      'DELETE t FROM titular_cobertura t JOIN cobertura_paciente c ON c.id = t.cobertura_paciente_id WHERE c.paciente_id IN (?, ?)',
      [ids.paciente, ids.outro],
    );
    await e.executar('DELETE FROM cobertura_paciente WHERE paciente_id IN (?, ?)', [ids.paciente, ids.outro]);
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
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
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
      );
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      ids.pessoa = await pessoa(`PACIENTE SINTETICO ${P}`);
      const pessoaProf = await pessoa(`PROFISSIONAL SINTETICO ${P}`);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [ids.pessoa],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [ids.pessoa, 837_301, agora],
      );
      const pessoaOutro = await pessoa(`OUTRO PACIENTE SINTETICO ${P}`);
      ids.outro = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoaOutro],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoaOutro, 837_302, agora],
      );
      await limpar(e);
      ids.prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pessoaProf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pessoaProf, agora],
      );
      ids.categoria = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [P],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `CATEGORIA SINTETICA ${P}`, agora],
      );
      ids.carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['F3'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('F3', ?, 'teste', ?)",
        [`CARATER SINTETICO ${P}`, agora],
      );
      ids.tipoConta = await garantir(
        e,
        'SELECT id FROM tipo_conta WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
      );
      ids2.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?)`,
        [
          ids.est,
          `${P}-1`,
          ids.paciente,
          ids.categoria,
          ids.carater,
          ids.fonte,
          ids.prof,
          '2026-01-20 08:00:00',
          agora,
        ],
      );
      ids2.cobertura = await e.inserir(
        `INSERT INTO cobertura_paciente (paciente_id, fonte_pagadora_id, numero_carteira, validade, vigencia_inicio,
           titular, principal, criado_em) VALUES (?, ?, ?, '2026-12-31', '2025-01-01', 1, 1, ?)`,
        [ids.paciente, ids.fonte, `${P}0001`, agora],
      );
      ids2.coberturaExcluida = await e.inserir(
        `INSERT INTO cobertura_paciente (paciente_id, fonte_pagadora_id, numero_carteira, validade, vigencia_inicio,
           titular, principal, criado_em, excluido_em) VALUES (?, ?, ?, '2026-12-31', '2025-01-01', 1, 0, ?, ?)`,
        [ids.paciente, ids.fonte, `${P}0009`, agora, agora],
      );
      const coberturaOutro = await e.inserir(
        `INSERT INTO cobertura_paciente (paciente_id, fonte_pagadora_id, numero_carteira, validade, vigencia_inicio,
           titular, titular_nome, principal, criado_em) VALUES (?, ?, ?, '2026-12-31', '2025-01-01', 0, ?, 1, ?)`,
        [ids.outro, ids.fonte, `${P}0100`, `TITULAR SINTETICO ${P}`, agora],
      );
      ids2.titularOutro = await e.inserir(
        'INSERT INTO titular_cobertura (cobertura_paciente_id, nome, criado_em) VALUES (?, ?, ?)',
        [coberturaOutro, `TITULAR SINTETICO ${P}`, agora],
      );
      ids2.conta = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 08:00:00', ?)`,
        [ids.est, `${P}-C1`, ids2.atendimento, ids.paciente, ids.fonte, ids.tipoConta, agora],
      );
      ids2.guia = await e.inserir(
        `INSERT INTO guia_tiss (estabelecimento_id, conta_hospitalar_id, tipo_guia, fonte_pagadora_id, paciente_id,
           numero_guia_prestador, data_emissao, criado_em) VALUES (?, ?, 'sp_sadt', ?, ?, ?, '2026-01-21', ?)`,
        [ids.est, ids2.conta, ids.fonte, ids.paciente, `${P}G1`, agora],
      );
    });
    s = new ServicoComplementosConta(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  it('período da conta parcial: sugestão, gravação, sobreposição recusada e retirada marcada', async () => {
    const antes = await s.ler(ctxL(), (l, est) => periodosContaPropria(l, est, ids2.conta));
    expect(antes.periodos).toEqual([]);
    expect(antes.sugestao).toMatchObject({
      inicio: '2026-01-20T08:00:00.000',
      fim: '2026-01-31T23:59:59.999',
      competencia: '2026-01-01',
    });
    const r = await s.gravar('periodo.incluir', op(), {
      contaId: ids2.conta,
      inicio: antes.sugestao!.inicio,
      fim: antes.sugestao!.fim,
    });
    expect(r).toMatchObject({ sequencia: 1, competencia: '2026-01-01' });
    const [p] = await linhas(
      'SELECT sequencia, competencia, tipo_lancamento_id, origem, versao, excluido_em FROM conta_hospitalar_periodo WHERE id = ?',
      [r['id']],
    );
    expect(p).toMatchObject({
      sequencia: 1,
      tipo_lancamento_id: null,
      origem: 'sistema',
      versao: 1,
      excluido_em: null,
    });
    expect(
      await codigoDo(
        s.gravar('periodo.incluir', op(), {
          contaId: ids2.conta,
          inicio: '2026-01-25T00:00',
          fim: '2026-02-03T00:00',
        }),
      ),
    ).toBe('entrada-invalida');
    const depois = await s.ler(ctxL(), (l, est) => periodosContaPropria(l, est, ids2.conta));
    // Janeiro coberto até o último instante: a sugestão vai para fevereiro, sem faixa vazia no mesmo mês.
    expect(depois.sugestao).toMatchObject({
      inicio: '2026-02-01T00:00:00.000',
      fim: '2026-02-28T23:59:59.999',
      competencia: '2026-02-01',
    });
    const r2 = await s.gravar('periodo.incluir', op(), {
      contaId: ids2.conta,
      inicio: depois.sugestao!.inicio,
      fim: '2026-02-10T12:00:00.000',
    });
    expect(r2).toMatchObject({ sequencia: 2, competencia: '2026-02-01' });
    expect(await codigoDo(s.gravar('periodo.retirar', op(), { id: r2['id'], versao: 1, motivo: 'x' }))).toBe(
      'entrada-invalida',
    );
    await s.gravar('periodo.retirar', op(), { id: r2['id'], versao: 1, motivo: 'faixa lançada errada' });
    const [ret] = await linhas('SELECT excluido_em FROM conta_hospitalar_periodo WHERE id = ?', [r2['id']]);
    expect(ret).toBeDefined();
    expect(ret?.['excluido_em']).not.toBeNull();
    const trilha = await linhas(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'conta_hospitalar_periodo'",
      [ids.est],
    );
    expect(Number(trilha[0]?.['n'])).toBeGreaterThanOrEqual(3);
    expect((await s.ler(ctxL(), (l, est) => periodosContaPropria(l, est, ids2.conta))).periodos).toHaveLength(
      1,
    );
  });

  it('segurado: sugerido da cobertura, alteração na mesma linha e troca de carteira preservando o anterior', async () => {
    const sug = await s.ler(ctxL(), (l, est) => seguradoContaPropria(l, est, ids2.conta));
    expect(sug).toMatchObject({ gravado: false, substituidos: 0 });
    expect(sug.segurado).toMatchObject({
      coberturaPacienteId: ids2.cobertura,
      numeroCarteira: `${P}0001`,
      validadeCarteira: '2026-12-31',
      parentescoTitular: 'titular',
    });
    const r = await s.gravar('segurado', op(), { ...sug.segurado, contaId: ids2.conta, versao: null });
    expect(r).toMatchObject({ versao: 1, substituido: null, alertas: '' });
    const r2 = await s.gravar('segurado', op(), {
      ...sug.segurado,
      contaId: ids2.conta,
      versao: 1,
      matriculaFuncional: 'M-77',
      cargo: 'ANALISTA',
    });
    expect(r2).toMatchObject({ id: r['id'], versao: 2 });
    const r3 = await s.gravar('segurado', op(), {
      contaId: ids2.conta,
      versao: 2,
      coberturaPacienteId: null,
      numeroCarteira: `${P}0002`,
      validadeCarteira: '2026-01-10',
    });
    expect(r3['substituido']).toBe(r['id']);
    expect(String(r3['alertas'])).toMatch(/vencida/);
    const todas = await linhas(
      'SELECT sequencia, numero_carteira, matricula_funcional, excluido_em FROM conta_hospitalar_segurado WHERE conta_hospitalar_id = ? ORDER BY sequencia',
      [ids2.conta],
    );
    expect(todas.map((t) => [t['sequencia'], t['numero_carteira'], t['excluido_em'] === null])).toEqual([
      [1, `${P}0001`, false],
      [2, `${P}0002`, true],
    ]);
    expect(todas[0]?.['matricula_funcional']).toBe('M-77');
    const lido = await s.ler(ctxL(), (l, est) => seguradoContaPropria(l, est, ids2.conta));
    expect(lido).toMatchObject({ gravado: true, substituidos: 1 });
    expect(
      await codigoDo(s.gravar('segurado', op(), { contaId: ids2.conta, versao: 1, numeroCarteira: ' ' })),
    ).toBe('entrada-invalida');
    // Titular de cobertura de outro paciente e cobertura excluída: recusados, nada muda.
    expect(
      await codigoDo(
        s.gravar('segurado', op(), {
          contaId: ids2.conta,
          versao: 1,
          numeroCarteira: `${P}0003`,
          parentescoTitular: 'filho',
          titularCoberturaId: ids2.titularOutro,
        }),
      ),
    ).toBe('referencia-inexistente');
    expect(
      await codigoDo(
        s.gravar('segurado', op(), {
          contaId: ids2.conta,
          versao: 1,
          coberturaPacienteId: ids2.coberturaExcluida,
          numeroCarteira: `${P}0009`,
        }),
      ),
    ).toBe('entrada-invalida');
    const contagem = await linhas(
      'SELECT COUNT(*) AS n FROM conta_hospitalar_segurado WHERE conta_hospitalar_id = ?',
      [ids2.conta],
    );
    expect(Number(contagem[0]?.['n'])).toBe(2);
  });

  it('campo adicional da operadora: cadastro com opções dependentes e valores conferidos na guia', async () => {
    const trat = await s.gravar('atributo', op(), {
      fontePagadoraId: ids.fonte,
      codigo: 'TRAT',
      rotulo: 'Tratamento oncológico',
      tipoDado: 'opcao',
      obrigatorio: true,
      opcoes: [
        { codigo: 'QT', descricao: 'Quimioterapia' },
        { codigo: 'RT', descricao: 'Radioterapia', ordem: 1 },
      ],
    });
    expect(trat).toMatchObject({ opcoes: 2 });
    const ops = await linhas(
      'SELECT id, codigo FROM atributo_guia_opcao WHERE atributo_guia_fonte_pagadora_id = ? ORDER BY ordem',
      [trat['id']],
    );
    const [qt, rt] = ops.map((o) => Number(o['id']));
    const fase = await s.gravar('atributo', op(), {
      fontePagadoraId: ids.fonte,
      codigo: 'FASE',
      rotulo: 'Fase',
      tipoDado: 'opcao',
      dependeDeId: trat['id'],
      ordem: 1,
      opcoes: [
        { codigo: 'QT1', descricao: 'Primeiro ciclo', opcaoPaiId: qt },
        { codigo: 'RT1', descricao: 'Primeira sessão', opcaoPaiId: rt },
      ],
    });
    const peso = await s.gravar('atributo', op(), {
      fontePagadoraId: ids.fonte,
      codigo: 'PESO',
      rotulo: 'Peso',
      tipoDado: 'numero',
      tipoGuia: 'sp_sadt',
      ordem: 2,
    });
    await s.gravar('atributo', op(), {
      fontePagadoraId: ids.fonte,
      codigo: 'SOINT',
      rotulo: 'Só internação',
      tipoDado: 'texto',
      tipoGuia: 'resumo_internacao',
    });
    expect(
      await codigoDo(
        s.gravar('atributo', op(), {
          fontePagadoraId: ids.fonte,
          codigo: 'trat',
          rotulo: 'X',
          tipoDado: 'texto',
        }),
      ),
    ).toBe('duplicado');
    const fasesOp = await linhas(
      'SELECT id, codigo FROM atributo_guia_opcao WHERE atributo_guia_fonte_pagadora_id = ? ORDER BY id',
      [fase['id']],
    );
    const rt1 = Number(fasesOp.find((o) => o['codigo'] === 'RT1')?.['id']);

    const vazia = await s.ler(ctxL(), (l, est) => atributosGuiaPropria(l, est, ids2.guia));
    expect(vazia.campos.map((c) => c.codigo)).toEqual(['TRAT', 'FASE', 'PESO']);
    expect(vazia.faltam).toEqual(['Tratamento oncológico']);
    // Visão por conta: a guia aparece com o obrigatório que falta.
    const porConta = await s.ler(ctxL(), (l, est) => guiasAtributosContaPropria(l, est, ids2.conta));
    expect(porConta).toMatchObject({ contaId: ids2.conta, fontePagadoraId: ids.fonte });
    expect(porConta.guias).toEqual([
      expect.objectContaining({
        id: ids2.guia,
        tipoGuia: 'sp_sadt',
        campos: 3,
        faltam: ['Tratamento oncológico'],
      }),
    ]);
    // Opção que não combina com a escolhida no pai: recusa e nada grava.
    expect(
      await codigoDo(
        s.gravar('guia.atributos', op(), {
          guiaId: ids2.guia,
          valores: [
            { atributoId: trat['id'], opcaoId: qt },
            { atributoId: fase['id'], opcaoId: rt1 },
          ],
        }),
      ),
    ).toBe('entrada-invalida');
    const g1 = await s.gravar('guia.atributos', op(), {
      guiaId: ids2.guia,
      valores: [
        { atributoId: trat['id'], opcaoId: rt },
        { atributoId: fase['id'], opcaoId: rt1 },
        { atributoId: peso['id'], texto: '72,5' },
      ],
    });
    expect(g1).toMatchObject({ gravados: 3, retirados: 0, faltam: '' });
    expect(
      (await s.ler(ctxL(), (l, est) => guiasAtributosContaPropria(l, est, ids2.conta))).guias[0]?.faltam,
    ).toEqual([]);
    const vs = await linhas(
      'SELECT sequencia, atributo_guia_fonte_pagadora_id AS a, atributo_guia_opcao_id AS o, valor_texto, excluido_em FROM valor_atributo_guia WHERE guia_tiss_id = ? ORDER BY sequencia',
      [ids2.guia],
    );
    expect(
      vs.map((v) => [
        v['sequencia'],
        Number(v['a']),
        v['o'] === null ? null : Number(v['o']),
        v['valor_texto'],
      ]),
    ).toEqual([
      [1, trat['id'], rt, null],
      [2, fase['id'], rt1, null],
      [3, peso['id'], null, '72.5'],
    ]);
    // Retira o peso: a linha fica marcada; informando de novo, a mesma linha volta a valer.
    const g2 = await s.gravar('guia.atributos', op(), {
      guiaId: ids2.guia,
      valores: [
        { atributoId: trat['id'], opcaoId: rt },
        { atributoId: fase['id'], opcaoId: rt1 },
      ],
    });
    expect(g2).toMatchObject({ gravados: 0, retirados: 1 });
    const [pesoMarcado] = await linhas(
      'SELECT excluido_em FROM valor_atributo_guia WHERE guia_tiss_id = ? AND sequencia = 3',
      [ids2.guia],
    );
    expect(pesoMarcado).toBeDefined();
    expect(pesoMarcado?.['excluido_em']).not.toBeNull();
    await s.gravar('guia.atributos', op(), {
      guiaId: ids2.guia,
      valores: [
        { atributoId: trat['id'], opcaoId: rt },
        { atributoId: peso['id'], texto: '80' },
      ],
    });
    const fim = await linhas(
      'SELECT sequencia, valor_texto, excluido_em FROM valor_atributo_guia WHERE guia_tiss_id = ? ORDER BY sequencia',
      [ids2.guia],
    );
    expect(fim.map((v) => [v['sequencia'], v['valor_texto'], v['excluido_em'] === null])).toEqual([
      [1, null, true],
      [2, null, false],
      [3, '80', true],
    ]);
    // Campo-pai com dependente ativo não se inativa; campo inativado conserva o valor já informado na guia.
    expect(
      await codigoDo(
        s.gravar('atributo', op(), {
          id: trat['id'],
          versao: 1,
          fontePagadoraId: ids.fonte,
          codigo: 'TRAT',
          rotulo: 'Tratamento oncológico',
          tipoDado: 'opcao',
          obrigatorio: true,
          ativo: false,
        }),
      ),
    ).toBe('entrada-invalida');
    await s.gravar('atributo', op(), {
      id: peso['id'],
      versao: 1,
      fontePagadoraId: ids.fonte,
      codigo: 'PESO',
      rotulo: 'Peso',
      tipoDado: 'numero',
      tipoGuia: 'sp_sadt',
      ordem: 2,
      ativo: false,
    });
    const g4 = await s.gravar('guia.atributos', op(), {
      guiaId: ids2.guia,
      valores: [{ atributoId: trat['id'], opcaoId: rt }],
    });
    expect(g4).toMatchObject({ gravados: 0, retirados: 0, faltam: '' });
    const [pesoInativo] = await linhas(
      'SELECT valor_texto, excluido_em FROM valor_atributo_guia WHERE guia_tiss_id = ? AND sequencia = 3',
      [ids2.guia],
    );
    expect([pesoInativo?.['valor_texto'], pesoInativo?.['excluido_em']]).toEqual(['80', null]);
    // Guia enviada: não muda mais.
    await escrever((e) => e.executar("UPDATE guia_tiss SET situacao = 'enviada' WHERE id = ?", [ids2.guia]));
    expect(await codigoDo(s.gravar('guia.atributos', op(), { guiaId: ids2.guia, valores: [] }))).toBe(
      'guia-apresentada',
    );
  });

  it('lote TISS: guia com obrigatório da operadora sem valor recusa a conta sem gravar nada; preenchido, passa', async () => {
    const lote = await s.gravar('atributo', op(), {
      fontePagadoraId: ids.fonte,
      codigo: 'LOTEOBR',
      rotulo: 'Classificação para o lote',
      tipoDado: 'texto',
      tipoGuia: 'resumo_internacao',
      obrigatorio: true,
      ordem: 9,
    });
    const guiaRi = await escrever(async (e) => {
      await e.executar(
        `UPDATE conta_hospitalar SET situacao = 'fechada', fechada_em = NOW(3),
                fechada_por_usuario_id = (SELECT MIN(id) FROM usuario), versao = versao + 1 WHERE id = ?`,
        [ids2.conta],
      );
      return e.inserir(
        `INSERT INTO guia_tiss (estabelecimento_id, conta_hospitalar_id, tipo_guia, fonte_pagadora_id, paciente_id,
           numero_guia_prestador, data_emissao, criado_em) VALUES (?, ?, 'resumo_internacao', ?, ?, ?, '2026-01-21', ?)`,
        [ids.est, ids2.conta, ids.fonte, ids.paciente, `${P}G2`, new Date()],
      );
    });
    const executor = nucleo.criarExecutor({});
    // O montador só é usado depois das conferências: aqui nunca chega a montar.
    const gerar = operacoesTiss({} as never)['faturamento.gerarLote']!;
    const entrada = async () => ({
      convenio: ids.fonte,
      tipoGuia: 3,
      contas: [
        {
          id: ids2.conta,
          versao: versaoTexto(
            Number(
              (await linhas('SELECT versao FROM conta_hospitalar WHERE id = ?', [ids2.conta]))[0]?.['versao'],
            ),
          ),
        },
      ],
    });
    const erro = async () => {
      try {
        await executor.executar(gerar, CLIENTE, (await entrada()) as never, op());
      } catch (e) {
        if (e instanceof ErroOperacao) return e;
        throw e;
      }
      throw new Error('esperava recusa');
    };
    const e1 = await erro();
    expect(e1.problema['codigo'] ?? e1.problema.type).toBe('guia-obrigatorio-pendente');
    expect(String(e1.problema['detail'] ?? e1.message)).toContain(`guia ${P}G2:`);
    expect(String(e1.problema['detail'] ?? e1.message)).toContain('Classificação para o lote');
    expect(
      (await linhas('SELECT COUNT(*) AS q FROM lote_tiss WHERE estabelecimento_id = ?', [ids.est]))[0]?.['q'],
    ).toBe(0);
    // A guia do outro tipo (SP/SADT) não entra na conferência do lote de resumo de internação.
    expect(String(e1.problema['detail'] ?? e1.message)).not.toContain(`guia ${P}G1:`);
    // Preenche os obrigatórios que valem para a guia: a conta passa desta conferência (segue para o cadastro TISS).
    const campos = await s.ler(ctxL(), (l, est) => atributosGuiaPropria(l, est, guiaRi));
    const valores = campos.campos
      .filter((c) => c.obrigatorio)
      .map((c) =>
        c.tipoDado === 'opcao'
          ? { atributoId: c.id, opcaoId: c.opcoes.find((o) => o.ativo && o.opcaoPaiId === null)?.id ?? null }
          : { atributoId: c.id, texto: 'ONCO-1' },
      );
    expect(valores.map((v) => v.atributoId)).toContain(lote['id']);
    expect(await s.gravar('guia.atributos', op(), { guiaId: guiaRi, valores })).toMatchObject({ faltam: '' });
    const e2 = await erro();
    expect(e2.problema['codigo'] ?? e2.problema.type).not.toBe('guia-obrigatorio-pendente');
    expect(
      (await linhas('SELECT COUNT(*) AS q FROM lote_tiss WHERE estabelecimento_id = ?', [ids.est]))[0]?.['q'],
    ).toBe(0);
  });

  it('lote TISS: os campos da operadora vão à observação da guia com o código de envio; acima de 500, recusa sem gravar', async () => {
    const guiaRi = Number(
      (
        await linhas(
          'SELECT id FROM guia_tiss WHERE conta_hospitalar_id = ? AND tipo_guia = ? ORDER BY id DESC',
          [ids2.conta, 'resumo_internacao'],
        )
      )[0]?.['id'],
    );
    const est = await s.gravar('atributo', op(), {
      fontePagadoraId: ids.fonte,
      codigo: 'ESTADIO',
      rotulo: 'Estadiamento',
      tipoDado: 'opcao',
      tipoGuia: 'resumo_internacao',
      ordem: 10,
      opcoes: [
        { codigo: 'E1', descricao: 'Estádio I', valorEnvio: 'ONC-E1' },
        { codigo: 'E2', descricao: 'Estádio II', ordem: 1 },
      ],
    });
    const [e1] = (
      await linhas(
        'SELECT id FROM atributo_guia_opcao WHERE atributo_guia_fonte_pagadora_id = ? ORDER BY ordem',
        [est['id']],
      )
    ).map((o) => Number(o['id']));
    const atuais = await s.ler(ctxL(), (l, e) => atributosGuiaPropria(l, e, guiaRi));
    const outros = atuais.valores.filter((v) => v.atributoId !== Number(est['id']));
    await s.gravar('guia.atributos', op(), {
      guiaId: guiaRi,
      valores: [...outros, { atributoId: Number(est['id']), opcaoId: e1 }],
    });
    // O que fica no banco é o valor da guia; o texto da observação é lido dele com o código de envio da opção.
    const obs = await s.ler(ctxL(), (l, e) => observacaoDaGuiaPropria(l, e, guiaRi));
    expect(obs.numero).toBe(`${P}G2`);
    expect(obs.excede).toBe(false);
    expect(obs.texto).toContain('ESTADIO: ONC-E1');
    expect(obs.texto).toContain('LOTEOBR: ONCO-1');
    expect(obs.texto).not.toContain('Estádio');
    // Texto da operadora acima do limite do padrão: o lote recusa a conta e nada se grava.
    const lote = atuais.campos.find((c) => c.codigo === 'LOTEOBR')!;
    await s.gravar('guia.atributos', op(), {
      guiaId: guiaRi,
      valores: [
        ...outros.filter((v) => v.atributoId !== lote.id),
        { atributoId: lote.id, texto: 'x'.repeat(495) },
        { atributoId: Number(est['id']), opcaoId: e1 },
      ],
    });
    expect((await s.ler(ctxL(), (l, e) => observacaoDaGuiaPropria(l, e, guiaRi))).excede).toBe(true);
    const executor = nucleo.criarExecutor({});
    const gerar = operacoesTiss({} as never)['faturamento.gerarLote']!;
    const versao = versaoTexto(
      Number((await linhas('SELECT versao FROM conta_hospitalar WHERE id = ?', [ids2.conta]))[0]?.['versao']),
    );
    expect(
      await codigoDo(
        executor.executar(
          gerar,
          CLIENTE,
          { convenio: ids.fonte, tipoGuia: 3, contas: [{ id: ids2.conta, versao }] } as never,
          op(),
        ),
      ),
    ).toBe('guia-campos-operadora-excede');
    expect(
      (await linhas('SELECT COUNT(*) AS q FROM lote_tiss WHERE estabelecimento_id = ?', [ids.est]))[0]?.['q'],
    ).toBe(0);
  });
  it('lote TISS: caractere fora do ISO-8859-1 recusa ao gravar a opção e o valor; gravado antes, o lote recusa com a guia e o campo, sem gravar', async () => {
    const guiaRi = Number(
      (
        await linhas(
          'SELECT id FROM guia_tiss WHERE conta_hospitalar_id = ? AND tipo_guia = ? ORDER BY id DESC',
          [ids2.conta, 'resumo_internacao'],
        )
      )[0]?.['id'],
    );
    const atuais = await s.ler(ctxL(), (l, e) => atributosGuiaPropria(l, e, guiaRi));
    const est = atuais.campos.find((c) => c.codigo === 'ESTADIO')!;
    const lote = atuais.campos.find((c) => c.codigo === 'LOTEOBR')!;
    const e1 = est.opcoes.find((o) => o.codigo === 'E1')!.id;
    // Opção nova com travessão no código de envio: recusa no cadastro, nada gravado.
    const antes = (
      await linhas('SELECT COUNT(*) AS q FROM atributo_guia_fonte_pagadora WHERE fonte_pagadora_id = ?', [
        ids.fonte,
      ])
    )[0]?.['q'];
    expect(
      await codigoDo(
        s.gravar('atributo', op(), {
          fontePagadoraId: ids.fonte,
          codigo: 'GRAU',
          rotulo: 'Grau',
          tipoDado: 'opcao',
          tipoGuia: 'resumo_internacao',
          opcoes: [{ codigo: 'G1', descricao: 'Grau um', valorEnvio: 'GR\u20131' }],
        }),
      ),
    ).toBe('entrada-invalida');
    expect(
      (
        await linhas('SELECT COUNT(*) AS q FROM atributo_guia_fonte_pagadora WHERE fonte_pagadora_id = ?', [
          ids.fonte,
        ])
      )[0]?.['q'],
    ).toBe(antes);
    // Valor de texto com aspas curvas: recusa ao gravar na guia; o valor anterior fica como estava.
    const base = [
      ...atuais.valores.filter((v) => v.atributoId !== est.id && v.atributoId !== lote.id),
      { atributoId: est.id, opcaoId: e1 },
    ];
    await s.gravar('guia.atributos', op(), {
      guiaId: guiaRi,
      valores: [...base, { atributoId: lote.id, texto: 'ONCO-1' }],
    });
    expect(
      await codigoDo(
        s.gravar('guia.atributos', op(), {
          guiaId: guiaRi,
          valores: [...base, { atributoId: lote.id, texto: '\u201cONCO\u201d' }],
        }),
      ),
    ).toBe('entrada-invalida');
    expect(
      (
        await linhas(
          'SELECT valor_texto FROM valor_atributo_guia WHERE guia_tiss_id = ? AND atributo_guia_fonte_pagadora_id = ? AND excluido_em IS NULL',
          [guiaRi, lote.id],
        )
      ).map((v) => v['valor_texto']),
    ).toEqual(['ONCO-1']);
    // Código de envio gravado antes da conferência (dado antigo): o lote recusa com a guia e o campo, sem trocar o
    // caractere nem omitir o campo, e nada se grava.
    await escrever((e) =>
      e.executar('UPDATE atributo_guia_opcao SET valor_envio = ? WHERE id = ?', ['ONC\u2014E1', e1]),
    );
    const obs = await s.ler(ctxL(), (l, e) => observacaoDaGuiaPropria(l, e, guiaRi));
    expect(obs.erros.join(' ')).toContain('Estadiamento: o caractere U+2014');
    expect(obs.texto).toContain('LOTEOBR: ONCO-1');
    expect(obs.texto).not.toContain('ESTADIO');
    const executor = nucleo.criarExecutor({});
    const gerar = operacoesTiss({} as never)['faturamento.gerarLote']!;
    const versao = versaoTexto(
      Number((await linhas('SELECT versao FROM conta_hospitalar WHERE id = ?', [ids2.conta]))[0]?.['versao']),
    );
    expect(
      await codigoDo(
        executor.executar(
          gerar,
          CLIENTE,
          { convenio: ids.fonte, tipoGuia: 3, contas: [{ id: ids2.conta, versao }] } as never,
          op(),
        ),
      ),
    ).toBe('guia-campos-operadora-invalidos');
    expect(
      (await linhas('SELECT COUNT(*) AS q FROM lote_tiss WHERE estabelecimento_id = ?', [ids.est]))[0]?.['q'],
    ).toBe(0);
    // Corrigido o código de envio, a guia volta a passar desta conferência.
    await escrever((e) =>
      e.executar('UPDATE atributo_guia_opcao SET valor_envio = ? WHERE id = ?', ['ONC-E1', e1]),
    );
    expect((await s.ler(ctxL(), (l, e) => observacaoDaGuiaPropria(l, e, guiaRi))).erros).toEqual([]);
  });
});
