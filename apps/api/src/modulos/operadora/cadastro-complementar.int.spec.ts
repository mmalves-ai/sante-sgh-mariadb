// Contrato de efeito do cadastro complementar da operadora (F7, 08-SGO linhas 93 a 95; F78.08-1) contra o MariaDB real
// (cliente f22_o2). Massa SINTÉTICA pela carteira da F1 (operadora, produto estadual, contrato PF, titular e
// dependente). Prova o que fica no banco: responsáveis com a troca na véspera, setores, parâmetros por vigência,
// aditivo que estende a vigência, cancelamento com protocolo e efetivação, área de abrangência com retirada guardada,
// carências aplicadas com teto legal e o pedido de cartão com situação e taxa pelo parâmetro.
// SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import { somarDias } from '@sgh/dominio-operadora';
import type { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { PortaCadastroComplementarPropria } from './cadastro-complementar-porta-propria.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  criarNucleo,
  limparMassa,
  type MassaBase,
  montarCarteira,
  PODE,
  prepararBase,
  servicoNoBanco,
  sessao,
} from './infra/copia.spec-util.js';

let nucleo: NucleoProprio | null = null;
let massa: MassaBase | null = null;
let porta: PortaCadastroComplementarPropria | null = null;
let cart: Awaited<ReturnType<typeof montarCarteira>> | null = null;
let motivoPedido = 0;
let motivoInadimplencia = 0;

const trilha =
  (evento: string) =>
  (r: { id: number }): RegistroTrilhaTela => ({
    estabelecimento: massa?.est ?? null,
    usuario: massa?.usuario ?? null,
    acao: 'operacao',
    entidade: 'operadora',
    entidadeId: r.id,
    dadosDepois: { evento, recurso: 'operadora.complementar' },
    correlacao: 'teste-f7808',
  });

const q = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
  nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'teste-f7808' }, (l) =>
    l.consultar(sql, p, { teto: 1000 }),
  ) as Promise<T[]>;

/** Apaga as linhas deste teste (as tabelas novas) antes da limpeza comum da massa. */
async function limparComplementar(n: NucleoProprio, m: MassaBase) {
  await n.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f7808' }, async (e) => {
    const ests = [m.est, m.outroEst];
    const ctr = 'SELECT id FROM contrato_plano WHERE estabelecimento_id IN (?, ?)';
    const ben = `SELECT b.id FROM beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id WHERE cp.estabelecimento_id IN (?, ?)`;
    const ope =
      'SELECT operadora_saude_id FROM operadora_saude_estabelecimento WHERE estabelecimento_id IN (?, ?)';
    await e.executar(`DELETE FROM aditivo_contrato_plano WHERE contrato_plano_id IN (${ctr})`, ests);
    await e.executar(`DELETE FROM contrato_plano_oferta WHERE contrato_plano_id IN (${ctr})`, ests);
    await e.executar(`DELETE FROM credito_fatura_plano WHERE estabelecimento_id IN (?, ?)`, ests);
    await e.executar(
      `UPDATE beneficiario_plano SET plano_comercializado_id = (SELECT MIN(pc.id) FROM plano_comercializado pc WHERE pc.estabelecimento_id IN (?, ?) AND pc.codigo NOT LIKE 'f7808-%') WHERE contrato_plano_id IN (${ctr})`,
      [...ests, ...ests],
    );
    await e.executar(
      `DELETE FROM plano_comercializado WHERE estabelecimento_id IN (?, ?) AND codigo LIKE 'f7808-%'`,
      ests,
    );
    await e.executar(`DELETE FROM cancelamento_contrato_plano WHERE contrato_plano_id IN (${ctr})`, ests);
    await e.executar(`DELETE FROM carencia_aplicada WHERE beneficiario_plano_id IN (${ben})`, ests);
    await e.executar(
      `UPDATE cartao_beneficiario SET solicitacao_cartao_beneficiario_id = NULL WHERE solicitacao_cartao_beneficiario_id IN (SELECT id FROM solicitacao_cartao_beneficiario WHERE estabelecimento_id IN (?, ?))`,
      ests,
    );
    await e.executar(`DELETE FROM solicitacao_cartao_beneficiario WHERE estabelecimento_id IN (?, ?)`, ests);
    await e.executar(
      `DELETE FROM area_abrangencia_produto WHERE produto_plano_id IN (SELECT id FROM produto_plano WHERE estabelecimento_id IN (?, ?))`,
      ests,
    );
    await e.executar(`DELETE FROM responsavel_operadora WHERE operadora_saude_id IN (${ope})`, ests);
    await e.executar(
      `UPDATE departamento_operadora SET superior_departamento_operadora_id = NULL WHERE operadora_saude_id IN (${ope})`,
      ests,
    );
    await e.executar(`DELETE FROM departamento_operadora WHERE operadora_saude_id IN (${ope})`, ests);
    await e.executar(`DELETE FROM parametro_operadora WHERE operadora_saude_id IN (${ope})`, ests);
  });
}

beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  massa = await prepararBase(nucleo);
  await limparComplementar(nucleo, massa);
  await limparMassa(nucleo, massa);
  const { servico } = servicoNoBanco(nucleo);
  cart = await montarCarteira(servico, sessao(massa), { registro: '478081', base: '7808' });
  porta = new PortaCadastroComplementarPropria(nucleo, CLIENTE);
  const ids = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f7808' }, async (e) => {
    const motivo = async (codigo: string, tipo: string, exige: boolean) => {
      const r = await e.uma<{ id: unknown }>('SELECT id FROM motivo_cancelamento_contrato WHERE codigo = ?', [
        codigo,
      ]);
      return r
        ? Number(r['id'])
        : e.inserir(
            'INSERT INTO motivo_cancelamento_contrato (codigo, descricao, tipo_cancelamento, exige_notificacao_previa, criado_em) VALUES (?, ?, ?, ?, NOW(3))',
            [codigo, `Motivo ${codigo} (sintético)`, tipo, exige],
          );
    };
    const ids = [
      await motivo('f7808-pedido', 'pedido_contratante', false),
      await motivo('f7808-inadimp', 'inadimplencia', true),
    ];
    // O motivo de exclusão do beneficiário ligado a cada motivo de cancelamento (a baixa cadastral da efetivação).
    for (const [i, m] of ids.entries()) {
      const cod = `f7808-baixa-${i}`;
      if (!(await e.uma('SELECT id FROM motivo_movimento_cadastral WHERE codigo = ?', [cod])))
        await e.inserir(
          "INSERT INTO motivo_movimento_cadastral (codigo, descricao, tipo_movimento, motivo_cancelamento_contrato_id, criado_em) VALUES (?, ?, 'exclusao', ?, NOW(3))",
          [cod, `Baixa ${cod} (sintético)`, m],
        );
    }
    return ids;
  });
  [motivoPedido, motivoInadimplencia] = ids as [number, number];
}, 120_000);

afterAll(async () => {
  if (nucleo && massa) {
    await limparComplementar(nucleo, massa);
    await limparMassa(nucleo, massa);
  }
  await nucleo?.encerrar();
});

