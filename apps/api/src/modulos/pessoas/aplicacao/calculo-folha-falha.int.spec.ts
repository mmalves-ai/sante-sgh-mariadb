// Cálculo mensal da folha (M53.3, fatia F2; ficha do M53, seção 10, "Integração na cópia: … falha no meio desfaz tudo"):
// a porta REAL do cálculo (uma transação própria por gravação, como em produção) grava o processamento e, no meio das
// linhas, grava a primeira (um vínculo sintético incluído no começo da MESMA transação) e o banco recusa a segunda (vínculo inexistente: a chave
// estrangeira do próprio esquema SGH_) → a transação inteira é desfeita: nem o processamento nem a primeira linha ficam,
// e a trilha não é gravada (a contagem da trilha do usuário de teste no evento não muda). Nada é confirmado na cópia (o
// erro acontece antes do fim). Só IDs e contagens; nenhum dado pessoal.
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import {
  incluirVinculoPesSgh,
  lerTrilhaPropria,
  linhasDoVinculoPesSgh,
  type NucleoLegado,
  processosFolhaPesSgh,
  somenteSgh,
} from '@sgh/legado';
import { CifraCpf } from '../cifra-cpf.js';
import { portaCalculoFolhaLegado } from '../folha/porta-calculo-legado.js';

const COMP = '1999-01';
const CPF_SINTETICO = '52998224725';

describe.skipIf(!PODE_ESCREVER)('cálculo mensal da folha: falha no meio desfaz tudo (cópia)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('processamento gravado + linha recusada pelo banco → nada fica', async () => {
    const h = a.c.hospital;
    const resumo = createHash('sha256').update(`falha-m533-${Date.now()}`).digest('hex');
    // Leituras pelo adaptador do legado (só @sgh/legado conhece o banco): os processamentos da competência com este resumo
    // e as linhas do processamento tentado.
    const VINCULO_INEXISTENTE = 2_000_000_000;
    const dia = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    const ler = <T>(fn: Parameters<typeof a.nucleo.lerSomente<T>>[1]) =>
      a.nucleo.lerSomente({ ...a.c, traceId: 'int-m533-falha' }, fn);
    // O vínculo sintético da primeira linha nasce no começo da mesma transação da porta real (e some com ela).
    let valido = 0;
    const cifra = new CifraCpf(randomBytes(32));
    const nucleo: Pick<NucleoLegado, 'lerSomente' | 'gravarSgh'> = {
      lerSomente: (c, fn) => a.nucleo.lerSomente(c, fn),
      gravarSgh: (c, fn) =>
        a.nucleo.gravarSgh(c, async (e) => {
          valido = (
            await incluirVinculoPesSgh(somenteSgh(e), {
              hospital: h,
              pessoa: null,
              cpfHmac: cifra.hmac(CPF_SINTETICO),
              cpfCifrado: cifra.cifrar(CPF_SINTETICO),
              nome: 'COLABORADOR SINTETICO M53.3 FALHA',
              profissional: null,
              usuario: null,
              tipo: 'clt',
              matricula: `SFF533-${resumo.slice(0, 8)}`,
              cargo: 'Auxiliar administrativo',
              funcao: null,
              cargaSemanal: 44,
              centroCusto: 1,
              unidade: null,
              setor: null,
              admissao: '1999-01-01',
              por: 'SGH.TESTE',
            })
          ).id;
          return fn(e);
        }),
    };
    const contar = (proc: number) =>
      ler(async (l) => ({
        processos: (await processosFolhaPesSgh(l, h, { competencia: COMP })).filter(
          (p) => p.resumo === resumo,
        ).length,
        linhas: proc
          ? (await linhasDoVinculoPesSgh(l, h, proc, valido)).length +
            (await linhasDoVinculoPesSgh(l, h, proc, VINCULO_INEXISTENTE)).length
          : 0,
        trilha: (
          await lerTrilhaPropria(l, {
            hospital: h,
            inicio: dia(-1),
            fimExclusivo: dia(2),
            usuario: 'SGH.TESTE',
            evento: 'pessoas.folha.calculada',
            limite: 10_000,
          })
        ).length,
      }));
    const antes = await contar(0);
    const porta = portaCalculoFolhaLegado(nucleo);
    let processo = 0;
    let gravouPrimeira = false;
    const linha = (vinculo: number) => ({
      vinculo,
      centroCusto: 1,
      diasPagos: 30,
      // Linha de base (sem rubrica, permitida pelo CHECK do esquema): só a chave estrangeira do vínculo decide.
      papel: 'baseInss' as const,
      tipo: 'base' as const,
      rubrica: null,
      codigoRubrica: null,
      quantidade: 0,
      unidade: 'valor' as const,
      valor: 100_000,
      memoria: `falha forçada ${resumo.slice(0, 12)}`,
    });
    const gravacao = porta.gravarSgh(
      { rede: a.c.rede, hospital: h },
      {
        tabelaAlvo: 'SGH_PES_FOLHA_PROCESSO',
        idAlvo: '0',
        chaveNaturalAlvo: `falha:${COMP}`,
        evento: 'pessoas.folha.calculada',
        usuario: 'SGH.TESTE',
        traceId: 'int-m533-falha',
      } as never,
      async (g) => {
        const t = {
          colaboradores: 1,
          proventos: 100_000,
          descontos: 0,
          liquido: 100_000,
          inss: 0,
          irrf: 0,
          fgts: 0,
          inssPatronal: 0,
          rat: 0,
          terceiros: 0,
        };
        processo = await g.incluirProcesso({
          empresa: 1,
          competencia: COMP,
          numero: 9_999,
          totais: t,
          foraDaFolha: 0,
          tabelaLegal: '1999-01-01',
          parametros: '1999-01-01',
          resumo,
          por: 'SGH.TESTE',
        });
        // Dentro da transação o processamento existe (a releitura o acha)…
        expect((await g.processo(processo))?.resumo).toBe(resumo);
        // …a primeira linha (vínculo existente) é gravada e relida na própria transação…
        expect(valido).toBeGreaterThan(0);
        expect(await g.incluirLinhas(processo, [linha(valido)])).toBe(1);
        gravouPrimeira = true;
        // …e o banco recusa a segunda (vínculo inexistente), no meio da gravação das linhas.
        await g.incluirLinhas(processo, [linha(VINCULO_INEXISTENTE)]);
        return processo;
      },
    );
    // A recusa é a da chave estrangeira do vínculo (e não outra falha qualquer antes dela).
    await expect(gravacao).rejects.toThrow(/SGH_FK_PES_FOLHA_CALC_VINC|FOREIGN KEY/i);
    expect(processo).toBeGreaterThan(0);
    expect(gravouPrimeira).toBe(true);
    const depois = await contar(processo);
    expect(depois.processos).toBe(0);
    expect(depois.linhas).toBe(0);
    expect(depois.trilha).toBe(antes.trilha);
    expect(antes.processos).toBe(0);
  });
});
