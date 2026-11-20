// Escala de plantão (M52.2) sobre a cópia (transação DESFEITA; ficha, seções 4, 6 e 8): o regime de tempo parcial e a
// vigência, a escala do setor na competência seguinte, os plantões com as recusas em SQL real (interjornada de 10 h
// 59 min, limite do contrato de 25 h, sobreposição da mesma pessoa), o conselho vencido no dia de um profissional da
// cópia (só o ID, em memória; a validade conferida é sintética), a publicação com a justificativa do furo e a mudança
// depois só com motivo (a trilha da escala e a SGH_OUTBOX na mesma transação), e o tempo das leituras da grade e da
// pessoa (p95); e a correção 0985 (dois colaboradores sem matrícula no estabelecimento). Vínculos sintéticos (CPF só como HMAC de mentira); só contagens e IDs em memória.
import {
  type ChaveGravada,
  gravarHabilitacaoPesSgh,
  incluirVinculoPesSgh,
  plantoesDaPessoaPesSgh,
  type PrerequisitoGravado,
  somenteSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import {
  type AmbienteM27,
  ambienteM27,
  PODE_ESCREVER,
  percentil,
} from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { portaEscalaNasTransacoes } from '../escala/porta-escala-legado.js';
import { ServicoEscala } from '../escala/servico-escala.js';
import { portaPessoasNaTransacao } from '../porta-legado.js';

const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-25T10:00:00',
});
const n = (v: unknown) => Number(v ?? 0);
const p2 = (x: number) => String(x).padStart(2, '0');

async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'];
}

