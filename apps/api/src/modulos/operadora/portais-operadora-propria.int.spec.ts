// C3-027 (08-SGO linha 114): contrato de efeito da porta própria dos portais do beneficiário, da contratante e do
// corretor contra o MariaDB real (massa sintética "L0209" mais um dependente clonado "C3027"): a conta (convite,
// ativação com os termos, bloqueio com motivo, desbloqueio zerando as tentativas, versão velha), a solicitação do portal
// (número SP, alcance da conta, repetida recusada, cancelamento só pelo dono, decisão da operadora), o cartão digital e
// a exclusão em lote (crítica por linha, processamento que exclui o beneficiário com data e motivo), com a trilha na
// mesma transação. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDe,
  contexto,
  type MassaOperadora,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';
import { type ContaPortalLida, PortaPortaisOperadoraPropria } from './portais-operadora-propria.js';

const NOME_INCLUSAO = 'Inclusão Sintética C3027';

describe.skipIf(SEM_BANCO)('porta própria dos portais da operadora (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaPortaisOperadoraPropria;
  let m: MassaOperadora;
  let clone = 0;
  let motivo = 0;
  let gestor = 0;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'tc3027' }, (l) => l.consultar(sql, p));
  const T = (tabela: string, ev: string) => trilhaTela(m, tabela, ev);
  const trilhas = async (tabela: string, id: number) =>
    (await ler('SELECT id FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?', [tabela, id]))
      .length;
  const limpar = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'tc3027' }, async (e) => {
      await e.executar(
        `DELETE i FROM movimentacao_lote_contratante_item i JOIN movimentacao_lote_contratante l
            ON l.id = i.movimentacao_lote_contratante_id WHERE l.estabelecimento_id = ?`,
        [m.est],
      );
      await e.executar('DELETE FROM movimentacao_lote_contratante WHERE estabelecimento_id = ?', [m.est]);
      await e.executar('DELETE FROM solicitacao_portal_beneficiario WHERE estabelecimento_id = ?', [m.est]);
      await e.executar("DELETE FROM conta_portal_beneficiario WHERE login LIKE 'c3027%'");
      await e.executar("DELETE FROM conta_portal_contratante WHERE login LIKE 'c3027%'");
      await e.executar("DELETE FROM conta_portal_corretor WHERE login LIKE 'c3027%'");
      const doClone = "(SELECT id FROM beneficiario_plano WHERE matricula = 'C3027-L1')";
      await e.executar(
        `UPDATE solicitacao_cartao_beneficiario SET cartao_beneficiario_id = NULL WHERE beneficiario_plano_id IN ${doClone}`,
      );
      await e.executar(`DELETE FROM cartao_beneficiario WHERE beneficiario_plano_id IN ${doClone}`);
      await e.executar(
        `DELETE FROM solicitacao_cartao_beneficiario WHERE beneficiario_plano_id IN ${doClone}`,
      );
      await e.executar(
        `DELETE FROM movimento_cadastral_beneficiario WHERE beneficiario_plano_id IN ${doClone}`,
      );
      await e.executar("DELETE FROM beneficiario_plano WHERE matricula = 'C3027-L1'");
      const incluidos = `(SELECT b.id FROM beneficiario_plano b JOIN pessoa_fisica p ON p.id = b.pessoa_fisica_id
                           WHERE p.nome = '${NOME_INCLUSAO}')`;
      await e.executar(`DELETE FROM cartao_beneficiario WHERE beneficiario_plano_id IN ${incluidos}`);
      await e.executar(
        `DELETE FROM movimento_cadastral_beneficiario WHERE beneficiario_plano_id IN ${incluidos}`,
      );
      await e.executar(
        `DELETE b FROM beneficiario_plano b JOIN pessoa_fisica p ON p.id = b.pessoa_fisica_id WHERE p.nome = ?`,
        [NOME_INCLUSAO],
      );
      await e.executar('DELETE FROM pessoa_fisica WHERE nome = ?', [NOME_INCLUSAO]);
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limpar();
    porta = new PortaPortaisOperadoraPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'tc3027' }, async (e) => {
      const cols = `contrato_plano_id, plano_comercializado_id, pessoa_fisica_id, tipo, titular_beneficiario_plano_id,
        grau_parentesco_dependente_id, data_adesao, criado_em`;
      clone = await e.inserir(
        `INSERT INTO beneficiario_plano (${cols}, matricula, matricula_empresa, inicio_vigencia, situacao)
         SELECT ${cols}, 'C3027-L1', 'F-C3027', '2026-01-02', 'ativo' FROM beneficiario_plano WHERE id = ?`,
        [m.dependente],
      );
      const x = await e.uma<{ id: number }>(
        "SELECT id FROM motivo_movimento_cadastral WHERE codigo = 'C3027-EXC'",
      );
      motivo = x
        ? Number(x.id)
        : await e.inserir(
            "INSERT INTO motivo_movimento_cadastral (codigo, descricao, tipo_movimento, criado_em) VALUES ('C3027-EXC', 'Exclusão sintética', 'exclusao', NOW(3))",
          );
      const g = await e.uma<{ p: number }>(
        'SELECT pessoa_fisica_id AS p FROM beneficiario_plano WHERE id = ?',
        [m.beneficiario],
      );
      gestor = Number(g?.p);
    });
  }, 120_000);
  afterAll(async () => {
    if (m) await limpar();
    await nucleo?.encerrar();
  });

  it('conta: convite, termos, bloqueio com motivo, desbloqueio e versão velha', async () => {
    const c = contexto(m);
    const conta = await porta.convidarConta(
      c,
      {
        portal: 'beneficiario',
        login: 'C3027-ben@exemplo.test',
        email: null,
        celular: '(11) 98888-7777',
        beneficiario: m.beneficiario,
        usuario: m.usuario,
      },
      T('conta_portal_beneficiario', 'operadora.portal.conta-convidada'),
    );
    const [l] = await ler(
      'SELECT login, email, telefone_celular, situacao, convidada_em FROM conta_portal_beneficiario WHERE id = ?',
      [conta.id],
    );
    expect(l).toMatchObject({
      login: 'c3027-ben@exemplo.test',
      email: 'c3027-ben@exemplo.test',
      telefone_celular: '11988887777',
      situacao: 'convidada',
    });
    expect(l?.['convidada_em']).not.toBeNull();
    expect(await trilhas('conta_portal_beneficiario', conta.id)).toBe(1);
    const rep = await porta
      .convidarConta(
        c,
        {
          portal: 'beneficiario',
          login: 'c3027-ben@exemplo.test',
          email: null,
          celular: null,
          beneficiario: m.dependente,
          usuario: null,
        },
        T('conta_portal_beneficiario', 'x'),
      )
      .catch(codigoDe);
    expect(rep).toBe('login-em-uso');
    const sem = await porta
      .mudarSituacaoConta(
        c,
        {
          portal: 'beneficiario',
          id: conta.id,
          versao: 1,
          acao: 'ativar',
          motivo: null,
          termosAceitos: false,
        },
        T('conta_portal_beneficiario', 'x'),
      )
      .catch(codigoDe);
    expect(sem).toBe('termos-nao-aceitos');
    const at = await porta.mudarSituacaoConta(
      c,
      { portal: 'beneficiario', id: conta.id, versao: 1, acao: 'ativar', motivo: null, termosAceitos: true },
      T('conta_portal_beneficiario', 'operadora.portal.conta-ativada'),
    );
    expect(at).toMatchObject({ situacao: 'ativa', versao: 2 });
    expect((await porta.contaDoUsuario(c, 'beneficiario', m.usuario))?.id).toBe(conta.id);
    const velha = await porta
      .mudarSituacaoConta(
        c,
        {
          portal: 'beneficiario',
          id: conta.id,
          versao: 1,
          acao: 'bloquear',
          motivo: 'teste',
          termosAceitos: false,
        },
        T('conta_portal_beneficiario', 'x'),
      )
      .catch(codigoDe);
    expect(velha).not.toBeNull();
    const bl = await porta.mudarSituacaoConta(
      c,
      {
        portal: 'beneficiario',
        id: conta.id,
        versao: 2,
        acao: 'bloquear',
        motivo: 'Tentativas suspeitas',
        termosAceitos: false,
      },
      T('conta_portal_beneficiario', 'operadora.portal.conta-bloqueada'),
    );
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'tc3027' }, (e) =>
      e.executar('UPDATE conta_portal_beneficiario SET tentativas_falhas = 5 WHERE id = ?', [conta.id]),
    );
    expect(await porta.contaDoUsuario(c, 'beneficiario', m.usuario)).toBeNull();
    const de = await porta.mudarSituacaoConta(
      c,
      {
        portal: 'beneficiario',
        id: conta.id,
        versao: bl.versao,
        acao: 'desbloquear',
        motivo: null,
        termosAceitos: false,
      },
      T('conta_portal_beneficiario', 'operadora.portal.conta-desbloqueada'),
    );
    const [d] = await ler(
      'SELECT situacao, tentativas_falhas, motivo_bloqueio, bloqueada_em, termos_aceitos_em FROM conta_portal_beneficiario WHERE id = ?',
      [conta.id],
    );
    expect(d).toMatchObject({ situacao: 'ativa', tentativas_falhas: 0, motivo_bloqueio: null });
    expect(d?.['bloqueada_em']).not.toBeNull();
    expect(d?.['termos_aceitos_em']).not.toBeNull();
    expect(de.versao).toBe(4);
    expect(await trilhas('conta_portal_beneficiario', conta.id)).toBe(4);
    const cor = await porta
      .convidarConta(
        c,
        {
          portal: 'corretor',
          login: 'c3027-cor@exemplo.test',
          email: null,
          celular: null,
          vendedor: null,
          corretora: null,
          usuario: null,
        },
        T('conta_portal_corretor', 'x'),
      )
      .catch(codigoDe);
    expect(cor).toBe('corretor-obrigatorio');
  });

  it('solicitação: alcance da conta, repetida, cancelamento pelo dono, decisão e cartão digital', async () => {
    const c = contexto(m);
    const conta = (await porta.contaDoUsuario(c, 'beneficiario', m.usuario))!;
    const fora = await porta
      .abrirSolicitacao(
        c,
        conta,
        {
          tipo: 'segunda_via_cartao',
          beneficiario: m.beneficiario + 999_999,
          motivo: null,
          dataEfeito: null,
          pedidoReembolso: null,
          dados: null,
          observacao: null,
        },
        T('solicitacao_portal_beneficiario', 'x'),
      )
      .catch(codigoDe);
    expect(fora).toBe('beneficiario-fora-da-conta');
    const s = await porta.abrirSolicitacao(
      c,
      conta,
      {
        tipo: 'segunda_via_cartao',
        beneficiario: m.beneficiario,
        motivo: null,
        dataEfeito: null,
        pedidoReembolso: null,
        dados: null,
        observacao: 'perdi',
      },
      T('solicitacao_portal_beneficiario', 'operadora.portal.solicitacao-aberta'),
    );
    expect(s.numero).toBe(`SP${String(s.id).padStart(8, '0')}`);
    expect(s.aviso).toBe('canal-desligado');
    const [l] = await ler(
      'SELECT tipo_solicitacao, situacao, conta_portal_beneficiario_id, contrato_plano_id, observacao FROM solicitacao_portal_beneficiario WHERE id = ?',
      [s.id],
    );
    expect(l).toMatchObject({
      tipo_solicitacao: 'segunda_via_cartao',
      situacao: 'aberta',
      observacao: 'perdi',
    });
    expect(Number(l?.['conta_portal_beneficiario_id'])).toBe(conta.id);
    expect(Number(l?.['contrato_plano_id'])).toBe(m.contrato);
    const rep = await porta
      .abrirSolicitacao(
        c,
        conta,
        {
          tipo: 'segunda_via_cartao',
          beneficiario: m.beneficiario,
          motivo: null,
          dataEfeito: null,
          pedidoReembolso: null,
          dados: null,
          observacao: null,
        },
        T('solicitacao_portal_beneficiario', 'x'),
      )
      .catch(codigoDe);
    expect(rep).toBe('solicitacao-repetida');
    const outroDono = await porta
      .decidirSolicitacao(
        c,
        {
          id: s.id,
          versao: s.versao,
          acao: 'cancelar',
          resultado: null,
          analista: null,
          dono: { portal: 'beneficiario', conta: conta.id + 999_999 },
        },
        T('solicitacao_portal_beneficiario', 'x'),
      )
      .catch(codigoDe);
    expect(outroDono).toBe('solicitacao-inexistente');
    const an = await porta.decidirSolicitacao(
      c,
      { id: s.id, versao: s.versao, acao: 'analisar', resultado: null, analista: m.usuario },
      T('solicitacao_portal_beneficiario', 'operadora.portal.solicitacao-analisada'),
    );
    const rp = await porta.decidirSolicitacao(
      c,
      {
        id: s.id,
        versao: an.versao,
        acao: 'reprovar',
        resultado: 'Cartão já emitido no mês',
        analista: m.usuario,
      },
      T('solicitacao_portal_beneficiario', 'operadora.portal.solicitacao-reprovada'),
    );
    expect(rp.situacao).toBe('reprovada');
    const volta = await porta
      .decidirSolicitacao(
        c,
        {
          id: s.id,
          versao: rp.versao,
          acao: 'cancelar',
          resultado: null,
          analista: null,
          dono: { portal: 'beneficiario', conta: conta.id },
        },
        T('solicitacao_portal_beneficiario', 'x'),
      )
      .catch(codigoDe);
    expect(volta).toBe('solicitacao-decidida');
    const [d] = await ler(
      'SELECT situacao, resultado, analisado_em, analisado_por_usuario_id FROM solicitacao_portal_beneficiario WHERE id = ?',
      [s.id],
    );
    expect(d).toMatchObject({ situacao: 'reprovada', resultado: 'Cartão já emitido no mês' });
    expect(Number(d?.['analisado_por_usuario_id'])).toBe(m.usuario);
    expect(await trilhas('solicitacao_portal_beneficiario', s.id)).toBe(3);
    const s2 = await porta.abrirSolicitacao(
      c,
      conta,
      {
        tipo: 'segunda_via_cartao',
        beneficiario: m.beneficiario,
        motivo: null,
        dataEfeito: null,
        pedidoReembolso: null,
        dados: null,
        observacao: null,
      },
      T('solicitacao_portal_beneficiario', 'x'),
    );
    const cn = await porta.decidirSolicitacao(
      c,
      {
        id: s2.id,
        versao: s2.versao,
        acao: 'cancelar',
        resultado: null,
        analista: null,
        dono: { portal: 'beneficiario', conta: conta.id },
      },
      T('solicitacao_portal_beneficiario', 'operadora.portal.solicitacao-cancelada'),
    );
    expect(cn.situacao).toBe('cancelada');
    expect((await porta.solicitacoes(c, { contaBeneficiario: conta.id })).map((x) => x.id)).toEqual([
      s2.id,
      s.id,
    ]);
    const cartao = await porta.cartaoDigital(c, conta);
    expect(cartao?.matricula).toBeTruthy();
    expect(typeof cartao?.valido).toBe('boolean');
    expect(await porta.cartaoDigital(c, conta, m.beneficiario + 999_999)).toBeNull();
  });

  it('exclusão em lote: crítica por linha e processamento que exclui com data e motivo', async () => {
    const c = contexto(m);
    const g = await porta.convidarConta(
      c,
      {
        portal: 'contratante',
        login: 'c3027-gestor@exemplo.test',
        email: null,
        celular: null,
        contratante: m.contratante,
        gestor,
        usuario: m.usuario,
      },
      T('conta_portal_contratante', 'x'),
    );
    await porta.mudarSituacaoConta(
      c,
      { portal: 'contratante', id: g.id, versao: 1, acao: 'ativar', motivo: null, termosAceitos: true },
      T('conta_portal_contratante', 'x'),
    );
    const conta = (await porta.contaDoUsuario(c, 'contratante', m.usuario))!;
    expect(conta.contratante).toBe(m.contratante);
    const r = await porta.receberExclusaoLote(
      c,
      conta,
      [
        { sequencia: 1, matricula: 'F-C3027', motivo, dataEfeito: '2026-12-31' },
        { sequencia: 2, matricula: 'C3027-L1', motivo, dataEfeito: '2026-12-31' },
        { sequencia: 3, matricula: 'C3027-NAO-EXISTE', motivo, dataEfeito: '2026-12-31' },
      ],
      T('movimentacao_lote_contratante', 'operadora.portal.lote-recebido'),
    );
    expect(r).toMatchObject({
      numero: `LC${String(r.id).padStart(8, '0')}`,
      situacao: 'criticado',
      aceitos: 1,
      rejeitados: 2,
    });
    const itens = await porta.itensDoLote(c, r.id, m.contratante);
    expect(itens.map((x) => [x.situacao, x.critica])).toEqual([
      ['aceito', null],
      ['rejeitado', 'linha-repetida'],
      ['rejeitado', 'beneficiario-fora-da-contratante'],
    ]);
    expect(itens[0]?.beneficiario).toBe(clone);
    expect(await porta.itensDoLote(c, r.id, m.contratante + 999_999)).toEqual([]);
    const p = await porta.processarLote(
      c,
      { id: r.id, versao: r.versao },
      T('movimentacao_lote_contratante', 'operadora.portal.lote-processado'),
    );
    expect(p).toMatchObject({ situacao: 'processado_parcial', excluidos: 1, rejeitados: 2 });
    const [b] = await ler(
      'SELECT situacao, data_exclusao, motivo_movimento_cadastral_id, versao FROM beneficiario_plano WHERE id = ?',
      [clone],
    );
    expect(b?.['situacao']).toBe('excluido');
    expect(String(b?.['data_exclusao'])).toMatch(/2026/);
    expect(Number(b?.['motivo_movimento_cadastral_id'])).toBe(motivo);
    expect(Number(b?.['versao'])).toBe(2);
    const [lt] = await ler(
      'SELECT situacao, total_aceitos, total_rejeitados, processado_em FROM movimentacao_lote_contratante WHERE id = ?',
      [r.id],
    );
    expect(lt).toMatchObject({ situacao: 'processado_parcial', total_aceitos: 1, total_rejeitados: 2 });
    expect(await trilhas('movimentacao_lote_contratante', r.id)).toBe(2);
    const de_novo = await porta
      .processarLote(c, { id: r.id, versao: p.versao }, T('movimentacao_lote_contratante', 'x'))
      .catch(codigoDe);
    expect(de_novo).toBe('lote-nao-criticado');
    const r2 = await porta.receberExclusaoLote(
      c,
      conta,
      [{ sequencia: 1, matricula: 'C3027-L1', motivo, dataEfeito: '2026-12-31' }],
      T('movimentacao_lote_contratante', 'x'),
    );
    expect(r2).toMatchObject({ situacao: 'rejeitado', aceitos: 0, rejeitados: 1 });
  });

  it('aprovação aplica o efeito: reativação volta o excluído ao ativo; segunda via gera o pedido e a via nova', async () => {
    const c = contexto(m);
    const abrir = (tipo: string) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'tc3027' }, async (e) => {
        const n = await e.uma<{ n: number }>(
          'SELECT COUNT(*) AS n FROM motivo_solicitacao_cartao WHERE ativo = TRUE',
        );
        if (!Number(n?.n))
          await e.inserir(
            "INSERT INTO motivo_solicitacao_cartao (codigo, descricao, criado_em) VALUES ('C3027-2V', 'Perda sintética', NOW(3))",
          );
        const conta = await e.uma<{ id: number }>(
          "SELECT id FROM conta_portal_contratante WHERE login LIKE 'c3027%' ORDER BY id LIMIT 1",
        );
        return e.inserir(
          `INSERT INTO solicitacao_portal_beneficiario (estabelecimento_id, numero, tipo_solicitacao, situacao,
             conta_portal_contratante_id, beneficiario_plano_id, data_efeito, criado_em)
           VALUES (?, ?, ?, 'aberta', ?, ?, '2026-12-01', NOW(3))`,
          [m.est, `C3027-${Math.random().toString(36).slice(2, 12)}`, tipo, Number(conta?.id), clone],
        );
      });
    const aprovar = (id: number) =>
      porta.decidirSolicitacao(
        c,
        { id, versao: 1, acao: 'aprovar', resultado: null, analista: m.usuario },
        T('solicitacao_portal_beneficiario', 'operadora.portal.solicitacao-aprovada'),
      );
    // o clone saiu excluído pelo lote do teste anterior
    const [antes] = await ler('SELECT situacao, via_cartao FROM beneficiario_plano WHERE id = ?', [clone]);
    expect(antes?.['situacao']).toBe('excluido');
    const segundaNoExcluido = await abrir('segunda_via_cartao');
    expect(await aprovar(segundaNoExcluido).catch(codigoDe)).toBe('beneficiario-inativo');

    const re = await aprovar(await abrir('reativacao_beneficiario'));
    expect(re.situacao).toBe('aprovada');
    const [b] = await ler(
      'SELECT situacao, data_exclusao, motivo_movimento_cadastral_id FROM beneficiario_plano WHERE id = ?',
      [clone],
    );
    expect(b).toMatchObject({ situacao: 'ativo', data_exclusao: null, motivo_movimento_cadastral_id: null });
    const mov = await ler(
      "SELECT tipo_movimento, canal, data_efeito, situacao FROM movimento_cadastral_beneficiario WHERE beneficiario_plano_id = ? AND tipo_movimento = 'reativacao'",
      [clone],
    );
    expect(mov).toHaveLength(1);
    expect(mov[0]).toMatchObject({ canal: 'portal', situacao: 'efetivado' });
    expect(String(mov[0]?.['data_efeito'])).toContain('2026');
    expect(await trilhas('solicitacao_portal_beneficiario', re.id)).toBe(1);
    const reDeNovo = await abrir('reativacao_beneficiario');
    expect(await aprovar(reDeNovo).catch(codigoDe)).toBe('beneficiario-ativo');

    const via = Number(antes?.['via_cartao'] ?? 1);
    const sv = await aprovar(await abrir('segunda_via_cartao'));
    const [d] = await ler(
      'SELECT situacao, solicitacao_cartao_beneficiario_id AS pedido FROM solicitacao_portal_beneficiario WHERE id = ?',
      [sv.id],
    );
    expect(d?.['situacao']).toBe('aprovada');
    const [pc] = await ler(
      `SELECT p.canal, p.primeira_via, p.beneficiario_plano_id, p.cartao_beneficiario_id, s.codigo
         FROM solicitacao_cartao_beneficiario p JOIN situacao_solicitacao_cartao s ON s.id = p.situacao_solicitacao_cartao_id
        WHERE p.id = ?`,
      [Number(d?.['pedido'])],
    );
    expect(pc).toMatchObject({ canal: 'portal', codigo: 'emitido' });
    expect(Number(pc?.['primeira_via'])).toBe(0);
    expect(Number(pc?.['beneficiario_plano_id'])).toBe(clone);
    const [cv] = await ler('SELECT via, situacao FROM cartao_beneficiario WHERE id = ?', [
      Number(pc?.['cartao_beneficiario_id']),
    ]);
    const [depois] = await ler('SELECT via_cartao FROM beneficiario_plano WHERE id = ?', [clone]);
    expect(Number(depois?.['via_cartao'])).toBeGreaterThan(via);
    expect(cv).toMatchObject({ situacao: 'emitido' });
    expect(Number(cv?.['via'])).toBe(Number(depois?.['via_cartao']));
    expect(await trilhas('solicitacao_portal_beneficiario', sv.id)).toBe(1);
  });
  it('aprovação da inclusão cria o beneficiário: pessoa, carteirinha, movimento do portal e a solicitação ligada', async () => {
    const c = contexto(m);
    const abrirInclusao = (dados: Record<string, unknown>) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'tc3027' }, async (e) => {
        const conta = await e.uma<{ id: number }>(
          "SELECT id FROM conta_portal_contratante WHERE login LIKE 'c3027%' ORDER BY id LIMIT 1",
        );
        return e.inserir(
          `INSERT INTO solicitacao_portal_beneficiario (estabelecimento_id, numero, tipo_solicitacao, situacao,
             conta_portal_contratante_id, data_efeito, dados_solicitados, criado_em)
           VALUES (?, ?, 'inclusao_beneficiario', 'aberta', ?, '2026-12-01', ?, NOW(3))`,
          [
            m.est,
            `C3027-${Math.random().toString(36).slice(2, 12)}`,
            Number(conta?.id),
            JSON.stringify(dados),
          ],
        );
      });
    const aprovar = (id: number) =>
      porta.decidirSolicitacao(
        c,
        { id, versao: 1, acao: 'aprovar', resultado: null, analista: m.usuario },
        T('solicitacao_portal_beneficiario', 'operadora.portal.solicitacao-aprovada'),
      );
    const [k] = await ler(
      `SELECT cp.id FROM contrato_plano cp JOIN conta_portal_contratante cc ON cc.contratante_plano_id = cp.contratante_plano_id
        WHERE cc.login LIKE 'c3027%' AND cp.estabelecimento_id = ? AND cp.excluido_em IS NULL ORDER BY cc.id, cp.id LIMIT 1`,
      [m.est],
    );
    const contrato = Number(k?.['id']);
    expect(contrato).toBeGreaterThan(0);
    const dados = {
      contrato,
      nome: NOME_INCLUSAO,
      nascimento: '1990-05-04',
      sexo: 'F',
      nomeMae: 'Mãe Sintética',
    };
    const fora = await abrirInclusao({ ...dados, contrato: 999999999 });
    expect(await aprovar(fora).catch(codigoDe)).toBe('inclusao-contrato-fora-da-conta');
    const semMae = await abrirInclusao({ ...dados, nomeMae: '' });
    expect(await aprovar(semMae).catch(codigoDe)).toBe('inclusao-sem-nome-mae');
    expect(await ler('SELECT id FROM pessoa_fisica WHERE nome = ?', [NOME_INCLUSAO])).toHaveLength(0);

    const r = await aprovar(await abrirInclusao(dados));
    expect(r.situacao).toBe('aprovada');
    const [sol] = await ler(
      'SELECT beneficiario_plano_id AS b, contrato_plano_id AS k FROM solicitacao_portal_beneficiario WHERE id = ?',
      [r.id],
    );
    const ben = Number(sol?.['b']);
    expect(ben).toBeGreaterThan(0);
    expect(Number(sol?.['k'])).toBe(contrato);
    const [b] = await ler(
      `SELECT b.situacao, b.tipo, b.contrato_plano_id, b.via_cartao, b.data_adesao, b.matricula, p.nome
         FROM beneficiario_plano b JOIN pessoa_fisica p ON p.id = b.pessoa_fisica_id WHERE b.id = ?`,
      [ben],
    );
    expect(b).toMatchObject({ situacao: 'ativo', tipo: 'titular', nome: NOME_INCLUSAO });
    expect(Number(b?.['contrato_plano_id'])).toBe(contrato);
    expect(Number(b?.['via_cartao'])).toBe(1);
    expect(String(b?.['data_adesao'])).toContain('2026');
    const cartoes = await ler(
      'SELECT numero_cartao, via, situacao FROM cartao_beneficiario WHERE beneficiario_plano_id = ?',
      [ben],
    );
    expect(cartoes).toHaveLength(1);
    expect(cartoes[0]).toMatchObject({ numero_cartao: b?.['matricula'], situacao: 'emitido' });
    const mov = await ler(
      "SELECT canal, situacao FROM movimento_cadastral_beneficiario WHERE beneficiario_plano_id = ? AND tipo_movimento = 'inclusao'",
      [ben],
    );
    expect(mov).toEqual([expect.objectContaining({ canal: 'portal', situacao: 'efetivado' })]);
    expect(await trilhas('solicitacao_portal_beneficiario', r.id)).toBe(1);

    // as opções do portal: os motivos de exclusão visíveis no portal e os contratos da contratante da conta
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'tc3027' }, (e) =>
      e.executar('UPDATE motivo_movimento_cadastral SET visivel_portal = TRUE WHERE id = ?', [motivo]),
    );
    const [cc] = await ler(
      "SELECT id, contratante_plano_id AS k FROM conta_portal_contratante WHERE login LIKE 'c3027%' ORDER BY id LIMIT 1",
    );
    const op = await porta.opcoesDoPortal(c, {
      id: Number(cc?.['id']),
      portal: 'contratante',
      contratante: Number(cc?.['k']),
    } as unknown as ContaPortalLida);
    expect(op.motivosExclusao.map((x) => x.id)).toContain(motivo);
    expect(op.contratos.map((x) => x.id)).toContain(contrato);
    const doBenef = await porta.opcoesDoPortal(c, { portal: 'beneficiario' } as unknown as ContaPortalLida);
    expect(doBenef.contratos).toEqual([]);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'tc3027' }, (e) =>
      e.executar('UPDATE motivo_movimento_cadastral SET visivel_portal = FALSE WHERE id = ?', [motivo]),
    );
    await limpar();
  });
});
