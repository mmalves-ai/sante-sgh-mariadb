// Integração da porta própria da autorização prévia contra o MariaDB real (cliente f22_o2). Massa sintética "L0209".
// Contrato de efeito: o pedido (pedido_autorizacao_plano) e o histórico de cada mudança, complemento pedido e
// respondido, junta aberta e concluída na decisão, decisão com senha, cancelamento com o motivo do cadastro, auditor
// designado e encerrado com redistribuição; versão, trilha e outbox; e as recusas (decisão sem senha, conflito de
// versão, outro estabelecimento, auditor com pedidos sem redistribuição). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaAutorizacaoOperadoraPropria } from './autorizacao-porta-propria.js';
import { ServicoAutorizacaoOperadora } from './autorizacao-servico.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparNegocio,
  type MassaOperadora,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';

describe.skipIf(SEM_BANCO)('porta própria da autorização prévia (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAutorizacaoOperadoraPropria;
  let m: MassaOperadora;
  let conselho = { sigla: '', uf: '' };
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't0209' }, (l) => l.consultar(sql, p));
  const T = (ev: string) => trilhaTela(m, 'pedido_autorizacao_plano', ev);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await prepararMassa(nucleo);
    await limparNegocio(nucleo, m);
    const [c] = await ler(
      `SELECT cc.sigla, uf.sigla AS uf FROM inscricao_conselho ic JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
         JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id WHERE ic.profissional_id = ?`,
      [m.profissional],
    );
    conselho = { sigla: String(c?.['sigla'] ?? ''), uf: String(c?.['uf'] ?? '') };
    porta = new PortaAutorizacaoOperadoraPropria(
      nucleo,
      CLIENTE,
      { elegibilidade: async () => null },
      { prestador: async () => null, prestadores: async () => ({ itens: [], proxima: null }) },
    );
  }, 120_000);
  afterAll(async () => {
    if (m) await limparNegocio(nucleo, m);
    await nucleo?.encerrar();
  });

  const agora = () => new Date();
  const registrar = (protocolo: string) =>
    porta.gravar(contexto(m), T('operadora.autorizacao.registrada'), (g) =>
      g.registrar({
        operadora: m.operadora,
        beneficiario: m.beneficiario,
        carteirinha: 'L02090001',
        prestador: m.prestador,
        executante: null,
        guiaPrincipal: null,
        tipoGuia: m.tipoGuia,
        carater: 'E',
        altaComplexidade: false,
        origem: m.origemGuia,
        protocolo,
        solicitadaEm: agora().toISOString(),
        prazoTipo: 'padrao',
        prazoEm: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        cid: 'Z00',
        indicacaoClinica: 'Indicação clínica sintética',
        profissional: { nome: 'MEDICO SINTETICO', conselho: 'CRM', numero: '902090', uf: 'SP' },
        internacao: null,
        itens: [],
        usuario: 'l0209.teste',
      }),
    );

  it('registra, pede e recebe o complemento, decide com senha; histórico, trilha e outbox', async () => {
    const r = await registrar('L0209-A1');
    expect(r.versao).toBe(1);
    const [p] = await ler(
      'SELECT situacao, estabelecimento_id, prazo_tipo FROM pedido_autorizacao_plano WHERE id = ?',
      [r.id],
    );
    expect(p).toMatchObject({ situacao: 'em_analise', estabelecimento_id: m.est, prazo_tipo: 'padrao' });
    await porta.gravar(contexto(m), T('x'), (g) =>
      g.pedirComplemento({ id: r.id, versao: 1, usuario: 'x', pedido: 'Envie o laudo' }),
    );
    expect(await porta.autorizacao(contexto(m), r.id)).toMatchObject({
      situacao: 'pendente',
      complementoPedido: 'Envie o laudo',
      cid: 'Z00',
    });
    await porta.gravar(contexto(m), T('x'), (g) =>
      g.responderComplemento({ id: r.id, versao: 2, usuario: 'x', resposta: 'Laudo enviado' }),
    );
    const sem = await porta
      .gravar(contexto(m), T('x'), (g) =>
        g.decidir({
          id: r.id,
          versao: 3,
          usuario: 'x',
          situacao: 'autorizada',
          itens: [],
          diarias: null,
          auditor: null as unknown as number,
          critica: null,
          fundamento: null,
          parecer: 'ok',
          senha: null,
          senhaValidade: null,
        }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(sem).toBe('senha-obrigatoria');
    const senha = `L0209S${Date.now() % 1_000_000}`;
    await porta.gravar(contexto(m), T('operadora.autorizacao.decidida'), (g) =>
      g.decidir({
        id: r.id,
        versao: 3,
        usuario: 'x',
        situacao: 'autorizada',
        itens: [],
        diarias: null,
        auditor: null as unknown as number,
        critica: null,
        fundamento: 'rol',
        parecer: 'Autorizado',
        senha,
        senhaValidade: '2099-12-31',
      }),
    );
    const d = await porta.autorizacao(contexto(m), r.id);
    expect(d).toMatchObject({
      situacao: 'autorizada',
      senha,
      parecer: 'Autorizado',
      fundamento: 'rol',
      decididaPor: 'l0209.teste',
    });
    expect((await porta.eventos(contexto(m), r.id)).map((e) => e.evento)).toEqual([
      'registro',
      'complemento-pedido',
      'complemento-resposta',
      'decisao',
    ]);
    expect(
      (
        await ler(
          "SELECT id FROM trilha_auditoria WHERE entidade = 'pedido_autorizacao_plano' AND entidade_id = ?",
          [r.id],
        )
      ).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      await ler(
        "SELECT id FROM integracao_mensagem WHERE ponto = 'operadora.autorizacao.gravacao' AND entidade_id = ?",
        [r.id],
      ),
    ).not.toHaveLength(0);
    const lista = await porta.autorizacoes(contexto(m), { situacao: 'autorizada' });
    expect(lista.itens.map((x) => x.id)).toContain(r.id);
    expect(await porta.autorizacao(contexto(m, m.outroEst), r.id)).toBeNull();
    expect((await porta.totais(contexto(m))).decididasHoje).toBeGreaterThanOrEqual(1);
    expect(await porta.autorizacoesPorSenha(contexto(m), [senha])).toEqual([
      expect.objectContaining({
        id: r.id,
        senha,
        situacao: 'autorizada',
        beneficiario: m.beneficiario,
        prestadores: [m.prestador],
        validade: '2099-12-31',
      }),
    ]);
    expect(await porta.autorizacoesPorSenha(contexto(m, m.outroEst), [senha])).toEqual([]);
  });

  it('designa auditor, abre a junta e conclui na decisão; encerra o auditor só com redistribuição', async () => {
    const a1 = await porta.gravar(contexto(m), trilhaTela(m, 'auditor_plano', 'x'), (g) =>
      g.designar({
        operadora: m.operadora,
        login: 'l0209.teste',
        nome: 'x',
        categoria: 'medico',
        conselho: conselho.sigla,
        numero: '902090',
        uf: conselho.uf,
        inicio: '2026-01-01',
        usuario: 'x',
      }),
    );
    const a2 = await porta.gravar(contexto(m), trilhaTela(m, 'auditor_plano', 'x'), (g) =>
      g.designar({
        operadora: m.operadora,
        login: 'l0209.teste',
        nome: 'x',
        categoria: 'medico',
        conselho: conselho.sigla,
        numero: '902090',
        uf: conselho.uf,
        inicio: '2026-01-02',
        usuario: 'x',
      }),
    );
    expect((await porta.designacoes(contexto(m), 'l0209.teste')).map((x) => x.id)).toEqual(
      expect.arrayContaining([a1.id, a2.id]),
    );
    const T2 = (r: { id: number }) => ({
      ...trilhaTela(m, 'auditor_plano', 'x')(r),
      motivo: 'categoria corrigida',
    });
    const semCadastro = await porta
      .gravar(contexto(m), T2, (g) =>
        g.alterar({
          id: a2.id,
          versao: 1,
          usuario: 'x',
          categoria: 'enfermeiro',
          conselho: conselho.sigla,
          numero: '999999999',
          uf: conselho.uf,
          motivo: 'x',
        }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(semCadastro).toBe('profissional-nao-cadastrado');
    const alt = await porta.gravar(contexto(m), T2, (g) =>
      g.alterar({
        id: a2.id,
        versao: 1,
        usuario: 'x',
        categoria: 'enfermeiro',
        conselho: conselho.sigla,
        numero: '902090',
        uf: conselho.uf,
        motivo: 'categoria corrigida',
      }),
    );
    // O nome devolvido é o do cadastro do profissional; o motivo fica na trilha da operação.
    expect(alt).toEqual({ id: a2.id, versao: 2, nome: expect.any(String) });
    expect(alt.nome.length).toBeGreaterThan(0);
    expect(
      await ler(
        "SELECT motivo FROM trilha_auditoria WHERE entidade = 'auditor_plano' AND entidade_id = ? AND motivo IS NOT NULL",
        [a2.id],
      ),
    ).toEqual([{ motivo: 'categoria corrigida' }]);
    expect(await ler('SELECT categoria FROM auditor_plano WHERE id = ?', [a2.id])).toEqual([
      { categoria: 'enfermeiro' },
    ]);
    const velha = await porta
      .gravar(contexto(m), T2, (g) =>
        g.alterar({
          id: a2.id,
          versao: 1,
          usuario: 'x',
          categoria: 'medico',
          conselho: conselho.sigla,
          numero: '902090',
          uf: conselho.uf,
          motivo: 'x',
        }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(velha).toBe('auditor-desatualizado');
    const r = await registrar('L0209-A2');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't0209' }, (e) =>
      e.executar('UPDATE pedido_autorizacao_plano SET auditor_plano_id = ? WHERE id = ?', [a1.id, r.id]),
    );
    await porta.gravar(contexto(m), T('x'), (g) =>
      g.abrirJunta({
        id: r.id,
        versao: 1,
        usuario: 'x',
        divergencia: 'Divergência técnica sintética',
        desempatador: { nome: 'DESEMPATADOR', crm: '1', uf: conselho.uf },
        notificadosEm: new Date().toISOString(),
      }),
    );
    expect((await porta.autorizacao(contexto(m), r.id))?.junta).toMatchObject({
      divergencia: 'Divergência técnica sintética',
      parecer: null,
    });
    const recusa = await porta
      .gravar(contexto(m), trilhaTela(m, 'auditor_plano', 'x'), (g) =>
        g.encerrar({ id: a1.id, versao: 1, usuario: 'x', motivo: 'saiu' }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(recusa).toBe('auditor-com-autorizacoes');
    const enc = await porta.gravar(contexto(m), trilhaTela(m, 'auditor_plano', 'x'), (g) =>
      g.encerrar({ id: a1.id, versao: 1, usuario: 'x', motivo: 'saiu', redistribuirPara: a2.id }),
    );
    expect(enc.redistribuidos).toBe(1);
    const [p] = await ler('SELECT auditor_plano_id, versao FROM pedido_autorizacao_plano WHERE id = ?', [
      r.id,
    ]);
    expect(Number(p!['auditor_plano_id'])).toBe(a2.id);
    await porta.gravar(contexto(m), T('x'), (g) =>
      g.decidir({
        id: r.id,
        versao: Number(p!['versao']),
        usuario: 'x',
        situacao: 'negada',
        itens: [],
        diarias: null,
        auditor: a2.id,
        critica: m.critica,
        fundamento: null,
        parecer: 'Negado',
        senha: null,
        senhaValidade: null,
        parecerJunta: 'Desempatador com a operadora',
      }),
    );
    const [j] = await ler(
      'SELECT situacao, conclusao FROM junta_divergencia_tecnica WHERE pedido_autorizacao_plano_id = ?',
      [r.id],
    );
    expect(j).toMatchObject({ situacao: 'concluida', conclusao: 'favoravel_operadora' });
  });

  it('cancela com o motivo do cadastro; recusa outro estabelecimento e versão velha', async () => {
    const r = await registrar('L0209-A3');
    const fora = await porta
      .gravar(contexto(m, m.outroEst), trilhaTela(m, 'pedido_autorizacao_plano', 'x', m.outroEst), (g) =>
        g.cancelar({ id: r.id, versao: 1, usuario: 'x', motivo: 'x' }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(fora).toBe('registro-inexistente');
    await porta.gravar(contexto(m), T('x'), (g) =>
      g.cancelar({ id: r.id, versao: 1, usuario: 'x', motivo: 'Pedido em duplicidade' }),
    );
    const [p] = await ler(
      'SELECT situacao, motivo_cancelamento_guia_plano_id FROM pedido_autorizacao_plano WHERE id = ?',
      [r.id],
    );
    expect(p!['situacao']).toBe('cancelada');
    expect(p!['motivo_cancelamento_guia_plano_id']).not.toBeNull();
    const velha = await porta
      .gravar(contexto(m), T('x'), (g) =>
        g.pedirComplemento({ id: r.id, versao: 1, usuario: 'x', pedido: 'x' }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(['conflito-versao', 'pedido-nao-em-analise']).toContain(velha);
    expect((await porta.dominios(contexto(m))).tipoGuia.map((x) => x.codigo)).toContain(m.tipoGuia);
    // Catálogos (TUSS e CID-10) lidos de termo_terminologia: sem o termo, nenhum resultado (nunca 501).
    expect(await porta.procedimentosTuss(contexto(m), [])).toEqual([]);
    expect(await porta.procedimentosTuss(contexto(m), ['99999999'])).toEqual([]);
    expect(await porta.buscarTuss(contexto(m), 'zz')).toEqual([]);
    expect(await porta.nomeDoCid(contexto(m), 'U99.9')).toBeNull();
    // A ficha pelo serviço abre sobre o banco (anexos sem dado: lista vazia).
    const ficha = await new ServicoAutorizacaoOperadora(porta).detalhe(contexto(m), r.id);
    expect(ficha).toMatchObject({ id: r.id });
  });

  it('registro pelo serviço sobre o banco: a conferência chega à regra de negócio (sem 501)', async () => {
    const servico = new ServicoAutorizacaoOperadora(porta);
    const e = {
      operadora: m.operadora,
      carteirinha: 'L02090001',
      prestador: m.prestador,
      executante: null,
      guiaPrincipal: null,
      tipoGuia: m.tipoGuia,
      carater: 'E',
      altaComplexidade: false,
      origem: m.origemGuia,
      cid: 'Z00',
      indicacaoClinica: 'Indicação clínica sintética',
      profissional: { nome: 'MEDICO SINTETICO', conselho: 'CRM', numero: '902090', uf: 'SP' },
      internacao: null,
      itens: [{ tabela: 22, codigo: '10101012', quantidade: 1 }],
    } as unknown as Parameters<ServicoAutorizacaoOperadora['conferirRegistro']>[1];
    // O pendente (501) viria como ErroOperacao com o problema; a regra de negócio vem como ErroProblema (409).
    const erro = await servico.conferirRegistro(contexto(m), e).then(
      () => null,
      (x: unknown) => x,
    );
    expect(codigoDe(erro)).not.toBe('modelo-pendente');
    expect(erro).toMatchObject({ tipo: 'recusa-de-negocio' });
  });
});
