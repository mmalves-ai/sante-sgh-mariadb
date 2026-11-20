// Ponto (M52.4) sobre a cópia (transação DESFEITA; ficha, seções 4, 6 e 8, regras 11 a 14; campo 10 "AFD sintético com
// falhas"): o colaborador sintético com o regime 12x36 e a regra do banco, a escala de setembro publicada (gravada direto
// nas tabelas SGH_, como o passado que a escala não muda), a importação do arquivo do relógio sintético pelo serviço
// (SQL real: hash, NSR, HMAC do CPF; o mesmo arquivo recusado; os cinco sintéticos com defeito em quarentena, sem
// marcação), os ajustes (desconsiderar, justificativa) com a aprovação por outra pessoa, o fechamento com o movimento do
// banco e a SGH_OUTBOX, a ciência de quem não é o colaborador recusada, o AEJ, a reabertura com o estorno, e o tempo da
// apuração do período (p95) e das leituras pelos índices. CPF da lista sintética, HMAC com chave aleatória; só contagens
// e IDs em memória.
import { randomBytes } from 'node:crypto';
import {
  atribuirRegimePesSgh,
  type ChaveGravada,
  incluirEscalaPesSgh,
  incluirPlantaoPesSgh,
  incluirRegimePesSgh,
  incluirVinculoPesSgh,
  marcacoesDaPessoaPesSgh,
  type PrerequisitoGravado,
  publicarEscalaPesSgh,
  somenteSgh,
} from '@sgh/legado';
import { linhaCabecalhoAfd, linhaMarcacaoAfd, linhaTrailerAfd } from '@sgh/dominio-pessoas';
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
import { CifraCpf } from '../cifra-cpf.js';
import { portaEscalaNasTransacoes } from '../escala/porta-escala-legado.js';
import { portaPessoasNaTransacao } from '../porta-legado.js';
import { portaPontoNaTransacao } from '../ponto/porta-ponto-legado.js';
import { ServicoPonto } from '../ponto/servico-ponto.js';

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
const CPF = '12345678909';

async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  return (e as ErroProblema).extras['codigo'];
}

