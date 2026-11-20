// M58 (etapa 1) sobre a cópia, sob a trava da cópia (com-copia.sh): o serviço da prontidão do desligamento com a porta
// do núcleo real.
//   - painel em READ ONLY: as sessões de pessoa pela tabela de conexões (fora as contas combinadas do registro do fim e
//     o grupo de painéis), a medida diária do M43, as 28 contas técnicas declaradas com presença e escrita, a
//     plataforma (codificação, versão, funções externas), o inventário e os três passos bloqueados (DP-6 no padrão);
//     o cartão da plataforma; tempos; a segunda leitura usa o cache das contas;
//   - regra 2 numa transação desfeita: registrar um item pelo serviço grava a checklist (regravar é UPDATE) e o painel
//     relido mostra o item resolvido; depois do ROLLBACK, as linhas como antes. A trilha na mesma transação e as
//     restrições do banco ficam em packages/testes/src/integracao/m58-desligamento.int.spec.ts (SQL só fora de apps/*).
//   - M58-F5 em READ ONLY: a janela de cada passo com o charset real da cópia (roteiro dos três passos, o ensaio do
//     roteiro do relatório versionado, nenhuma verificação na produção) e a regra 6: a restrição de entrada continua, e
//     o critério de ligar `entrada.utf8` devolve a frase do que falta (sem chave técnica).
// Saída só com contagens e agregados (abaixo de 5 vira <5); nenhum login, nome ou dado de paciente.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  exigirTravaDaCopia,
  lerConfiguracaoNucleo,
  lerItensDesligamento,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { ServicoDesligamento } from './aplicacao/desligamento.js';
import { portaCoexistenciaLegado, portaCoexistenciaNaTransacao } from './porta-legado.js';
import type { PortaCoexistencia } from './porta.js';

const raiz = resolve(import.meta.dirname, '../../../../..');
const { env: base } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const env: Record<string, string> = {
  ...(base as Record<string, string>),
  AMBIENTE: 'dev',
  FB_POOL_TETO: '2',
};
const menos5 = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));

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
  hospital = saude.find((s) => s.disponivel)?.codigo ?? '';
  if (!hospital) throw new Error('Nenhum estabelecimento da cópia disponível.');
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

const servico = (porta: PortaCoexistencia) =>
  new ServicoDesligamento({
    porta,
    raizFim: resolve(raiz, 'docs/coexistencia/fim'),
    raizDesligamento: resolve(raiz, 'docs/coexistencia/desligamento'),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
    configuracao: null,
  });

const itensGravados = () =>
  nucleo.lerSomente(
    { rede: nucleo.rede, hospital, traceId: 'integracao-m58' },
    async (l) => (await lerItensDesligamento(l, hospital)).length,
  );