describe.skipIf(!PODE_ESCREVER)('escala de plantão (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('regime → escala → plantões com as recusas → publicação com furo → mudança só com motivo', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m52-escala' }, async (e) => {
      const [cc] = await e.consultar(
        "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
        [],
        { teto: 1 },
      );
      const [un] = await e.consultar('SELECT FIRST 1 COD FROM TBUNIDAD WHERE COD > 0 ORDER BY COD', [], {
        teto: 1,
      });
      const [prof] = await e.consultar(
        "SELECT FIRST 1 c.ID_TBPROFIS P, c.ID R FROM TBCBOPRO c WHERE c.CONS_PROF = 'COREN' AND c.ATIVO = 'T' AND c.COD > 0 ORDER BY c.ID",
        [],
        { teto: 1 },
      );
      const unidade = n(un?.['COD']);
      const [ob0] = await e.consultar('SELECT COALESCE(MAX(ID), 0) M FROM SGH_OUTBOX', [], { teto: 1 });
      const s0 = somenteSgh(e);
      const vinculo = (pessoaHmac: string, profissional: number | null, matricula: string | null = null) =>
        incluirVinculoPesSgh(s0, {
          hospital: a.c.hospital,
          pessoa: null,
          cpfHmac: pessoaHmac,
          cpfCifrado: 'v1.sintetico',
          nome: profissional ? 'ENFERMEIRA SINTETICA M52.2' : 'APOIO SINTETICO M52.2',
          profissional,
          usuario: null,
          tipo: 'clt',
          matricula,
          cargo: profissional ? 'Enfermeira' : 'Maqueiro',
          funcao: null,
          cargaSemanal: 36,
          centroCusto: n(cc?.['COD']),
          unidade,
          setor: null,
          admissao: '2026-01-01',
          por: 'SGH.TESTE',
        });
      const apoio = await vinculo('e'.repeat(64), null);
      // Diagnóstico: a matrícula vazia fica NULL e a segunda sem matrícula não colide (chave única com NULL).
      const [mn] = await e.consultar(
        'SELECT COUNT(*) N FROM SGH_PES_VINCULO WHERE ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT) AND MATRICULA IS NULL',
        [String(apoio.id)],
        { teto: 1 },
      );
      const segundaSemMatricula = await vinculo('c'.repeat(64), null).then(
        () => 'ok',
        (x: unknown) => String((x as { problema?: { codigo?: string } }).problema?.codigo ?? x),
      );
      const enf = await vinculo('d'.repeat(64), n(prof?.['P']), 'SINT-M52-2-E');

      const trilha = new RegistradorTrilhaMemoria();
      const pessoas = portaPessoasNaTransacao(e, a.executor);
      const servico = new ServicoEscala(
        portaEscalaNasTransacoes(new Map([[a.c.hospital, e]])),
        pessoas,
        trilha,
        fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => ['pessoas.escala'].map(chave),
          prerequisitosIniciais: () => ['pessoas.escala'].map(cumprido),
        }),
        null,
      );
      let k = 0;
      const s = (): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-m52-esc-${Date.now().toString(36)}-${++k}` },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: a.c.hospital,
        rede: a.c.rede,
        login: 'SGH.TESTE',
        porta: a.c,
        pode: () => true,
      });
      const hoje = await pessoas.hoje(a.c);
      const [ano, mes] = hoje.split('-').map(Number) as [number, number];
      const comp = mes === 12 ? `${ano + 1}-01` : `${ano}-${p2(mes + 1)}`;
      // A primeira segunda-feira da competência seguinte.
      let d1 = 1;
      while (new Date(Date.UTC(Number(comp.slice(0, 4)), Number(comp.slice(5, 7)) - 1, d1)).getUTCDay() !== 1)
        d1++;
      const dia = (k2: number) => `${comp}-${p2(d1 + k2)}`;
      const pl = (
        escala: number,
        v: number,
        ini: string,
        fim: string,
        extra: Record<string, unknown> = {},
      ) => ({
        escala,
        vinculo: v.valueOf(),
        tipo: 'presencial' as const,
        inicio: ini,
        fim,
        chegadaMin: null,
        motivo: null,
        ...extra,
      });

      const regime = (
        await servico.incluirRegime(s(), {
          codigo: 'SINT-P25',
          nome: 'Tempo parcial sintético',
          jornada: 1,
          contratoParcial: 1,
          folgaPadrao: null,
          minutosPlantao: 720,
          descansoMinimoMin: 660,
          limiteSemanalHoras: 44,
          acordo: null,
          ativo: true,
        })
      ).id;
      await servico.atribuirRegime(s(), { vinculo: apoio.id, regime, desde: '2026-01-01' });
      const escApoio = (
        await servico.criarEscala(s(), {
          unidade,
          setor: 'SINT M52.2',
          competencia: comp,
          tipo: 'apoio',
          cobertura: { manha: 1, tarde: 0, noite: 0 },
        })
      ).id;
      const ok1 = await servico.incluirPlantao(
        s(),
        pl(escApoio, apoio.id, `${dia(0)}T07:00`, `${dia(0)}T19:00`),
      );
      const inter = await codigo(
        servico.incluirPlantao(s(), pl(escApoio, apoio.id, `${dia(1)}T05:59`, `${dia(1)}T11:59`)),
      );
      await servico.incluirPlantao(s(), pl(escApoio, apoio.id, `${dia(2)}T07:00`, `${dia(2)}T19:00`));
      const limite = await codigo(
        servico.incluirPlantao(s(), pl(escApoio, apoio.id, `${dia(4)}T07:00`, `${dia(4)}T19:00`)),
      );
      const sobre = await codigo(
        servico.incluirPlantao(
          s(),
          pl(escApoio, apoio.id, `${dia(2)}T18:00`, `${dia(2)}T22:00`, {
            tipo: 'sobreaviso',
            chegadaMin: 30,
          }),
        ),
      );

      // Regra 3 com um registro COREN da cópia: a validade conferida sintética vence antes do plantão.
      const escEnf = (
        await servico.criarEscala(s(), {
          unidade,
          setor: 'SINT M52.2',
          competencia: comp,
          tipo: 'enfermagem',
          cobertura: { manha: 0, tarde: 0, noite: 0 },
        })
      ).id;
      const reg = await pessoas.registroConselho(a.c, n(prof?.['R']));
      await gravarHabilitacaoPesSgh(s0, {
        hospital: a.c.hospital,
        registro: n(prof?.['R']),
        numero: reg?.numero ?? null,
        conselho: reg?.conselho ?? null,
        validade: dia(5),
        conferidoEm: hoje,
        observacao: null,
        por: 'SGH.TESTE',
      });
      const conselho = await codigo(
        servico.incluirPlantao(s(), pl(escEnf, enf.id, `${dia(7)}T07:00`, `${dia(7)}T19:00`)),
      );
      const aVencer = await servico.incluirPlantao(
        s(),
        pl(escEnf, enf.id, `${dia(4)}T07:00`, `${dia(4)}T19:00`),
      );

      // Grade, publicação com furo e mudança depois.
      const tempos: number[] = [];
      let g = await servico.grade(s(), escApoio);
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        g = await servico.grade(s(), escApoio);
        tempos.push(performance.now() - t0);
      }
      const temposPessoa: number[] = [];
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        await plantoesDaPessoaPesSgh(e, a.c.hospital, apoio.pessoa, {
          de: `${dia(0)}T00:00`,
          ate: `${dia(7)}T00:00`,
          inicioDesde: `${dia(0)}T00:00`,
        });
        temposPessoa.push(performance.now() - t0);
      }
      const semJustificativa = await codigo(
        servico.publicar(s(), { escala: escApoio, versao: g.escala.versao, justificativaFuro: null }),
      );
      await servico.publicar(s(), {
        escala: escApoio,
        versao: g.escala.versao,
        justificativaFuro: 'Integração sintética com turnos sem cobertura',
      });
      const semMotivo = await codigo(
        servico.incluirPlantao(s(), pl(escApoio, apoio.id, `${dia(7)}T07:00`, `${dia(7)}T19:00`)),
      );
      await servico.incluirPlantao(
        s(),
        pl(escApoio, apoio.id, `${dia(7)}T07:00`, `${dia(7)}T19:00`, {
          motivo: 'Cobertura sintética da semana',
        }),
      );
      const g2 = await servico.grade(s(), escApoio);
      const [ob] = await e.consultar(
        "SELECT COUNT(*) N FROM SGH_OUTBOX WHERE TIPO IN ('PESSOAS_ESCALA_PUBLICADA', 'PESSOAS_ESCALA_ALTERADA') AND ID > CAST(CAST(? AS VARCHAR(20)) AS BIGINT)",
        [String(ob0?.['M'] ?? '0')],
        { teto: 1 },
      );
      return {
        matriculaNula: n(mn?.['N']),
        segundaSemMatricula,
        alertaApoio: ok1.alertas.length,
        inter,
        limite,
        sobre,
        conselho,
        aVencer: aVencer.alertas.length > 0,
        furos: g.furos.length > 0,
        semJustificativa,
        semMotivo,
        estado: g2.escala.estado,
        plantoes: g2.escala.plantoes,
        eventos: g2.eventos.map((x) => x.acao),
        outbox: n(ob?.['N']),
        p95GradeMs: Math.round(percentil(tempos, 95)),
        p95PessoaMs: Math.round(percentil(temposPessoa, 95)),
      };
    });
    console.log(JSON.stringify(r));
    expect(r).toMatchObject({
      // Correção 0985: a matrícula vazia fica NULL e o segundo colaborador sem matrícula entra.
      matriculaNula: 1,
      segundaSemMatricula: 'ok',
      alertaApoio: 0,
      inter: 'interjornada',
      limite: 'limite-do-contrato',
      sobre: 'sobreposicao',
      conselho: 'conselho-vencido',
      aVencer: true,
      furos: true,
      semJustificativa: 'furo-sem-justificativa',
      semMotivo: 'sem-motivo',
      estado: 'publicada',
      plantoes: 3,
      outbox: 2,
    });
    expect(r.eventos.slice(0, 2)).toEqual(['incluido', 'publicada']);
    expect(r.p95GradeMs).toBeLessThan(500);
    expect(r.p95PessoaMs).toBeLessThan(300);
  });
});
