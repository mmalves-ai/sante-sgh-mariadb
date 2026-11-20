// W0-06 (programa CRUD completo): exclusão do rascunho e cancelamento da escala publicada, anulação da vigência do
// regime, desistência do ajuste de ponto e situação da regra do banco, sobre as portas EM MEMÓRIA (dados SINTÉTICOS;
// nada conecta a banco). Recusa de órfão (D-CRUD-ORFAOS): escala em rascunho com troca ou realizado ligado devolve 409
// com a contagem; vigência usada em ponto fechado recusa; só o solicitante desiste do ajuste.
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { EVENTO_ESCALA_ALTERADA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import { PortaPontoMemoria } from '../ponto/porta-ponto-memoria.js';
import { ServicoPessoas } from '../servico.js';
import { PortaEscalaMemoria } from './porta-escala-memoria.js';
import { ServicoEscala } from './servico-escala.js';

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

function montar() {
  const pessoas = new PortaPessoasMemoria();
  pessoas.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const recursos = ['pessoas.colaborador', 'pessoas.escala', 'pessoas.ponto'];
  const config = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => recursos.map(chave),
    prerequisitosIniciais: () => recursos.map(cumprido),
  });
  const rh = new ServicoPessoas(pessoas, trilha, config, null, new CifraCpf(Buffer.alloc(32, 7)));
  const porta = new PortaEscalaMemoria(pessoas);
  const ponto = new PortaPontoMemoria(pessoas);
  const servico = new ServicoEscala(porta, pessoas, trilha, config, null, ponto);
  return { pessoas, porta, ponto, rh, servico, trilha };
}

let k = 0;
function sessao(login = 'SINT.ESCALA'): SessaoCadastro {
  return {
    req: {
      headers: { 'idempotency-key': `w006-escala-${++k}` },
      ip: '127.0.0.1',
      sgh: { sessao: { unidadeAtiva: null } },
    } as never,
    hospital: 'pc',
    rede: 'rede-sintetica',
    login,
    porta: { rede: 'rede-sintetica', hospital: 'pc' },
    pode: () => true,
  };
}

async function admitir(rh: ServicoPessoas) {
  return (
    await rh.admitir(sessao('SINT.RH'), {
      cpf: C.nova.cpf,
      nome: 'PESSOA NOVA SINTETICA',
      profissional: null,
      tipo: 'clt',
      admissao: '2026-10-01',
      cargo: 'Auxiliar administrativo',
      funcao: null,
      cargaSemanalHoras: 36,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 2' },
      matricula: null,
      usuario: null,
    })
  ).id;
}

async function recusa(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  const x = e as ErroProblema;
  return {
    status: x.getStatus(),
    codigo: x.extras['codigo'],
    detalhe: x.detalhe ?? '',
    bloqueios: x.extras.bloqueios ?? [],
  };
}

const MOTIVO = 'Escala criada no setor errado por engano';

async function cenario() {
  const m = montar();
  const v = await admitir(m.rh);
  const escala = (
    await m.servico.criarEscala(sessao(), {
      unidade: 1,
      setor: 'Posto 2',
      competencia: '2026-11',
      tipo: 'apoio',
      cobertura: { manha: 0, tarde: 0, noite: 0 },
    })
  ).id;
  const plantao = (
    await m.servico.incluirPlantao(sessao(), {
      escala,
      vinculo: v,
      tipo: 'presencial',
      inicio: '2026-11-03T07:00',
      fim: '2026-11-03T19:00',
      chegadaMin: null,
      motivo: null,
    })
  ).id;
  return { ...m, v, escala, plantao };
}

const versao = async (m: { servico: ServicoEscala }, escala: number) =>
  (await m.servico.grade(sessao(), escala)).escala.versao;

