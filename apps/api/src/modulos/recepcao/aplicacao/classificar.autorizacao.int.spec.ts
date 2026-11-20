// M44, regra 1, sobre a cópia (só leitura): a categoria e o conselho relidos do vínculo do próprio usuário (cadastro de
// profissionais) decidem quem conclui a classificação: o enfermeiro com conselho ativo conclui e reclassifica; o
// técnico de enfermagem (sem ocupação de enfermeiro) só registra os sinais; quem não tem ocupação não classifica. Os
// logins da cópia ficam só em memória (nunca impressos); a saída é só de contagens.
import { recusaDaAcao } from '@sgh/dominio-recepcao';
import { fonteCatalogoArquivo, loginsComOcupacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AmbienteM27,
  ambienteM27,
  caminhoCatalogo,
  NA_COPIA,
} from '../../acesso/aplicacao/copia.spec-util.js';
import { portaClassificacaoLegado } from '../classificacao-porta-legado.js';
import { atorDoVinculo } from '../classificacao-servico.js';

describe.skipIf(!NA_COPIA)('regra 1 na cópia: quem classifica (só leitura)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('enfermeiro conclui; técnico só registra sinais; médico e sem vínculo não classificam', async () => {
    const logins = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m44-r1' }, async (l) => ({
      enf: await loginsComOcupacao(l, '2235'),
      tec: await loginsComOcupacao(l, '3222', true),
    }));
    const porta = portaClassificacaoLegado(a.nucleo, fonteCatalogoArquivo(caminhoCatalogo));
    const decidir = async (login: string) => {
      const ator = atorDoVinculo(await porta.vinculo(a.c, login));
      return {
        categoria: ator.categoria,
        concluir: recusaDaAcao(ator, 'concluir'),
        sinais: recusaDaAcao(ator, 'registrarSinais'),
      };
    };
    // Uma leitura por vez (o driver nativo não é usado em paralelo aqui).
    const enf: Awaited<ReturnType<typeof decidir>>[] = [];
    for (const l of logins.enf) enf.push(await decidir(l));
    const tec: Awaited<ReturnType<typeof decidir>>[] = [];
    for (const l of logins.tec) tec.push(await decidir(l));
    const semVinculo = await decidir('SGH.NINGUEM.M44');
    console.log(
      `[${a.cod}] regra 1: enfermeiros ${enf.length < 5 ? '<5' : enf.length}, técnicos ${tec.length < 5 ? '<5' : tec.length}`,
    );
    expect(enf.length).toBeGreaterThan(0);
    for (const x of enf) {
      expect(x.categoria).toBe('enfermeiro');
      expect(x.sinais).toBeNull();
      expect([null, 'conselho-inativo']).toContain(x.concluir);
    }
    expect(enf.some((x) => x.concluir === null)).toBe(true);
    for (const x of tec) {
      expect(x.categoria).toBe('tecnico-enfermagem');
      expect(x.concluir).toBe('privativo-enfermeiro');
      expect(x.sinais).toBeNull();
    }
    expect(semVinculo).toEqual({
      categoria: 'administrativo',
      concluir: 'sem-vinculo-assistencial',
      sinais: 'sem-vinculo-assistencial',
    });
  });
});
