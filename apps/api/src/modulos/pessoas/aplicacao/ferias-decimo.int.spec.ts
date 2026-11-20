// Férias e 13º (M53.4, fatia F3; ficha do M53, seções 4 a 8) sobre a cópia (transação DESFEITA): um colaborador
// sintético (CLT, admitido em 2025) com os parâmetros da empresa (rubricas reais escolhidas pelo tipo) e o salário; o
// saldo dos períodos, a programação (SGH_PES_FERIAS, com os CHECKs do 0537), o recibo gravado (processamento `ferias`
// do 0536, com tipo e pagamento) relido, as férias da competência para a folha mensal, o cancelamento com o recibo
// descartado junto, a 1ª parcela do 13º e a parcela final (relógio de dezembro) com o desconto do adiantamento. A tabela
// legal de 2026 é sintética (as do banco param em 2023 na cópia). As contagens das tabelas do outro sistema que a folha
// poderia tocar ficam iguais antes e depois. A trava no colaborador: com um vínculo já gravado e sem férias, outra
// transação sem espera é recusada (`desatualizado`). Só IDs, contagens e somas em memória; o CPF é sintético.
import { randomBytes } from 'node:crypto';
import {
  type ChaveGravada,
  feriasDoVinculoComTravaPesSgh,
  incluirVinculoPesSgh,
  type PrerequisitoGravado,
  somenteSgh,
} from '@sgh/legado';
import {
  PAPEIS_CALCULO_FOLHA,
  type ParametrosFolha,
  TIPO_DO_PAPEL,
  type TabelaLegalFolha,
} from '@sgh/contratos';
import { rubricaServeAoPapel } from '@sgh/dominio-pessoas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { portaRealizadoNaTransacao } from '../escala/porta-realizado-legado.js';
import { portaCalculoFolhaNaTransacao } from '../folha/porta-calculo-legado.js';
import { portaFolhaNaTransacao } from '../folha/porta-folha-legado.js';
import { htmlReciboFerias } from '../folha/documentos-calculo.js';
import { ServicoCalculoFolha } from '../folha/servico-calculo.js';
import { ServicoFeriasFolha } from '../folha/servico-ferias.js';
import { portaPontoNaTransacao } from '../ponto/porta-ponto-legado.js';
import { portaPessoasNaTransacao } from '../porta-legado.js';
import { portaRubricasNaTransacao } from '../rubricas/porta-rubricas-legado.js';

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
  alteradoEm: '2026-10-27T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-27T10:00:00',
});
const n = (v: unknown) => Number(v ?? 0);
const LEGADAS = ['FPFUNC', 'FPCABECFOLHA', 'FPFICHAF', 'FPESOCPEND', 'MFCONPAG'] as const;
/** CPF sintético com dígitos válidos (não é de pessoa real). */
const CPF = '52998224725';

/** Tabela legal sintética de 2026 (valores de teste no formato da lei; a conferência da tabela passa). */
const TABELA_2026: TabelaLegalFolha = {
  inicio: '2026-01-01',
  irrf: {
    faixas: [
      { de: 0, ate: 242_880, aliquota: 0, deducao: 0 },
      { de: 242_881, ate: 282_665, aliquota: 750, deducao: 18_216 },
      { de: 282_666, ate: 375_105, aliquota: 1500, deducao: 39_416 },
      { de: 375_106, ate: 466_468, aliquota: 2250, deducao: 67_549 },
      { de: 466_469, ate: null, aliquota: 2750, deducao: 90_873 },
    ],
    deducaoDependente: 18_959,
    descontoSimplificado: 60_720,
    reducao: {
      isencaoAte: 500_000,
      reducaoDe: 500_001,
      reducaoAte: 735_000,
      valor: 31_289,
      semReducaoAcimaDe: 735_000,
    },
  },
  inss: {
    faixas: [
      { de: 0, ate: 162_100, aliquota: 750, deducao: 0 },
      { de: 162_101, ate: 290_284, aliquota: 900, deducao: 0 },
      { de: 290_285, ate: 435_427, aliquota: 1200, deducao: 0 },
      { de: 435_428, ate: 847_555, aliquota: 1400, deducao: 0 },
    ],
    teto: 847_555,
  },
  salarioFamilia: [{ de: 0, ate: 198_000, cota: 6_700 }],
  salarioMinimo: 162_100,
  contribuinteIndividual: { aliquota: 2000, teto: 847_555 },
};

