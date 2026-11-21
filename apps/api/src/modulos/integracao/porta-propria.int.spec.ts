// Integração da porta própria das integrações contra o MariaDB real (cliente f22_o4; massa sintética, sem pessoa).
// Contrato de efeito de cada gravação: as linhas, a versão, a trilha e a mensagem de saída; e as recusas (outro
// estabelecimento, parceiro desconhecido, transação que falha não deixa evento). SGH_NUCLEO_SEM_BANCO=1 pula.
import { ErroOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  garantirEstabelecimento,
  garantirPadroes,
  limparFilaComum,
  limparParceiro,
  SEM_BANCO,
} from './infra/massa-integracao.spec-util.js';
import type { ContextoIntegracao, DadosParceiro, TrilhaIntegracao } from './porta.js';
import { PortaIntegracaoPropria } from './porta-propria.js';

const PARCEIRO = 'f2241-lab';
const PONTO_TESTE = 'integracao.teste.f2241';
const A: ContextoIntegracao = { rede: 'rede-teste', hospital: 'f2241a', correlacao: 'teste-f2241-porta' };
const B: ContextoIntegracao = { rede: 'rede-teste', hospital: 'f2241b', correlacao: 'teste-f2241-porta' };
const DADOS: DadosParceiro = {
  codigo: PARCEIRO,
  nome: 'Laboratório de teste do lote 04-01',
  tipo: 'apoio',
  canal: null,
  escopos: ['resultado.enviar'],
  eventos: ['fato.exame.apoio'],
  limiteTentativas: 3,
  finalidade: 'Teste automatizado da integração.',
  baseLegal: 'tutela-da-saude',
};
const trilha = (entidade: string, evento: string): TrilhaIntegracao => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade,
  entidadeId: null,
  dadosDepois: { evento, recurso: 'integracao.teste' },
  correlacao: 'teste-f2241-porta',
});

const AP = 'f2241-ap';

