// Plantão realizado para o repasse (M52.6, fatia F6; ficha, seção 5 "repasse.lancarEvento, cenário origem-plantao" e
// DP-33) sobre a cópia (transação DESFEITA): um prestador sintético (PJ) ligado a um registro profissional ativo da
// cópia, a escala de setembro publicada (gravada direto nas tabelas SGH_, como o passado), a tarifa vigente, o
// realizado registrado pela coordenação, a aprovação recusada para quem registrou (quatro olhos, também no CHECK do
// banco) e aceita para outra pessoa, o valor com as parcelas no relatório ao repasse, um CLT da mesma escala fora do
// repasse, e o lançamento recusado enquanto a chave `pessoas.repassePlantao` está desligada (DP-33). Só IDs e
// contagens em memória.
import { randomBytes } from 'node:crypto';
import {
  type ChaveGravada,
  incluirEscalaPesSgh,
  incluirPlantaoPesSgh,
  incluirVinculoPesSgh,
  type PrerequisitoGravado,
  publicarEscalaPesSgh,
  somenteSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { portaRealizadoNaTransacao } from '../escala/porta-realizado-legado.js';
import { ServicoRealizado } from '../escala/servico-realizado.js';
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
  alteradoEm: '2026-10-26T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-26T10:00:00',
});
const n = (v: unknown) => Number(v ?? 0);

async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'];
}