describe.skipIf(!PODE_ESCREVER)('ponto (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('importar → quarentena → ajustes → aprovar → fechar com o banco → AEJ → reabrir com o estorno', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m52-ponto' }, async (e) => {
      const [cc] = await e.consultar(
        "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
        [],
        { teto: 1 },
      );
      const [un] = await e.consultar('SELECT FIRST 1 COD FROM TBUNIDAD WHERE COD > 0 ORDER BY COD', [], {
        teto: 1,
      });
      const [ob0] = await e.consultar('SELECT COALESCE(MAX(ID), 0) M FROM SGH_OUTBOX', [], { teto: 1 });
      const s0 = somenteSgh(e);
      const h = a.c.hospital;
      const cifra = new CifraCpf(randomBytes(32));
      const v = await incluirVinculoPesSgh(s0, {
        hospital: h,
        pessoa: null,
        cpfHmac: cifra.hmac(CPF),
        cpfCifrado: cifra.cifrar(CPF),
        nome: 'COLABORADORA SINTETICA M52.4',
        profissional: null,
        usuario: null,
        tipo: 'clt',
        matricula: `SINT-M52-4-${Date.now().toString(36)}`,
        cargo: 'Técnica de enfermagem',
        funcao: null,
        cargaSemanal: 36,
        centroCusto: n(cc?.['COD']),
        unidade: n(un?.['COD']),
        setor: null,
        admissao: '2026-01-01',
        por: 'SGH.TESTE',
      });
      const regime = await incluirRegimePesSgh(s0, {
        hospital: h,
        codigo: `12x36-${Date.now().toString(36).slice(-5)}`,
        nome: 'Plantão 12 por 36 (sintético)',
        jornada: 2,
        contratoParcial: 0,
        folgaPadrao: null,
        minutosPlantao: 720,
        descansoMinimoMin: 2160,
        limiteSemanalHoras: 48,
        acordo: 'Convenção coletiva sintética',
        ativo: true,
        por: 'SGH.TESTE',
      });
      await atribuirRegimePesSgh(s0, {
        hospital: h,
        vinculo: v.id,
        regime,
        desde: '2026-01-01',
        por: 'SGH.TESTE',
      });
      const escala = await incluirEscalaPesSgh(s0, {
        hospital: h,
        unidade: n(un?.['COD']),
        setor: `Posto M52.4 ${Date.now().toString(36)}`,
        competencia: '2026-09',
        tipo: 'apoio',
        cobertura: { manha: 0, tarde: 0, noite: 0 },
        por: 'SGH.TESTE',
      });
      for (const [inicio, fim] of [
        ['2026-09-02T07:00', '2026-09-02T19:00'],
        ['2026-09-04T07:00', '2026-09-04T19:00'],
        ['2026-09-08T19:00', '2026-09-09T07:00'],
        ['2026-09-10T07:00', '2026-09-10T19:00'],
      ] as const)
        await incluirPlantaoPesSgh(s0, {
          hospital: h,
          escala,
          vinculo: v.id,
          pessoa: v.pessoa,
          profissional: null,
          registro: null,
          tipo: 'presencial',
          inicio,
          fim,
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
      const pessoas = portaPessoasNaTransacao(e, a.executor);
      const porta = portaPontoNaTransacao(e);
      const servico = new ServicoPonto(
        porta,
        pessoas,
        portaEscalaNasTransacoes(new Map([[h, e]])),
        trilha,
        fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => ['pessoas.ponto'].map(chave),
          prerequisitosIniciais: () => ['pessoas.ponto'].map(cumprido),
        }),
        null,
        cifra,
      );
      let k = 0;
      const s = (login = 'SGH.TESTE'): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-m52-ponto-${Date.now().toString(36)}-${++k}` },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: h,
        rede: a.c.rede,
        login,
        porta: a.c,
        pode: () => true,
      });
      await servico.gravarRegraBanco(s(), {
        regime,
        destino: 2,
        inicio: 4,
        desde: '2026-09',
        cicloMeses: 6,
        faltaDebita: false,
        versao: null,
      });

      // Importação pelo serviço: o relógio sintético com número de fabricação único (a cópia pode ter outros).
      const rep = `9${Date.now().toString().slice(-16)}`.slice(0, 17);
      const cab = linhaCabecalhoAfd({
        cnpj: '00000000000191',
        razaoSocial: 'HOSPITAL SINTETICO',
        numeroRep: rep,
        dataInicial: '2026-09-01',
        dataFinal: '2026-09-30',
        geradoEm: '2026-10-01T08:00:00-0300',
      });
      const marcas = [
        '2026-09-02T06:58',
        '2026-09-02T19:03',
        '2026-09-04T07:20',
        '2026-09-04T19:00',
        '2026-09-05T08:00',
        '2026-09-08T19:00',
        '2026-09-09T07:00',
      ];
      const afd = [
        cab,
        ...marcas.map((m, i) => linhaMarcacaoAfd(i + 1, `${m}:00-0300`, CPF)),
        linhaTrailerAfd({ '3': marcas.length }),
      ].join('\r\n');
      const imp = await servico.importarAfd(s('SINT.RH'), {
        nome: 'afd-int.txt',
        tipoRep: 'REP-C',
        modelo: null,
        conteudo: afd,
      });
      const repetido = await codigo(
        servico.importarAfd(s('SINT.RH'), { nome: 'x', tipoRep: 'REP-C', modelo: null, conteudo: afd }),
      );
      // Os cinco defeitos dos arquivos sintéticos de @sgh/testes (a API não depende do pacote de testes: montados aqui).
      const m = (nsr: number, q: string) => linhaMarcacaoAfd(nsr, `${q}:00-0300`, CPF);
      const base = [m(1, '2026-09-15T07:00'), m(2, '2026-09-15T19:00'), m(3, '2026-09-16T07:00')];
      const arq = (ls: string[], k = ls.length) => [cab, ...ls, linhaTrailerAfd({ '3': k })].join('\r\n');
      const defeitos = [
        arq([base[0]!, m(3, '2026-09-15T19:00')]),
        arq([base[0]!, m(1, '2026-09-15T19:00')]),
        arq([base[0]!, `${base[1]!.slice(0, -4)}0000`]),
        arq(base, 4),
        arq([base[0]!, m(2, '2026-09-15T07:00')]),
      ];
      const quarentenas: string[] = [];
      for (const [i, conteudo] of defeitos.entries()) {
        const q = await servico.importarAfd(s('SINT.RH'), {
          nome: `afd-defeito-${i}.txt`,
          tipoRep: 'REP-C',
          modelo: null,
          conteudo,
        });
        quarentenas.push(`${q.situacao}:${q.novas}:${q.falhas.map((f) => f.codigo).join(',')}`);
      }
      // A lista dos arquivos pelo SQL real: a situação, o período coberto e a página (FIRST/SKIP com um a mais).
      const lq0 = await servico.listarArquivos(s('SINT.RH'), {
        situacao: 'quarentena',
        pagina: 0,
        limite: 3,
      });
      const lq1 = await servico.listarArquivos(s('SINT.RH'), {
        situacao: 'quarentena',
        pagina: 1,
        limite: 3,
      });
      const lPer = await servico.listarArquivos(s('SINT.RH'), {
        situacao: 'importado',
        de: '2026-09-01',
        ate: '2026-09-30',
        pagina: 0,
        limite: 20,
      });
      const lFora = await servico.listarArquivos(s('SINT.RH'), {
        situacao: 'todos',
        de: '2099-01-01',
        pagina: 0,
        limite: 20,
      });
      expect(lq0.itens.map((x) => x.situacao)).toEqual(['quarentena', 'quarentena', 'quarentena']);
      expect(lq0.temMais).toBe(true);
      expect(lq1.itens.length).toBeGreaterThanOrEqual(2);
      expect(lq1.itens.some((x) => lq0.itens.some((y) => y.id === x.id))).toBe(false);
      expect(lPer.itens.every((x) => x.situacao === 'importado')).toBe(true);
      expect(lPer.itens.length).toBeGreaterThanOrEqual(1);
      expect(lFora.itens).toEqual([]);
      const [semMarcacao] = await e.consultar(
        `SELECT COUNT(*) N FROM SGH_PES_MARCACAO m JOIN SGH_PES_AFD_ARQUIVO f ON f.ID = m.ID_AFD_ARQUIVO
          WHERE f.HOSPITAL = ? AND f.SITUACAO = 'quarentena'`,
        [h],
        { teto: 1 },
      );

      // Ajustes (o RH lança; outra pessoa aprova; quem pediu não aprova).
      let esp = await servico.espelho(s('SINT.RH'), v.id, '2026-09');
      const solta = esp.dias.find((d) => d.dia === '2026-09-05')!.marcacoes[0]!.id!;
      const a1 = await servico.lancarAjuste(s('SINT.RH'), {
        vinculo: v.id,
        tipo: 'desconsiderar',
        dia: '2026-09-05',
        marcacao: solta,
        instante: null,
        movimento: null,
        justificativa: null,
        periodo: null,
        minutos: null,
        motivo: 'Batida por engano no dia de folga',
      });
      const dominios = await porta.dominios(a.c);
      const atestado =
        dominios.movimentos.find((m) => /atestado/i.test(m.nome))?.codigo ?? dominios.movimentos[0]!.codigo;
      const a2 = await servico.lancarAjuste(s('SINT.RH'), {
        vinculo: v.id,
        tipo: 'justificativa',
        dia: '2026-09-10',
        marcacao: null,
        instante: null,
        movimento: atestado,
        justificativa: null,
        periodo: null,
        minutos: null,
        motivo: 'Atestado apresentado ao RH',
      });
      const autoaprova = await codigo(
        servico.decidirAjuste(s('SINT.RH'), { ajuste: a1.id!, decisao: 'aprovar', motivo: null }),
      );
      await servico.decidirAjuste(s('SINT.PONTO'), { ajuste: a1.id!, decisao: 'aprovar', motivo: null });
      await servico.decidirAjuste(s('SINT.PONTO'), { ajuste: a2.id!, decisao: 'aprovar', motivo: null });

      // A apuração do período: tempo (p95) de 10 leituras do espelho.
      const tempos: number[] = [];
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        esp = await servico.espelho(s('SINT.PONTO'), v.id, '2026-09');
        tempos.push(performance.now() - t0);
      }
      const totais = Object.fromEntries(esp.totais.map((x) => [x.classe, x.minutos]));
      const t1 = performance.now();
      for (let i = 0; i < 10; i++)
        await marcacoesDaPessoaPesSgh(e, h, cifra.hmac(CPF), '2026-08-31T00:00', '2026-10-02T00:00');
      const msMarcacoes = (performance.now() - t1) / 10;

      // Fechamento com o banco e a outbox; a ciência de quem não é o colaborador; o AEJ; a reabertura com o estorno.
      const fechado = await servico.fechar(s('SINT.PONTO'), { vinculo: v.id, competencia: '2026-09' });
      esp = await servico.espelho(s('SINT.PONTO'), v.id, '2026-09');
      const banco = { saldo: esp.banco.saldoFinalMin, debito: esp.banco.debitoMin };
      const ciencia = await codigo(
        servico.ciencia(s('SINT.RH'), {
          vinculo: v.id,
          competencia: '2026-09',
          hash: esp.hash,
          concorda: true,
          observacao: null,
        }),
      );
      const aej = await servico.aej(s('SINT.PONTO'), '2026-09');
      const linhasAej = aej.conteudo.trim().split('\r\n');
      await servico.reabrir(s('SINT.PONTO'), {
        vinculo: v.id,
        competencia: '2026-09',
        motivo: 'Correção pedida pelo colaborador',
      });
      const depois = await servico.espelho(s('SINT.PONTO'), v.id, '2026-09');
      const [ob] = await e.consultar(
        'SELECT TIPO, COUNT(*) N FROM SGH_OUTBOX WHERE ID > ? GROUP BY TIPO ORDER BY TIPO',
        [n(ob0?.['M'])],
        { teto: 20 },
      );
      const outbox = await e.consultar(
        'SELECT TIPO FROM SGH_OUTBOX WHERE ID > ? ORDER BY ID',
        [n(ob0?.['M'])],
        { teto: 20 },
      );
      return {
        importado: `${imp.situacao}:${imp.novas}:${imp.semColaborador}`,
        repetido,
        quarentenas,
        marcacoesEmQuarentena: n(semMarcacao?.['N']),
        autoaprova,
        totais,
        noturno: esp.eventos.find((x) => x.codigo === 5)?.minutos,
        fechado: fechado.id !== null,
        banco,
        ciencia,
        aej: {
          vinculos: aej.vinculos,
          marcacoes: linhasAej.filter((l) => l.startsWith('05|')).length,
          trailer: linhasAej[linhasAej.length - 1]!.slice(0, 3),
        },
        // Aberto de novo: o saldo real (a soma dos movimentos) volta a zero com o estorno; a prévia mostra o refechamento.
        reaberto: `${depois.estado}:${(await porta.saldosBanco(a.c, [v.id])).get(v.id) ?? 0}:${depois.banco.saldoFinalMin}`,
        outbox: outbox.map((x) => String(x['TIPO']).trim()),
        primeiroOutbox: String(ob?.['TIPO'] ?? '').trim(),
        p95EspelhoMs: Math.round(percentil(tempos, 95)),
        msMarcacoes: Math.round(msMarcacoes),
      };
    });
    console.log(JSON.stringify(r));
    expect(r.importado).toBe('importado:7:0');
    expect(r.repetido).toBe('arquivo-ja-importado');
    expect(r.quarentenas).toEqual([
      'quarentena:0:sequencia-quebrada',
      'quarentena:0:nsr-duplicado',
      'quarentena:0:crc',
      'quarentena:0:trailer-divergente',
      'quarentena:0:marcacao-duplicada',
    ]);
    expect(r.marcacoesEmQuarentena).toBe(0);
    expect(r.autoaprova).toBe('aprovador-e-solicitante');
    expect(r.totais).toMatchObject({ 1: 2140, 2: 20, 8: 720 });
    expect(r.noturno).toBe(617);
    expect(r.fechado).toBe(true);
    expect(r.banco).toEqual({ saldo: -20, debito: 20 });
    expect(r.ciencia).toBe('nao-e-o-proprio');
    expect(r.aej).toEqual({ vinculos: 1, marcacoes: 7, trailer: '99|' });
    expect(r.reaberto).toBe('aberto:0:-20');
    expect(r.outbox).toEqual(['PESSOAS_AFD_IMPORTADO', 'PESSOAS_PONTO_FECHADO', 'PESSOAS_PONTO_REABERTO']);
    expect(r.p95EspelhoMs).toBeLessThan(2000);
  }, 900_000);
});