describe('escala em rascunho: exclusão física só sem vínculo, com retrato (W0-06)', () => {
  it('sem vínculo: apaga a escala, os plantões e a trilha da escala, com o retrato de cada linha', async () => {
    const m = await cenario();
    const r = await m.servico.excluirEscala(sessao(), {
      escala: m.escala,
      versao: await versao(m, m.escala),
      motivo: MOTIVO,
    });
    expect(r.mensagem).toContain('1 plantão');
    expect((await recusa(m.servico.grade(sessao(), m.escala))).status).toBe(404);
    const fotos = m.porta.retratosDe('pc');
    expect(fotos.map((f) => f.tabela).sort()).toEqual(
      ['SGH_PES_ESCALA', 'SGH_PES_ESCALA_EVENTO', 'SGH_PES_ESCALA_EVENTO', 'SGH_PES_PLANTAO'].sort(),
    );
    expect(new Set(fotos.map((f) => f.motivo))).toEqual(new Set([MOTIVO]));
    expect(m.trilha.eventos.some((l) => l.evento === 'pessoas.escala.excluida')).toBe(true);
  });

  it('com troca ou realizado ligado ao plantão: 409 com a contagem por grupo; nada apagado', async () => {
    const m = await cenario();
    m.porta.semearTroca('pc', m.plantao);
    m.porta.realizadosDosPlantoes = (_h, ids) => (ids.includes(m.plantao) ? 2 : 0);
    const r = await recusa(
      m.servico.excluirEscala(sessao(), {
        escala: m.escala,
        versao: await versao(m, m.escala),
        motivo: MOTIVO,
      }),
    );
    expect(r).toMatchObject({ status: 409, codigo: 'escala-com-vinculos' });
    expect(r.bloqueios).toEqual(['Trocas de plantão: 1', 'Plantões realizados: 2']);
    expect(r.detalhe).toContain('3 registro(s) ligado(s)');
    expect((await m.servico.grade(sessao(), m.escala)).escala.estado).toBe('rascunho');
    expect(m.porta.retratosDe('pc')).toHaveLength(0);
  });

  it('a publicada não se exclui (cancela-se); versão velha: desatualizado; motivo curto: 400 do esquema', async () => {
    const m = await cenario();
    const v0 = await versao(m, m.escala);
    await m.servico.incluirPlantao(sessao(), {
      escala: m.escala,
      vinculo: m.v,
      tipo: 'presencial',
      inicio: '2026-11-05T07:00',
      fim: '2026-11-05T19:00',
      chegadaMin: null,
      motivo: null,
    });
    expect(
      (await recusa(m.servico.excluirEscala(sessao(), { escala: m.escala, versao: v0, motivo: MOTIVO })))
        .codigo,
    ).toBe('desatualizado');
    await m.servico.publicar(sessao(), {
      escala: m.escala,
      versao: await versao(m, m.escala),
      justificativaFuro: null,
    });
    expect(
      (
        await recusa(
          m.servico.excluirEscala(sessao(), {
            escala: m.escala,
            versao: await versao(m, m.escala),
            motivo: MOTIVO,
          }),
        )
      ).codigo,
    ).toBe('escala-publicada');
  });
});

describe('escala publicada: cancelamento lógico com motivo (W0-06)', () => {
  it('cancela com motivo: estado, plantões cancelados, trilha da escala e evento de mudança na outbox', async () => {
    const m = await cenario();
    await m.servico.publicar(sessao(), {
      escala: m.escala,
      versao: await versao(m, m.escala),
      justificativaFuro: null,
    });
    const motivo = 'Setor fechado para reforma até dezembro';
    const r = await m.servico.cancelarEscala(sessao(), {
      escala: m.escala,
      versao: await versao(m, m.escala),
      motivo,
    });
    expect(r.mensagem).toBe('Escala cancelada: 1 plantão(ões) previstos cancelados.');
    const g = await m.servico.grade(sessao(), m.escala);
    expect(g.escala.estado).toBe('cancelada');
    expect(g.escala.cancelamento).toMatchObject({ por: 'SINT.ESCALA', motivo });
    expect(g.eventos[0]).toMatchObject({ acao: 'cancelada', motivo });
    expect(
      (
        await recusa(
          m.servico.cancelarEscala(sessao(), { escala: m.escala, versao: g.escala.versao, motivo }),
        )
      ).codigo,
    ).toBe('escala-cancelada');
    expect(m.trilha.eventos.some((l) => l.evento === 'pessoas.escala.cancelada')).toBe(true);
    // A outbox recebe a mudança (a F3 e o aviso aos escalados consomem).
    const outbox = (
      m.porta as unknown as { estados: Map<string, { outbox: { tipo: string; chave: string }[] }> }
    ).estados.get('pc')!.outbox;
    expect(outbox.some((o) => o.tipo === EVENTO_ESCALA_ALTERADA && o.chave.includes(':cancelada:'))).toBe(
      true,
    );
  });

  it('com troca em aberto ou realizado: 409 com as pendências; rascunho não se cancela', async () => {
    const m = await cenario();
    expect(
      (
        await recusa(
          m.servico.cancelarEscala(sessao(), {
            escala: m.escala,
            versao: await versao(m, m.escala),
            motivo: MOTIVO,
          }),
        )
      ).codigo,
    ).toBe('escala-rascunho');
    await m.servico.publicar(sessao(), {
      escala: m.escala,
      versao: await versao(m, m.escala),
      justificativaFuro: null,
    });
    m.porta.semearTroca('pc', m.plantao);
    m.porta.realizadosDosPlantoes = () => 1;
    const r = await recusa(
      m.servico.cancelarEscala(sessao(), {
        escala: m.escala,
        versao: await versao(m, m.escala),
        motivo: MOTIVO,
      }),
    );
    expect(r).toMatchObject({ status: 409, codigo: 'escala-com-pendencias' });
    expect(r.bloqueios).toEqual(['Trocas de plantão em aberto: 1', 'Plantões realizados: 1']);
  });
});