describe.skipIf(!PODE_ESCREVER)('plantão realizado para o repasse (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('registrar → quatro olhos → aprovar com a tarifa → relatório só do prestador → lançamento desligado', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m526-realizado' }, async (e) => {
      const [reg] = await e.consultar(
        "SELECT FIRST 1 c.ID_TBPROFIS P, c.ID R, c.COD C FROM TBCBOPRO c WHERE c.ATIVO = 'T' AND c.COD > 0 AND c.ID_TBPROFIS > 0 ORDER BY c.ID",
        [],
        { teto: 1 },
      );
      const [cc] = await e.consultar(
        "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
        [],
        { teto: 1 },
      );
      const [un] = await e.consultar('SELECT FIRST 1 COD FROM TBUNIDAD WHERE COD > 0 ORDER BY COD', [], {
        teto: 1,
      });
      const s0 = somenteSgh(e);
      const h = a.c.hospital;
      const cifra = new CifraCpf(randomBytes(32));
      const sufixo = Date.now().toString(36);
      const vinculo = (cpf: string, tipo: 'pj' | 'clt', i: number, comRegistro: boolean) =>
        incluirVinculoPesSgh(s0, {
          hospital: h,
          pessoa: null,
          cpfHmac: cifra.hmac(cpf),
          cpfCifrado: cifra.cifrar(cpf),
          nome: `PLANTONISTA SINTETICO M52.6 ${i}`,
          profissional: comRegistro ? n(reg?.['P']) : null,
          usuario: null,
          tipo,
          matricula: `SR526-${sufixo}-${i}`,
          cargo: 'Plantonista',
          funcao: null,
          cargaSemanal: 24,
          centroCusto: n(cc?.['COD']),
          unidade: n(un?.['COD']),
          setor: null,
          admissao: '2026-01-01',
          por: 'SGH.TESTE',
        });
      const pj = await vinculo('12345678909', 'pj', 1, true);
      const clt = await vinculo('98765432100', 'clt', 2, false);
      const escala = await incluirEscalaPesSgh(s0, {
        hospital: h,
        unidade: n(un?.['COD']),
        setor: `Plantão M52.6 ${sufixo}`,
        competencia: '2026-09',
        tipo: 'apoio',
        cobertura: { manha: 0, tarde: 0, noite: 0 },
        por: 'SGH.TESTE',
      });
      const plantao = (v: { id: number; pessoa: number }, comRegistro: boolean) =>
        incluirPlantaoPesSgh(s0, {
          hospital: h,
          escala,
          vinculo: v.id,
          pessoa: v.pessoa,
          profissional: comRegistro ? n(reg?.['P']) : null,
          registro: comRegistro ? n(reg?.['R']) : null,
          tipo: 'presencial',
          inicio: '2026-09-12T07:00',
          fim: '2026-09-12T19:00',
          chegadaMin: null,
          alertaConselho: null,
          redeNaoConferida: false,
          motivo: null,
          por: 'SGH.TESTE',
        });
      const pPj = await plantao(pj, true);
      const pClt = await plantao(clt, false);
      // Um diarista do mesmo prestador, aprovado antes de existir a tarifa do tipo.
      const pDia = await incluirPlantaoPesSgh(s0, {
        hospital: h,
        escala,
        vinculo: pj.id,
        pessoa: pj.pessoa,
        profissional: n(reg?.['P']),
        registro: n(reg?.['R']),
        tipo: 'diarista',
        inicio: '2026-09-14T07:00',
        fim: '2026-09-14T19:00',
        chegadaMin: null,
        alertaConselho: null,
        redeNaoConferida: false,
        motivo: null,
        por: 'SGH.TESTE',
      });
      await publicarEscalaPesSgh(s0, {
        hospital: h,
        id: escala,
        versao: 0,
        justificativaFuro: null,
        por: 'SGH.TESTE',
      });

      const trilha = new RegistradorTrilhaMemoria();
      const servico = new ServicoRealizado(
        portaRealizadoNaTransacao(e, a.executor),
        portaPessoasNaTransacao(e, a.executor),
        null,
        trilha,
        fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => ['pessoas.plantaoRealizado'].map(chave),
          prerequisitosIniciais: () => ['pessoas.plantaoRealizado'].map(cumprido),
        }),
        null,
      );
      let k = 0;
      const s = (login: string): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-m526-real-${sufixo}-${++k}` },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: h,
        rede: a.c.rede,
        login,
        porta: a.c,
        pode: () => true,
      });
      await servico.incluirTarifa(s('SINT.REPASSE'), {
        tipo: 'presencial',
        unidade: null,
        inicio: '2026-01-01',
        fim: null,
        valorHora: 100,
      });
      const rPj = await servico.registrar(s('SINT.COORD1'), {
        plantao: pPj,
        inicio: '2026-09-12T07:00',
        fim: '2026-09-12T19:30',
        origem: 'informado',
        observacao: null,
      });
      const rClt = await servico.registrar(s('SINT.COORD1'), {
        plantao: pClt,
        inicio: '2026-09-12T07:00',
        fim: '2026-09-12T19:00',
        origem: 'informado',
        observacao: null,
      });
      const versao = async (id: number) =>
        n(
          (
            await e.consultar('SELECT VERSAO FROM SGH_PES_PLANTAO_REALIZADO WHERE ID = ?', [id], { teto: 1 })
          )[0]?.['VERSAO'],
        );
      const quatroOlhos = await codigo(
        servico.decidir(s('SINT.COORD1'), {
          realizado: rPj.id,
          decisao: 'aprovar',
          motivo: null,
          versao: await versao(rPj.id),
        }),
      );
      const aprovado = await servico.decidir(s('SINT.COORD2'), {
        realizado: rPj.id,
        decisao: 'aprovar',
        motivo: null,
        versao: await versao(rPj.id),
      });
      await servico.decidir(s('SINT.COORD2'), {
        realizado: rClt.id,
        decisao: 'aprovar',
        motivo: null,
        versao: await versao(rClt.id),
      });
      const [linha] = await e.consultar(
        'SELECT SITUACAO, MINUTOS, VALOR_HORA, VALOR, DECIDIDO_POR FROM SGH_PES_PLANTAO_REALIZADO WHERE ID = ?',
        [rPj.id],
        { teto: 1 },
      );
      // Aprovado sem tarifa do tipo: sem valor; a tarifa incluída depois dá o valor na mesma transação.
      const rDia = await servico.registrar(s('SINT.COORD1'), {
        plantao: pDia,
        inicio: '2026-09-14T07:00',
        fim: '2026-09-14T19:00',
        origem: 'informado',
        observacao: null,
      });
      const semTarifa = await servico.decidir(s('SINT.COORD2'), {
        realizado: rDia.id,
        decisao: 'aprovar',
        motivo: null,
        versao: await versao(rDia.id),
      });
      const valorDia = async () =>
        (
          await e.consultar('SELECT VALOR FROM SGH_PES_PLANTAO_REALIZADO WHERE ID = ?', [rDia.id], {
            teto: 1,
          })
        )[0]?.['VALOR'] ?? null;
      const diaAntes = await valorDia();
      const tarifaDia = await servico.incluirTarifa(s('SINT.REPASSE'), {
        tipo: 'diarista',
        unidade: null,
        inicio: '2026-01-01',
        fim: null,
        valorHora: 50,
      });
      const diaDepois = n(await valorDia());
      const rel = await servico.relatorio(s('SINT.REPASSE'), '2026-09');
      const grupo = rel.grupos.find((g) => g.realizados.includes(rPj.id)) ?? null;
      const cltNoRepasse = rel.grupos.some((g) => g.realizados.includes(rClt.id));
      const cltFora = rel.foraDoRepasse.some((x) => x.realizado === rClt.id);
      const lancamento = grupo
        ? await codigo(
            servico.lancar(s('SINT.REPASSE'), {
              competencia: '2026-09',
              prestador: grupo.prestador,
              registro: grupo.registro,
              realizados: [...grupo.realizados],
            }),
          )
        : null;
      return {
        prestadorEsperado: n(reg?.['C']),
        quatroOlhos,
        aprovado: aprovado.mensagem,
        situacao: String(linha?.['SITUACAO'] ?? '').trim(),
        minutos: n(linha?.['MINUTOS']),
        valorHora: n(linha?.['VALOR_HORA']),
        valor: n(linha?.['VALOR']),
        decididoPor: String(linha?.['DECIDIDO_POR'] ?? '').trim(),
        grupo: grupo ? { prestador: grupo.prestador, valor: grupo.valor, parcelas: grupo.parcelas } : null,
        cltNoRepasse,
        cltFora,
        repasseLigado: rel.repasse.ligado,
        lancamento,
        semTarifa: semTarifa.mensagem,
        diaAntes,
        tarifaDia: tarifaDia.mensagem,
        diaDepois,
        diaNoGrupo: grupo?.realizados.includes(rDia.id) ?? false,
      };
    });
    expect(r.quatroOlhos).toBe('quatro-olhos');
    expect(r.aprovado).toContain('aprovado');
    expect(r.situacao).toBe('aprovado');
    expect(r.decididoPor).toBe('SINT.COORD2');
    // 07:00 → 19:30 = 750 min = 12,5 h × R$ 100,00/h = R$ 1.250,00.
    expect(r.minutos).toBe(750);
    expect(r.valorHora).toBe(100);
    expect(r.valor).toBe(1250);
    expect(r.grupo?.prestador).toBe(r.prestadorEsperado);
    // O diarista aprovado sem tarifa: sem valor; a tarifa de R$ 50,00/h incluída depois dá 12 h × 50 = R$ 600,00.
    expect(r.semTarifa).toMatch(/sem tarifa vigente/);
    expect(r.diaAntes).toBeNull();
    expect(r.tarifaDia).toMatch(/passaram a ter valor/);
    expect(r.diaDepois).toBe(600);
    expect(r.diaNoGrupo).toBe(true);
    expect(r.grupo?.valor).toBe(1850);
    expect(r.grupo?.parcelas).toMatch(/1\.250,00 \+ R\$ 600,00 = R\$ 1\.850,00/);
    expect(r.cltNoRepasse).toBe(false);
    expect(r.cltFora).toBe(true);
    expect(r.repasseLigado).toBe(false);
    expect(r.lancamento).toBe('repasse-plantao-desligado');
  }, 900_000);
});
