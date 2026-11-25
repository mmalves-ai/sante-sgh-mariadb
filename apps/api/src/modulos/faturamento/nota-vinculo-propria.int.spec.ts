// Contrato de efeito da nota fiscal que documenta a fatura ou a conta (F3.7, 06-FAT linha 36) contra o MariaDB real.
// Massa SINTÉTICA com códigos "F379" (nenhuma pessoa real; CPF fictício fora do padrão de dígito verificador): a visão
// da fatura (valor, documentado, candidatas com o sugerido), a ligação com autoria (criado_por do usuário sintético),
// desconto e acréscimo gravados, o ajuste na mesma linha, a recusa acima do saldo, de outra fonte pagadora, da nota
// cancelada, de id de outro estabelecimento, da conta aberta e da nota de outro paciente; a conta fechada ligada pela
// nota do próprio paciente; o desligamento só com motivo, marcado (excluido_por) e não apagado; o religamento na mesma
// linha; o histórico do vínculo (ligado, ajustado, desligado, religado) e a nota cancelada depois de ligada, que segue
// à vista mas sai da soma documentada. No fim, a massa é apagada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoNotaVinculo } from './nota-vinculo.controller.js';
import { documentacaoFiscalPropria, faturasDocumentacaoPropria } from './nota-vinculo-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F379';

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

