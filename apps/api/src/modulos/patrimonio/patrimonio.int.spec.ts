// Integração da porta própria do patrimônio (M54, etapa 6) contra o MariaDB real, cliente f22_o2 (onda 2), com massa
// SINTÉTICA (massa.spec-util.ts). Contrato de efeito de cada gravação: as linhas em bem_patrimonial, movimento_bem,
// inventario_bem, inventario_bem_item e grupo_bem, a `versao` e a trilha de auditoria; e as recusas (versão velha,
// plaqueta repetida, inventário encerrado, outro estabelecimento, o que ainda pede modelo). A plaqueta gerada usa o
// `formatarPlaqueta` real do domínio (o mesmo do serviço). A baixa grava o motivo de baixa do cadastro. As operações do
// lote não publicam mensagem de saída: o outbox (integracao_mensagem) fica vazio para a entidade gravada.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { formatarPlaqueta } from '@sgh/dominio-patrimonio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_PAT,
  P_PAT,
  contextoPat,
  encerrarMassaPatrimonio,
  type MassaPatrimonio,
  prepararMassaPatrimonio,
  SEM_BANCO_PAT,
  trilhaPat,
} from './massa.spec-util.js';
import { PortaPatrimonioPropria } from './porta-propria.js';
import type { BemNovo } from './tipos.js';

