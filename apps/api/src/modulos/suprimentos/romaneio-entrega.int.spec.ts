// Integração do romaneio de entrega entre unidades (09-AREA linha 77, C1-120) contra o MariaDB real (cliente f22_o5).
// Contrato de efeito:
//   - o motorista gravado com a pessoa física achada ou criada pelo CPF (categorias, vencimento, controlado) e o
//     duplicado recusado; o veículo com a placa normalizada e a placa repetida recusada;
//   - o envio entre unidades pela porta (unidade A para um local da unidade B): documento de transferência em aberto com
//     os itens, sem mexer no saldo; o destino da mesma unidade e o saldo livre insuficiente recusados;
//   - o romaneio montado (número da sequência da unidade, aberto, transporte e frete) com um item por envio e o destino
//     (unidade B e local) tirado do local de destino; o envio já em romaneio recusado e o cancelamento dele recusado;
//   - a expedição recusada com a carga controlada só com a transportadora (sem motorista) e com o motorista sem
//     habilitação para ela, e gravada (em trânsito, liberador, liberado_em, saida_em, quilometragem) com o habilitado;
//   - a conferência pela unidade B (a A não acha o romaneio para conferir): o entregue (recebedor da B) dá o recebimento
//     (sai da A, entra na B, envio concluído) e deixa o romaneio em trânsito; o recusado com o motivo fecha entregue em
//     parte e deixa o envio em aberto na A, livre para outro romaneio e cancelável; o envio recebido não monta de novo;
//   - o cancelamento só antes da saída (o expedido recusa; o aberto cancela com o motivo e libera o envio);
//   - a trilha de cada operação e o reenvio pela mesma chave sem linha nova. Nada é apagado.
// Massa SINTÉTICA, limpa no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { inserirMinimo } from './massa-propria.spec-util.js';
import { OPERACOES_ROMANEIO_ENTREGA, PortaRomaneioEntregaPropria } from './romaneio-entrega.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_DB = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const MARCA = 'C1120';
const CODIGOS = ['c1120a', 'c1120b'];
// CPFs sintéticos válidos (dígitos verificadores calculados), só desta massa.
const CPF_1 = '52998224725';
const CPF_2 = '11144477735';
const CNPJ = '00112001000165';

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'sem-erro';
  } catch (e) {
    const problema = (e as { problema?: { codigo?: string } }).problema;
    return String(problema?.codigo ?? (e as { code?: string }).code ?? e);
  }
}

