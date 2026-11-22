// Integração da porta própria do NIR (M44) contra o MariaDB real, cliente f22_o3 (onda 3), massa SINTÉTICA
// (massa-adt.spec-util.ts, marca N). Contrato de efeito: o pedido de leito e as transições pela situação do cadastro,
// a reserva (ativa, confirmada, cancelada) com a unicidade por leito, a internação que consome a reserva e conclui o
// pedido, a previsão de alta, a barreira de alta (responsável pelas colunas próprias, ida e volta) e a regulação; a
// trilha com a entidade real; e as recusas (estado mudado, reserva encerrada, outro estabelecimento).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_ADT,
  contextoAdt,
  encerrarMassaAdt,
  lerAdt,
  type MassaAdt,
  operacaoAdt,
  prepararMassaAdt,
  SEM_BANCO_ADT,
  trilhaAdt,
} from './massa-adt.spec-util.js';
import { PortaNirPropria } from './nir-porta-propria.js';
import { PortaAdtPropria } from './porta-propria.js';

const codigoDe = (e: unknown) => (e as { problema?: { codigo?: string } }).problema?.codigo;

describe.skipIf(SEM_BANCO_ADT)(`porta própria do NIR (MariaDB, cliente ${CLIENTE_ADT})`, () => {
  let m: MassaAdt | null = null;
  let nir: PortaNirPropria;
  let adt: PortaAdtPropria;
  const M = () => m!;
  const leito = (l: string) => ({ bloco: 'B1', acomodacao: 'Q1', leito: l });
  const conta = async (sql: string, p: unknown[]) =>
    Number((await lerAdt<{ n: number }>(M(), sql, p))?.n ?? 0);
  const trilhas = (tabela: string, id: number) =>
    conta('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?', [tabela, id]);
  const grava = <T>(tabela: string, fn: Parameters<PortaNirPropria['gravarSgh']>[2], est = M().est) =>
    nir.gravarSgh(
      contextoAdt(M(), est),
      (x: unknown) => trilhaAdt(M(), tabela, typeof x === 'number' ? x : null),
      fn,
    ) as Promise<T>;
  const gravaEm = <T>(
    tabela: string,
    id: number,
    fn: Parameters<PortaNirPropria['gravarSgh']>[2],
    est = M().est,
  ) => nir.gravarSgh(contextoAdt(M(), est), trilhaAdt(M(), tabela, id), fn) as Promise<T>;
  const estadoDo = async (pedido: number) =>
    (
      await lerAdt<{ estado: string }>(
        M(),
        'SELECT sp.estado FROM pedido_leito pl JOIN situacao_pedido_leito sp ON sp.id = pl.situacao_pedido_leito_id WHERE pl.id = ?',
        [pedido],
      )
    )?.estado;
  let pedido = 0;
  let reserva = 0;
  let internacao = 0;

  beforeAll(async () => {
    m = await prepararMassaAdt('N');
    nir = new PortaNirPropria(M().nucleo);
    adt = new PortaAdtPropria(M().nucleo);
  }, 60_000);
  afterAll(() => encerrarMassaAdt(m));

  it('solicitar e transicionar: pedido de leito com a situação do cadastro; estado mudado recusa', async () => {
    pedido = await grava<number>('pedido_leito', (g) =>
      g.solicitar({
        origem: 'pa',
        paciente: M().pacientes[0]!,
        atendimento: null,
        cabecalho: null,
        internacao: null,
        cirurgia: null,
        prioridade: 'urgente',
        prazoMin: 240,
        perfil: { tiposAcomodacao: [], precaucao: null, intensiva: false } as never,
        clinica: 'M',
        especialidade: M().especialidade,
        cid: null,
        justificativa: 'Paciente do pronto atendimento',
        situacaoCodigo: M().situacaoSolicitado,
        vinculo: M().medico,
        usuario: M().login,
      }),
    );
    expect(
      await lerAdt(M(), 'SELECT prioridade, setor_origem FROM pedido_leito WHERE id = ?', [pedido]),
    ).toMatchObject({ prioridade: 'alta', setor_origem: 'pronto_atendimento' });
    expect(await trilhas('pedido_leito', pedido)).toBe(1);
    await grava('pedido_leito', (g) =>
      g.transicionar({
        solicitacao: pedido,
        acao: 'analisar' as never,
        de: 'solicitado',
        para: 'em_analise',
        usuario: M().login,
      }),
    );
    expect(await estadoDo(pedido)).toBe('em_analise');
    await expect(
      grava('pedido_leito', (g) =>
        g.transicionar({
          solicitacao: pedido,
          acao: 'analisar' as never,
          de: 'solicitado',
          para: 'em_analise',
          usuario: M().login,
        }),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'conflito-versao');
    await expect(
      grava(
        'pedido_leito',
        (g) =>
          g.transicionar({
            solicitacao: pedido,
            acao: 'analisar' as never,
            de: 'em_analise',
            para: 'reservado',
            usuario: M().login,
          }),
        M().outro,
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'registro-inexistente');
  });

  it('reservar, confirmar, recusar a segunda reserva no leito; a internação consome a reserva e conclui o pedido', async () => {
    reserva = await grava<number>('reserva_leito', (g) =>
      g.reservar({
        solicitacao: pedido,
        leito: leito('01'),
        validadeMin: 60,
        excecao: null,
        usuario: M().login,
      }),
    );
    expect(
      await lerAdt(M(), 'SELECT situacao, versao FROM reserva_leito WHERE id = ?', [reserva]),
    ).toMatchObject({ situacao: 'ativa', versao: 1 });
    await grava('reserva_leito', (g) =>
      g.confirmarReserva({ reserva, validadeMin: 120, usuario: M().login }),
    );
    expect(
      await lerAdt(M(), 'SELECT situacao, versao FROM reserva_leito WHERE id = ?', [reserva]),
    ).toMatchObject({ situacao: 'confirmada', versao: 2 });
    await expect(
      grava('reserva_leito', (g) => g.confirmarReserva({ reserva, validadeMin: 120, usuario: M().login })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'reserva-nao-ativa');
    await expect(
      grava('reserva_leito', (g) =>
        g.reservar({
          solicitacao: pedido,
          leito: leito('01'),
          validadeMin: 60,
          excecao: null,
          usuario: M().login,
        }),
      ),
    ).rejects.toBeTruthy();
    // Outro paciente não ocupa o leito reservado.
    const entrada = (paciente: number, nirPedido?: number) => ({
      paciente,
      leito: leito('01'),
      convenio: M().convenio,
      acomodacaoPlano: 'ENFERMARIA',
      carater: 'urgencia',
      clinica: 'M',
      especialidade: M().especialidade,
      medicoAssistente: M().medico,
      medicoSolicitante: M().medico,
      cidPrincipal: M().cid,
      procedimento: M().procedimento,
      procedimentoOrigem: 'sigtap',
      centroCusto: 1,
      unidade: 1,
      origem: 'ambulatorio',
      caraterAdmissao: M().carater,
      caraterTiss: M().caraterTiss,
      categoriaAtendimento: M().categoria,
      modalidade: M().modalidade,
      ...(nirPedido ? { solicitacaoNir: nirPedido } : {}),
    });
    await expect(
      adt.executar(contextoAdt(M()), 'internacao.internar', entrada(M().pacientes[1]!), operacaoAdt(M())),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'leito-reservado');
    internacao = Number(
      (
        await adt.executar(
          contextoAdt(M()),
          'internacao.internar',
          entrada(M().pacientes[0]!, pedido),
          operacaoAdt(M()),
        )
      ).resultado['internacao'],
    );
    expect(
      await lerAdt(M(), 'SELECT situacao, internacao_id FROM reserva_leito WHERE id = ?', [reserva]),
    ).toMatchObject({ situacao: 'consumida', internacao_id: internacao });
    expect(await estadoDo(pedido)).toBe('internado');
    await expect(
      grava('reserva_leito', (g) =>
        g.encerrarReserva({ reserva, situacao: 'cancelada', motivo: 'tarde', usuario: M().login }),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'reserva-encerrada');
  });

  it('previsão de alta e barreira: responsável nas colunas próprias (ida e volta), alteração e resolução; outro estabelecimento recusa', async () => {
    const dpa = await grava<number>('previsao_alta', (g) =>
      g.registrarDpa({
        reg: internacao,
        pront: 0,
        data: '2030-01-10',
        anterior: null,
        motivo: null,
        vinculo: M().medico,
        usuario: M().login,
      }),
    );
    expect(await lerAdt(M(), 'SELECT operacao FROM previsao_alta WHERE id = ?', [dpa])).toMatchObject({
      operacao: 'inclusao',
    });
    const barreira = await grava<number>('barreira_alta', (g) =>
      g.registrarBarreira({
        reg: internacao,
        pront: 0,
        tipo: 'exame',
        descricao: 'Aguardando tomografia',
        responsavel: M().setorNome,
        prazo: '2030-01-09T12:00:00',
        usuario: M().login,
      }),
    );
    expect(
      await lerAdt(
        M(),
        'SELECT descricao, responsavel_setor_funcional_id AS setor, responsavel_usuario_id AS usuario FROM barreira_alta WHERE id = ?',
        [barreira],
      ),
    ).toMatchObject({
      descricao: 'Aguardando tomografia',
      setor: M().setor,
      usuario: null,
    });
    const lidas = await nir.barreiras(contextoAdt(M()), [internacao]);
    expect(lidas.find((b) => b.id === barreira)).toMatchObject({
      responsavel: M().setorNome,
      descricao: 'Aguardando tomografia',
    });
    await gravaEm('barreira_alta', barreira, (g) =>
      g.alterarBarreira({
        barreira,
        descricao: null,
        responsavel: M().login,
        prazo: null,
        motivo: 'Troca do responsável',
        usuario: M().login,
      }),
    );
    expect(
      (await nir.barreiras(contextoAdt(M()), [internacao])).find((b) => b.id === barreira),
    ).toMatchObject({ responsavel: M().login });
    await expect(
      grava('barreira_alta', (g) =>
        g.registrarBarreira({
          reg: internacao,
          pront: 0,
          tipo: 'exame',
          descricao: 'x',
          responsavel: 'NINGUEM SINTETICO',
          prazo: '',
          usuario: M().login,
        }),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'responsavel-inexistente');
    // Outro estabelecimento não resolve nem altera a barreira desta internação.
    await expect(
      grava(
        'barreira_alta',
        (g) => g.resolverBarreira({ barreira, cancelar: false, observacao: 'por fora', usuario: M().login }),
        M().outro,
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'registro-inexistente');
    await expect(
      grava(
        'barreira_alta',
        (g) =>
          g.alterarBarreira({
            barreira,
            descricao: 'por fora',
            responsavel: null,
            prazo: null,
            motivo: 'x',
            usuario: M().login,
          }),
        M().outro,
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'registro-inexistente');
    await gravaEm('barreira_alta', barreira, (g) =>
      g.resolverBarreira({ barreira, cancelar: false, observacao: 'Exame feito', usuario: M().login }),
    );
    expect(
      await lerAdt(
        M(),
        'SELECT situacao, resolvida_em IS NOT NULL AS resolvida FROM barreira_alta WHERE id = ?',
        [barreira],
      ),
    ).toMatchObject({ situacao: 'resolvida', resolvida: 1 });
    expect(await trilhas('barreira_alta', barreira)).toBeGreaterThanOrEqual(3);
  });

  it('regulação: solicitação à central com o pedido e o paciente; central desconhecida recusa', async () => {
    const r = await grava<{ id: number }>('solicitacao_regulacao', (g) =>
      g.registrarRegulacao({
        solicitacao: pedido,
        central: M().central,
        sentido: 'saida',
        numero: 'REG-0301',
        situacao: 'solicitada',
        origem: 'manual',
        observacao: null,
        anterior: null,
        mensagemHash: null,
        por: M().login,
        outbox: null,
      }),
    );
    expect(
      await lerAdt(
        M(),
        'SELECT pedido_leito_id, paciente_id, origem FROM solicitacao_regulacao WHERE id = ?',
        [r.id],
      ),
    ).toMatchObject({
      pedido_leito_id: pedido,
      paciente_id: M().pacientes[0],
      origem: 'sistema',
    });
    await expect(
      grava('solicitacao_regulacao', (g) =>
        g.registrarRegulacao({
          solicitacao: pedido,
          central: 'L0301ZZ',
          sentido: 'saida',
          numero: 'REG-0302',
          situacao: 'solicitada',
          origem: 'manual',
          observacao: null,
          anterior: null,
          mensagemHash: null,
          por: M().login,
          outbox: null,
        }),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'configuracao-incompleta');
  });
});