describe.skipIf(SEM_BANCO)('nota fiscal que documenta a fatura ou a conta (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoNotaVinculo;
  const ids = {
    est: 0,
    estB: 0,
    usuario: 0,
    fonte: 0,
    fonte2: 0,
    conta2: 0,
    notaOutraFonte: 0,
    notaCancelada: 0,
    notaPaciente: 0,
    notaOutroPaciente: 0,
    notaOutraConta: 0,
    municipio: 0,
    fatura: 0,
    nota1: 0,
    nota2: 0,
    conta: 0,
    pessoa: 0,
    paciente: 0,
    atendimento: 0,
    motivoCancelamento: 0,
  };
  const op = (est = ids.est): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: est,
    usuario: ids.usuario,
    correlacao: 'teste-f379',
    chaveIdempotencia: `f379-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ctxL = () => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: null,
    correlacao: 'teste-f379',
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f379' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));

  const limpar = async (e: Escritor) => {
    await e.executar(
      `DELETE h FROM evento_vinculo_nota_faturamento h JOIN vinculo_nota_faturamento v ON v.id = h.vinculo_nota_faturamento_id
         JOIN nota_servico ns ON ns.id = v.nota_servico_id WHERE ns.estabelecimento_id = ?`,
      [ids.est],
    );
    await e.executar(
      'DELETE v FROM vinculo_nota_faturamento v JOIN nota_servico ns ON ns.id = v.nota_servico_id WHERE ns.estabelecimento_id = ?',
      [ids.est],
    );
    await e.executar('DELETE FROM nota_servico WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM fatura_fonte_pagadora WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
  };
  const CPF_PACIENTE = '00000837901';
  const CPF_OUTRO = '00000837902';
  const nota = (
    e: Escritor,
    rps: number,
    valor: number,
    situacao: string,
    o: { fonte?: number | null; doc?: string; conta?: number | null } = {},
  ) =>
    e.inserir(
      `INSERT INTO nota_servico (estabelecimento_id, numero_rps, serie_rps, numero_nota, data_emissao, competencia,
         municipio_prestacao_id, tipo_tomador, fonte_pagadora_id, tomador_nome, tomador_documento, conta_hospitalar_id,
         discriminacao, valor_servicos, base_calculo, valor_liquido, situacao, cancelada_em,
         motivo_cancelamento_documento_fiscal_id, criado_em)
       VALUES (?, ?, 'T', ?, '2026-02-05 10:00:00', '2026-01-01', ?, ?, ?, ?, ?, ?,
         'SERVICOS HOSPITALARES SINTETICOS', ?, ?, ?, ?, ?, ?, NOW(3))`,
      [
        ids.est,
        rps,
        `${P}${rps}`,
        ids.municipio,
        o.fonte === null ? 'pessoa_fisica' : 'pessoa_juridica',
        o.fonte === undefined ? ids.fonte : o.fonte,
        `TOMADOR SINTETICO ${P}`,
        o.doc ?? '00000000000191',
        o.conta ?? null,
        valor,
        valor,
        valor,
        situacao,
        situacao === 'cancelada' ? '2026-02-10 10:00:00' : null,
        situacao === 'cancelada' ? ids.motivoCancelamento : null,
      ],
    );

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
      ids.estB = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}B`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}B`, `ESTAB ${P} SINTETICO B`, `ESTAB ${P} SINTETICO B`, agora],
      );
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [`f379.sintetico`],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        [`f379.sintetico`, `USUARIO SINTETICO ${P}`, agora],
      );
      ids.fonte2 = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FQ`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}FQ`, `OPERADORA SINTETICA ${P} DOIS`, agora],
      );
      ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
        [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
      );
      ids.motivoCancelamento = await garantir(
        e,
        'SELECT id FROM motivo_cancelamento_documento_fiscal WHERE codigo = ?',
        [`${P}MC`],
        'INSERT INTO motivo_cancelamento_documento_fiscal (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}MC`, `ERRO DE EMISSAO SINTETICO ${P}`, agora],
      );
      const m = await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM municipio_ibge', []);
      ids.municipio = Number(m?.id ?? 0);
      ids.pessoa = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      // CPF fictício da massa (o mesmo de sempre; nunca de pessoa real, sem dígito verificador válido).
      await e.executar('UPDATE pessoa_fisica SET cpf = ? WHERE id = ? AND (cpf IS NULL OR cpf <> ?)', [
        CPF_PACIENTE,
        ids.pessoa,
        CPF_PACIENTE,
      ]);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [ids.pessoa],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [ids.pessoa, 837_901, agora],
      );
      await limpar(e);
      ids.fatura = await e.inserir(
        `INSERT INTO fatura_fonte_pagadora (estabelecimento_id, numero, fonte_pagadora_id, competencia, data_abertura,
           fechado_em, valor_apresentado, valor_acrescimo, valor_desconto, situacao, criado_em)
         VALUES (?, ?, ?, '2026-01-01', '2026-02-01', '2026-02-03 09:00:00', 1000, 50, 50, 'fechada', ?)`,
        [ids.est, `${P}-F1`, ids.fonte, agora],
      );
      // O atendimento sintético de que as duas contas nascem (a conta hospitalar sempre pertence a um atendimento).
      ids.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         SELECT ?, ?, ?, (SELECT MIN(id) FROM categoria_atendimento), (SELECT MIN(id) FROM carater_atendimento_tiss),
                ?, (SELECT MIN(id) FROM profissional), '2026-01-20 08:00:00', ?, 'aberto'`,
        [ids.est, `${P}-AT1`, ids.paciente, ids.fonte, agora],
      );
      const tipoConta = await garantir(
        e,
        'SELECT id FROM tipo_conta WHERE codigo = ?',
        [`${P}-TC`],
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [`${P}-TC`, `INTERNACAO ${P}`, agora],
      );
      ids.conta = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, valor_total, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 08:00:00', 300, ?)`,
        [ids.est, `${P}-C1`, ids.atendimento, ids.paciente, ids.fonte, tipoConta, agora],
      );
      ids.conta2 = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, valor_total, situacao, fechada_em, fechada_por_usuario_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 08:00:00', 250, 'fechada',
           '2026-01-25 10:00:00', ?, ?)`,
        [ids.est, `${P}-C2`, ids.atendimento, ids.paciente, ids.fonte, tipoConta, ids.usuario, agora],
      );
      ids.nota1 = await nota(e, 1, 600, 'autorizada');
      ids.nota2 = await nota(e, 2, 700, 'autorizada');
      ids.notaCancelada = await nota(e, 3, 900, 'cancelada');
      ids.notaOutraFonte = await nota(e, 4, 100, 'autorizada', { fonte: ids.fonte2 });
      ids.notaPaciente = await nota(e, 5, 250, 'autorizada', { fonte: null, doc: CPF_PACIENTE });
      ids.notaOutroPaciente = await nota(e, 6, 250, 'autorizada', { fonte: null, doc: CPF_OUTRO });
      ids.notaOutraConta = await nota(e, 7, 250, 'autorizada', { conta: ids.conta });
    });
    s = new ServicoNotaVinculo(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est, ids.estB] });
    });
    await nucleo.encerrar();
  });

  it('visão da fatura, ligação, ajuste, recusa acima do saldo, desligamento marcado e religamento', async () => {
    const v0 = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', ids.fatura));
    expect(v0.alvo).toMatchObject({
      valorDocumentavel: 1000,
      valorDocumentado: 0,
      saldo: 1000,
      documentacao: 'sem_nota',
    });
    // A cancelada, a de outra fonte, a emitida para uma conta e as de tomador pessoa física não aparecem; as duas
    // autorizadas da fonte aparecem com o sugerido limitado pelo saldo de cada lado.
    expect(v0.candidatas.map((c) => c.id).sort()).toEqual([ids.nota1, ids.nota2].sort());
    expect(v0.candidatas.find((c) => c.id === ids.nota1)?.sugerido).toBe(600);

    const r1 = await s.gravar('vincular', op(), {
      tipo: 'fatura',
      alvoId: ids.fatura,
      notaServicoId: ids.nota1,
      valorApropriado: 600,
      valorDesconto: 12.5,
      valorAcrescimo: 3.25,
    });
    expect(r1['acao']).toBe('ligado');
    const [linha] = await linhas(
      `SELECT nota_servico_id, fatura_fonte_pagadora_id, conta_hospitalar_id, valor_apropriado, valor_desconto,
              valor_acrescimo, criado_por, excluido_em, versao FROM vinculo_nota_faturamento WHERE id = ?`,
      [r1['id']],
    );
    expect(linha).toMatchObject({
      nota_servico_id: ids.nota1,
      fatura_fonte_pagadora_id: ids.fatura,
      conta_hospitalar_id: null,
      excluido_em: null,
    });
    expect(Number(linha?.['valor_apropriado'])).toBe(600);
    expect(Number(linha?.['valor_desconto'])).toBe(12.5);
    expect(Number(linha?.['valor_acrescimo'])).toBe(3.25);
    expect(Number(linha?.['criado_por'])).toBe(ids.usuario);

    // Outra fonte pagadora, nota cancelada e id de outro estabelecimento: recusados, nada gravado.
    const pedido = (notaServicoId: number) => ({
      tipo: 'fatura',
      alvoId: ids.fatura,
      notaServicoId,
      valorApropriado: 10,
    });
    expect(await codigoDo(s.gravar('vincular', op(), pedido(ids.notaOutraFonte)))).toBe('entrada-invalida');
    expect(await codigoDo(s.gravar('vincular', op(), pedido(ids.notaCancelada)))).toBe('entrada-invalida');
    expect(await codigoDo(s.gravar('vincular', op(ids.estB), pedido(ids.nota2)))).toBe('nao-encontrado');
    const [semRecusadas] = await linhas(
      'SELECT COUNT(*) AS n FROM vinculo_nota_faturamento WHERE nota_servico_id IN (?, ?, ?)',
      [ids.notaOutraFonte, ids.notaCancelada, ids.nota2],
    );
    expect(Number(semRecusadas?.['n'])).toBe(0);

    // Acima do que falta na fatura (400): recusa com o campo.
    expect(
      await codigoDo(
        s.gravar('vincular', op(), {
          tipo: 'fatura',
          alvoId: ids.fatura,
          notaServicoId: ids.nota2,
          valorApropriado: 401,
        }),
      ),
    ).toBe('entrada-invalida');
    const r2 = await s.gravar('vincular', op(), {
      tipo: 'fatura',
      alvoId: ids.fatura,
      notaServicoId: ids.nota2,
      valorApropriado: 400,
    });
    const v1 = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', ids.fatura));
    expect(v1.alvo).toMatchObject({ valorDocumentado: 1000, documentacao: 'documentada', saldo: 0 });
    expect(v1.ligadas).toHaveLength(2);

    // Ligar de novo a mesma nota ajusta o valor na mesma linha.
    const r3 = await s.gravar('vincular', op(), {
      tipo: 'fatura',
      alvoId: ids.fatura,
      notaServicoId: ids.nota2,
      valorApropriado: 300,
    });
    expect(r3).toMatchObject({ id: r2['id'], acao: 'ajustado' });

    // Desligar sem motivo é recusado; com motivo, marca (autor e data) e não apaga; religar restaura a mesma linha.
    const lig = (
      await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', ids.fatura))
    ).ligadas.find((x) => x.notaServicoId === ids.nota1);
    expect(await codigoDo(s.gravar('desvincular', op(), { id: lig?.id, versao: lig?.versao }))).toBe(
      'entrada-invalida',
    );
    await s.gravar('desvincular', op(), {
      id: lig?.id,
      versao: lig?.versao,
      motivo: 'nota ligada à fatura errada',
    });
    const [marcada] = await linhas(
      'SELECT excluido_em, excluido_por FROM vinculo_nota_faturamento WHERE id = ?',
      [r1['id']],
    );
    expect(marcada?.['excluido_em']).not.toBeNull();
    expect(Number(marcada?.['excluido_por'])).toBe(ids.usuario);
    const v2 = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', ids.fatura));
    expect(v2.alvo).toMatchObject({ valorDocumentado: 300, documentacao: 'parcial' });
    const r4 = await s.gravar('vincular', op(), {
      tipo: 'fatura',
      alvoId: ids.fatura,
      notaServicoId: ids.nota1,
      valorApropriado: 500,
    });
    expect(r4).toMatchObject({ id: r1['id'], acao: 'religado' });
    const [cont] = await linhas(
      'SELECT COUNT(*) AS n FROM vinculo_nota_faturamento WHERE nota_servico_id IN (?, ?)',
      [ids.nota1, ids.nota2],
    );
    expect(Number(cont?.['n'])).toBe(2);

    // Histórico próprio do vínculo: nada sobrescrito.
    const hist = await linhas(
      `SELECT vinculo_nota_faturamento_id AS v, acao, valor_apropriado_anterior AS ant, valor_apropriado AS val,
              motivo, criado_por FROM evento_vinculo_nota_faturamento
        WHERE vinculo_nota_faturamento_id IN (?, ?) ORDER BY id`,
      [r1['id'], r2['id']],
    );
    expect(hist.map((h) => [Number(h['v']), h['acao']])).toEqual([
      [r1['id'], 'ligado'],
      [r2['id'], 'ligado'],
      [r2['id'], 'ajustado'],
      [r1['id'], 'desligado'],
      [r1['id'], 'religado'],
    ]);
    expect(Number(hist[2]?.['ant'])).toBe(400);
    expect(Number(hist[3]?.['ant'])).toBe(600);
    expect(hist[3]?.['val']).toBeNull();
    expect(hist[3]?.['motivo']).toBe('nota ligada à fatura errada');
    expect(hist.every((h) => Number(h['criado_por']) === ids.usuario)).toBe(true);
    const v3 = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', ids.fatura));
    expect(v3.historico).toHaveLength(5);

    // A nota cancelada depois de ligada segue à vista, marcada, e sai da soma documentada.
    await escrever((e) =>
      e.executar(
        `UPDATE nota_servico SET situacao = 'cancelada', cancelada_em = '2026-02-10 10:00:00',
           motivo_cancelamento_documento_fiscal_id = ? WHERE id = ?`,
        [ids.motivoCancelamento, ids.nota2],
      ),
    );
    const v4 = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', ids.fatura));
    expect(v4.ligadas.find((x) => x.notaServicoId === ids.nota2)).toMatchObject({
      situacaoNota: 'cancelada',
      documenta: false,
    });
    expect(v4.alvo).toMatchObject({ valorDocumentado: 500, documentacao: 'parcial' });
  });

  it('conta fechada: só a nota do próprio paciente; a de outro paciente e a emitida para outra conta são recusadas', async () => {
    const v0 = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'conta', ids.conta2));
    const cand = v0.candidatas.map((c) => c.id);
    expect(cand).toContain(ids.notaPaciente);
    expect(cand).not.toContain(ids.notaOutroPaciente);
    expect(cand).not.toContain(ids.notaOutraConta);
    expect(cand).not.toContain(ids.notaOutraFonte);
    const pedido = (notaServicoId: number, valorApropriado = 50) => ({
      tipo: 'conta',
      alvoId: ids.conta2,
      notaServicoId,
      valorApropriado,
    });
    expect(await codigoDo(s.gravar('vincular', op(), pedido(ids.notaOutroPaciente)))).toBe(
      'entrada-invalida',
    );
    expect(await codigoDo(s.gravar('vincular', op(), pedido(ids.notaOutraConta)))).toBe('entrada-invalida');
    const r = await s.gravar('vincular', op(), pedido(ids.notaPaciente, 250));
    expect(r['acao']).toBe('ligado');
    const [linha] = await linhas(
      'SELECT conta_hospitalar_id, fatura_fonte_pagadora_id, valor_apropriado, criado_por FROM vinculo_nota_faturamento WHERE id = ?',
      [r['id']],
    );
    expect(linha).toMatchObject({ conta_hospitalar_id: ids.conta2, fatura_fonte_pagadora_id: null });
    expect(Number(linha?.['valor_apropriado'])).toBe(250);
    expect(Number(linha?.['criado_por'])).toBe(ids.usuario);
    const v1 = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'conta', ids.conta2));
    expect(v1.alvo).toMatchObject({ valorDocumentado: 250, documentacao: 'documentada', saldo: 0 });
    expect(JSON.stringify(v1.alvo)).not.toContain(CPF_PACIENTE);
    const [semOutros] = await linhas(
      'SELECT COUNT(*) AS n FROM vinculo_nota_faturamento WHERE nota_servico_id IN (?, ?)',
      [ids.notaOutroPaciente, ids.notaOutraConta],
    );
    expect(Number(semOutros?.['n'])).toBe(0);
  });

  it('conta ainda aberta não recebe nota', async () => {
    expect(
      await codigoDo(
        s.gravar('vincular', op(), {
          tipo: 'conta',
          alvoId: ids.conta,
          notaServicoId: ids.nota2,
          valorApropriado: 10,
        }),
      ),
    ).toBe('entrada-invalida');
    const v = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'conta', ids.conta));
    expect(v.alvo).toMatchObject({ tipo: 'conta', valorDocumentavel: 300, documentacao: 'sem_nota' });
  });

  it('lista das faturas: a documentação de cada uma é a mesma da tela da fatura, com filtro por competência e situação', async () => {
    const visao = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', ids.fatura));
    const lista = await s.ler(ctxL(), (l, est) =>
      faturasDocumentacaoPropria(l, est, { competencia: '2026-01' }),
    );
    const f = lista.find((x) => x.id === ids.fatura);
    expect(f).toMatchObject({
      numero: `${P}-F1`,
      competencia: '2026-01',
      fontePagadoraId: ids.fonte,
      fontePagadora: `OPERADORA SINTETICA ${P}`,
      valorDocumentavel: visao.alvo.valorDocumentavel,
      valorDocumentado: visao.alvo.valorDocumentado,
      saldo: visao.alvo.saldo,
      documentacao: visao.alvo.documentacao,
    });
    // Outra competência não traz a fatura; o filtro pela situação da documentação traz só as daquela situação.
    const outra = await s.ler(ctxL(), (l, est) =>
      faturasDocumentacaoPropria(l, est, { competencia: '2025-12' }),
    );
    expect(outra.some((x) => x.id === ids.fatura)).toBe(false);
    const mesma = await s.ler(ctxL(), (l, est) =>
      faturasDocumentacaoPropria(l, est, { documentacao: visao.alvo.documentacao }),
    );
    expect(mesma.some((x) => x.id === ids.fatura)).toBe(true);
    expect(mesma.every((x) => x.documentacao === visao.alvo.documentacao)).toBe(true);
    // Outro estabelecimento não vê a fatura.
    const deOutro = await s.ler({ ...ctxL(), estabelecimento: ids.estB }, (l, est) =>
      faturasDocumentacaoPropria(l, est, {}),
    );
    expect(deOutro.some((x) => x.id === ids.fatura)).toBe(false);
  });

  it('lista das faturas: o filtro pela documentação vale antes do corte (a fatura antiga não some atrás das recentes)', async () => {
    const visao = await s.ler(ctxL(), (l, est) => documentacaoFiscalPropria(l, est, 'fatura', ids.fatura));
    expect(visao.alvo.documentacao).not.toBe('sem_nota');
    // Duas faturas mais recentes, ainda sem nota: com o corte em 2, elas ocupam a lista inteira sem filtro.
    const recentes = await escrever(async (e) => {
      const r: number[] = [];
      for (const [num, comp] of [
        [`${P}-F2`, '2026-02-01'],
        [`${P}-F3`, '2026-03-01'],
      ] as const)
        r.push(
          await e.inserir(
            `INSERT INTO fatura_fonte_pagadora (estabelecimento_id, numero, fonte_pagadora_id, competencia,
               data_abertura, fechado_em, valor_apresentado, valor_acrescimo, valor_desconto, situacao, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, 400, 0, 0, 'fechada', ?)`,
            [ids.est, num, ids.fonte, comp, comp, `${comp} 09:00:00`, new Date()],
          ),
        );
      return r;
    });
    const semFiltro = await s.ler(ctxL(), (l, est) => faturasDocumentacaoPropria(l, est, { limite: 2 }));
    expect(semFiltro.map((x) => x.id).sort()).toEqual([...recentes].sort());
    // Filtrada pela situação dela, a fatura antiga aparece mesmo com o corte em 1.
    const filtrada = await s.ler(ctxL(), (l, est) =>
      faturasDocumentacaoPropria(l, est, { documentacao: visao.alvo.documentacao, limite: 1 }),
    );
    expect(filtrada.map((x) => x.id)).toEqual([ids.fatura]);
    // As sem nota vêm todas, e só elas; a mais recente primeiro.
    const semNota = await s.ler(ctxL(), (l, est) =>
      faturasDocumentacaoPropria(l, est, { documentacao: 'sem_nota', limite: 2 }),
    );
    expect(semNota.map((x) => x.id)).toEqual([recentes[1], recentes[0]]);
    expect(semNota.every((x) => x.documentacao === 'sem_nota' && x.valorDocumentado === 0)).toBe(true);
  });
});
