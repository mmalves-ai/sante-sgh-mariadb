// Contrato de efeito do controle orçamentário na compra e no pagamento (C2-112, 07-FIN linha 130) contra o MariaDB real
// (cliente de teste; migração 14_FIN/99_reserva_orcamentaria_liberacao). Massa SINTÉTICA: estabelecimento com o código
// do teste, centro de custo, plano e conta orçamentária, versão oficial aprovada com uma linha (1.000 em março), um
// pedido de compra (800) e um título a pagar (1.000); usuários, fornecedor, tipo de credor, tipo de documento e
// natureza são ids já existentes do cliente (só lidos). Prova o que fica em `regra_controle_orcamentario`,
// `reserva_orcamentaria`, `excecao_orcamentaria` e `ajuste_orcamento_nota`: a regra de bloqueio, a reserva que cabe, a
// recusa sem gravar, a exceção justificada decidida por outra pessoa e usada pela reserva, o teto do documento, a nota
// parcial e a final com o ajuste, a liberação com o motivo, o alerta que pede ciência e o saldo em cada passo.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaControleOrcamentarioPropria } from './controle-orcamentario-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const P = 'c2112orc';
const COMP = '2027-03-01';

type Massa = Record<string, number>;

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const res = `(SELECT id FROM reserva_orcamentaria WHERE estabelecimento_id IN ${est})`;
  const ver = `(SELECT id FROM versao_orcamento WHERE estabelecimento_id IN ${est})`;
  const pla = '(SELECT id FROM plano_orcamentario WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM ajuste_orcamento_nota WHERE reserva_orcamentaria_id IN ${res}`, [P]);
    await e.executar(`DELETE FROM excecao_orcamentaria WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM reserva_orcamentaria WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM regra_controle_orcamentario WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM linha_orcamento WHERE versao_orcamento_id IN ${ver}`, [P]);
    await e.executar(`DELETE FROM versao_orcamento WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM conta_orcamentaria WHERE plano_orcamentario_id IN ${pla}`, [P]);
    await e.executar('DELETE FROM plano_orcamentario WHERE codigo = ?', [P]);
    await e.executar(`DELETE FROM pedido_compra WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM titulo_pagar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM centro_custo WHERE estabelecimento_id IN ${est}`, [P]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

const recusa = { problema: { codigo: 'regra-violada' } };

describe.skipIf(SEM_BANCO)('PortaControleOrcamentarioPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaControleOrcamentarioPropria;
  let m: Massa;
  const ctx = (usuario = m['usuario']!) => ({ cliente: CLIENTE, hospital: P, usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const contar = async () =>
    Number(
      (
        await ler(
          `SELECT (SELECT COUNT(*) FROM reserva_orcamentaria WHERE estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM excecao_orcamentaria WHERE estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM regra_controle_orcamentario WHERE estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM ajuste_orcamento_nota a JOIN reserva_orcamentaria r
                     ON r.id = a.reserva_orcamentaria_id WHERE r.estabelecimento_id = ?) AS n`,
          [m['est'], m['est'], m['est'], m['est']],
        )
      )[0]!['n'],
    );
  const saldo = (tipoDocumento = 'titulo_pagar') =>
    porta.saldo(ctx(), { linha: m['linha']!, competencia: COMP, tipoDocumento, data: '2027-03-10' });
  const reserva = async (id: number) =>
    (await ler('SELECT * FROM reserva_orcamentaria WHERE id = ?', [id]))[0]!;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const aprovador = await um(
        `SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL AND id > ${Number(usuario)}`,
      );
      const credor = await um('SELECT MIN(id) AS id FROM tipo_credor');
      const fornecedor = await um('SELECT MIN(id) AS id FROM empresa_fornecedora');
      const tipoDoc = await um('SELECT MIN(id) AS id FROM tipo_documento_financeiro');
      const natureza = await um('SELECT MIN(id) AS id FROM natureza_financeira');
      if (!usuario || !aprovador || !credor || !fornecedor || !tipoDoc || !natureza)
        throw new Error(
          'O cliente de teste precisa de dois usuários, tipo de credor, fornecedor, tipo de documento e natureza financeira.',
        );
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const cc = await e.inserir(
        `INSERT INTO centro_custo (estabelecimento_id, codigo, nome, vigencia_inicio, ativo, criado_em)
         VALUES (?, ?, 'Centro sintético', '2026-01-01', TRUE, ?)`,
        [est, `${P}-A`, agora],
      );
      const plano = await e.inserir(
        `INSERT INTO plano_orcamentario (codigo, descricao, mascara, vigencia_inicio, criado_em)
         VALUES (?, 'Plano sintético', '9.99', '2026-01-01', ?)`,
        [P, agora],
      );
      const conta = await e.inserir(
        `INSERT INTO conta_orcamentaria (plano_orcamentario_id, codigo, descricao, grau, natureza, criado_em)
         VALUES (?, '1.01', 'Material sintético', 'analitica', 'despesa', ?)`,
        [plano, agora],
      );
      const versao = await e.inserir(
        `INSERT INTO versao_orcamento (estabelecimento_id, plano_orcamentario_id, ano, numero_versao, descricao,
           vigencia_inicio, vigencia_fim, oficial, situacao, aprovado_em, aprovador_usuario_id, criado_em)
         VALUES (?, ?, 2027, 1, 'Versão sintética', '2027-01-01', '2027-12-31', TRUE, 'aprovado', ?, ?, ?)`,
        [est, plano, agora, usuario, agora],
      );
      const linha = await e.inserir(
        `INSERT INTO linha_orcamento (versao_orcamento_id, sequencia, centro_custo_id, natureza,
           natureza_financeira_id, valor_mes_03, criado_em)
         VALUES (?, 1, ?, 'despesa', ?, 1000, ?)`,
        [versao, cc, natureza, agora],
      );
      const pedido = await e.inserir(
        `INSERT INTO pedido_compra (estabelecimento_id, ano, numero, empresa_fornecedora_id, centro_custo_id,
           data_pedido, valor_produtos, valor_total, criado_em)
         VALUES (?, 2027, 902112001, ?, ?, '2027-03-05', 800, 800, ?)`,
        [est, fornecedor, cc, agora],
      );
      const titulo = await e.inserir(
        `INSERT INTO titulo_pagar (estabelecimento_id, numero, tipo_credor_id, empresa_fornecedora_id,
           tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido,
           natureza_financeira_id, criado_em)
         VALUES (?, 902112002, ?, ?, ?, 'NF-SINT-2', '2027-03-05', '2027-03-05', 1000, 1000, ?, ?)`,
        [est, credor, fornecedor, tipoDoc, natureza, agora],
      );
      return { usuario, aprovador, est, cc, plano, conta, versao, linha, pedido, titulo };
    });
    porta = new PortaControleOrcamentarioPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  }, 60_000);

  it('regra de bloqueio, reserva que cabe, recusa sem gravar, exceção aprovada por outra pessoa e usada', async () => {
    const regra = await porta.salvarRegra(ctx(), null, {
      acao: 'bloquear',
      centroCusto: m['cc']!,
      prioridade: 10,
      vigenciaInicio: '2027-01-01',
    });
    expect(regra).toMatchObject({ tabela: 'regra_controle_orcamentario' });
    const [rg] = await ler('SELECT * FROM regra_controle_orcamentario WHERE estabelecimento_id = ?', [
      m['est'],
    ]);
    expect(rg).toMatchObject({
      acao: 'bloquear',
      tipo_documento: 'todos',
      periodo_apuracao: 'mensal',
      versao: 1,
    });
    m['regra'] = Number(rg!['id']);
    expect(await saldo()).toMatchObject({ orcado: 1000, disponivel: 1000, acao: 'bloquear' });

    // O pedido inteiro cabe no saldo.
    const rp = await porta.reservar(ctx(), {
      tipoDocumento: 'pedido_compra',
      documento: m['pedido']!,
      linha: m['linha']!,
      competencia: COMP,
      data: '2027-03-10',
    });
    expect(rp).toMatchObject({ valor: 800, decisao: 'livre' });
    const [r1] = await ler('SELECT * FROM reserva_orcamentaria WHERE pedido_compra_id = ?', [m['pedido']]);
    expect(r1).toMatchObject({
      situacao: 'ativa',
      tipo_documento: 'pedido_compra',
      centro_custo_id: m['cc'],
    });
    expect(Number(r1!['valor_reservado'])).toBe(800);
    expect(Number(r1!['excedeu_saldo'])).toBe(0);
    expect(r1!['numero']).toBe(`RPC${m['pedido']}-1`);
    m['resPedido'] = Number(r1!['id']);
    expect((await saldo()).disponivel).toBe(200);

    // O título passa do saldo e a regra bloqueia: nada grava.
    const antes = await contar();
    const doTitulo = {
      tipoDocumento: 'titulo_pagar',
      documento: m['titulo']!,
      linha: m['linha']!,
      competencia: COMP,
      valor: 500,
      data: '2027-03-10',
    };
    await expect(porta.reservar(ctx(), doTitulo)).rejects.toMatchObject(recusa);
    // O pedido já está todo reservado (teto do documento).
    await expect(
      porta.reservar(ctx(), {
        ...doTitulo,
        tipoDocumento: 'pedido_compra',
        documento: m['pedido']!,
        valor: 10,
      }),
    ).rejects.toMatchObject(recusa);
    expect(await contar()).toBe(antes);

    // Exceção justificada, decidida por outra pessoa.
    const pedido = { ...doTitulo, contaOrcamentaria: m['conta']!, valor: 300 };
    await expect(porta.solicitarExcecao(ctx(), { ...pedido, justificativa: 'curta' })).rejects.toMatchObject(
      recusa,
    );
    await porta.solicitarExcecao(ctx(), {
      ...pedido,
      justificativa: 'Reposição urgente de material sintético para a unidade',
    });
    const [x] = await ler('SELECT * FROM excecao_orcamentaria WHERE estabelecimento_id = ?', [m['est']]);
    expect(x).toMatchObject({
      situacao: 'pendente',
      entidade: 'titulo_pagar',
      solicitante_usuario_id: m['usuario'],
      plano_orcamentario_id: m['plano'],
      centro_custo_id: m['cc'],
    });
    expect(Number(x!['saldo_disponivel'])).toBe(200);
    const xid = Number(x!['id']);
    await expect(porta.decidirExcecao(ctx(), xid, { versao: 1, aprovar: true })).rejects.toMatchObject(
      recusa,
    );
    await porta.decidirExcecao(ctx(m['aprovador']!), xid, { versao: 1, aprovar: true, parecer: 'De acordo' });
    const [xa] = await ler('SELECT * FROM excecao_orcamentaria WHERE id = ?', [xid]);
    expect(xa).toMatchObject({ situacao: 'aprovada', aprovado_por_usuario_id: m['aprovador'] });
    expect(xa!['decidido_em']).not.toBeNull();

    // A reserva passa com a exceção que cobre o excesso (300): marcada com o aprovador; a exceção fica utilizada.
    const rt = await porta.reservar(ctx(), doTitulo);
    expect(rt).toMatchObject({ decisao: 'excecao', excesso: 300 });
    const [r2] = await ler('SELECT * FROM reserva_orcamentaria WHERE titulo_pagar_id = ?', [m['titulo']]);
    expect(Number(r2!['excedeu_saldo'])).toBe(1);
    expect(r2!['autorizador_usuario_id']).toBe(m['aprovador']);
    m['resTitulo'] = Number(r2!['id']);
    const [xu] = await ler(
      'SELECT situacao, reserva_orcamentaria_id FROM excecao_orcamentaria WHERE id = ?',
      [xid],
    );
    expect(xu).toMatchObject({ situacao: 'utilizada', reserva_orcamentaria_id: m['resTitulo'] });
    expect((await saldo()).disponivel).toBe(-300);
  });

  it('nota parcial e final com o ajuste, liberação com o motivo e o alerta que pede ciência', async () => {
    const rp = Number((await reserva(m['resPedido']!))['versao']);
    await porta.registrarNota(ctx(), m['resPedido']!, {
      versao: rp,
      valorRealizado: 300,
      final: false,
      numeroDocumento: 'NF-SINT-P1',
    });
    let r = await reserva(m['resPedido']!);
    expect(r).toMatchObject({ situacao: 'parcial' });
    expect(Number(r['valor_consumido'])).toBe(300);
    // Versão velha: conflito, nada grava.
    await expect(
      porta.registrarNota(ctx(), m['resPedido']!, { versao: rp, valorRealizado: 10, final: false }),
    ).rejects.toMatchObject({ problema: { codigo: 'conflito-versao' } });
    await porta.registrarNota(ctx(), m['resPedido']!, {
      versao: Number(r['versao']),
      valorRealizado: 550,
      final: true,
      numeroDocumento: 'NF-SINT-P2',
      motivo: 'Frete acima do pedido',
    });
    r = await reserva(m['resPedido']!);
    expect(r).toMatchObject({ situacao: 'consumida' });
    expect(Number(r['valor_consumido'])).toBe(800);
    expect(Number(r['valor_liberado'])).toBe(0);
    const ajustes = await ler(
      `SELECT sequencia, valor_comprometido, valor_realizado, valor_ajuste, pedido_compra_id, competencia
         FROM ajuste_orcamento_nota WHERE reserva_orcamentaria_id = ? ORDER BY sequencia`,
      [m['resPedido']],
    );
    expect(
      ajustes.map((a) => [a['sequencia'], Number(a['valor_comprometido']), Number(a['valor_ajuste'])]),
    ).toEqual([
      [1, 800, 0],
      [2, 500, 50],
    ]);
    expect(ajustes[1]!['pedido_compra_id']).toBe(m['pedido']);
    // Saldo: 1000 − aberto 500 (título) − realizado (800 + 50) = −350.
    expect(await saldo()).toMatchObject({ comprometido: 500, realizado: 850, disponivel: -350 });
    // Reserva já consumida não recebe nota.
    await expect(
      porta.registrarNota(ctx(), m['resPedido']!, {
        versao: Number(r['versao']),
        valorRealizado: 1,
        final: true,
      }),
    ).rejects.toMatchObject(recusa);

    // Liberação do título, com o motivo.
    const t = await reserva(m['resTitulo']!);
    await expect(
      porta.liberar(ctx(), m['resTitulo']!, { versao: Number(t['versao']), motivo: 'x' }),
    ).rejects.toMatchObject(recusa);
    await porta.liberar(ctx(), m['resTitulo']!, { versao: Number(t['versao']), motivo: 'Título cancelado' });
    const tl = await reserva(m['resTitulo']!);
    expect(tl).toMatchObject({
      situacao: 'liberada',
      liberado_por: m['usuario'],
      motivo_liberacao: 'Título cancelado',
    });
    expect(Number(tl['valor_liberado'])).toBe(500);
    expect(tl['liberado_em']).not.toBeNull();
    expect((await saldo()).disponivel).toBe(150);

    // A regra passa a alertar: sem ciência recusa; com ciência reserva e marca o excesso com o próprio usuário.
    const [rg] = await ler('SELECT versao FROM regra_controle_orcamentario WHERE id = ?', [m['regra']]);
    await porta.salvarRegra(ctx(), m['regra']!, {
      acao: 'alertar',
      centroCusto: m['cc']!,
      prioridade: 10,
      vigenciaInicio: '2027-01-01',
      versao: Number(rg!['versao']),
    });
    const alerta = {
      tipoDocumento: 'titulo_pagar',
      documento: m['titulo']!,
      linha: m['linha']!,
      competencia: COMP,
      valor: 400,
      data: '2027-03-10',
    };
    await expect(porta.reservar(ctx(), alerta)).rejects.toMatchObject(recusa);
    expect(await porta.reservar(ctx(), { ...alerta, ciente: true })).toMatchObject({
      decisao: 'alerta',
      excesso: 250,
    });
    const [r3] = await ler(
      'SELECT * FROM reserva_orcamentaria WHERE titulo_pagar_id = ? AND situacao = ? ORDER BY id DESC',
      [m['titulo'], 'ativa'],
    );
    expect(r3).toMatchObject({ autorizador_usuario_id: m['usuario'], numero: `RTP${m['titulo']}-2` });
    expect(Number(r3!['excedeu_saldo'])).toBe(1);
    // A regra inválida é recusada; o painel mostra tudo.
    await expect(
      porta.salvarRegra(ctx(), null, { acao: 'nao_controlar', vigenciaInicio: '2027-01-01' }),
    ).rejects.toMatchObject(recusa);
    const painel = await porta.painel(ctx());
    expect(painel.regras).toHaveLength(1);
    expect(painel.reservas).toHaveLength(3);
    expect(painel.excecoes[0]).toMatchObject({ situacao: 'utilizada', valor: 300 });
    expect(painel.linhas.map((l) => l.id)).toContain(m['linha']);
  });
});
