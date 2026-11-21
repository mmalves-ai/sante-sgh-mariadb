// M52.2: o serviço da escala sobre as portas EM MEMÓRIA (dados SINTÉTICOS; nada conecta a banco): regimes e a vigência
// do regime, a escala do setor, a montagem com as regras de bloqueio (regra 3 conselho no dia; 5 interjornada; 6 limite
// do contrato; 7 sobreposição na Rede, sem a escala alheia), a publicação (furo com justificativa, conselho vencido
// bloqueia) e a mudança da escala publicada só com motivo (regra 8), com a trilha da escala e a integracao_mensagem.
import type { ChaveLiberacao, PrerequisitoRecurso } from '../../config/public-api.js';
import { EVENTO_ESCALA_ALTERADA, EVENTO_ESCALA_PUBLICADA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import { ServicoPessoas } from '../servico.js';
import { CONTEXTO_SINTETICO, PortaEscalaMemoria } from './porta-escala-memoria.js';
import { janelaDoPlantao, ServicoEscala } from './servico-escala.js';

const C = PESSOAS_SINTETICAS_M52;
const chave = (c: string): ChaveLiberacao => ({
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
const cumprido = (recurso: string): PrerequisitoRecurso => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});

function montar(escalaLigada = true) {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = ['pessoas.colaborador', ...(escalaLigada ? ['pessoas.escala'] : [])];
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
  });
  const rh = new ServicoPessoas(pessoas, trilha, config, null, new CifraCpf(Buffer.alloc(32, 7)));
  const porta = new PortaEscalaMemoria(pessoas);
  const servico = new ServicoEscala(porta, pessoas, trilha, config, null);
  return { pessoas, porta, rh, servico, trilha };
}

