// M52.3: o serviço da fatia F3 sobre as portas EM MEMÓRIA (dados SINTÉTICOS; nada conecta a banco): a troca de plantão
// (regra 8: pedido → aceite do colega → aprovação; só o próprio plantão; a coordenação registra em nome do colega sem
// acesso; quem é parte não aprova; as regras da montagem conferidas com o novo colaborador no pedido e de novo na
// aprovação; o plantão mudado depois do pedido derruba a aprovação), "quem está de plantão agora" (regra 10: o noturno
// que atravessa a meia-noite, o sobreaviso com o tempo de chegada, o acionamento e a chegada com o atraso) e o
// dimensionamento (regra 9: a prévia com as parcelas, a classificação do turno e o registro só com a chave).
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { TETO_LEITURA_INSTANTE } from '@sgh/legado';
import { EVENTO_ESCALA_ALTERADA, EVENTO_SOBREAVISO_ACIONADO, EVENTO_TROCA_APROVADA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { idUsuarioSintetico } from '../../acesso/fonte-sintetica.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import { ServicoPessoas } from '../servico.js';
import { PortaEscalaMemoria } from './porta-escala-memoria.js';
import { ServicoEscala } from './servico-escala.js';
import { ServicoPlantao } from './servico-plantao.js';

const C = PESSOAS_SINTETICAS_M52;
const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});

/** 2026-10-25 às 10 h em Brasília (13 h UTC). */
const relogio = { agora: new Date('2026-10-25T13:00:00Z') };

function montar(recursos = ['pessoas.colaborador', 'pessoas.escala', 'pessoas.dimensionamento']) {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
  });
  const rh = new ServicoPessoas(pessoas, trilha, config, null, new CifraCpf(Buffer.alloc(32, 7)));
  const porta = new PortaEscalaMemoria(pessoas);
  const escala = new ServicoEscala(porta, pessoas, trilha, config, null);
  const servico = new ServicoPlantao(escala, porta, pessoas, trilha, config, null, () => relogio.agora);
  return { pessoas, porta, rh, se: escala, servico, trilha };
}