describe.skipIf(!PODE)('cadastro complementar da operadora no banco (F78.08-1)', () => {
  it('08-SGO L93: responsáveis com troca na véspera, setores sem ciclo e parâmetro por vigência', async () => {
    const c = contexto(massa!);
    const op = cart!.operadora;
    const [pf] = await q<{ p: unknown }>(
      'SELECT pessoa_fisica_id AS p FROM beneficiario_plano WHERE id = ?',
      [cart!.titular.id],
    );
    const pessoa = Number(pf!['p']);
    const base = { natureza: 'fisica' as const, pessoa, numeroRegistro: 'CRM-SP 0001', fim: null };
    await porta!.incluirResponsavel(
      c,
      op,
      { ...base, tipo: 'responsavel_tecnico', inicio: '2026-01-01' },
      trilha('resp'),
    );
    await porta!.incluirResponsavel(
      c,
      op,
      { ...base, tipo: 'responsavel_tecnico', inicio: '2026-06-01' },
      trilha('resp'),
    );
    expect(
      await codigoDe(
        porta!.incluirResponsavel(
          c,
          op,
          { ...base, tipo: 'responsavel_tecnico', inicio: '2026-03-01', numeroRegistro: null },
          trilha('resp'),
        ),
      ),
    ).toBe('registro-obrigatorio');
    const rs = await q<{ fim: unknown; seq: unknown }>(
      "SELECT DATE_FORMAT(fim_exercicio, '%Y-%m-%d') AS fim, sequencia AS seq FROM responsavel_operadora WHERE operadora_saude_id = ? ORDER BY sequencia",
      [op],
    );
    expect(rs.map((r) => [Number(r['seq']), r['fim']])).toEqual([
      [1, '2026-05-31'],
      [2, null],
    ]);
    const lidos = await porta!.responsaveis(c, op);
    expect(lidos.filter((r) => r.vigente).length).toBe(1);
    // A leitura traz o nome da pessoa (a tela mostra quem é), igual ao do cadastro.
    const [nomePf] = await q<{ n: unknown }>('SELECT nome AS n FROM pessoa_fisica WHERE id = ?', [pessoa]);
    expect(lidos.every((r) => r.nome === nomePf!['n'] && r.pessoa === pessoa)).toBe(true);
    // A busca da pessoa pelo documento exato (a tela escolhe o responsável pelo CPF ou CNPJ, sem número interno).
    const [doc] = await q<{ cpf: unknown }>('SELECT cpf FROM pessoa_fisica WHERE id = ?', [pessoa]);
    if (doc!['cpf'])
      expect(await porta!.pessoaPorDocumento(c, String(doc!['cpf']))).toEqual({
        id: pessoa,
        natureza: 'fisica',
        nome: nomePf!['n'],
      });
    expect(await porta!.pessoaPorDocumento(c, '99999999999990')).toBeNull();
    expect(await codigoDe(porta!.pessoaPorDocumento(c, '123'))).toBe('documento-invalido');
    // Escopo: o outro estabelecimento não vê a operadora.
    expect(await codigoDe(porta!.responsaveis(contexto(massa!, true), op))).toBe('nao-encontrado');

    const dep = {
      descricao: 'Autorização',
      tipo: 'autorizacao',
      email: 'aut@exemplo.test',
      emailsCopia: [],
      superior: null,
      visivelPortal: true,
      ativo: true,
    };
    const a = await porta!.gravarDepartamento(
      c,
      op,
      null,
      null,
      { ...dep, codigo: 'F7808-AUT' },
      trilha('dep'),
    );
    const b = await porta!.gravarDepartamento(
      c,
      op,
      null,
      null,
      { ...dep, codigo: 'F7808-REG', tipo: 'regulacao', superior: a.id },
      trilha('dep'),
    );
    expect(
      await codigoDe(
        porta!.gravarDepartamento(
          c,
          op,
          a.id,
          1,
          { ...dep, codigo: 'F7808-AUT', superior: b.id },
          trilha('dep'),
        ),
      ),
    ).toBe('hierarquia-circular');
    expect(
      await codigoDe(
        porta!.gravarDepartamento(c, op, null, null, { ...dep, codigo: 'F7808-AUT' }, trilha('dep')),
      ),
    ).toBe('codigo-em-uso');
    const deps = await porta!.departamentos(c, op);
    expect(deps.map((d) => [d.codigo, d.superior === a.id, d.visivelPortal])).toEqual([
      ['F7808-AUT', false, true],
      ['F7808-REG', true, true],
    ]);

    await porta!.definirParametro(
      c,
      op,
      { chave: 'prazo_cpt_meses', valor: 18, inicio: null, justificativa: 'teste' },
      trilha('par'),
    );
    await porta!.definirParametro(
      c,
      op,
      { chave: 'prazo_cpt_meses', valor: 12, inicio: null, justificativa: 'teste' },
      trilha('par'),
    );
    expect(
      await codigoDe(
        porta!.definirParametro(
          c,
          op,
          { chave: 'prazo_cpt_meses', valor: 30, inicio: null, justificativa: null },
          trilha('par'),
        ),
      ),
    ).toBe('valor-fora-da-faixa');
    const ps = await q<{ valor: unknown; aberto: unknown }>(
      "SELECT valor, vigencia_fim IS NULL AS aberto FROM parametro_operadora WHERE operadora_saude_id = ? AND chave = 'prazo_cpt_meses' ORDER BY id",
      [op],
    );
    expect(ps.map((p) => [p['valor'], Number(p['aberto'])])).toEqual([
      ['18', 0],
      ['12', 1],
    ]);
    const vig = await porta!.parametros(c, op);
    expect(vig.find((p) => p.chave === 'prazo_cpt_meses')).toMatchObject({ valor: 12, padrao: false });
    expect(vig.find((p) => p.chave === 'dias_inadimplencia_cancelamento')).toMatchObject({
      valor: 61,
      padrao: true,
    });
  });

  it('08-SGO L94: aditivo de prorrogação estende o contrato; abrangência coerente com retirada guardada', async () => {
    const c = contexto(massa!);
    const ctr = cart!.contrato;
    const ad = {
      assinatura: '2026-03-01',
      planoAnterior: null,
      planoNovo: null,
      valorAnterior: null,
      valorNovo: null,
      descricao: 'Prorrogação acordada',
    };
    await porta!.registrarAditivo(
      c,
      ctr,
      { ...ad, tipo: 'vigencia', efeito: '2026-04-01', novaVigenciaFim: '2027-12-31' },
      trilha('adt'),
    );
    await porta!.registrarAditivo(
      c,
      ctr,
      { ...ad, tipo: 'clausula', efeito: '2026-04-01', novaVigenciaFim: null, assinatura: null },
      trilha('adt'),
    );
    expect(
      await codigoDe(
        porta!.registrarAditivo(
          c,
          ctr,
          { ...ad, tipo: 'troca_plano', efeito: '2026-04-01', novaVigenciaFim: null },
          trilha('adt'),
        ),
      ),
    ).toBe('planos-obrigatorios');
    const ads = await porta!.aditivos(c, ctr);
    expect(ads.map((a) => [a.sequencia, a.tipo, a.situacao])).toEqual([
      [1, 'vigencia', 'vigente'],
      [2, 'clausula', 'rascunho'],
    ]);
    const [cp] = await q<{ fim: unknown; tipo: unknown }>(
      "SELECT DATE_FORMAT(fim_vigencia, '%Y-%m-%d') AS fim, tipo_vigencia AS tipo FROM contrato_plano WHERE id = ?",
      [ctr],
    );
    expect(cp).toEqual({ fim: '2027-12-31', tipo: 'determinada' });
    // O plano citado precisa ser do estabelecimento do contrato (a FK sozinha aceitaria o de outro).
    const [outro] = await q<{ id: unknown }>(
      'SELECT id FROM plano_comercializado WHERE estabelecimento_id <> ? ORDER BY id LIMIT 1',
      [massa!.est],
    );
    for (const plano of [2_147_000_000, ...(outro ? [Number(outro['id'])] : [])])
      expect(
        await codigoDe(
          porta!.registrarAditivo(
            c,
            ctr,
            { ...ad, tipo: 'inclusao_plano', planoNovo: plano, efeito: '2026-04-01', novaVigenciaFim: null },
            trilha('adt'),
          ),
        ),
      ).toBe('plano-fora-do-contrato');
    // Rascunho de prorrogação não mexe no contrato; a assinatura o torna vigente e aplica o efeito.
    const rasc = await porta!.registrarAditivo(
      c,
      ctr,
      { ...ad, tipo: 'vigencia', assinatura: null, efeito: '2026-05-01', novaVigenciaFim: '2028-06-30' },
      trilha('adt'),
    );
    const fimDe = async () =>
      (
        await q<{ fim: unknown }>(
          "SELECT DATE_FORMAT(fim_vigencia, '%Y-%m-%d') AS fim FROM contrato_plano WHERE id = ?",
          [ctr],
        )
      )[0]!['fim'];
    expect(await fimDe()).toBe('2027-12-31');
    await porta!.assinarAditivo(c, rasc.id, '2026-04-20', trilha('adt'));
    expect(await fimDe()).toBe('2028-06-30');
    expect(await codigoDe(porta!.assinarAditivo(c, rasc.id, '2026-04-20', trilha('adt')))).toBe(
      'situacao-invalida',
    );
    await porta!.assinarAditivo(c, ads[1]!.id, '2026-03-15', trilha('adt'));
    expect((await porta!.aditivos(c, ctr)).map((a) => [a.sequencia, a.situacao, a.assinatura])).toEqual([
      [1, 'vigente', '2026-03-01'],
      [2, 'vigente', '2026-03-15'],
      [3, 'vigente', '2026-04-20'],
    ]);

    const prod = cart!.produto;
    expect(
      await codigoDe(
        porta!.definirAbrangencia(c, prod, [{ tipo: 'municipio', codigoIbge: '3550308' }], trilha('abr')),
      ),
    ).toBe('abrangencia-incoerente');
    await porta!.definirAbrangencia(c, prod, [{ tipo: 'estado', codigoIbge: '35' }], trilha('abr'));
    expect((await porta!.abrangencia(c, prod)).areas.map((a) => a.codigoIbge)).toEqual(['35']);
    // Troca de estado: a área anterior fica guardada com excluido_em, e a volta reativa a mesma linha.
    await porta!.definirAbrangencia(c, prod, [{ tipo: 'estado', codigoIbge: '33' }], trilha('abr'));
    await porta!.definirAbrangencia(c, prod, [{ tipo: 'estado', codigoIbge: '35' }], trilha('abr'));
    const linhas = await q<{ n: unknown; ativas: unknown }>(
      'SELECT COUNT(*) AS n, SUM(excluido_em IS NULL) AS ativas FROM area_abrangencia_produto WHERE produto_plano_id = ?',
      [prod],
    );
    expect([Number(linhas[0]!['n']), Number(linhas[0]!['ativas'])]).toEqual([2, 1]);
  });

  it('08-SGO L95: carências aplicadas com teto legal e pedido de cartão com situação e taxa pelo parâmetro', async () => {
    const c = contexto(massa!);
    const ben = cart!.titular.id;
    await porta!.gerarCarencias(c, ben, 30, trilha('car'));
    expect(await codigoDe(porta!.gerarCarencias(c, ben, 0, trilha('car')))).toBe('carencias-ja-geradas');
    const car = await porta!.carencias(c, ben);
    // Produto da carteira: urgência 1, parto 300, demais 180, CPT 24 (meses → grupo de 730 dias no teto legal).
    expect(Object.fromEntries(car.map((x) => [x.categoria, [x.dias, x.aproveitados]]))).toMatchObject({
      urgencia: [1, 1],
      parto: [300, 30],
      demais: [180, 30],
    });
    const [bp] = await q<{ g: unknown; d: unknown }>(
      'SELECT carencia_gerada AS g, dias_aproveitamento_carencia AS d FROM beneficiario_plano WHERE id = ?',
      [ben],
    );
    expect([Number(bp!['g']), Number(bp!['d'])]).toEqual([1, 30]);

    const op = cart!.operadora;
    const [mot] = await q<{ id: unknown }>(
      "SELECT id FROM motivo_solicitacao_cartao WHERE codigo = 'l0210-perda'",
    );
    await porta!.definirParametro(
      c,
      op,
      { chave: 'cobra_segunda_via_cartao', valor: true, inicio: null, justificativa: null },
      trilha('par'),
    );
    // Cobrança ligada com a taxa no padrão zero: recusa, nunca cobra R$ 0 em silêncio.
    expect(
      await codigoDe(
        porta!.solicitarCartao(
          c,
          ben,
          { primeiraVia: false, motivo: Number(mot!['id']), canal: 'balcao', observacao: null },
          trilha('crt'),
        ),
      ),
    ).toBe('taxa-invalida');
    await porta!.definirParametro(
      c,
      op,
      { chave: 'valor_taxa_segunda_via', valor: 25, inicio: null, justificativa: null },
      trilha('par'),
    );
    expect(
      await codigoDe(
        porta!.solicitarCartao(
          c,
          ben,
          { primeiraVia: false, motivo: null, canal: 'balcao', observacao: null },
          trilha('crt'),
        ),
      ),
    ).toBe('motivo-obrigatorio');
    const ped = await porta!.solicitarCartao(
      c,
      ben,
      { primeiraVia: false, motivo: Number(mot!['id']), canal: 'balcao', observacao: null },
      trilha('crt'),
    );
    expect(
      await codigoDe(
        porta!.solicitarCartao(
          c,
          ben,
          { primeiraVia: false, motivo: Number(mot!['id']), canal: 'portal', observacao: null },
          trilha('crt'),
        ),
      ),
    ).toBe('pedido-em-aberto');
    expect(await codigoDe(porta!.avancarPedidoCartao(c, ped.id, 'entregue', trilha('crt')))).toBe(
      'passo-invalido',
    );
    await porta!.avancarPedidoCartao(c, ped.id, 'emitido', trilha('crt'));
    // A emissão gera a via de fato, ligada ao pedido; só ela fica válida (as anteriores canceladas, não apagadas).
    const [via] = await q<{
      cid: unknown;
      v: unknown;
      ped: unknown;
      s: unknown;
      cobra: unknown;
      validas: unknown;
    }>(
      `SELECT p.cartao_beneficiario_id AS cid, k.via AS v, k.solicitacao_cartao_beneficiario_id AS ped, k.situacao AS s,
              k.cobrar_emissao AS cobra,
              (SELECT COUNT(*) FROM cartao_beneficiario x WHERE x.beneficiario_plano_id = p.beneficiario_plano_id AND x.situacao <> 'cancelado') AS validas
         FROM solicitacao_cartao_beneficiario p JOIN cartao_beneficiario k ON k.id = p.cartao_beneficiario_id WHERE p.id = ?`,
      [ped.id],
    );
    expect(via).toBeDefined();
    expect([Number(via!['ped']), via!['s'], Number(via!['cobra']), Number(via!['validas'])]).toEqual([
      ped.id,
      'emitido',
      1,
      1,
    ]);
    const [bv] = await q<{ v: unknown }>('SELECT via_cartao AS v FROM beneficiario_plano WHERE id = ?', [
      ben,
    ]);
    expect(Number(bv!['v'])).toBe(Number(via!['v']));
    // Pedido emitido ainda não é final: outro pedido continua barrado.
    expect(
      await codigoDe(
        porta!.solicitarCartao(
          c,
          ben,
          { primeiraVia: false, motivo: Number(mot!['id']), canal: 'portal', observacao: null },
          trilha('crt'),
        ),
      ),
    ).toBe('pedido-em-aberto');
    await porta!.avancarPedidoCartao(c, ped.id, 'entregue', trilha('crt'));
    const [pc] = await q<{ s: unknown; taxa: unknown; cobra: unknown; emi: unknown; ent: unknown }>(
      `SELECT s.codigo AS s, p.valor_taxa AS taxa, p.cobra_taxa AS cobra, p.emitido_em IS NOT NULL AS emi, p.entregue_em IS NOT NULL AS ent
         FROM solicitacao_cartao_beneficiario p JOIN situacao_solicitacao_cartao s ON s.id = p.situacao_solicitacao_cartao_id WHERE p.id = ?`,
      [ped.id],
    );
    expect([
      pc!['s'],
      Number(pc!['taxa']),
      Number(pc!['cobra']),
      Number(pc!['emi']),
      Number(pc!['ent']),
    ]).toEqual(['entregue', 25, 1, 1, 1]);
    expect((await porta!.pedidosCartao(c, ben))[0]).toMatchObject({
      situacao: 'entregue',
      primeiraVia: false,
      valorTaxa: 25,
    });
  });

  it('08-SGO L94: cancelamento com notificação no prazo, desistência, efeito imediato do titular e efetivação dos vencidos', async () => {
    const c = contexto(massa!);
    const ctr = cart!.contrato;
    const [h] = await q<{ h: unknown }>("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS h");
    const hoje = String(h!['h']);
    const base = {
      dataEfeito: null,
      diasAtraso: null,
      avisoRecebimento: null,
      avisoEntregueEm: null,
      observacao: null,
    };
    const inadimp = { ...base, motivo: motivoInadimplencia, solicitante: 'inadimplencia', diasAtraso: 70 };
    const situacaoDoContrato = async () =>
      (await q<{ s: unknown }>('SELECT situacao AS s FROM contrato_plano WHERE id = ?', [ctr]))[0]!['s'];
    expect(await codigoDe(porta!.solicitarCancelamento(c, ctr, inadimp, trilha('x')))).toBe(
      'notificacao-obrigatoria',
    );
    // Aviso há 5 dias com 70 de atraso: saiu no 65º dia, depois do 50º do parâmetro.
    expect(
      await codigoDe(
        porta!.solicitarCancelamento(
          c,
          ctr,
          { ...inadimp, avisoEntregueEm: somarDias(hoje, -5) },
          trilha('x'),
        ),
      ),
    ).toBe('notificacao-fora-do-prazo');
    // Aviso no 45º dia e efeito daqui a 5 dias: agendado; a efetivação espera a data; a desistência devolve o contrato.
    const ag = await porta!.solicitarCancelamento(
      c,
      ctr,
      { ...inadimp, avisoEntregueEm: somarDias(hoje, -25), dataEfeito: somarDias(hoje, 5) },
      trilha('operadora.cancelamento.solicitado'),
    );
    expect(await situacaoDoContrato()).toBe('em_cancelamento');
    expect(await codigoDe(porta!.efetivarCancelamento(c, ag.id, trilha('x')))).toBe('efeito-futuro');
    expect(await codigoDe(porta!.desistirCancelamento(c, ag.id, ' ', trilha('x')))).toBe(
      'motivo-obrigatorio',
    );
    await porta!.desistirCancelamento(c, ag.id, 'Débito quitado', trilha('operadora.cancelamento.desistido'));
    expect(await situacaoDoContrato()).toBe('ativo');

    // Pedido do titular no contrato individual (RN 412): efetivado na mesma operação, sem passo manual.
    const k = await porta!.solicitarCancelamento(
      c,
      ctr,
      { ...base, motivo: motivoPedido, solicitante: 'titular' },
      trilha('operadora.cancelamento.solicitado'),
    );
    expect(
      await codigoDe(
        porta!.solicitarCancelamento(
          c,
          ctr,
          { ...base, motivo: motivoPedido, solicitante: 'titular' },
          trilha('x'),
        ),
      ),
    ).toBe('contrato-sem-vigencia');
    expect(await codigoDe(porta!.efetivarCancelamento(c, k.id, trilha('x')))).toBe('situacao-invalida');
    const [kc] = await q<{ s: unknown; p: unknown; e: unknown; d: unknown }>(
      "SELECT situacao AS s, protocolo AS p, efetivado_em IS NOT NULL AS e, DATE_FORMAT(data_efeito, '%Y-%m-%d') AS d FROM cancelamento_contrato_plano WHERE id = ?",
      [k.id],
    );
    expect([kc!['s'], Number(kc!['e']), kc!['d']]).toEqual(['efetivado', 1, hoje]);
    expect(String(kc!['p']).length).toBeGreaterThan(0);
    const fechado = async () =>
      (
        await q<{ s: unknown; abertos: unknown }>(
          `SELECT cp.situacao AS s, (SELECT COUNT(*) FROM beneficiario_plano b WHERE b.contrato_plano_id = cp.id AND b.fim_vigencia IS NULL) AS abertos
             FROM contrato_plano cp WHERE cp.id = ?`,
          [ctr],
        )
      ).map((r) => [r['s'], Number(r['abertos'])])[0];
    expect(await fechado()).toEqual(['encerrado', 0]);
    // Baixa cadastral de cada beneficiário: excluído na data de efeito, com o motivo ligado e o movimento de exclusão.
    const baixa = async () =>
      (
        await q<{ s: unknown; d: unknown; m: unknown; n: unknown }>(
          `SELECT b.situacao AS s, DATE_FORMAT(b.data_exclusao, '%Y-%m-%d') AS d, mm.codigo AS m,
                  (SELECT COUNT(*) FROM movimento_cadastral_beneficiario v WHERE v.beneficiario_plano_id = b.id
                     AND v.tipo_movimento = 'exclusao' AND v.motivo_movimento_cadastral_id = b.motivo_movimento_cadastral_id) AS n
             FROM beneficiario_plano b JOIN motivo_movimento_cadastral mm ON mm.id = b.motivo_movimento_cadastral_id
            WHERE b.contrato_plano_id = ? ORDER BY b.id`,
          [ctr],
        )
      ).map((r) => [r['s'], r['d'], r['m'], Number(r['n'])]);
    expect(await baixa()).toEqual([
      ['excluido', hoje, 'f7808-baixa-0', 1],
      ['excluido', hoje, 'f7808-baixa-0', 1],
    ]);

    // Efetivação dos vencidos (a rotina diária): massa volta o contrato a ativo e pede por inadimplência com efeito hoje.
    await nucleo!.escrever({ cliente: CLIENTE, correlacao: 'preparo-f7808' }, (e) =>
      e.executar("UPDATE contrato_plano SET situacao = 'ativo', versao = versao + 1 WHERE id = ?", [ctr]),
    );
    expect(
      await codigoDe(
        porta!.solicitarCancelamento(
          c,
          ctr,
          { ...inadimp, avisoEntregueEm: somarDias(hoje, -25), valorCredito: 10.005 },
          trilha('x'),
        ),
      ),
    ).toBe('credito-invalido');
    const venc = await porta!.solicitarCancelamento(
      c,
      ctr,
      { ...inadimp, avisoEntregueEm: somarDias(hoje, -25), valorCredito: 120.5 },
      trilha('operadora.cancelamento.solicitado'),
    );
    expect(await situacaoDoContrato()).toBe('em_cancelamento');
    expect(await porta!.efetivarCancelamentosVencidos(c, trilha('operadora.cancelamento.efetivado'))).toEqual(
      {
        efetivados: [venc.id],
        recusados: [],
      },
    );
    expect(await situacaoDoContrato()).toBe('encerrado');
    // Crédito ao contratante pelo pago adiante: crédito de fatura em aberto com o saldo inteiro, com número de negócio.
    const creditos = await q<{ v: unknown; s: unknown; t: unknown; x: unknown; n: unknown }>(
      'SELECT valor AS v, saldo AS s, tipo_credito AS t, situacao AS x, numero AS n FROM credito_fatura_plano WHERE contrato_plano_id = ?',
      [ctr],
    );
    expect(creditos.map((r) => [Number(r['v']), Number(r['s']), r['t'], r['x']])).toEqual([
      [120.5, 120.5, 'devolucao', 'aberto'],
    ]);
    expect(String(creditos[0]!['n']).length).toBeGreaterThan(0);
    // Nada apagado: o histórico dos pedidos continua consultável.
    expect((await porta!.cancelamentos(c, ctr)).map((x) => [x.id, x.situacao])).toEqual([
      [ag.id, 'cancelado'],
      [k.id, 'efetivado'],
      [venc.id, 'efetivado'],
    ]);
    // A trilha registrou cada operação no próprio pedido (sem engolir erro de consulta).
    const operacoes = async (id: number) =>
      (
        await q<{ op: unknown }>(
          `SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(dados_depois, '$.operacao')) AS op FROM trilha_auditoria
            WHERE entidade = 'cancelamento_contrato_plano' AND entidade_id = ?
              AND JSON_EXTRACT(dados_depois, '$.operacao') IS NOT NULL ORDER BY op`,
          [id],
        )
      ).map((r) => r['op']);
    expect(await operacoes(ag.id)).toEqual([
      'operadora.cancelamento.desistir',
      'operadora.cancelamento.solicitar',
    ]);
    expect(await operacoes(k.id)).toEqual(['operadora.cancelamento.solicitar']);
    expect(await operacoes(venc.id)).toEqual([
      'operadora.cancelamento.efetivar',
      'operadora.cancelamento.solicitar',
    ]);
  });
  it('08-SGO L94 (C2-108): troca, inclusão, preço e exclusão de plano mudam as ofertas do contrato e o plano dos beneficiários', async () => {
    const c = contexto(massa!);
    // Contrato próprio deste caso (o anterior ficou encerrado): nova carteira sintética.
    const { servico } = servicoNoBanco(nucleo!);
    const k = await montarCarteira(servico, sessao(massa!), { registro: '478082', base: '7809' });
    const ctr = k.contrato;
    const [h] = await q<{ h: unknown }>("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS h");
    const hoje = String(h!['h']);
    const ids = await nucleo!.escrever({ cliente: CLIENTE, correlacao: 'preparo-f7808' }, async (e) => {
      const [b] = (await e.consultar(
        'SELECT plano_comercializado_id AS p FROM beneficiario_plano WHERE contrato_plano_id = ? LIMIT 1',
        [ctr],
      )) as { p: unknown }[];
      const p1 = Number(b!['p']);
      const novoPlano = (cod: string) =>
        e.inserir(
          `INSERT INTO plano_comercializado (estabelecimento_id, produto_plano_id, codigo, nome_comercial, vigencia_inicio, criado_em)
           SELECT estabelecimento_id, produto_plano_id, ?, ?, vigencia_inicio, NOW(3) FROM plano_comercializado WHERE id = ?`,
          [cod, `Plano ${cod} (sintético)`, p1],
        );
      const tabela = (cod: string) =>
        e.inserir(
          "INSERT INTO tabela_preco_plano (operadora_saude_id, codigo, nome, modelo_valor, situacao, vigencia_inicio, criado_em) VALUES (?, ?, ?, 'unico', 'vigente', '2020-01-01', NOW(3))",
          [k.operadora, cod, `Tabela ${cod} (sintética)`],
        );
      const [p2, p3, t1, t2, t3] = [
        await novoPlano('f7808-p2'),
        await novoPlano('f7808-p3'),
        await tabela('f7808-t1'),
        await tabela('f7808-t2'),
        await tabela('f7808-t3'),
      ];
      await e.executar(
        "INSERT INTO contrato_plano_oferta (contrato_plano_id, plano_comercializado_id, tabela_preco_plano_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, '2020-01-01', NOW(3))",
        [ctr, p1, t1],
      );
      return { p1, p2, p3, t1, t2, t3 };
    });
    const ad = {
      assinatura: null,
      efeito: somarDias(hoje, 1),
      planoAnterior: null,
      planoNovo: null,
      valorAnterior: null,
      valorNovo: null,
      novaVigenciaFim: null,
      descricao: 'Alteração acordada (sintético)',
      tabelaPreco: null,
    };
    const ofertas = async () =>
      (
        await q<{ p: unknown; t: unknown; i: unknown; f: unknown }>(
          `SELECT plano_comercializado_id AS p, tabela_preco_plano_id AS t, DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS i,
                  DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS f FROM contrato_plano_oferta WHERE contrato_plano_id = ? ORDER BY id`,
          [ctr],
        )
      ).map((r) => [Number(r['p']), Number(r['t']), r['i'], r['f']]);
    const planosDosBeneficiarios = async () =>
      (
        await q<{ p: unknown }>(
          'SELECT DISTINCT plano_comercializado_id AS p FROM beneficiario_plano WHERE contrato_plano_id = ?',
          [ctr],
        )
      ).map((r) => Number(r['p']));
    // Recusas antecipadas no rascunho: exclusão do plano com vidas, inclusão sem tabela, tabela de outra operadora.
    expect(
      await codigoDe(
        porta!.registrarAditivo(
          c,
          ctr,
          { ...ad, tipo: 'exclusao_plano', planoAnterior: ids.p1 },
          trilha('x'),
        ),
      ),
    ).toBe('plano-com-beneficiarios');
    expect(
      await codigoDe(
        porta!.registrarAditivo(c, ctr, { ...ad, tipo: 'inclusao_plano', planoNovo: ids.p3 }, trilha('x')),
      ),
    ).toBe('tabela-obrigatoria');
    // Troca em rascunho não muda nada; a assinatura troca a oferta na véspera e leva os beneficiários ao plano novo.
    const troca = await porta!.registrarAditivo(
      c,
      ctr,
      { ...ad, tipo: 'troca_plano', planoAnterior: ids.p1, planoNovo: ids.p2 },
      trilha('operadora.aditivo.registrado'),
    );
    expect(await ofertas()).toEqual([[ids.p1, ids.t1, '2020-01-01', null]]);
    await porta!.assinarAditivo(c, troca.id, hoje, trilha('operadora.aditivo.assinado'));
    expect(await ofertas()).toEqual([
      [ids.p1, ids.t1, '2020-01-01', hoje],
      [ids.p2, ids.t1, somarDias(hoje, 1), null],
    ]);
    expect(await planosDosBeneficiarios()).toEqual([ids.p2]);
    const [mv] = await q<{ n: unknown }>(
      "SELECT COUNT(*) AS n FROM movimento_cadastral_beneficiario v JOIN beneficiario_plano b ON b.id = v.beneficiario_plano_id WHERE b.contrato_plano_id = ? AND v.tipo_movimento = 'mudanca_contratual' AND v.data_efeito = ?",
      [ctr, somarDias(hoje, 1)],
    );
    expect(Number(mv!['n'])).toBe(2);
    // Inclusão assinada abre a oferta com a tabela do aditivo.
    const efeito2 = somarDias(hoje, 2);
    await porta!.registrarAditivo(
      c,
      ctr,
      {
        ...ad,
        efeito: efeito2,
        assinatura: hoje,
        tipo: 'inclusao_plano',
        planoNovo: ids.p3,
        tabelaPreco: ids.t2,
      },
      trilha('operadora.aditivo.registrado'),
    );
    // Preço do plano 2: a oferta encerra na véspera e reabre com a tabela nova (as condições seguem).
    await porta!.registrarAditivo(
      c,
      ctr,
      {
        ...ad,
        efeito: efeito2,
        assinatura: hoje,
        tipo: 'preco',
        planoNovo: ids.p2,
        valorNovo: 350,
        tabelaPreco: ids.t3,
      },
      trilha('operadora.aditivo.registrado'),
    );
    // Exclusão do plano 3 (sem vidas) a partir do dia seguinte à inclusão.
    await porta!.registrarAditivo(
      c,
      ctr,
      { ...ad, efeito: somarDias(hoje, 3), assinatura: hoje, tipo: 'exclusao_plano', planoAnterior: ids.p3 },
      trilha('operadora.aditivo.registrado'),
    );
    expect(await ofertas()).toEqual([
      [ids.p1, ids.t1, '2020-01-01', hoje],
      [ids.p2, ids.t1, somarDias(hoje, 1), somarDias(hoje, 1)],
      [ids.p3, ids.t2, efeito2, efeito2],
      [ids.p2, ids.t3, efeito2, null],
    ]);
    const [ta] = await q<{ t: unknown; n: unknown }>(
      "SELECT MAX(tabela_preco_plano_id) AS t, COUNT(*) AS n FROM aditivo_contrato_plano WHERE contrato_plano_id = ? AND situacao = 'vigente'",
      [ctr],
    );
    expect([Number(ta!['t']), Number(ta!['n'])]).toEqual([ids.t3, 4]);
    // O painel da tela mostra as ofertas com as vidas e acha o contrato pelo número.
    const painel = await porta!.painelContrato(c, ctr);
    expect(painel.ofertas.filter((o) => o.fim === null).map((o) => [o.plano, o.vidas])).toEqual([
      [ids.p2, 2],
    ]);
    expect(painel.motivos.some((m) => m.temBaixa)).toBe(true);
    expect((await porta!.contratosPorNumero(c, painel.contrato.numero)).map((x) => x.id)).toContain(ctr);
  });
});