describe('M58 (etapa 1): prontidão do desligamento na cópia', () => {
  it('painel e cartão em READ ONLY: sessões, contas, plataforma, inventário e os passos bloqueados; tempos', async () => {
    const s = servico(portaCoexistenciaLegado(nucleo));
    const t0 = performance.now();
    const p = await s.painel(sessao());
    const primeiro = Math.round(performance.now() - t0);
    const t1 = performance.now();
    const p2 = await s.painel(sessao());
    const segundo = Math.round(performance.now() - t1);
    const t2 = performance.now();
    const cartao = await s.cartaoPlataforma(sessao());
    const tCartao = Math.round(performance.now() - t2);

    expect(p.itens).toHaveLength(12);
    expect(p.contas.declaradas).toHaveLength(28);
    const presentes = p.contas.declaradas.filter((c) => c.presente).length;
    const comEscrita = p.contas.declaradas.filter((c) => c.escrita).length;
    expect(presentes).toBeGreaterThan(0);
    // O cache das contas: a segunda leitura devolve as mesmas, sem reler o catálogo de privilégios.
    expect(p2.contas).toEqual(p.contas);
    expect(p.plataforma.charsetBanco).toBe('NONE');
    expect(p.plataforma.charsetParametro).toBe('CP1252');
    expect(p.plataforma.charsetConfere).toBe(true);
    expect(p.plataforma.versaoMaior).toBe(3);
    expect(p.plataforma.funcoesExternas.every((f) => f.esperada)).toBe(true);
    expect(p.plataforma.impressao).toMatch(/^[0-9a-f]{16}$/);
    // DP-6 no padrão e o fim não registrado: nenhum passo sai do bloqueio.
    expect(p.passos.map((x) => x.situacao)).toEqual(['bloqueado', 'bloqueado', 'bloqueado']);
    expect(p.passos[0]!.motivos).toContain('fim-da-coexistencia-nao-registrado');
    expect(p.registroInvalido).toBeNull();
    // A regra 3 só se cumpre com a medida diária: a cópia não tem 14 dias medidos seguidos.
    expect(p.sessoesCumprido).toBe(false);
    expect(p.sessoes.cumprido).toBe(p.sessoes.pessoasNaJanela === 0);
    expect(cartao.restricaoEntrada).toBe('cp1252');
    expect(cartao.funcoesPendentes.length).toBe(cartao.plataforma.funcoesExternas.length);
    expect(cartao.indicesComTexto).toBeGreaterThan(0);
    expect(primeiro).toBeLessThan(60_000);
    expect(segundo).toBeLessThan(primeiro + 5_000);
    console.log(
      `[M58.1 ${hospital}] tabela de conexões: último dia ${p.ultimoDiaTabela ?? '—'}, ${menos5(p.sessoes.pessoasNaJanela)} pessoa(s) nos 14 dias até hoje (${
        p.sessoes.cumprido ? 'sem uso' : 'com uso'
      }); medida diária ${p.medidaDiaria.diasLimpos}/${p.medidaDiaria.exigidos}; critério ${
        p.sessoesCumprido ? 'cumprido' : 'não cumprido'
      }; contas declaradas ${presentes}/28 presentes, ${comEscrita} com escrita, ${p.contas.naoDeclaradas} fora da lista; ${
        p.plataforma.charsetBanco
      } ${p.plataforma.versaoMotor} ODS ${p.plataforma.ods}; externas ${p.plataforma.funcoesExternas
        .map((f) => `${f.nome}(${f.dependentes})`)
        .join(
          ' ',
        )}; colunas de texto ${cartao.colunasTexto.map((c) => `${c.tipo}/${c.charset}=${c.colunas}`).join(' ')}; índices com texto ${
        cartao.indicesComTexto
      }; passos ${p.passos.map((x) => `${x.passo}:${x.motivos.length}`).join(' ')}; tempos painel ${primeiro} ms, de novo ${segundo} ms, cartão ${tCartao} ms`,
    );
  });

  it('regra 2 numa transação desfeita: grava os itens pelo serviço (regravar é UPDATE) e o painel relido os mostra; ROLLBACK', async () => {
    const antes = await itensGravados();
    const r = await nucleo.desfazendoNaCopia(
      { rede: nucleo.rede, hospital, traceId: 'integracao-m58' },
      async (e) => {
        const s = servico(portaCoexistenciaNaTransacao(e));
        const g = await s.registrar(sessao(), 'paineis-tv', {
          situacao: 'substituto-em-uso',
          contingencia: 'reinstalavel-no-periodo',
          papelResponsavel: 'TI do hospital',
          evidencia: 'ata sintética do teste',
        });
        await s.registrar(sessao(), 'servico-sac-movel', {
          situacao: 'aceito-como-perdido',
          contingencia: 'nenhuma',
          papelResponsavel: 'atendimento ao cliente',
          evidencia: 'chamado sintético do teste',
        });
        // Regravar é UPDATE (sem duplicar a linha).
        await s.registrar(sessao(), 'paineis-tv', {
          situacao: 'aceito-como-perdido',
          contingencia: 'nenhuma',
          papelResponsavel: 'TI do hospital',
          evidencia: 'ata sintética do teste',
        });
        const painel = await s.painel(sessao());
        // A trilha guarda os códigos de antes e depois (a linha anterior lida antes do UPDATE); o texto livre, não.
        const difs = await e.consultar(
          `SELECT FIRST 2 DIFERENCA FROM SGH_TRILHA WHERE EVENTO = 'coexistencia.desligamento.item'
             AND CHAVE_NATURAL_ALVO = ? ORDER BY ID DESC`,
          [`${hospital}:paineis-tv`],
          { teto: 2 },
        );
        return {
          diferencas: difs.map((x) => String(x['DIFERENCA'])),
          registradoEm: g.registradoEm,
          linhas: (await lerItensDesligamento(e, hospital)).length,
          paineis: painel.itens.find((i) => i.item === 'paineis-tv'),
          sac: painel.itens.find((i) => i.item === 'servico-sac-movel'),
        };
      },
    );
    expect(r.linhas).toBe(antes + 2);
    expect(r.diferencas[0]).toBe(
      'situacao=substituto-em-uso>aceito-como-perdido;contingencia=reinstalavel-no-periodo>nenhuma;alterados=nenhum',
    );
    expect(r.diferencas[1]).toMatch(/>substituto-em-uso;contingencia=.*>reinstalavel-no-periodo;alterados=/);
    expect(r.diferencas.join(' ')).not.toContain('ata sintética');
    expect(r.paineis).toMatchObject({
      situacao: 'aceito-como-perdido',
      contingencia: 'nenhuma',
      resolvido: true,
    });
    expect(r.sac).toMatchObject({ situacao: 'aceito-como-perdido', resolvido: true });
    expect(Number.isNaN(Date.parse(r.registradoEm))).toBe(false);
    const depois = await itensGravados();
    expect(depois).toBe(antes);
    console.log(
      `[M58.1 ${hospital}] checklist pelo serviço na transação desfeita: +2 linhas (3 registros, um UPDATE); depois do ROLLBACK ${depois} linha(s), como antes`,
    );
  });

  it('M58-F5 em READ ONLY: a janela dos três passos, a restrição de entrada e a recusa de ligar entrada.utf8', async () => {
    // Com a pasta dos relatórios versionados (o janela.json do ensaio do roteiro), como na API.
    const s = new ServicoDesligamento({
      porta: portaCoexistenciaLegado(nucleo),
      raizFim: resolve(raiz, 'docs/coexistencia/fim'),
      raizDesligamento: resolve(raiz, 'docs/coexistencia/desligamento'),
      pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
      configuracao: null,
      raizEnsaios: resolve(raiz, 'docs/marcos/M58'),
    });
    const t0 = performance.now();
    const j = await s.janela(sessao());
    const frase = await s.motivoLigarEntradaUtf8({ rede: nucleo.rede, hospital });
    const ms = Math.round(performance.now() - t0);

    expect(j.hospital).toBe(hospital);
    expect(j.passos.map((p) => p.passo)).toEqual(['desligamento', 'firebird5', 'utf8']);
    for (const p of j.passos) {
      expect(p.roteiro.length).toBeGreaterThan(5);
      expect(p.producao).toBeNull();
      expect(p.roteiro.map((e) => e.comando ?? '').join(' ')).not.toMatch(
        /senha|password|\d+\.\d+\.\d+\.\d+/i,
      );
    }
    expect(j.retirada.charsetBanco).toBe('NONE');
    expect(j.retirada.charsetParametro).toBe('CP1252');
    expect(j.retirada.situacao).toBe('restrita');
    expect(j.retirada.motivos).toEqual(expect.arrayContaining(['banco-nao-utf8', 'parametro-nao-utf8']));
    expect(frase).toBeTruthy();
    expect(frase).not.toMatch(/entrada\.utf8|legado|spdata|banco-nao-utf8/i);
    expect(ms).toBeLessThan(60_000);
    console.log(
      `[M58.5 ${hospital}] janela: roteiros ${j.passos.map((p) => `${p.passo}=${p.roteiro.length}`).join(' ')}, ensaio do roteiro ${j.passos
        .map((p) => `${p.passo}=${p.ensaio ? (p.ensaio.aprovada ? 'aprovado' : 'reprovado') : 'ausente'}`)
        .join(' ')}; retirada ${j.retirada.situacao} (${j.retirada.motivos.join(', ')}); ${ms} ms`,
    );
  });
});