let k = 0;
/** A sessão: o login e as permissões (padrão: todas). */
function sessao(login = 'SINT.ESCALA', pode: (c: string) => boolean = () => true): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `m52-plantao-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null, usuario: { id: String(idUsuarioSintetico(login)), login } } },
    } as never,
    hospital: 'pc',
    rede: 'rede-sintetica',
    login,
    porta: { rede: 'rede-sintetica', hospital: 'pc' },
    pode,
  };
}
/** O colaborador com login (a enfermeira UM): pede e responde, não monta nem aprova. */
const colab = () => sessao('SINT.COLAB', (c) => c === 'pessoas.troca.pedir' || c === 'pessoas.plantao.ler');
/** A segunda pessoa da coordenação (quatro olhos: aprova o que a primeira registrou). */
const outraCoord = () => sessao('SINT.ESCALA.APROVA');

async function recusa(p: Promise<unknown>): Promise<{ status: number; codigo: unknown; detalhe: string }> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  const x = e as ErroProblema;
  return { status: x.getStatus(), codigo: x.extras['codigo'], detalhe: x.detalhe ?? '' };
}

async function admitir(rh: ServicoPessoas, quem: 'um' | 'tres') {
  const x =
    quem === 'um'
      ? {
          cpf: C.comLogin.cpf,
          nome: 'ENFERMEIRA SINTETICA UM',
          profissional: C.comLogin.profissional,
          usuario: idUsuarioSintetico(C.comLogin.login),
        }
      : {
          cpf: C.escalaEnfermeira.cpf,
          nome: 'ENFERMEIRA SINTETICA TRES',
          profissional: C.escalaEnfermeira.profissional,
          usuario: null,
        };
  return (
    await rh.admitir(sessao('SINT.RH'), {
      ...x,
      tipo: 'clt',
      admissao: '2026-10-01',
      cargo: 'Enfermeira assistencial',
      funcao: null,
      cargaSemanalHoras: 36,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 2' },
      matricula: null,
    })
  ).id;
}

const pl = (
  escala: number,
  vinculo: number,
  inicio: string,
  fim: string,
  extra: Record<string, unknown> = {},
) => ({
  escala,
  vinculo,
  tipo: 'presencial' as const,
  inicio,
  fim,
  chegadaMin: null,
  motivo: null,
  ...extra,
});

/** Escala de enfermagem de novembro publicada: a UM no dia 5 e a TRES no dia 6, das 7 h às 19 h. */
async function cenario() {
  const m = montar();
  const um = await admitir(m.rh, 'um');
  const tres = await admitir(m.rh, 'tres');
  const s = sessao();
  const escala = (
    await m.se.criarEscala(s, {
      unidade: 1,
      setor: 'Posto 2',
      competencia: '2026-11',
      tipo: 'enfermagem',
      cobertura: { manha: 0, tarde: 0, noite: 0 },
    })
  ).id;
  const a = (await m.se.incluirPlantao(s, pl(escala, um, '2026-11-05T07:00', '2026-11-05T19:00'))).id;
  const b = (await m.se.incluirPlantao(s, pl(escala, tres, '2026-11-06T07:00', '2026-11-06T19:00'))).id;
  const versao = (await m.porta.escala(s.porta, escala))!.versao;
  await m.se.publicar(s, { escala, versao, justificativaFuro: null });
  return { ...m, um, tres, escala, a, b, s };
}

const pedido = (c: { a: number; b: number; tres: number }, extra: Record<string, unknown> = {}) => ({
  tipo: 'troca' as const,
  plantao: c.a,
  versao: 0,
  colega: c.tres,
  plantaoColega: c.b,
  versaoColega: 0,
  motivo: 'Compromisso familiar no dia',
  ...extra,
});

describe('troca de plantão (regra 8)', () => {
  it('pedido do próprio plantão → aceite registrado pela coordenação → aprovação: os plantões trocam de dono', async () => {
    const c = await cenario();
    const p = await c.servico.pedirTroca(colab(), pedido(c));
    expect(p.mensagem).toContain('ENFERMEIRA SINTETICA TRES');
    // O mesmo plantão não entra em outro pedido aberto.
    expect((await recusa(c.servico.pedirTroca(colab(), pedido(c)))).codigo).toBe('plantao-em-troca');
    // A lista de quem só pede mostra só as trocas dela, com as ações certas.
    const minhas = await c.servico.trocas(colab(), { minhas: false });
    expect(minhas.itens).toHaveLength(1);
    expect(minhas.itens[0]!.acoes).toEqual({
      responder: false,
      registrarResposta: false,
      decidir: false,
      cancelar: true,
    });
    // Quem pede não responde; a TRES não tem acesso: a coordenação registra a resposta com a confirmação.
    expect(
      (
        await recusa(
          c.servico.responderTroca(colab(), { troca: p.id, versao: 0, aceite: true, confirmacao: null }),
        )
      ).codigo,
    ).toBe('responder-o-proprio');
    expect(
      (
        await recusa(
          c.servico.responderTroca(c.s, { troca: p.id, versao: 0, aceite: true, confirmacao: null }),
        )
      ).codigo,
    ).toBe('sem-confirmacao');
    const coord = await c.servico.trocas(c.s, { minhas: false });
    expect(coord.itens[0]!.acoes.registrarResposta).toBe(true);
    await c.servico.responderTroca(c.s, {
      troca: p.id,
      versao: 0,
      aceite: true,
      confirmacao: 'Confirmou por telefone com a coordenação',
    });
    // Quem é parte não aprova.
    expect(
      (
        await recusa(
          c.servico.decidirTroca(sessao('SINT.COLAB'), {
            troca: p.id,
            versao: 1,
            aprovar: true,
            motivo: null,
          }),
        )
      ).codigo,
    ).toBe('aprovar-a-propria');
    // Quem registrou o aceite em nome do colega não aprova (quatro olhos); a lista já não oferece a decisão.
    expect(
      (await recusa(c.servico.decidirTroca(c.s, { troca: p.id, versao: 1, aprovar: true, motivo: null })))
        .codigo,
    ).toBe('aprovar-o-que-registrou');
    expect((await c.servico.trocas(c.s, { minhas: false })).itens[0]!.acoes.decidir).toBe(false);
    expect((await c.servico.trocas(outraCoord(), { minhas: false })).itens[0]!.acoes.decidir).toBe(true);
    const r = await c.servico.decidirTroca(outraCoord(), {
      troca: p.id,
      versao: 1,
      aprovar: true,
      motivo: null,
    });
    expect(r.mensagem).toBe('Troca aprovada: a escala foi atualizada.');
    expect(r.alertas.join(' ')).toContain('validade do registro no conselho');
    const grade = await c.se.grade(c.s, c.escala);
    const dono = (id: number) => grade.linhas.find((l) => l.plantoes.some((x) => x.id === id))!.nome;
    expect([dono(c.a), dono(c.b)]).toEqual(['ENFERMEIRA SINTETICA TRES', 'ENFERMEIRA SINTETICA UM']);
    expect(grade.eventos.filter((e) => e.acao === 'alterado').map((e) => e.motivo)).toEqual([
      'Troca 1 aprovada: Compromisso familiar no dia'.replace('1', String(p.id)),
      'Troca 1 aprovada: Compromisso familiar no dia'.replace('1', String(p.id)),
    ]);
    const tipos = c.porta.eventosOutbox('pc').map((o) => o.tipo);
    expect(tipos).toContain(EVENTO_TROCA_APROVADA);
    expect(tipos.filter((t) => t === EVENTO_ESCALA_ALTERADA)).toHaveLength(2);
    const lida = (await c.servico.trocas(c.s, { estado: 'aprovada', minhas: false })).itens[0]!;
    expect(lida).toMatchObject({
      estado: 'aprovada',
      confirmacao: 'Confirmou por telefone com a coordenação',
      respostaPor: 'SINT.ESCALA',
      decisaoPor: 'SINT.ESCALA.APROVA',
    });
  });

  it('a coordenação pede em nome só de quem não tem acesso; quem registrou o pedido não aprova', async () => {
    const c = await cenario();
    // A UM tem acesso: o pedido é dela.
    expect((await recusa(c.servico.pedirTroca(c.s, pedido(c)))).codigo).toBe('colaborador-com-acesso');
    // A TRES não tem acesso: a coordenação pede por ela (cessão do dia 6 para a UM), a UM aceita, e quem pediu não aprova.
    const p = await c.servico.pedirTroca(
      c.s,
      pedido(c, { plantao: c.b, colega: c.um, tipo: 'cessao', plantaoColega: null, versaoColega: null }),
    );
    await c.servico.responderTroca(colab(), { troca: p.id, versao: 0, aceite: true, confirmacao: null });
    expect(
      (await recusa(c.servico.decidirTroca(c.s, { troca: p.id, versao: 1, aprovar: true, motivo: null })))
        .codigo,
    ).toBe('aprovar-o-que-registrou');
    const r = await c.servico.decidirTroca(outraCoord(), {
      troca: p.id,
      versao: 1,
      aprovar: true,
      motivo: null,
    });
    expect(r.mensagem).toBe('Troca aprovada: a escala foi atualizada.');
  });

  it('só o próprio plantão; escala em rascunho; colega fora da escala; reprovação com motivo; cancelamento', async () => {
    const c = await cenario();
    // O plantão da TRES não é da UM, e a UM não monta escala.
    expect(
      (
        await recusa(
          c.servico.pedirTroca(colab(), pedido(c, { plantao: c.b, colega: c.um, plantaoColega: c.a })),
        )
      ).status,
    ).toBe(403);
    // Colega que não existe no estabelecimento.
    expect(
      (
        await recusa(
          c.servico.pedirTroca(
            colab(),
            pedido(c, { tipo: 'cessao', colega: 999, plantaoColega: null, versaoColega: null }),
          ),
        )
      ).status,
    ).toBe(404);
    // Cessão: pedida e cancelada por quem pediu.
    const p = await c.servico.pedirTroca(
      colab(),
      pedido(c, { tipo: 'cessao', plantaoColega: null, versaoColega: null }),
    );
    await c.servico.cancelarTroca(colab(), { troca: p.id, versao: 0, motivo: 'Pedido feito por engano' });
    expect((await c.servico.trocas(c.s, { estado: 'cancelada', minhas: false })).itens).toHaveLength(1);
    // Troca: aceita e reprovada (com motivo).
    const q = await c.servico.pedirTroca(colab(), pedido(c));
    await c.servico.responderTroca(c.s, {
      troca: q.id,
      versao: 0,
      aceite: true,
      confirmacao: 'Confirmou pessoalmente',
    });
    await c.servico.decidirTroca(outraCoord(), {
      troca: q.id,
      versao: 1,
      aprovar: false,
      motivo: 'Cobertura do posto no dia',
    });
    expect(
      (await c.servico.trocas(c.s, { estado: 'reprovada', minhas: false })).itens[0]!.motivoDecisao,
    ).toBe('Cobertura do posto no dia');
    // Decidir a troca ainda não aceita.
    const r = await c.servico.pedirTroca(colab(), pedido(c));
    expect(
      (await recusa(c.servico.decidirTroca(c.s, { troca: r.id, versao: 0, aprovar: true, motivo: null })))
        .codigo,
    ).toBe('troca-nao-aceita');
    // Recusa do colega.
    await c.servico.responderTroca(c.s, {
      troca: r.id,
      versao: 0,
      aceite: false,
      confirmacao: 'Recusou por telefone',
    });
    expect((await c.servico.trocas(c.s, { estado: 'recusada', minhas: false })).itens).toHaveLength(1);
    // Escala em rascunho: a troca não existe (a coordenação muda a grade).
    const rasc = (
      await c.se.criarEscala(c.s, {
        unidade: 1,
        setor: 'Posto 3',
        competencia: '2026-11',
        tipo: 'enfermagem',
        cobertura: { manha: 0, tarde: 0, noite: 0 },
      })
    ).id;
    const x = (await c.se.incluirPlantao(c.s, pl(rasc, c.um, '2026-11-10T07:00', '2026-11-10T19:00'))).id;
    await c.se.incluirPlantao(c.s, pl(rasc, c.tres, '2026-11-11T07:00', '2026-11-11T19:00'));
    expect(
      (
        await recusa(
          c.servico.pedirTroca(
            colab(),
            pedido(c, { plantao: x, tipo: 'cessao', plantaoColega: null, versaoColega: null }),
          ),
        )
      ).codigo,
    ).toBe('escala-em-rascunho');
    expect((await recusa(c.servico.plantoesParaTroca(colab(), rasc))).codigo).toBe('escala-em-rascunho');
  });

  it('as regras da montagem com o colega: no pedido e de novo na aprovação; plantão mudado derruba a aprovação', async () => {
    const c = await cenario();
    // A TRES tem plantão do dia 4 às 19 h até as 7 h do dia 5: a cessão do dia 5 das 7 h às 19 h fere a interjornada dela.
    const noturno = (
      await c.se.incluirPlantao(
        c.s,
        pl(c.escala, c.tres, '2026-11-04T19:00', '2026-11-05T07:00', {
          motivo: 'Reforço do noturno do dia 5',
        }),
      )
    ).id;
    const r = await recusa(
      c.servico.pedirTroca(colab(), pedido(c, { tipo: 'cessao', plantaoColega: null, versaoColega: null })),
    );
    expect([r.codigo, r.detalhe.startsWith('ENFERMEIRA SINTETICA TRES:')]).toEqual(['interjornada', true]);
    await c.se.cancelarPlantao(c.s, {
      escala: c.escala,
      plantao: noturno,
      versao: 0,
      motivo: 'Reforço desnecessário',
    });
    // O pedido passa; depois do aceite, o noturno volta e a aprovação confere de novo.
    const p = await c.servico.pedirTroca(
      colab(),
      pedido(c, { tipo: 'cessao', plantaoColega: null, versaoColega: null }),
    );
    await c.servico.responderTroca(c.s, {
      troca: p.id,
      versao: 0,
      aceite: true,
      confirmacao: 'Confirmou por telefone',
    });
    const volta = (
      await c.se.incluirPlantao(
        c.s,
        pl(c.escala, c.tres, '2026-11-04T19:00', '2026-11-05T07:00', {
          motivo: 'Reforço do noturno, de novo',
        }),
      )
    ).id;
    expect(
      (
        await recusa(
          c.servico.decidirTroca(outraCoord(), { troca: p.id, versao: 1, aprovar: true, motivo: null }),
        )
      ).codigo,
    ).toBe('interjornada');
    await c.se.cancelarPlantao(c.s, {
      escala: c.escala,
      plantao: volta,
      versao: 0,
      motivo: 'Reforço desnecessário',
    });
    // O plantão do pedido mudou (horário): a troca ficou desatualizada.
    await c.se.alterarPlantao(c.s, {
      ...pl(c.escala, c.um, '2026-11-05T08:00', '2026-11-05T20:00', { motivo: 'Ajuste do horário do posto' }),
      plantao: c.a,
      versao: 0,
    });
    expect(
      (
        await recusa(
          c.servico.decidirTroca(outraCoord(), { troca: p.id, versao: 1, aprovar: true, motivo: null }),
        )
      ).codigo,
    ).toBe('troca-desatualizada');
  });

  it('plantões para a troca: os futuros da escala, os da pessoa da sessão e os já em troca; os colegas da escala', async () => {
    const c = await cenario();
    await c.servico.pedirTroca(colab(), pedido(c));
    const r = await c.servico.plantoesParaTroca(colab(), c.escala);
    expect(r.plantoes.map((p) => [p.nome, p.meu, p.emTroca])).toEqual([
      ['ENFERMEIRA SINTETICA UM', true, true],
      ['ENFERMEIRA SINTETICA TRES', false, true],
    ]);
    expect(r.colegas.map((x) => x.nome)).toEqual(['ENFERMEIRA SINTETICA TRES', 'ENFERMEIRA SINTETICA UM']);
    const apoio = await c.servico.apoioTrocas(colab());
    expect(apoio.escalas.map((x) => x.id)).toEqual([c.escala]);
    expect(apoio.acoes).toMatchObject({ pedir: true, aprovar: false, emNomeDe: false });
  });
});

describe('quem está de plantão agora e o sobreaviso (regra 10)', () => {
  async function comPlantoesDeHoje() {
    const m = montar();
    const um = await admitir(m.rh, 'um');
    const tres = await admitir(m.rh, 'tres');
    const s = sessao();
    const escala = (
      await m.se.criarEscala(s, {
        unidade: 1,
        setor: 'Posto 2',
        competencia: '2026-10',
        tipo: 'enfermagem',
        cobertura: { manha: 0, tarde: 0, noite: 0 },
      })
    ).id;
    const noturno = (await m.se.incluirPlantao(s, pl(escala, um, '2026-10-25T19:00', '2026-10-26T07:00'))).id;
    const sobre = (
      await m.se.incluirPlantao(
        s,
        pl(escala, tres, '2026-10-25T00:00', '2026-10-26T00:00', { tipo: 'sobreaviso', chegadaMin: 30 }),
      )
    ).id;
    return { ...m, s, escala, noturno, sobre };
  }

  it('só a escala publicada; o noturno às 2 h começou ontem; o filtro por especialidade e por tipo', async () => {
    const c = await comPlantoesDeHoje();
    expect((await c.servico.plantaoAgora(c.s, { instante: '2026-10-26T02:00' })).linhas).toEqual([]);
    const versao = (await c.porta.escala(c.s.porta, c.escala))!.versao;
    await c.se.publicar(c.s, { escala: c.escala, versao, justificativaFuro: null });
    const r = await c.servico.plantaoAgora(c.s, { instante: '2026-10-26T02:00' });
    expect(r.linhas.map((l) => [l.nome, l.tipo, l.desdeOntem, l.conselho, l.especialidade])).toEqual([
      ['ENFERMEIRA SINTETICA UM', 'presencial', true, 'COREN 52001/RS', 'Enfermeiro'],
    ]);
    const agora = await c.servico.plantaoAgora(c.s, {});
    expect(agora.instante).toBe('2026-10-25T10:00');
    expect(agora.linhas.map((l) => [l.tipo, l.chegadaMin])).toEqual([['sobreaviso', 30]]);
    expect(agora.especialidades).toEqual([{ codigo: 223505, rotulo: 'Enfermeiro' }]);
    expect(
      (await c.servico.plantaoAgora(c.s, { instante: '2026-10-25T20:00', tipo: 'presencial' })).linhas,
    ).toHaveLength(1);
    expect(
      (await c.servico.plantaoAgora(c.s, { instante: '2026-10-25T20:00', especialidade: '225125' })).linhas,
    ).toEqual([]);
    expect(
      (await c.servico.plantaoAgora(c.s, { instante: '2026-10-25T20:00', setor: 'outro' })).linhas,
    ).toEqual([]);
    expect((await c.servico.plantaoAgora(colab(), {})).acoes.acionar).toBe(false);
  });

  it('a leitura que bate no teto avisa que a lista foi cortada, mesmo com o filtro de especialidade vazio', async () => {
    const c = await comPlantoesDeHoje();
    const versao = (await c.porta.escala(c.s.porta, c.escala))!.versao;
    await c.se.publicar(c.s, { escala: c.escala, versao, justificativaFuro: null });
    const original = c.porta.plantoesNoInstante.bind(c.porta);
    c.porta.plantoesNoInstante = async (...a: Parameters<typeof original>) => {
      const r = await original(...a);
      return Array.from({ length: TETO_LEITURA_INSTANTE }, (_, i) => r[i % r.length]!);
    };
    const x = await c.servico.plantaoAgora(c.s, { instante: '2026-10-25T20:00', especialidade: '225125' });
    expect([x.linhas, x.truncado]).toEqual([[], true]);
  });

  it('acionar o sobreaviso em curso: o prazo de chegada, um acionamento aberto por vez, a chegada com o atraso', async () => {
    const c = await comPlantoesDeHoje();
    const versao = (await c.porta.escala(c.s.porta, c.escala))!.versao;
    await c.se.publicar(c.s, { escala: c.escala, versao, justificativaFuro: null });
    expect(
      (
        await recusa(
          c.servico.acionar(c.s, {
            plantao: c.noturno,
            motivo: 'Paciente grave na emergência',
            atendimento: null,
          }),
        )
      ).codigo,
    ).toBe('nao-e-sobreaviso');
    const a = await c.servico.acionar(c.s, {
      plantao: c.sobre,
      motivo: 'Paciente grave na emergência',
      atendimento: 4242,
    });
    expect(a.mensagem).toBe('ENFERMEIRA SINTETICA TRES acionado(a): chegada prevista até 25/10 10:30.');
    expect(
      (
        await recusa(
          c.servico.acionar(c.s, {
            plantao: c.sobre,
            motivo: 'Segundo chamado no plantão',
            atendimento: null,
          }),
        )
      ).codigo,
    ).toBe('ja-acionado');
    expect(c.porta.eventosOutbox('pc').map((o) => o.tipo)).toContain(EVENTO_SOBREAVISO_ACIONADO);
    relogio.agora = new Date('2026-10-25T13:45:00Z');
    try {
      const linha = (await c.servico.plantaoAgora(c.s, {})).linhas[0]!;
      expect(linha.acionamento).toMatchObject({ situacao: 'acionado', atendimento: 4242, atrasado: true });
      expect(
        (
          await recusa(
            c.servico.registrarChegada(c.s, { acionamento: a.id, versao: 0, chegouEm: '2026-10-25T10:50' }),
          )
        ).codigo,
      ).toBe('chegada-futura');
      const r = await c.servico.registrarChegada(c.s, {
        acionamento: a.id,
        versao: 0,
        chegouEm: '2026-10-25T10:40',
      });
      expect(r.alertas).toEqual(['A chegada passou do prazo (25/10 10:30).']);
      expect(
        (
          await recusa(
            c.servico.cancelarAcionamento(c.s, {
              acionamento: a.id,
              versao: 1,
              motivo: 'Acionado por engano',
            }),
          )
        ).codigo,
      ).toBe('acionamento-encerrado');
      // Novo acionamento e o cancelamento por engano.
      const b = await c.servico.acionar(c.s, {
        plantao: c.sobre,
        motivo: 'Novo paciente grave',
        atendimento: null,
      });
      await c.servico.cancelarAcionamento(c.s, {
        acionamento: b.id,
        versao: 0,
        motivo: 'Acionado por engano',
      });
      const ultima = (await c.servico.plantaoAgora(c.s, {})).linhas[0]!.acionamento!;
      expect([ultima.id, ultima.situacao]).toEqual([b.id, 'cancelado']);
    } finally {
      relogio.agora = new Date('2026-10-25T13:00:00Z');
    }
  });

  it('a escala desligada não aciona (consulta continua)', async () => {
    const m = montar(['pessoas.colaborador']);
    expect(
      (
        await recusa(
          m.servico.acionar(sessao(), {
            plantao: 1,
            motivo: 'Paciente grave na emergência',
            atendimento: null,
          }),
        )
      ).status,
    ).toBe(403);
    expect((await m.servico.plantaoAgora(sessao(), {})).acoes.acionar).toBe(false);
  });
});

describe('dimensionamento de enfermagem (regra 9)', () => {
  const base = {
    unidade: 1,
    setor: 'Posto 2',
    data: '2026-10-25',
    turno: 'manha' as const,
    jornadaSemanalHoras: 36,
    ist: 0.15,
  };

  it('o paciente com Fugulin e NAS no mesmo turno entra uma vez só no cálculo (pelo NAS), com a parcela', async () => {
    const { servico, porta } = montar();
    porta.classificacoesDoTurno = async () => [
      { paciente: 990101, instrumento: 'fugulin', categoria: 'intensivos', total: 40 },
      { paciente: 990101, instrumento: 'nas', categoria: 'nas', total: 70 },
      { paciente: 990102, instrumento: 'fugulin', categoria: 'minimos', total: 14 },
    ];
    const k = await servico.calcular(sessao(), {
      ...base,
      fonte: 'classificacao',
      unidadeInternacao: 'UIS',
      pacientes: null,
    });
    // 1 mínimo (4 h) + NAS 70% × 24 ÷ 100 = 16,8 h; o Fugulin intensivo do mesmo paciente (18 h) não entra.
    expect(k.calculo.pacientes).toMatchObject({ minimos: 1, intensivos: 0 });
    expect(k.calculo.totalHoras).toBe(20.8);
    expect(k.calculo.parcelas).toContain(
      'Pacientes com Fugulin e NAS no mesmo turno: 1 (contados uma vez só, pelo NAS)',
    );
  });

  it('prévia informada com as parcelas; da classificação do turno, com o NAS e os não classificados; registro', async () => {
    const { servico } = montar();
    const s = sessao();
    const p = await servico.calcular(s, {
      ...base,
      fonte: 'informada',
      unidadeInternacao: null,
      pacientes: { minimos: 10, intermediarios: 8, altaDependencia: 2, semiIntensivos: 0, intensivos: 0 },
    });
    expect([p.calculo.totalProfissionais, p.calculo.enfermeiros, p.calculo.coberturaSugerida]).toEqual([
      25, 9, 5,
    ]);
    // Classificação sintética: 5 mínimos (20 h), 4 intermediários (24 h), 2 de alta dependência (20 h) e o NAS de 65,2%
    // (65,2 × 24 ÷ 100 = 15,65 h): THE = 79,65; QP = 79,65 × 0,2236 = 17,81 → 18; prevalente mínimos: 33% de 18 = 5,94
    // → 6; cobertura = 79,65 ÷ 24 = 3,32 → 4.
    const k = await servico.calcular(s, {
      ...base,
      fonte: 'classificacao',
      unidadeInternacao: 'UIS',
      pacientes: null,
    });
    expect(k.calculo).toMatchObject({
      totalHoras: 79.65,
      totalProfissionais: 18,
      enfermeiros: 6,
      tecnicos: 12,
      coberturaSugerida: 4,
    });
    expect(k.naoClassificados).toBe(0);
    const r = await servico.registrarDimensionamento(s, {
      ...base,
      fonte: 'classificacao',
      unidadeInternacao: 'UIS',
      pacientes: null,
    });
    expect(r.mensagem).toBe(
      'Dimensionamento registrado: 18 profissional(is), 6 enfermeiro(s); cobertura sugerida 4 por turno.',
    );
    const l = await servico.dimensionamentos(s, { unidade: 1 });
    expect(l.itens[0]).toMatchObject({ id: r.id, fonte: 'classificacao', unidadeInternacao: 'UIS' });
    expect(l.itens[0]!.calculo.parcelas[0]).toBe('Cuidados mínimos: 5 paciente(s) × 4 h = 20 h');
    expect(l.itens[0]!.calculo.horasPorCategoria.intermediarios).toBe(24);
    const apoio = await servico.apoioDimensionamento(s);
    expect(apoio).toMatchObject({ minimoEnfermeiros: 6, acoes: { calcular: true, aplicarNaEscala: true } });
    expect(apoio.unidadesInternacao).toEqual([
      { codigo: 'UIS', rotulo: 'Internação sintética', internados: 12 },
    ]);
    expect(
      (
        await recusa(
          servico.calcular(s, {
            ...base,
            unidade: 9999,
            fonte: 'informada',
            unidadeInternacao: null,
            pacientes: p.calculo.pacientes,
          }),
        )
      ).codigo,
    ).toBe('unidade-desconhecida');
  });

  it('o registro exige a chave do dimensionamento; a prévia não', async () => {
    const { servico } = montar(['pessoas.colaborador']);
    const e = {
      ...base,
      fonte: 'informada' as const,
      unidadeInternacao: null,
      pacientes: { minimos: 1, intermediarios: 0, altaDependencia: 0, semiIntensivos: 0, intensivos: 0 },
    };
    expect((await servico.calcular(sessao(), e)).calculo.totalHoras).toBe(4);
    expect((await recusa(servico.registrarDimensionamento(sessao(), e))).status).toBe(403);
  });
});