/** A massa sintética do resultado do apoio (códigos f2241-ap*; nenhuma pessoa real). */
async function limparApoio(e: Escritor): Promise<void> {
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    const itens = `SELECT i.id FROM exame_item i JOIN requisicao_exame q ON q.id = i.requisicao_exame_id WHERE q.numero LIKE 'f2241-ap-%'`;
    const res = `SELECT r.id FROM resultado_exame r WHERE r.exame_item_id IN (${itens})`;
    await e.executar(`DELETE FROM aviso_valor_critico WHERE resultado_exame_id IN (${res})`);
    await e.executar(`DELETE FROM resultado_analito WHERE resultado_exame_id IN (${res})`);
    await e.executar(`DELETE FROM resultado_exame WHERE exame_item_id IN (${itens})`);
    await e.executar(`DELETE FROM exame_item WHERE id IN (SELECT id FROM (${itens}) x)`);
    await e.executar("DELETE FROM requisicao_exame WHERE numero LIKE 'f2241-ap-%'");
    const eas = "SELECT ea.id FROM exame_analito ea JOIN exame x ON x.id = ea.exame_id WHERE x.codigo LIKE 'f2241-ap%'";
    await e.executar(`DELETE FROM faixa_referencia WHERE exame_analito_id IN (${eas})`);
    await e.executar("DELETE FROM regra_valor_critico WHERE analito_id IN (SELECT id FROM analito WHERE codigo LIKE 'f2241-ap%')");
    await e.executar(`DELETE FROM exame_analito WHERE id IN (SELECT id FROM (${eas}) x)`);
    await e.executar("DELETE FROM exame_setor_executante WHERE exame_id IN (SELECT id FROM exame WHERE codigo LIKE 'f2241-ap%')");
    await e.executar("DELETE FROM exame WHERE codigo LIKE 'f2241-ap%'");
    await e.executar("DELETE FROM analito WHERE codigo LIKE 'f2241-ap%'");
    await e.executar('DELETE FROM laboratorio_apoio WHERE codigo = ?', [AP]);
    await e.executar('DELETE FROM setor_diagnostico WHERE codigo = ?', [AP]);
    await e.executar("DELETE FROM paciente WHERE numero_prontuario = 922410001");
    await e.executar("DELETE FROM profissional WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE '% SINTETICO F2241')");
    await e.executar("DELETE FROM pessoa_fisica WHERE nome LIKE '% SINTETICO F2241'");
    await e.executar(
      "DELETE FROM integracao_mensagem WHERE ponto = 'fato.resultado.liberado' AND estabelecimento_id = (SELECT id FROM estabelecimento WHERE codigo = 'f2241a')",
    );
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

interface MassaApoio {
  readonly est: number;
  readonly setor: number;
  readonly lab: number;
  readonly conferente: number;
  readonly glicose: number;
  readonly potassio: number;
  readonly regra: number;
  readonly item: number;
  readonly semSetor: number;
}

/** Catálogo e pedido sintéticos (as chaves de catálogo que a operação não grava entram com as FKs desligadas). */
async function montarApoio(e: Escritor): Promise<MassaApoio> {
  await limparApoio(e);
  const agora = new Date();
  const est = Number((await e.uma<{ id: unknown }>("SELECT id FROM estabelecimento WHERE codigo = 'f2241a'"))!.id);
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    const pf = await e.inserir("INSERT INTO pessoa_fisica (nome, criado_em) VALUES ('PACIENTE SINTETICO F2241', ?)", [agora]);
    const pac = await e.inserir('INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, 922410001, ?)', [pf, agora]);
    const pfp = await e.inserir("INSERT INTO pessoa_fisica (nome, criado_em) VALUES ('PROFISSIONAL SINTETICO F2241', ?)", [agora]);
    const conferente = await e.inserir("INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'assistencial', ?)", [pfp, agora]);
    const setor = await e.inserir(
      "INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'SETOR SINTETICO', 'laboratorio', ?)",
      [est, AP, agora],
    );
    const lab = await e.inserir(
      "INSERT INTO laboratorio_apoio (estabelecimento_id, codigo, nome, empresa_fornecedora_id, criado_em) VALUES (?, ?, 'APOIO SINTETICO', 1, ?)",
      [est, AP, agora],
    );
    const exame = (codigo: string, sigla: string) =>
      e.inserir("INSERT INTO exame (codigo, sigla, nome, tipo_servico, criado_em) VALUES (?, ?, 'EXAME SINTETICO', 'laboratorio', ?)", [
        codigo,
        sigla,
        agora,
      ]);
    const ex1 = await exame(`${AP}-1`, 'F2241AP1');
    const ex2 = await exame(`${AP}-2`, 'F2241AP2');
    await e.inserir('INSERT INTO exame_setor_executante (exame_id, setor_diagnostico_id, padrao, criado_em) VALUES (?, ?, TRUE, ?)', [
      ex1,
      setor,
      agora,
    ]);
    const analito = (codigo: string) =>
      e.inserir("INSERT INTO analito (codigo, nome, criado_em) VALUES (?, 'ANALITO SINTETICO', ?)", [codigo, agora]);
    const glicose = await analito(`${AP}-gli`);
    const potassio = await analito(`${AP}-pot`);
    const ea = (ex: number, an: number, ordem: number) =>
      e.inserir('INSERT INTO exame_analito (exame_id, analito_id, ordem, criado_em) VALUES (?, ?, ?, ?)', [ex, an, ordem, agora]);
    const eaGli = await ea(ex1, glicose, 1);
    await ea(ex1, potassio, 2);
    await ea(ex2, glicose, 1);
    await e.inserir(
      `INSERT INTO faixa_referencia (exame_analito_id, referencia_minima, referencia_maxima, referencia_texto, vigencia_inicio, criado_em)
       VALUES (?, 70, 99, '70 a 99', '2020-01-01', ?)`,
      [eaGli, agora],
    );
    const regra = await e.inserir(
      `INSERT INTO regra_valor_critico (estabelecimento_id, analito_id, limite_inferior, limite_superior, prazo_comunicacao_minutos,
         vigencia_inicio, criado_em) VALUES (?, ?, 2.5, 6.5, 15, '2020-01-01', ?)`,
      [est, potassio, agora],
    );
    const item = async (n: number, ex: number) => {
      const req = await e.inserir(
        `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
           solicitante_profissional_id, fonte_pagadora_id, solicitado_em, criado_em) VALUES (?, ?, ?, 1, ?, 1, 1, ?, ?)`,
        [est, `${AP}-${n}`, pac, setor, agora, agora],
      );
      // O exame terceirizado: sem setor no pedido, com o laboratório de apoio.
      return e.inserir(
        "INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, laboratorio_apoio_id, situacao, criado_em) VALUES (?, 1, ?, ?, 'em_analise', ?)",
        [req, ex, lab, agora],
      );
    };
    return { est, setor, lab, conferente, glicose, potassio, regra, item: await item(1, ex1), semSetor: await item(2, ex2) };
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
}

describe.skipIf(SEM_BANCO)('porta própria das integrações contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaIntegracaoPropria;
  const sql = <T extends Record<string, unknown>>(q: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f2241' }, (l) => l.consultar<T>(q, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f2241' }, async (e) => {
      await limparParceiro(e, PARCEIRO);
      await limparFilaComum(e, PONTO_TESTE);
      await garantirEstabelecimento(e, 'f2241a');
      await garantirEstabelecimento(e, 'f2241b');
      await garantirPadroes(e);
    });
    porta = new PortaIntegracaoPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f2241' }, async (e) => {
      await limparApoio(e);
      await limparParceiro(e, PARCEIRO);
      await limparFilaComum(e, PONTO_TESTE);
    });
    await nucleo.encerrar();
  });

  it('cria o parceiro desligado, com sistema externo, cliente da API e chave; a trilha na mesma transação', async () => {
    await porta.gravar(A, trilha('parceiro_dados', 'integracao.parceiro.alterado'), async (g) => {
      await g.criarParceiro(DADOS, 'teste');
      await g.gravarCredencial(PARCEIRO, 'f2241-lab.cliente1', 'a'.repeat(64), 'teste');
    });
    const p = await porta.parceiro(A, PARCEIRO);
    expect(p).toMatchObject({ codigo: PARCEIRO, ativo: false, temSegredo: true, clienteId: 'f2241-lab.cliente1' });
    expect(p?.escopos).toEqual(['resultado.enviar']);
    const [linha] = await sql('SELECT versao, sistema_externo_id, cliente_api_id FROM parceiro_dados WHERE codigo = ?', [PARCEIRO]);
    expect(linha?.['sistema_externo_id']).not.toBeNull();
    expect(Number(linha?.['versao'])).toBeGreaterThanOrEqual(2);
    const chaves = await sql('SELECT sequencia, situacao FROM chave_api WHERE cliente_api_id = ?', [linha?.['cliente_api_id']]);
    expect(chaves).toEqual([{ sequencia: 1, situacao: 'ativa' }]);
    const t = await sql(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'parceiro_dados' AND correlacao = 'teste-f2241-porta'",
    );
    expect(Number(t[0]?.['n'])).toBeGreaterThan(0);
    // Código repetido: recusa, nada novo.
    await expect(porta.gravar(A, trilha('parceiro_dados', 'x'), (g) => g.criarParceiro(DADOS, 'teste'))).rejects.toBeInstanceOf(ErroOperacao);
  });

  it('a credencial só vale com o parceiro ativo; a troca revoga a chave anterior e guarda o histórico', async () => {
    expect((await porta.credencial(A, 'f2241-lab.cliente1'))?.ativo).toBe(false);
    const n = await porta.gravar(A, trilha('parceiro_dados', 'integracao.parceiro.alterado'), (g) =>
      g.alterarParceiro(PARCEIRO, { ...DADOS, ativo: true }, 'teste'),
    );
    expect(n).toBe(1);
    expect(await porta.credencial(A, 'f2241-lab.cliente1')).toEqual({
      codigo: PARCEIRO,
      resumo: 'a'.repeat(64),
      ativo: true,
      escopos: ['resultado.enviar'],
    });
    // A credencial emitida na sessão de A não vale na rota de B (restrita ao estabelecimento que a emitiu).
    expect((await porta.credencial(B, 'f2241-lab.cliente1'))?.ativo).toBe(false);
    const [ca] = await sql(
      `SELECT ca.estabelecimento_id, e.codigo FROM cliente_api ca JOIN parceiro_dados p ON p.cliente_api_id = ca.id
         JOIN estabelecimento e ON e.id = ca.estabelecimento_id WHERE p.codigo = ?`,
      [PARCEIRO],
    );
    expect(ca?.['codigo']).toBe('f2241a');
    // A troca da credencial pela sessão de B é recusada (a credencial é de A).
    await expect(
      porta.gravar(B, trilha('parceiro_dados', 'x'), (g) => g.gravarCredencial(PARCEIRO, 'f2241-lab.clienteb', 'z'.repeat(64), 'teste')),
    ).rejects.toMatchObject({ problema: { codigo: 'outro-estabelecimento' } });
    // Estabelecimento desconhecido: falha fechada.
    expect((await porta.credencial({ rede: 'x', hospital: 'f2241zz' }, 'f2241-lab.cliente1'))?.ativo).toBe(false);
    await porta.gravar(A, trilha('parceiro_dados', 'integracao.parceiro.alterado'), (g) =>
      g.gravarCredencial(PARCEIRO, 'f2241-lab.cliente2', 'b'.repeat(64), 'teste'),
    );
    expect(await porta.credencial(A, 'f2241-lab.cliente1')).toBeNull();
    expect((await porta.credencial(A, 'f2241-lab.cliente2'))?.resumo).toBe('b'.repeat(64));
    const chaves = await sql(
      `SELECT k.sequencia, k.situacao FROM chave_api k JOIN parceiro_dados p ON p.cliente_api_id = k.cliente_api_id
        WHERE p.codigo = ? ORDER BY k.sequencia`,
      [PARCEIRO],
    );
    expect(chaves).toEqual([
      { sequencia: 1, situacao: 'revogada' },
      { sequencia: 2, situacao: 'ativa' },
    ]);
  });

  it('a entrada é idempotente pela chave do parceiro; a conferência conclui uma vez; outro estabelecimento não vê', async () => {
    const nova = {
      parceiro: PARCEIRO,
      tipo: 'ORU^R01',
      chaveParceiro: 'F2241-MSG-0001',
      hash: 'c'.repeat(64),
      chaveS3: 'f2241a/f2241-lab/entrada/teste.txt',
      tamanho: 120,
      situacao: 'conferir' as const,
      detalhe: '1 valor(es)',
      tabelaObjeto: 'exame_item',
      idObjeto: '777',
    };
    const r1 = await porta.gravar(A, trilha('mensagem_integracao_entrada', 'integracao.mensagem.recebida'), (g) => g.registrarRecebida(nova));
    const r2 = await porta.gravar(A, trilha('mensagem_integracao_entrada', 'integracao.mensagem.recebida'), (g) => g.registrarRecebida(nova));
    expect(r1.repetida).toBe(false);
    expect(r2).toMatchObject({ repetida: true, recebida: { id: r1.recebida.id } });
    expect(r1.recebida).toMatchObject({ situacao: 'conferir', parceiro: PARCEIRO, chaveS3: nova.chaveS3, tamanho: 120 });
    const linhas = await sql(
      `SELECT m.situacao, a.hash_sha256, m.versao FROM mensagem_integracao_entrada m JOIN arquivo a ON a.id = m.arquivo_id
        WHERE m.id = ?`,
      [Number(r1.recebida.id)],
    );
    expect(linhas).toEqual([{ situacao: 'validada', hash_sha256: 'c'.repeat(64), versao: 1 }]);
    expect((await porta.recebidas(A, { situacao: 'conferir', limite: 10 })).map((x) => x.id)).toContain(r1.recebida.id);
    expect(await porta.recebida(B, r1.recebida.id)).toBeNull();
    const fim = { situacao: 'recusada' as const, detalhe: 'teste', tabelaObjeto: null, idObjeto: null, usuario: 'teste' };
    expect(await porta.gravar(B, trilha('mensagem_integracao_entrada', 'x'), (g) => g.concluirRecebida(r1.recebida.id, fim))).toBe(0);
    expect(await porta.gravar(A, trilha('mensagem_integracao_entrada', 'x'), (g) => g.concluirRecebida(r1.recebida.id, fim))).toBe(1);
    expect(await porta.gravar(A, trilha('mensagem_integracao_entrada', 'x'), (g) => g.concluirRecebida(r1.recebida.id, fim))).toBe(0);
    expect((await porta.recebida(A, r1.recebida.id))?.situacao).toBe('recusada');
    await expect(
      porta.gravar(A, trilha('mensagem_integracao_entrada', 'x'), (g) => g.registrarRecebida({ ...nova, parceiro: 'f2241-nenhum' })),
    ).rejects.toBeInstanceOf(ErroOperacao);
  });

  it('a mensagem de saída vai na mesma transação; a entrega é idempotente; o morto é tratado com a falha registrada', async () => {
    // Regra 7: a transação que falha não deixa evento.
    await expect(
      porta.gravar(A, trilha('integracao_mensagem', 'x'), async (g) => {
        await g.outbox({ tipo: PONTO_TESTE, chave: 'f2241-desfeita', carga: { parceiro: PARCEIRO } });
        throw new Error('falha de propósito');
      }),
    ).rejects.toThrow(/Nada foi gravado/);
    expect(await sql("SELECT id FROM integracao_mensagem WHERE referencia_externa = 'f2241-desfeita'")).toEqual([]);
    const idOutbox = await porta.gravar(A, trilha('integracao_mensagem', 'integracao.configuracao.alterada'), (g) =>
      g.outbox({ tipo: PONTO_TESTE, chave: 'f2241-evento-1', carga: { parceiro: PARCEIRO, origem: 'teste' } }),
    );
    const envio = {
      idOutbox,
      chaveEvento: 'f2241-evento-1',
      tipoEvento: 'fato.exame.apoio',
      parceiro: PARCEIRO,
      chaveOrdem: 'paciente-1',
      tabelaFato: 'exame_item',
      idFato: '777',
    };
    expect(await porta.gravar(A, trilha('mensagem_integracao_saida', 'x'), (g) => g.registrarEnvio(envio))).toBe(true);
    expect(await porta.gravar(A, trilha('mensagem_integracao_saida', 'x'), (g) => g.registrarEnvio(envio))).toBe(false);
    const [e] = await porta.envios(A, { parceiro: PARCEIRO, limite: 10 });
    expect(e).toMatchObject({ situacao: 'pendente', idOutbox, chaveEvento: 'f2241-evento-1', tabelaFato: 'exame_item' });
    expect(await porta.envios(B, { parceiro: PARCEIRO, limite: 10 })).toEqual([]);
    // O worker esgota as tentativas (a fila de mortos).
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f2241' }, (w) =>
      w.executar("UPDATE mensagem_integracao_saida SET situacao = 'erro', tentativas = 3 WHERE id = ?", [Number(e!.id)]),
    );
    expect((await porta.mortos(A)).map((m) => m.id)).toContain(e!.id);
    const n = await porta.gravar(A, trilha('mensagem_integracao_saida', 'integracao.morto.tratado'), (g) =>
      g.tratarMorto(e!.id, { acao: 'reprocessar', motivo: 'parceiro voltou', usuario: 'teste' }),
    );
    expect(n).toBe(1);
    const depois = await porta.envio(A, e!.id);
    expect(depois).toMatchObject({ situacao: 'pendente', tentativas: 0, tratamento: 'reprocessar', motivoTratamento: 'parceiro voltou' });
    const falhas = await sql('SELECT situacao, reprocessamentos FROM falha_integracao WHERE mensagem_integracao_saida_id = ?', [Number(e!.id)]);
    expect(falhas).toEqual([{ situacao: 'reprocessada', reprocessamentos: 1 }]);
    expect(
      await porta.gravar(A, trilha('mensagem_integracao_saida', 'x'), (g) =>
        g.tratarMorto(e!.id, { acao: 'descartar', motivo: 'não está morto', usuario: 'teste' }),
      ),
    ).toBe(0);
    const c = await porta.contagens(A);
    expect(c.envios).toContainEqual({ chave: PARCEIRO, situacao: 'pendente', quantidade: 1 });
    expect(c.outbox.some((x) => x.chave === PONTO_TESTE)).toBe(true);
    const saude = await porta.saudeFilas(A);
    expect(saude.filas.map((f) => f.fila)).toContain(`parceiro.${PARCEIRO}.saida`);
  });

  it('resultado do apoio pelas regras do SADT: referência, anormal, crítico com aviso, liberação e mensagem concluída juntos', async () => {
    const m = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f2241' }, (e) => montarApoio(e));
    const { recebida } = await porta.gravar(A, trilha('mensagem_integracao_entrada', 'integracao.mensagem.recebida'), (g) =>
      g.registrarRecebida({
        parceiro: PARCEIRO,
        tipo: 'ORU^R01',
        chaveParceiro: 'F2241-MSG-AP01',
        hash: 'd'.repeat(64),
        chaveS3: 'f2241a/f2241-lab/entrada/apoio.txt',
        tamanho: 90,
        situacao: 'conferir',
        detalhe: '2 valor(es)',
        tabelaObjeto: 'exame_item',
        idObjeto: String(m.item),
      }),
    );
    expect(await porta.exameDoRetorno(A, m.item)).toMatchObject({ laboratorio: m.lab, digitado: false });
    const octx = (chave: string) => ({
      cliente: CLIENTE,
      estabelecimento: null,
      usuario: null,
      correlacao: 'teste-f2241-apoio',
      chaveIdempotencia: chave,
      rede: 'x',
      hospital: 'f2241a',
      login: 'teste',
      estacao: 'teste',
    });
    const chave = `f2241-apoio-${Date.now()}`;
    const entrada = {
      exame: m.item,
      versao: 1,
      laboratorio: null,
      elementos: [
        { elemento: m.potassio, numerico: 7.2, alfa: null },
        { elemento: m.glicose, numerico: 120, alfa: null },
      ],
      observacao: 'Laboratório de apoio, protocolo de teste.',
      conferente: m.conferente,
      recebida: recebida.id,
    };
    const r = await porta.registrarResultadoApoio(A, entrada, octx(chave));
    expect(r.repetida).toBe(false);
    const [re] = await sql(
      `SELECT situacao, setor_diagnostico_id, laboratorio_apoio_id, forma_entrada, anormal, critico, origem,
              liberado_por_profissional_id, liberado_em IS NOT NULL AS liberado FROM resultado_exame WHERE id = ?`,
      [r.resultado],
    );
    expect(re).toMatchObject({
      situacao: 'liberado',
      setor_diagnostico_id: m.setor,
      laboratorio_apoio_id: m.lab,
      forma_entrada: 'laboratorio_apoio',
      origem: 'integracao',
      liberado_por_profissional_id: m.conferente,
    });
    expect([Number(re?.['anormal']), Number(re?.['critico']), Number(re?.['liberado'])]).toEqual([1, 1, 1]);
    const valores = await sql(
      `SELECT analito_id, sequencia, interpretacao, anormal, critico, referencia_minimo, referencia_maximo, critico_maximo, origem
         FROM resultado_analito WHERE resultado_exame_id = ? ORDER BY sequencia`,
      [r.resultado],
    );
    expect(
      valores.map((v) => [
        v['analito_id'],
        v['sequencia'],
        v['interpretacao'],
        Number(v['anormal']),
        Number(v['critico']),
        v['referencia_minimo'] === null ? null : Number(v['referencia_minimo']),
        v['critico_maximo'] === null ? null : Number(v['critico_maximo']),
        v['origem'],
      ]),
    ).toEqual([
      [m.glicose, 1, 'alto', 1, 0, 70, null, 'integracao'],
      [m.potassio, 2, 'critico_alto', 1, 1, null, 6.5, 'integracao'],
    ]);
    const avisos = await sql(
      `SELECT regra_valor_critico_id, situacao, origem, TIMESTAMPDIFF(MINUTE, gerado_em, prazo_em) AS prazo
         FROM aviso_valor_critico WHERE resultado_exame_id = ?`,
      [r.resultado],
    );
    expect(avisos.map((a) => [a['regra_valor_critico_id'], a['situacao'], a['origem'], Number(a['prazo'])])).toEqual([
      [m.regra, 'pendente', 'integracao', 15],
    ]);
    expect(await sql('SELECT situacao, versao FROM exame_item WHERE id = ?', [m.item])).toEqual([{ situacao: 'liberado', versao: 2 }]);
    expect((await porta.recebida(A, recebida.id))?.situacao).toBe('processada');
    const t = await sql("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'resultado_exame' AND entidade_id = ?", [r.resultado]);
    expect(Number(t[0]?.['n'])).toBe(1);
    const fato = await sql(
      "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'fato.resultado.liberado' AND estabelecimento_id = ?",
      [m.est],
    );
    expect(Number(fato[0]?.['n'])).toBe(1);
    // A mesma aprovação de novo: o resultado da primeira, sem gravar outra vez.
    expect(await porta.registrarResultadoApoio(A, entrada, octx(chave))).toEqual({ resultado: r.resultado, repetida: true });
    // Recusas: analito que não é do exame; exame sem setor executante no estabelecimento (nunca o setor 0).
    await expect(
      porta.registrarResultadoApoio(
        A,
        { ...entrada, exame: m.semSetor, elementos: [{ elemento: m.potassio, numerico: 4, alfa: null }], recebida: null },
        octx(`${chave}-a`),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'elemento-inexistente' } });
    await expect(
      porta.registrarResultadoApoio(
        A,
        { ...entrada, exame: m.semSetor, elementos: [{ elemento: m.glicose, numerico: 90, alfa: null }], recebida: null },
        octx(`${chave}-b`),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'sem-setor-executante' } });
    expect(Number((await sql('SELECT COUNT(*) AS n FROM resultado_exame WHERE exame_item_id = ?', [m.semSetor]))[0]?.['n'])).toBe(0);
  });

  it('recusas: estabelecimento desconhecido, exame inexistente no resultado do apoio; leituras vazias fora do estabelecimento', async () => {
    await expect(
      porta.gravar({ rede: 'x', hospital: 'f2241zz' }, trilha('parceiro_dados', 'x'), async () => 1),
    ).rejects.toMatchObject({ problema: { codigo: 'estabelecimento-desconhecido' } });
    await expect(
      porta.registrarResultadoApoio(
        A,
        {
          exame: 999_999_999,
          versao: 1,
          laboratorio: null,
          elementos: [{ elemento: 1, numerico: 1, alfa: null }],
          observacao: '',
          conferente: 1,
          recebida: null,
        },
        {
          cliente: CLIENTE,
          estabelecimento: null,
          usuario: null,
          correlacao: 'teste-f2241',
          chaveIdempotencia: `f2241-${Date.now()}`,
          rede: 'x',
          hospital: 'f2241a',
          login: 'teste',
          estacao: 'teste',
        },
      ),
    ).rejects.toBeInstanceOf(ErroOperacao);
    expect(await porta.interfacesApoio({ rede: 'x', hospital: 'f2241zz' })).toEqual([]);
    expect(await porta.exameDoRetorno(A, 999_999_999)).toBeNull();
    expect(await porta.vinculos(A, 'f2241-ninguem')).toEqual([]);
    const ident = await porta.identificacao(A);
    expect(typeof ident.pacientesComCpf).toBe('number');
    expect(ident.estabelecimentoComCnes).toBe(false);
  });
});
