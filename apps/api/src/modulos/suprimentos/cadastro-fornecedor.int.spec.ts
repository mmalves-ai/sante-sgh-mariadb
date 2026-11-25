// Integração do cadastro do fornecedor, da avaliação periódica e das ocorrências (05-SUP linha 23) contra o MariaDB real
// (cliente f22_o5). Contrato de efeito: o fornecedor incluído (empresa_fornecedora com o documento só com dígitos,
// auditoria e versão 1; contatos, categorias com a principal e autorizações; a trilha e a chave em
// idempotencia_operacao; o reenvio pela chave sem linha nova); o documento repetido e o CNPJ inválido recusados; a
// alteração que exclui logicamente o contato retirado (excluido_em, nunca apagado), inclui o novo e sobe a versão; a
// versão velha recusada; a conta bancária no conta_bancaria_credor (a mesma do financeiro) com a preferencial única e a
// inativação sem apagar; a avaliação periódica (avaliacao_fornecedor com a nota da regra do contrato e a média do
// período, quatro avaliacao_fornecedor_item ligados ao cadastro de critérios); a ocorrência com número de negócio e o
// andamento até resolvida (tratativa e data); a transição proibida recusada; a ficha com os avisos do dia. Massa
// SINTÉTICA, limpa no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { OPERACOES_CADASTRO_FORNECEDOR, PortaCadastroFornecedorPropria } from './cadastro-fornecedor.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_DB = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CODIGOS = ['c2052a'];
const PREFIXO = 'C2052-';
// CNPJs sintéticos com dígitos válidos (raiz 52052xxx), sem dono real conhecido.
const CNPJ_A = '52052001000183';
const CNPJ_B = '52052002000128';