describe.skipIf(SEM_DB)('Romaneio de entrega entre unidades contra o MariaDB (cliente f22_o5)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRomaneioEntregaPropria;
  let estA = 0;
  let estB = 0;
  let usuario = 0;
  let usuarioB = 0;
  let comum = 0;
  let controlado = 0;
  let ctxB: ContextoPortaM18;
  let localA = 0;
  let localB = 0;
  let transportadora = 0;
  let docs: number[] = [];
  let ctx: ContextoPortaM18;
  const sufixo = String(Date.now()).slice(-8);
  let seq = 0;
  const chave = (r: string) => `c1120-${r}-${sufixo}-${++seq}`;
  const ler = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c1120-conta' }, (l) => l.consultar<T>(sql, p));

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1120-limpa' }, async (e) => {
      const ests = `SELECT id FROM estabelecimento WHERE codigo IN ('c1120a', 'c1120b')`;
      await e.executar(
        `DELETE FROM romaneio_entrega_item WHERE romaneio_entrega_id IN (SELECT id FROM romaneio_entrega WHERE estabelecimento_id IN (${ests}))`,
        [],
      );
      await e.executar(`DELETE FROM romaneio_entrega WHERE estabelecimento_id IN (${ests})`, []);
      await e.executar(`DELETE FROM motorista WHERE estabelecimento_id IN (${ests})`, []);
      await e.executar(`DELETE FROM veiculo_entrega WHERE codigo LIKE '${MARCA}%'`, []);
      await e.executar('DELETE FROM pessoa_fisica WHERE cpf IN (?, ?) AND nome LIKE ?', [
        CPF_1,
        CPF_2,
        `${MARCA}%`,
      ]);
      await e.executar(
        `DELETE FROM movimento_lote WHERE movimento_estoque_id IN (SELECT id FROM movimento_estoque WHERE estabelecimento_id IN (${ests}))`,
        [],
      );
      await e.executar(
        `UPDATE documento_estoque_item SET movimento_estoque_id = NULL WHERE documento_estoque_id IN (SELECT id FROM documento_estoque WHERE estabelecimento_id IN (${ests}))`,
        [],
      );
      // C2-093: o movimento publica o fato contábil (estornos antes).
      await e.executar(
        `DELETE FROM fato_contabil WHERE estabelecimento_id IN (${ests}) AND estornado_fato_contabil_id IS NOT NULL`,
        [],
      );
      await e.executar(`DELETE FROM fato_contabil WHERE estabelecimento_id IN (${ests})`, []);
      await e.executar(`DELETE FROM movimento_estoque WHERE estabelecimento_id IN (${ests})`, []);
      await e.executar(`DELETE FROM saldo_estoque WHERE estabelecimento_id IN (${ests})`, []);
      await e.executar(
        `DELETE FROM sequencia_negocio WHERE tipo = 'documento_estoque' AND estabelecimento_id IN (${ests})`,
        [],
      );
      await e.executar(
        `DELETE FROM documento_estoque_item WHERE documento_estoque_id IN (SELECT id FROM documento_estoque WHERE estabelecimento_id IN (${ests}))`,
        [],
      );
      await e.executar(`DELETE FROM documento_estoque WHERE estabelecimento_id IN (${ests})`, []);
      await e.executar(`DELETE FROM saldo_lote WHERE estabelecimento_id IN (${ests})`, []);
      await e.executar(`DELETE FROM lote_insumo WHERE estabelecimento_id IN (${ests})`, []);
      await e.executar(`DELETE FROM insumo WHERE codigo LIKE '${MARCA}%'`, []);
      await e.executar(`DELETE FROM condicao_armazenamento WHERE codigo LIKE '${MARCA}%'`, []);
      await e.executar(`DELETE FROM local_estoque WHERE estabelecimento_id IN (${ests})`, []);
      await e.executar(
        `DELETE FROM sequencia_negocio WHERE tipo = 'romaneio_entrega' AND estabelecimento_id IN (${ests})`,
        [],
      );
      await e.executar('DELETE FROM empresa_fornecedora WHERE cnpj = ?', [CNPJ]);
      await e.executar('DELETE FROM pessoa_juridica WHERE cnpj = ?', [CNPJ]);
      await limparTrilhaDaMassa(e, { codigos: CODIGOS });
    });
  }

  async function garantir(e: Escritor, sel: string, p: unknown[], criar: () => Promise<number>) {
    const l = await e.uma<{ id: unknown }>(sel, p);
    return l ? Number(l.id) : criar();
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    porta = new PortaRomaneioEntregaPropria(nucleo);
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1120-massa' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(e, 'SELECT id FROM estabelecimento WHERE codigo = ?', [codigo], () =>
          e.inserir(
            'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
            [codigo, `Unidade fictícia ${codigo}`, `Unidade fictícia ${codigo} (teste)`, agora],
          ),
        );
      estA = await est(CODIGOS[0]!);
      estB = await est(CODIGOS[1]!);
      usuario = await garantir(e, 'SELECT id FROM usuario WHERE login = ?', ['c1120.teste'], () =>
        e.inserir("INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)", [
          'c1120.teste',
          'Usuário fictício do romaneio',
          agora,
        ]),
      );
      usuarioB = await garantir(e, 'SELECT id FROM usuario WHERE login = ?', ['c1120.recebe'], () =>
        e.inserir("INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)", [
          'c1120.recebe',
          'Usuário fictício da unidade que recebe',
          agora,
        ]),
      );
      localA = await inserirMinimo(
        e,
        'local_estoque',
        {
          estabelecimento_id: estA,
          codigo: `${MARCA}A`,
          nome: 'Almoxarifado fictício A',
          tipo: 'almoxarifado',
        },
        MARCA,
      );
      localB = await inserirMinimo(
        e,
        'local_estoque',
        {
          estabelecimento_id: estB,
          codigo: `${MARCA}B`,
          nome: 'Farmácia fictícia B',
          tipo: 'farmacia_satelite',
        },
        MARCA,
      );
      const unidade = await garantir(
        e,
        'SELECT id FROM unidade_medida WHERE uso_estoque ORDER BY id LIMIT 1',
        [],
        () =>
          inserirMinimo(e, 'unidade_medida', { codigo: `${MARCA}UN`, sigla: 'UN', uso_estoque: true }, MARCA),
      );
      const grupo = await garantir(e, 'SELECT id FROM grupo_insumo ORDER BY id LIMIT 1', [], () =>
        inserirMinimo(e, 'grupo_insumo', { codigo: `${MARCA}G`, natureza: 'material' }, MARCA),
      );
      const insumo = (codigo: string, controlado: boolean) =>
        inserirMinimo(
          e,
          'insumo',
          {
            codigo,
            nome: `Item fictício ${codigo}`,
            tipo: controlado ? 'medicamento' : 'material',
            grupo_insumo_id: grupo,
            estoque_unidade_medida_id: unidade,
            controlado,
          },
          MARCA,
        );
      comum = await insumo(`${MARCA}I1`, false);
      controlado = await insumo(`${MARCA}I2`, true);
      // O saldo de partida na unidade A (estoque existente): o envio e o recebimento correm pela porta.
      for (const i of [comum, controlado])
        await inserirMinimo(
          e,
          'saldo_estoque',
          {
            estabelecimento_id: estA,
            local_estoque_id: localA,
            insumo_id: i,
            quantidade: 50,
            custo_medio: 2,
          },
          MARCA,
        );
      const pj = await e.inserir(
        'INSERT INTO pessoa_juridica (razao_social, cnpj, criado_em) VALUES (?, ?, ?)',
        ['TRANSPORTES FICTÍCIOS C1120 LTDA', CNPJ, agora],
      );
      transportadora = await e.inserir(
        "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, pessoa_juridica_id, criado_em) VALUES ('juridica', ?, ?, ?, ?)",
        [CNPJ, 'TRANSPORTES FICTÍCIOS C1120 LTDA', pj, agora],
      );
    });
    ctx = { cliente: CLIENTE, estabelecimento: estA, usuario, correlacao: `c1120-${sufixo}` };
    ctxB = { cliente: CLIENTE, estabelecimento: estB, usuario: usuarioB, correlacao: `c1120b-${sufixo}` };
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  const MOTORISTA = {
    nome: `${MARCA} Motorista Fictício`,
    cpf: CPF_1,
    tipoVinculo: 'proprio' as const,
    transportadora: null,
    numeroHabilitacao: '12345678901',
    categorias: ['b' as const],
    vencimentoHabilitacao: '2030-12-31',
    transportaControlado: false,
    ativo: true,
    motivoInativacao: null,
  };
  let motorista = 0;
  let motoristaTerceiro = 0;
  let veiculo = 0;
  let romaneio = 0;

  it('cadastra o motorista (pessoa pelo CPF) e o veículo; recusa duplicados', async () => {
    const k = chave('mot');
    motorista = (await porta.gravarMotorista(ctx, MOTORISTA, null, k)).id;
    expect((await porta.gravarMotorista(ctx, MOTORISTA, null, k)).id).toBe(motorista);
    const [m] = await ler<Record<string, unknown>>(
      `SELECT m.situacao, m.categoria_b, m.categoria_c, DATE_FORMAT(m.vencimento_habilitacao, '%Y-%m-%d') AS venc,
              m.transporta_controlado, m.versao, m.criado_por, pf.cpf
         FROM motorista m JOIN pessoa_fisica pf ON pf.id = m.pessoa_fisica_id WHERE m.id = ?`,
      [motorista],
    );
    expect(m).toMatchObject({ situacao: 'ativo', venc: '2030-12-31', cpf: CPF_1, versao: 1 });
    expect(Number(m!['categoria_b'])).toBe(1);
    expect(Number(m!['transporta_controlado'])).toBe(0);
    expect(Number(m!['criado_por'])).toBe(usuario);
    expect(await codigoDe(porta.gravarMotorista(ctx, MOTORISTA, null, chave('mot-dup')))).toBe(
      'motorista-duplicado',
    );
    motoristaTerceiro = (
      await porta.gravarMotorista(
        ctx,
        { ...MOTORISTA, cpf: CPF_2, tipoVinculo: 'terceiro', transportadora, categorias: ['d'] },
        null,
        chave('mot3'),
      )
    ).id;
    const [t] = await ler<Record<string, unknown>>(
      'SELECT m.tipo_vinculo, ef.id AS ef FROM motorista m JOIN empresa_fornecedora ef ON ef.pessoa_juridica_id = m.empresa_pessoa_juridica_id WHERE m.id = ?',
      [motoristaTerceiro],
    );
    expect(t).toMatchObject({ tipo_vinculo: 'terceiro' });
    expect(Number(t!['ef'])).toBe(transportadora);

    const V = {
      codigo: `${MARCA}V1`,
      descricao: 'Furgão fictício',
      placa: 'cba-1d23',
      proprio: true,
      transportadora: null,
      refrigerado: false,
      capacidadeCargaKg: 1500,
      ativo: true,
      motivoInativacao: null,
    };
    veiculo = (await porta.gravarVeiculo(ctx, V, null, chave('vei'))).id;
    const [v] = await ler<Record<string, unknown>>(
      'SELECT placa, estabelecimento_id FROM veiculo_entrega WHERE id = ?',
      [veiculo],
    );
    expect(v!['placa']).toBe('CBA1D23');
    expect(Number(v!['estabelecimento_id'])).toBe(estA);
    expect(
      await codigoDe(porta.gravarVeiculo(ctx, { ...V, codigo: `${MARCA}V2` }, null, chave('vei-dup'))),
    ).toBe('veiculo-duplicado');
  });

  const saldoDe = async (local: number, insumo: number) =>
    Number(
      (
        await ler<Record<string, unknown>>(
          'SELECT quantidade FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ? AND excluido_em IS NULL',
          [local, insumo],
        )
      )[0]?.['quantidade'] ?? 0,
    );

  it('envia entre unidades pela porta: envio em aberto com os itens, saldo intacto; recusa a mesma unidade e o sem saldo', async () => {
    const envio = (itens: { item: number; quantidade: number }[], destino = localB) =>
      porta.enviar(ctx, { origem: localA, destino, itens, observacao: null }, chave('envio'));
    expect(await codigoDe(envio([{ item: comum, quantidade: 1 }], localA))).toBe('envio-mesma-unidade');
    expect(await codigoDe(envio([{ item: comum, quantidade: 51 }]))).toBe('saldo-insuficiente');
    docs = [
      (await envio([{ item: comum, quantidade: 5 }])).id,
      (
        await envio([
          { item: comum, quantidade: 5 },
          { item: controlado, quantidade: 5 },
        ])
      ).id,
      (await envio([{ item: comum, quantidade: 5 }])).id,
    ];
    const ds = await ler<Record<string, unknown>>(
      `SELECT d.estabelecimento_id, d.situacao, d.consolidado, d.origem_local_estoque_id, d.destino_local_estoque_id,
              (SELECT COUNT(*) FROM documento_estoque_item di WHERE di.documento_estoque_id = d.id) AS itens
         FROM documento_estoque d WHERE d.id IN (?, ?, ?) ORDER BY d.id`,
      docs,
    );
    expect(
      ds.map((d) => [
        Number(d['estabelecimento_id']),
        d['situacao'],
        Number(d['origem_local_estoque_id']),
        Number(d['destino_local_estoque_id']),
        Number(d['itens']),
      ]),
    ).toEqual([
      [estA, 'aberto', localA, localB, 1],
      [estA, 'aberto', localA, localB, 2],
      [estA, 'aberto', localA, localB, 1],
    ]);
    expect(await saldoDe(localA, comum)).toBe(50);
    expect(await saldoDe(localB, comum)).toBe(0);
  });

  it('monta o romaneio com um item por transferência e o destino do local; recusa a transferência já romaneada', async () => {
    const painel = await porta.painel(ctx);
    expect(painel.transferencias.map((t) => t.documento)).toEqual(expect.arrayContaining(docs));
    expect(painel.transferencias.find((t) => t.documento === docs[1])).toMatchObject({ controlado: true });
    const r = await porta.montar(
      ctx,
      {
        documentos: [docs[0]!, docs[1]!],
        descricao: 'Entrega fictícia',
        saidaPrevista: '2026-12-01T08:00',
        observacao: null,
        veiculo,
        motorista,
        transportadora: null,
        valorFrete: 0,
      },
      chave('montar'),
    );
    romaneio = r.id;
    expect(r.numero).toBeGreaterThan(0);
    const [rom] = await ler<Record<string, unknown>>(
      'SELECT estabelecimento_id, numero, situacao, veiculo_entrega_id, motorista_id, valor_frete, versao FROM romaneio_entrega WHERE id = ?',
      [romaneio],
    );
    expect(rom).toMatchObject({ situacao: 'aberto', versao: 1 });
    expect(Number(rom!['numero'])).toBe(r.numero);
    expect(Number(rom!['motorista_id'])).toBe(motorista);
    const itens = await ler<Record<string, unknown>>(
      'SELECT sequencia, documento_estoque_id, destino_estabelecimento_id, destino_local_estoque_id, situacao FROM romaneio_entrega_item WHERE romaneio_entrega_id = ? ORDER BY sequencia',
      [romaneio],
    );
    expect(
      itens.map((i) => [
        Number(i['documento_estoque_id']),
        Number(i['destino_estabelecimento_id']),
        Number(i['destino_local_estoque_id']),
        i['situacao'],
      ]),
    ).toEqual([
      [docs[0], estB, localB, 'pendente'],
      [docs[1], estB, localB, 'pendente'],
    ]);
    const outro = porta.montar(
      ctx,
      {
        documentos: [docs[0]!],
        descricao: null,
        saidaPrevista: null,
        observacao: null,
        veiculo: null,
        motorista: null,
        transportadora,
        valorFrete: 80,
      },
      chave('montar-dup'),
    );
    expect(await codigoDe(outro)).toBe('romaneio-transferencia-em-outro');
    expect(
      await codigoDe(porta.cancelarEnvio(ctx, docs[0]!, 'Pedido fictício errado', chave('canc-env'))),
    ).toBe('envio-em-romaneio');
    expect((await porta.painel(ctx)).transferencias.map((t) => t.documento)).not.toContain(docs[0]);
  });

  it('expede só com motorista habilitado ao controlado: em trânsito com liberador, saída e quilometragem', async () => {
    const d = await porta.detalhe(ctx, romaneio);
    expect(d.levaControlado).toBe(true);
    const exp = {
      versao: d.versao,
      quilometragemSaida: 1000,
      veiculo,
      motorista,
      transportadora: null,
      valorFrete: 0,
    };
    const soTerceiro = { ...exp, veiculo: null, motorista: null, transportadora };
    expect(await codigoDe(porta.expedir(ctx, romaneio, soTerceiro, chave('exp-terc')))).toBe(
      'romaneio-controlado-sem-motorista',
    );
    expect(await codigoDe(porta.expedir(ctx, romaneio, exp, chave('exp-rec')))).toBe('romaneio-controlado');
    const m = (await porta.painel(ctx)).motoristas.find((x) => x.id === motorista)!;
    await porta.gravarMotorista(
      ctx,
      { ...MOTORISTA, transportaControlado: true },
      { id: motorista, versao: m.versao },
      chave('mot-alt'),
    );
    await porta.expedir(ctx, romaneio, exp, chave('exp'));
    const [r] = await ler<Record<string, unknown>>(
      'SELECT situacao, liberador_usuario_id, liberado_em, saida_em, quilometragem_saida, versao FROM romaneio_entrega WHERE id = ?',
      [romaneio],
    );
    expect(r).toMatchObject({ situacao: 'em_transito', versao: 2 });
    expect(Number(r!['liberador_usuario_id'])).toBe(usuario);
    expect(r!['liberado_em']).not.toBeNull();
    expect(r!['saida_em']).not.toBeNull();
    expect(Number(r!['quilometragem_saida'])).toBe(1000);
    expect(await codigoDe(porta.cancelar(ctx, romaneio, 2, 'Desistência fictícia', chave('canc-rec')))).toBe(
      'romaneio-nao-cancelavel',
    );
  });

  it('a unidade B confere: o entregue dá o recebimento; o recusado fecha em parte e deixa o envio em aberto na A', async () => {
    const d = await porta.detalhe(ctxB, romaneio);
    const [i1, i2] = d.lista;
    expect(d.lista.every((i) => i.destinoAqui)).toBe(true);
    expect((await porta.painel(ctxB)).romaneios.find((r) => r.id === romaneio)).toMatchObject({
      daUnidade: false,
      pendentesAqui: 2,
    });
    const naOrigem = porta.conferir(
      ctx,
      romaneio,
      {
        versao: d.versao,
        quilometragemChegada: null,
        desfechos: [{ item: i1!.id, desfecho: 'entregue', motivo: null }],
      },
      chave('conf-origem'),
    );
    expect(await codigoDe(naOrigem)).toBe('nao-encontrado');
    expect(
      await codigoDe(
        porta.conferir(
          ctxB,
          romaneio,
          {
            versao: d.versao,
            quilometragemChegada: 900,
            desfechos: [{ item: i1!.id, desfecho: 'entregue', motivo: null }],
          },
          chave('conf-km'),
        ),
      ),
    ).toBe('conferencia-quilometragem');
    const r1 = await porta.conferir(
      ctxB,
      romaneio,
      {
        versao: d.versao,
        quilometragemChegada: null,
        desfechos: [{ item: i1!.id, desfecho: 'entregue', motivo: null }],
      },
      chave('conf1'),
    );
    expect(r1.situacao).toBe('em_transito');
    // O recebimento do envio 1: sai da A, entra na B, envio concluído pela B.
    expect(await saldoDe(localA, comum)).toBe(45);
    expect(await saldoDe(localB, comum)).toBe(5);
    const [env1] = await ler<Record<string, unknown>>(
      'SELECT situacao, consolidado, concluido_usuario_id FROM documento_estoque WHERE id = ?',
      [docs[0]],
    );
    expect(env1).toMatchObject({ situacao: 'concluido' });
    expect(Number(env1!['concluido_usuario_id'])).toBe(usuarioB);
    expect(
      (
        await ler<Record<string, unknown>>(
          'SELECT estabelecimento_id FROM movimento_estoque WHERE documento_estoque_id = ? ORDER BY id',
          [docs[0]],
        )
      ).map((m) => Number(m['estabelecimento_id'])),
    ).toEqual([estA, estB]);
    const d2 = await porta.detalhe(ctxB, romaneio);
    const r2 = await porta.conferir(
      ctxB,
      romaneio,
      {
        versao: d2.versao,
        quilometragemChegada: 1042,
        desfechos: [{ item: i2!.id, desfecho: 'recusado', motivo: 'Embalagem violada' }],
      },
      chave('conf2'),
    );
    expect(r2.situacao).toBe('entregue_parcial');
    const itens = await ler<Record<string, unknown>>(
      'SELECT situacao, recebedor_usuario_id, entregue_em, observacao FROM romaneio_entrega_item WHERE romaneio_entrega_id = ? ORDER BY sequencia',
      [romaneio],
    );
    expect(itens[0]).toMatchObject({ situacao: 'entregue', observacao: null });
    expect(Number(itens[0]!['recebedor_usuario_id'])).toBe(usuarioB);
    expect(itens[0]!['entregue_em']).not.toBeNull();
    expect(itens[1]).toMatchObject({
      situacao: 'recusado',
      observacao: 'Embalagem violada',
      entregue_em: null,
    });
    const [r] = await ler<Record<string, unknown>>(
      'SELECT situacao, conferente_usuario_id, conferido_em, chegada_em, quilometragem_chegada FROM romaneio_entrega WHERE id = ?',
      [romaneio],
    );
    expect(r).toMatchObject({ situacao: 'entregue_parcial' });
    expect(Number(r!['conferente_usuario_id'])).toBe(usuarioB);
    expect(r!['chegada_em']).not.toBeNull();
    expect(Number(r!['quilometragem_chegada'])).toBe(1042);
    // O recusado: o envio 2 segue em aberto na A (saldo do controlado intacto), volta à lista e pode ser cancelado.
    expect(await saldoDe(localA, controlado)).toBe(50);
    expect((await porta.painel(ctx)).transferencias.map((t) => t.documento)).toContain(docs[1]);
    await porta.cancelarEnvio(ctx, docs[1]!, 'Recusado na chegada', chave('canc-env2'));
    const [env2] = await ler<Record<string, unknown>>('SELECT situacao FROM documento_estoque WHERE id = ?', [
      docs[1],
    ]);
    expect(env2).toMatchObject({ situacao: 'cancelado' });
    // O envio recebido não viaja de novo.
    const deNovo = porta.montar(
      ctx,
      {
        documentos: [docs[0]!],
        descricao: null,
        saidaPrevista: null,
        observacao: null,
        veiculo: null,
        motorista: null,
        transportadora,
        valorFrete: null,
      },
      chave('montar-recebido'),
    );
    expect(await codigoDe(deNovo)).toBe('romaneio-transferencia-recebida');
  });

  it('cancela o romaneio aberto com o motivo e libera a transferência; trilha de cada operação', async () => {
    const r = await porta.montar(
      ctx,
      {
        documentos: [docs[2]!],
        descricao: null,
        saidaPrevista: null,
        observacao: null,
        veiculo: null,
        motorista: null,
        transportadora,
        valorFrete: 150.5,
      },
      chave('montar2'),
    );
    expect(await codigoDe(porta.cancelar(ctx, r.id, 1, 'x', chave('canc-curto')))).toBe('romaneio-motivo');
    await porta.cancelar(ctx, r.id, 1, 'Saída adiada', chave('canc'));
    const [c] = await ler<Record<string, unknown>>(
      'SELECT situacao, observacao, valor_frete FROM romaneio_entrega WHERE id = ?',
      [r.id],
    );
    expect(c).toMatchObject({ situacao: 'cancelado', observacao: 'Cancelado: Saída adiada' });
    expect(Number(c!['valor_frete'])).toBe(150.5);
    expect(
      (await ler('SELECT id FROM romaneio_entrega_item WHERE romaneio_entrega_id = ?', [r.id])).length,
    ).toBe(1);
    expect((await porta.painel(ctx)).transferencias.map((t) => t.documento)).toContain(docs[2]);
    const ops = await ler<Record<string, unknown>>(
      `SELECT JSON_VALUE(dados_depois, '$.operacao') AS operacao, COUNT(*) AS n FROM trilha_auditoria
        WHERE estabelecimento_id IN (?, ?) AND JSON_VALUE(dados_depois, '$.operacao') LIKE 'suprimentos.romaneio.%'
        GROUP BY JSON_VALUE(dados_depois, '$.operacao')`,
      [estA, estB],
    );
    const por = Object.fromEntries(ops.map((o) => [String(o['operacao']), Number(o['n'])]));
    expect(por).toMatchObject({
      [OPERACOES_ROMANEIO_ENTREGA.motorista]: 3,
      [OPERACOES_ROMANEIO_ENTREGA.veiculo]: 1,
      [OPERACOES_ROMANEIO_ENTREGA.montar]: 2,
      [OPERACOES_ROMANEIO_ENTREGA.expedir]: 1,
      [OPERACOES_ROMANEIO_ENTREGA.conferir]: 2,
      [OPERACOES_ROMANEIO_ENTREGA.cancelar]: 1,
      [OPERACOES_ROMANEIO_ENTREGA.enviar]: 3,
      [OPERACOES_ROMANEIO_ENTREGA.cancelarEnvio]: 1,
    });
  });

  // D1 (recusas da carga): o envio entre unidades é movimento entre locais, não uso; o lote migrado sem validade sai
  // por último no FEFO e vai ao item do envio pelo id, com a validade nula (nunca inventada).
  it('envio entre unidades com o lote migrado sem validade: o datado primeiro, o sem validade completa e segue sem validade', async () => {
    let comLote = 0;
    let loteCom = 0;
    let loteSem = 0;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1120-lote-sv' }, async (e) => {
      const [base] = await e.consultar<Record<string, unknown>>(
        'SELECT grupo_insumo_id AS g, estoque_unidade_medida_id AS u FROM insumo WHERE id = ?',
        [comum],
      );
      comLote = await inserirMinimo(
        e,
        'insumo',
        {
          codigo: `${MARCA}I3`,
          nome: `Item fictício ${MARCA}I3`,
          tipo: 'material',
          grupo_insumo_id: base?.['g'],
          estoque_unidade_medida_id: base?.['u'],
          controlado: false,
          controla_lote: true,
          controla_validade: true,
        },
        MARCA,
      );
      await inserirMinimo(
        e,
        'saldo_estoque',
        {
          estabelecimento_id: estA,
          local_estoque_id: localA,
          insumo_id: comLote,
          quantidade: 4,
          custo_medio: 2,
        },
        MARCA,
      );
      const lote = (numero: string, validade: string | null, origem: string) =>
        inserirMinimo(
          e,
          'lote_insumo',
          {
            estabelecimento_id: estA,
            insumo_id: comLote,
            numero_lote: numero,
            validade,
            situacao: 'liberado',
            origem,
          },
          MARCA,
        );
      loteSem = await lote(`${MARCA}SV`, null, 'migracao');
      loteCom = await lote(`${MARCA}CV`, '2027-06-30', 'sistema');
      for (const [id, q] of [
        [loteCom, 1],
        [loteSem, 3],
      ] as const)
        await inserirMinimo(
          e,
          'saldo_lote',
          {
            estabelecimento_id: estA,
            local_estoque_id: localA,
            lote_insumo_id: id,
            quantidade: q,
            competencia: '2026-11-01',
          },
          MARCA,
        );
    });
    const { id } = await porta.enviar(
      ctx,
      { origem: localA, destino: localB, itens: [{ item: comLote, quantidade: 2 }], observacao: null },
      chave('envio-sv'),
    );
    const itens = await ler<Record<string, unknown>>(
      `SELECT lote_insumo_id AS lote, quantidade AS q, data_validade AS v FROM documento_estoque_item
        WHERE documento_estoque_id = ? ORDER BY sequencia`,
      [id],
    );
    expect(itens.map((i) => [Number(i['lote']), Number(i['q']), i['v'] === null])).toEqual([
      [loteCom, 1, false],
      [loteSem, 1, true],
    ]);
    expect(await saldoDe(localA, comLote)).toBe(4);
    // O envio não mexe no saldo dos lotes (só o recebimento move).
    const saldoLote = async (local: number, lote: number) =>
      Number(
        (
          await ler<Record<string, unknown>>(
            'SELECT quantidade FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ? AND excluido_em IS NULL',
            [local, lote],
          )
        )[0]?.['quantidade'] ?? 0,
      );
    expect([await saldoLote(localA, loteCom), await saldoLote(localA, loteSem)]).toEqual([1, 3]);
    // O recebimento na unidade B (romaneio montado, expedido e conferido como entregue): os dois lotes saem da A e
    // entram na B, o sem validade com a validade ainda nula.
    const rom = await porta.montar(
      ctx,
      {
        documentos: [id],
        descricao: null,
        saidaPrevista: null,
        observacao: null,
        veiculo,
        motorista,
        transportadora: null,
        valorFrete: 0,
      },
      chave('montar-sv'),
    );
    const dA = await porta.detalhe(ctx, rom.id);
    await porta.expedir(
      ctx,
      rom.id,
      {
        versao: dA.versao,
        quilometragemSaida: 2000,
        veiculo,
        motorista,
        transportadora: null,
        valorFrete: 0,
      },
      chave('exp-sv'),
    );
    const dB = await porta.detalhe(ctxB, rom.id);
    const conf = await porta.conferir(
      ctxB,
      rom.id,
      {
        versao: dB.versao,
        quilometragemChegada: null,
        desfechos: [{ item: dB.lista[0]!.id, desfecho: 'entregue', motivo: null }],
      },
      chave('conf-sv'),
    );
    expect(conf.situacao).toBe('entregue');
    const [env] = await ler<Record<string, unknown>>('SELECT situacao FROM documento_estoque WHERE id = ?', [
      id,
    ]);
    expect(env).toMatchObject({ situacao: 'concluido' });
    expect([await saldoLote(localA, loteCom), await saldoLote(localA, loteSem)]).toEqual([0, 2]);
    expect([await saldoLote(localB, loteCom), await saldoLote(localB, loteSem)]).toEqual([1, 1]);
    expect([await saldoDe(localA, comLote), await saldoDe(localB, comLote)]).toEqual([2, 2]);
    const [l] = await ler<Record<string, unknown>>('SELECT validade FROM lote_insumo WHERE id = ?', [
      loteSem,
    ]);
    expect(l?.['validade']).toBeNull();
  });
});
