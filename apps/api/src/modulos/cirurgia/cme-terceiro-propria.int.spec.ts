// Contrato de efeito do material de terceiro e consignado processado pela CME (F7, 04-CME linha 119; RDC 15/2012)
// contra o MariaDB real (cliente de teste), com a migração 08_CC/99w aplicada aqui duas vezes (idempotente). Massa
// SINTÉTICA: estabelecimentos com o código do teste, setor da CME, método, paciente, caráter e agendamento cirúrgico
// fictícios; usuário, profissional e fornecedor são ids já existentes do cliente de teste (só os ids são lidos).
// Prova o que fica no banco: o material com dono incoerente é recusado sem escrita; o material do fornecedor fica com o
// roteiro; o recebimento sem entregador é recusado sem escrita; o recebimento fica com número, CME, entregador, quem
// recebeu, paciente da cirurgia e os itens; a conferência com divergência deixa o recebimento divergente e a refeita o
// deixa conferido (quem e quando); o envio cria o pacote ligado ao item, aguardando esterilização, e o recebimento fica
// em reprocessamento; a disponibilidade é recusada com o pacote não esterilizado; o ciclo da CME libera o pacote com a
// validade do cadastro do material; o recebimento fica disponível; a devolução que não soma o recebido é recusada sem
// escrita; a devolução conferida grava utilizado, devolvido, quem retirou e devolvido; versão velha: 409; tudo na trilha;
// a sessão de outro estabelecimento não enxerga o recebimento (404). Nada é apagado.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaCmeTerceiroPropria } from './cme-terceiro-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const P = 'c3017ter';
const P2 = `${P}b`;

