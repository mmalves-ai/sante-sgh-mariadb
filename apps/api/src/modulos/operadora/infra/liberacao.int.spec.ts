// M56 (etapa F0) na cópia: regra 1 — com as chaves da operadora desligadas no estabelecimento (M61: a liberação full
// liga tudo na instalação, então o teste as DESLIGA na própria transação desfeita, em vez de depender do estado da
// cópia), o serviço da situação, sobre as chaves relidas nessa transação, devolve o módulo e as 10 fatias desligados —
// e os catálogos da ANS pela porta do legado (READ ONLY): os grupos do SIP, a primeira página dos procedimentos do SIP
// por chave dentro do teto e do tempo, o filtro do grupo e a classificação da ANS. Nada fica na cópia; só contagens no
// log.
import { resolve } from 'node:path';
import { CHAVES_FATIA_OPERADORA } from '@sgh/contratos';
import { planejarLote } from '@sgh/dominio-config';
import {
  ambienteEfetivo,
  aplicarLoteLiberacao,
  caminhoArquivoAmbiente,
  LIMITE_PAGINA_SIP,
  lerChavesLiberacao,
  lerPrerequisitos,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fonteConfiguracaoLegado } from '../../config/configuracao-fonte.js';
import { ServicoSituacaoOperadora } from '../aplicacao/situacao.js';
import { portaOperadoraLegado } from '../porta-legado.js';

const raiz = resolve(import.meta.dirname, '../../../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE = codigos.length > 0 && travaDaCopiaSegura(process.pid);
let nucleo: NucleoLegado;
const cod = codigos[0] as string;

beforeAll(async () => {
  if (!PODE) return;
  nucleo = new NucleoLegado({
    env: { ...env, FB_POOL_TETO: '2' },
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  await nucleo.verificarSchema(cod);
});
afterAll(async () => {
  if (PODE) await nucleo.encerrar();
});

describe.skipIf(!PODE)('operadora própria na cópia (etapa F0)', () => {
  it('regra 1: com as chaves da operadora desligadas no estabelecimento, módulo e fatias desligados', async () => {
    await nucleo.desfazendoNaCopia(
      { rede: nucleo.rede, hospital: cod, traceId: 'int-m56-regra1' },
      async (e) => {
        const chavesOperadora = ['operadora', ...CHAVES_FATIA_OPERADORA.map((c) => `operadora.${c.recurso}`)];
        for (const chave of chavesOperadora)
          await aplicarLoteLiberacao(
            e,
            {
              hospital: cod,
              tipo: 'recurso',
              chave,
              planejar: ({ chaves }) => planejarLote(chaves, 'hospital', ['*'], false),
              justificativa: 'SGH M56: integração (desligada na transação desfeita)',
              autor: 'SINT.OPERADORA',
            },
            {
              rede: nucleo.rede,
              hospital: cod,
              usuario: 'SINT.OPERADORA',
              evento: 'config.liberacao.alterada',
              recurso: 'config.liberacao',
              operacao: 'int',
              chaveNaturalAlvo: null,
              resultado: 'sucesso',
              estacao: 'integracao-m56',
              correlacao: 'int-m56-regra1',
            },
          );
        const chaves = await lerChavesLiberacao(e, cod);
        const daOperadora = chaves.filter((c) => c.chave === 'operadora' || c.chave.startsWith('operadora.'));
        expect(daOperadora.filter((c) => c.escopo === 'hospital' && c.ligada === true)).toEqual([]);
        // A situação sobre as chaves relidas NESTA transação (a fonte real lê fora dela e não as veria).
        const fonte = {
          ...fonteConfiguracaoLegado(nucleo),
          chaves: async () => chaves,
          prerequisitos: async () => lerPrerequisitos(e, cod),
        };
        const s = await new ServicoSituacaoOperadora(fonte, null).situacao({
          rede: nucleo.rede,
          hospital: cod,
          login: 'SINT.OPERADORA',
          setor: null,
        });
        expect(s.modulo.situacao).toBe('desligada');
        expect(s.fatias).toHaveLength(10);
        expect(s.fatias.every((f) => f.situacao === 'desligada')).toBe(true);
        console.log(
          `[int-m56] ${cod}: ${daOperadora.length} linha(s) de liberação da operadora; módulo e fatias desligados`,
        );
      },
    );
  });

  it('catálogos da ANS pela porta do legado: grupos, procedimentos por chave e classificação', async () => {
    const porta = portaOperadoraLegado(nucleo);
    const c = { rede: nucleo.rede, hospital: cod };
    const grupos = await porta.gruposSip(c);
    expect(grupos.length).toBeGreaterThan(0);
    const inicio = performance.now();
    const p1 = await porta.procedimentosSip(c, { vigentesEm: '2026-10-24' });
    const ms = performance.now() - inicio;
    expect(p1.itens.length).toBeLessThanOrEqual(LIMITE_PAGINA_SIP);
    expect(ms).toBeLessThan(3000);
    if (p1.proxima) {
      const p2 = await porta.procedimentosSip(c, { vigentesEm: '2026-10-24', apos: p1.proxima });
      expect(p2.itens[0]?.procedimento ?? Infinity).toBeGreaterThanOrEqual(p1.proxima.procedimento);
    }
    const g = grupos[0]!.id;
    const doGrupo = await porta.procedimentosSip(c, { grupo: g });
    expect(doGrupo.itens.every((i) => i.grupo === g)).toBe(true);
    const cl = await porta.classificacoesAns(c, {});
    expect(cl.itens.length).toBeGreaterThan(0);
    // Os nomes dos procedimentos vêm do catálogo do estabelecimento (só a contagem no log) e a busca da classificação.
    const comNome = p1.itens.filter((i) => i.nome !== null).length;
    expect(comNome).toBeGreaterThan(0);
    const umCodigo = await porta.classificacoesAns(c, { busca: String(cl.itens[0]!.codigo) });
    expect(umCodigo.itens.map((i) => i.codigo)).toEqual([cl.itens[0]!.codigo]);
    const trecho = cl.itens[0]!.nome.slice(0, 4);
    const porNome = await porta.classificacoesAns(c, { busca: trecho });
    expect(porNome.itens.length).toBeGreaterThan(0);
    console.log(
      `[int-m56] ${cod}: ${grupos.length} grupos do SIP; 1ª página ${p1.itens.length} procedimentos (${comNome} com nome) em ${Math.round(ms)} ms; classificação ${cl.itens.length}${cl.proxima ? '+' : ''}`,
    );
  });
});
