// M59 (etapa 6) sobre a cópia, sob a trava da cópia (com-copia.sh): o serviço do painel da retrocompatibilidade com a
// porta do núcleo real e o registro versionado do hospital (docs/coexistencia/retrocompatibilidade). READ ONLY: só o
// catálogo do banco (estrutura, nenhum valor de linha). Prova, de ponta a ponta: a decisão "pendente" vale mantida; as
// quatro condições na ordem; os cinco passos na ordem com o tamanho medido no banco (imutabilidade por linha primeiro,
// do tamanho das tabelas clínicas); as três retiradas "verde" (mantida sem contingência longa; D-RETRO-RETIRADAS-F6); zero gatilho do Sante em tabela do outro sistema;
// a segunda leitura sai do cache do catálogo. Os agregados vão para o arquivo de SGH_M59_6_SAIDA_API, se houver.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CONDICOES_EXTINCAO,
  esquemaPainelRetrocompatibilidade,
  OPERACOES_DE_RETIRADA,
  PASSOS_EVOLUCAO,
} from '@sgh/contratos';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  exigirTravaDaCopia,
  fonteCatalogoArquivo,
  lerConfiguracaoNucleo,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { ServicoRetrocompatibilidade } from './aplicacao/retrocompatibilidade.js';
import { portaCoexistenciaLegado } from './porta-legado.js';

const raiz = resolve(import.meta.dirname, '../../../../..');
const { env: base } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const env: Record<string, string> = {
  ...(base as Record<string, string>),
  AMBIENTE: 'dev',
  FB_POOL_TETO: '2',
};

let nucleo: NucleoLegado;
let hospital = '';

beforeAll(async () => {
  exigirTravaDaCopia();
  nucleo = new NucleoLegado({
    env,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  const saude = await nucleo.partida();
  // HS-1: só o pc por ora (o registro versionado existe só para ele).
  hospital = saude.find((s) => s.disponivel && s.codigo === 'pc')?.codigo ?? '';
  if (!hospital) throw new Error('O estabelecimento pc da cópia não está disponível.');
});
afterAll(async () => {
  await nucleo?.encerrar();
});

const sessao = (): SessaoCadastro =>
  ({
    req: { headers: {}, ip: '127.0.0.1' },
    porta: { rede: nucleo.rede, hospital },
    rede: nucleo.rede,
    hospital,
    login: 'SGH.TESTE',
    pode: () => true,
  }) as unknown as SessaoCadastro;

describe('M59 (etapa 6): painel da retrocompatibilidade na cópia', () => {
  it('pendente vale mantida; condições e passos na ordem, com o tamanho medido; retiradas verdes (sem contingência longa); cache', async () => {
    let leiturasCatalogo = 0;
    const porta = portaCoexistenciaLegado(nucleo);
    const contada = {
      ...porta,
      catalogoRetrocompatibilidade: (c: Parameters<typeof porta.catalogoRetrocompatibilidade>[0]) => {
        leiturasCatalogo += 1;
        return porta.catalogoRetrocompatibilidade(c);
      },
    } as typeof porta;
    const catalogoOps = fonteCatalogoArquivo(resolve(raiz, 'docs/operacoes/catalogo'));
    const servico = new ServicoRetrocompatibilidade({
      porta: contada,
      raizRetrocompatibilidade: resolve(raiz, 'docs/coexistencia/retrocompatibilidade'),
      raizFim: resolve(raiz, 'docs/coexistencia/fim'),
      raizDesligamento: resolve(raiz, 'docs/coexistencia/desligamento'),
      // o período de contingência segue aberto no dev (falha fechada)
      contingenciaLigada: async () => true,
      // o catálogo de operações real (o mesmo do executor)
      estadoOperacao: (o, h) => catalogoOps.estado(o, h),
    });

    const t0 = performance.now();
    const p = esquemaPainelRetrocompatibilidade.parse(await servico.painel(sessao()));
    const ms = Math.round(performance.now() - t0);

    expect(p.hospital).toBe('pc');
    expect(p.registroInvalido).toBeNull();
    expect(p.decisaoRegistrada).toBe('pendente');
    expect(p.decisaoVigente).toBe('mantida');
    expect(p.podeDecidirExtincao).toBe(false);
    expect(p.condicoes.map((c) => c.condicao)).toEqual([...CONDICOES_EXTINCAO]);
    expect(p.condicoes.find((c) => c.condicao === 'contingencia-encerrada')?.cumprida).toBe(false);
    expect(p.passos.map((x) => x.passo)).toEqual([...PASSOS_EVOLUCAO]);
    expect(p.passos.every((x) => x.situacao === 'bloqueado')).toBe(true);
    expect(p.passos.every((x) => x.motivos.includes('retrocompatibilidade-nao-extinta'))).toBe(true);
    expect(p.passos[0]?.ficha).toMatch(/^docs\/adr\/0033-/);
    expect(p.passos[0]?.mudaLeituraSanteApi).toBe(false);
    expect(p.passos.slice(1).every((x) => x.mudaLeituraSanteApi)).toBe(true);
    expect(p.operacoesDeRetirada.map((o) => o.operacao)).toEqual([...OPERACOES_DE_RETIRADA]);
    expect(p.operacoesDeRetirada.every((o) => o.estadoEsperado === 'verde')).toBe(
      p.contingenciaLonga === false,
    );
    // o catálogo de operações acompanha a decisão (verde no pc): nenhuma divergência
    expect(p.operacoesDeRetirada.map((o) => [o.estadoAtual, o.divergente])).toEqual(
      OPERACOES_DE_RETIRADA.map(() => ['verde', false]),
    );
    expect(p.inventarioIndisponivel).toBe(false);
    const inv = p.inventario;
    if (!inv) throw new Error('inventário ausente');
    expect(inv.gatilhosSghEmTabelaLegada).toBe(0);
    expect(inv.tabelasClinicas.presentes).toBe(inv.tabelasClinicas.matriz);
    expect(p.passos[0]?.tamanho).toBe(inv.tabelasClinicas.presentes);
    expect(p.passos[1]?.tamanho).toBe(inv.gatilhos.ativos); // o trabalho é desativar os ativos
    expect(p.passos[2]?.tamanho).toBe(inv.colunasDeUmaLetra.colunas);
    expect(p.passos[3]?.tamanho).toBe(inv.paresDataHora.pares);
    expect(p.passos[4]?.tamanho).toBe(inv.chavesEmTexto.chaves);
    expect(ms).toBeLessThan(120_000);

    const t1 = performance.now();
    const p2 = await servico.painel(sessao());
    const ms2 = Math.round(performance.now() - t1);
    expect(leiturasCatalogo).toBe(1);
    expect(p2.inventarioMedidoEm).toBe(p.inventarioMedidoEm);

    const saida = process.env['SGH_M59_6_SAIDA_API'];
    if (saida)
      writeFileSync(
        saida,
        JSON.stringify(
          {
            ms,
            ms2,
            decisaoVigente: p.decisaoVigente,
            retiradas: p.operacoesDeRetirada,
            passos: p.passos.map((x) => ({ passo: x.passo, tamanho: x.tamanho, motivos: x.motivos })),
            inventario: inv,
          },
          null,
          2,
        ),
      );
  }, 180_000);
});
