// M12 na API sobre a cópia (fonte do legado, READ ONLY): o serviço monta o contrato em abas (sem credencial,
// com as constantes ocultas), as tabelas com o modelo de valor, a grade de honorários com a vigência, a
// proposta de reajuste (nada gravado) e o valor vigente, com os dados reais da cópia em memória do teste; e,
// em dev com ACESSO_FONTE_DEV=copia, a gravação fica desligada com o motivo. A saída só tem contagens.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  fonteCatalogoArquivo,
  lerConfiguracaoNucleo,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { totalComponentes } from '@sgh/dominio-preco';
import { itemHonorarioNaData } from '@sgh/legado';
import { afterAll, describe, expect, it } from 'vitest';
import { fontePrecosLegado } from './fonte.js';
import { ServicoPrecos } from './servico.js';

const raiz = resolve(import.meta.dirname, '../../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const nucleo = new NucleoLegado({
  env: { ...env, FB_POOL_TETO: '2' },
  driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
  pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
});
const cod = nucleo.estabelecimentos[0]?.codigo ?? 'pc';
const fonte = fontePrecosLegado(nucleo, fonteCatalogoArquivo(resolve(raiz, 'docs/operacoes/catalogo')), {
  gravacaoPermitida: false,
  motivoSemGravacao: 'dev sobre a cópia',
});
const servico = new ServicoPrecos(fonte);
const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m12-api' };
afterAll(async () => {
  await nucleo.encerrar();
});

describe('M12: serviço sobre a cópia (READ ONLY)', () => {
  it('lista e contrato em abas de um convênio ativo, sem credencial; gravação desligada com o motivo', async () => {
    const lista = await servico.listarConvenios(ctx, { busca: '', situacao: 'ativos' }, null);
    expect(lista.length).toBeGreaterThan(0);
    const c = await servico.contrato(ctx, lista[0]!.codigo, { alterarSituacao: true, editarContrato: true });
    expect(c?.abas).toHaveLength(7);
    expect(c?.gravacao).toMatchObject({ permitida: false, motivo: 'dev sobre a cópia' });
    expect(c?.permissoes).toEqual({ alterarSituacao: false, editarContrato: false });
    expect(JSON.stringify(c)).not.toMatch(/"SENHA"|CPF_RESPONSAVEL|LOGIN_PRESTADOR|SENHA_PRESTADOR/);
    const campos = c?.abas.reduce((n, a) => n + a.campos.length, 0) ?? 0;
    console.log(
      `[${cod}] ${lista.length} convênios ativos; contrato com ${campos} campos em 7 abas; ${c?.constantesOcultas} constantes ocultas`,
    );
  });

  it('tabelas com o modelo; grade e proposta (nada gravado); valor vigente com a explicação', async () => {
    const tabelas = await servico.tabelas(ctx, 'honorarios');
    const modelos = Object.fromEntries(
      ['VALOR', 'PORTE', 'CH'].map((m) => [m, tabelas.filter((t) => t.modelo === m).length]),
    );
    expect(tabelas.find((t) => t.codigo === 10)?.compartilhada).toBe(true);
    const grade = await servico.honorarios(ctx, 305, { busca: '', pagina: 0, porPagina: 20, data: null });
    expect(grade.itens.length).toBeGreaterThan(0);
    const comPreco = grade.itens.filter((i) => i.valores);
    const prop = await servico.proposta(ctx, 305, {
      data: null,
      codigos: comPreco.slice(0, 5).map((i) => i.codigo),
      percentual: 5,
      valores: null,
    });
    expect(prop.linhas.length).toBe(Math.min(5, comPreco.length));
    const conv = (await servico.listarConvenios(ctx, { busca: '', situacao: 'ativos' }, null)).find(
      (x) => x.tabelas.honorariosExterna === 305,
    );
    if (conv && comPreco[0]) {
      const v = await servico.valorVigente(ctx, {
        convenio: conv.codigo,
        tipo: 'honorario',
        conta: 'externa',
        item: comPreco[0].codigo,
        data: null,
      });
      expect(v?.total).toBeCloseTo(comPreco[0].total ?? NaN, 6);
    }
    console.log(
      `[${cod}] ${tabelas.length} tabelas de honorários por modelo ${JSON.stringify(modelos)}; proposta de ${prop.linhas.length} itens com ${prop.vetos.length} veto(s) e ${prop.alertas.length} alerta(s)`,
    );
  });
  it('valor vigente nos modelos CH e PORTE: o total é a soma dos componentes (regra da sante-api), igual à grade', async () => {
    const tabelas = await servico.tabelas(ctx, 'honorarios');
    let comparados = 0;
    let comEstimativa = 0;
    for (const modelo of ['CH', 'PORTE'] as const) {
      for (const t of tabelas.filter((x) => x.modelo === modelo && x.convenios.length > 0).slice(0, 3)) {
        const uso = t.convenios[0]!;
        const conta = uso.usos.includes('externa') ? 'externa' : 'internacao';
        const grade = await servico.honorarios(ctx, t.codigo, {
          busca: '',
          pagina: 0,
          porPagina: 20,
          data: null,
        });
        for (const i of grade.itens.filter((x) => x.valores).slice(0, 5)) {
          const v = await servico.valorVigente(ctx, {
            convenio: uso.codigo,
            tipo: 'honorario',
            conta,
            item: i.codigo,
            data: null,
          });
          if (v?.tabela !== t.codigo) continue;
          const hoje = grade.dataBase;
          const lido = await nucleo.lerSomente(ctx, (l) => itemHonorarioNaData(l, t.codigo, i.codigo, hoje));
          expect(v.total).toBeCloseTo(lido?.valores ? totalComponentes(lido.valores) : NaN, 6);
          expect(v.total).toBeCloseTo(i.total ?? NaN, 6);
          comparados++;
          if (v.estimativaPeloModelo !== null) comEstimativa++;
        }
      }
    }
    expect(comparados).toBeGreaterThan(0);
    console.log(
      `[${cod}] modelos CH e PORTE: ${comparados} itens com o total da consulta igual à soma dos componentes e à grade; ${comEstimativa} com a estimativa pelo modelo só na explicação`,
    );
  });
});
