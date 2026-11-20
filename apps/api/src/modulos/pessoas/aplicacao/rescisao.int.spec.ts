// Rescisão (M53.5, fatia F4; ficha do M53, seções 4 a 8) sobre a cópia (transação DESFEITA): um colaborador sintético
// (CLT, admitido em 2025) com os parâmetros da empresa (rubricas reais escolhidas pelo tipo) e o salário, desligado sem
// justa causa; os tipos de rescisão do cadastro (só lidos), a fila dos desligados, a prévia, a rescisão gravada
// (SGH_PES_RESCISAO com os CHECKs do 0538 e o processamento `rescisao`) relida, o recálculo que substitui a anterior e o
// cancelamento com o processamento descartado. A tabela legal de 2026 é sintética. As contagens das tabelas do outro
// sistema que a folha poderia tocar ficam iguais antes e depois. Só IDs, contagens e somas em memória; o CPF é sintético.
import { randomBytes } from 'node:crypto';
import {
  type ChaveGravada,
  desligarVinculoPesSgh,
  incluirVinculoPesSgh,
  type PrerequisitoGravado,
  somenteSgh,
} from '@sgh/legado';
import { PAPEIS_CALCULO_FOLHA, type ParametrosFolha, type TabelaLegalFolha } from '@sgh/contratos';
import { rubricaServeAoPapel } from '@sgh/dominio-pessoas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { portaRealizadoNaTransacao } from '../escala/porta-realizado-legado.js';
import { portaCalculoFolhaNaTransacao } from '../folha/porta-calculo-legado.js';
import { htmlTermoRescisao } from '../folha/documentos-calculo.js';
import { portaFolhaNaTransacao } from '../folha/porta-folha-legado.js';
import { ServicoCalculoFolha } from '../folha/servico-calculo.js';
import { ServicoRescisaoFolha } from '../folha/servico-rescisao.js';
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

