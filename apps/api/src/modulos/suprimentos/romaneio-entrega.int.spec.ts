// Integração do romaneio de entrega entre unidades (09-AREA linha 77, C1-120) contra o MariaDB real (cliente f22_o5).
// Contrato de efeito:
//   - o motorista gravado com a pessoa física achada ou criada pelo CPF (categorias, vencimento, controlado) e o
//     duplicado recusado; o veículo com a placa normalizada e a placa repetida recusada;
//   - o romaneio montado (número da sequência da unidade, aberto, transporte e frete) com um item por transferência e o
//     destino (unidade e local) tirado do local de destino da transferência; a transferência já em romaneio recusada;
//   - a expedição recusada com a carga controlada e motorista sem habilitação para ela, e gravada (em trânsito,
//     liberador, liberado_em, saida_em, quilometragem) com o motorista habilitado;
//   - a conferência por item: o primeiro entregue (recebedor e hora) deixa o romaneio em trânsito; o segundo recusado com
//     o motivo fecha entregue em parte com conferente, chegada e quilometragem; a quilometragem abaixo da saída recusada;
//   - o cancelamento só antes da saída (o expedido recusa; o aberto cancela com o motivo e libera a transferência);
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
        `DELETE FROM documento_estoque_item WHERE documento_estoque_id IN (SELECT id FROM documento_estoque WHERE estabelecimento_id IN (${ests}))`,
        [],
      );
      await e.executar(`DELETE FROM documento_estoque WHERE estabelecimento_id IN (${ests})`, []);
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
      const comum = await insumo(`${MARCA}I1`, false);
      const controlado = await insumo(`${MARCA}I2`, true);
      const doc = async (numero: number, itens: number[]) => {
        const id = await inserirMinimo(
          e,
          'documento_estoque',
          {
            estabelecimento_id: estA,
            numero,
            tipo: 'transferencia',
            origem_local_estoque_id: localA,
            destino_local_estoque_id: localB,
            movimentado_em: agora,
            situacao: 'concluido',
          },
          MARCA,
        );
        let s = 0;
        for (const i of itens)
          await inserirMinimo(
            e,
            'documento_estoque_item',
            {
              documento_estoque_id: id,
              sequencia: ++s,
              insumo_id: i,
              unidade_medida_id: unidade,
              quantidade: 5,
            },
            MARCA,
          );
        return id;
      };
      docs = [
        await doc(91120001, [comum]),
        await doc(91120002, [comum, controlado]),
        await doc(91120003, [comum]),
      ];
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

  it('confere por item: entregue segue em trânsito; o recusado com motivo fecha entregue em parte', async () => {
    const d = await porta.detalhe(ctx, romaneio);
    const [i1, i2] = d.lista;
    expect(
      await codigoDe(
        porta.conferir(
          ctx,
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
      ctx,
      romaneio,
      {
        versao: d.versao,
        quilometragemChegada: null,
        desfechos: [{ item: i1!.id, desfecho: 'entregue', motivo: null }],
      },
      chave('conf1'),
    );
    expect(r1.situacao).toBe('em_transito');
    const d2 = await porta.detalhe(ctx, romaneio);
    const r2 = await porta.conferir(
      ctx,
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
    expect(Number(itens[0]!['recebedor_usuario_id'])).toBe(usuario);
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
    expect(Number(r!['conferente_usuario_id'])).toBe(usuario);
    expect(r!['chegada_em']).not.toBeNull();
    expect(Number(r!['quilometragem_chegada'])).toBe(1042);
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
        WHERE estabelecimento_id = ? AND JSON_VALUE(dados_depois, '$.operacao') LIKE 'suprimentos.romaneio.%'
        GROUP BY JSON_VALUE(dados_depois, '$.operacao')`,
      [estA],
    );
    const por = Object.fromEntries(ops.map((o) => [String(o['operacao']), Number(o['n'])]));
    expect(por).toMatchObject({
      [OPERACOES_ROMANEIO_ENTREGA.motorista]: 3,
      [OPERACOES_ROMANEIO_ENTREGA.veiculo]: 1,
      [OPERACOES_ROMANEIO_ENTREGA.montar]: 2,
      [OPERACOES_ROMANEIO_ENTREGA.expedir]: 1,
      [OPERACOES_ROMANEIO_ENTREGA.conferir]: 2,
      [OPERACOES_ROMANEIO_ENTREGA.cancelar]: 1,
    });
  });
});
