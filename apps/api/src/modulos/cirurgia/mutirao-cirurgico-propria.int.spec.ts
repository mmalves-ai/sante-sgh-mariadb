// Contrato de efeito dos projetos e mutirões cirúrgicos do SUS (F8, 04-CC linha 108) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA com o código "c2041mt": dois estabelecimentos fictícios, um paciente, dois procedimentos
// cirúrgicos (um com SIGTAP, outro sem), três AIH e uma APAC fictícias em 2030 (nenhuma pessoa real). A AIH e a APAC
// entram com a checagem de chave estrangeira desligada só no preparo (a internação, a competência e a autorização são
// ids fictícios; a porta não as lê); o procedimento SIGTAP, o domínio SUS, o fornecedor, o item faturável e o usuário
// são ids já existentes do cliente de teste (só os ids são lidos).
// Prova o que fica no banco: justificativas (código repetido recusado); o projeto planejado com a portaria (vigência
// invertida recusada sem escrita); a meta exige o SIGTAP e não repete; insumo e fornecedor (retirado e devolvido pela
// mesma linha); a AIH recusada com o projeto planejado; em andamento, a AIH marcada com a justificativa e a produção
// recalculada em `quantidade_realizada`; a mesma AIH de novo, a AIH fora da vigência, a cancelada e a justificativa
// só de retirada recusadas; a APAC marcada; o acompanhamento por paciente; a retirada exige a justificativa de
// alteração com o complemento e fica no histórico (a meta volta a zero) e a AIH pode ser marcada de novo; cancelar
// exige o motivo; encerrado não muda metas; outro estabelecimento recebe 404 sem escrita.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { inserirMinimo } from '../suprimentos/massa-propria.spec-util.js';
import { PortaMutiraoCirurgicoPropria } from './mutirao-cirurgico-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const P = 'c2041mt';
const P2 = `${P}b`;
const COD = (s: string) => `${P}${s}`.toUpperCase();