describe.skipIf(SEM_DB)('Cadastro do fornecedor contra o MariaDB (cliente f22_o5)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCadastroFornecedorPropria;
  let est = 0;
  let usuario = 0;
  let categoria = 0;
  let banco = 0;
  let ctx: ContextoPortaM18;
  let fornecedor = 0;
  const sufixo = String(Date.now()).slice(-8);
  const ler = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c2052-conta' }, (l) => l.consultar<T>(sql, p));

  async function limpar(e: Escritor): Promise<void> {
    const forn = `SELECT id FROM empresa_fornecedora WHERE cnpj IN ('${CNPJ_A}','${CNPJ_B}')`;
    await e.executar(
      `DELETE FROM avaliacao_fornecedor_item WHERE avaliacao_fornecedor_id IN (SELECT id FROM avaliacao_fornecedor WHERE empresa_fornecedora_id IN (${forn}))`,
      [],
    );
    for (const t of [
      'avaliacao_fornecedor',
      'ocorrencia_fornecedor',
      'conta_bancaria_credor',
      'empresa_fornecedora_contato',
      'empresa_fornecedora_categoria',
      'empresa_fornecedora_autorizacao',
    ])
      await e.executar(`DELETE FROM ${t} WHERE empresa_fornecedora_id IN (${forn})`, []);
    await e.executar(`DELETE FROM empresa_fornecedora WHERE cnpj IN ('${CNPJ_A}','${CNPJ_B}')`, []);
    await e.executar(`DELETE FROM categoria_fornecimento WHERE codigo LIKE '${PREFIXO}%'`, []);
    await e.executar(
      `DELETE FROM sequencia_negocio WHERE tipo = 'ocorrencia_fornecedor' AND estabelecimento_id IN (SELECT id FROM estabelecimento WHERE codigo = '${CODIGOS[0]}')`,
      [],
    );
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    porta = new PortaCadastroFornecedorPropria(nucleo);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c2052-massa' }, async (e) => {
      const agora = new Date();
      await limpar(e);
      const l = await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [CODIGOS[0]]);
      est = l
        ? Number(l.id)
        : await e.inserir(
            'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
            [CODIGOS[0], 'Hospital fictício c2052a', 'Hospital fictício c2052a (teste)', agora],
          );
      const u = await e.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', ['c2052.compras']);
      usuario = u
        ? Number(u.id)
        : await e.inserir(
            "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
            ['c2052.compras', 'Usuário fictício c2052', agora],
          );
      categoria = await e.inserir(
        "INSERT INTO categoria_fornecimento (codigo, descricao, tipo, exige_autorizacao_sanitaria, criado_em) VALUES (?, 'Medicamentos (teste)', 'medicamento', TRUE, ?)",
        [`${PREFIXO}MED`, agora],
      );
      const b = await e.uma<{ id: number }>('SELECT id FROM banco ORDER BY id LIMIT 1', []);
      banco = b ? Number(b.id) : 0;
    });
    ctx = { cliente: CLIENTE, estabelecimento: est, usuario, correlacao: `c2052-${sufixo}` };
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c2052-limpa' }, async (e) => {
        await limpar(e);
        await limparTrilhaDaMassa(e, { codigos: CODIGOS });
      });
      await nucleo.encerrar();
    }
  });

  const BASE = {
    tipoPessoa: 'juridica' as const,
    documento: '52.052.001/0001-83',
    razaoSocial: 'Distribuidora Fictícia C2052 Ltda',
    nomeFantasia: 'Fictícia',
    inscricaoEstadual: null,
    inscricaoMunicipal: null,
    optanteSimples: false,
    contribuinteIcms: true,
    cep: '01001-000',
    logradouro: 'Rua Fictícia',
    numeroEndereco: '1',
    complemento: null,
    bairro: null,
    email: 'Compras@Exemplo.invalid',
    site: null,
    numeroCnes: null,
    prazoEntregaDias: 5,
    diasValidadeAvaliacao: 180,
    forneceOpme: false,
    transportadora: false,
    prestadorServico: false,
    disponibilidade: 'comercial' as const,
    situacao: 'ativo' as const,
    motivoSituacao: null,
    observacao: null,
    categorias: [] as number[],
    categoriaPrincipal: null as number | null,
    contatos: [
      {
        id: null,
        finalidade: 'comercial' as const,
        nome: 'Vendas',
        cargo: null,
        telefone: '(11) 3000-0000',
        ramal: null,
        email: null,
        principal: true,
      },
      {
        id: null,
        finalidade: 'financeiro' as const,
        nome: 'Cobrança',
        cargo: null,
        telefone: null,
        ramal: null,
        email: 'fin@exemplo.invalid',
        principal: true,
      },
    ],
    autorizacoes: [
      {
        id: null,
        tipo: 'afe' as const,
        numero: '1.00000-0',
        orgaoEmissor: 'Vigilância sanitária',
        emitidoEm: '2026-01-01',
        validoAte: '2027-01-01',
        diasAviso: 30,
        bloqueiaCompraVencido: true,
        situacao: 'valido' as const,
      },
    ],
  };

  it('inclui o fornecedor com contatos, categorias e autorização; o reenvio pela chave não duplica', async () => {
    const e = { ...BASE, categorias: [categoria], categoriaPrincipal: categoria };
    const chave = `c2052-inc-${sufixo}`;
    const r = await porta.incluir(ctx, e, chave);
    fornecedor = r.id;
    expect((await porta.incluir(ctx, e, chave)).id).toBe(fornecedor);
    const [f] = await ler<Record<string, unknown>>(
      'SELECT cnpj, cpf, email, cep, versao, criado_por, principal_categoria_fornecimento_id AS principal FROM empresa_fornecedora WHERE id = ?',
      [fornecedor],
    );
    expect(f).toMatchObject({ cnpj: CNPJ_A, cpf: null, email: 'compras@exemplo.invalid', cep: '01001000' });
    expect(Number(f!['versao'])).toBe(1);
    expect(Number(f!['criado_por'])).toBe(usuario);
    expect(Number(f!['principal'])).toBe(categoria);
    const [conta] = await ler<{ c: number; a: number; k: number }>(
      `SELECT (SELECT COUNT(*) FROM empresa_fornecedora_contato WHERE empresa_fornecedora_id = ? AND excluido_em IS NULL) AS c,
              (SELECT COUNT(*) FROM empresa_fornecedora_autorizacao WHERE empresa_fornecedora_id = ?) AS a,
              (SELECT COUNT(*) FROM empresa_fornecedora_categoria WHERE empresa_fornecedora_id = ? AND principal) AS k`,
      [fornecedor, fornecedor, fornecedor],
    );
    expect([Number(conta!.c), Number(conta!.a), Number(conta!.k)]).toEqual([2, 1, 1]);
    const [t] = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'empresa_fornecedora' AND entidade_id = ?",
      [fornecedor],
    );
    expect(Number(t!.n)).toBe(1);
    const [i] = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = ? AND estabelecimento_id = ?',
      [OPERACOES_CADASTRO_FORNECEDOR.incluir, est],
    );
    expect(Number(i!.n)).toBe(1);
  });

  it('recusa documento repetido e CNPJ inválido', async () => {
    await expect(porta.incluir(ctx, { ...BASE }, `c2052-rep-${sufixo}`)).rejects.toMatchObject({
      problema: { codigo: 'documento-repetido' },
    });
    await expect(
      porta.incluir(ctx, { ...BASE, documento: '52052001000100' }, `c2052-inv-${sufixo}`),
    ).rejects.toMatchObject({ problema: { codigo: 'documento-invalido' } });
  });

  it('altera: o contato retirado sai por exclusão lógica, o novo entra e a versão sobe; versão velha recusada', async () => {
    const ficha = await porta.ficha(ctx, fornecedor);
    const comercial = ficha.contatos.find((c) => c.finalidade === 'comercial')!;
    const e = {
      ...BASE,
      categorias: [categoria],
      categoriaPrincipal: categoria,
      contatos: [
        { ...comercial, telefone: '(11) 3000-1111' },
        {
          id: null,
          finalidade: 'entrega' as const,
          nome: 'Expedição',
          cargo: null,
          telefone: '1140000000',
          ramal: '2',
          email: null,
          principal: false,
        },
      ],
      autorizacoes: ficha.autorizacoes.map((a) => ({ ...a, validoAte: '2027-06-30' })),
    };
    await porta.alterar(ctx, fornecedor, 1, e, `c2052-alt-${sufixo}`);
    const linhas = await ler<{ finalidade: string; excluido: number; telefone: string | null }>(
      'SELECT finalidade, excluido_em IS NOT NULL AS excluido, telefone FROM empresa_fornecedora_contato WHERE empresa_fornecedora_id = ? ORDER BY sequencia',
      [fornecedor],
    );
    expect(linhas.map((x) => [x.finalidade, Number(x.excluido), x.telefone])).toEqual([
      ['comercial', 0, '1130001111'],
      ['financeiro', 1, null],
      ['entrega', 0, '1140000000'],
    ]);
    const [v] = await ler<{ versao: number }>('SELECT versao FROM empresa_fornecedora WHERE id = ?', [
      fornecedor,
    ]);
    expect(Number(v!.versao)).toBe(2);
    await expect(porta.alterar(ctx, fornecedor, 1, e, `c2052-velha-${sufixo}`)).rejects.toBeTruthy();
  });

  it('conta bancária no cadastro do financeiro: preferencial única e inativação sem apagar', async () => {
    const conta = {
      banco: banco || null,
      tipoConta: 'corrente' as const,
      agencia: '0001',
      digitoAgencia: null,
      conta: '123456',
      digitoConta: '7',
      tipoChavePix: banco ? null : ('cnpj' as const),
      chavePix: banco ? null : CNPJ_A,
      titularNome: 'Distribuidora Fictícia C2052 Ltda',
      titularDocumento: CNPJ_A,
      preferencial: true,
    };
    const k1 = await porta.incluirConta(ctx, fornecedor, conta, `c2052-k1-${sufixo}`);
    const k2 = await porta.incluirConta(
      ctx,
      fornecedor,
      {
        ...conta,
        banco: null,
        conta: null,
        agencia: null,
        tipoChavePix: 'cnpj',
        chavePix: '52.052.001/0001-83',
      },
      `c2052-k2-${sufixo}`,
    );
    const ks = await ler<{ id: number; preferencial: number; ativo: number; chave_pix: string | null }>(
      'SELECT id, preferencial, ativo, chave_pix FROM conta_bancaria_credor WHERE empresa_fornecedora_id = ? ORDER BY id',
      [fornecedor],
    );
    expect(ks.map((x) => [Number(x.id), Number(x.preferencial)])).toEqual([
      [k1.id, 0],
      [k2.id, 1],
    ]);
    expect(ks[1]!.chave_pix).toBe(CNPJ_A);
    const [vk] = await ler<{ versao: number }>('SELECT versao FROM conta_bancaria_credor WHERE id = ?', [
      k2.id,
    ]);
    await porta.inativarConta(ctx, fornecedor, k2.id, Number(vk!.versao), `c2052-ki-${sufixo}`);
    const [d] = await ler<{ ativo: number; n: number }>(
      'SELECT ativo, (SELECT COUNT(*) FROM conta_bancaria_credor WHERE empresa_fornecedora_id = ?) AS n FROM conta_bancaria_credor WHERE id = ?',
      [fornecedor, k2.id],
    );
    expect([Number(d!.ativo), Number(d!.n)]).toEqual([0, 2]);
    const ficha = await porta.ficha(ctx, fornecedor);
    expect(ficha.contas.find((x) => x.id === k1.id)!.contaMascarada).toBe('••••3456');
  });

  it('avaliação periódica pela regra do contrato, com a média do período e os quatro itens', async () => {
    const a1 = await porta.avaliar(
      ctx,
      fornecedor,
      {
        avaliadoEm: '2026-06-30',
        periodoInicio: '2026-01-01',
        periodoFim: '2026-06-30',
        notas: { qualidade: 5, prazo: 4, atendimento: 4, documentacao: 3 },
        parecer: null,
      },
      `c2052-av1-${sufixo}`,
    );
    expect(a1).toMatchObject({ media: 4, resultado: 'qualificado', mediaPeriodo: 4 });
    const a2 = await porta.avaliar(
      ctx,
      fornecedor,
      {
        avaliadoEm: '2026-11-20',
        periodoInicio: '2026-01-01',
        periodoFim: '2026-10-31',
        notas: { qualidade: 3, prazo: 2, atendimento: 3, documentacao: 2 },
        parecer: 'Atrasos repetidos no período.',
      },
      `c2052-av2-${sufixo}`,
    );
    expect(a2).toMatchObject({ media: 2.5, resultado: 'desqualificado', mediaPeriodo: 3.25 });
    const [l] = await ler<Record<string, unknown>>(
      'SELECT nota_final, media_periodo, nota_entrega, nota_qualidade, situacao, avaliador_usuario_id, estabelecimento_id FROM avaliacao_fornecedor WHERE id = ?',
      [a2.id],
    );
    expect(l).toMatchObject({ situacao: 'concluida' });
    expect([Number(l!['nota_final']), Number(l!['media_periodo']), Number(l!['nota_entrega'])]).toEqual([
      2.5, 3.25, 2,
    ]);
    expect(Number(l!['estabelecimento_id'])).toBe(est);
    const itens = await ler<{ codigo: string; nota: number }>(
      `SELECT k.codigo, i.nota FROM avaliacao_fornecedor_item i JOIN criterio_avaliacao_fornecedor k ON k.id = i.criterio_avaliacao_fornecedor_id
        WHERE i.avaliacao_fornecedor_id = ? ORDER BY i.sequencia`,
      [a2.id],
    );
    expect(itens.map((x) => [x.codigo, Number(x.nota)])).toEqual([
      ['qualidade', 3],
      ['prazo', 2],
      ['atendimento', 3],
      ['documentacao', 2],
    ]);
    await expect(
      porta.avaliar(
        ctx,
        fornecedor,
        {
          avaliadoEm: '2026-11-20',
          periodoInicio: null,
          periodoFim: null,
          notas: { qualidade: 1, prazo: 5, atendimento: 5, documentacao: 5 },
          parecer: null,
        },
        `c2052-av3-${sufixo}`,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'parecer' } });
  });

  it('ocorrência com número de negócio e o andamento até resolvida; transição proibida recusada', async () => {
    const o = await porta.registrarOcorrencia(
      ctx,
      fornecedor,
      {
        tipo: 'avaria',
        gravidade: 'alta',
        ocorridoEm: '2026-11-20T09:30',
        quantidadeAfetada: 3,
        valorAfetado: 150,
        descricao: 'Caixas amassadas na entrega (teste)',
      },
      `c2052-oc-${sufixo}`,
    );
    expect(o.numero).toBeGreaterThan(0);
    await porta.andamentoOcorrencia(
      ctx,
      o.id,
      { situacao: 'notificada', tratativa: null, email: 'SAC@exemplo.invalid', versao: 1 },
      `c2052-on-${sufixo}`,
    );
    await porta.andamentoOcorrencia(
      ctx,
      o.id,
      { situacao: 'resolvida', tratativa: 'Reposição das 3 unidades.', email: null, versao: 2 },
      `c2052-or-${sufixo}`,
    );
    const [l] = await ler<Record<string, unknown>>(
      'SELECT situacao, email_notificacao, notificado_em IS NOT NULL AS notificada, resolvida_em IS NOT NULL AS resolvida, tratativa, versao FROM ocorrencia_fornecedor WHERE id = ?',
      [o.id],
    );
    expect(l).toMatchObject({
      situacao: 'resolvida',
      email_notificacao: 'sac@exemplo.invalid',
      tratativa: 'Reposição das 3 unidades.',
    });
    expect([Number(l!['notificada']), Number(l!['resolvida']), Number(l!['versao'])]).toEqual([1, 1, 3]);
    await expect(
      porta.andamentoOcorrencia(
        ctx,
        o.id,
        { situacao: 'aberta', tratativa: 'x', email: null, versao: 3 },
        `c2052-ox-${sufixo}`,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'transicao' } });
  });

  it('a ficha traz os avisos do dia e a busca acha pelo documento', async () => {
    const f = await porta.ficha(ctx, fornecedor);
    expect(f.avaliacoes.map((a) => a.resultado)).toEqual(['desqualificado', 'qualificado']);
    expect(f.proximaAvaliacao).toBe('2027-05-19');
    expect(f.avisos.map((a) => a.codigo)).toContain('desqualificado');
    expect(f.ocorrencias[0]).toMatchObject({ situacao: 'resolvida' });
    const achados = await porta.buscar(ctx, '52.052.001');
    expect(achados.map((x) => x.id)).toContain(fornecedor);
  });
});