describe('vigência do regime: anulação com motivo (W0-06)', () => {
  const regime = {
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

  it('anula a lançada por engano: sai do cálculo, fica no histórico, e a certa entra na mesma data', async () => {
    const m = montar();
    const v = await admitir(m.rh);
    const r1 = (await m.servico.incluirRegime(sessao(), regime)).id;
    const r2 = (await m.servico.incluirRegime(sessao(), { ...regime, codigo: 'DIA', nome: 'Diarista' })).id;
    const errada = (await m.servico.atribuirRegime(sessao(), { vinculo: v, regime: r1, desde: '2026-10-01' }))
      .id;
    await m.servico.anularVigencia(sessao(), {
      vigencia: errada,
      motivo: 'Regime lançado no colaborador errado',
    });
    expect(await m.porta.vigencias({ rede: 'rede-sintetica', hospital: 'pc' }, [v])).toEqual([]);
    await m.servico.atribuirRegime(sessao(), { vinculo: v, regime: r2, desde: '2026-10-01' });
    const hist = await m.servico.vigencias(sessao(), v);
    expect(hist.map((x) => [x.codigo, x.anulada?.motivo ?? null])).toEqual([
      ['12x36', 'Regime lançado no colaborador errado'],
      ['DIA', null],
    ]);
    expect(
      (await recusa(m.servico.anularVigencia(sessao(), { vigencia: errada, motivo: 'De novo, por engano' })))
        .codigo,
    ).toBe('ja-anulada');
    expect(
      (await recusa(m.servico.anularVigencia(sessao(), { vigencia: 99999, motivo: 'Vigência inexistente' })))
        .status,
    ).toBe(404);
  });

  it('revisão W0-06: o fechamento gravado entre a leitura e a anulação é recontado na transação (409)', async () => {
    const m = montar();
    const v = await admitir(m.rh);
    const r1 = (await m.servico.incluirRegime(sessao(), regime)).id;
    const vig = (await m.servico.atribuirRegime(sessao(), { vinculo: v, regime: r1, desde: '2026-10-01' }))
      .id;
    const ctx = { rede: 'rede-sintetica', hospital: 'pc' };
    // O fechamento do ponto entra logo antes de a transação da anulação abrir (depois das leituras do serviço).
    const original = m.porta.gravarSgh.bind(m.porta);
    let primeira = true;
    m.porta.gravarSgh = (async (...args: Parameters<typeof original>) => {
      if (primeira) {
        primeira = false;
        await m.ponto.gravarSgh(
          ctx,
          () => ({}) as never,
          (g) =>
            g.incluirEventoPeriodo({
              vinculo: v,
              competencia: '2026-10',
              acao: 'fechado',
              ref: null,
              hash: 'b'.repeat(64),
              totais: '{}',
              concorda: null,
              texto: null,
              por: 'SINT.PONTO',
            }),
        );
      }
      return original(...args);
    }) as typeof original;
    const r = await recusa(
      m.servico.anularVigencia(sessao(), { vigencia: vig, motivo: 'Regime lançado no colaborador errado' }),
    );
    expect(r).toMatchObject({ status: 409, codigo: 'vigencia-em-ponto-fechado' });
    expect((await m.servico.vigencias(sessao(), v)).map((x) => x.anulada)).toEqual([null]);
  });

  it('vigência usada em ponto FECHADO: recusa com o período; reaberto, anula', async () => {
    const m = montar();
    const v = await admitir(m.rh);
    const r1 = (await m.servico.incluirRegime(sessao(), regime)).id;
    const vig = (await m.servico.atribuirRegime(sessao(), { vinculo: v, regime: r1, desde: '2026-10-01' }))
      .id;
    const ctx = { rede: 'rede-sintetica', hospital: 'pc' };
    const fechado = await m.ponto.gravarSgh(
      ctx,
      () => ({}) as never,
      (g) =>
        g.incluirEventoPeriodo({
          vinculo: v,
          competencia: '2026-10',
          acao: 'fechado',
          ref: null,
          hash: 'a'.repeat(64),
          totais: '{}',
          concorda: null,
          texto: null,
          por: 'SINT.PONTO',
        }),
    );
    const r = await recusa(
      m.servico.anularVigencia(sessao(), { vigencia: vig, motivo: 'Regime lançado no colaborador errado' }),
    );
    expect(r).toMatchObject({ status: 409, codigo: 'vigencia-em-ponto-fechado' });
    expect(r.bloqueios).toEqual(['Período de ponto fechado: 2026-10']);
    await m.ponto.gravarSgh(
      ctx,
      () => ({}) as never,
      (g) =>
        g.incluirEventoPeriodo({
          vinculo: v,
          competencia: '2026-10',
          acao: 'reaberto',
          ref: fechado,
          hash: null,
          totais: null,
          concorda: null,
          texto: 'Reaberto para corrigir o regime',
          por: 'SINT.PONTO',
        }),
    );
    await m.servico.anularVigencia(sessao(), {
      vigencia: vig,
      motivo: 'Regime lançado no colaborador errado',
    });
    expect((await m.servico.vigencias(sessao(), v))[0]!.anulada).not.toBeNull();
  });
});
