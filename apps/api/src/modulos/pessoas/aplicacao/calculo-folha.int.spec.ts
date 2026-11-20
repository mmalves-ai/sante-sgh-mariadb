// Cálculo mensal da folha (M53.3, fatia F2; ficha do M53, seções 4 a 8, regras 7 e 8) sobre a cópia (transação
// DESFEITA): um colaborador sintético (CLT) com o ponto de setembro fechado (gravado direto nas tabelas SGH_, como o
// passado), os parâmetros da empresa com as rubricas reais da empresa escolhidas pelo tipo, o salário contratual, a
// prévia, o cálculo gravado (processamento e linhas) com a prova da soma relida no banco, o detalhe, a memória, o
// recálculo que substitui o anterior e o descarte. Uma tabela legal de 2026 com valores sintéticos (no formato da lei)
// entra como vigência ao lado das lidas do banco (as do banco param em 2023 na cópia). As contagens das tabelas do outro sistema que a folha poderia
// tocar (funcionários, cabeçalho e ficha da folha, pendências do eSocial, contas a pagar) ficam iguais antes e depois.
// Só IDs, contagens e somas em memória; o CPF é sintético.
import { randomBytes } from 'node:crypto';
import {
  type ChaveGravada,
  incluirEventoPeriodoPesSgh,
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
import { ServicoCalculoFolha } from '../folha/servico-calculo.js';
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
const COMP = '2026-09';

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

describe.skipIf(!PODE_ESCREVER)('cálculo mensal da folha (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('parâmetros → salário → prévia → cálculo gravado e relido → recálculo → descarte; outro sistema intacto', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m533-calculo' }, async (e) => {
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
        nome: 'COLABORADOR SINTETICO M53.3',
        profissional: null,
        usuario: null,
        tipo: 'clt',
        matricula: `SF533-${sufixo}`,
        cargo: 'Auxiliar administrativo',
        funcao: null,
        cargaSemanal: 44,
        centroCusto: n(cc?.['COD']),
        unidade: null,
        setor: null,
        admissao: '2026-01-01',
        por: 'SGH.TESTE',
      });
      await incluirEventoPeriodoPesSgh(s0, {
        hospital: h,
        vinculo: v.id,
        competencia: COMP,
        acao: 'fechado',
        ref: null,
        hash: 'a'.repeat(64),
        totais: JSON.stringify({ classes: { '1': 10_560, '5': 120 }, eventos: { '1': 10_560 } }),
        concorda: null,
        texto: null,
        por: 'SGH.TESTE',
      });

      // Só o vínculo deste teste entra (outros ramos podem ter deixado vínculos na cópia); o SQL é o real.
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
      let lidasDoBanco = 0;
      const rubricas = new Proxy(rubReal, {
        get(alvo, prop) {
          const x: unknown = Reflect.get(alvo, prop);
          if (prop !== 'tabelasLegais')
            return typeof x === 'function' ? (x as (...a: unknown[]) => unknown).bind(alvo) : x;
          return async (...args: Parameters<typeof rubReal.tabelasLegais>) => {
            const ts = await alvo.tabelasLegais(...args);
            lidasDoBanco = ts.length;
            return [...ts.filter((t) => t.inicio !== TABELA_2026.inicio), TABELA_2026];
          };
        },
      });
      const folha = portaFolhaNaTransacao(e);
      const ctx = { rede: a.c.rede, hospital: h };
      const empresa = (await folha.empresas(ctx))[0]!.codigo;

      const trilha = new RegistradorTrilhaMemoria();
      const recursos = ['pessoas.colaborador', 'pessoas.folha'];
      const servico = new ServicoCalculoFolha(
        porta,
        folha,
        rubricas,
        portaPessoasNaTransacao(e, a.executor),
        portaPontoNaTransacao(e),
        portaRealizadoNaTransacao(e, a.executor),
        trilha,
        fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => recursos.map(chave),
          prerequisitosIniciais: () => recursos.map(cumprido),
        }),
        null,
      );
      const s: SessaoCadastro = {
        req: {
          headers: { 'idempotency-key': 'int-m533-1' },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: h,
        rede: a.c.rede,
        login: 'SGH.TESTE',
        porta: ctx,
        pode: () => true,
      };

      // As rubricas reais da empresa, uma por tipo de papel (em vigor e ativa).
      const rs = await rubReal.rubricas(ctx, empresa);
      const escolha = Object.fromEntries(
        PAPEIS_CALCULO_FOLHA.map((p) => [p, rs.find((x) => rubricaServeAoPapel(x, p, COMP))?.id ?? null]),
      ) as ParametrosFolha['rubricas'];
      const semRubrica = PAPEIS_CALCULO_FOLHA.filter((p) => escolha[p] === null).map(
        (p) => `${p}:${TIPO_DO_PAPEL[p]}`,
      );

      await servico.registrarParametros(s, {
        empresa,
        inicio: '2026-01-01',
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
      await servico.registrarSalario(s, {
        vinculo: v.id,
        inicio: '2026-01-01',
        salario: 300_000,
        insalubridade: 2000,
        periculosidade: false,
        motivo: 'Admissão sintética',
      });
      const salarios = await servico.listarSalarios(s, v.id);

      const t0 = performance.now();
      const previa = await servico.calcular(s, { empresa, competencia: COMP, simular: true });
      const msPrevia = performance.now() - t0;
      const g = await servico.calcular(s, { empresa, competencia: COMP, simular: false });
      const det = g.processo ? await servico.detalhe(s, g.processo.id) : null;
      const linhas = g.processo ? await servico.linhasDoVinculo(s, g.processo.id, v.id) : null;
      // O holerite do autosserviço lê o cálculo em vigor pela situação (M53.3, sessão 2).
      const holerite = await servico.holerite(s, v.id, COMP);
      const [soma] = g.processo
        ? await e.consultar(
            `SELECT CAST(SUM(CASE WHEN TIPO = 'provento' THEN VALOR_CENTAVOS ELSE 0 END) AS VARCHAR(20)) P,
                    CAST(SUM(CASE WHEN TIPO = 'desconto' THEN VALOR_CENTAVOS ELSE 0 END) AS VARCHAR(20)) D,
                    COUNT(*) Q
               FROM SGH_PES_FOLHA_CALCULO WHERE HOSPITAL = ? AND ID_PROCESSO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
            [h, String(g.processo.id)],
            { teto: 1 },
          )
        : [];
      const g2 = await servico.calcular(s, { empresa, competencia: COMP, simular: false });
      const desc = g2.processo
        ? await servico.descartar(s, g2.processo.id, {
            versao: g2.processo.versao,
            motivo: 'Integração sintética',
          })
        : null;
      const lista = await servico.listarProcessos(s, { empresa, competencia: COMP });
      return {
        antes,
        depois: await contar(),
        semRubrica,
        lidasDoBanco,
        salarios,
        previa,
        msPrevia,
        g,
        det,
        linhas,
        holerite,
        soma,
        g2,
        desc,
        lista,
        v: v.id,
      };
    });

    expect(r.semRubrica).toEqual([]);
    expect(r.lidasDoBanco).toBeGreaterThan(0);
    expect(r.salarios.itens.map((x) => x.salario)).toEqual([300_000]);
    expect(r.previa).toMatchObject({ calculado: false, simulado: true, pendencias: [] });
    expect(r.previa.conferencia?.ok).toBe(true);
    expect(r.msPrevia).toBeLessThan(10_000);
    expect(r.g.calculado).toBe(true);
    expect(r.g.processo).toMatchObject({ numero: 1, situacao: 'calculada', tabelaLegal: '2026-01-01' });
    const c = r.g.colaboradores[0]!;
    expect(c.vinculo).toBe(r.v);
    expect(c.proventos).toBeGreaterThan(300_000); // salário + insalubridade + hora extra + DSR
    expect(r.det?.conferencia.ok).toBe(true);
    expect(r.det?.colaboradores.map((x) => x.liquido)).toEqual([c.liquido]);
    expect(r.linhas?.linhas.find((l) => l.papel === 'insalubridade')?.valor).toBe(32_420); // 20% de 1.621,00
    // A memória relida do banco (charset NONE, CP1252) é o texto calculado: nenhum caractere trocado por '?' (o sinal
    // de menos das contas é ASCII; caractere fora do CP1252 é recusado antes do INSERT).
    expect(r.linhas?.linhas.filter((l) => l.memoria.includes('?')).map((l) => l.papel)).toEqual([]);
    expect(r.linhas?.linhas.find((l) => l.papel === 'insalubridade')?.memoria).toContain('×');
    expect(r.holerite).toMatchObject({ disponivel: true, calculado: true, vinculo: r.v, liquido: c.liquido });
    expect(r.holerite.linhas.some((l) => ['inssPatronal', 'rat', 'terceiros'].includes(l.papel))).toBe(false);
    expect(n(r.soma?.['P'])).toBe(r.g.totais!.proventos);
    expect(n(r.soma?.['D'])).toBe(r.g.totais!.descontos);
    expect(r.g2.processo?.numero).toBe(2);
    expect(r.g2.substituido).toBe(r.g.processo!.id);
    expect(r.g2.processo?.resumo).toBe(r.g.processo?.resumo);
    expect(r.desc?.ok).toBe(true);
    expect(r.lista.itens.map((p) => [p.numero, p.situacao])).toEqual([
      [2, 'descartada'],
      [1, 'substituida'],
    ]);
    expect(r.depois).toEqual(r.antes);
  }, 600_000);
});