describe.skipIf(!PODE_ESCREVER)('rescisão (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('desligado → fila → prévia → rescisão gravada e relida → recálculo substitui → cancelamento; outro sistema intacto', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m535-rescisao' }, async (e) => {
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
        nome: 'COLABORADOR SINTETICO M53.5',
        profissional: null,
        usuario: null,
        tipo: 'clt',
        matricula: `SR535-${sufixo}`,
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
      const ctx = { rede: a.c.rede, hospital: h };
      const empresa = (await folha.empresas(ctx))[0]!.codigo;
      const trilha = new RegistradorTrilhaMemoria();
      const recursos = ['pessoas.colaborador', 'pessoas.folha'];
      const config = fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => recursos.map(chave),
        prerequisitosIniciais: () => recursos.map(cumprido),
      });
      const pessoas = portaPessoasNaTransacao(e, a.executor);
      const ponto = portaPontoNaTransacao(e);
      const realizado = portaRealizadoNaTransacao(e, a.executor);
      const calculo = new ServicoCalculoFolha(
        real,
        folha,
        rubricas,
        pessoas,
        ponto,
        realizado,
        trilha,
        config,
        null,
      );
      const rescisao = new ServicoRescisaoFolha(
        real,
        folha,
        rubricas,
        pessoas,
        ponto,
        realizado,
        trilha,
        config,
        null,
      );
      let k = 0;
      const s = (): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-m535-${++k}` },
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
          rs.find((x) => rubricaServeAoPapel(x, p, '2026-10'))?.id ?? null,
        ]),
      ) as ParametrosFolha['rubricas'];
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
      const tipos = await real.tiposRescisao(ctx);
      const tipo = tipos.find((t) => t.saque === '01') ?? tipos[0]!;
      await desligarVinculoPesSgh(s0, {
        hospital: h,
        id: v.id,
        versao: 0,
        data: '2026-10-20',
        tipoRescisao: tipo.id,
        motivo: 'Desligamento sintético da integração.',
        por: 'SGH.TESTE',
      });
      const apoio = await rescisao.apoioTela(s());
      const fila = await rescisao.desligados(s(), { de: '2026-10-20', ate: '2026-10-20' });
      const entrada = {
        vinculo: v.id,
        empresa,
        modalidade: 'sem-justa-causa' as const,
        aviso: 'indenizado' as const,
        termo: null,
        saldoFgts: null,
        pagamento: null,
      };
      const previa = await rescisao.calcular(s(), { ...entrada, simular: true });
      const t0 = performance.now();
      const gravada = await rescisao.calcular(s(), { ...entrada, simular: false });
      const ms = performance.now() - t0;
      const [linha] = await e.consultar(
        `SELECT SITUACAO, MODALIDADE, AVISO, DIAS_AVISO, DIAS_INDENIZADOS, CAST(PROJECAO AS VARCHAR(10)) PROJECAO,
                CAST(PAGAMENTO AS VARCHAR(10)) PAGAMENTO, SALDO_FGTS_INFORMADO, ID_FPTIPORESC,
                CAST(ID_PROCESSO AS VARCHAR(20)) ID_PROCESSO
           FROM SGH_PES_RESCISAO WHERE HOSPITAL = ? AND ID = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
        [h, String(gravada.rescisao?.id ?? 0)],
        { teto: 1 },
      );
      const detalhe = await rescisao.detalhe(s(), gravada.rescisao!.id);
      // O termo em PDF relê a rescisão e a matrícula do vínculo pela porta real (só vínculo e matrícula no documento).
      const termo = await rescisao.termo(s(), gravada.rescisao!.id);
      const html = htmlTermoRescisao(termo.detalhe, termo.matricula);
      const outra = await rescisao.calcular(s(), { ...entrada, modalidade: 'acordo', simular: false });
      const antiga = await real.rescisaoPorId(ctx, gravada.rescisao!.id);
      const procAntigo = await real.processo(ctx, gravada.processo!.id);
      const lista = await rescisao.listar(s(), { vinculo: v.id });
      await rescisao.cancelar(s(), outra.rescisao!.id, { versao: 0, motivo: 'Integração sintética' });
      const cancelada = await real.rescisaoPorId(ctx, outra.rescisao!.id);
      const procCancelado = await real.processo(ctx, outra.processo!.id);
      return {
        antes,
        depois: await contar(),
        tipos: tipos.length,
        tipo: tipo.id,
        apoio,
        fila: fila.itens.filter((x) => x.vinculo === v.id),
        previa,
        gravada,
        ms,
        linha,
        detalhe,
        termo,
        html,
        outra,
        antiga,
        procAntigo,
        lista,
        cancelada,
        procCancelado,
      };
    });

    expect(r.tipos).toBeGreaterThanOrEqual(1);
    expect(r.apoio.modalidades).toHaveLength(10);
    expect(r.fila).toEqual([
      expect.objectContaining({ desligamento: '2026-10-20', tipoRescisao: r.tipo, rescisao: null }),
    ]);
    expect(r.previa.calculado).toBe(false);
    expect(r.previa.pendencias).toEqual([]);
    expect(r.previa.apuracao).toMatchObject({ diasAviso: 33, projecao: '2026-11-22', diasSaldo: 20 });
    expect(r.previa.avisos.map((x) => x.codigo)).toEqual(
      expect.arrayContaining(['saldo-fgts-estimado', 'ponto-nao-fechado']),
    );
    expect(r.gravada.calculado).toBe(true);
    expect(r.gravada.processo).toMatchObject({
      tipo: 'rescisao',
      competencia: '2026-10',
      pagamento: '2026-10-30',
    });
    expect(r.gravada.conferencia?.ok).toBe(true);
    expect(r.ms).toBeLessThan(10_000);
    expect(r.linha).toMatchObject({
      SITUACAO: 'calculada',
      MODALIDADE: 'sem-justa-causa',
      AVISO: 'indenizado',
      DIAS_AVISO: 33,
      DIAS_INDENIZADOS: 33,
      PROJECAO: '2026-11-22',
      PAGAMENTO: '2026-10-30',
      SALDO_FGTS_INFORMADO: 'F',
      ID_FPTIPORESC: r.tipo,
      ID_PROCESSO: String(r.gravada.processo?.id),
    });
    expect(r.termo.detalhe.linhas.length).toBe(r.detalhe.linhas.length);
    expect(r.html).toContain('Termo de rescisão do contrato de trabalho');
    expect(r.html).toContain('Dispensa sem justa causa');
    expect(r.html).toContain('20/10/2026 + 33 dia(s) = 22/11/2026');
    expect(r.detalhe.linhas.map((l) => l.papel)).toEqual(
      expect.arrayContaining([
        'salario',
        'avisoIndenizado',
        'feriasVencidas',
        'decimoProporcional',
        'multaFgts',
      ]),
    );
    expect(r.outra.substituida).toBe(r.gravada.rescisao?.id);
    expect(r.antiga?.situacao).toBe('substituida');
    expect(r.procAntigo?.situacao).toBe('substituida');
    expect(r.lista.itens.map((x) => x.situacao)).toEqual(['calculada', 'substituida']);
    expect(r.cancelada?.situacao).toBe('cancelada');
    expect(r.procCancelado?.situacao).toBe('descartada');
    expect(r.depois).toEqual(r.antes);
  }, 900_000);
});
