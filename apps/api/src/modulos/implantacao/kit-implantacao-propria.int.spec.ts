// Contrato de efeito do kit de implantação (C2-025, 01-ADM L98) contra o MariaDB real (cliente de teste), num
// estabelecimento SINTÉTICO novo, sem nada de origem: o checklist padrão vem só da semeadura da migração 01_SIS/95.
// Prova o que fica no banco: o diagnóstico pelo modelo (contagem zero no hospital novo); a abertura da implantação com
// um item por linha ativa do modelo, conferido pela contagem; a recontagem depois de cadastrar setores (pendente, em
// andamento, pronto); a dispensa com motivo e a reabertura; o prazo e o responsável; a recusa de marcar pronto à mão
// abaixo do mínimo; a meta com a medição e a situação; a fase "virada" com o instante; a edição do modelo pela
// plataforma; as recusas (segunda implantação aberta, versão velha); e que as contagens de usuários, profissionais e
// exames são do estabelecimento: com dois hospitais na mesma base, um não conta os cadastros do outro. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaKitImplantacaoPropria } from './kit-implantacao-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const P = 'c2025kit';
const P2 = 'c2025kit2';
const MODELO_TESTE = 'C2025-TESTE';

async function limpar(e: Escritor): Promise<void> {
  const ests = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  const sd = `(SELECT id FROM setor_diagnostico WHERE estabelecimento_id IN ${ests})`;
  await e.executar(`DELETE FROM exame_setor_executante WHERE setor_diagnostico_id IN ${sd}`, [P, P2]);
  await e.executar(`DELETE FROM setor_diagnostico WHERE estabelecimento_id IN ${ests}`, [P, P2]);
  await e.executar(`DELETE FROM lotacao_profissional WHERE estabelecimento_id IN ${ests}`, [P, P2]);
  await e.executar(`DELETE FROM usuario_estabelecimento WHERE estabelecimento_id IN ${ests}`, [P, P2]);
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const imp = `(SELECT id FROM implantacao_estabelecimento WHERE estabelecimento_id IN ${est})`;
  await e.executar(`DELETE FROM item_prontidao WHERE implantacao_estabelecimento_id IN ${imp}`, [P]);
  await e.executar(`DELETE FROM meta_implantacao WHERE implantacao_estabelecimento_id IN ${imp}`, [P]);
  await e.executar(`DELETE FROM implantacao_estabelecimento WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar('DELETE FROM modelo_item_prontidao WHERE codigo = ?', [MODELO_TESTE]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaKitImplantacaoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaKitImplantacaoPropria;
  let est = 0;
  let est2 = 0;
  let usuario = 0;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario, correlacao: P });
  const ctx2 = () => ({ cliente: CLIENTE, hospital: P2, usuario, correlacao: P });
  // Sem implantação aberta, a contagem vem do diagnóstico; com ela, da recontagem gravada no item.
  const contagem = async (c: ReturnType<typeof ctx>, codigo: string) => {
    const p = await porta.painel(c);
    if (!p.implantacao) return p.diagnostico.find((d) => d.codigo === codigo)?.contagem;
    await porta.conferir(c, p.implantacao.id);
    return (await porta.painel(c)).itens.find((i) => i.modelo.codigo === codigo)?.quantidadeRealizada;
  };
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const item = async (codigo: string) =>
    (
      await ler(
        `SELECT i.* FROM item_prontidao i JOIN modelo_item_prontidao m ON m.id = i.modelo_item_prontidao_id
           JOIN implantacao_estabelecimento ie ON ie.id = i.implantacao_estabelecimento_id
          WHERE ie.estabelecimento_id = ? AND m.codigo = ?`,
        [est, codigo],
      )
    )[0]!;
  const setores = (n: number) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: `setores-${P}` }, async (e) => {
      for (let k = 0; k < n; k++)
        await e.inserir(
          'INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ?, NOW(3))',
          [est, `${P}-${Date.now()}-${k}`, `Setor sintético ${k}`, 'administrativo'],
        );
    });
  const falha = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return `${String(e)} ${JSON.stringify(e)}`;
    }
    throw new Error('era para recusar');
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const u = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      if (!u?.['id']) throw new Error('O cliente de teste precisa de um usuário.');
      usuario = Number(u['id']);
      const modelo = await e.uma('SELECT COUNT(*) AS n FROM modelo_item_prontidao WHERE codigo = ?', [
        'ADM-SETORES',
      ]);
      if (Number(modelo?.['n']) !== 1)
        throw new Error('Aplique a migração 02_ADM/99zc_kit_implantacao no cliente de teste.');
      est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', NOW(3))`,
        [P, `Hospital novo sintético ${P}`, `Hospital novo sintético ${P} (fictício)`],
      );
      est2 = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', NOW(3))`,
        [P2, `Outro hospital sintético ${P2}`, `Outro hospital sintético ${P2} (fictício)`],
      );
    });
    porta = new PortaKitImplantacaoPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  }, 60_000);

  it('o hospital novo sem implantação mostra o diagnóstico pelo modelo, com a contagem de cada cadastro', async () => {
    const p = await porta.painel(ctx());
    expect(p.implantacao).toBeNull();
    const ativos = await ler('SELECT COUNT(*) AS n FROM modelo_item_prontidao WHERE ativo');
    expect(p.diagnostico).toHaveLength(Number(ativos[0]!['n']));
    const setor = p.diagnostico.find((d) => d.codigo === 'ADM-SETORES')!;
    expect(setor).toMatchObject({ contagem: 0, situacao: 'pendente', critico: true, quantidadeMinima: 3 });
    expect(p.diagnostico.find((d) => d.codigo === 'ADM-HOMOLOGACAO')).toMatchObject({
      contagem: null,
      situacao: 'pendente',
    });
    expect(p.resumo.oQueFalta.length).toBeGreaterThan(0);
  });

  it('abre a implantação com um item por linha do modelo e reconta depois dos cadastros', async () => {
    const r = await porta.iniciar(ctx(), {
      nome: 'Implantação sintética',
      dataInicioPrevista: '2026-12-01',
      dataViradaPrevista: '2027-02-01',
      responsavelClienteNome: 'Gerente sintético',
    });
    const [imp] = await ler('SELECT * FROM implantacao_estabelecimento WHERE id = ?', [r.id]);
    expect(imp).toMatchObject({
      estabelecimento_id: est,
      fase: 'inicializacao',
      situacao: 'em_andamento',
      responsavel_usuario_id: usuario,
      criado_por: usuario,
      versao: 1,
    });
    const [n] = await ler(
      'SELECT COUNT(*) AS n FROM item_prontidao WHERE implantacao_estabelecimento_id = ?',
      [r.id],
    );
    expect(Number(n!['n'])).toBe(r.itens);
    expect(await item('ADM-SETORES')).toMatchObject({
      situacao: 'pendente',
      quantidade_prevista: 3,
      quantidade_realizada: 0,
      concluido_em: null,
    });
    expect((await item('ADM-SETORES'))['ultima_conferencia_em']).not.toBeNull();
    // O hospital novo não herda os usuários das outras unidades da base: conta só quem tem acesso a ele.
    expect((await item('ADM-USUARIOS'))['quantidade_realizada']).toBe(0);
    // Segunda implantação aberta recusa, sem escrita.
    expect(await falha(porta.iniciar(ctx(), { nome: 'Outra implantação' }))).toMatch(/implantação aberta/);

    await setores(1);
    const c = await porta.conferir(ctx(), r.id);
    expect(c.alterados).toBeGreaterThanOrEqual(1);
    expect(await item('ADM-SETORES')).toMatchObject({
      situacao: 'em_andamento',
      quantidade_realizada: 1,
      versao: 2,
    });
    await setores(2);
    await porta.conferir(ctx(), r.id);
    const s = await item('ADM-SETORES');
    expect(s).toMatchObject({
      situacao: 'pronto',
      quantidade_realizada: 3,
      versao: 3,
      alterado_por: usuario,
    });
    expect(s['concluido_em']).not.toBeNull();
    // Sem mudança, a recontagem não sobe a versão.
    await porta.conferir(ctx(), r.id);
    expect((await item('ADM-SETORES'))['versao']).toBe(3);
  });

  it('dois hospitais na mesma base: usuários, profissionais e exames de um não contam no outro', async () => {
    const [u] = await ler<{ a: number; b: number }>(
      'SELECT MIN(id) AS a, MAX(id) AS b FROM usuario WHERE excluido_em IS NULL',
    );
    const [pr] = await ler<{ id: number }>(
      "SELECT MIN(id) AS id FROM profissional WHERE situacao = 'ativo' AND excluido_em IS NULL",
    );
    const [cbo] = await ler<{ id: number }>('SELECT MIN(id) AS id FROM ocupacao_cbo');
    const [ex] = await ler<{ id: number }>(
      'SELECT MIN(id) AS id FROM exame WHERE ativo AND excluido_em IS NULL',
    );
    if (!u?.a || !u.b || u.a === u.b || !pr?.id || !cbo?.id || !ex?.id)
      throw new Error(
        'O cliente de teste precisa de 2 usuários, 1 profissional ativo, 1 CBO e 1 exame ativo.',
      );
    // Tudo cadastrado só no outro hospital.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `outro-${P2}` }, async (e) => {
      for (const id of [u.a, u.b])
        await e.inserir(
          `INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em)
           VALUES (?, ?, CURRENT_DATE, NOW(3))`,
          [id, est2],
        );
      await e.inserir(
        `INSERT INTO lotacao_profissional (profissional_id, estabelecimento_id, ocupacao_cbo_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, CURRENT_DATE, NOW(3))`,
        [pr.id, est2, cbo.id],
      );
      const sd = await e.inserir(
        `INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em)
         VALUES (?, ?, ?, 'laboratorio', NOW(3))`,
        [est2, `${P2}-lab`, 'Laboratório sintético'],
      );
      await e.inserir(
        'INSERT INTO exame_setor_executante (exame_id, setor_diagnostico_id, criado_em) VALUES (?, ?, NOW(3))',
        [ex.id, sd],
      );
    });
    expect(await contagem(ctx2(), 'ADM-USUARIOS')).toBe(2);
    expect(await contagem(ctx2(), 'CAD-PROFISSIONAIS')).toBe(1);
    expect(await contagem(ctx2(), 'SADT-EXAMES')).toBe(1);
    expect(await contagem(ctx(), 'ADM-USUARIOS')).toBe(0);
    expect(await contagem(ctx(), 'CAD-PROFISSIONAIS')).toBe(0);
    expect(await contagem(ctx(), 'SADT-EXAMES')).toBe(0);
    // Acesso vencido não conta; o acesso vigente ao hospital novo conta só nele, e a recontagem grava a contagem.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `acesso-${P}` }, async (e) => {
      await e.inserir(
        `INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, vigencia_fim, criado_em)
         VALUES (?, ?, '2020-01-01', '2020-12-31', NOW(3))`,
        [u.a, est],
      );
      await e.inserir(
        `INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em)
         VALUES (?, ?, CURRENT_DATE, NOW(3))`,
        [u.b, est],
      );
    });
    expect(await contagem(ctx(), 'ADM-USUARIOS')).toBe(1);
    expect(await contagem(ctx2(), 'ADM-USUARIOS')).toBe(2);
    const imp = (await porta.painel(ctx())).implantacao!.id;
    await porta.conferir(ctx(), imp);
    expect(await item('ADM-USUARIOS')).toMatchObject({ quantidade_realizada: 1, situacao: 'em_andamento' });
  });

  it('dispensa com motivo, reabre pela contagem, prazo e responsável; recusa pronto à mão abaixo do mínimo', async () => {
    const leitos = await item('INT-LEITOS');
    expect(
      await falha(porta.alterarItem(ctx(), Number(leitos['id']), { situacao: 'pronto', versao: 1 })),
    ).toMatch(/0 de 1 registros/);
    expect(
      await falha(porta.alterarItem(ctx(), Number(leitos['id']), { situacao: 'dispensado', versao: 1 })),
    ).toMatch(/motivo/);
    expect(
      await falha(porta.alterarItem(ctx(), Number(leitos['id']), { dataPrazo: '2026-11-01', versao: 1 })),
    ).toMatch(/anterior ao início/);
    await porta.alterarItem(ctx(), Number(leitos['id']), {
      situacao: 'dispensado',
      motivoDispensa: 'Hospital-dia sem internação',
      versao: 1,
    });
    expect(await item('INT-LEITOS')).toMatchObject({
      situacao: 'dispensado',
      motivo_dispensa: 'Hospital-dia sem internação',
      versao: 2,
    });
    expect(
      await falha(porta.alterarItem(ctx(), Number(leitos['id']), { observacao: 'x', versao: 1 })),
    ).toMatch(/outra pessoa/);
    await porta.alterarItem(ctx(), Number(leitos['id']), {
      situacao: 'pendente',
      dataPrazo: '2026-12-20',
      responsavelNome: 'Enfermeira sintética',
      responsavelEmail: 'enfermeira@exemplo.invalid',
      versao: 2,
    });
    const reaberto = await item('INT-LEITOS');
    expect(reaberto).toMatchObject({
      situacao: 'pendente',
      motivo_dispensa: null,
      responsavel_cliente_nome: 'Enfermeira sintética',
      versao: 3,
    });
    // O item manual fica pronto à mão, com o instante.
    const hom = await item('ADM-HOMOLOGACAO');
    await porta.alterarItem(ctx(), Number(hom['id']), { situacao: 'pronto', versao: Number(hom['versao']) });
    expect((await item('ADM-HOMOLOGACAO'))['concluido_em']).not.toBeNull();
    const p = await porta.painel(ctx());
    expect(p.implantacao?.nome).toBe('Implantação sintética');
    expect(p.itens.find((i) => i.modelo.codigo === 'INT-LEITOS')).toMatchObject({
      dataPrazo: '2026-12-20',
      situacao: 'pendente',
    });
    expect(p.resumo.prontos).toBeGreaterThanOrEqual(2);
  });

  it('metas com medição, fase da virada e edição do modelo pela plataforma', async () => {
    const p0 = await porta.painel(ctx());
    const id = p0.implantacao!.id;
    expect(
      await falha(porta.incluirMeta(ctx(), id, { processo: 'x', indicador: 'adesao', valorMeta: 150 })),
    ).toMatch(/percentuais/);
    const m = await porta.incluirMeta(ctx(), id, {
      processo: 'Admissão pelo sistema',
      indicador: 'adesao',
      valorMeta: 90,
      unidade: 'percentual',
      dataLimite: '2027-03-01',
      modulo: 'atendimento',
    });
    expect(await porta.medirMeta(ctx(), m.id, { valorMedido: 75, versao: 1 })).toMatchObject({
      situacao: 'parcial',
    });
    expect(
      await porta.medirMeta(ctx(), m.id, { valorMedido: 93, analise: 'boa adesão', versao: 2 }),
    ).toMatchObject({
      situacao: 'atingida',
    });
    const [meta] = await ler('SELECT * FROM meta_implantacao WHERE id = ?', [m.id]);
    expect(meta).toMatchObject({ sequencia: 1, situacao: 'atingida', analise: 'boa adesão', versao: 3 });
    expect(Number(meta!['valor_medido'])).toBe(93);
    expect(meta!['medido_em']).not.toBeNull();

    await porta.alterarImplantacao(ctx(), id, { fase: 'virada', versao: p0.implantacao!.versao });
    const [imp] = await ler('SELECT fase, virada_em, versao FROM implantacao_estabelecimento WHERE id = ?', [
      id,
    ]);
    expect(imp).toMatchObject({ fase: 'virada', versao: 2 });
    expect(imp!['virada_em']).not.toBeNull();
    expect(
      await falha(porta.alterarImplantacao(ctx(), id, { dataFimPrevista: '2026-01-01', versao: 2 })),
    ).toMatch(/fim previsto/);

    expect(
      await falha(
        porta.salvarModelo(ctx(), {
          codigo: MODELO_TESTE,
          titulo: 'Contagem inexistente',
          modulo: 'administracao',
          tipo: 'cadastro_minimo',
          entidade: 'tabela_desconhecida',
        }),
      ),
    ).toMatch(/contagens conhecidas/);
    const novo = await porta.salvarModelo(ctx(), {
      codigo: MODELO_TESTE,
      titulo: 'Escala de plantão publicada',
      modulo: 'administracao',
      tipo: 'conferencia',
      critico: false,
      ativo: false,
    });
    await porta.salvarModelo(ctx(), {
      codigo: MODELO_TESTE,
      titulo: 'Escala de plantão publicada no mural',
      modulo: 'administracao',
      tipo: 'conferencia',
      ativo: false,
    });
    const [mod] = await ler('SELECT * FROM modelo_item_prontidao WHERE id = ?', [novo.id]);
    expect(mod).toMatchObject({
      titulo: 'Escala de plantão publicada no mural',
      tipo_verificacao: 'conferencia',
      entidade: null,
      ativo: 0,
      versao: 2,
      criado_por: usuario,
      alterado_por: usuario,
    });
    expect((await porta.modelo(ctx())).itens.some((i) => i.codigo === MODELO_TESTE)).toBe(true);
    // Cada gravação deixa a trilha da operação na mesma transação, no estabelecimento da sessão.
    const trilha = await ler('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [
      est,
    ]);
    expect(Number(trilha[0]!['n'])).toBeGreaterThanOrEqual(10);
  });
});