describe.skipIf(SEM_BANCO_PAT)('porta própria do patrimônio (MariaDB, cliente f22_o2)', () => {
  let m: MassaPatrimonio | null = null;
  let porta: PortaPatrimonioPropria;
  const M = () => m!;
  const ler = <T>(sql: string, p: unknown[]) =>
    M().nucleo.lerSomente({ cliente: CLIENTE_PAT, correlacao: 'int-0211-pat-conferir' }, (l) =>
      l.uma<T & Record<string, unknown>>(sql, p),
    );
  const trilhas = async (tabela: string, id: number) =>
    Number(
      (
        await ler<{ n: number }>(
          'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?',
          [tabela, id],
        )
      )?.n,
    );

  beforeAll(async () => {
    m = await prepararMassaPatrimonio();
    porta = new PortaPatrimonioPropria(m.nucleo, CLIENTE_PAT);
  });
  afterAll(async () => {
    await encerrarMassaPatrimonio(m);
  });

  const bemNovo = (plaqueta: string | null, centro: number): BemNovo => ({
    empresa: 1,
    plaqueta,
    descricao: 'MONITOR SINTETICO',
    grupo: 'equipamentoMedico',
    origem: M().origem,
    documento: 'termo',
    nota: null,
    itemNota: null,
    item: null,
    termo: { numero: 'T-1', data: '2026-01-10', doador: '' },
    dataAquisicao: '2026-01-10',
    valorCent: 12_000_00,
    residualCent: 1_000_00,
    vidaUtilMeses: 120,
    coeficiente: null,
    inicioDepreciacao: '2026-02',
    depreciavel: true,
    centro,
    localDetalhe: 'SALA 1',
    tipoResponsavel: null,
    responsavel: null,
    marca: 'MARCA S',
    modelo: 'MODELO S',
    numeroSerie: 'NS-1',
  });

  it('domínios e grupos: centros do estabelecimento, a origem e a semente dos grupos', async () => {
    const d = await porta.dominios(contextoPat(M()));
    expect(d.centros.map((c) => c.id)).toEqual(expect.arrayContaining([M().centro1, M().centro2]));
    expect(d.origens.some((o) => o.id === M().origem && o.depreciar)).toBe(true);
    expect(d.empresas).toHaveLength(1);
    const gs = await porta.grupos(contextoPat(M()));
    expect(gs.some((g) => g.codigo === 'equipamentoMedico' && g.ativo)).toBe(true);
  });

  const H = `${P_PAT}A`;
  const saidas = async (tabela: string, id: number) =>
    Number(
      (
        await ler<{ n: number }>(
          'SELECT COUNT(*) AS n FROM integracao_mensagem WHERE entidade = ? AND entidade_id = ?',
          [tabela, id],
        )
      )?.n,
    );

  it('bens: cadastrar (plaqueta gerada e informada), ler, plaqueta repetida, alterar com a versão e recusar a velha', async () => {
    // O gerador real do serviço (formatarPlaqueta recusa o número 0: a porta nunca o chama com 0).
    const gerar = (n: number) => formatarPlaqueta(H, n);
    await M().nucleo.escrever({ cliente: CLIENTE_PAT, correlacao: 'int-0211-pat-seq' }, (e) =>
      e.executar("DELETE FROM sequencia_negocio WHERE tipo = 'plaqueta_bem' AND estabelecimento_id = ?", [
        M().est,
      ]),
    );
    // Cliente migrado: já há a plaqueta 41 no formato; a sequência nasce depois dela.
    const [b0] = await porta.cadastrar(
      contextoPat(M()),
      { bens: [bemNovo(gerar(41), M().centro1)], item: null },
      'l0211p.patrimonio',
      gerar,
      trilhaPat(M(), 'patrimonio.bem.cadastrado', 'bem_patrimonial', null),
    );
    expect(b0!.plaqueta).toBe(`${H}000041`);
    const [b1, b2] = await porta.cadastrar(
      contextoPat(M()),
      { bens: [bemNovo(null, M().centro1), bemNovo('L0211-001', M().centro1)], item: null },
      'l0211p.patrimonio',
      gerar,
      trilhaPat(M(), 'patrimonio.bem.cadastrado', 'bem_patrimonial', null),
    );
    expect(b1!.plaqueta).toBe(`${H}000042`);
    expect(b2).toMatchObject({
      plaqueta: 'L0211-001',
      situacao: 'ativo',
      versao: 1,
      valorCent: 12_000_00,
      residualCent: 1_000_00,
      inicioDepreciacao: '2026-02',
      documento: 'termo',
      termo: { numero: 'T-1', data: '2026-01-10', doador: '' },
      criadoPor: 'l0211p.patrimonio',
    });
    expect(await trilhas('bem_patrimonial', b1!.id)).toBe(1);
    expect(await saidas('bem_patrimonial', b1!.id)).toBe(0);
    // A plaqueta digitada à frente da sequência (43) é pulada pela gerada (44), sem recusa.
    await porta.cadastrar(
      contextoPat(M()),
      { bens: [bemNovo(gerar(43), M().centro1)], item: null },
      'x',
      gerar,
      trilhaPat(M(), 'x', 'bem_patrimonial', null),
    );
    const [b4] = await porta.cadastrar(
      contextoPat(M()),
      { bens: [bemNovo(null, M().centro1)], item: null },
      'x',
      gerar,
      trilhaPat(M(), 'x', 'bem_patrimonial', null),
    );
    expect(b4!.plaqueta).toBe(`${H}000044`);
    expect((await porta.bemPorPlaqueta(contextoPat(M()), 'L0211-001'))?.id).toBe(b2!.id);
    expect((await porta.bens(contextoPat(M()), { pagina: 1, tamanho: 10, busca: 'MONITOR' })).total).toBe(5);
    await expect(
      porta.cadastrar(
        contextoPat(M()),
        { bens: [bemNovo('L0211-001', M().centro1)], item: null },
        'x',
        gerar,
        trilhaPat(M(), 'x', 'bem_patrimonial', null),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'plaqueta-repetida' } });
    // O responsável é um usuário (pelo login ou pelo nome exato): o desconhecido é recusado, nada gravado.
    await expect(
      porta.cadastrar(
        contextoPat(M()),
        {
          bens: [{ ...bemNovo(null, M().centro1), responsavel: 'USUARIO SINTETICO INEXISTENTE' }],
          item: null,
        },
        'x',
        gerar,
        trilhaPat(M(), 'x', 'bem_patrimonial', null),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'responsavel-inexistente' } });
    // Quem só tem vínculo com outra unidade da rede não responde por bem deste estabelecimento.
    await expect(
      porta.cadastrar(
        contextoPat(M()),
        { bens: [{ ...bemNovo(null, M().centro1), responsavel: 'l0211p.aceite' }], item: null },
        'x',
        gerar,
        trilhaPat(M(), 'x', 'bem_patrimonial', null),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'responsavel-inexistente' } });

    const alt = {
      id: b2!.id,
      versao: 1,
      descricao: 'MONITOR SINTETICO ALTERADO',
      grupo: 'equipamentoMedico',
      localDetalhe: 'SALA 2',
      tipoResponsavel: null,
      responsavel: null,
      marca: 'MARCA S',
      modelo: 'MODELO S',
      numeroSerie: 'NS-1',
      vidaUtilMeses: 100,
      residualCent: 500_00,
      coeficiente: null,
      inicioDepreciacao: '2026-02',
      depreciavel: true,
    };
    const r = await porta.alterar(
      contextoPat(M()),
      alt,
      'x',
      () => null,
      trilhaPat(M(), 'x', 'bem_patrimonial', b2!.id),
    );
    expect(r).toMatchObject({
      mudou: true,
      depois: { versao: 2, descricao: 'MONITOR SINTETICO ALTERADO', vidaUtilMeses: 100 },
    });
    const linha = await ler<{ valor_residual: string; local_detalhe: string }>(
      'SELECT valor_residual, local_detalhe FROM bem_patrimonial WHERE id = ?',
      [b2!.id],
    );
    expect([String(linha?.valor_residual), linha?.local_detalhe]).toEqual(['500.00', 'SALA 2']);
    await expect(
      porta.alterar(contextoPat(M()), alt, 'x', () => null, trilhaPat(M(), 'x', 'bem_patrimonial', b2!.id)),
    ).rejects.toMatchObject({ problema: { codigo: 'desatualizado' } });
  });

  it('movimentos: empréstimo e devolução; transferência pendente aceita move o centro; cancelamento; baixa com o motivo do cadastro', async () => {
    const c = contextoPat(M());
    const b = (await porta.bemPorPlaqueta(c, 'L0211-001'))!;
    const emp = await porta.registrarMovimento(
      contextoPat(M()),
      {
        bem: b.id,
        versaoBem: b.versao,
        tipo: 'emprestimo',
        situacao: 'concluido',
        data: '2026-03-01',
        origem: M().centro1,
        destino: null,
        destinoResponsavel: null,
        terceiro: 'HOSPITAL PARCEIRO SINTETICO',
        retornoPrevisto: '2026-04-01',
        termoNumero: null,
        motivo: 'emprestimo sintetico',
        motivoBaixa: null,
        valorVendaCent: null,
        referencia: null,
        efeito: { situacao: 'emprestado', baixadoEm: null },
      },
      'x',
      trilhaPat(M(), 'x', 'movimento_bem', null),
    );
    expect(emp.bem).toMatchObject({ situacao: 'emprestado', versao: b.versao + 1 });
    expect(emp.movimento).toMatchObject({
      tipo: 'emprestimo',
      situacao: 'concluido',
      solicitadoPor: 'l0211p.patrimonio',
    });
    expect(await porta.ultimaSaida(c, b.id)).toBe(emp.movimento.id);
    const dev = await porta.registrarMovimento(
      contextoPat(M()),
      {
        ...{
          bem: b.id,
          versaoBem: emp.bem.versao,
          tipo: 'devolucao' as const,
          situacao: 'concluido' as const,
          data: '2026-03-20',
        },
        origem: M().centro1,
        destino: null,
        destinoResponsavel: null,
        terceiro: null,
        retornoPrevisto: null,
        termoNumero: null,
        motivo: 'devolucao sintetica',
        motivoBaixa: null,
        valorVendaCent: null,
        referencia: emp.movimento.id,
        efeito: { situacao: 'ativo', baixadoEm: null },
      },
      'x',
      trilhaPat(M(), 'x', 'movimento_bem', null),
    );
    expect(dev.bem.situacao).toBe('ativo');

    // Transferência: pendente até o aceite; o aceite move o bem para o centro de destino.
    const tr = await porta.registrarMovimento(
      contextoPat(M()),
      {
        bem: b.id,
        versaoBem: dev.bem.versao,
        tipo: 'transferencia',
        situacao: 'pendente',
        data: '2026-04-01',
        origem: M().centro1,
        destino: M().centro2,
        destinoResponsavel: null,
        terceiro: null,
        retornoPrevisto: null,
        termoNumero: null,
        motivo: 'transferencia sintetica',
        motivoBaixa: null,
        valorVendaCent: null,
        referencia: null,
        efeito: null,
      },
      'x',
      trilhaPat(M(), 'x', 'movimento_bem', null),
    );
    expect(tr.bem.movimentoPendente).toEqual({ id: tr.movimento.id, tipo: 'transferencia' });
    await expect(
      porta.decidir(
        contextoPat(M(), M().aceitante),
        { id: tr.movimento.id, versao: 99, aceitar: true, motivo: null },
        'x',
        () => null,
        trilhaPat(M(), 'x', 'movimento_bem', tr.movimento.id),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'conflito-versao' } });
    const ac = await porta.decidir(
      contextoPat(M(), M().aceitante),
      { id: tr.movimento.id, versao: tr.movimento.versao, aceitar: true, motivo: null },
      'x',
      () => null,
      trilhaPat(M(), 'x', 'movimento_bem', tr.movimento.id),
    );
    expect(ac?.movimento).toMatchObject({ situacao: 'aceito', decididoPor: 'l0211p.aceite' });
    expect(ac?.bem.centro.id).toBe(M().centro2);
    expect(ac?.bem.movimentoPendente).toBeNull();

    // Transferência para o centro sem setor: recusada com a mensagem de negócio.
    await expect(
      porta.registrarMovimento(
        contextoPat(M()),
        {
          ...tr.movimento,
          bem: b.id,
          versaoBem: ac!.bem.versao,
          tipo: 'transferencia',
          situacao: 'pendente',
          data: '2026-05-01',
          origem: M().centro2,
          destino: M().centro1,
          motivo: 'x',
          efeito: null,
          referencia: null,
        } as never,
        'x',
        trilhaPat(M(), 'x', 'movimento_bem', null),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'destino-sem-setor' } });

    // Cancelamento de um pedido pendente (empréstimo pendente) e a baixa que ainda pede modelo.
    const b1 = (await porta.bens(c, { pagina: 1, tamanho: 10, busca: H })).bens[0]!;
    const pend = await porta.registrarMovimento(
      contextoPat(M()),
      {
        ...dev.movimento,
        bem: b1.id,
        versaoBem: b1.versao,
        tipo: 'emprestimo',
        situacao: 'pendente',
        data: '2026-05-01',
        origem: M().centro1,
        destino: null,
        terceiro: 'TERCEIRO SINTETICO',
        motivo: 'x',
        efeito: null,
        referencia: null,
      } as never,
      'x',
      trilhaPat(M(), 'x', 'movimento_bem', null),
    );
    const can = await porta.cancelar(
      contextoPat(M()),
      { id: pend.movimento.id, versao: pend.movimento.versao, motivo: 'cancelado no teste' },
      'x',
      () => null,
      trilhaPat(M(), 'x', 'movimento_bem', pend.movimento.id),
    );
    expect(can?.movimento).toMatchObject({ situacao: 'cancelado', decisaoMotivo: 'cancelado no teste' });
    // Baixa: o motivo de baixa do cadastro (sem ele, recusa); grava motivo_baixa_bem_id e baixa o bem.
    const motivoBaixa = await M().nucleo.escrever(
      { cliente: CLIENTE_PAT, correlacao: 'int-0211-pat-motivo' },
      async (e) => {
        const ja = await e.uma<{ id: number }>('SELECT id FROM motivo_baixa_bem WHERE codigo = ?', [
          'l0211p-obsoleto',
        ]);
        return ja
          ? Number(ja.id)
          : e.inserir(
              "INSERT INTO motivo_baixa_bem (codigo, descricao, tipo_baixa, criado_em) VALUES (?, 'OBSOLESCENCIA SINTETICA', 'obsolescencia', ?)",
              ['l0211p-obsoleto', new Date()],
            );
      },
    );
    expect(
      (await porta.dominios(c)).motivosBaixa.some((x) => x.id === motivoBaixa && x.tipo === 'obsolescencia'),
    ).toBe(true);
    const bb = (await porta.bem(c, b1.id))!;
    const baixa = {
      bem: bb.id,
      versaoBem: bb.versao,
      tipo: 'baixa' as const,
      situacao: 'concluido' as const,
      data: '2026-05-02',
      origem: bb.centro.id,
      destino: null,
      destinoResponsavel: null,
      terceiro: null,
      retornoPrevisto: null,
      termoNumero: 'TB-L0211',
      motivo: 'baixa sintetica',
      motivoBaixa: null as number | null,
      valorVendaCent: null,
      referencia: null,
      efeito: { situacao: 'baixado' as const, baixadoEm: '2026-05-02' },
    };
    await expect(
      porta.registrarMovimento(c, baixa, 'x', trilhaPat(M(), 'x', 'movimento_bem', null)),
    ).rejects.toMatchObject({
      problema: { codigo: 'motivo-baixa' },
    });
    const bx = await porta.registrarMovimento(
      c,
      { ...baixa, motivoBaixa },
      'x',
      trilhaPat(M(), 'x', 'movimento_bem', null),
    );
    expect(bx.bem).toMatchObject({ situacao: 'baixado', baixadoEm: '2026-05-02', versao: bb.versao + 1 });
    const lm = await ler<{ motivo_baixa_bem_id: number; numero_termo: string; tipo_movimento: string }>(
      'SELECT motivo_baixa_bem_id, numero_termo, tipo_movimento FROM movimento_bem WHERE id = ?',
      [bx.movimento.id],
    );
    expect([Number(lm?.motivo_baixa_bem_id), lm?.numero_termo, lm?.tipo_movimento]).toEqual([
      motivoBaixa,
      'TB-L0211',
      'baixa',
    ]);
    expect(await trilhas('movimento_bem', bx.movimento.id)).toBe(1);
    expect(await saidas('movimento_bem', bx.movimento.id)).toBe(0);
    expect((await porta.movimentos(c, { bem: b.id })).map((x) => x.tipo)).toEqual([
      'transferencia',
      'devolucao',
      'emprestimo',
    ]);
  });

  it('inventário: abrir, ler (resultado no banco), encerrar; encerrado recusa leitura; cancelar com motivo', async () => {
    const c = contextoPat(M());
    const id = await porta.abrirInventario(
      contextoPat(M()),
      { descricao: 'INVENTARIO SINTETICO', centro: M().centro2 },
      'x',
      trilhaPat(M(), 'x', 'inventario_bem', null),
    );
    const b = (await porta.bemPorPlaqueta(c, 'L0211-001'))!;
    await porta.registrarLeitura(
      contextoPat(M()),
      {
        inventario: id,
        codigo: b.plaqueta,
        bem: b.id,
        centroLido: M().centro2,
        resultado: 'conforme',
        observacao: null,
      },
      'x',
      trilhaPat(M(), 'x', 'inventario_bem_item', null),
    );
    await porta.registrarLeitura(
      contextoPat(M()),
      {
        inventario: id,
        codigo: 'XYZ-SEM-CADASTRO',
        bem: null,
        centroLido: M().centro2,
        resultado: 'nao-cadastrado',
        observacao: 'sem etiqueta',
      },
      'x',
      trilhaPat(M(), 'x', 'inventario_bem_item', null),
    );
    const ls = (await porta.leituras(c, id)).leituras;
    expect(ls.map((l) => [l.resultado, l.bem?.id ?? null, l.lidoPor])).toEqual([
      ['conforme', b.id, 'l0211p.patrimonio'],
      ['nao-cadastrado', null, 'l0211p.patrimonio'],
    ]);
    const banco = await ler<{ resultado: string }>(
      'SELECT resultado FROM inventario_bem_item WHERE inventario_bem_id = ? AND bem_patrimonial_id IS NULL',
      [id],
    );
    expect(banco?.resultado).toBe('nao_cadastrado');
    expect((await porta.esperados(c, M().centro2)).bens.map((x) => x.id)).toContain(b.id);
    expect(
      await porta.encerrarInventario(
        contextoPat(M()),
        { id, esperados: 1, resumo: '{}' },
        'x',
        trilhaPat(M(), 'x', 'inventario_bem', id),
      ),
    ).toBe(true);
    expect(await porta.inventario(c, id)).toMatchObject({
      situacao: 'encerrado',
      abertoPor: 'l0211p.patrimonio',
    });
    await expect(
      porta.registrarLeitura(
        contextoPat(M()),
        {
          inventario: id,
          codigo: 'X',
          bem: null,
          centroLido: 0,
          resultado: 'nao-cadastrado',
          observacao: null,
        },
        'x',
        trilhaPat(M(), 'x', 'inventario_bem_item', null),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'inventario-encerrado' } });
    const id2 = await porta.abrirInventario(
      contextoPat(M()),
      { descricao: 'INVENTARIO PARA CANCELAR', centro: null },
      'x',
      trilhaPat(M(), 'x', 'inventario_bem', null),
    );
    expect(
      await porta.cancelarInventario(
        contextoPat(M()),
        { id: id2, motivo: 'aberto por engano' },
        'x',
        trilhaPat(M(), 'x', 'inventario_bem', id2),
      ),
    ).toBe(true);
    expect(await porta.inventario(c, id2)).toMatchObject({
      situacao: 'cancelado',
      motivoCancelamento: 'aberto por engano',
      canceladoPor: 'l0211p.patrimonio',
    });
    expect((await porta.inventarios(c)).map((i) => i.id)).toEqual([id2, id]);
  });

  it('grupos: incluir, alterar (a versão anterior vem da trilha), inativar com motivo, excluir sem bens', async () => {
    const c = contextoPat(M());
    const g = await porta.incluirGrupo(
      contextoPat(M()),
      { codigo: 'l0211grp', nome: 'GRUPO SINTETICO', vidaUtilMeses: 60, conta: null },
      'x',
      trilhaPat(M(), 'x', 'grupo_bem', null),
    );
    expect(g).toMatchObject({
      codigo: 'l0211grp',
      vidaUtilMeses: 60,
      ativo: true,
      semente: false,
      versao: 1,
    });
    await expect(
      porta.incluirGrupo(
        contextoPat(M()),
        { codigo: 'l0211grp', nome: 'X', vidaUtilMeses: 60, conta: null },
        'x',
        trilhaPat(M(), 'x', 'grupo_bem', null),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'codigo-em-uso' } });
    const alt = await porta.alterarGrupo(
      contextoPat(M()),
      {
        codigo: 'l0211grp',
        nome: 'GRUPO SINTETICO 2',
        vidaUtilMeses: 48,
        conta: null,
        versaoVista: 1,
        motivo: 'vida util revista',
      },
      'x',
      trilhaPat(M(), 'x', 'grupo_bem', g.id),
    );
    expect(alt.depois).toMatchObject({ nome: 'GRUPO SINTETICO 2', vidaUtilMeses: 48, versao: 2 });
    const versoes = await porta.versoesGrupo(c, g.id);
    expect(versoes[0]).toMatchObject({
      versao: 1,
      operacao: 'alteracao',
      nome: 'GRUPO SINTETICO',
      vidaUtilMeses: 60,
      motivo: 'vida util revista',
      por: 'l0211p.patrimonio',
    });
    await expect(
      porta.alterarGrupo(
        contextoPat(M()),
        { codigo: 'l0211grp', nome: 'Y', vidaUtilMeses: 48, conta: null, versaoVista: 1, motivo: 'velha' },
        'x',
        trilhaPat(M(), 'x', 'grupo_bem', g.id),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'desatualizado' } });
    const ina = await porta.situacaoGrupo(
      contextoPat(M()),
      { codigo: 'l0211grp', versaoVista: 2, motivo: 'fora de uso', ativo: false },
      'x',
      trilhaPat(M(), 'x', 'grupo_bem', g.id),
    );
    expect(ina.depois).toMatchObject({ ativo: false, motivoInativacao: 'fora de uso', versao: 3 });
    await porta.excluirGrupo(
      contextoPat(M()),
      { codigo: 'l0211grp', versaoVista: 3, motivo: 'teste' },
      'x',
      trilhaPat(M(), 'x', 'grupo_bem', g.id),
    );
    expect((await porta.grupos(c)).some((x) => x.codigo === 'l0211grp')).toBe(false);
    // Grupo com bens: a exclusão é recusada com os dependentes (o bem da massa usa a semente).
    const sem = (await porta.grupos(c)).find((x) => x.codigo === 'equipamentoMedico')!;
    await expect(
      porta.excluirGrupo(
        contextoPat(M()),
        { codigo: 'equipamentoMedico', versaoVista: sem.versao, motivo: 'x' },
        'x',
        trilhaPat(M(), 'x', 'grupo_bem', sem.id),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'com-dependentes' } });
  });

  it('depreciação: calcula a competência, recusa o segundo cálculo, estorna e recalcula numa rodada nova', async () => {
    const c = contextoPat(M());
    const r = await porta.bensParaDepreciar(c, 1, '2026-06');
    expect(r.bens.length).toBeGreaterThanOrEqual(2);
    expect(r.bens.every((b) => b.acumuladaCent === 0 && !b.temCotaNaCompetencia)).toBe(true);
    const trilha = trilhaPat(M(), 'patrimonio.depreciacao.calculada', 'calculo_depreciacao', null);
    const montar = ({ bens }: { bens: typeof r.bens }) => {
      const cotas = bens.slice(0, 2).map((b) => ({
        bem: b.id,
        plaqueta: b.plaqueta,
        grupo: b.grupo,
        centro: b.centro,
        baseCent: b.valorCent,
        residualCent: b.residualCent,
        vidaUtilMeses: b.vidaUtilMeses,
        coeficiente: 1,
        acumuladaAntesCent: b.acumuladaCent,
        valorCent: 100_00,
      }));
      return {
        impedimentos: [],
        cotas,
        ignorados: bens.length - cotas.length,
        totalCent: 200_00,
        resumo: '',
      };
    };
    const um = await porta.calcular(
      contextoPat(M()),
      { empresa: 1, competencia: '2026-06' },
      't',
      montar,
      trilha,
    );
    expect(um.calculo).toMatchObject({ competencia: '2026-06', bens: 2, totalCent: 200_00, rodada: 1 });
    expect(um.calculo.calculadoEm).not.toBe('');
    const cotas = await porta.cotas(c, um.calculo.id);
    expect(cotas.map((k) => k.valorCent)).toEqual([100_00, 100_00]);
    expect(cotas[0]?.vidaUtilMeses).toBe(r.bens[0]?.vidaUtilMeses);
    await expect(
      porta.calcular(contextoPat(M()), { empresa: 1, competencia: '2026-06' }, 't', montar, trilha),
    ).rejects.toMatchObject({
      problema: { codigo: 'ja-calculado' },
    });
    expect((await porta.calculos(c, 1, '2026-06')).daCompetencia?.id).toBe(um.calculo.id);
    const julho = await porta.bensParaDepreciar(c, 1, '2026-07');
    expect(julho.bens.find((b) => b.id === cotas[0]?.bem)?.acumuladaCent).toBe(100_00);
    await expect(
      porta.estornar(
        contextoPat(M()),
        { empresa: 1, competencia: '2026-06', motivo: 'x', origem: 'tela' },
        't',
        () => ({
          codigo: 'lote-exportado',
          detalhe: 'Lote liberado.',
        }),
        trilha,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'lote-exportado' } });
    const e = await porta.estornar(
      contextoPat(M()),
      { empresa: 1, competencia: '2026-06', motivo: 'Cálculo de teste', origem: 'tela' },
      't',
      (s) =>
        s.daCompetencia?.id === um.calculo.id && s.lotesExportados.length === 0
          ? null
          : { codigo: 'x', detalhe: 'x' },
      trilha,
    );
    expect(e.estorno).toMatchObject({
      calculo: um.calculo.id,
      competencia: '2026-06',
      totalCent: 200_00,
      motivo: 'Cálculo de teste',
    });
    expect((await porta.calculos(c, 1, '2026-06')).daCompetencia).toBeNull();
    expect((await porta.bensParaDepreciar(c, 1, '2026-07')).bens.every((b) => b.acumuladaCent === 0)).toBe(
      true,
    );
    const dois = await porta.calcular(
      contextoPat(M()),
      { empresa: 1, competencia: '2026-06' },
      't',
      montar,
      trilha,
    );
    expect(dois.calculo.rodada).toBe(2);
    expect((await porta.estornos(c, 1, '2026-06')).map((x) => x.calculo)).toEqual([um.calculo.id]);
  });

  it('outro estabelecimento: não lê o bem nem grava nele', async () => {
    const b = (await porta.bemPorPlaqueta(contextoPat(M()), 'L0211-001'))!;
    const outro = contextoPat(M(), M().usuario, M().outro);
    expect(await porta.bem(outro, b.id)).toBeNull();
    expect(await porta.bemPorPlaqueta(outro, 'L0211-001')).toBeNull();
    expect(await porta.movimentos(outro, { bem: b.id })).toEqual([]);
    await expect(
      porta.registrarMovimento(
        outro,
        {
          bem: b.id,
          versaoBem: b.versao,
          tipo: 'emprestimo',
          situacao: 'pendente',
          data: '2026-06-01',
          origem: M().centro2,
          destino: null,
          destinoResponsavel: null,
          terceiro: 'T',
          retornoPrevisto: null,
          termoNumero: null,
          motivo: 'x',
          motivoBaixa: null,
          valorVendaCent: null,
          referencia: null,
          efeito: null,
        },
        'x',
        trilhaPat(M(), 'x', 'movimento_bem', null),
      ),
    ).rejects.toMatchObject({ problema: { status: 404 } });
  });
});