function aplicarMigracao(): void {
  for (const arq of ['99w_material_terceiro_pacote_tabelas.sql', '99w_material_terceiro_pacote_chaves.sql'])
    execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), `cliente_${CLIENTE}`, '-N'], {
      input: readFileSync(resolve(RAIZ, 'db/migracoes/08_CC', arq), 'utf8'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(
    `DELETE i FROM recebimento_material_terceiro_item i JOIN recebimento_material_terceiro r
        ON r.id = i.recebimento_material_terceiro_id WHERE r.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM recebimento_material_terceiro WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(
    `DELETE i FROM ciclo_esterilizacao_item i JOIN ciclo_esterilizacao c ON c.id = i.ciclo_esterilizacao_id
      WHERE c.estabelecimento_id = ${est}`,
    [P],
  );
  await e.executar(`DELETE FROM pacote_esteril WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM ciclo_esterilizacao WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM equipamento_esterilizacao WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM material_terceiro_reprocessamento WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM agendamento_cirurgico WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM setor_funcional WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar(`DELETE FROM sequencia_negocio WHERE estabelecimento_id = ${est}`, [P]);
  await e.executar('DELETE FROM metodo_esterilizacao WHERE codigo = ?', [`${P}-VAP`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

interface Massa {
  usuario: number;
  fornecedor: number;
  outroFornecedor: number;
  cme: number;
  metodo: number;
  agendamento: number;
  paciente: number;
}

describe.skipIf(SEM_BANCO)('PortaCmeTerceiroPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCmeTerceiroPropria;
  let m: Massa;
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const um = async (sql: string, p: unknown[] = []) => (await ler(sql, p))[0] ?? {};
  const erro = async (pr: Promise<unknown>) => {
    try {
      await pr;
    } catch (e) {
      const x = e as { problema?: { status?: number } };
      return x.problema?.status;
    }
    throw new Error('Esperava recusa.');
  };
  const contar = async (tabela: string) =>
    Number(
      (
        await um(
          `SELECT COUNT(*) AS n FROM ${tabela} WHERE estabelecimento_id = (SELECT id FROM estabelecimento WHERE codigo = ?)`,
          [P],
        )
      )['n'],
    );
  const rec = async (id: number) =>
    um(
      `SELECT situacao, versao, numero, entregador_nome, recebido_por_usuario_id, paciente_id, conferido_em,
              conferido_por_usuario_id, devolvido_em, devolvido_por_usuario_id, devolucao_recebedor_nome
         FROM recebimento_material_terceiro WHERE id = ?`,
      [id],
    );

  beforeAll(async () => {
    aplicarMigracao();
    aplicarMigracao();
    nucleo = new NucleoProprio();
    porta = new PortaCmeTerceiroPropria(nucleo, CLIENTE);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const cirurgiao = await e.uma('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      const forn = await e.consultar(
        'SELECT id FROM empresa_fornecedora WHERE excluido_em IS NULL ORDER BY id LIMIT 2',
      );
      if (!usuario?.['id'] || !cirurgiao?.['id'] || forn.length < 2)
        throw new Error('O cliente de teste precisa de usuário, profissional e dois fornecedores.');
      const g = async (sql: string, args: unknown[], ins: string, iargs: unknown[]) =>
        Number((await e.uma(sql, args))?.['id'] ?? (await e.inserir(ins, iargs)));
      const pf = await g(
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      const paciente = await g(
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 933017, 'ativo', ?)",
        [pf, agora],
      );
      const carater = await g(
        'SELECT id FROM carater_cirurgia WHERE codigo = ?',
        [`${P}-ELE`],
        'INSERT INTO carater_cirurgia (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-ELE`, `CARATER SINTETICO ${P}`, agora],
      );
      const novoEst = (c: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [c, `Hospital sintético ${c}`, `Hospital sintético ${c} (fictício)`, agora],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      const cme = await e.inserir(
        'INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ?, ?)',
        [est, `${P}-CME`, 'CME SINTETICA', 'apoio_tecnico', agora],
      );
      const metodo = await e.inserir(
        "INSERT INTO metodo_esterilizacao (codigo, descricao, categoria, criado_em) VALUES (?, ?, 'esterilizacao', ?)",
        [`${P}-VAP`, `VAPOR SINTETICO ${P}`, agora],
      );
      const agendamento = await e.inserir(
        `INSERT INTO agendamento_cirurgico (estabelecimento_id, numero, paciente_id, cirurgiao_profissional_id,
                                            carater_cirurgia_id, tipo_cobertura, solicitado_em, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, 'particular', ?, 'solicitado', ?)`,
        [est, `${P}-1`, paciente, cirurgiao['id'], carater, agora, agora],
      );
      return {
        usuario: Number(usuario['id']),
        fornecedor: Number(forn[0]!['id']),
        outroFornecedor: Number(forn[1]!['id']),
        cme: Number(cme),
        metodo: Number(metodo),
        agendamento: Number(agendamento),
        paciente,
      };
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  });

  let material = 0;
  let recebimento = 0;
  let pacote = 0;

  it('cadastra o material do fornecedor com o roteiro e recusa o dono incoerente sem escrita', async () => {
    const base = {
      descricao: 'CAIXA DE COLUNA CONSIGNADA SINTETICA',
      tipoProprietario: 'fornecedor',
      fornecedor: m.fornecedor,
      codigoBarras: `${P}-CB1`,
      quantidadePecas: 40,
      validadeDias: 30,
    };
    expect(await erro(porta.cadastrarMaterial(ctx(), { ...base, fornecedor: null }))).toBe(422);
    expect(await erro(porta.cadastrarMaterial(ctx(), { ...base, lavagem: false }))).toBe(422);
    expect(await contar('material_terceiro_reprocessamento')).toBe(0);
    material = (await porta.cadastrarMaterial(ctx(), base)).material;
    const g = await um(
      `SELECT tipo_proprietario, empresa_fornecedora_id, validade_esterilizacao_dias, exige_lavagem, exige_esterilizacao
         FROM material_terceiro_reprocessamento WHERE id = ?`,
      [material],
    );
    expect([
      g['tipo_proprietario'],
      Number(g['empresa_fornecedora_id']),
      Number(g['validade_esterilizacao_dias']),
      Number(g['exige_lavagem']),
      Number(g['exige_esterilizacao']),
    ]).toEqual(['fornecedor', m.fornecedor, 30, 1, 1]);
    expect(await erro(porta.cadastrarMaterial(ctx(), base))).toBe(422);
  });

  it('recebe na CME com entregador, número e o paciente da cirurgia; recusa sem entregador ou de outro fornecedor', async () => {
    const corpo = {
      cme: m.cme,
      fornecedor: m.fornecedor,
      agendamento: m.agendamento,
      entregador: 'REPRESENTANTE SINTETICO',
      itens: [{ material, quantidade: 3 }],
    };
    expect(await erro(porta.receber(ctx(), { ...corpo, entregador: null }))).toBe(422);
    expect(await erro(porta.receber(ctx(), { ...corpo, fornecedor: m.outroFornecedor }))).toBe(422);
    expect(await contar('recebimento_material_terceiro')).toBe(0);
    const r = await porta.receber(ctx(), corpo);
    recebimento = r.recebimento;
    const g = await rec(recebimento);
    expect([
      g['situacao'],
      g['entregador_nome'],
      Number(g['recebido_por_usuario_id']),
      Number(g['paciente_id']),
    ]).toEqual(['recebido', 'REPRESENTANTE SINTETICO', m.usuario, m.paciente]);
    expect(Number(g['numero'])).toBe(r.numero);
    const i = await um(
      'SELECT sequencia, quantidade_recebida, conferido_recebimento FROM recebimento_material_terceiro_item WHERE recebimento_material_terceiro_id = ?',
      [recebimento],
    );
    expect([
      Number(i['sequencia']),
      Number(i['quantidade_recebida']),
      Number(i['conferido_recebimento']),
    ]).toEqual([1, 3, 0]);
    expect((await porta.painelTerceiros(ctx(P2))).recebimentos).toEqual([]);
  });

  it('confere peça a peça: divergente, depois conferido com quem e quando; versão velha 409', async () => {
    const v1 = Number((await rec(recebimento))['versao']);
    const d = await porta.conferir(ctx(), recebimento, {
      versao: v1,
      itens: [{ sequencia: 1, conferido: false, divergencia: 'Falta 1 parafuso' }],
    });
    expect(d.situacao).toBe('divergente');
    expect(
      await erro(
        porta.conferir(ctx(), recebimento, { versao: v1, itens: [{ sequencia: 1, conferido: true }] }),
      ),
    ).toBe(409);
    const v2 = Number((await rec(recebimento))['versao']);
    expect(
      (await porta.conferir(ctx(), recebimento, { versao: v2, itens: [{ sequencia: 1, conferido: true }] }))
        .situacao,
    ).toBe('conferido');
    const g = await rec(recebimento);
    expect([g['situacao'], Number(g['conferido_por_usuario_id']), g['conferido_em'] !== null]).toEqual([
      'conferido',
      m.usuario,
      true,
    ]);
    const i = await um(
      'SELECT conferido_recebimento, divergencia FROM recebimento_material_terceiro_item WHERE recebimento_material_terceiro_id = ?',
      [recebimento],
    );
    expect([Number(i['conferido_recebimento']), i['divergencia']]).toEqual([1, null]);
  });

  it('envia ao reprocessamento: pacote ligado ao item; disponível só depois do ciclo liberado', async () => {
    const v = Number((await rec(recebimento))['versao']);
    const r = await porta.reprocessar(ctx(), recebimento, { versao: v });
    expect(r.situacao).toBe('em_reprocessamento');
    const i = await um(
      'SELECT pacote_esteril_id FROM recebimento_material_terceiro_item WHERE recebimento_material_terceiro_id = ?',
      [recebimento],
    );
    pacote = Number(i['pacote_esteril_id']);
    const p = await um(
      'SELECT situacao, material_terceiro_reprocessamento_id, codigo_etiqueta FROM pacote_esteril WHERE id = ?',
      [pacote],
    );
    expect([p['situacao'], Number(p['material_terceiro_reprocessamento_id'])]).toEqual([
      'aguardando_esterilizacao',
      material,
    ]);
    expect(r.etiquetas).toEqual([p['codigo_etiqueta']]);
    const v2 = Number((await rec(recebimento))['versao']);
    expect(await erro(porta.disponibilizar(ctx(), recebimento, { versao: v2 }))).toBe(422);
    expect((await rec(recebimento))['situacao']).toBe('em_reprocessamento');

    const equipamento = (
      await porta.criarEquipamento(ctx(), {
        codigo: 'AC1',
        descricao: 'Autoclave sintética',
        natureza: 'autoclave',
        metodo: m.metodo,
      })
    ).equipamento;
    const ciclo = (await porta.abrirCiclo(ctx(), { equipamento, metodo: m.metodo, pacotes: [pacote] })).ciclo;
    const vc = Number((await um('SELECT versao FROM ciclo_esterilizacao WHERE id = ?', [ciclo]))['versao']);
    const c = await porta.concluirCiclo(ctx(), ciclo, {
      versao: vc,
      fisico: 'conforme',
      quimico: 'conforme',
      biologico: 'conforme',
    });
    expect(c.situacao).toBe('liberado');
    const pe = await um(
      'SELECT situacao, DATEDIFF(validade, DATE(esterilizado_em)) AS dias FROM pacote_esteril WHERE id = ?',
      [pacote],
    );
    expect([pe['situacao'], Number(pe['dias'])]).toEqual(['esteril', 30]);
    const d = await porta.disponibilizar(ctx(), recebimento, { versao: v2 });
    expect(d.situacao).toBe('disponivel');
    const painel = await porta.painelTerceiros(ctx());
    expect(painel.recebimentos[0]?.pacotes).toEqual([
      { id: pacote, etiqueta: String(p['codigo_etiqueta']), situacao: 'esteril', material },
    ]);
  });

  it('devolve conferido: recusa a soma errada sem escrita e grava utilizado, devolvido e quem retirou', async () => {
    const v = Number((await rec(recebimento))['versao']);
    const corpo = {
      versao: v,
      recebedor: 'REPRESENTANTE SINTETICO',
      itens: [{ sequencia: 1, utilizada: 1, devolvida: 1, conferido: true }],
    };
    expect(await erro(porta.devolver(ctx(), recebimento, corpo))).toBe(422);
    expect(await erro(porta.devolver(ctx(), recebimento, { ...corpo, recebedor: null }))).toBe(422);
    expect((await rec(recebimento))['situacao']).toBe('disponivel');
    await porta.devolver(ctx(), recebimento, {
      ...corpo,
      itens: [{ sequencia: 1, utilizada: 1, devolvida: 2, conferido: true }],
    });
    const g = await rec(recebimento);
    expect([
      g['situacao'],
      g['devolucao_recebedor_nome'],
      Number(g['devolvido_por_usuario_id']),
      g['devolvido_em'] !== null,
    ]).toEqual(['devolvido', 'REPRESENTANTE SINTETICO', m.usuario, true]);
    const i = await um(
      `SELECT quantidade_utilizada, quantidade_devolvida, conferido_devolucao FROM recebimento_material_terceiro_item
        WHERE recebimento_material_terceiro_id = ?`,
      [recebimento],
    );
    expect([
      Number(i['quantidade_utilizada']),
      Number(i['quantidade_devolvida']),
      Number(i['conferido_devolucao']),
    ]).toEqual([1, 2, 1]);
    const trilha = await um(
      `SELECT COUNT(*) AS n FROM trilha_auditoria t JOIN estabelecimento e ON e.id = t.estabelecimento_id
        WHERE e.codigo = ? AND t.entidade = 'recebimento_material_terceiro' AND t.entidade_id = ?`,
      [P, recebimento],
    );
    expect(Number(trilha['n'])).toBeGreaterThanOrEqual(5);
  });

  it('outro estabelecimento não enxerga nem altera o recebimento (404)', async () => {
    expect(await erro(porta.devolver(ctx(P2), recebimento, { versao: 1, recebedor: 'X', itens: [] }))).toBe(
      404,
    );
  });
});