let k = 0;
function sessao(hospital = 'pc', login = 'SINT.ESCALA'): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `m52-escala-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null } },
    } as never,
    hospital,
    rede: 'rede-sintetica',
    login,
    porta: {
      ...CONTEXTO_SINTETICO,
      estabelecimento: hospital === 'pc' ? 1 : 2,
      rede: 'rede-sintetica',
      hospital,
    },
    pode: () => true,
  };
}

async function admitir(
  rh: ServicoPessoas,
  quem: 'enfermeira' | 'medico' | 'nova',
  hospital = 'pc',
  extra: Record<string, unknown> = {},
) {
  const x =
    quem === 'enfermeira'
      ? {
          cpf: C.escalaEnfermeira.cpf,
          nome: 'ENFERMEIRA SINTETICA TRES',
          profissional: C.escalaEnfermeira.profissional,
        }
      : quem === 'medico'
        ? {
            cpf: C.escalaMedico.cpf,
            nome: 'MEDICO SINTETICO QUATRO',
            profissional: C.escalaMedico.profissional,
          }
        : { cpf: C.nova.cpf, nome: 'PESSOA NOVA SINTETICA', profissional: null };
  return (
    await rh.admitir(sessao(hospital, 'SINT.RH'), {
      ...x,
      tipo: 'clt',
      admissao: '2026-10-01',
      cargo: quem === 'medico' ? 'Médico plantonista' : 'Enfermeira assistencial',
      funcao: null,
      cargaSemanalHoras: 36,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 2' },
      matricula: null,
      usuario: null,
      ...extra,
    })
  ).id;
}

async function recusa(p: Promise<unknown>): Promise<{ status: number; codigo: unknown; detalhe: string }> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  const x = e as ErroProblema;
  return { status: x.getStatus(), codigo: x.extras['codigo'], detalhe: x.detalhe ?? '' };
}

const regime12x36 = {
  codigo: '12x36',
  nome: 'Plantão 12 por 36',
  jornada: 2,
  contratoParcial: 0,
  folgaPadrao: null,
  minutosPlantao: 720,
  descansoMinimoMin: 660,
  limiteSemanalHoras: 48,
  acordo: null,
  ativo: true,
};
const cobertura = { manha: 0, tarde: 0, noite: 0 };
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

async function cenario(tipo: 'enfermagem' | 'medica' | 'apoio' = 'enfermagem', cob = cobertura) {
  const m = montar();
  const enf = await admitir(m.rh, 'enfermeira');
  const escala = (
    await m.servico.criarEscala(sessao(), {
      unidade: 1,
      setor: 'Posto 2',
      competencia: '2026-11',
      tipo,
      cobertura: cob,
    })
  ).id;
  return { ...m, enf, escala };
}

describe('regimes (M52.2)', () => {
  it('inclui, lista com o limite efetivo, recusa descanso sem acordo e domínio desconhecido', async () => {
    const { servico } = montar();
    const s = sessao();
    await servico.incluirRegime(s, regime12x36);
    await servico.incluirRegime(s, {
      ...regime12x36,
      codigo: 'P25',
      nome: 'Tempo parcial 25 h',
      contratoParcial: 1,
    });
    const l = await servico.regimes(s);
    expect(l.itens.map((r) => [r.codigo, r.limiteEfetivoHoras, r.jornadaNome])).toEqual([
      ['12x36', 48, 'Escalonada'],
      ['P25', 25, 'Escalonada'],
    ]);
    expect(
      (await recusa(servico.incluirRegime(s, { ...regime12x36, codigo: 'X', descansoMinimoMin: 600 })))
        .codigo,
    ).toBe('descanso-sem-acordo');
    expect((await recusa(servico.incluirRegime(s, { ...regime12x36, codigo: 'Y', jornada: 9 }))).codigo).toBe(
      'jornada-desconhecida',
    );
    expect(
      (await recusa(servico.incluirRegime(s, { ...regime12x36, codigo: 'Z', contratoParcial: 8 }))).codigo,
    ).toBe('parcial-desconhecido');
    expect(
      (await recusa(servico.incluirRegime(s, { ...regime12x36, codigo: 'W', folgaPadrao: 77 }))).codigo,
    ).toBe('folga-desconhecida');
    expect((await recusa(servico.incluirRegime(s, regime12x36))).codigo).toBe('regime-existente');
  });

  it('altera com a versão; atribui ao colaborador com vigência (só inclusão) e mostra na lista', async () => {
    const { servico, rh } = montar();
    const s = sessao();
    const r = (await servico.incluirRegime(s, regime12x36)).id;
    await servico.alterarRegime(s, { ...regime12x36, id: r, versao: 0, nome: 'Plantão 12x36 noturno' });
    expect((await recusa(servico.alterarRegime(s, { ...regime12x36, id: r, versao: 0 }))).codigo).toBe(
      'desatualizado',
    );
    expect((await recusa(servico.alterarRegime(s, { ...regime12x36, id: 999, versao: 0 }))).status).toBe(404);
    const v = await admitir(rh, 'enfermeira');
    await servico.atribuirRegime(s, { vinculo: v, regime: r, desde: '2026-10-01' });
    expect(
      (await recusa(servico.atribuirRegime(s, { vinculo: v, regime: r, desde: '2026-10-01' }))).codigo,
    ).toBe('vigencia-repetida');
    expect(
      (await recusa(servico.atribuirRegime(s, { vinculo: v, regime: r, desde: '2026-09-30' }))).codigo,
    ).toBe('antes-da-admissao');
    const lista = await servico.colaboradores(s, { limite: 50 });
    expect(lista.itens[0]).toMatchObject({
      vinculo: v,
      regime: { id: r, codigo: '12x36', desde: '2026-10-01' },
    });
    expect(await servico.vigencias(s, v)).toEqual([
      {
        id: expect.any(Number),
        regime: r,
        codigo: '12x36',
        desde: '2026-10-01',
        por: 'SINT.ESCALA',
        anulada: null,
      },
    ]);
    const inativo = (await servico.incluirRegime(s, { ...regime12x36, codigo: 'OFF', ativo: false })).id;
    expect(
      (await recusa(servico.atribuirRegime(s, { vinculo: v, regime: inativo, desde: '2026-11-01' }))).codigo,
    ).toBe('regime-inativo');
  });
});

describe('escala: criação e montagem (regras 3, 5, 6 e 7)', () => {
  it('cria a escala do mês atual em diante, uma por unidade, setor, competência e tipo', async () => {
    const { servico } = montar();
    const s = sessao();
    const base = {
      unidade: 1,
      setor: 'Posto 2',
      competencia: '2026-11',
      tipo: 'enfermagem' as const,
      cobertura,
    };
    await servico.criarEscala(s, base);
    expect((await recusa(servico.criarEscala(s, base))).codigo).toBe('escala-existente');
    expect((await recusa(servico.criarEscala(s, { ...base, competencia: '2026-09' }))).codigo).toBe(
      'competencia-passada',
    );
    expect((await recusa(servico.criarEscala(s, { ...base, unidade: 77 }))).codigo).toBe(
      'unidade-desconhecida',
    );
    const l = await servico.escalas(s, { competencia: '2026-11' });
    expect(l.itens[0]).toMatchObject({
      estado: 'rascunho',
      conselhoExigido: 'COREN',
      unidadeNome: 'Unidade sintética',
    });
  });

  it('inclui com o alerta do conselho sem validade conferida; trilha e grade', async () => {
    const { servico, enf, escala } = await cenario();
    const r = await servico.incluirPlantao(sessao(), pl(escala, enf, '2026-11-02T07:00', '2026-11-02T19:00'));
    expect(r.alertas).toEqual(['A validade do registro no conselho ainda não foi conferida pelo RH.']);
    const g = await servico.grade(sessao(), escala);
    expect(g.dias).toHaveLength(30);
    expect(g.linhas[0]).toMatchObject({ vinculo: enf, nome: 'ENFERMEIRA SINTETICA TRES', regime: null });
    expect(g.linhas[0]!.plantoes[0]).toMatchObject({ alertaConselho: 'semValidade', situacao: 'previsto' });
    expect(g.linhas[0]!.semanas).toEqual([{ semana: '2026-11-02', horas: 12, limite: 44 }]);
    expect(g.eventos.map((e) => e.acao)).toEqual(['incluido', 'criada']);
    expect(g.escala.versao).toBe(1);
  });

  it('regra 3: médico na escala de enfermagem não entra; conselho vencido no dia é recusado; a vencer entra com alerta', async () => {
    const { servico, rh, enf, escala } = await cenario();
    const med = await admitir(rh, 'medico');
    expect(
      (
        await recusa(
          servico.incluirPlantao(sessao(), pl(escala, med, '2026-11-03T07:00', '2026-11-03T19:00')),
        )
      ).codigo,
    ).toBe('conselho-sem-registro');
    await rh.registrarHabilitacao(sessao('pc', 'SINT.RH'), {
      registro: C.escalaEnfermeira.registro,
      validade: '2026-11-05',
      conferidoEm: '2026-10-20',
      observacao: null,
    });
    expect(
      (
        await recusa(
          servico.incluirPlantao(sessao(), pl(escala, enf, '2026-11-06T07:00', '2026-11-06T19:00')),
        )
      ).codigo,
    ).toBe('conselho-vencido');
    const r = await servico.incluirPlantao(sessao(), pl(escala, enf, '2026-11-05T07:00', '2026-11-05T19:00'));
    expect(r.alertas[0]).toContain('vence em breve');
  });

  it('regra 5: 10 h 59 min de descanso recusado; regra 6: tempo parcial de 25 h recusa o terceiro plantão da semana', async () => {
    const { servico, enf, escala } = await cenario();
    const s = sessao();
    await servico.incluirPlantao(s, pl(escala, enf, '2026-11-02T07:00', '2026-11-02T19:00'));
    const r = await recusa(
      servico.incluirPlantao(s, pl(escala, enf, '2026-11-03T05:59', '2026-11-03T11:59')),
    );
    expect(r.codigo).toBe('interjornada');
    expect(r.detalhe).toContain('10 h 59 min');
    const p25 = (await servico.incluirRegime(s, { ...regime12x36, codigo: 'P25', contratoParcial: 1 })).id;
    await servico.atribuirRegime(s, { vinculo: enf, regime: p25, desde: '2026-10-01' });
    await servico.incluirPlantao(s, pl(escala, enf, '2026-11-04T07:00', '2026-11-04T19:00'));
    expect(
      (await recusa(servico.incluirPlantao(s, pl(escala, enf, '2026-11-06T07:00', '2026-11-06T19:00'))))
        .codigo,
    ).toBe('limite-do-contrato');
    // A semana seguinte cabe; o sobreaviso não conta como jornada.
    await servico.incluirPlantao(
      s,
      pl(escala, enf, '2026-11-06T19:00', '2026-11-07T07:00', { tipo: 'sobreaviso', chegadaMin: 30 }),
    );
    await servico.incluirPlantao(s, pl(escala, enf, '2026-11-09T07:00', '2026-11-09T19:00'));
  });

  it('sobreposição no estabelecimento e plantão no passado recusados; vínculo de outro estabelecimento é 404', async () => {
    const { servico, enf, escala } = await cenario();
    const s = sessao();
    await servico.incluirPlantao(s, pl(escala, enf, '2026-11-02T07:00', '2026-11-02T19:00'));
    expect(
      (
        await recusa(
          servico.incluirPlantao(
            s,
            pl(escala, enf, '2026-11-02T18:00', '2026-11-02T22:00', { tipo: 'sobreaviso', chegadaMin: 20 }),
          ),
        )
      ).codigo,
    ).toBe('sobreposicao');
    expect(
      (await recusa(servico.incluirPlantao(s, pl(escala, 999, '2026-11-02T07:00', '2026-11-02T19:00'))))
        .status,
    ).toBe(404);
    expect((await recusa(servico.grade(sessao('sx'), escala))).status).toBe(404);
  });

  it('regra 7: plantão na mesma hora em outro estabelecimento da Rede é recusado sem expor a escala; sem resposta, entra com alerta', async () => {
    const { servico, rh, porta, enf, escala } = await cenario();
    const enfSx = await admitir(rh, 'enfermeira', 'sx');
    const escSx = (
      await servico.criarEscala(sessao('sx'), {
        unidade: 1,
        setor: 'UTI',
        competencia: '2026-11',
        tipo: 'enfermagem',
        cobertura,
      })
    ).id;
    await servico.incluirPlantao(sessao('sx'), pl(escSx, enfSx, '2026-11-10T19:00', '2026-11-11T07:00'));
    const r = await recusa(
      servico.incluirPlantao(sessao(), pl(escala, enf, '2026-11-11T01:00', '2026-11-11T07:00')),
    );
    expect(r.codigo).toBe('sobreposicao-rede');
    expect(r.detalhe).toBe('O colaborador já tem plantão neste horário em outro estabelecimento da Rede.');
    expect(r.detalhe).not.toContain('UTI');
    porta.indisponiveis.add('sx');
    const ok = await servico.incluirPlantao(
      sessao(),
      pl(escala, enf, '2026-11-11T01:00', '2026-11-11T07:00'),
    );
    expect(ok.alertas.at(-1)).toContain('outros estabelecimentos da Rede');
    expect((await servico.grade(sessao(), escala)).linhas[0]!.plantoes[0]!.redeNaoConferida).toBe(true);
  });

  it('regra 7 (D-ESCALA-REDE-52): estabelecimento da Rede sem a escala liberada não é consultado nem vira "Rede não conferida"', async () => {
    const { servico, rh, porta, pessoas, trilha, enf, escala } = await cenario();
    const enfSx = await admitir(rh, 'enfermeira', 'sx');
    const escSx = (
      await servico.criarEscala(sessao('sx'), {
        unidade: 1,
        setor: 'UTI',
        competencia: '2026-11',
        tipo: 'enfermagem',
        cobertura,
      })
    ).id;
    await servico.incluirPlantao(sessao('sx'), pl(escSx, enfSx, '2026-11-10T19:00', '2026-11-11T07:00'));
    // Outra configuração: a escala ligada só no primeiro estabelecimento lido (o da sessão, pc); no sx, nada liberado.
    let primeiro = true;
    const recursos = ['pessoas.colaborador', 'pessoas.escala'];
    const soPc = fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => {
        if (!primeiro) return [];
        primeiro = false;
        return recursos.map(chave);
      },
      prerequisitosIniciais: () => recursos.map(cumprido),
    });
    const consultados: string[] = [];
    const original = porta.plantoesNaRede.bind(porta);
    porta.plantoesNaRede = (c, v, j, liberado) =>
      original(c, v, j, async (h) => {
        const ok = liberado ? await liberado(h) : true;
        if (ok) consultados.push(h);
        return ok;
      });
    const soNoPc = new ServicoEscala(porta, pessoas, trilha, soPc, null);
    porta.indisponiveis.add('sx');
    const ok = await soNoPc.incluirPlantao(sessao(), pl(escala, enf, '2026-11-11T01:00', '2026-11-11T07:00'));
    expect(consultados).toEqual([]);
    expect(ok.alertas.join(' ')).not.toContain('outros estabelecimentos da Rede');
    expect((await soNoPc.grade(sessao(), escala)).linhas[0]!.plantoes[0]!.redeNaoConferida).toBe(false);
  });
});

describe('publicação e escala publicada (regra 8)', () => {
  it('furo só publica com justificativa; publica uma vez com o evento na outbox; a mudança depois exige motivo', async () => {
    const { servico, porta, enf, escala } = await cenario('enfermagem', { manha: 1, tarde: 0, noite: 0 });
    const s = sessao();
    expect((await recusa(servico.publicar(s, { escala, versao: 0, justificativaFuro: null }))).codigo).toBe(
      'escala-vazia',
    );
    await servico.incluirPlantao(s, pl(escala, enf, '2026-11-02T07:00', '2026-11-02T19:00'));
    const g = await servico.grade(s, escala);
    expect(g.furos).toHaveLength(29);
    expect((await recusa(servico.publicar(s, { escala, versao: 0, justificativaFuro: null }))).codigo).toBe(
      'desatualizado',
    );
    expect((await recusa(servico.publicar(s, { escala, versao: 1, justificativaFuro: null }))).codigo).toBe(
      'furo-sem-justificativa',
    );
    const pub = await servico.publicar(s, {
      escala,
      versao: 1,
      justificativaFuro: 'Contratação em andamento no setor',
    });
    expect(pub.alertas[0]).toContain('29 turno(s)');
    expect(porta.eventosOutbox('pc').map((e) => e.tipo)).toEqual([EVENTO_ESCALA_PUBLICADA]);
    expect(
      (await recusa(servico.publicar(s, { escala, versao: 2, justificativaFuro: 'x'.repeat(12) }))).codigo,
    ).toBe('ja-publicada');
    expect(
      (await recusa(servico.incluirPlantao(s, pl(escala, enf, '2026-11-04T07:00', '2026-11-04T19:00'))))
        .codigo,
    ).toBe('sem-motivo');
    await servico.incluirPlantao(
      s,
      pl(escala, enf, '2026-11-04T07:00', '2026-11-04T19:00', { motivo: 'Cobertura do furo de manhã' }),
    );
    const g2 = await servico.grade(s, escala);
    const p = g2.linhas[0]!.plantoes.find((x) => x.inicio === '2026-11-02T07:00')!;
    expect(
      (await recusa(servico.cancelarPlantao(s, { escala, plantao: p.id, versao: p.versao, motivo: null })))
        .codigo,
    ).toBe('sem-motivo');
    await servico.cancelarPlantao(s, {
      escala,
      plantao: p.id,
      versao: p.versao,
      motivo: 'Atestado médico sintético',
    });
    expect(
      (
        await recusa(
          servico.cancelarPlantao(s, {
            escala,
            plantao: p.id,
            versao: p.versao + 1,
            motivo: 'Outra vez sintético',
          }),
        )
      ).codigo,
    ).toBe('cancelado');
    expect(porta.eventosOutbox('pc').map((e) => e.tipo)).toEqual([
      EVENTO_ESCALA_PUBLICADA,
      EVENTO_ESCALA_ALTERADA,
      EVENTO_ESCALA_ALTERADA,
    ]);
    const g3 = await servico.grade(s, escala);
    expect(g3.eventos.slice(0, 3).map((e) => [e.acao, e.motivo])).toEqual([
      ['cancelado', 'Atestado médico sintético'],
      ['incluido', 'Cobertura do furo de manhã'],
      ['publicada', 'Contratação em andamento no setor'],
    ]);
    expect(
      (
        await recusa(
          servico.alterarCobertura(s, { escala, versao: g3.escala.versao, cobertura, motivo: null }),
        )
      ).codigo,
    ).toBe('sem-motivo');
    await servico.alterarCobertura(s, {
      escala,
      versao: g3.escala.versao,
      cobertura,
      motivo: 'Setor com leitos bloqueados',
    });
  });

  it('conselho que venceu depois da inclusão bloqueia a publicação (regra 3)', async () => {
    const { servico, rh, enf, escala } = await cenario();
    const s = sessao();
    await servico.incluirPlantao(s, pl(escala, enf, '2026-11-20T07:00', '2026-11-20T19:00'));
    await rh.registrarHabilitacao(sessao('pc', 'SINT.RH'), {
      registro: C.escalaEnfermeira.registro,
      validade: '2026-11-10',
      conferidoEm: '2026-10-25',
      observacao: null,
    });
    expect((await recusa(servico.publicar(s, { escala, versao: 1, justificativaFuro: null }))).codigo).toBe(
      'conselho-vencido-na-escala',
    );
  });

  it('alteração: mesmo colaborador, versão do plantão; escala de apoio sem conselho', async () => {
    const { servico, rh, escala: escEnf } = await cenario();
    const nova = await admitir(rh, 'nova');
    const s = sessao();
    expect(
      (await recusa(servico.incluirPlantao(s, pl(escEnf, nova, '2026-11-02T07:00', '2026-11-02T19:00'))))
        .codigo,
    ).toBe('conselho-sem-registro');
    const apoio = (
      await servico.criarEscala(s, {
        unidade: 1,
        setor: 'Posto 2',
        competencia: '2026-11',
        tipo: 'apoio',
        cobertura,
      })
    ).id;
    const id = (await servico.incluirPlantao(s, pl(apoio, nova, '2026-11-02T07:00', '2026-11-02T19:00'))).id;
    await servico.alterarPlantao(s, {
      ...pl(apoio, nova, '2026-11-02T08:00', '2026-11-02T20:00'),
      plantao: id,
      versao: 0,
    });
    expect(
      (
        await recusa(
          servico.alterarPlantao(s, {
            ...pl(apoio, nova, '2026-11-02T08:00', '2026-11-02T20:00'),
            plantao: id,
            versao: 0,
          }),
        )
      ).codigo,
    ).toBe('desatualizado');
    expect(
      (
        await recusa(
          servico.alterarPlantao(s, {
            ...pl(apoio, 1, '2026-11-02T08:00', '2026-11-02T20:00'),
            plantao: id,
            versao: 1,
          }),
        )
      ).codigo,
    ).toBe('troca-de-colaborador');
    expect(
      (
        await recusa(
          servico.alterarPlantao(s, {
            ...pl(apoio, nova, '2026-11-02T08:00', '2026-11-02T20:00'),
            plantao: 9999,
            versao: 1,
          }),
        )
      ).status,
    ).toBe(404);
  });

  it('plantão de dia que já passou não muda; chave desligada deixa a escala em consulta (403)', async () => {
    const { servico, enf } = await cenario();
    const s = sessao();
    const out = (
      await servico.criarEscala(s, {
        unidade: 1,
        setor: '',
        competencia: '2026-10',
        tipo: 'enfermagem',
        cobertura,
      })
    ).id;
    expect(
      (await recusa(servico.incluirPlantao(s, pl(out, enf, '2026-10-24T07:00', '2026-10-24T19:00')))).codigo,
    ).toBe('plantao-no-passado');
    const d = montar(false);
    const r = await recusa(d.servico.incluirRegime(sessao(), regime12x36));
    expect(r.status).toBe(403);
    const apoio = await d.servico.apoioTela(sessao());
    expect(apoio.gravacao.ligada).toBe(false);
    expect(apoio.acoes).toMatchObject({ montar: false, publicar: false, editarRegime: false });
    expect(apoio.temposParciais.find((t) => t.codigo === 1)?.limiteSemanalHoras).toBe(25);
  });

  it('janela de releitura: a semana inteira e 72 h de cada lado', () => {
    expect(janelaDoPlantao({ inicio: '2026-11-04T07:00', fim: '2026-11-04T19:00' })).toEqual({
      de: '2026-11-01T07:00',
      ate: '2026-11-09T00:00',
      inicioDesde: '2026-10-31T07:00',
    });
  });
});