async function limpar(e: Escritor): Promise<void> {
  const ests = 'SELECT id FROM estabelecimento WHERE codigo IN (?, ?)';
  const projs = `SELECT id FROM projeto_mutirao_cirurgico WHERE estabelecimento_id IN (${ests})`;
  const aihs = `SELECT id FROM conta_aih WHERE estabelecimento_id IN (${ests})`;
  const apacs = `SELECT id FROM apac WHERE estabelecimento_id IN (${ests})`;
  await e.executar(`DELETE FROM vinculo_mutirao_cirurgico WHERE projeto_mutirao_cirurgico_id IN (${projs})`, [
    P,
    P2,
  ]);
  for (const t of [
    'projeto_mutirao_cirurgico_procedimento',
    'projeto_mutirao_cirurgico_insumo',
    'projeto_mutirao_cirurgico_fornecedor',
  ])
    await e.executar(`DELETE FROM ${t} WHERE projeto_mutirao_cirurgico_id IN (${projs})`, [P, P2]);
  await e.executar(`DELETE FROM projeto_mutirao_cirurgico WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM conta_aih_procedimento WHERE conta_aih_id IN (${aihs})`, [P, P2]);
  await e.executar(`DELETE FROM conta_aih WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM apac_procedimento WHERE apac_id IN (${apacs})`, [P, P2]);
  await e.executar(`DELETE FROM apac WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar('DELETE FROM justificativa_mutirao_cirurgico WHERE codigo LIKE ?', [`${COD('')}%`]);
  await e.executar('DELETE FROM procedimento_cirurgico WHERE codigo LIKE ?', [`${COD('')}%`]);
  const pf = 'SELECT id FROM pessoa_fisica WHERE nome LIKE ?';
  await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN (${pf})`, [`% ${COD('')}`]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`% ${COD('')}`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaMutiraoCirurgicoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaMutiraoCirurgicoPropria;
  let m: {
    usuario: number;
    procComSigtap: number;
    procSemSigtap: number;
    procApac: number;
    fornecedor: number;
    item: number;
    aih: number;
    aihFora: number;
    aihCancelada: number;
    apac: number;
  };
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const recusa = (status: number) => ({ problema: { status } });
  const metas = (projeto: number) =>
    ler(
      `SELECT procedimento_cirurgico_id AS proc, quantidade_prevista AS prevista, quantidade_realizada AS realizada
         FROM projeto_mutirao_cirurgico_procedimento WHERE projeto_mutirao_cirurgico_id = ? AND excluido_em IS NULL
        ORDER BY sequencia`,
      [projeto],
    );
  let projeto = 0;
  let inc = 0;
  let alt = 0;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const sigtapA = await um('SELECT MIN(id) AS id FROM procedimento_sigtap');
      const sigtapB = await um('SELECT MAX(id) AS id FROM procedimento_sigtap');
      const dominio = await um('SELECT MIN(id) AS id FROM dominio_sus');
      const fornecedor = await um('SELECT MIN(id) AS id FROM empresa_fornecedora WHERE excluido_em IS NULL');
      const item = await um('SELECT MIN(id) AS id FROM item_faturavel WHERE excluido_em IS NULL');
      if (!usuario || !sigtapA || !sigtapB || sigtapA === sigtapB || !dominio || !fornecedor || !item)
        throw new Error(
          'O cliente de teste precisa de usuário, SIGTAP, domínio SUS, fornecedor e item faturável.',
        );
      const novoEst = (codigo: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      const min = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, P);
      const pfPac = await min('pessoa_fisica', { nome: `PACIENTE SINTETICO ${COD('')}` });
      const paciente = await min('paciente', { pessoa_fisica_id: pfPac, situacao: 'ativo' });
      const proc = (s: string, sigtap: number | null) =>
        min('procedimento_cirurgico', {
          codigo: COD(s),
          descricao: `PROCEDIMENTO FICTICIO ${s}`,
          procedimento_sigtap_id: sigtap,
        });
      const procComSigtap = await proc('A', sigtapA);
      const procSemSigtap = await proc('S', null);
      const procApac = await proc('B', sigtapB);
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const aih = async (n: string, data: string, situacao: string) => {
          const id = await min('conta_aih', {
            estabelecimento_id: est,
            internacao_id: 990000001,
            paciente_id: paciente,
            competencia_sus_id: 990000001,
            numero_aih: `20419${n.padStart(8, '0')}`,
            data_internacao: data,
            carater_dominio_sus_id: dominio,
            solicitado_procedimento_sigtap_id: sigtapA,
            codigo_cid10_principal: 'H25',
            situacao,
            ...(situacao === 'cancelada' ? { motivo_situacao: 'Cancelada na massa sintética' } : {}),
          });
          await min('conta_aih_procedimento', {
            conta_aih_id: id,
            sequencia: 1,
            procedimento_sigtap_id: sigtapA,
            tipo: 'principal',
            quantidade: 2,
          });
          return id;
        };
        const apac = await min('apac', {
          estabelecimento_id: est,
          autorizacao_apac_id: 990000001,
          competencia_sus_id: 990000001,
          numero_apac: '2041900000009',
          tipo_apac: 'unica',
          data_inicio: '2030-03-05',
          data_fim: '2030-03-31',
          principal_procedimento_sigtap_id: sigtapB,
          codigo_cid10_principal: 'H25',
          situacao: 'fechada',
        });
        await min('apac_procedimento', {
          apac_id: apac,
          sequencia: 1,
          procedimento_sigtap_id: sigtapB,
          tipo: 'principal',
          quantidade: 1,
        });
        return {
          usuario,
          procComSigtap,
          procSemSigtap,
          procApac,
          fornecedor,
          item,
          aih: await aih('1', '2030-03-02', 'fechada'),
          aihFora: await aih('2', '2031-01-10', 'fechada'),
          aihCancelada: await aih('3', '2030-03-03', 'cancelada'),
          apac,
        };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    porta = new PortaMutiraoCirurgicoPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  });

  it('justificativas e projeto: grava o cadastro e recusa o código repetido e a vigência invertida', async () => {
    inc = (
      await porta.incluirJustificativa(ctx(), {
        codigo: COD('INC'),
        descricao: 'Paciente da fila regulada',
        aplicaAlteracao: false,
      })
    ).id as number;
    alt = (
      await porta.incluirJustificativa(ctx(), {
        codigo: COD('ALT'),
        descricao: 'Desistência ou contraindicação',
        aplicaInclusao: false,
        exigeComplemento: true,
      })
    ).id as number;
    await expect(
      porta.incluirJustificativa(ctx(), { codigo: COD('INC'), descricao: 'Repetida' }),
    ).rejects.toMatchObject(recusa(422));
    const [j] = await ler(
      'SELECT ativo, aplica_inclusao, aplica_alteracao, exige_complemento FROM justificativa_mutirao_cirurgico WHERE id = ?',
      [alt],
    );
    expect(j).toMatchObject({ ativo: 1, aplica_inclusao: 0, aplica_alteracao: 1, exige_complemento: 1 });

    const base = {
      codigo: COD('P1'),
      descricao: 'Mutirão fictício de catarata',
      portaria: 'Portaria fictícia 1/2030',
      periodoInicio: '2030-03-01',
      periodoFim: '2030-03-31',
      valorFinanciamento: 50000,
    };
    await expect(porta.incluirProjeto(ctx(), { ...base, periodoFim: '2030-02-01' })).rejects.toMatchObject(
      recusa(422),
    );
    expect(await ler('SELECT id FROM projeto_mutirao_cirurgico WHERE codigo = ?', [COD('P1')])).toHaveLength(
      0,
    );
    projeto = (await porta.incluirProjeto(ctx(), base)).id as number;
    const [p] = await ler(
      `SELECT situacao, fonte_financiamento, periodo_fim IS NOT NULL AS fim, valor_financiamento, criado_por
         FROM projeto_mutirao_cirurgico WHERE id = ?`,
      [projeto],
    );
    expect(p).toMatchObject({
      situacao: 'planejado',
      fonte_financiamento: 'Portaria fictícia 1/2030',
      fim: 1,
    });
    expect(Number(p?.['criado_por'])).toBe(m.usuario);
  });

  it('metas exigem o SIGTAP e não repetem; insumo e fornecedor (retirado e devolvido pela mesma linha)', async () => {
    await expect(
      porta.incluirMeta(ctx(), projeto, { procedimento: m.procSemSigtap, quantidadePrevista: 10 }),
    ).rejects.toMatchObject(recusa(422));
    await porta.incluirMeta(ctx(), projeto, {
      procedimento: m.procComSigtap,
      quantidadePrevista: 10,
      valorUnitario: 700,
    });
    await porta.incluirMeta(ctx(), projeto, { procedimento: m.procApac, quantidadePrevista: 4 });
    await expect(
      porta.incluirMeta(ctx(), projeto, { procedimento: m.procComSigtap, quantidadePrevista: 3 }),
    ).rejects.toMatchObject(recusa(422));
    expect(await metas(projeto)).toEqual([
      { proc: m.procComSigtap, prevista: 10, realizada: 0 },
      { proc: m.procApac, prevista: 4, realizada: 0 },
    ]);
    await porta.incluirInsumo(ctx(), projeto, { itemFaturavel: m.item, quantidadePrevista: 20 });
    await expect(porta.incluirInsumo(ctx(), projeto, { quantidadePrevista: 1 })).rejects.toMatchObject(
      recusa(422),
    );
    const f = (await porta.incluirFornecedor(ctx(), projeto, { fornecedor: m.fornecedor })).id as number;
    await expect(porta.incluirFornecedor(ctx(), projeto, { fornecedor: m.fornecedor })).rejects.toMatchObject(
      recusa(422),
    );
    await porta.retirarFornecedor(ctx(), projeto, f, { versao: 1 });
    const devolvido = (await porta.incluirFornecedor(ctx(), projeto, { fornecedor: m.fornecedor }))
      .id as number;
    expect(devolvido).toBe(f);
    const fs = await ler(
      'SELECT id, excluido_em IS NULL AS vigente, versao FROM projeto_mutirao_cirurgico_fornecedor WHERE projeto_mutirao_cirurgico_id = ?',
      [projeto],
    );
    expect(fs).toEqual([{ id: f, vigente: 1, versao: 3 }]);
  });

  it('marca a AIH e a APAC com o projeto em andamento e recalcula a produção da meta', async () => {
    await expect(
      porta.vincular(ctx(), projeto, 'aih', { documento: m.aih, justificativa: inc }),
    ).rejects.toMatchObject(recusa(422));
    await porta.mudarSituacao(ctx(), projeto, { versao: 1, situacao: 'em_andamento' });
    const v = await porta.vincular(ctx(), projeto, 'aih', { documento: m.aih, justificativa: inc });
    expect(v).toMatchObject({ realizada: 2 });
    for (const recusado of [
      { documento: m.aih, justificativa: inc },
      { documento: m.aihFora, justificativa: inc },
      { documento: m.aihCancelada, justificativa: inc },
      { documento: m.aih, justificativa: alt, complemento: 'Inclusão com a justificativa errada' },
    ])
      await expect(porta.vincular(ctx(), projeto, 'aih', recusado)).rejects.toMatchObject(recusa(422));
    await porta.vincular(ctx(), projeto, 'apac', { documento: m.apac, justificativa: inc });
    expect((await metas(projeto)).map((x) => x['realizada'])).toEqual([2, 1]);
    const vs = await ler(
      `SELECT tipo_documento, conta_aih_id, apac_id, situacao, criado_por, documento_vigente IS NOT NULL AS unico
         FROM vinculo_mutirao_cirurgico WHERE projeto_mutirao_cirurgico_id = ? ORDER BY id`,
      [projeto],
    );
    expect(vs).toHaveLength(2);
    expect(vs[0]).toMatchObject({
      tipo_documento: 'aih',
      conta_aih_id: m.aih,
      apac_id: null,
      situacao: 'vigente',
      unico: 1,
    });
    expect(vs[1]).toMatchObject({ tipo_documento: 'apac', apac_id: m.apac, situacao: 'vigente' });

    const busca = await porta.buscarDocumento(ctx(), projeto, { tipo: 'aih', numero: '2041900000001' });
    expect(busca.documentos[0]?.problemas.map((x) => x.mensagem).join(' ')).toMatch(
      /já está marcada neste projeto/,
    );
    const d = await porta.detalhe(ctx(), projeto);
    expect(d.acompanhamento).toMatchObject({ prevista: 14, realizada: 3 });
    expect(d.metas.map((x) => [x.realizada, x.saldo])).toEqual([
      [2, 8],
      [1, 3],
    ]);
    expect(d.vinculos.filter((x) => x.tipo === 'aih')[0]?.paciente).toMatch(/SINTETICO/);
    expect(d.fornecedores).toHaveLength(1);
    expect(d.insumos).toHaveLength(1);
  });

  it('a retirada exige a justificativa de alteração com o complemento, fica no histórico e libera a AIH', async () => {
    const [v] = await ler(
      "SELECT id, versao FROM vinculo_mutirao_cirurgico WHERE conta_aih_id = ? AND situacao = 'vigente'",
      [m.aih],
    );
    const vinculo = Number(v?.['id']);
    await expect(
      porta.retirarVinculo(ctx(), projeto, vinculo, { versao: 1, justificativa: inc }),
    ).rejects.toMatchObject(recusa(422));
    await expect(
      porta.retirarVinculo(ctx(), projeto, vinculo, { versao: 1, justificativa: alt }),
    ).rejects.toMatchObject(recusa(422));
    await porta.retirarVinculo(ctx(), projeto, vinculo, {
      versao: 1,
      justificativa: alt,
      complemento: 'Paciente desistiu do procedimento',
    });
    const [r] = await ler(
      `SELECT situacao, retirado_em IS NOT NULL AS retirado, retirado_por, retirada_justificativa_id AS j,
              documento_vigente FROM vinculo_mutirao_cirurgico WHERE id = ?`,
      [vinculo],
    );
    expect(r).toMatchObject({ situacao: 'retirado', retirado: 1, j: alt, documento_vigente: null });
    expect(Number(r?.['retirado_por'])).toBe(m.usuario);
    expect((await metas(projeto)).map((x) => x['realizada'])).toEqual([0, 1]);
    await porta.vincular(ctx(), projeto, 'aih', { documento: m.aih, justificativa: inc });
    expect(
      await ler('SELECT situacao FROM vinculo_mutirao_cirurgico WHERE conta_aih_id = ? ORDER BY id', [m.aih]),
    ).toEqual([{ situacao: 'retirado' }, { situacao: 'vigente' }]);
    expect((await metas(projeto)).map((x) => x['realizada'])).toEqual([2, 1]);
  });

  it('cancelar exige o motivo; encerrado não muda metas; outro estabelecimento recebe 404 sem escrita', async () => {
    const versao = async () =>
      Number(
        (await ler('SELECT versao FROM projeto_mutirao_cirurgico WHERE id = ?', [projeto]))[0]?.['versao'],
      );
    await expect(
      porta.mudarSituacao(ctx(), projeto, { versao: await versao(), situacao: 'cancelado' }),
    ).rejects.toMatchObject(recusa(422));
    await porta.mudarSituacao(ctx(), projeto, { versao: await versao(), situacao: 'encerrado' });
    await expect(
      porta.incluirMeta(ctx(), projeto, { procedimento: m.procSemSigtap, quantidadePrevista: 1 }),
    ).rejects.toMatchObject(recusa(422));
    await expect(porta.detalhe(ctx(P2), projeto)).rejects.toMatchObject(recusa(404));
    await expect(
      porta.mudarSituacao(ctx(P2), projeto, {
        versao: await versao(),
        situacao: 'cancelado',
        motivo: 'Outro hospital',
      }),
    ).rejects.toMatchObject(recusa(404));
    const [p] = await ler(
      'SELECT situacao, periodo_fim, motivo_cancelamento FROM projeto_mutirao_cirurgico WHERE id = ?',
      [projeto],
    );
    expect(p).toMatchObject({ situacao: 'encerrado', motivo_cancelamento: null });
    const painel = await porta.painel(ctx());
    expect(painel.projetos.find((x) => x.id === projeto)).toMatchObject({
      situacao: 'encerrado',
      realizada: 3,
    });
  });
});