describe.skipIf(!PODE_ESCREVER)('férias e 13º (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('saldo → programação → recibo gravado e relido → cancelamento → 13º 1ª parcela e final; outro sistema intacto', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m534-ferias' }, async (e) => {
      const contar = async () => {
        const out: Record<string, number> = {};
        for (const t of LEGADAS)
          out[t] = n((await e.consultar(`SELECT COUNT(*) Q FROM ${t}`, [], { teto: 1 }))[0]?.['Q']);
        return out;
      };
      const antes = await contar();
      const [cc] = await e.consultar(
        "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
        [],
        { teto: 1 },
      );
      const h = a.c.hospital;
      const s0 = somenteSgh(e);
      const cifra = new CifraCpf(randomBytes(32));
      const sufixo = Date.now().toString(36);
      const v = await incluirVinculoPesSgh(s0, {
        hospital: h,
        pessoa: null,
        cpfHmac: cifra.hmac(CPF),
        cpfCifrado: cifra.cifrar(CPF),
        nome: 'COLABORADOR SINTETICO M53.4',
        profissional: null,
        usuario: null,
        tipo: 'clt',
        matricula: `SF534-${sufixo}`,
        cargo: 'Auxiliar administrativo',
        funcao: null,
        cargaSemanal: 44,
        centroCusto: n(cc?.['COD']),
        unidade: null,
        setor: null,
        admissao: '2025-01-05',
        por: 'SGH.TESTE',
      });

      const real = portaCalculoFolhaNaTransacao(e);
      const porta = new Proxy(real, {
        get(alvo, prop) {
          const x: unknown = Reflect.get(alvo, prop);
          if (prop !== 'vinculos')
            return typeof x === 'function' ? (x as (...a: unknown[]) => unknown).bind(alvo) : x;
          return async (...args: Parameters<typeof real.vinculos>) =>
            (await alvo.vinculos(...args)).filter((y) => y.id === v.id);
        },
      });
      const rubReal = portaRubricasNaTransacao(e);
      const rubricas = new Proxy(rubReal, {
        get(alvo, prop) {
          const x: unknown = Reflect.get(alvo, prop);
          if (prop !== 'tabelasLegais')
            return typeof x === 'function' ? (x as (...a: unknown[]) => unknown).bind(alvo) : x;
          return async (...args: Parameters<typeof rubReal.tabelasLegais>) => {
            const ts = await alvo.tabelasLegais(...args);
            return [...ts.filter((t) => t.inicio !== TABELA_2026.inicio), TABELA_2026];
          };
        },
      });
      const folha = portaFolhaNaTransacao(e);
      // A parcela final do 13º só calcula a partir de dezembro: um relógio de dezembro para ela.
      const folhaDezembro = new Proxy(folha, {
        get(alvo, prop) {
          const x: unknown = Reflect.get(alvo, prop);
          if (prop !== 'relogio')
            return typeof x === 'function' ? (x as (...a: unknown[]) => unknown).bind(alvo) : x;
          return async () => ({ hoje: '2026-12-10', agora: '2026-12-10T10:00:00' });
        },
      });
      const ctx = { rede: a.c.rede, hospital: h };
      const empresa = (await folha.empresas(ctx))[0]!.codigo;
      const trilha = new RegistradorTrilhaMemoria();
      const recursos = ['pessoas.colaborador', 'pessoas.folha'];
      const config = fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => recursos.map(chave),
        prerequisitosIniciais: () => recursos.map(cumprido),
      });
      const pessoas = portaPessoasNaTransacao(e, a.executor);
      const calculo = new ServicoCalculoFolha(
        porta,
        folha,
        rubricas,
        pessoas,
        portaPontoNaTransacao(e),
        portaRealizadoNaTransacao(e, a.executor),
        trilha,
        config,
        null,
      );
      const ferias = new ServicoFeriasFolha(porta, folha, rubricas, pessoas, trilha, config, null);
      const dezembro = new ServicoFeriasFolha(porta, folhaDezembro, rubricas, pessoas, trilha, config, null);
      let k = 0;
      const s = (): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-m534-${++k}` },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: h,
        rede: a.c.rede,
        login: 'SGH.TESTE',
        porta: ctx,
        pode: () => true,
      });

      const rs = await rubReal.rubricas(ctx, empresa);
      const escolha = Object.fromEntries(
        PAPEIS_CALCULO_FOLHA.map((p) => [
          p,
          rs.find((x) => rubricaServeAoPapel(x, p, '2026-11'))?.id ?? null,
        ]),
      ) as ParametrosFolha['rubricas'];
      const semRubrica = PAPEIS_CALCULO_FOLHA.filter((p) => escolha[p] === null).map(
        (p) => `${p}:${TIPO_DO_PAPEL[p]}`,
      );
      await calculo.registrarParametros(s(), {
        empresa,
        inicio: '2025-01-01',
        percentuais: {
          horaExtra50: 5000,
          horaExtra100: 10_000,
          adicionalNoturno: 2000,
          sobreaviso: 3333,
          periculosidade: 3000,
        },
        encargos: { inssPatronal: 2000, ratAjustado: 300, terceiros: 580, fgts: 800 },
        divisorHoras: null,
        rubricas: escolha,
      });
      await calculo.registrarSalario(s(), {
        vinculo: v.id,
        inicio: '2025-01-05',
        salario: 300_000,
        insalubridade: 0,
        periculosidade: false,
        motivo: 'Admissão sintética',
      });

      const saldo = await ferias.saldo(s(), v.id);
      const prog = await ferias.programar(s(), {
        vinculo: v.id,
        empresa,
        aquisitivoInicio: '2025-01-05',
        inicio: '2026-11-30',
        dias: 20,
        abono: 10,
        adiantarDecimo: true,
      });
      const t0 = performance.now();
      const recibo = await ferias.calcular(s(), prog.id, { versao: 0, simular: false });
      const msRecibo = performance.now() - t0;
      const [linhaFerias] = await e.consultar(
        `SELECT SITUACAO, CAST(ID_PROCESSO AS VARCHAR(20)) ID_PROCESSO, CAST(GOZO_FIM AS VARCHAR(10)) GOZO_FIM,
                CAST(PAGAMENTO AS VARCHAR(10)) PAGAMENTO
           FROM SGH_PES_FERIAS WHERE HOSPITAL = ? AND ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
        [h, String(prog.id)],
        { teto: 1 },
      );
      const detalhe = await ferias.detalhe(s(), prog.id);
      // O aviso e o recibo do PDF (M53.4, sessão 2), relidos da cópia.
      const reciboHtml = await ferias
        .recibo(s(), prog.id)
        .then((x) => htmlReciboFerias(x.detalhe, x.matricula));
      const saldoDepois = await ferias.saldo(s(), v.id);
      const naCompetencia = await porta.feriasNaCompetencia(ctx, '2026-11-01', '2026-11-30');
      const historico = await porta.historico(ctx, [v.id], '2025-01', '2026-10');

      const um = await ferias.calcularDecimo(s(), {
        empresa,
        ano: 2026,
        parcela: 1,
        pagamento: '2026-11-20',
        simular: false,
      });
      const adiantamentos = await porta.adiantamentosDecimo(ctx, empresa, 2026);
      const dois = await dezembro.calcularDecimo(s(), {
        empresa,
        ano: 2026,
        parcela: 2,
        pagamento: '2026-12-18',
        simular: false,
      });
      const linhasDois = dois.processo ? await calculo.linhasDoVinculo(s(), dois.processo.id, v.id) : null;

      await ferias.cancelar(s(), prog.id, { versao: 1, motivo: 'Integração sintética' });
      const reciboDepois = recibo.processo ? await porta.processo(ctx, recibo.processo.id) : null;
      const saldoFinal = await ferias.saldo(s(), v.id);
      const decimos = await ferias.listarDecimo(s(), { empresa, ano: 2026 });
      return {
        antes,
        depois: await contar(),
        semRubrica,
        saldo,
        prog,
        recibo,
        msRecibo,
        linhaFerias,
        detalhe,
        reciboHtml,
        saldoDepois,
        naCompetencia: naCompetencia.filter((x) => x.vinculo === v.id),
        historico,
        um,
        adiantamentos: adiantamentos.get(v.id) ?? 0,
        dois,
        linhasDois,
        reciboDepois,
        saldoFinal,
        decimos,
      };
    });

    expect(r.semRubrica).toEqual([]);
    expect(r.saldo.periodos[0]).toMatchObject({ inicio: '2025-01-05', situacao: 'aberto', saldo: 30 });
    expect(r.prog.ferias).toMatchObject({
      situacao: 'programada',
      fim: '2026-12-19',
      pagamento: '2026-11-28',
    });
    expect(r.recibo.calculado).toBe(true);
    expect(r.recibo.pendencias).toEqual([]);
    expect(r.recibo.processo).toMatchObject({
      tipo: 'ferias',
      competencia: '2026-11',
      pagamento: '2026-11-28',
    });
    expect(r.msRecibo).toBeLessThan(10_000);
    expect(r.linhaFerias).toMatchObject({
      SITUACAO: 'calculada',
      GOZO_FIM: '2026-12-19',
      PAGAMENTO: '2026-11-28',
    });
    expect(n(r.linhaFerias?.['ID_PROCESSO'])).toBe(r.recibo.processo!.id);
    const gozo = r.detalhe.linhas.find((l) => l.papel === 'feriasGozo');
    expect(gozo?.valor).toBe(200_000);
    expect(r.detalhe.linhas.filter((l) => l.memoria.includes('?')).map((l) => l.papel)).toEqual([]);
    expect(r.reciboHtml).toContain('a 19/12/2026 (20 dia(s))');
    expect(r.reciboHtml).toContain('28/11/2026');
    expect(r.reciboHtml).toContain('Terço constitucional de férias');
    expect(r.reciboHtml).toMatch(/R\$ [\d.]+,\d{2} − R\$ [\d.]+,\d{2} = <strong>R\$ [\d.]+,\d{2}<\/strong>/);
    expect(r.reciboHtml).not.toContain('INSS da empresa');
    expect(r.saldoDepois.periodos[0]).toMatchObject({
      gozados: 20,
      abono: 10,
      saldo: 0,
      situacao: 'quitado',
    });
    expect(r.naCompetencia).toEqual([
      expect.objectContaining({ inicio: '2026-11-30', fim: '2026-12-19', competencia: '2026-11' }),
    ]);
    expect(r.naCompetencia[0]!.baseInss).toBeGreaterThan(0);
    expect(r.historico).toEqual([]);
    // Adiantamento do 13º pago com as férias: o vínculo fica fora da 1ª parcela da empresa.
    expect(r.um).toMatchObject({ calculado: false });
    expect(r.um.pendencias.map((p) => p.codigo)).toEqual(['sem-colaboradores']);
    expect(r.adiantamentos).toBe(150_000);
    expect(r.dois.calculado).toBe(true);
    expect(r.dois.processo).toMatchObject({
      tipo: 'decimo2',
      competencia: '2026-12',
      pagamento: '2026-12-18',
    });
    const l2 = r.linhasDois?.linhas ?? [];
    expect(l2.find((l) => l.papel === 'decimoTerceiro')?.valor).toBe(300_000);
    expect(l2.find((l) => l.papel === 'decimoDesconto')?.valor).toBe(150_000);
    expect(r.reciboDepois).toMatchObject({ situacao: 'descartada', motivo: 'Integração sintética' });
    expect(r.saldoFinal.periodos[0]).toMatchObject({ saldo: 30 });
    expect(r.decimos.itens.map((p) => p.tipo)).toEqual(['decimo2']);
    expect(r.depois).toEqual(r.antes);
  }, 600_000);

  it('a trava no colaborador segura a 1ª programação: outra transação no vínculo sem férias é recusada', async (t) => {
    const h = a.c.hospital;
    // Um vínculo já gravado (as gravações desta suíte são desfeitas, então só um de antes serve), de preferência sem férias.
    const [x] = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m534-trava-lista' }, (e) =>
      e.consultar(
        `SELECT FIRST 1 V.ID, (SELECT COUNT(*) FROM SGH_PES_FERIAS F WHERE F.HOSPITAL = V.HOSPITAL
          AND F.ID_VINCULO = V.ID) Q FROM SGH_PES_VINCULO V WHERE V.HOSPITAL = ? ORDER BY 2, 1`,
        [h],
        { teto: 1 },
      ),
    );
    if (!x) {
      t.skip('a cópia não tem vínculo gravado');
      return;
    }
    const vinculo = n(x['ID']);
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m534-trava-1' }, async (e1) => {
      const primeira = await feriasDoVinculoComTravaPesSgh(somenteSgh(e1), h, vinculo);
      // A outra transação (outra conexão, sem espera) relê o mesmo colaborador enquanto a primeira está aberta.
      const segunda = await a.nucleo
        .desfazendoNaCopia(
          { ...a.c, traceId: 'int-m534-trava-2' },
          async (e2) => {
            await feriasDoVinculoComTravaPesSgh(somenteSgh(e2), h, vinculo);
            return 'leu';
          },
          { semEspera: true },
        )
        .catch(
          (erro: unknown) => (erro as { problema?: { codigo?: string } }).problema?.codigo ?? String(erro),
        );
      return { primeira: primeira.length, segunda };
    });
    expect(r).toEqual({ primeira: n(x['Q']), segunda: 'desatualizado' });
  }, 300_000);
});
